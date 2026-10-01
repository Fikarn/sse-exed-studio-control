//! TotalMix's own snapshots, loaded through the console link (2026-10-01). A
//! desk on loopback holds a mix for each slot: `/snapshot/load/N` with 1
//! switches to that slot's mix, and `/sendall` dumps the mix it holds. It can
//! report the load on `/snapshot/load/N` as TotalMix does, or keep quiet, as
//! TotalMix may towards the remote that sent it (read on the walk).

use super::tests_console_link::{pull_test_db, serialize_shared_link, SlotPump};
use super::*;
use crate::app_state::APP_SETTINGS_PREFIX;
use crate::storage::list_settings_by_prefix;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Clone)]
enum DeskValue {
    Number(f32),
    Text(&'static str),
}

use DeskValue::{Number, Text};

/// One slot's mix, as `/sendall` dumps it.
type DeskMix = Vec<(&'static str, DeskValue)>;

struct SnapshotDesk {
    socket: Option<std::net::UdpSocket>,
    port: u16,
    stop: Arc<AtomicBool>,
    /// Every address the desk was sent, with its first number.
    received: Arc<Mutex<Vec<(String, f32)>>>,
    handle: Option<std::thread::JoinHandle<()>>,
}

impl SnapshotDesk {
    fn bind() -> Self {
        let socket = std::net::UdpSocket::bind("127.0.0.1:0").expect("the desk should bind");
        socket
            .set_read_timeout(Some(Duration::from_millis(20)))
            .expect("read timeout should apply");
        let port = socket.local_addr().expect("desk address").port();
        Self {
            socket: Some(socket),
            port,
            stop: Arc::new(AtomicBool::new(false)),
            received: Arc::new(Mutex::new(Vec::new())),
            handle: None,
        }
    }

    /// Slot 1 is loaded at the start. `mixes[n - 1]` is slot n's mix.
    /// `reports_loads`: the desk says `/snapshot/load/N 2` (and 0 for the slot
    /// it left) when it loads. `answers_dumps`: it answers `/sendall`.
    fn start(
        &mut self,
        reply_to_port: u16,
        mixes: Vec<DeskMix>,
        reports_loads: bool,
        answers_dumps: bool,
    ) {
        let socket = self.socket.take().expect("desk socket");
        let stop = self.stop.clone();
        let received = self.received.clone();
        self.handle = Some(std::thread::spawn(move || {
            let send = |address: &str, value: &DeskValue| {
                let arg = match value {
                    Number(number) => rosc::OscType::Float(*number),
                    Text(text) => rosc::OscType::String(String::from(*text)),
                };
                let packet = rosc::OscPacket::Message(rosc::OscMessage {
                    addr: String::from(address),
                    args: vec![arg],
                });
                if let Ok(bytes) = rosc::encoder::encode(&packet) {
                    let _ = socket.send_to(&bytes, ("127.0.0.1", reply_to_port));
                }
            };
            let mut active = 1usize;
            let mut buffer = [0u8; 2048];
            while !stop.load(Ordering::Relaxed) {
                let Ok((len, _)) = socket.recv_from(&mut buffer) else {
                    continue;
                };
                let Ok((_, rosc::OscPacket::Message(message))) =
                    rosc::decoder::decode_udp(&buffer[..len])
                else {
                    continue;
                };
                let value = match message.args.first() {
                    Some(rosc::OscType::Float(value)) => *value,
                    _ => f32::NAN,
                };
                received
                    .lock()
                    .expect("received")
                    .push((message.addr.clone(), value));
                if let Some(slot) = message
                    .addr
                    .strip_prefix("/snapshot/load/")
                    .and_then(|slot| slot.parse::<usize>().ok())
                {
                    // TotalMix takes only 1 there.
                    if value >= 0.5 && (1..=mixes.len()).contains(&slot) {
                        let left = active;
                        active = slot;
                        if reports_loads {
                            if left != slot {
                                send(&format!("/snapshot/load/{left}"), &Number(0.0));
                            }
                            send(&format!("/snapshot/load/{slot}"), &Number(2.0));
                        }
                    }
                } else if message.addr == "/sendall" && answers_dumps {
                    send("/status/connection", &Number(1.0));
                    for (address, value) in &mixes[active - 1] {
                        send(address, value);
                    }
                }
            }
        }));
    }

    fn received(&self) -> Vec<(String, f32)> {
        self.received.lock().expect("received").clone()
    }
}

impl Drop for SnapshotDesk {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

fn load_timing() -> LoadTiming {
    LoadTiming {
        report_wait_ms: 400,
        poll_ms: 5,
        pull: PullTiming {
            quiet_ms: 120,
            timeout_ms: 1_500,
            poll_ms: 5,
        },
    }
}

/// Slot 1: Host unmuted, named as the app names it. Slot 3: Host muted and
/// named "Boom" at TotalMix, Main a little lower.
fn two_mixes() -> Vec<DeskMix> {
    let slot_one = vec![
        ("/input/8/mute", Number(0.0)),
        ("/output/0/volume", Number(0.0)),
    ];
    let slot_three = vec![
        ("/input/8/mute", Number(1.0)),
        ("/input/8/name", Text("Boom")),
        ("/output/0/volume", Number(-6.0)),
        ("/output/0/name", Text("Main")),
    ];
    vec![slot_one.clone(), slot_one.clone(), slot_three, slot_one]
}

fn audio_state(db: &std::path::Path) -> AudioSnapshot {
    let settings = list_settings_by_prefix(db, APP_SETTINGS_PREFIX).expect("settings should load");
    read_audio_snapshot(&settings)
}

fn slot_states(snapshot: &AudioSnapshot) -> Vec<String> {
    snapshot
        .console_snapshots
        .slots
        .iter()
        .map(|slot| slot.state.clone())
        .collect()
}

fn loads_sent(desk: &SnapshotDesk) -> Vec<(String, f32)> {
    desk.received()
        .into_iter()
        .filter(|(address, _)| address.starts_with("/snapshot/"))
        .collect()
}

#[test]
fn a_load_sends_one_datagram_and_the_desk_is_read_back() {
    let _serial = serialize_shared_link();
    let mut desk = SnapshotDesk::bind();
    let slot = crate::rme_totalmix_osc::bind_test_global_slot(desk.port);
    desk.start(slot.local_port(), two_mixes(), true, true);
    let test_dir = pull_test_db("load-reported", desk.port);
    crate::rme_totalmix_osc::mark_console_link_slot(true);
    let db = test_dir.db_path();
    let pump = SlotPump::start(slot, db.clone());

    let loaded = load_audio_console_snapshot_with(
        &db,
        &AudioSnapshotLoadRequest { slot: 3 },
        load_timing(),
        true,
    )
    .expect("the load should go out and the desk be read back");
    assert!(loaded.loaded);
    assert_eq!(loaded.slot, 3);
    assert!(loaded.total_mix_reported, "the desk reported the load");
    assert_eq!(loaded.console_state_confidence, "aligned");
    assert!(loaded.pulled_values > 0, "{loaded:?}");
    assert!(loaded.summary.contains("in TotalMix"), "{}", loaded.summary);

    // One load, to slot 3, with 1.0; nothing is ever stored.
    assert_eq!(
        loads_sent(&desk),
        vec![(String::from("/snapshot/load/3"), 1.0)]
    );
    pump.wait_for_cycles(2);

    let state = audio_state(&db);
    let host = state
        .channels
        .iter()
        .find(|channel| channel.id == "audio-input-9")
        .expect("Host");
    assert!(host.mute, "the strips show what slot 3 holds");
    assert_eq!(host.name, "Boom", "the channel takes TotalMix's name");
    let main = state
        .mix_targets
        .iter()
        .find(|target| target.id == "audio-mix-main")
        .expect("Main");
    assert_eq!(main.name, "Main", "the output takes TotalMix's name");
    let states = slot_states(&state);
    assert_eq!(states[2], "active", "{states:?}");
    assert_eq!(states[0], "off", "{states:?}");
    assert_eq!(state.console_state_confidence, "aligned");
    assert_eq!(
        state.last_console_sync_reason.as_deref(),
        Some("snapshot-load")
    );
    assert_eq!(state.last_action_status, "succeeded");
    // What the load changed is the load's: slot 3 muted Host, and no row
    // says that happened at TotalMix (the load's own row is the screen's).
    let console_rows: Vec<String> = crate::action_log::list_recent_actions(&db, 50)
        .expect("the action log should list")
        .into_iter()
        .filter(|entry| entry.source == "console")
        .map(|entry| entry.detail)
        .collect();
    assert!(console_rows.is_empty(), "{console_rows:?}");
    // ... and once the load is done, a change made at TotalMix is a row again:
    // the mark that silenced the load's reports was cleared.
    crate::rme_console_link::shared_console_link()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .ingest(
            &rosc::OscMessage {
                addr: String::from("/input/8/mute"),
                args: vec![rosc::OscType::Float(0.0)],
            },
            crate::rme_console_link::link_now_ms(),
        );
    flush_console_link(&db).expect("flush");
    let rows_after: Vec<String> = crate::action_log::list_recent_actions(&db, 50)
        .expect("the action log should list")
        .into_iter()
        .filter(|entry| entry.source == "console")
        .map(|entry| entry.detail)
        .collect();
    assert_eq!(rows_after.len(), 1, "{rows_after:?}");
    assert!(
        rows_after[0].starts_with("Mute off at TotalMix"),
        "{rows_after:?}"
    );
    assert!(
        !state.summary.to_lowercase().contains("snapshot"),
        "{}",
        state.summary
    );
}

#[test]
fn a_desk_that_does_not_report_the_load_is_marked_after_the_read_back() {
    let _serial = serialize_shared_link();
    let mut desk = SnapshotDesk::bind();
    let slot = crate::rme_totalmix_osc::bind_test_global_slot(desk.port);
    desk.start(slot.local_port(), two_mixes(), false, true);
    let test_dir = pull_test_db("load-quiet-desk", desk.port);
    crate::rme_totalmix_osc::mark_console_link_slot(true);
    let db = test_dir.db_path();
    let _pump = SlotPump::start(slot, db.clone());

    let loaded = load_audio_console_snapshot_with(
        &db,
        &AudioSnapshotLoadRequest { slot: 3 },
        load_timing(),
        true,
    )
    .expect("the load should go out and the desk be read back");
    assert!(!loaded.total_mix_reported);
    assert_eq!(loaded.console_state_confidence, "aligned");
    let states = slot_states(&audio_state(&db));
    assert_eq!(states[2], "active", "{states:?}");
    assert_eq!(
        states.iter().filter(|state| *state == "active").count(),
        1,
        "{states:?}"
    );
}

#[test]
fn a_load_whose_read_back_fails_is_still_a_load() {
    let _serial = serialize_shared_link();
    let mut desk = SnapshotDesk::bind();
    let slot = crate::rme_totalmix_osc::bind_test_global_slot(desk.port);
    // The desk takes the load and answers no dump.
    desk.start(slot.local_port(), two_mixes(), false, false);
    let test_dir = pull_test_db("load-no-read-back", desk.port);
    crate::rme_totalmix_osc::mark_console_link_slot(true);
    let db = test_dir.db_path();
    let _pump = SlotPump::start(slot, db.clone());

    let loaded = load_audio_console_snapshot_with(
        &db,
        &AudioSnapshotLoadRequest { slot: 2 },
        load_timing(),
        true,
    )
    .expect("the load went out, so the reply says so");
    assert!(loaded.loaded);
    assert_eq!(loaded.console_state_confidence, "unknown");
    assert_eq!(loaded.pulled_values, 0);
    assert!(
        loaded.summary.contains("was sent to TotalMix;"),
        "{}",
        loaded.summary
    );
    assert_eq!(
        loads_sent(&desk),
        vec![(String::from("/snapshot/load/2"), 1.0)]
    );
    let state = audio_state(&db);
    assert_eq!(state.console_state_confidence, "unknown");
    assert_eq!(state.last_action_status, "failed");
    assert_eq!(
        state.last_action_code.as_deref(),
        Some("AUDIO_SYNC_NO_ECHO")
    );
    // Nothing says which slot the desk holds: it is not marked.
    assert!(
        slot_states(&state).iter().all(|state| state != "active"),
        "{:?}",
        slot_states(&state)
    );
}

#[test]
fn a_load_without_the_global_slot_sends_nothing() {
    let _serial = serialize_shared_link();
    let mut desk = SnapshotDesk::bind();
    let slot = crate::rme_totalmix_osc::bind_test_global_slot(desk.port);
    desk.start(slot.local_port(), two_mixes(), true, true);
    let test_dir = pull_test_db("load-unbound", desk.port);
    crate::rme_totalmix_osc::mark_console_link_slot(false);

    let error = load_audio_console_snapshot_with(
        &test_dir.db_path(),
        &AudioSnapshotLoadRequest { slot: 1 },
        load_timing(),
        true,
    )
    .expect_err("without the slot the load cannot be followed");
    assert!(matches!(
        error,
        AudioCommandError::Rejected("AUDIO_GLOBAL_OSC_UNBOUND", _)
    ));
    std::thread::sleep(Duration::from_millis(100));
    assert!(desk.received().is_empty(), "{:?}", desk.received());
    drop(slot);
}

// A change at TotalMix reported just before a load waits in the link for the
// next flush; the load's read-back comes after it, so the desk's loaded mix is
// the last word (the ordering 2026-09-22 asked of a recall).
#[test]
fn a_change_at_totalmix_reported_before_a_load_does_not_outlive_it() {
    let _serial = serialize_shared_link();
    let mut desk = SnapshotDesk::bind();
    let slot = crate::rme_totalmix_osc::bind_test_global_slot(desk.port);
    desk.start(slot.local_port(), two_mixes(), true, true);
    let test_dir = pull_test_db("load-after-a-desk-change", desk.port);
    crate::rme_totalmix_osc::mark_console_link_slot(true);
    let db = test_dir.db_path();

    // Somebody mutes Host at TotalMix; the report waits in the link.
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
    let _pump = SlotPump::start(slot, db.clone());

    load_audio_console_snapshot_with(
        &db,
        &AudioSnapshotLoadRequest { slot: 1 },
        load_timing(),
        true,
    )
    .expect("the load should go out and the desk be read back");
    let host_muted = audio_state(&db)
        .channels
        .iter()
        .find(|channel| channel.id == "audio-input-9")
        .expect("Host")
        .mute;
    assert!(
        !host_muted,
        "slot 1 has Host unmuted; the mute reported before the load must not outlive it"
    );
}

#[test]
fn the_load_sender_takes_slots_one_to_eight_and_sends_only_one() {
    let receiver = std::net::UdpSocket::bind("127.0.0.1:0").expect("receiver should bind");
    receiver
        .set_read_timeout(Some(Duration::from_millis(500)))
        .expect("read timeout should apply");
    let port = i64::from(receiver.local_addr().expect("address").port());
    for slot in [0, 9] {
        assert!(
            crate::rme_totalmix_osc::send_console_snapshot_load("127.0.0.1", port - 3, slot)
                .is_err()
        );
    }
    assert_eq!(
        crate::rme_totalmix_osc::send_console_snapshot_load("127.0.0.1", port - 3, 8),
        Ok(1)
    );
    let mut buffer = [0u8; 512];
    let (len, _) = receiver.recv_from(&mut buffer).expect("the load datagram");
    let Ok((_, rosc::OscPacket::Message(message))) = rosc::decoder::decode_udp(&buffer[..len])
    else {
        panic!("an OSC message");
    };
    assert_eq!(message.addr, "/snapshot/load/8");
    assert_eq!(message.args, vec![rosc::OscType::Float(1.0)]);
}
