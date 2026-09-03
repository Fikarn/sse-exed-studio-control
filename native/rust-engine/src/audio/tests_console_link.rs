//! Console link (2026-09 audit remediation, Slice 2) and console pull
//! (Slice 3) integration tests. Split out of `tests.rs` when that file crossed
//! the 2 000-line source guard; the shared `TestDir` helper stays there.

use super::tests::TestDir;
use super::*;
use crate::app_state::APP_SETTINGS_PREFIX;
use crate::storage::{initialize_database, list_settings_by_prefix, set_settings_owned};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::Duration;

#[test]
fn audio_sync_in_simulated_mode_reports_aligned_without_a_pull() {
    // Replaces `audio_sync_updates_console_state_when_probe_passed`, which
    // asserted `aligned` after a sync that never touched any console. With
    // Sync = console pull (Slice 3) that is only true for the simulated
    // console, which mirrors the app by construction.
    let test_dir = TestDir::new("sync-simulated");
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[
            (
                String::from("app.commissioning.check.audio.status"),
                String::from("passed"),
            ),
            (
                String::from(AUDIO_METERING_SOURCE_KEY),
                String::from(crate::rme_totalmix_osc::SIMULATED_AUDIO_SOURCE),
            ),
        ],
    )
    .expect("probe state should persist");

    let result = sync_audio_console(test_dir.db_path().as_path()).expect("sync should succeed");
    assert!(result.synced);
    assert!(result.complete);
    assert_eq!(result.pulled_values, 0);
    assert_eq!(result.connection, "simulated");
    assert_eq!(result.console_state_confidence, "aligned");

    let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    let snapshot = read_audio_snapshot(&settings);
    assert_eq!(snapshot.console_state_confidence, "aligned");
    assert_eq!(snapshot.last_action_status, "succeeded");
    assert_eq!(
        snapshot.last_console_sync_reason.as_deref(),
        Some("simulated-sync")
    );
    assert!(snapshot.last_console_sync_at.is_some());
}

// ---------------------------------------------------------------------------
// Sync = console pull (Slice 3). A fake TotalMix on loopback answers the
// engine's `/sendall` with a scripted dump; a pump thread stands in for the
// metering thread (read the slot, service the link, flush).
// ---------------------------------------------------------------------------

/// The pull tests share the process-wide console link (`slot_bound`, pending
/// sends), so they run one at a time and start from a quiet link.
fn serialize_shared_link() -> std::sync::MutexGuard<'static, ()> {
    let guard = crate::rme_console_link::SHARED_LINK_TEST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Ok(mut link) = crate::rme_console_link::shared_console_link().lock() {
        link.reset_for_test();
    }
    guard
}

struct FakeTotalMix {
    socket: Option<std::net::UdpSocket>,
    port: u16,
    stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
    handle: Option<std::thread::JoinHandle<()>>,
}

impl FakeTotalMix {
    fn bind() -> Self {
        let socket = std::net::UdpSocket::bind("127.0.0.1:0").expect("fake TotalMix should bind");
        socket
            .set_read_timeout(Some(Duration::from_millis(40)))
            .expect("read timeout should apply");
        let port = socket.local_addr().expect("fake address").port();
        Self {
            socket: Some(socket),
            port,
            stop: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            handle: None,
        }
    }

    /// Answers `/sendall` with `script`; with `keep_streaming` it never goes
    /// quiet afterwards. With `answer == false` it swallows everything.
    fn start(
        &mut self,
        reply_to_port: u16,
        script: Vec<(&'static str, f32)>,
        keep_streaming: bool,
        answer: bool,
    ) {
        let socket = self.socket.take().expect("fake socket");
        let stop = self.stop.clone();
        self.handle = Some(std::thread::spawn(move || {
            let send = |address: &str, value: f32| {
                let packet = rosc::OscPacket::Message(rosc::OscMessage {
                    addr: String::from(address),
                    args: vec![rosc::OscType::Float(value)],
                });
                if let Ok(bytes) = rosc::encoder::encode(&packet) {
                    let _ = socket.send_to(&bytes, ("127.0.0.1", reply_to_port));
                }
            };
            let mut buffer = [0u8; 2048];
            let mut streaming = false;
            while !stop.load(std::sync::atomic::Ordering::Relaxed) {
                if let Ok((len, _)) = socket.recv_from(&mut buffer) {
                    if let Ok((_, rosc::OscPacket::Message(message))) =
                        rosc::decoder::decode_udp(&buffer[..len])
                    {
                        if message.addr == "/sendall" && answer {
                            for (address, value) in &script {
                                send(address, *value);
                            }
                            streaming = keep_streaming;
                        }
                    }
                }
                if streaming {
                    send("/input/0/mute", 0.0);
                }
            }
        }));
    }
}

impl Drop for FakeTotalMix {
    fn drop(&mut self) {
        self.stop.store(true, std::sync::atomic::Ordering::Relaxed);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

struct SlotPump {
    stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
    handle: Option<std::thread::JoinHandle<()>>,
}

impl SlotPump {
    fn start(slot: crate::rme_totalmix_osc::GlobalOscSlot, db_path: PathBuf) -> Self {
        let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let stop_flag = stop.clone();
        let handle = std::thread::spawn(move || {
            let mut slot = slot;
            while !stop_flag.load(std::sync::atomic::Ordering::Relaxed) {
                crate::rme_totalmix_osc::pump_global_slot_for_test(
                    &mut slot,
                    "127.0.0.1",
                    &db_path,
                );
                std::thread::sleep(Duration::from_millis(10));
            }
        });
        Self {
            stop,
            handle: Some(handle),
        }
    }
}

impl Drop for SlotPump {
    fn drop(&mut self) {
        self.stop.store(true, std::sync::atomic::Ordering::Relaxed);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

fn fast_pull_timing() -> PullTiming {
    PullTiming {
        quiet_ms: 150,
        timeout_ms: 1_200,
        poll_ms: 10,
    }
}

/// A ready engine database whose transport points at `fake_port - 3`.
fn pull_test_db(label: &str, fake_port: u16) -> TestDir {
    let test_dir = TestDir::new(label);
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
    update_audio_settings(
        test_dir.db_path().as_path(),
        &AudioSettingsUpdateRequest {
            osc_enabled: None,
            send_host: Some(String::from("127.0.0.1")),
            send_port: Some(i64::from(fake_port) - 3),
            receive_port: None,
            selected_channel_id: None,
            selected_mix_target_id: None,
            expected_peak_data: None,
            expected_submix_lock: None,
            expected_compatibility_mode: None,
            faders_per_bank: None,
            view_mode: None,
        },
    )
    .expect("transport settings should persist");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(
            String::from("app.commissioning.check.audio.status"),
            String::from("passed"),
        )],
    )
    .expect("probe state should persist");
    test_dir
}

fn studio_dump_script() -> Vec<(&'static str, f32)> {
    vec![
        ("/status/connection", 1.0),
        ("/status/dsp", 8.0),
        ("/input/8/mute", 1.0),
        ("/input/8/gain", 33.0),
        ("/input/8/48v", 1.0),
        ("/input/8/phase", 0.0),
        ("/input/8/eq/band1freq", 100.0), // dump traffic the app does not model
        ("/mix/in/8/8/fader", 0.0),       // Host -> Phones 1 at unity
        ("/playback/2/mute", 1.0),
        ("/mix/pb/2/0/fader", -6.0), // playback 3/4 -> Main at the curve knee
        ("/output/0/volume", -20.24),
        ("/output/8/volume", -16.6),
        ("/controlroom/dim", 0.0),
        ("/controlroom/mainmono", 0.0),
    ]
}

#[test]
fn console_pull_ingests_a_fake_totalmix_dump() {
    let _serial = serialize_shared_link();
    let mut fake = FakeTotalMix::bind();
    let slot = crate::rme_totalmix_osc::bind_test_global_slot(fake.port);
    fake.start(slot.local_port(), studio_dump_script(), false, true);
    let test_dir = pull_test_db("console-pull-dump", fake.port);
    crate::rme_totalmix_osc::mark_console_link_slot(true);
    let _pump = SlotPump::start(slot, test_dir.db_path());

    let result = sync_audio_console_with_timing(test_dir.db_path().as_path(), fast_pull_timing())
        .expect("the pull should complete against the fake console");
    assert!(result.synced);
    assert!(result.complete);
    assert_eq!(result.console_state_confidence, "aligned");
    assert_eq!(result.connection, "connected");
    assert_eq!(
        result.pulled_values, 13,
        "every modelled parameter counts, EQ detail does not"
    );
    assert_eq!(result.channels, 2, "input 8 and playback 2");
    assert_eq!(result.mix_targets, 2, "outputs 0 and 8");
    assert!(
        result.summary.starts_with("Pulled 13 values from TotalMix"),
        "{}",
        result.summary
    );
    assert!(result.summary.contains("sends off"), "{}", result.summary);

    let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    let snapshot = read_audio_snapshot(&settings);
    assert_eq!(snapshot.console_state_confidence, "aligned");
    assert_eq!(
        snapshot.last_console_sync_reason.as_deref(),
        Some("console-pull")
    );
    assert!(snapshot.last_console_sync_at.is_some());
    assert_eq!(snapshot.console_link.last_pull_values, Some(13));
    assert!(snapshot.console_link.last_pull_at.is_some());

    let host = snapshot
        .channels
        .iter()
        .find(|entry| entry.id == "audio-input-9")
        .expect("host channel");
    assert!(host.mute);
    assert_eq!(host.gain, 33);
    assert!(host.phantom);
    assert!(!host.phase);
    assert!((host.mix_levels["audio-mix-phones-a"] - 836.0 / 1023.0).abs() < 0.002);
    // Host -> Main was not in the dump: at or below -65 dB, i.e. off.
    assert_eq!(host.mix_levels["audio-mix-main"], 0.0);
    assert_eq!(host.fader, 0.0);
    let playback = snapshot
        .channels
        .iter()
        .find(|entry| entry.id == "audio-playback-3-4")
        .expect("playback 3/4");
    assert!(playback.mute);
    assert!((playback.mix_levels["audio-mix-main"] - 649.0 / 1023.0).abs() < 0.002);
    assert_eq!(playback.mix_levels["audio-mix-phones-a"], 0.0);
    let main = snapshot
        .mix_targets
        .iter()
        .find(|entry| entry.id == "audio-mix-main")
        .expect("main");
    assert!((main.volume - fader_curve::fader_db_to_lin(-20.24)).abs() < 1e-6);
    assert!(!main.dim);
    let phones_a = snapshot
        .mix_targets
        .iter()
        .find(|entry| entry.id == "audio-mix-phones-a")
        .expect("phones a");
    assert!((phones_a.volume - fader_curve::fader_db_to_lin(-16.6)).abs() < 1e-6);
}

#[test]
fn console_pull_that_never_goes_quiet_is_incomplete() {
    let _serial = serialize_shared_link();
    let mut fake = FakeTotalMix::bind();
    let slot = crate::rme_totalmix_osc::bind_test_global_slot(fake.port);
    fake.start(slot.local_port(), studio_dump_script(), true, true);
    let test_dir = pull_test_db("console-pull-incomplete", fake.port);
    crate::rme_totalmix_osc::mark_console_link_slot(true);
    let _pump = SlotPump::start(slot, test_dir.db_path());

    let error = sync_audio_console_with_timing(
        test_dir.db_path().as_path(),
        PullTiming {
            quiet_ms: 150,
            timeout_ms: 500,
            poll_ms: 10,
        },
    )
    .expect_err("a dump that never ends is incomplete");
    match error {
        AudioCommandError::Rejected(code, message) => {
            assert_eq!(code, "AUDIO_SYNC_INCOMPLETE");
            assert!(message.contains("still sending"), "{message}");
        }
        other => panic!("unexpected error: {other:?}"),
    }

    let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    let snapshot = read_audio_snapshot(&settings);
    assert_eq!(snapshot.console_state_confidence, "unknown");
    assert_eq!(
        snapshot.last_action_code.as_deref(),
        Some("AUDIO_SYNC_INCOMPLETE")
    );
    // What arrived is console truth and stays.
    let host = snapshot
        .channels
        .iter()
        .find(|entry| entry.id == "audio-input-9")
        .expect("host channel");
    assert!(host.mute);
    assert_eq!(host.gain, 33);
}

#[test]
fn audio_sync_without_console_echo_is_refused_and_stays_unknown() {
    let _serial = serialize_shared_link();
    let mut fake = FakeTotalMix::bind();
    let slot = crate::rme_totalmix_osc::bind_test_global_slot(fake.port);
    fake.start(slot.local_port(), Vec::new(), false, false);
    let test_dir = pull_test_db("console-pull-no-echo", fake.port);
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(
            String::from(AUDIO_CONSOLE_STATE_CONFIDENCE_KEY),
            String::from("aligned"),
        )],
    )
    .expect("stale aligned seed should persist");
    crate::rme_totalmix_osc::mark_console_link_slot(true);
    let _pump = SlotPump::start(slot, test_dir.db_path());

    let error = sync_audio_console_with_timing(
        test_dir.db_path().as_path(),
        PullTiming {
            quiet_ms: 100,
            timeout_ms: 400,
            poll_ms: 10,
        },
    )
    .expect_err("a silent console cannot align anything");
    match error {
        AudioCommandError::Rejected(code, message) => {
            assert_eq!(code, "AUDIO_SYNC_NO_ECHO");
            assert!(message.contains("did not answer"), "{message}");
            assert!(message.contains("remote 4"), "{message}");
        }
        other => panic!("unexpected error: {other:?}"),
    }
    let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    let snapshot = read_audio_snapshot(&settings);
    assert_eq!(
        snapshot.console_state_confidence, "unknown",
        "a stale aligned must not survive a failed pull"
    );
    assert_eq!(snapshot.last_action_status, "failed");
}

#[test]
fn audio_sync_refuses_when_the_global_slot_is_unbound() {
    let _serial = serialize_shared_link();
    let fake = FakeTotalMix::bind();
    let test_dir = pull_test_db("console-pull-unbound", fake.port);
    crate::rme_totalmix_osc::mark_console_link_slot(false);

    let error = sync_audio_console_with_timing(test_dir.db_path().as_path(), fast_pull_timing())
        .expect_err("no slot, no pull");
    match error {
        AudioCommandError::Rejected(code, message) => {
            assert_eq!(code, "AUDIO_GLOBAL_OSC_UNBOUND");
            assert!(message.contains("Global OSC receive port"), "{message}");
        }
        other => panic!("unexpected error: {other:?}"),
    }
}

/// Hardware lane (`npm run native:test:hardware` with
/// `SSE_ENGINE_TEST_ALLOW_CONSOLE_WRITES=1`, studio app not running): pulls the
/// real desk over 7004/9004. Read-only — `/sendall` and `/sendstate` change
/// nothing on the console.
#[test]
#[ignore]
fn live_totalmix_pull_round_trip() {
    if std::env::var("SSE_ENGINE_TEST_ALLOW_CONSOLE_WRITES").as_deref() != Ok("1") {
        eprintln!("skipping: set SSE_ENGINE_TEST_ALLOW_CONSOLE_WRITES=1 to let the pull request leave the machine");
        return;
    }
    let _serial = serialize_shared_link();
    let test_dir = TestDir::new("console-pull-live");
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(
            String::from("app.commissioning.check.audio.status"),
            String::from("passed"),
        )],
    )
    .expect("probe state should persist");
    let socket = std::net::UdpSocket::bind("127.0.0.1:9004")
        .expect("Global OSC receive port 9004 should be free (studio app not running)");
    drop(socket);
    let slot = crate::rme_totalmix_osc::bind_live_global_slot_for_test(7004, 9004)
        .expect("live global slot should bind");
    crate::rme_totalmix_osc::mark_console_link_slot(true);
    let _pump = SlotPump::start(slot, test_dir.db_path());

    let result =
        sync_audio_console(test_dir.db_path().as_path()).expect("live pull should complete");
    assert!(result.complete);
    assert_eq!(result.connection, "connected");
    assert!(result.pulled_values > 500, "{}", result.summary);
    eprintln!("live pull: {}", result.summary);
}

// ---------------------------------------------------------------------------
// Console link (2026-09 audit remediation, Slice 2): what TotalMix reports
// back is applied to stored state; what it never confirms lowers confidence.
// ---------------------------------------------------------------------------

#[test]
fn console_echo_updates_channel_and_mix_target_state() {
    use crate::rme_console_link::{
        ChannelFlag, ConsoleBus, ConsoleUpdate, ConsoleValue, ControlRoomFunction, ParamKey,
    };
    let test_dir = TestDir::new("console-echo-apply");
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");

    let update = |key: ParamKey, value: ConsoleValue| ConsoleUpdate {
        key,
        value,
        adjusted: false,
    };
    let updates = vec![
        update(
            ParamKey::ChannelFlag {
                bus: ConsoleBus::Input,
                channel: 8,
                flag: ChannelFlag::Mute,
            },
            ConsoleValue::Flag(true),
        ),
        update(ParamKey::InputGain { channel: 8 }, ConsoleValue::Db(44.4)),
        update(
            ParamKey::MixFader {
                bus: ConsoleBus::Input,
                channel: 8,
                output: 0,
            },
            ConsoleValue::Db(0.0),
        ),
        update(
            ParamKey::MixFader {
                bus: ConsoleBus::Playback,
                channel: 2,
                output: 8,
            },
            ConsoleValue::Db(-6.0),
        ),
        update(
            ParamKey::MixSolo {
                bus: ConsoleBus::Playback,
                channel: 2,
                output: 0,
            },
            ConsoleValue::Flag(true),
        ),
        update(
            ParamKey::OutputVolume { output: 8 },
            ConsoleValue::Db(-16.6),
        ),
        update(
            ParamKey::ControlRoom(ControlRoomFunction::Dim),
            ConsoleValue::Flag(true),
        ),
        update(
            ParamKey::ChannelFlag {
                bus: ConsoleBus::Output,
                channel: 10,
                flag: ChannelFlag::Mute,
            },
            ConsoleValue::Flag(true),
        ),
        // Not modelled by the app: a MADI playback pair, an unmapped output,
        // and a solo on a non-main submix.
        update(
            ParamKey::ChannelFlag {
                bus: ConsoleBus::Playback,
                channel: 92,
                flag: ChannelFlag::Mute,
            },
            ConsoleValue::Flag(true),
        ),
        update(ParamKey::OutputVolume { output: 4 }, ConsoleValue::Db(-3.0)),
        update(
            ParamKey::MixSolo {
                bus: ConsoleBus::Input,
                channel: 8,
                output: 8,
            },
            ConsoleValue::Flag(true),
        ),
    ];

    let report = apply_console_activity(test_dir.db_path().as_path(), &updates, &[], false)
        .expect("console echo should apply");
    assert_eq!(report.applied, 8);
    assert!(report.changed());

    let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    let snapshot = read_audio_snapshot(&settings);
    let host = snapshot
        .channels
        .iter()
        .find(|entry| entry.id == "audio-input-9")
        .expect("host channel");
    assert!(host.mute);
    assert_eq!(host.gain, 44, "gain rounds to whole dB");
    let unity = 836.0 / 1023.0;
    assert!(
        (host.fader - unity).abs() < 0.002,
        "0 dB is unity on the RME curve, got {}",
        host.fader
    );
    assert!((host.mix_levels["audio-mix-main"] - unity).abs() < 0.002);
    let playback = snapshot
        .channels
        .iter()
        .find(|entry| entry.id == "audio-playback-3-4")
        .expect("playback 3/4");
    assert!(
        (playback.mix_levels["audio-mix-phones-a"] - 649.0 / 1023.0).abs() < 0.002,
        "-6 dB is the curve knee"
    );
    assert!(playback.solo);
    let phones_a = snapshot
        .mix_targets
        .iter()
        .find(|entry| entry.id == "audio-mix-phones-a")
        .expect("phones a");
    assert!((phones_a.volume - fader_curve::fader_db_to_lin(-16.6)).abs() < 1e-9);
    let main = snapshot
        .mix_targets
        .iter()
        .find(|entry| entry.id == "audio-mix-main")
        .expect("main");
    assert!(main.dim);
    let phones_b = snapshot
        .mix_targets
        .iter()
        .find(|entry| entry.id == "audio-mix-phones-b")
        .expect("phones b");
    assert!(phones_b.mute);
    // Echoes never move confidence or the action log.
    assert_eq!(snapshot.console_state_confidence, "unknown");
    assert_eq!(snapshot.last_action_status, "idle");

    // Re-applying the same truth is a no-op: no write, no event.
    let again = apply_console_activity(test_dir.db_path().as_path(), &updates, &[], false)
        .expect("re-apply should succeed");
    assert_eq!(again.applied, 0);
    assert!(!again.changed());
}

#[test]
fn unconfirmed_sends_downgrade_confidence_to_assumed() {
    use crate::rme_console_link::{ChannelFlag, ConsoleBus, ConsoleValue, ParamKey, PendingSend};
    let test_dir = TestDir::new("console-unconfirmed");
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(
            String::from(AUDIO_CONSOLE_STATE_CONFIDENCE_KEY),
            String::from("aligned"),
        )],
    )
    .expect("aligned seed should persist");

    let expired = vec![
        PendingSend {
            key: ParamKey::ChannelFlag {
                bus: ConsoleBus::Input,
                channel: 8,
                flag: ChannelFlag::Mute,
            },
            value: ConsoleValue::Flag(true),
            sent_at_ms: 0,
            requested_at_ms: Some(130),
        },
        PendingSend {
            key: ParamKey::MixFader {
                bus: ConsoleBus::Playback,
                channel: 6,
                output: 10,
            },
            value: ConsoleValue::Position(0.3),
            sent_at_ms: 0,
            requested_at_ms: Some(130),
        },
    ];
    let report = apply_console_activity(test_dir.db_path().as_path(), &[], &expired, false)
        .expect("expiry should persist");
    assert_eq!(report.unconfirmed, 2);
    assert!(report.changed());

    let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    let snapshot = read_audio_snapshot(&settings);
    assert_eq!(snapshot.console_state_confidence, "assumed");
    assert_eq!(snapshot.last_action_status, "failed");
    assert_eq!(
        snapshot.last_action_code.as_deref(),
        Some("AUDIO_CONSOLE_UNCONFIRMED")
    );
    let message = snapshot.last_action_message.unwrap_or_default();
    assert!(message.contains("did not confirm 2 changes"), "{message}");
    assert!(message.contains("input 8 mute"), "{message}");
    assert!(message.contains("Press Sync"), "{message}");
}

#[test]
fn console_disconnect_resets_confidence_to_unknown() {
    let test_dir = TestDir::new("console-disconnect");
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(
            String::from(AUDIO_CONSOLE_STATE_CONFIDENCE_KEY),
            String::from("aligned"),
        )],
    )
    .expect("aligned seed should persist");

    let report = apply_console_activity(test_dir.db_path().as_path(), &[], &[], true)
        .expect("disconnect should persist");
    assert!(report.connection_lost);
    assert!(report.changed());
    let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    assert_eq!(
        read_audio_snapshot(&settings).console_state_confidence,
        "unknown"
    );

    let idle = apply_console_activity(test_dir.db_path().as_path(), &[], &[], false)
        .expect("idle flush should succeed");
    assert!(!idle.changed(), "an idle flush touches nothing");
}

#[test]
fn stored_audio_state_tolerates_missing_and_unknown_fields() {
    let channels: HashMap<String, StoredAudioChannelState> = serde_json::from_str(
        r#"{"audio-input-9":{"gain":30,"mute":true,"futureField":{"nested":1}}}"#,
    )
    .expect("partial channel state should deserialize");
    let host = &channels["audio-input-9"];
    assert_eq!(host.gain, 30);
    assert!(host.mute);
    assert_eq!(host.fader, 0.0);
    assert!(host.mix_levels.is_empty());
    assert_eq!(host.eq, default_audio_eq_snapshot());

    let mix_targets: HashMap<String, StoredAudioMixTargetState> =
        serde_json::from_str(r#"{"audio-mix-main":{"dim":true}}"#)
            .expect("partial mix target state should deserialize");
    assert!(mix_targets["audio-mix-main"].dim);
    assert_eq!(mix_targets["audio-mix-main"].volume, 0.0);

    // A blob with a missing field no longer drops the whole map.
    let settings = HashMap::from([(
        String::from(AUDIO_CHANNEL_STATE_KEY),
        String::from(
            r#"{"audio-input-9":{"name":"Guest","gain":25,"fader":0.5,"mixLevels":{},"mute":false,"solo":false,"phantom":false,"phase":false,"pad":false,"instrument":false,"autoSet":false}}"#,
        ),
    )]);
    let snapshot = read_audio_snapshot(&settings);
    let host = snapshot
        .channels
        .iter()
        .find(|entry| entry.id == "audio-input-9")
        .expect("host");
    assert_eq!(host.name, "Guest");
    assert_eq!(host.gain, 25);
}

#[test]
fn console_confidence_has_one_writer() {
    fn collect(dir: &std::path::Path, out: &mut Vec<PathBuf>) {
        for entry in fs::read_dir(dir).expect("source directory should list") {
            let path = entry.expect("directory entry").path();
            if path.is_dir() {
                collect(&path, out);
            } else if path.extension().map(|ext| ext == "rs").unwrap_or(false) {
                out.push(path);
            }
        }
    }
    let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut files = Vec::new();
    collect(&src, &mut files);

    // The key may appear where it is defined, where the single reader/writer
    // lives, and in tests that seed a value to prove a round trip.
    let allowed_key_users = [
        "audio/mod.rs",
        "audio/helpers.rs",
        "audio/tests.rs",
        "audio/tests_console_link.rs",
        "support.rs",
    ];
    // Every path that moves confidence must go through the single writer.
    let required_writers = [
        "audio/sync.rs",
        "audio/snapshots.rs",
        "audio/settings.rs",
        "audio/console_link.rs",
        "parity_fixtures.rs",
    ];
    let mut offenders = Vec::new();
    let mut writers_seen = Vec::new();
    for file in &files {
        let relative = file
            .strip_prefix(&src)
            .expect("file under src")
            .to_string_lossy()
            .replace('\\', "/");
        let text = fs::read_to_string(file).expect("source file should read");
        let mentions_key = text.contains("AUDIO_CONSOLE_STATE_CONFIDENCE_KEY")
            || text.contains("app.audio.console_state_confidence");
        if mentions_key && !allowed_key_users.contains(&relative.as_str()) {
            offenders.push(relative.clone());
        }
        if text.contains("confidence_setting(") {
            writers_seen.push(relative);
        }
    }
    assert!(
        offenders.is_empty(),
        "console-state confidence must be written only through helpers::confidence_setting; the key appears in {offenders:?}"
    );
    for required in required_writers {
        assert!(
            writers_seen.iter().any(|seen| seen == required),
            "{required} should move confidence through confidence_setting"
        );
    }
}

// ---------------------------------------------------------------------------
// Recall = push (Slice 4). A console model on loopback remembers what the app
// wrote and answers read-backs from that memory, in dB, like the desk does.
// ---------------------------------------------------------------------------

struct ConsoleModel {
    socket: Option<std::net::UdpSocket>,
    port: u16,
    stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
    handle: Option<std::thread::JoinHandle<()>>,
}

impl ConsoleModel {
    fn bind() -> Self {
        let socket = std::net::UdpSocket::bind("127.0.0.1:0").expect("console model should bind");
        socket
            .set_read_timeout(Some(Duration::from_millis(40)))
            .expect("read timeout should apply");
        let port = socket.local_addr().expect("model address").port();
        Self {
            socket: Some(socket),
            port,
            stop: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            handle: None,
        }
    }

    fn start(&mut self, reply_to_port: u16) {
        let socket = self.socket.take().expect("model socket");
        let stop = self.stop.clone();
        self.handle = Some(std::thread::spawn(move || {
            let send = |address: String, value: f32| {
                let packet = rosc::OscPacket::Message(rosc::OscMessage {
                    addr: address,
                    args: vec![rosc::OscType::Float(value)],
                });
                if let Ok(bytes) = rosc::encoder::encode(&packet) {
                    let _ = socket.send_to(&bytes, ("127.0.0.1", reply_to_port));
                }
            };
            let mut values: HashMap<String, f32> = HashMap::new();
            let mut buffer = [0u8; 2048];
            while !stop.load(std::sync::atomic::Ordering::Relaxed) {
                let Ok((len, _)) = socket.recv_from(&mut buffer) else {
                    continue;
                };
                let Ok((_, rosc::OscPacket::Message(message))) =
                    rosc::decoder::decode_udp(&buffer[..len])
                else {
                    continue;
                };
                let parts: Vec<&str> = message.addr.trim_start_matches('/').split('/').collect();
                match parts.as_slice() {
                    ["sendall"] | ["sendstate"] => {
                        send(String::from("/status/connection"), 1.0);
                        send(String::from("/status/dsp"), 8.0);
                    }
                    ["sendsettings"] => {
                        for function in ["dim", "mainmono", "talkback"] {
                            let address = format!("/controlroom/{function}");
                            let value = values.get(&address).copied().unwrap_or(0.0);
                            send(address, value);
                        }
                    }
                    ["sendchan", bus, channel] => {
                        let prefix = format!("/{bus}/{channel}/");
                        let snapshot: Vec<(String, f32)> = values
                            .iter()
                            .filter(|(address, _)| address.starts_with(&prefix))
                            .map(|(address, value)| (address.clone(), *value))
                            .collect();
                        for (address, value) in snapshot {
                            if address.ends_with("/faderlin") {
                                let db = fader_curve::fader_lin_to_db(f64::from(value))
                                    .unwrap_or(-300.0);
                                send(format!("{prefix}volume"), db as f32);
                            } else {
                                send(address, value);
                            }
                        }
                    }
                    ["sendsubmix", output] => {
                        let snapshot: Vec<(String, f32)> = values
                            .iter()
                            .filter(|(address, _)| {
                                let segments: Vec<&str> =
                                    address.trim_start_matches('/').split('/').collect();
                                segments.first() == Some(&"mix") && segments.get(3) == Some(output)
                            })
                            .map(|(address, value)| (address.clone(), *value))
                            .collect();
                        for (address, value) in snapshot {
                            if let Some(base) = address.strip_suffix("/faderlin") {
                                // `/sendsubmix 2` lists only nodes above -65 dB.
                                if let Some(db) = fader_curve::fader_lin_to_db(f64::from(value)) {
                                    send(format!("{base}/fader"), db as f32);
                                }
                            } else {
                                send(address, value);
                            }
                        }
                    }
                    _ => {
                        if let Some(rosc::OscType::Float(value)) = message.args.first() {
                            values.insert(message.addr.clone(), *value);
                        }
                    }
                }
            }
        }));
    }
}

impl Drop for ConsoleModel {
    fn drop(&mut self) {
        self.stop.store(true, std::sync::atomic::Ordering::Relaxed);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

fn channel_request(channel_id: &str) -> AudioChannelUpdateRequest {
    AudioChannelUpdateRequest {
        channel_id: String::from(channel_id),
        mix_target_id: None,
        name: None,
        gain: None,
        fader: None,
        mute: None,
        solo: None,
        phantom: None,
        phase: None,
        pad: None,
        instrument: None,
        auto_set: None,
    }
}

fn mix_target_request(mix_target_id: &str) -> AudioMixTargetUpdateRequest {
    AudioMixTargetUpdateRequest {
        mix_target_id: String::from(mix_target_id),
        volume: None,
        mute: None,
        dim: None,
        mono: None,
        talkback: None,
    }
}

#[test]
fn recall_plan_orders_mutes_first_and_never_touches_48v_talkback_or_pad() {
    let current = read_audio_snapshot(&HashMap::new());
    let mut contents = super::helpers::capture_audio_scene_contents(&current, None);
    let host_now = current
        .channels
        .iter()
        .find(|entry| entry.id == "audio-input-9")
        .expect("host");
    {
        let host = contents
            .channels
            .get_mut("audio-input-9")
            .expect("host in contents");
        host.mute = true;
        host.gain = 30;
        host.phantom = !host_now.phantom;
        host.phase = true;
        host.pad = true;
        host.mix_levels.insert(String::from("audio-mix-main"), 0.5);
        host.mix_levels
            .insert(String::from("audio-mix-phones-a"), 0.0);
    }
    {
        let playback = contents
            .channels
            .get_mut("audio-playback-3-4")
            .expect("playback 3/4 in contents");
        playback.mute = false;
        playback.solo = true;
    }
    {
        let main = contents
            .mix_targets
            .get_mut("audio-mix-main")
            .expect("main in contents");
        main.mute = false;
        main.volume = 0.61;
        main.dim = true;
        main.mono = false;
        main.talkback = true;
        let phones = contents
            .mix_targets
            .get_mut("audio-mix-phones-a")
            .expect("phones a in contents");
        phones.mute = true;
    }

    let plan = super::recall::build_recall_plan(&current, &contents);
    assert_eq!(plan.phases.len(), 4);
    let addresses = |phase: usize| -> Vec<String> {
        plan.phases[phase]
            .iter()
            .map(|(address, _)| address.clone())
            .collect()
    };
    let mutes_on = addresses(0);
    assert!(mutes_on.contains(&String::from("/input/8/mute")));
    assert!(mutes_on.contains(&String::from("/output/8/mute")));
    assert!(!mutes_on.contains(&String::from("/playback/2/mute")));
    let values = addresses(1);
    assert!(values.contains(&String::from("/mix/in/8/0/faderlin")));
    assert!(values.contains(&String::from("/mix/in/8/8/faderlin")));
    assert!(values.contains(&String::from("/input/8/gain")));
    assert!(values.contains(&String::from("/input/8/phase")));
    assert!(values.contains(&String::from("/mix/pb/2/0/solo")));
    assert!(values.contains(&String::from("/output/0/faderlin")));
    let mutes_off = addresses(2);
    assert!(mutes_off.contains(&String::from("/playback/2/mute")));
    assert!(mutes_off.contains(&String::from("/output/0/mute")));
    assert_eq!(
        addresses(3),
        vec![
            String::from("/controlroom/dim"),
            String::from("/controlroom/mainmono")
        ]
    );
    let everything: Vec<String> = (0..4).flat_map(addresses).collect();
    assert!(
        everything.iter().all(|address| !address.contains("48v")
            && !address.contains("talkback")
            && !address.contains("pad")),
        "48V, talkback and pad are never pushed"
    );
    let host_main = plan.phases[1]
        .iter()
        .find(|(address, _)| address == "/mix/in/8/0/faderlin")
        .map(|(_, value)| value.clone());
    assert_eq!(host_main, Some(rosc::OscType::Float(0.5)));
    assert_eq!(plan.message_count(), everything.len());
    assert!(!plan.keys.is_empty());
    assert!(plan.keys.len() <= plan.message_count());
    assert_eq!(
        plan.phantom_differences,
        vec![PhantomDifference {
            channel_id: String::from("audio-input-9"),
            channel_name: host_now.name.clone(),
            current: host_now.phantom,
            target: !host_now.phantom,
        }]
    );

    let (channels, mix_targets) = super::recall::recalled_state_maps(&current, &contents);
    assert_eq!(
        channels["audio-input-9"].phantom, host_now.phantom,
        "48V keeps the console's value in app state"
    );
    assert!(channels["audio-input-9"].mute);
    assert!(
        !mix_targets["audio-mix-main"].talkback,
        "talkback is never recalled"
    );
    assert!(mix_targets["audio-mix-main"].dim);
}

#[test]
fn recall_pushes_the_snapshot_and_the_console_confirms_it() {
    let _serial = serialize_shared_link();
    let mut console = ConsoleModel::bind();
    let slot = crate::rme_totalmix_osc::bind_test_global_slot(console.port);
    console.start(slot.local_port());
    let test_dir = pull_test_db("recall-push-confirmed", console.port);
    crate::rme_totalmix_osc::mark_console_link_slot(true);
    let _pump = SlotPump::start(slot, test_dir.db_path());
    let db = test_dir.db_path();

    // The scene worth keeping: Host muted at 30 dB with its main send at the
    // curve knee, Main dimmed at half fader.
    let mut host = channel_request("audio-input-9");
    host.mute = Some(true);
    host.gain = Some(30);
    host.fader = Some(649.0 / 1023.0);
    update_audio_channel(&db, &host).expect("host edit should send");
    let mut main = mix_target_request("audio-mix-main");
    main.dim = Some(true);
    main.volume = Some(0.5);
    update_audio_mix_target(&db, &main).expect("main edit should send");
    std::thread::sleep(Duration::from_millis(500));
    let created = create_audio_snapshot(
        &db,
        &AudioSnapshotCreateRequest {
            name: String::from("Podcast"),
            osc_index: 6,
            capture_current_state: Some(true),
        },
    )
    .expect("snapshot capture should succeed");

    // Drift away from it.
    let mut drift = channel_request("audio-input-9");
    drift.mute = Some(false);
    drift.gain = Some(45);
    update_audio_channel(&db, &drift).expect("drift edit should send");
    let mut main_drift = mix_target_request("audio-mix-main");
    main_drift.dim = Some(false);
    update_audio_mix_target(&db, &main_drift).expect("main drift should send");
    std::thread::sleep(Duration::from_millis(500));

    let result = recall_audio_snapshot_with_timing(
        &db,
        &AudioSnapshotRecallRequest {
            snapshot_id: created.snapshot.id.clone(),
        },
        PushTiming {
            confirm_wait_ms: 1_500,
            poll_ms: 10,
        },
    )
    .expect("recall should push and confirm");
    assert!(result.pushed > 20, "{}", result.summary);
    assert_eq!(result.unconfirmed, 0, "{}", result.summary);
    assert_eq!(result.adjusted, 0, "{}", result.summary);
    assert_eq!(result.confirmed, result.pushed, "{}", result.summary);
    assert_eq!(result.console_state_confidence, "aligned");
    assert!(result.phantom_differences.is_empty());
    assert!(result.summary.contains("confirmed"), "{}", result.summary);

    let settings = list_settings_by_prefix(&db, APP_SETTINGS_PREFIX).expect("settings should load");
    let snapshot = read_audio_snapshot(&settings);
    assert_eq!(snapshot.console_state_confidence, "aligned");
    assert_eq!(
        snapshot.last_console_sync_reason.as_deref(),
        Some("snapshot-push")
    );
    assert_eq!(
        snapshot.last_recalled_snapshot_id.as_deref(),
        Some(created.snapshot.id.as_str())
    );
    let host_after = snapshot
        .channels
        .iter()
        .find(|entry| entry.id == "audio-input-9")
        .expect("host");
    assert!(host_after.mute);
    assert_eq!(host_after.gain, 30);
    assert!((host_after.mix_levels["audio-mix-main"] - 649.0 / 1023.0).abs() < 0.002);
    let main_after = snapshot
        .mix_targets
        .iter()
        .find(|entry| entry.id == "audio-mix-main")
        .expect("main");
    assert!(main_after.dim);
    assert!((main_after.volume - 0.5).abs() < 0.002);
}

#[test]
fn recall_without_console_answer_stays_assumed_and_lists_unconfirmed() {
    let _serial = serialize_shared_link();
    let mut fake = FakeTotalMix::bind();
    let slot = crate::rme_totalmix_osc::bind_test_global_slot(fake.port);
    fake.start(slot.local_port(), Vec::new(), false, false);
    let test_dir = pull_test_db("recall-push-unconfirmed", fake.port);
    crate::rme_totalmix_osc::mark_console_link_slot(true);
    let _pump = SlotPump::start(slot, test_dir.db_path());
    let db = test_dir.db_path();
    let created = create_audio_snapshot(
        &db,
        &AudioSnapshotCreateRequest {
            name: String::from("Silent desk"),
            osc_index: 7,
            capture_current_state: Some(true),
        },
    )
    .expect("snapshot capture should succeed");

    let result = recall_audio_snapshot_with_timing(
        &db,
        &AudioSnapshotRecallRequest {
            snapshot_id: created.snapshot.id.clone(),
        },
        PushTiming {
            confirm_wait_ms: 300,
            poll_ms: 10,
        },
    )
    .expect("recall itself succeeds; the console just never confirms");
    assert!(result.pushed > 20);
    assert_eq!(result.confirmed, 0);
    assert_eq!(result.unconfirmed, result.pushed, "{}", result.summary);
    assert_eq!(result.console_state_confidence, "assumed");
    assert!(result.summary.contains("unconfirmed"), "{}", result.summary);

    let settings = list_settings_by_prefix(&db, APP_SETTINGS_PREFIX).expect("settings should load");
    let snapshot = read_audio_snapshot(&settings);
    assert_eq!(snapshot.console_state_confidence, "assumed");
    assert_eq!(
        snapshot.last_console_sync_reason.as_deref(),
        Some("snapshot")
    );
    assert_eq!(
        snapshot.last_recalled_snapshot_id.as_deref(),
        Some(created.snapshot.id.as_str())
    );
}

#[test]
fn recall_in_simulated_mode_is_app_local_and_aligned() {
    let test_dir = TestDir::new("recall-simulated");
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[
            (
                String::from("app.commissioning.check.audio.status"),
                String::from("passed"),
            ),
            (
                String::from(AUDIO_METERING_SOURCE_KEY),
                String::from(crate::rme_totalmix_osc::SIMULATED_AUDIO_SOURCE),
            ),
        ],
    )
    .expect("settings should persist");
    let db = test_dir.db_path();
    let mut host = channel_request("audio-input-9");
    host.mute = Some(true);
    update_audio_channel(&db, &host).expect("simulated edit should apply");
    let created = create_audio_snapshot(
        &db,
        &AudioSnapshotCreateRequest {
            name: String::from("Sim scene"),
            osc_index: 5,
            capture_current_state: Some(true),
        },
    )
    .expect("snapshot capture should succeed");
    let mut unmute = channel_request("audio-input-9");
    unmute.mute = Some(false);
    update_audio_channel(&db, &unmute).expect("simulated edit should apply");

    let result = recall_audio_snapshot(
        &db,
        &AudioSnapshotRecallRequest {
            snapshot_id: created.snapshot.id.clone(),
        },
    )
    .expect("simulated recall should succeed");
    assert_eq!(result.pushed, 0);
    assert_eq!(result.console_state_confidence, "aligned");
    assert!(
        result.summary.contains("simulated console"),
        "{}",
        result.summary
    );

    let settings = list_settings_by_prefix(&db, APP_SETTINGS_PREFIX).expect("settings should load");
    let snapshot = read_audio_snapshot(&settings);
    assert_eq!(snapshot.console_state_confidence, "aligned");
    assert_eq!(
        snapshot.last_console_sync_reason.as_deref(),
        Some("snapshot")
    );
    assert!(snapshot
        .channels
        .iter()
        .any(|entry| entry.id == "audio-input-9" && entry.mute));
}
