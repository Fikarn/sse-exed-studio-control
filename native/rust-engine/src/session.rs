//! The session (the Session page, 2026-10-15, D51): what the studio is
//! making, chosen on the Session page as a Green Screen Recording, a Podcast
//! Recording or a Webinar, with a name the operator may give it. A session
//! lasts from its `Begin` until `End session`, or until another session
//! begins; no clock ends it. Since step 2 (D52) a session has a folder,
//! which its Begin makes or chooses (`folder.rs`); an end changes nothing in
//! the studio.
//!
//! The hardware link keeps it in settings under a prefix of their own,
//! `session.`, outside the archive's restore as the cameras' releases are: a
//! restored archive brings no old session back, and a database backup
//! restored whole keeps them. `session.current` is the running session, and
//! `session.last` the last session of each kind, newest first, which the
//! page's window offers as "Last time": the action log's 5,000 rows would
//! lose a kind not used for months. The log keeps a row for each begin and
//! end all the same (`action_log::ui_actions`). Beside them stand the
//! settings Setup / Support sets: the sessions' folder, each kind's
//! subfolders and the disk's levels (`settings.rs`). Where a run makes its
//! folders is `places.rs`'s. The contract is `v1.md`'s "Session" section.
//!
//! Every `session.*` request is answered in turn on the request loop (none
//! runs aside, `main.rs`), and nothing else writes these settings, so a
//! begin's read and its write cannot cross another's.

pub(crate) mod commands;
pub(crate) mod folder;
pub(crate) mod places;
pub(crate) mod settings;
pub(crate) mod snapshot;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_folder;

pub(crate) use commands::handle_session_request;
pub(crate) use places::Places;

/// A refused or failed `session.*` request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum SessionError {
    /// The request's parameters are wrong: `INVALID_PARAMS`.
    Invalid(String),
    /// A sound request the hardware link refuses, with its code and the
    /// sentence the operator reads.
    Refused(&'static str, String),
    /// The saved data could not be read or written: `STORAGE_ERROR`.
    Storage(String),
}

impl From<Box<dyn std::error::Error + Send + Sync>> for SessionError {
    fn from(error: Box<dyn std::error::Error + Send + Sync>) -> Self {
        Self::Storage(error.to_string())
    }
}

impl From<serde_json::Error> for SessionError {
    fn from(error: serde_json::Error) -> Self {
        Self::Storage(error.to_string())
    }
}

/// What a `session.*` request answers, and the reason `session.changed`
/// gives for it (`None` for a read).
#[derive(Debug, Clone)]
pub(crate) struct SessionReply {
    pub result: serde_json::Value,
    pub event: Option<&'static str>,
}
