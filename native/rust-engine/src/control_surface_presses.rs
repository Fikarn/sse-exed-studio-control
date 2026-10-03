//! The deck's presses that ask, and the ones that dwell (the owner's
//! decisions, 2026-09-28).
//!
//! `All Off` and `Del Scene` on the LIGHTS page ask first, as `REC` asks
//! `STOP?`: the first press arms and the key reads `OFF?` or `DEL?` in amber,
//! and a second press within 3 s acts. `Save` stays one press. `PLAY`, `DIM`,
//! a mute and `Toggle` switch at one press and drop a second that comes
//! within the dwell: a press that arrives twice, a bounce or a double press,
//! switches once. What a key does is still its page's; this module keeps the
//! arm and the moments in the hardware link's memory, for each saved data,
//! and answers the two keys' displays from them. A start has no arm.

use crate::cameras::deck::{STOP_ARM_DWELL, STOP_ARM_WINDOW};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// A press sooner than this after one that acted, or after the one that
/// armed, is the same press again: `REC`'s dwell, and every armed key's on
/// the screen.
pub(crate) const PRESS_DWELL: Duration = STOP_ARM_DWELL;
/// How long an asking key stays armed: `REC`'s `STOP?`.
pub(crate) const ASK_WINDOW: Duration = STOP_ARM_WINDOW;

/// The LIGHTS page's two keys that ask first.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AskingKey {
    AllOff,
    DeleteScene,
}

impl AskingKey {
    pub(crate) fn from_action(action: &str) -> Option<Self> {
        match action {
            "allOff" => Some(Self::AllOff),
            "deleteScene" => Some(Self::DeleteScene),
            _ => None,
        }
    }

    fn action(self) -> &'static str {
        match self {
            Self::AllOff => "allOff",
            Self::DeleteScene => "deleteScene",
        }
    }

    /// What the key reads: its question while armed, else its name.
    fn text(self, armed: bool) -> &'static str {
        match (self, armed) {
            (Self::AllOff, true) => "OFF?",
            // One line, in capitals as on the other pages (2026-10-03).
            (Self::AllOff, false) => "ALL OFF",
            (Self::DeleteScene, true) => "DEL?",
            (Self::DeleteScene, false) => "Del\\nScene",
        }
    }
}

/// What an armed key is about. `Del Scene` deletes the scene the deck has
/// selected, and `All Off` switches the preview while previewing, else the
/// rig: a second press that would act on anything else ends the arm and does
/// nothing, as `REC`'s stop stops only the take it was armed for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum AskTarget {
    Scene(String),
    Previewing(bool),
}

/// What a press of an asking key is to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Ask {
    /// The second press, within the window, on what the arm was about.
    Act,
    /// The first press: the key now reads its question.
    Armed,
    /// The same press again, or a second press about something else: nothing.
    Kept,
}

struct Arm {
    key: AskingKey,
    at: Instant,
    target: AskTarget,
}

#[derive(Default)]
struct Presses {
    /// One key is armed at a time, as on the screen.
    arm: Option<Arm>,
    /// The moment each key last acted, for the dwell.
    acted: HashMap<String, Instant>,
}

type Registry = Mutex<HashMap<PathBuf, Presses>>;

/// Each saved data's presses: the tests, each with a database of its own,
/// never share them.
static PRESSES: OnceLock<Registry> = OnceLock::new();

fn with_presses<R>(db_path: &Path, act: impl FnOnce(&mut Presses) -> R) -> R {
    let registry = PRESSES.get_or_init(|| Mutex::new(HashMap::new()));
    let mut registry = registry
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    act(registry.entry(db_path.to_path_buf()).or_default())
}

fn within(since: Instant, at: Instant, span: Duration) -> bool {
    at.saturating_duration_since(since) < span
}

/// A press of an asking key at `at`, about `target`. Taken under the
/// lighting lock, which the caller holds, so the target read and the act
/// that follows see the same rig.
///
/// - A press sooner than the dwell after the key acted is the same press.
/// - A press within the window of the key's own arm acts, unless it is
///   sooner than the dwell after the arm (the same press) or the arm was
///   about something else (the arm ends, and nothing happens).
/// - Any other press arms this key, and ends another key's arm.
pub(crate) fn ask(db_path: &Path, key: AskingKey, target: AskTarget, at: Instant) -> Ask {
    with_presses(db_path, |presses| {
        if presses
            .acted
            .get(key.action())
            .is_some_and(|acted| within(*acted, at, PRESS_DWELL))
        {
            return Ask::Kept;
        }
        if let Some(arm) = presses.arm.as_ref().filter(|arm| arm.key == key) {
            if at.saturating_duration_since(arm.at) <= ASK_WINDOW {
                if arm.target != target {
                    presses.arm = None;
                    return Ask::Kept;
                }
                if within(arm.at, at, PRESS_DWELL) {
                    return Ask::Kept;
                }
                return Ask::Act;
            }
        }
        presses.arm = Some(Arm { key, at, target });
        Ask::Armed
    })
}

/// The key acted: the arm is spent, and the dwell counts from `at`.
pub(crate) fn asked_key_acted(db_path: &Path, key: AskingKey, at: Instant) {
    with_presses(db_path, |presses| {
        presses.arm = None;
        presses.acted.insert(String::from(key.action()), at);
    });
}

/// Another key of the LIGHTS page was pressed, or the act failed: an arm
/// ends, so a second press is never about a rig that moved in between.
pub(crate) fn end_arm(db_path: &Path) {
    with_presses(db_path, |presses| presses.arm = None);
}

/// What an asking key's display reads at `at`: its question while its arm
/// runs, else its name. It reads the hardware link's memory only.
pub(crate) fn asking_key_text(db_path: &Path, key: AskingKey, at: Instant) -> String {
    let armed = with_presses(db_path, |presses| {
        presses
            .arm
            .as_ref()
            .is_some_and(|arm| arm.key == key && at.saturating_duration_since(arm.at) <= ASK_WINDOW)
    });
    String::from(key.text(armed))
}

/// The keys that switch at one press and drop a second within the dwell,
/// named by their route, action and value: `Toggle` (and the Light dial's
/// push, which posts the same), `DIM`, each strip's mute (a dial's push, one
/// for each strip), and `PLAY` (and the speed dial's push). `None` for every
/// other key.
pub(crate) fn dwelling_press(path: &str, action: &str, value: Option<&str>) -> Option<String> {
    match (path, action) {
        ("/api/deck/light-action", "toggleLight")
        | ("/api/deck/audio-action", "dimToggle")
        | ("/api/deck/prompter-action", "playPause") => Some(format!("{path} {action}")),
        ("/api/deck/audio-action", "dialPress") => {
            Some(format!("{path} {action} {}", value.unwrap_or_default()))
        }
        _ => None,
    }
}

/// Takes the press at `at` for a dwelling key: `None` when it is the same
/// press again (sooner than the dwell after the one that last acted), else
/// what stood before it, for `release` should the press fail. The moment is
/// written first, so two presses that arrive together cannot both act.
pub(crate) fn take_dwelling_press(
    db_path: &Path,
    press: &str,
    at: Instant,
) -> Option<Option<Instant>> {
    with_presses(db_path, |presses| {
        let before = presses.acted.get(press).copied();
        if before.is_some_and(|acted| within(acted, at, PRESS_DWELL)) {
            return None;
        }
        presses.acted.insert(String::from(press), at);
        Some(before)
    })
}

/// A dwelling press made at `at` that failed did not act: what stood before
/// it stands again, unless a later press has taken the key since (the review
/// of #254), whose moment stays.
pub(crate) fn release_dwelling_press(
    db_path: &Path,
    press: &str,
    before: Option<Instant>,
    at: Instant,
) {
    with_presses(db_path, |presses| {
        if presses.acted.get(press) != Some(&at) {
            return;
        }
        match before {
            Some(before) => {
                presses.acted.insert(String::from(press), before);
            }
            None => {
                presses.acted.remove(press);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db(name: &str) -> PathBuf {
        PathBuf::from(format!("presses-unit-{name}.sqlite3"))
    }

    fn scene(id: &str) -> AskTarget {
        AskTarget::Scene(String::from(id))
    }

    #[test]
    fn an_asking_key_arms_then_acts_within_the_window() {
        let db = db("arm-act");
        let start = Instant::now();
        assert_eq!(
            ask(&db, AskingKey::DeleteScene, scene("a"), start),
            Ask::Armed
        );
        assert_eq!(asking_key_text(&db, AskingKey::DeleteScene, start), "DEL?");
        assert_eq!(asking_key_text(&db, AskingKey::AllOff, start), "ALL OFF");
        // Inside the dwell: the same press again.
        assert_eq!(
            ask(
                &db,
                AskingKey::DeleteScene,
                scene("a"),
                start + Duration::from_millis(200)
            ),
            Ask::Kept
        );
        let second = start + Duration::from_secs(2);
        assert_eq!(
            ask(&db, AskingKey::DeleteScene, scene("a"), second),
            Ask::Act
        );
        asked_key_acted(&db, AskingKey::DeleteScene, second);
        assert_eq!(
            asking_key_text(&db, AskingKey::DeleteScene, second),
            "Del\\nScene"
        );
        // A third press sooner than the dwell after the act is the second again.
        assert_eq!(
            ask(
                &db,
                AskingKey::DeleteScene,
                scene("b"),
                second + Duration::from_millis(100)
            ),
            Ask::Kept
        );
        // After it, the next press arms again: nothing is deleted at one press.
        assert_eq!(
            ask(
                &db,
                AskingKey::DeleteScene,
                scene("b"),
                second + Duration::from_millis(400)
            ),
            Ask::Armed
        );
    }

    #[test]
    fn the_window_ends_at_3_s_and_the_next_press_arms_again() {
        let db = db("window");
        let start = Instant::now();
        assert_eq!(
            ask(&db, AskingKey::AllOff, AskTarget::Previewing(false), start),
            Ask::Armed
        );
        let late = start + ASK_WINDOW + Duration::from_millis(1);
        assert_eq!(asking_key_text(&db, AskingKey::AllOff, late), "ALL OFF");
        assert_eq!(
            ask(&db, AskingKey::AllOff, AskTarget::Previewing(false), late),
            Ask::Armed
        );
    }

    #[test]
    fn an_arm_about_something_else_ends_and_does_nothing() {
        let db = db("target");
        let start = Instant::now();
        ask(&db, AskingKey::DeleteScene, scene("a"), start);
        // The scene dial moved the selection: the second press is not about
        // the scene the key asked about.
        assert_eq!(
            ask(
                &db,
                AskingKey::DeleteScene,
                scene("b"),
                start + Duration::from_secs(1)
            ),
            Ask::Kept
        );
        assert_eq!(
            asking_key_text(&db, AskingKey::DeleteScene, start + Duration::from_secs(1)),
            "Del\\nScene"
        );

        ask(&db, AskingKey::AllOff, AskTarget::Previewing(false), start);
        assert_eq!(
            ask(
                &db,
                AskingKey::AllOff,
                AskTarget::Previewing(true),
                start + Duration::from_secs(1)
            ),
            Ask::Kept,
            "preview was switched between the presses"
        );
    }

    #[test]
    fn one_key_is_armed_at_a_time_and_another_press_ends_it() {
        let db = db("one-at-a-time");
        let start = Instant::now();
        ask(&db, AskingKey::AllOff, AskTarget::Previewing(false), start);
        assert_eq!(
            ask(
                &db,
                AskingKey::DeleteScene,
                scene("a"),
                start + Duration::from_millis(500)
            ),
            Ask::Armed
        );
        assert_eq!(
            asking_key_text(&db, AskingKey::AllOff, start + Duration::from_millis(500)),
            "ALL OFF"
        );
        // `All Off` armed again, not acted on: its arm had ended.
        assert_eq!(
            ask(
                &db,
                AskingKey::AllOff,
                AskTarget::Previewing(false),
                start + Duration::from_secs(1)
            ),
            Ask::Armed
        );
        end_arm(&db);
        assert_eq!(
            asking_key_text(&db, AskingKey::AllOff, start + Duration::from_secs(1)),
            "ALL OFF"
        );
    }

    #[test]
    fn a_dwelling_press_counts_from_the_last_one_that_acted() {
        let db = db("dwell");
        let press =
            dwelling_press("/api/deck/prompter-action", "playPause", None).expect("PLAY dwells");
        let start = Instant::now();
        assert!(take_dwelling_press(&db, &press, start).is_some());
        assert!(take_dwelling_press(&db, &press, start + Duration::from_millis(200)).is_none());
        // 400 ms after the first, which acted: a press of its own.
        assert!(take_dwelling_press(&db, &press, start + Duration::from_millis(400)).is_some());
        // A press that failed gives its moment back.
        let at = start + Duration::from_millis(900);
        let before = take_dwelling_press(&db, &press, at).expect("a press of its own");
        release_dwelling_press(&db, &press, before, at);
        assert!(take_dwelling_press(&db, &press, at + Duration::from_millis(10)).is_some());
    }

    // The review of #254: a press that fails after a later press took the key
    // gives nothing back, so the later press's moment and its dwell stand.
    #[test]
    fn a_failed_press_leaves_a_later_press_s_moment_alone() {
        let db = db("release-race");
        let press =
            dwelling_press("/api/deck/light-action", "toggleLight", None).expect("Toggle dwells");
        let first = Instant::now();
        let before_first = take_dwelling_press(&db, &press, first).expect("the first press");
        let second = first + Duration::from_millis(400);
        take_dwelling_press(&db, &press, second).expect("the second press");
        // The first, still running, fails now.
        release_dwelling_press(&db, &press, before_first, first);
        assert!(
            take_dwelling_press(&db, &press, second + Duration::from_millis(50)).is_none(),
            "a bounce of the second press is still the same press"
        );
    }

    // A moment earlier than the stored one (a worker that took its press
    // later) counts as no time at all: the same press again, never an act.
    #[test]
    fn a_press_whose_moment_is_earlier_is_the_same_press() {
        let db = db("earlier");
        let start = Instant::now() + Duration::from_secs(10);
        assert_eq!(
            ask(&db, AskingKey::DeleteScene, scene("a"), start),
            Ask::Armed
        );
        assert_eq!(
            ask(
                &db,
                AskingKey::DeleteScene,
                scene("a"),
                start - Duration::from_millis(30)
            ),
            Ask::Kept
        );
    }

    #[test]
    fn each_strip_s_mute_dwells_on_its_own_and_other_keys_not_at_all() {
        let one = dwelling_press("/api/deck/audio-action", "dialPress", Some("1"));
        let two = dwelling_press("/api/deck/audio-action", "dialPress", Some("2"));
        assert!(one.is_some() && two.is_some() && one != two);
        for (path, action) in [
            ("/api/deck/light-action", "toggleLight"),
            ("/api/deck/audio-action", "dimToggle"),
        ] {
            assert!(dwelling_press(path, action, None).is_some(), "{action}");
        }
        for (path, action) in [
            ("/api/deck/light-action", "saveScene"),
            ("/api/deck/light-action", "allOff"),
            ("/api/deck/audio-action", "toggleDialMode"),
            ("/api/deck/camera-action", "rec"),
            ("/api/deck/prompter-action", "back"),
        ] {
            assert!(dwelling_press(path, action, None).is_none(), "{action}");
        }
    }
}
