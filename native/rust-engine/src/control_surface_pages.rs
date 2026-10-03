//! The PROMPTER and CAMERAS pages at the bridge (D5, D14). What a key does
//! and what a display says is the prompter's and the cameras' own
//! (`prompter::deck`, `cameras::deck`). This module hands a request over,
//! turns a refusal into the bridge's answer, and says what the screen is to
//! hear of a key. The CAMERAS page's texts are kept for a moment, so that one
//! poll of the deck — every display at once, a connection each — costs one
//! read, and a key's displays are answered by the key's own. The PROMPTER
//! page's are worked out at each display from the frame the prompter
//! publishes, which takes no lock of the prompter's (2026-10-02: a display
//! that waited for the prompter held a worker of the bridge with it).

use crate::cameras::deck::CAMERA_LCD_KEYS;
use crate::cameras::CameraError;
use crate::control_surface::ControlSurfaceError;
use crate::engine_events::{cameras_changed_payload, prompter_changed_payload};
use crate::health::APP_CHANGED_REASON_HEALTH;
use crate::prompter::deck::PROMPTER_LCD_KEYS;
use crate::prompter::PrompterError;
use crate::protocol::{EVENT_APP_CHANGED, EVENT_CAMERAS_CHANGED, EVENT_PROMPTER_CHANGED};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

/// The PROMPTER page's keys and dials.
pub(crate) const PROMPTER_ROUTE: &str = "/api/deck/prompter-action";
/// The CAMERAS page's keys and dials.
pub(crate) const CAMERA_ROUTE: &str = "/api/deck/camera-action";

/// How long the CAMERAS page's texts answer its displays before they are
/// read again: longer than one poll's burst, shorter than the second between
/// two polls.
pub(crate) const TEXTS_KEPT_FOR: Duration = Duration::from_millis(250);

/// How long the CAMERAS page's texts answer the deck's one read of every
/// display (`page_texts`, the review of #293): every press of every page
/// reads them again, so a fast spin of an AUDIO or LIGHTS dial would read
/// every held camera several times a second, under the cameras' lock. A
/// little under the poll's second, so the poll still reads the cameras once
/// a second; a key of the CAMERAS page puts its own texts in their place
/// anyway. While `REC`'s stop is armed they are kept `TEXTS_KEPT_FOR` only,
/// so `STOP?` lapses as `STOP_SHOWN_FOR` counts on.
pub(crate) const DISPLAYS_TEXTS_KEPT_FOR: Duration = Duration::from_millis(900);

/// A PROMPTER display asked for while a key of the page is on its way waits
/// for the key this long at most, then answers from the prompter as it is
/// (the review of #288: Companion asks for a dial's displays as it sends the
/// detent, and the strip showed the pace from before it until the next poll).
pub(crate) const KEY_WAITED_FOR: Duration = Duration::from_millis(100);

/// The PROMPTER keys on their way, by saved data.
struct KeysOnTheirWay {
    count: Mutex<HashMap<PathBuf, u32>>,
    done: Condvar,
}

fn keys_on_their_way() -> &'static KeysOnTheirWay {
    static KEYS: OnceLock<KeysOnTheirWay> = OnceLock::new();
    KEYS.get_or_init(|| KeysOnTheirWay {
        count: Mutex::new(HashMap::new()),
        done: Condvar::new(),
    })
}

/// A PROMPTER key on its way, from before it takes the prompter's lock to
/// after the prompter published what it did.
struct KeyOnItsWay<'a> {
    db_path: &'a Path,
}

fn key_on_its_way(db_path: &Path) -> KeyOnItsWay<'_> {
    let keys = keys_on_their_way();
    *keys
        .count
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .entry(db_path.to_path_buf())
        .or_insert(0) += 1;
    KeyOnItsWay { db_path }
}

impl Drop for KeyOnItsWay<'_> {
    fn drop(&mut self) {
        let keys = keys_on_their_way();
        let mut count = keys
            .count
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(on_their_way) = count.get_mut(self.db_path) {
            *on_their_way = on_their_way.saturating_sub(1);
        }
        drop(count);
        keys.done.notify_all();
    }
}

/// Waits, `KEY_WAITED_FOR` at most, until no PROMPTER key of this saved data
/// is on its way.
fn wait_for_keys(db_path: &Path) {
    let keys = keys_on_their_way();
    let until = Instant::now() + KEY_WAITED_FOR;
    let mut count = keys
        .count
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    while count
        .get(db_path)
        .is_some_and(|on_their_way| *on_their_way > 0)
    {
        let now = Instant::now();
        if now >= until {
            return;
        }
        count = keys
            .done
            .wait_timeout(count, until - now)
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .0;
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Page {
    Prompter,
    Cameras,
}

/// What a page's displays say, by their LCD keys.
type Texts = Vec<(&'static str, String)>;

struct KeptTexts {
    at: Instant,
    texts: Texts,
}

type Kept = Mutex<Option<KeptTexts>>;
/// One page's texts for each saved data: the tests, each with a database of
/// its own, never share one.
type KeptByPage = Mutex<HashMap<(PathBuf, Page), Arc<Kept>>>;

static KEPT: OnceLock<KeptByPage> = OnceLock::new();

fn kept(db_path: &Path, page: Page) -> Arc<Kept> {
    let registry = KEPT.get_or_init(|| Mutex::new(HashMap::new()));
    let mut registry = registry
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    Arc::clone(
        registry
            .entry((db_path.to_path_buf(), page))
            .or_insert_with(|| Arc::new(Mutex::new(None))),
    )
}

fn lock(kept: &Kept) -> MutexGuard<'_, Option<KeptTexts>> {
    kept.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn prompter_error(error: PrompterError) -> ControlSurfaceError {
    match error {
        PrompterError::Invalid(message) => ControlSurfaceError::InvalidParams(message),
        PrompterError::Refused(_, message) => ControlSurfaceError::Rejected(message),
        PrompterError::Storage(message) => ControlSurfaceError::Storage(message),
    }
}

fn camera_error(error: CameraError) -> ControlSurfaceError {
    match error {
        CameraError::Invalid(message) => ControlSurfaceError::InvalidParams(message),
        CameraError::Refused(_, message) => ControlSurfaceError::Rejected(message),
        CameraError::Storage(message) => ControlSurfaceError::Storage(message),
    }
}

/// The page a display's key belongs to, when it is one of the two pages'.
fn page_of(key: &str) -> Option<Page> {
    if PROMPTER_LCD_KEYS.contains(&key) {
        Some(Page::Prompter)
    } else if CAMERA_LCD_KEYS.contains(&key) {
        Some(Page::Cameras)
    } else {
        None
    }
}

/// What a display of the PROMPTER or the CAMERAS page says at `at`; `None`
/// for a key of another page. `cameras_simulated` is
/// `SSE_CAMERAS_SIMULATED`, read at the start. The texts are kept from `at`,
/// and the CAMERAS page's say what the armed stop is at `at`; the prompter
/// reads its own clock.
pub(crate) fn page_lcd_text(
    db_path: &Path,
    cameras_simulated: bool,
    key: &str,
    at: Instant,
) -> Option<Result<String, ControlSurfaceError>> {
    let page = page_of(key)?;
    Some(match page {
        Page::Prompter => prompter_texts(db_path).and_then(|texts| text_of(texts, key)),
        Page::Cameras => camera_texts(db_path, cameras_simulated, at, false)
            .and_then(|texts| text_of(texts, key)),
    })
}

/// Every display of the PROMPTER and the CAMERAS pages at `at`, each read as
/// its displays are one by one: the deck's one read a second
/// (`GET /api/deck/displays`, 2026-10-03).
pub(crate) fn page_texts(
    db_path: &Path,
    cameras_simulated: bool,
    at: Instant,
) -> Result<Texts, ControlSurfaceError> {
    let mut texts = prompter_texts(db_path)?;
    texts.extend(camera_texts(db_path, cameras_simulated, at, true)?);
    Ok(texts)
}

/// The PROMPTER page's displays, once no key of the page is on its way, or
/// `KEY_WAITED_FOR` on.
fn prompter_texts(db_path: &Path) -> Result<Texts, ControlSurfaceError> {
    wait_for_keys(db_path);
    crate::prompter::deck::deck_texts(db_path).map_err(prompter_error)
}

/// The CAMERAS page's displays, as kept for `TEXTS_KEPT_FOR` from `at`, or
/// for the deck's one read of every display (`all_at_once`)
/// `DISPLAYS_TEXTS_KEPT_FOR`, unless `REC`'s stop is armed.
fn camera_texts(
    db_path: &Path,
    cameras_simulated: bool,
    at: Instant,
    all_at_once: bool,
) -> Result<Texts, ControlSurfaceError> {
    let kept = kept(db_path, Page::Cameras);
    // Held while the texts are read: the other displays of the same poll
    // wait for this read instead of making their own.
    let mut guard = lock(&kept);
    let fresh = guard.as_ref().is_some_and(|kept| {
        let armed = kept
            .texts
            .iter()
            .any(|(key, text)| *key == "camera_state_rec" && text == "armed");
        let kept_for = if all_at_once && !armed {
            DISPLAYS_TEXTS_KEPT_FOR
        } else {
            TEXTS_KEPT_FOR
        };
        at.saturating_duration_since(kept.at) < kept_for
    });
    if !fresh {
        match crate::cameras::deck::deck_texts_at(db_path, cameras_simulated, at)
            .map_err(camera_error)
        {
            Ok(texts) => {
                *guard = Some(KeptTexts { at, texts });
            }
            Err(error) => {
                *guard = None;
                return Err(error);
            }
        }
    }
    Ok(guard
        .as_ref()
        .map(|kept| kept.texts.clone())
        .unwrap_or_default())
}

/// A display's text among a page's.
fn text_of(texts: Texts, key: &str) -> Result<String, ControlSurfaceError> {
    texts
        .into_iter()
        .find(|(name, _)| *name == key)
        .map(|(_, text)| text)
        .ok_or_else(|| ControlSurfaceError::InvalidParams(format!("Unsupported LCD key: {key}")))
}

/// What a key of the two pages answers, and what the screen is to hear of
/// it: `prompter.changed` or `cameras.changed` as of its own requests, and
/// `app.changed` when a lamp says something else. The bridge raises them
/// once the key is stamped and its row written (`control_surface`), so that
/// a page that reads on the event finds the row.
#[derive(Debug)]
pub(crate) struct PageAnswer {
    pub answer: Value,
    pub events: Vec<(&'static str, Value)>,
}

/// A key or a dial of the PROMPTER or the CAMERAS page, pressed at `at`;
/// `None` for another page's route. The answer says what the key did
/// (`did`). The deck's `REC` counts its dwell and its 3 s from `at`; the
/// prompter reads its own clock.
///
/// The CAMERAS page's kept texts are held from before the key to after it: a
/// display that is asked for meanwhile waits for the key, and is answered as
/// the key left the page, from the key's own read. The PROMPTER page keeps
/// none: its displays read the frame the prompter publishes as the key lets
/// go of the prompter's lock.
pub(crate) fn handle_page_action(
    db_path: &Path,
    cameras_simulated: bool,
    path: &str,
    action: &str,
    value: Option<&str>,
    at: Instant,
) -> Option<Result<PageAnswer, ControlSurfaceError>> {
    match path {
        PROMPTER_ROUTE => return Some(prompter_key(db_path, action, value)),
        CAMERA_ROUTE => {}
        _ => return None,
    }
    let kept = kept(db_path, Page::Cameras);
    let mut guard = lock(&kept);
    let handled = cameras_key(db_path, cameras_simulated, action, value, at);
    Some(match handled {
        Ok((answer, events, texts)) => {
            *guard = Some(KeptTexts { at, texts });
            Ok(PageAnswer { answer, events })
        }
        Err(error) => {
            // A key that was refused may have found the page otherwise than
            // the displays last said: they are read again.
            *guard = None;
            Err(error)
        }
    })
}

/// What a key answers, what the screen is to hear of it, and what the page's
/// displays say after it.
type Handled = Result<(Value, Vec<(&'static str, Value)>, Texts), ControlSurfaceError>;

fn prompter_key(
    db_path: &Path,
    action: &str,
    value: Option<&str>,
) -> Result<PageAnswer, ControlSurfaceError> {
    let on_its_way = key_on_its_way(db_path);
    let reply = crate::prompter::deck::handle_deck_action(db_path, action, value)
        .map_err(prompter_error)?;
    drop(on_its_way);
    let mut events = Vec::new();
    if let Some(reason) = reply.reason {
        events.push((
            EVENT_PROMPTER_CHANGED,
            prompter_changed_payload(reason, reply.anchor.clone()),
        ));
    }
    if reply.health_changed {
        events.push(health_event());
    }
    Ok(PageAnswer {
        answer: answer(reply.result, reply.reason),
        events,
    })
}

fn cameras_key(
    db_path: &Path,
    cameras_simulated: bool,
    action: &str,
    value: Option<&str>,
    at: Instant,
) -> Handled {
    let (reply, texts) =
        crate::cameras::deck::handle_deck_action_at(db_path, cameras_simulated, action, value, at)
            .map_err(camera_error)?;
    let mut events = Vec::new();
    if let Some((reason, camera)) = reply.event {
        events.push((
            EVENT_CAMERAS_CHANGED,
            cameras_changed_payload(reason, camera),
        ));
    }
    if reply.health_changed {
        events.push(health_event());
    }
    Ok((
        answer(reply.result, reply.event.map(|(reason, _)| reason)),
        events,
        texts,
    ))
}

/// `app.changed { reason: "health" }`: a lamp says something else after the
/// key.
fn health_event() -> (&'static str, Value) {
    (
        EVENT_APP_CHANGED,
        json!({ "reason": APP_CHANGED_REASON_HEALTH }),
    )
}

/// The bridge's answer to a key: the request's own answer, `ok`, and what
/// the key did when the answer does not say it itself.
fn answer(result: Value, reason: Option<&'static str>) -> Value {
    let mut answer = match result {
        Value::Object(fields) => fields,
        _ => serde_json::Map::new(),
    };
    answer.insert(String::from("ok"), json!(true));
    if !answer.contains_key("did") {
        answer.insert(String::from("did"), json!(reason));
    }
    Value::Object(answer)
}

#[cfg(test)]
mod tests;
