//! The `session.*` methods (the Session page, 2026-10-15; `v1.md`'s
//! "Session" section): the read, a begin, an end, and the settings' update.
//! What the operator reads of a refusal is written here, in `folder.rs` and
//! in `settings.rs`.
//!
//! The order of the checks for a begin: the request's shape
//! (`INVALID_PARAMS`), then a kind the hardware link does not know, then a
//! name too long; then its folder's, in `folder.rs`'s order. A begin while a
//! session runs ends that one first, in the same write, once its folder is
//! made.

use crate::cameras::runtime::utc_text;
use crate::saved_json::parse_saved_json;
use crate::session::folder::{local_day, make_folder, plan_folder};
use crate::session::places::Places;
use crate::session::settings::{read_settings, update_settings};
use crate::session::snapshot::{
    Session, SessionBeginReply, SessionEndReply, SessionFolderChoice, SessionKind, SessionSnapshot,
};
use crate::session::{SessionError, SessionReply};
use crate::storage::{apply_settings, list_settings_by_prefix};
use serde_json::Value;
use std::path::Path;
use std::time::SystemTime;

/// The prefix of the session's settings: outside `shell.` and `app.`, so no
/// archive carries them and a restore of one leaves them as they are
/// (`support::RESTORE_KEY_PREFIXES`).
pub(crate) const SESSION_SETTINGS_PREFIX: &str = "session.";
/// The running session, as JSON; absent while none runs.
pub(crate) const CURRENT_KEY: &str = "session.current";
/// The last session of each kind, as a JSON list, newest first: the order
/// they ended in, written so.
pub(crate) const LAST_KEY: &str = "session.last";

/// The most characters a session's name has, after trimming. The page's
/// field stops there too.
pub(crate) const NAME_MAX_CHARACTERS: usize = 80;

pub(crate) const SESSION_KIND_UNKNOWN: &str = "SESSION_KIND_UNKNOWN";
pub(crate) const SESSION_NAME_TOO_LONG: &str = "SESSION_NAME_TOO_LONG";
pub(crate) const SESSION_NOT_RUNNING: &str = "SESSION_NOT_RUNNING";

/// `session.changed`'s reasons (`settings` is `settings.rs`'s).
pub(crate) const REASON_BEGUN: &str = "begun";
pub(crate) const REASON_ENDED: &str = "ended";

/// `INVALID_PARAMS`'s sentence for a begin without a kind.
const KIND_REFUSAL: &str = "kind must be one of: green-screen, podcast, webinar";

/// Answers one `session.*` request. `places` says where this run makes the
/// sessions' folders; `now` is the time a begin or an end is stamped with.
pub(crate) fn handle_session_request(
    db_path: &Path,
    places: &Places,
    method: &str,
    params: &Value,
    now: SystemTime,
) -> Result<SessionReply, SessionError> {
    match method {
        "session.snapshot" => Ok(SessionReply {
            result: serde_json::to_value(read_session(db_path, places)?)?,
            event: None,
        }),
        "session.begin" => begin(db_path, places, params, now),
        "session.end" => end(db_path, places, now),
        "session.settings.update" => {
            update_settings(db_path, read_session(db_path, places)?.settings, params)
        }
        other => Err(SessionError::Invalid(format!(
            "Unsupported method: {other}"
        ))),
    }
}

/// What the settings hold: the running session, the last of each kind and
/// the settings, with the places. A session that does not read is absent,
/// and the log says so once for its key (`saved_json`): `session.current` is
/// written again by the next begin (an end is refused, since none reads as
/// running), `session.last` when a session next ends. Nothing here reads the
/// disk.
pub(crate) fn read_session(
    db_path: &Path,
    places: &Places,
) -> Result<SessionSnapshot, SessionError> {
    let saved = list_settings_by_prefix(db_path, SESSION_SETTINGS_PREFIX)?;
    let current = saved
        .get(CURRENT_KEY)
        .and_then(|raw| parse_saved_json::<Session>(CURRENT_KEY, raw));
    let last = saved
        .get(LAST_KEY)
        .and_then(|raw| parse_saved_json::<Vec<Session>>(LAST_KEY, raw))
        .unwrap_or_default();
    let settings = read_settings(&saved);
    let places = places.snapshot(&settings.root);
    Ok(SessionSnapshot {
        current,
        last: one_of_each_kind(last),
        settings,
        places,
    })
}

/// The begin's `folder`: a new folder on the sessions' folder when it is
/// absent or `null`.
fn folder_choice(params: &Value) -> Result<SessionFolderChoice, SessionError> {
    match params.get("folder") {
        None | Some(Value::Null) => Ok(SessionFolderChoice::New { parent: None }),
        Some(folder) => serde_json::from_value(folder.clone())
            .map_err(|error| SessionError::Invalid(format!("folder: {error}"))),
    }
}

/// `session.begin { kind, name?, folder? }`: the session's folder is made or
/// chosen, then the session begins now, and a running one ends at the same
/// moment and becomes its kind's last. Both settings are written in one
/// transaction, after the folder.
fn begin(
    db_path: &Path,
    places: &Places,
    params: &Value,
    now: SystemTime,
) -> Result<SessionReply, SessionError> {
    let Some(id) = params.get("kind").and_then(Value::as_str) else {
        return Err(SessionError::Invalid(String::from(KIND_REFUSAL)));
    };
    let name = match params.get("name") {
        None | Some(Value::Null) => "",
        Some(Value::String(name)) => name.trim(),
        Some(_) => return Err(SessionError::Invalid(String::from("name must be a string"))),
    };
    let Some(kind) = SessionKind::from_id(id) else {
        return Err(SessionError::Refused(
            SESSION_KIND_UNKNOWN,
            format!("\"{id}\" is not a kind of session: the kinds are green-screen, podcast and webinar."),
        ));
    };
    let characters = name.chars().count();
    if characters > NAME_MAX_CHARACTERS {
        return Err(SessionError::Refused(
            SESSION_NAME_TOO_LONG,
            format!(
                "A session's name has at most {NAME_MAX_CHARACTERS} characters; this one has {characters}."
            ),
        ));
    }
    let choice = folder_choice(params)?;

    let SessionSnapshot {
        current,
        last,
        settings,
        ..
    } = read_session(db_path, places)?;
    let plan = plan_folder(
        &choice,
        kind,
        name,
        &local_day(now)?,
        &settings.root,
        settings.subfolders.of(kind),
        places,
    )?;
    let folder = make_folder(plan)?;

    let at = utc_text(now);
    let ended = current.map(|running| Session {
        ended_at: Some(at.clone()),
        ..running
    });
    let session = Session {
        kind,
        name: String::from(name),
        begun_at: at,
        ended_at: None,
        folder: Some(folder.path.clone()),
    };
    let mut writes = vec![(CURRENT_KEY, serde_json::to_string(&session)?)];
    if let Some(ended) = &ended {
        writes.push((LAST_KEY, serde_json::to_string(&with_last(last, ended))?));
    }
    apply_settings(db_path, &writes, &[])?;
    Ok(SessionReply {
        result: serde_json::to_value(SessionBeginReply {
            session,
            ended,
            folder,
        })?,
        event: Some(REASON_BEGUN),
    })
}

/// `session.end`: the running session ends now and becomes its kind's last;
/// `session.current` is removed in the same transaction. Its folder is left
/// as it is.
fn end(db_path: &Path, places: &Places, now: SystemTime) -> Result<SessionReply, SessionError> {
    let SessionSnapshot { current, last, .. } = read_session(db_path, places)?;
    let Some(running) = current else {
        return Err(SessionError::Refused(
            SESSION_NOT_RUNNING,
            String::from("No session is running, so there is none to end."),
        ));
    };
    let ended = Session {
        ended_at: Some(utc_text(now)),
        ..running
    };
    apply_settings(
        db_path,
        &[(LAST_KEY, serde_json::to_string(&with_last(last, &ended))?)],
        &[CURRENT_KEY],
    )?;
    Ok(SessionReply {
        result: serde_json::to_value(SessionEndReply { ended })?,
        event: Some(REASON_ENDED),
    })
}

/// The last sessions with `ended` first, in its kind's place.
fn with_last(last: Vec<Session>, ended: &Session) -> Vec<Session> {
    one_of_each_kind(std::iter::once(ended.clone()).chain(last).collect())
}

/// The first session of each kind, in the order given: the list is written
/// newest first, so a kind's first is its last session.
fn one_of_each_kind(sessions: Vec<Session>) -> Vec<Session> {
    let mut kinds = Vec::new();
    sessions
        .into_iter()
        .filter(|session| {
            let first = !kinds.contains(&session.kind);
            kinds.push(session.kind);
            first
        })
        .collect()
}
