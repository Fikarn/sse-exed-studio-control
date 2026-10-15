//! What the session reads out (`session.snapshot`) and what `session.begin`
//! and `session.end` answer. The shapes are `v1.md`'s "Session" section; a
//! `Session` is also what the two settings hold.

use serde::{Deserialize, Serialize};

/// The kinds of session (D51), in the Session page's order. The hardware
/// link knows them by their ids; the pages hold the words and the drawings,
/// and the action log's sentence alone names them (`SessionKind::name`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
#[serde(rename_all = "kebab-case")]
pub enum SessionKind {
    /// A presenter at the green screen, with the prompter.
    GreenScreen,
    /// Voices around the table, a camera on each.
    Podcast,
    /// Live, to an audience online.
    Webinar,
}

impl SessionKind {
    /// Every kind, in the page's order.
    pub const ALL: [SessionKind; 3] = [Self::GreenScreen, Self::Podcast, Self::Webinar];

    /// The id the contract carries, and the action log's target.
    pub fn id(self) -> &'static str {
        match self {
            Self::GreenScreen => "green-screen",
            Self::Podcast => "podcast",
            Self::Webinar => "webinar",
        }
    }

    /// The kind its id names; `None` for any other text.
    pub fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|kind| kind.id() == id)
    }

    /// The kind in the operator's words, as the action log's sentence says
    /// it: Setup / Support's Recent actions show the sentence alone. The
    /// Session page holds the same three names for its Rooms.
    pub fn name(self) -> &'static str {
        match self {
            Self::GreenScreen => "Green Screen Recording",
            Self::Podcast => "Podcast Recording",
            Self::Webinar => "Webinar",
        }
    }
}

/// One session: the running one, a last one, or one a request ended.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct Session {
    pub kind: SessionKind,
    /// The name the operator gave it, trimmed, at most 80 characters; empty
    /// when none was given.
    pub name: String,
    /// When it began: UTC, `2026-10-15T07:16:00.000Z`.
    #[serde(rename = "begunAt")]
    pub begun_at: String,
    /// When it ended, in the same shape; `null` while it runs.
    #[serde(rename = "endedAt")]
    pub ended_at: Option<String>,
}

/// `session.snapshot`: the running session and the last of each kind.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct SessionSnapshot {
    /// The running session; `null` when none runs.
    pub current: Option<Session>,
    /// The last ended session of each kind, newest first, at most one per
    /// kind; a kind never used has none.
    pub last: Vec<Session>,
}

/// `session.begin`'s answer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct SessionBeginReply {
    /// The session that now runs.
    pub session: Session,
    /// The session this begin ended, when one was running; `null` otherwise.
    pub ended: Option<Session>,
}

/// `session.end`'s answer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct SessionEndReply {
    /// The session that ended.
    pub ended: Session,
}
