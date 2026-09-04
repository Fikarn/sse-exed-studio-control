//! Momentary talkback (2026-09 audit remediation, Slice 6 — operator decision 4).
//!
//! Talkback is a hold, never a latch, on every surface. The on-screen button,
//! the `T` key, the Stream Deck TALK key and any other caller all end up in
//! `update_audio_mix_target` with `talkback: Some(..)`, and that function arms
//! (`true`) or clears (`false`) the watchdog here — so no caller can latch
//! talkback by construction. The watchdog releases a hold
//! [`AUDIO_TALKBACK_HOLD_TTL`] after the last arm, so a lost pointer-up, a
//! dropped deck request or a frontend that went away can never leave the
//! studio talkback open. While the operator holds, the frontend re-sends
//! `audio.talkback.hold { engaged: true }` every 750 ms (well inside the TTL);
//! a re-send while talkback is already on only re-arms the deadline and
//! touches neither the console nor the database.
//!
//! Holds are keyed by database path and mix target, so the engine's tests
//! (which each run against their own database) and a phones target with an
//! app-local talkback never interfere with the main out.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::engine_events::emit_audio_changed;

use super::helpers::*;
use super::types::*;
use super::*;

/// How long a hold stays alive without a new arm from any surface.
pub const AUDIO_TALKBACK_HOLD_TTL: Duration = Duration::from_secs(2);
/// The mix-target role a hold defaults to when the caller names none.
pub(crate) const AUDIO_MAIN_MIX_TARGET_ROLE: &str = "main-out";
const WATCHDOG_TICK: Duration = Duration::from_millis(250);

/// `audio.talkback.hold` request: `engaged: true` engages (or re-arms) the
/// hold, `false` releases it. `mix_target_id` defaults to the main out.
#[derive(Debug, Clone)]
pub struct AudioTalkbackHoldRequest {
    pub mix_target_id: Option<String>,
    pub engaged: bool,
}

/// `audio.talkback.hold` result. `changed` is false for a heartbeat that only
/// re-armed the deadline (nothing was sent, persisted or announced).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioTalkbackHoldResult {
    pub mix_target_id: String,
    pub talkback: bool,
    pub changed: bool,
}

type HoldKey = (PathBuf, String);

static HOLDS: OnceLock<Mutex<HashMap<HoldKey, Instant>>> = OnceLock::new();
static WATCHDOG: OnceLock<()> = OnceLock::new();

fn holds() -> &'static Mutex<HashMap<HoldKey, Instant>> {
    HOLDS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn hold_key(db_path: &Path, mix_target_id: &str) -> HoldKey {
    (db_path.to_path_buf(), String::from(mix_target_id))
}

/// (Re-)arms the hold for one mix target and makes sure the watchdog runs.
pub(super) fn arm_talkback_hold(db_path: &Path, mix_target_id: &str) {
    arm_talkback_hold_at(db_path, mix_target_id, Instant::now());
    WATCHDOG.get_or_init(|| {
        thread::spawn(run_watchdog);
    });
}

pub(super) fn arm_talkback_hold_at(db_path: &Path, mix_target_id: &str, now: Instant) {
    if let Ok(mut holds) = holds().lock() {
        holds.insert(
            hold_key(db_path, mix_target_id),
            now + AUDIO_TALKBACK_HOLD_TTL,
        );
    }
}

pub(super) fn clear_talkback_hold(db_path: &Path, mix_target_id: &str) {
    if let Ok(mut holds) = holds().lock() {
        holds.remove(&hold_key(db_path, mix_target_id));
    }
}

/// The deadline of an armed hold, if any (tests).
#[cfg(test)]
pub(crate) fn talkback_hold_deadline(db_path: &Path, mix_target_id: &str) -> Option<Instant> {
    holds()
        .lock()
        .ok()
        .and_then(|holds| holds.get(&hold_key(db_path, mix_target_id)).copied())
}

/// Removes and returns every hold whose deadline has passed at `now`.
pub(super) fn take_expired_holds(now: Instant) -> Vec<HoldKey> {
    let Ok(mut holds) = holds().lock() else {
        return Vec::new();
    };
    let expired: Vec<HoldKey> = holds
        .iter()
        .filter(|(_, deadline)| now >= **deadline)
        .map(|(key, _)| key.clone())
        .collect();
    for key in &expired {
        holds.remove(key);
    }
    expired
}

fn run_watchdog() {
    loop {
        thread::sleep(WATCHDOG_TICK);
        for (db_path, mix_target_id) in take_expired_holds(Instant::now()) {
            match release_talkback_hold(&db_path, &mix_target_id) {
                Ok(true) => eprintln!(
                    "Talkback watchdog: released {mix_target_id} after {} ms without a hold",
                    AUDIO_TALKBACK_HOLD_TTL.as_millis()
                ),
                Ok(false) => {}
                Err(error) => eprintln!(
                    "Talkback watchdog: could not release {mix_target_id}: {}",
                    describe_error(&error)
                ),
            }
        }
    }
}

fn describe_error(error: &AudioCommandError) -> String {
    match error {
        AudioCommandError::Rejected(code, message) => format!("{code}: {message}"),
        AudioCommandError::Storage(message) => message.clone(),
    }
}

fn talkback_update(mix_target_id: &str, talkback: bool) -> AudioMixTargetUpdateRequest {
    AudioMixTargetUpdateRequest {
        mix_target_id: String::from(mix_target_id),
        volume: None,
        mute: None,
        dim: None,
        mono: None,
        talkback: Some(talkback),
    }
}

fn resolve_talkback_target<'a>(
    snapshot: &'a AudioSnapshot,
    mix_target_id: Option<&str>,
) -> Result<&'a AudioMixTargetSnapshot, AudioCommandError> {
    match mix_target_id {
        Some(id) => snapshot
            .mix_targets
            .iter()
            .find(|entry| entry.id == id)
            .ok_or_else(|| {
                AudioCommandError::Rejected(
                    "AUDIO_MIX_TARGET_NOT_FOUND",
                    format!("Audio mix target '{id}' is not exposed by the engine."),
                )
            }),
        None => snapshot
            .mix_targets
            .iter()
            .find(|entry| entry.role == AUDIO_MAIN_MIX_TARGET_ROLE)
            .or_else(|| snapshot.mix_targets.first())
            .ok_or_else(|| {
                AudioCommandError::Rejected(
                    "AUDIO_MIX_TARGET_NOT_FOUND",
                    String::from("No main output mix target is available."),
                )
            }),
    }
}

/// `audio.talkback.hold`.
///
/// `engaged: true` passes the console gate, turns talkback on if it is off
/// (`/controlroom/talkback 1`, persisted, announced) and arms the watchdog;
/// when talkback is already on it only re-arms the deadline. `engaged: false`
/// clears the deadline and turns talkback off if it is on. Every surface —
/// button, key, deck — calls this, so releasing from any of them releases
/// everywhere.
pub fn hold_audio_talkback(
    db_path: &Path,
    request: &AudioTalkbackHoldRequest,
) -> Result<AudioTalkbackHoldResult, AudioCommandError> {
    let settings = load_audio_settings(db_path)?;
    let snapshot = read_audio_snapshot(&settings);
    let target = resolve_talkback_target(&snapshot, request.mix_target_id.as_deref())?;
    let mix_target_id = target.id.clone();
    let currently_on = target.talkback;

    if request.engaged {
        ensure_audio_action_allowed(db_path, &snapshot)?;
        if currently_on {
            arm_talkback_hold(db_path, &mix_target_id);
            return Ok(AudioTalkbackHoldResult {
                mix_target_id,
                talkback: true,
                changed: false,
            });
        }
        // update_audio_mix_target arms the hold once the state is persisted.
        update_audio_mix_target(db_path, &talkback_update(&mix_target_id, true))?;
        Ok(AudioTalkbackHoldResult {
            mix_target_id,
            talkback: true,
            changed: true,
        })
    } else {
        clear_talkback_hold(db_path, &mix_target_id);
        if !currently_on {
            return Ok(AudioTalkbackHoldResult {
                mix_target_id,
                talkback: false,
                changed: false,
            });
        }
        update_audio_mix_target(db_path, &talkback_update(&mix_target_id, false))?;
        Ok(AudioTalkbackHoldResult {
            mix_target_id,
            talkback: false,
            changed: true,
        })
    }
}

/// Turns talkback off on one mix target if it is on and forgets its hold.
/// Returns whether anything changed. Used by the watchdog, by the graceful
/// shutdown and by the deck tests.
pub fn release_talkback_hold(
    db_path: &Path,
    mix_target_id: &str,
) -> Result<bool, AudioCommandError> {
    clear_talkback_hold(db_path, mix_target_id);
    let settings = load_audio_settings(db_path)?;
    let snapshot = read_audio_snapshot(&settings);
    let Some(target) = snapshot
        .mix_targets
        .iter()
        .find(|entry| entry.id == mix_target_id)
    else {
        return Ok(false);
    };
    if !target.talkback {
        return Ok(false);
    }
    update_audio_mix_target(db_path, &talkback_update(mix_target_id, false))?;
    emit_audio_changed("talkback-released");
    Ok(true)
}

/// Graceful engine stop (stdin closed): release every hold this database
/// still has so TotalMix is not left talking. A hard kill cannot do this —
/// documented in OPERATIONS.
pub fn release_all_talkback_holds(db_path: &Path) -> usize {
    let targets: Vec<String> = holds()
        .lock()
        .map(|holds| {
            holds
                .keys()
                .filter(|(path, _)| path == db_path)
                .map(|(_, id)| id.clone())
                .collect()
        })
        .unwrap_or_default();
    let mut released = 0;
    for mix_target_id in targets {
        match release_talkback_hold(db_path, &mix_target_id) {
            Ok(true) => released += 1,
            Ok(false) => {}
            Err(error) => eprintln!(
                "Talkback release on shutdown failed for {mix_target_id}: {}",
                describe_error(&error)
            ),
        }
    }
    released
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_state::APP_SETTINGS_PREFIX;
    use crate::audio::tests::TestDir;
    use crate::storage::{initialize_database, list_settings_by_prefix, set_settings_owned};
    use std::sync::Mutex as TestMutex;

    // The hold table is process-wide; serialize the tests that read it.
    static TEST_LOCK: TestMutex<()> = TestMutex::new(());

    fn ready_db(label: &str) -> TestDir {
        let test_dir = TestDir::new(label);
        initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
        set_settings_owned(
            test_dir.db_path().as_path(),
            &[
                (
                    String::from("app.commissioning.check.audio.status"),
                    String::from("passed"),
                ),
                (
                    String::from("app.audio.send_host"),
                    String::from("127.0.0.1"),
                ),
                (
                    String::from("app.audio.metering_source"),
                    String::from(crate::rme_totalmix_osc::SIMULATED_AUDIO_SOURCE),
                ),
            ],
        )
        .expect("ready audio settings should persist");
        test_dir
    }

    fn main_talkback(db_path: &Path) -> bool {
        read_audio_snapshot(&load_audio_settings(db_path).expect("settings"))
            .mix_targets
            .iter()
            .find(|entry| entry.role == AUDIO_MAIN_MIX_TARGET_ROLE)
            .expect("main mix target")
            .talkback
    }

    fn app_settings(db_path: &Path) -> HashMap<String, String> {
        list_settings_by_prefix(db_path, APP_SETTINGS_PREFIX).expect("app settings")
    }

    fn hold(db_path: &Path, engaged: bool) -> AudioTalkbackHoldResult {
        hold_audio_talkback(
            db_path,
            &AudioTalkbackHoldRequest {
                mix_target_id: None,
                engaged,
            },
        )
        .expect("talkback hold should succeed")
    }

    #[test]
    fn talkback_hold_engages_heartbeat_rearms_without_rewriting_state_and_release_clears() {
        let _guard = TEST_LOCK
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let test_dir = ready_db("talkback-hold");
        let db = test_dir.db_path();

        let engaged = hold(&db, true);
        assert_eq!(engaged.mix_target_id, "audio-mix-main");
        assert!(engaged.talkback && engaged.changed);
        assert!(main_talkback(&db));
        let first_deadline = talkback_hold_deadline(&db, "audio-mix-main").expect("hold armed");

        // Heartbeat: same call while on. Nothing persisted, deadline pushed out.
        let before = app_settings(&db);
        thread::sleep(Duration::from_millis(5));
        let heartbeat = hold(&db, true);
        assert!(heartbeat.talkback && !heartbeat.changed);
        assert_eq!(
            app_settings(&db),
            before,
            "a heartbeat must not write state"
        );
        let second_deadline = talkback_hold_deadline(&db, "audio-mix-main").expect("still armed");
        assert!(second_deadline > first_deadline);

        let released = hold(&db, false);
        assert!(!released.talkback && released.changed);
        assert!(!main_talkback(&db));
        assert!(talkback_hold_deadline(&db, "audio-mix-main").is_none());

        // Releasing an already-off talkback is a no-op, not an error.
        let again = hold(&db, false);
        assert!(!again.talkback && !again.changed);
    }

    #[test]
    fn mix_target_update_with_talkback_arms_and_clears_the_watchdog() {
        let _guard = TEST_LOCK
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let test_dir = ready_db("talkback-mix-target");
        let db = test_dir.db_path();

        let mut request = talkback_update("audio-mix-main", true);
        update_audio_mix_target(&db, &request).expect("talkback on");
        assert!(talkback_hold_deadline(&db, "audio-mix-main").is_some());

        request.talkback = Some(false);
        update_audio_mix_target(&db, &request).expect("talkback off");
        assert!(talkback_hold_deadline(&db, "audio-mix-main").is_none());

        // A request without talkback never touches the hold table.
        request.talkback = None;
        request.dim = Some(true);
        update_audio_mix_target(&db, &request).expect("dim on");
        assert!(talkback_hold_deadline(&db, "audio-mix-main").is_none());
    }

    #[test]
    fn talkback_watchdog_releases_after_deadline() {
        let _guard = TEST_LOCK
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let test_dir = ready_db("talkback-watchdog");
        let db = test_dir.db_path();
        let key = (db.clone(), String::from("audio-mix-main"));

        hold(&db, true);
        assert!(
            !take_expired_holds(Instant::now()).contains(&key),
            "a fresh hold must not expire immediately"
        );
        let expired = take_expired_holds(
            Instant::now() + AUDIO_TALKBACK_HOLD_TTL + Duration::from_millis(10),
        );
        assert!(expired.contains(&key), "the hold expires after the TTL");
        assert!(talkback_hold_deadline(&db, "audio-mix-main").is_none());

        // What the watchdog thread does with an expired key.
        assert!(release_talkback_hold(&db, "audio-mix-main").expect("release"));
        assert!(!main_talkback(&db));
        assert!(!release_talkback_hold(&db, "audio-mix-main").expect("second release is a no-op"));
    }

    #[test]
    fn talkback_hold_is_refused_before_the_probe_passes_and_arms_nothing() {
        let _guard = TEST_LOCK
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let test_dir = TestDir::new("talkback-gated");
        let db = test_dir.db_path();
        initialize_database(db.as_path()).expect("database should initialize");

        let error = hold_audio_talkback(
            &db,
            &AudioTalkbackHoldRequest {
                mix_target_id: None,
                engaged: true,
            },
        )
        .expect_err("unverified audio must refuse a hold");
        assert!(
            matches!(error, AudioCommandError::Rejected(code, _) if code == "AUDIO_NOT_VERIFIED"),
            "unexpected error: {error:?}"
        );
        assert!(talkback_hold_deadline(&db, "audio-mix-main").is_none());
        assert!(!main_talkback(&db));
    }

    #[test]
    fn release_all_talkback_holds_releases_this_databases_holds() {
        let _guard = TEST_LOCK
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let test_dir = ready_db("talkback-shutdown");
        let db = test_dir.db_path();
        hold(&db, true);
        assert!(main_talkback(&db));

        assert_eq!(release_all_talkback_holds(&db), 1);
        assert!(!main_talkback(&db));
        assert!(talkback_hold_deadline(&db, "audio-mix-main").is_none());
        assert_eq!(release_all_talkback_holds(&db), 0);
    }

    #[test]
    fn talkback_hold_rejects_unknown_mix_targets() {
        let test_dir = ready_db("talkback-unknown-target");
        let error = hold_audio_talkback(
            &test_dir.db_path(),
            &AudioTalkbackHoldRequest {
                mix_target_id: Some(String::from("audio-mix-nope")),
                engaged: true,
            },
        )
        .expect_err("unknown target");
        assert!(matches!(
            error,
            AudioCommandError::Rejected("AUDIO_MIX_TARGET_NOT_FOUND", _)
        ));
    }
}
