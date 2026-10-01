//! Console link (2026-09 audit remediation, Slice 2) and console pull
//! (Slice 3) integration tests. Split out of `tests.rs` when that file crossed
//! the 2 000-line source guard; the shared `TestDir` helper stays there.

use super::tests::TestDir;
use super::*;
use crate::app_state::APP_SETTINGS_PREFIX;
use crate::storage::{initialize_test_database, list_settings_by_prefix, set_settings_owned};
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
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
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
pub(super) fn serialize_shared_link() -> std::sync::MutexGuard<'static, ()> {
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

pub(super) struct SlotPump {
    stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
    /// Completed pumps: read the slot, service the link, flush to the database.
    cycles: std::sync::Arc<std::sync::atomic::AtomicU64>,
    handle: Option<std::thread::JoinHandle<()>>,
}

impl SlotPump {
    pub(super) fn start(slot: crate::rme_totalmix_osc::GlobalOscSlot, db_path: PathBuf) -> Self {
        let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let cycles = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
        let stop_flag = stop.clone();
        let cycle_count = cycles.clone();
        let handle = std::thread::spawn(move || {
            let mut slot = slot;
            while !stop_flag.load(std::sync::atomic::Ordering::Relaxed) {
                crate::rme_totalmix_osc::pump_global_slot_for_test(
                    &mut slot,
                    "127.0.0.1",
                    &db_path,
                );
                cycle_count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                std::thread::sleep(Duration::from_millis(10));
            }
        });
        Self {
            stop,
            cycles,
            handle: Some(handle),
        }
    }

    /// Returns once `count` more pumps have completed after the call.
    pub(super) fn wait_for_cycles(&self, count: u64) {
        let target = self.cycles.load(std::sync::atomic::Ordering::SeqCst) + count;
        let deadline = std::time::Instant::now() + SETTLE_DEADLINE;
        while self.cycles.load(std::sync::atomic::Ordering::SeqCst) < target {
            assert!(
                std::time::Instant::now() < deadline,
                "the slot pump made no progress for {SETTLE_DEADLINE:?}"
            );
            std::thread::sleep(Duration::from_millis(2));
        }
    }
}

/// How long a settle may take before the test gives up — a guard against a
/// hang, never a timing the test depends on.
pub(super) const SETTLE_DEADLINE: Duration = Duration::from_secs(20);

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
pub(super) fn pull_test_db(label: &str, fake_port: u16) -> TestDir {
    let test_dir = TestDir::new(label);
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
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
    // An earlier flush's write failed (2026-09-23). The pull's own flushes
    // take the mark and write `unknown` before the Sync writes `aligned`, so
    // the Sync still ends aligned and leaves no mark to overturn it. (Set far
    // in the link's future, the mark is never due on its own here.)
    let link = crate::rme_console_link::shared_console_link();
    link.lock().expect("link").mark_reports_lost(u64::MAX / 2);

    let result = sync_audio_console_with_timing(test_dir.db_path().as_path(), fast_pull_timing())
        .expect("the pull should complete against the fake console");
    assert!(result.synced);
    assert!(result.complete);
    assert_eq!(result.console_state_confidence, "aligned");
    assert_eq!(result.connection, "connected");
    assert!(
        !link.lock().expect("link").take_reports_lost(),
        "the pull's flushes took the lost-reports mark before `aligned`"
    );
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

/// TotalMix out of touch, then a Sync (2026-10-01): the Sync's own dump ends
/// the quiet and marks the console link; only the Sync flushes, so its flush
/// writes `assumed` and its `aligned` follows, and no mark is left to
/// overturn it.
#[test]
fn a_sync_whose_dump_ends_a_quiet_still_ends_aligned() {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    let _serial = serialize_shared_link();
    let mut fake = FakeTotalMix::bind();
    let mut slot = crate::rme_totalmix_osc::bind_test_global_slot(fake.port);
    slot.declare_quiet_for_test();
    fake.start(slot.local_port(), studio_dump_script(), false, true);
    let test_dir = pull_test_db("console-pull-after-quiet", fake.port);
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[super::helpers::confidence_setting(
            super::helpers::ConsoleConfidence::Aligned,
        )],
    )
    .expect("confidence should store");
    crate::rme_totalmix_osc::mark_console_link_slot(true);

    // A pump that never flushes: only the Sync's own flush can take the mark.
    let stop = Arc::new(AtomicBool::new(false));
    let marked = Arc::new(AtomicBool::new(false));
    let pump = {
        let stop = stop.clone();
        let marked = marked.clone();
        std::thread::spawn(move || {
            let mut slot = slot;
            while !stop.load(Ordering::Relaxed) {
                crate::rme_totalmix_osc::pump_global_slot_without_flush_for_test(
                    &mut slot,
                    "127.0.0.1",
                );
                let link = crate::rme_console_link::shared_console_link();
                if link.lock().expect("link").out_of_touch_for_test().is_some() {
                    marked.store(true, Ordering::SeqCst);
                }
                std::thread::sleep(Duration::from_millis(5));
            }
        })
    };

    let result = sync_audio_console_with_timing(test_dir.db_path().as_path(), fast_pull_timing())
        .expect("the pull should complete against the fake console");
    stop.store(true, Ordering::Relaxed);
    pump.join().expect("the pump should end");
    assert!(
        marked.load(Ordering::SeqCst),
        "the dump's first datagram marked the console link"
    );
    assert_eq!(result.console_state_confidence, "aligned");
    let link = crate::rme_console_link::shared_console_link();
    assert_eq!(
        link.lock().expect("link").take_out_of_touch(),
        None,
        "the Sync's flush took the mark"
    );
    flush_console_link(test_dir.db_path().as_path()).expect("a later flush should succeed");
    let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    let snapshot = read_audio_snapshot(&settings);
    assert_eq!(snapshot.console_state_confidence, "aligned");
    assert_eq!(snapshot.last_action_status, "succeeded");
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

    // Production readiness S15. Old: quiet_ms 150, timeout_ms 500 — the verdict
    // rested on the fake's 40 ms stream never leaving a 150 ms gap, across two
    // threads; a loaded runner left one three times and the pull completed
    // (run 35356465640: `complete: true`, 21 values). New: a quiet window the
    // timeout cannot reach, so the fake still never goes quiet and the pull
    // cannot see it go quiet either, however the threads are scheduled. The
    // engine's rule under test is unchanged: not quiet by the timeout, with
    // something received, is incomplete (the quiet rule itself is
    // `rme_console_link`'s `is_complete`, tested there). One second for the
    // dump to arrive is a hundred of the pump's cycles.
    let error = sync_audio_console_with_timing(
        test_dir.db_path().as_path(),
        PullTiming {
            quiet_ms: 60_000,
            timeout_ms: 1_000,
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
            assert!(message.contains("Global OSC port"), "{message}");
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
        println!("skipping: set SSE_ENGINE_TEST_ALLOW_CONSOLE_WRITES=1 to let the pull request leave the machine");
        return;
    }
    let _serial = serialize_shared_link();
    let test_dir = TestDir::new("console-pull-live");
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
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
    println!("live pull: {}", result.summary);
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
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");

    let update = |key: ParamKey, value: ConsoleValue| ConsoleUpdate {
        key,
        value,
        adjusted: false,
        confirms_send: false,
        during_load: false,
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
fn a_flush_whose_write_fails_marks_the_desk_unread_for_the_next_write() {
    use crate::rme_console_link::{
        ChannelFlag, ConsoleBus, ConsoleUpdate, ConsoleValue, ParamKey, LOST_REPORTS_RETRY_MS,
    };
    let _link = serialize_shared_link();
    let test_dir = TestDir::new("console-flush-lost");
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[super::helpers::confidence_setting(
            super::helpers::ConsoleConfidence::Aligned,
        )],
    )
    .expect("confidence should store");
    let link = crate::rme_console_link::shared_console_link();
    link.lock().expect("link").queue_for_test(ConsoleUpdate {
        key: ParamKey::ChannelFlag {
            bus: ConsoleBus::Input,
            channel: 8,
            flag: ChannelFlag::Mute,
        },
        value: ConsoleValue::Flag(true),
        adjusted: false,
        confirms_send: false,
        during_load: false,
    });

    // A database the flush cannot open: its folder does not exist.
    let unreachable = test_dir
        .db_path()
        .with_file_name("missing")
        .join("native.sqlite3");
    let failed_at = 10_000;
    assert!(flush_console_link_at(&unreachable, failed_at).is_err());
    {
        let link = link.lock().expect("link");
        assert_eq!(link.queued_count(), 0, "nothing is kept to pile up");
        assert!(
            !link.has_activity_at(failed_at + LOST_REPORTS_RETRY_MS - 1),
            "with nothing else waiting, no retry on every tick"
        );
        // Counted from the failure; the failed open took well under a second.
        assert!(link.has_activity_at(failed_at + LOST_REPORTS_RETRY_MS + 1_000));
    }

    let report = flush_console_link_at(
        test_dir.db_path().as_path(),
        failed_at + LOST_REPORTS_RETRY_MS + 1_000,
    )
    .expect("the next flush should write");
    assert!(report.desk_unread && report.changed());
    let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    assert_eq!(
        read_audio_snapshot(&settings).console_state_confidence,
        "unknown",
        "the desk is unread, so the Console asks for a Sync"
    );
    assert!(
        !link.lock().expect("link").has_activity_at(u64::MAX),
        "the mark is written once"
    );
}

#[test]
fn unconfirmed_sends_downgrade_confidence_to_assumed() {
    use crate::rme_console_link::{ChannelFlag, ConsoleBus, ConsoleValue, ParamKey, PendingSend};
    let test_dir = TestDir::new("console-unconfirmed");
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
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
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
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

// ---------------------------------------------------------------------------
// TotalMix out of touch on remote 4 (the walk of 2026-10-01).
// ---------------------------------------------------------------------------

const OUT_OF_TOUCH_31: crate::rme_console_link::OutOfTouch = crate::rme_console_link::OutOfTouch {
    secs: 31,
    since_start: false,
};

#[test]
fn out_of_touch_makes_a_verified_console_assumed_and_says_for_how_long() {
    let _link = serialize_shared_link();
    let test_dir = TestDir::new("console-out-of-touch");
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[super::helpers::confidence_setting(
            super::helpers::ConsoleConfidence::Aligned,
        )],
    )
    .expect("confidence should store");
    let link = crate::rme_console_link::shared_console_link();
    link.lock()
        .expect("link")
        .mark_out_of_touch(OUT_OF_TOUCH_31);

    let report =
        flush_console_link_at(test_dir.db_path().as_path(), 1_000).expect("the flush should write");
    assert!(report.out_of_touch && report.changed());
    let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    let snapshot = read_audio_snapshot(&settings);
    assert_eq!(snapshot.console_state_confidence, "assumed");
    assert_eq!(snapshot.last_action_status, "failed");
    assert_eq!(
        snapshot.last_action_code.as_deref(),
        Some("AUDIO_CONSOLE_OUT_OF_TOUCH")
    );
    let message = snapshot.last_action_message.unwrap_or_default();
    assert_eq!(
        message,
        "TotalMix was out of touch for 31 s, so a change made there meanwhile may be missing. Press Sync from TotalMix."
    );
    crate::operator_words::assert_operator_words(&message);
    assert!(
        !link.lock().expect("link").has_activity_at(u64::MAX),
        "the mark is written once"
    );
}

#[test]
fn out_of_touch_never_lifts_an_unknown_console() {
    let _link = serialize_shared_link();
    let test_dir = TestDir::new("console-out-of-touch-unknown");
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
    let link = crate::rme_console_link::shared_console_link();
    link.lock()
        .expect("link")
        .mark_out_of_touch(OUT_OF_TOUCH_31);

    let report = flush_console_link_at(test_dir.db_path().as_path(), 1_000)
        .expect("the flush should succeed");
    assert!(!report.out_of_touch);
    assert!(!report.changed(), "an unknown console stays as it is");
    let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    let snapshot = read_audio_snapshot(&settings);
    assert_eq!(snapshot.console_state_confidence, "unknown");
    assert_ne!(snapshot.last_action_status, "failed");
    assert!(!link.lock().expect("link").has_activity_at(u64::MAX));
}

#[test]
fn out_of_touch_with_a_desk_this_flush_makes_unknown_is_not_written() {
    let _link = serialize_shared_link();
    let test_dir = TestDir::new("console-out-of-touch-unread");
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[super::helpers::confidence_setting(
            super::helpers::ConsoleConfidence::Aligned,
        )],
    )
    .expect("confidence should store");
    let link = crate::rme_console_link::shared_console_link();
    link.lock()
        .expect("link")
        .mark_out_of_touch(OUT_OF_TOUCH_31);
    link.lock().expect("link").mark_reports_lost(0);

    let report = flush_console_link_at(test_dir.db_path().as_path(), u64::MAX / 2)
        .expect("the flush should write");
    assert!(report.desk_unread && !report.out_of_touch);
    let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    let snapshot = read_audio_snapshot(&settings);
    assert_eq!(snapshot.console_state_confidence, "unknown");
    assert_ne!(
        snapshot.last_action_code.as_deref(),
        Some("AUDIO_CONSOLE_OUT_OF_TOUCH"),
        "no out-of-touch sentence over an unread desk"
    );
}

#[test]
fn out_of_touch_since_the_start_has_a_sentence_of_its_own() {
    let sentence = out_of_touch_sentence(crate::rme_console_link::OutOfTouch {
        secs: 42,
        since_start: true,
    });
    assert_eq!(
        sentence,
        "TotalMix answered only 42 s after Studio Control started, so a change made there before may be missing. Press Sync from TotalMix."
    );
    crate::operator_words::assert_operator_words(&sentence);
}

#[test]
fn out_of_touch_reads_in_seconds_minutes_and_hours() {
    assert_eq!(out_of_touch_words(31), "31 s");
    assert_eq!(out_of_touch_words(119), "119 s");
    assert_eq!(out_of_touch_words(120), "2 min");
    assert_eq!(out_of_touch_words(7_199), "119 min");
    assert_eq!(out_of_touch_words(7_200), "2 h");
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
        // The support tests moved to their own file (Slice 7); the restore
        // round trip seeds the key to prove a restore rolls it back.
        "support/tests.rs",
    ];
    // Every path that moves confidence must go through the single writer.
    let required_writers = [
        "audio/sync.rs",
        "audio/load.rs",
        "audio/settings.rs",
        "audio/console_link.rs",
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
// A console model on loopback (Slice 4's) remembers what the app
// wrote and answers read-backs from that memory, in dB, like the desk does.
// ---------------------------------------------------------------------------

pub(super) struct ConsoleModel {
    socket: Option<std::net::UdpSocket>,
    pub(super) port: u16,
    stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
    handle: Option<std::thread::JoinHandle<()>>,
}

impl ConsoleModel {
    pub(super) fn bind() -> Self {
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

    pub(super) fn start(&mut self, reply_to_port: u16) {
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
                        // The desk reports its talkback with the rest; the app
                        // reads past it (D26).
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

pub(super) fn channel_request(channel_id: &str) -> AudioChannelUpdateRequest {
    AudioChannelUpdateRequest {
        channel_id: String::from(channel_id),
        mix_target_id: None,
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

pub(super) fn mix_target_request(mix_target_id: &str) -> AudioMixTargetUpdateRequest {
    AudioMixTargetUpdateRequest {
        mix_target_id: String::from(mix_target_id),
        volume: None,
        mute: None,
        dim: None,
        mono: None,
    }
}

// 2026-09 production readiness, Slice 11 (F30): a switch thrown at TotalMix
// enters the app through this flush, and the action log names the console.
// The rows are written in the transaction that writes the state — this runs
// on the metering thread, where a second wait for the disk shows in the
// meters — and a fader, a gain and a value that did not change leave none.
#[test]
fn console_changes_record_source_console() {
    use crate::rme_console_link::{
        ChannelFlag, ConsoleBus, ConsoleUpdate, ConsoleValue, ControlRoomFunction, ParamKey,
    };
    let test_dir = TestDir::new("console-action-log");
    let db_path = test_dir.db_path();
    initialize_test_database(db_path.as_path()).expect("database should initialize");
    let rows = || {
        crate::action_log::list_recent_actions(db_path.as_path(), 20)
            .expect("the action log should list")
            .into_iter()
            .map(|entry| (entry.source, entry.action, entry.detail))
            .collect::<Vec<_>>()
    };
    let update = |key: ParamKey, value: ConsoleValue| ConsoleUpdate {
        key,
        value,
        adjusted: false,
        confirms_send: false,
        during_load: false,
    };
    let settings = list_settings_by_prefix(db_path.as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    let snapshot = read_audio_snapshot(&settings);
    let input_name = snapshot
        .channels
        .iter()
        .find(|channel| channel.id == "audio-input-9")
        .expect("input 9")
        .name
        .clone();
    let main_name = snapshot
        .mix_targets
        .iter()
        .find(|target| target.id == "audio-mix-main")
        .expect("main out")
        .name
        .clone();

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
            ConsoleValue::Db(-6.0),
        ),
        update(
            ParamKey::OutputVolume { output: 8 },
            ConsoleValue::Db(-16.6),
        ),
        update(
            ParamKey::ControlRoom(ControlRoomFunction::Dim),
            ConsoleValue::Flag(true),
        ),
    ];
    let report = apply_console_activity(db_path.as_path(), &updates, &[], false)
        .expect("the flush should apply");
    assert!(report.applied >= 2, "the switches changed stored state");
    assert_eq!(
        rows(),
        vec![
            (
                String::from("console"),
                String::from("dim"),
                format!("Dim on at TotalMix: {main_name}")
            ),
            (
                String::from("console"),
                String::from("mute"),
                format!("Mute on at TotalMix: {input_name}")
            ),
        ],
        "the two switches; the gain, the fader and the volume are rides"
    );

    // The same values again change nothing and leave nothing.
    let again = apply_console_activity(db_path.as_path(), &updates, &[], false)
        .expect("the flush should apply");
    assert_eq!(again.applied, 0, "nothing changed the second time");
    assert_eq!(rows().len(), 2);
}

// 2026-10-01: the Console's channel and output names follow TotalMix. A name
// TotalMix reports is written like any change made there, only when it
// differs, and leaves no row in Recent actions.
#[test]
fn channel_names_from_totalmix_are_stored_and_shown() {
    use crate::rme_console_link::{ConsoleBus, ConsoleUpdate, ConsoleValue, ParamKey};
    let test_dir = TestDir::new("console-names");
    let db_path = test_dir.db_path();
    initialize_test_database(db_path.as_path()).expect("database should initialize");
    let name = |bus: ConsoleBus, channel: usize, value: &str| ConsoleUpdate {
        key: ParamKey::ChannelName { bus, channel },
        value: ConsoleValue::Text(String::from(value)),
        adjusted: false,
        confirms_send: false,
        during_load: false,
    };
    let long = "N".repeat(51);
    let updates = vec![
        name(ConsoleBus::Input, 8, "  Host Mic  "),
        name(ConsoleBus::Playback, 2, "Music"),
        name(ConsoleBus::Output, 8, "Guest Cans"),
        // Already the name the Console shows: nothing to write.
        name(ConsoleBus::Output, 10, "Phones 2"),
        // Not written: the right side of a stereo pair, a channel and outputs
        // the app does not model, and names the app does not keep.
        name(ConsoleBus::Playback, 3, "Music R"),
        name(ConsoleBus::Input, 40, "MADI 41"),
        name(ConsoleBus::Output, 9, "Guest Cans R"),
        name(ConsoleBus::Output, 4, "AN 5"),
        name(ConsoleBus::Input, 0, "   "),
        name(ConsoleBus::Input, 1, &long),
        name(ConsoleBus::Input, 2, "Line\u{7}Bell"),
    ];
    let names = |snapshot: &AudioSnapshot| {
        snapshot
            .channels
            .iter()
            .map(|entry| (entry.id.clone(), entry.name.clone()))
            .chain(
                snapshot
                    .mix_targets
                    .iter()
                    .map(|entry| (entry.id.clone(), entry.name.clone())),
            )
            .collect::<HashMap<String, String>>()
    };
    let before = names(&read_audio_snapshot(
        &list_settings_by_prefix(db_path.as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load"),
    ));
    let report = apply_console_activity(db_path.as_path(), &updates, &[], false)
        .expect("the names should apply");
    assert_eq!(report.applied, 3);
    assert!(report.changed());

    let settings = list_settings_by_prefix(db_path.as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    let mut expected = before.clone();
    expected.insert(String::from("audio-input-9"), String::from("Host Mic"));
    expected.insert(String::from("audio-playback-3-4"), String::from("Music"));
    expected.insert(
        String::from("audio-mix-phones-a"),
        String::from("Guest Cans"),
    );
    assert_eq!(
        names(&read_audio_snapshot(&settings)),
        expected,
        "the three names, trimmed; every other name as it was"
    );
    assert_eq!(before["audio-mix-phones-b"], "Phones 2");
    let stored_targets: HashMap<String, StoredAudioMixTargetState> = serde_json::from_str(
        settings
            .get(AUDIO_MIX_TARGET_STATE_KEY)
            .expect("the outputs' state is written"),
    )
    .expect("the outputs' state reads");
    assert_eq!(
        stored_targets["audio-mix-phones-a"].name.as_deref(),
        Some("Guest Cans")
    );
    assert!(
        crate::action_log::list_recent_actions(db_path.as_path(), 20)
            .expect("the action log should list")
            .is_empty(),
        "a name is not a row in Recent actions"
    );

    // The next dump repeats every name: nothing is written, nothing reported.
    let again = apply_console_activity(db_path.as_path(), &updates, &[], false)
        .expect("the names should apply");
    assert_eq!(again.applied, 0);
    assert!(!again.changed());

    // An edit of the output keeps the name TotalMix gave it.
    set_settings_owned(
        db_path.as_path(),
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
    .expect("the simulated console should be set");
    let mut phones = mix_target_request("audio-mix-phones-a");
    phones.mute = Some(true);
    let edited = update_audio_mix_target(db_path.as_path(), &phones).expect("the edit applies");
    assert!(edited.mute);
    assert_eq!(edited.name, "Guest Cans");
}

#[test]
fn a_changed_snapshot_slot_is_reported_by_the_flush_and_shown() {
    use crate::rme_console_link::{ConsoleBus, ConsoleUpdate, ConsoleValue, ParamKey};
    let _link = serialize_shared_link();
    let test_dir = TestDir::new("console-slots");
    let db_path = test_dir.db_path();
    initialize_test_database(db_path.as_path()).expect("database should initialize");
    let link = crate::rme_console_link::shared_console_link();
    let report_slot = |address: &str, value: f32| {
        link.lock().expect("link").ingest(
            &rosc::OscMessage {
                addr: String::from(address),
                args: vec![rosc::OscType::Float(value)],
            },
            crate::rme_console_link::link_now_ms(),
        );
    };
    let active = || {
        let settings = list_settings_by_prefix(db_path.as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load");
        // The first of TotalMix's slots that is loaded, changed or not.
        read_audio_snapshot(&settings)
            .console_snapshots
            .slots
            .iter()
            .find(|slot| slot.state == "active" || slot.state == "changed")
            .map(|slot| slot.slot)
    };
    let flush = || {
        flush_console_link_at(db_path.as_path(), crate::rme_console_link::link_now_ms())
            .expect("the flush should succeed")
    };

    assert_eq!(active(), None);
    report_slot("/snapshot/load/1", 0.0);
    report_slot("/snapshot/load/3", 2.0);
    let report = flush();
    assert!(report.slots_changed && report.changed());
    assert_eq!(report.applied, 0, "nothing is written for a slot");
    assert_eq!(active(), Some(3));

    // Changed on the desk since it was loaded: still the loaded one.
    report_slot("/snapshot/load/3", 3.0);
    assert!(flush().slots_changed);
    assert_eq!(active(), Some(3));

    // The same report again changes nothing, and neither does a name the
    // Console already shows.
    report_slot("/snapshot/load/3", 3.0);
    link.lock().expect("link").queue_for_test(ConsoleUpdate {
        key: ParamKey::ChannelName {
            bus: ConsoleBus::Output,
            channel: 0,
        },
        value: ConsoleValue::Text(String::from("Main Out")),
        adjusted: false,
        confirms_send: false,
        during_load: false,
    });
    assert!(!flush().changed());

    report_slot("/snapshot/load/3", 0.0);
    assert!(flush().slots_changed);
    assert_eq!(active(), None);
}
