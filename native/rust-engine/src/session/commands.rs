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
use crate::diagnostics::{log_event, LogLevel};
use crate::saved_json::parse_saved_json;
use crate::session::folder::{local_day, make_folder, plan_folder};
use crate::session::places::Places;
use crate::session::settings::{read_settings, update_settings};
use crate::session::snapshot::{
    Session, SessionBeginReply, SessionEndReply, SessionFolderChoice, SessionKind, SessionSettings,
    SessionSnapshot,
};
use crate::session::watch::{snapshot_of, WatchReport};
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
/// sessions' folders; `watch` is the sessions' watch's last report (`None`
/// before its first pass); `now` is the time a begin or an end is stamped
/// with.
pub(crate) fn handle_session_request(
    db_path: &Path,
    places: &Places,
    watch: Option<&WatchReport>,
    method: &str,
    params: &Value,
    now: SystemTime,
) -> Result<SessionReply, SessionError> {
    match method {
        "session.snapshot" => Ok(SessionReply {
            result: serde_json::to_value(read_session(db_path, places, watch)?)?,
            event: None,
        }),
        "session.begin" => begin(db_path, places, watch, params, now),
        "session.end" => end(db_path, watch, now),
        "session.settings.update" => {
            update_settings(db_path, read_saved(db_path)?.settings, params)
        }
        other => Err(SessionError::Invalid(format!(
            "Unsupported method: {other}"
        ))),
    }
}

/// What the session's settings hold: the running session, the last of each
/// kind and Setup's settings.
#[derive(Debug, Clone)]
pub(crate) struct Saved {
    pub current: Option<Session>,
    pub last: Vec<Session>,
    pub settings: SessionSettings,
}

/// The saved part. A session that does not read is absent, and the log
/// says so once for its key (`saved_json`): `session.current` is written
/// again by the next begin (an end is refused, since none reads as
/// running), `session.last` when a session next ends. Nothing here reads
/// the disk.
pub(crate) fn read_saved(db_path: &Path) -> Result<Saved, SessionError> {
    let saved = list_settings_by_prefix(db_path, SESSION_SETTINGS_PREFIX)?;
    let current = saved
        .get(CURRENT_KEY)
        .and_then(|raw| parse_saved_json::<Session>(CURRENT_KEY, raw));
    let last = saved
        .get(LAST_KEY)
        .and_then(|raw| parse_saved_json::<Vec<Session>>(LAST_KEY, raw))
        .unwrap_or_default();
    Ok(Saved {
        current,
        last: one_of_each_kind(last),
        settings: read_settings(&saved),
    })
}

/// `session.snapshot`: the saved part, the places, and what the sessions'
/// watch last read (`watch::snapshot_of`). Nothing here reads the disk.
pub(crate) fn read_session(
    db_path: &Path,
    places: &Places,
    watch: Option<&WatchReport>,
) -> Result<SessionSnapshot, SessionError> {
    Ok(snapshot_of(read_saved(db_path)?, places, watch))
}

/// A session ending now: its end, and its folder's last measure kept with
/// it, the watch's when it has one.
fn ending(running: Session, at: String, watch: Option<&WatchReport>) -> Session {
    let measured = running
        .folder
        .as_deref()
        .and_then(|folder| watch.and_then(|watch| watch.size_of(folder)));
    Session {
        ended_at: Some(at),
        folder_bytes: measured.or(running.folder_bytes),
        ..running
    }
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
/// moment and becomes its kind's last, with its folder's last measure. Both
/// settings are written in one transaction, after the folder.
fn begin(
    db_path: &Path,
    places: &Places,
    watch: Option<&WatchReport>,
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

    let Saved {
        current,
        last,
        settings,
    } = read_saved(db_path)?;
    let plan = plan_folder(
        &choice,
        kind,
        name,
        &local_day(now)?,
        &settings.root,
        settings.subfolders.of(kind),
        places,
        &watch.map(WatchReport::not_answering).unwrap_or_default(),
    )?;
    let folder = make_folder(plan)?;

    let at = utc_text(now);
    let ended = current.map(|running| ending(running, at.clone(), watch));
    let session = Session {
        kind,
        name: String::from(name),
        begun_at: at,
        ended_at: None,
        folder: Some(folder.path.clone()),
        folder_bytes: None,
    };
    let mut writes = vec![(CURRENT_KEY, serde_json::to_string(&session)?)];
    if let Some(ended) = &ended {
        writes.push((LAST_KEY, serde_json::to_string(&with_last(last, ended))?));
    }
    apply_settings(db_path, &writes, &[]).map_err(|error| {
        let error = SessionError::from(error);
        if folder.made {
            unsaved_after_making(error, &folder.path)
        } else {
            error
        }
    })?;
    Ok(SessionReply {
        result: serde_json::to_value(SessionBeginReply {
            session,
            ended,
            folder,
        })?,
        event: Some(REASON_BEGUN),
    })
}

/// A begin that made its folder and then could not write the session: the
/// sentence and the log say that the folder stays (the review of #354).
fn unsaved_after_making(error: SessionError, folder: &str) -> SessionError {
    match error {
        SessionError::Storage(message) => {
            log_event(
                LogLevel::Warn,
                &format!("A Begin made {folder} and then could not save the session: {message}"),
            );
            SessionError::Storage(format!(
                "{}. {folder} was made, and is left as it is.",
                message.trim_end_matches('.')
            ))
        }
        other => other,
    }
}

/// `session.end`: the running session ends now and becomes its kind's last,
/// with its folder's last measure (no walk runs here: the watch's measure
/// is taken); `session.current` is removed in the same transaction. Its
/// folder is left as it is.
fn end(
    db_path: &Path,
    watch: Option<&WatchReport>,
    now: SystemTime,
) -> Result<SessionReply, SessionError> {
    let Saved { current, last, .. } = read_saved(db_path)?;
    let Some(running) = current else {
        return Err(SessionError::Refused(
            SESSION_NOT_RUNNING,
            String::from("No session is running, so there is none to end."),
        ));
    };
    let ended = ending(running, utc_text(now), watch);
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
