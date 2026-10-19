//! What the session reads out (`session.snapshot`), what `session.begin`
//! takes for its folder, and what the session's requests answer. The shapes
//! are `v1.md`'s "Session" section; a `Session` is also what the settings
//! `session.current` and `session.last` hold.

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
    /// Its folder, as Windows writes the path (D52): the one its Begin made
    /// or chose. `null` for a session begun before sessions had folders,
    /// whose saved form has none.
    #[serde(default)]
    pub folder: Option<String>,
}

/// Each kind's subfolders, which a Begin makes in a new session's folder
/// (D52), in the order made; a kind may have none.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct SessionSubfolders {
    #[serde(rename = "green-screen")]
    pub green_screen: Vec<String>,
    pub podcast: Vec<String>,
    pub webinar: Vec<String>,
}

impl SessionSubfolders {
    /// One kind's list.
    pub fn of(&self, kind: SessionKind) -> &[String] {
        match kind {
            SessionKind::GreenScreen => &self.green_screen,
            SessionKind::Podcast => &self.podcast,
            SessionKind::Webinar => &self.webinar,
        }
    }

    pub(crate) fn of_mut(&mut self, kind: SessionKind) -> &mut Vec<String> {
        match kind {
            SessionKind::GreenScreen => &mut self.green_screen,
            SessionKind::Podcast => &mut self.podcast,
            SessionKind::Webinar => &mut self.webinar,
        }
    }
}

/// The session's settings (D52), set in Setup / Support: the sessions'
/// folder, each kind's subfolders, and where the disk reads Low and Nearly
/// full, in whole GB as Explorer counts them (1 GB = 1024³ bytes).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct SessionSettings {
    /// The sessions' folder the studio's build makes them on, as Windows
    /// writes it (`D:\Sessions`).
    pub root: String,
    pub subfolders: SessionSubfolders,
    /// The disk reads Low under this many GB free.
    pub low_below_gb: u32,
    /// And Nearly full under this many.
    pub nearly_full_below_gb: u32,
}

/// Where this run makes the sessions' folders (D52).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct SessionPlaces {
    /// The sessions' folder a new session's folder goes on: the setting's
    /// root in the studio's build, else the run's own scratch folder.
    pub root: String,
    /// The run keeps its sessions' folders beside its own saved data: a
    /// development build, a test, a lane and the release's trial.
    pub simulated: bool,
}

/// `session.snapshot`: the running session, the last of each kind, the
/// settings and the places.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct SessionSnapshot {
    /// The running session; `null` when none runs.
    pub current: Option<Session>,
    /// The last ended session of each kind, newest first, at most one per
    /// kind; a kind never used has none.
    pub last: Vec<Session>,
    pub settings: SessionSettings,
    pub places: SessionPlaces,
}

/// `session.begin`'s `folder` (D52): a new folder, on the sessions' folder
/// or in the folder `parent` names, or a folder that exists, used as it is.
/// Absent, it is a new folder on the sessions' folder.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
#[serde(tag = "mode", rename_all = "kebab-case", deny_unknown_fields)]
pub enum SessionFolderChoice {
    New {
        #[serde(default)]
        #[cfg_attr(feature = "ts-rs", ts(optional = nullable))]
        parent: Option<String>,
    },
    Existing {
        path: String,
    },
}

/// The folder a begin made or chose.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct SessionFolderMade {
    /// The session's folder, as Windows writes the path.
    pub path: String,
    /// This begin made it, with the kind's subfolders; `false` when it was
    /// there already and is used as it is.
    pub made: bool,
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
    pub folder: SessionFolderMade,
}

/// `session.settings.update`'s answer: the settings after it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct SessionSettingsReply {
    pub settings: SessionSettings,
}

/// `session.end`'s answer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct SessionEndReply {
    /// The session that ended.
    pub ended: Session,
}
