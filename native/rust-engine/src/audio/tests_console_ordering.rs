//! A change made at TotalMix and the app's own writes (2026-09-22, the ordering
//! production readiness Slice 15 Notes (b) pointed at). The metering thread
//! drains what the desk reported and writes it under `AUDIO_STATE_LOCK` a
//! moment later; a recall or an edit writes the app's state under the same
//! lock. A report that was waiting when the app wrote must not be the last
//! word once the desk has confirmed the app's value, and the desk's
//! confirmation of an older value must not be the last word over a newer one.
//! Split out of `tests_console_link.rs`, whose loopback console model and
//! helpers these tests use.

use super::tests::TestDir;
use super::tests_console_link::{
    channel_request, mix_target_request, pull_test_db, serialize_shared_link, ConsoleModel,
    SETTLE_DEADLINE,
};
use super::*;
use crate::app_state::APP_SETTINGS_PREFIX;
use crate::storage::{initialize_test_database, list_settings_by_prefix, set_settings_owned};
use std::time::Duration;

/// The metering thread's pump without its flush: the console's replies are
/// ingested and the read-backs go out, but nothing the console said reaches the
/// database unless the code under test flushes it.
struct ReadbackPump {
    stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
    handle: Option<std::thread::JoinHandle<()>>,
}

impl ReadbackPump {
    fn start(slot: crate::rme_totalmix_osc::GlobalOscSlot) -> Self {
        let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let stop_flag = stop.clone();
        let handle = std::thread::spawn(move || {
            let mut slot = slot;
            while !stop_flag.load(std::sync::atomic::Ordering::Relaxed) {
                crate::rme_totalmix_osc::pump_global_slot_without_flush_for_test(
                    &mut slot,
                    "127.0.0.1",
                );
                std::thread::sleep(Duration::from_millis(5));
            }
        });
        Self {
            stop,
            handle: Some(handle),
        }
    }
}

impl Drop for ReadbackPump {
    fn drop(&mut self) {
        self.stop.store(true, std::sync::atomic::Ordering::Relaxed);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

/// What TotalMix reports when somebody changes `address` at the desk: the
/// console model takes the value, and the report enters the shared link the way
/// the metering thread's read would put it there.
fn change_at_totalmix(console_port: u16, address: &str, value: f32) {
    let socket = std::net::UdpSocket::bind("127.0.0.1:0").expect("sender should bind");
    let packet = rosc::OscPacket::Message(rosc::OscMessage {
        addr: String::from(address),
        args: vec![rosc::OscType::Float(value)],
    });
    let bytes = rosc::encoder::encode(&packet).expect("message should encode");
    socket
        .send_to(&bytes, ("127.0.0.1", console_port))
        .expect("the console model should take the change");
    let classification = crate::rme_console_link::shared_console_link()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .ingest(
            &rosc::OscMessage {
                addr: String::from(address),
                args: vec![rosc::OscType::Float(value)],
            },
            crate::rme_console_link::link_now_ms(),
        );
    assert_eq!(
        classification,
        crate::rme_console_link::Classification::External,
        "a change nobody in the app asked for"
    );
}

fn stored_channel(db: &std::path::Path, channel_id: &str) -> AudioChannelSnapshot {
    let settings = list_settings_by_prefix(db, APP_SETTINGS_PREFIX).expect("settings should load");
    read_audio_snapshot(&settings)
        .channels
        .into_iter()
        .find(|entry| entry.id == channel_id)
        .expect("channel")
}

#[test]
fn a_change_at_totalmix_reported_before_a_recall_does_not_outlive_it() {
    let _serial = serialize_shared_link();
    let mut console = ConsoleModel::bind();
    let slot = crate::rme_totalmix_osc::bind_test_global_slot(console.port);
    console.start(slot.local_port());
    let test_dir = pull_test_db("recall-after-a-desk-change", console.port);
    crate::rme_totalmix_osc::mark_console_link_slot(true);
    let db = test_dir.db_path();

    let created = create_audio_snapshot(
        &db,
        &AudioSnapshotCreateRequest {
            name: String::from("Talk"),
            osc_index: 5,
            capture_current_state: Some(true),
        },
    )
    .expect("snapshot capture should succeed");
    assert!(
        !stored_channel(&db, "audio-input-9").mute,
        "Host starts unmuted"
    );

    // Somebody mutes Host at TotalMix. The desk reports it and the report waits
    // in the link for the next flush — the recall comes first.
    change_at_totalmix(console.port, "/input/8/mute", 1.0);

    // The pump answers the read-backs; only the recall flushes.
    let _pump = ReadbackPump::start(slot);
    let result = recall_audio_snapshot_with_timing(
        &db,
        &AudioSnapshotRecallRequest {
            snapshot_id: created.snapshot.id.clone(),
        },
        PushTiming {
            confirm_wait_ms: 3_000,
            poll_ms: 10,
        },
    )
    .expect("recall should push and confirm");
    assert_eq!(result.unconfirmed, 0, "{}", result.summary);
    assert_eq!(result.confirmed, result.pushed, "{}", result.summary);
    assert_eq!(result.console_state_confidence, "aligned");

    // The recall unmuted Host at the desk and the desk confirmed it, so the app
    // says what the desk has: unmuted, and aligned.
    assert!(
        !stored_channel(&db, "audio-input-9").mute,
        "the desk has Host unmuted after the recall; the app must not show the mute it replaced"
    );

    // Recent actions keep the mute that happened at TotalMix; the unmute was
    // the recall's, so no row says it happened at TotalMix.
    let console_rows: Vec<String> = crate::action_log::list_recent_actions(&db, 50)
        .expect("the action log should list")
        .into_iter()
        .filter(|entry| entry.source == "console")
        .map(|entry| entry.detail)
        .collect();
    assert!(
        console_rows
            .iter()
            .any(|detail| detail.starts_with("Mute on at TotalMix")),
        "{console_rows:?}"
    );
    assert!(
        !console_rows
            .iter()
            .any(|detail| detail.starts_with("Mute off at TotalMix")),
        "{console_rows:?}"
    );
}

/// Until every send the shared link tracks has been confirmed, adjusted or
/// expired and every read-back has had its replies (the pump services it).
fn wait_until_link_quiet() {
    let deadline = std::time::Instant::now() + SETTLE_DEADLINE;
    loop {
        let quiet = {
            let link = crate::rme_console_link::shared_console_link();
            let guard = link.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            guard.pending_count() == 0 && guard.outstanding_count() == 0
        };
        if quiet {
            return;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "the console link did not go quiet within {SETTLE_DEADLINE:?}"
        );
        std::thread::sleep(Duration::from_millis(2));
    }
}

#[test]
fn a_change_at_totalmix_reported_before_an_edit_does_not_outlive_it() {
    let _serial = serialize_shared_link();
    let mut console = ConsoleModel::bind();
    let slot = crate::rme_totalmix_osc::bind_test_global_slot(console.port);
    console.start(slot.local_port());
    let test_dir = pull_test_db("edit-after-a-desk-change", console.port);
    crate::rme_totalmix_osc::mark_console_link_slot(true);
    let db = test_dir.db_path();
    let _pump = ReadbackPump::start(slot);

    // Host's gain at 30 dB in the app and at the desk.
    let mut host = channel_request("audio-input-9");
    host.gain = Some(30);
    update_audio_channel(&db, &host).expect("the first edit should send");
    wait_until_link_quiet();
    flush_console_link(&db).expect("flush");
    assert_eq!(stored_channel(&db, "audio-input-9").gain, 30);

    // Somebody turns it to 40 dB at TotalMix; the report waits for the next
    // flush. The operator sets 45 dB in the app, and the desk confirms it.
    change_at_totalmix(console.port, "/input/8/gain", 40.0);
    host.gain = Some(45);
    update_audio_channel(&db, &host).expect("the second edit should send");
    wait_until_link_quiet();

    // The metering thread's next flush.
    flush_console_link(&db).expect("flush");
    assert_eq!(
        stored_channel(&db, "audio-input-9").gain,
        45,
        "the desk took 45 dB after the 40 it reported; the app must say 45"
    );
}

#[test]
fn a_flush_takes_the_console_reports_only_when_it_can_write_them() {
    let _serial = serialize_shared_link();
    let test_dir = TestDir::new("flush-under-the-state-lock");
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
    let db = test_dir.db_path();

    // A write of the app's audio state is under way (a recall's, an edit's).
    let writing = super::helpers::lock_audio_state();
    crate::rme_console_link::shared_console_link()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .ingest(
            &rosc::OscMessage {
                addr: String::from("/input/8/mute"),
                args: vec![rosc::OscType::Float(1.0)],
            },
            crate::rme_console_link::link_now_ms(),
        );
    let flush_db = db.clone();
    let flush = std::thread::spawn(move || flush_console_link(&flush_db).expect("flush"));

    // A flush that took the report out of the link now would write it after
    // the app's write, whatever that write said; another flush could come in
    // between. It must wait for the write, with the report still in the link.
    std::thread::sleep(Duration::from_millis(300));
    let still_queued = crate::rme_console_link::shared_console_link()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .queued_count();
    drop(writing);
    let report = flush.join().expect("the flush thread");
    assert_eq!(
        still_queued, 1,
        "the flush took the report while the app was writing"
    );
    assert_eq!(report.applied, 1);
    assert!(stored_channel(&db, "audio-input-9").mute);
}

// The review of the fix above (2026-09-22) found that a confirmation queued for
// the app's older value could be written over a newer write of the same
// parameter, and that a fader's confirmation was never a no-op: the value
// travels as a 32-bit float.

/// A test database whose sends go to a local socket nobody answers from.
fn quiet_desk_db(label: &str) -> (TestDir, std::net::UdpSocket) {
    let sink = std::net::UdpSocket::bind("127.0.0.1:0").expect("sink should bind");
    let port = sink.local_addr().expect("sink address").port();
    let test_dir = pull_test_db(label, port);
    crate::rme_totalmix_osc::mark_console_link_slot(true);
    (test_dir, sink)
}

/// The desk's reply, as the metering thread's read would ingest it.
fn desk_reports(address: &str, value: f32) -> crate::rme_console_link::Classification {
    crate::rme_console_link::shared_console_link()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .ingest(
            &rosc::OscMessage {
                addr: String::from(address),
                args: vec![rosc::OscType::Float(value)],
            },
            crate::rme_console_link::link_now_ms(),
        )
}

#[test]
fn a_confirmation_of_an_older_send_does_not_overwrite_a_newer_one() {
    let _serial = serialize_shared_link();
    let (test_dir, _sink) = quiet_desk_db("older-confirmation");
    let db = test_dir.db_path();

    // A dial detent sets Host's gain to 31 dB, and the desk confirms it; the
    // confirmation waits for the next flush.
    let mut host = channel_request("audio-input-9");
    host.gain = Some(31);
    update_audio_channel(&db, &host).expect("the first detent should send");
    assert_eq!(
        desk_reports("/input/8/gain", 31.0),
        crate::rme_console_link::Classification::Confirmed
    );
    // The next detent sets 32 dB before that flush.
    host.gain = Some(32);
    update_audio_channel(&db, &host).expect("the second detent should send");

    flush_console_link(&db).expect("flush");
    assert_eq!(
        stored_channel(&db, "audio-input-9").gain,
        32,
        "the desk's confirmation of 31 must not be written over the 32 sent after it"
    );
}

#[test]
fn the_desk_confirming_the_apps_own_level_writes_nothing() {
    let _serial = serialize_shared_link();
    let (test_dir, _sink) = quiet_desk_db("own-level-confirmed");
    let db = test_dir.db_path();

    let mut host = channel_request("audio-input-9");
    host.fader = Some(0.62);
    update_audio_channel(&db, &host).expect("the edit should send");
    // The desk answers the read-back in dB, as `/sendsubmix` does.
    let db_value = fader_curve::fader_lin_to_db(0.62).expect("0.62 is audible") as f32;
    assert_eq!(
        desk_reports("/mix/in/8/0/fader", db_value),
        crate::rme_console_link::Classification::Confirmed
    );

    let report = flush_console_link(&db).expect("flush");
    assert_eq!(report.applied, 0, "nothing changed, so nothing is written");
    let stored = stored_channel(&db, "audio-input-9");
    assert_eq!(stored.fader, 0.62);
    assert_eq!(stored.mix_levels["audio-mix-main"], 0.62);
}

#[test]
fn a_talkback_refusal_is_acted_on_though_the_hold_has_sent_talkback_again() {
    use crate::rme_console_link::{
        link_now_ms, shared_console_link, Classification, READBACK_DELAY_MS,
    };
    let _serial = serialize_shared_link();
    let test_dir = TestDir::new("talkback-refused-resent");
    let db = test_dir.db_path();
    initialize_test_database(&db).expect("database should initialize");
    set_settings_owned(
        &db,
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
    .expect("ready audio settings should persist");
    let mut request = mix_target_request("audio-mix-main");
    request.talkback = Some(true);
    update_audio_mix_target(&db, &request).expect("talkback on");
    assert!(talkback_hold_deadline(&db, "audio-mix-main").is_some());

    // The desk answers the app's talkback with "off" (no talkback channel
    // assigned), and before the next flush the hold's heartbeat sends it again.
    {
        let link = shared_console_link();
        let mut link = link.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let talkback = || {
            vec![(
                String::from("/controlroom/talkback"),
                rosc::OscType::Float(1.0),
            )]
        };
        let sent = link_now_ms();
        link.register_outgoing(&talkback(), sent);
        link.due_readbacks(sent + READBACK_DELAY_MS);
        assert_eq!(
            link.ingest(
                &rosc::OscMessage {
                    addr: String::from("/controlroom/talkback"),
                    args: vec![rosc::OscType::Float(0.0)],
                },
                sent + READBACK_DELAY_MS + 30,
            ),
            Classification::Adjusted
        );
        link.register_outgoing(&talkback(), sent + READBACK_DELAY_MS + 40);
    }

    let report = flush_console_link(&db).expect("flush");
    assert!(report.changed(), "the screen is told");
    let settings = list_settings_by_prefix(&db, APP_SETTINGS_PREFIX).expect("settings should load");
    let snapshot = read_audio_snapshot(&settings);
    assert_eq!(
        snapshot.last_action_code.as_deref(),
        Some("AUDIO_TALKBACK_REFUSED")
    );
    assert!(
        talkback_hold_deadline(&db, "audio-mix-main").is_none(),
        "the hold is dropped, so the watchdog has nothing to release"
    );
}

#[test]
fn a_flush_writes_an_expired_send_or_a_lost_connection_on_its_own() {
    use crate::rme_console_link::{link_now_ms, shared_console_link, CONFIRM_TIMEOUT_MS};
    let _serial = serialize_shared_link();
    let test_dir = TestDir::new("flush-expiry-and-loss");
    let db = test_dir.db_path();
    initialize_test_database(&db).expect("database should initialize");
    let confidence = || {
        let settings = list_settings_by_prefix(&db, APP_SETTINGS_PREFIX).expect("settings");
        read_audio_snapshot(&settings)
    };

    // A send the desk never confirmed, and nothing else in the link.
    {
        let link = shared_console_link();
        let mut link = link.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let sent = link_now_ms();
        link.register_outgoing(
            &[(String::from("/input/8/mute"), rosc::OscType::Float(1.0))],
            sent,
        );
        link.tick(sent + CONFIRM_TIMEOUT_MS);
    }
    let report = flush_console_link(&db).expect("flush");
    assert_eq!(report.unconfirmed, 1);
    let after_expiry = confidence();
    assert_eq!(after_expiry.console_state_confidence, "assumed");
    assert_eq!(
        after_expiry.last_action_code.as_deref(),
        Some("AUDIO_CONSOLE_UNCONFIRMED")
    );

    // The desk drops the connection, and nothing else in the link.
    desk_reports("/status/connection", 1.0);
    desk_reports("/status/connection", 0.0);
    let report = flush_console_link(&db).expect("flush");
    assert!(report.connection_lost);
    assert_eq!(confidence().console_state_confidence, "unknown");
}

#[test]
fn a_change_at_totalmix_the_app_overrides_before_the_flush_is_still_a_row() {
    // The metering thread flushes every 100 ms, sooner than the read-back of
    // the app's send (120 ms after it) can confirm it. The change at TotalMix
    // is then replaced, not written, and it is still a row in Recent actions.
    let _serial = serialize_shared_link();
    let (test_dir, _sink) = quiet_desk_db("overridden-desk-change");
    let db = test_dir.db_path();

    // Somebody mutes Host at TotalMix; the operator unmutes it in the app
    // before the next flush.
    assert_eq!(
        desk_reports("/input/8/mute", 1.0),
        crate::rme_console_link::Classification::External
    );
    let mut host = channel_request("audio-input-9");
    host.mute = Some(false);
    update_audio_channel(&db, &host).expect("the unmute should send");

    let report = flush_console_link(&db).expect("flush");
    assert_eq!(report.applied, 0, "the desk takes the app's value");
    assert!(!stored_channel(&db, "audio-input-9").mute);
    let console_rows: Vec<String> = crate::action_log::list_recent_actions(&db, 20)
        .expect("the action log should list")
        .into_iter()
        .filter(|entry| entry.source == "console")
        .map(|entry| entry.detail)
        .collect();
    assert!(
        console_rows
            .iter()
            .any(|detail| detail.starts_with("Mute on at TotalMix")),
        "{console_rows:?}"
    );
}
