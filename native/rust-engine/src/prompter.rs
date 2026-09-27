//! The Teleprompter in the hardware link (new pages program, Slice 4): the
//! scripts and the prompter in the saved data, the scroll's clock, the
//! `prompter.*` methods and the import. The design is
//! `docs/redesign/teleprompter-2026-09.md` (the ledger's D20), and the
//! slice's first steps, answered by the operator on 2026-09-27, are recorded
//! under the ledger's Slice 4.

pub(crate) mod archive;
pub(crate) mod clock;
pub(crate) mod commands;
pub(crate) mod edits;
pub(crate) mod import;
pub(crate) mod look;
pub(crate) mod model;
pub(crate) mod runtime;
pub(crate) mod screen;
pub(crate) mod snapshot;
pub(crate) mod store;
#[cfg(test)]
pub(crate) mod test_support;
#[cfg(test)]
mod tests_glass;
#[cfg(test)]
mod tests_screen;
#[cfg(test)]
mod tests_scripts;

use crate::prompter::clock::PrompterAnchor;
use serde_json::Value;

pub(crate) use commands::{after_archive_restore, handle_prompter_request, prompter_health_check};
pub(crate) use runtime::spawn_prompter_clock;

/// A refused or failed `prompter.*` request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PrompterError {
    /// The request's parameters are wrong: `INVALID_PARAMS`.
    Invalid(String),
    /// A sound request the prompter refuses now, with its code and the
    /// sentence the operator reads.
    Refused(&'static str, String),
    /// The saved data could not be read or written: `STORAGE_ERROR`.
    Storage(String),
}

impl From<Box<dyn std::error::Error + Send + Sync>> for PrompterError {
    fn from(error: Box<dyn std::error::Error + Send + Sync>) -> Self {
        Self::Storage(error.to_string())
    }
}

impl From<rusqlite::Error> for PrompterError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Storage(error.to_string())
    }
}

impl From<serde_json::Error> for PrompterError {
    fn from(error: serde_json::Error) -> Self {
        Self::Storage(error.to_string())
    }
}

/// What a `prompter.*` request answers, and what `prompter.changed` says of
/// it.
#[derive(Debug, Clone)]
pub(crate) struct PrompterReply {
    pub result: Value,
    /// The event's reason; `None` for a read or a change that moves nothing.
    pub reason: Option<&'static str>,
    /// The glass's anchor after the request; `None` when nothing is on it.
    pub anchor: Option<PrompterAnchor>,
    /// `checks.prompter` says something else after the request (Slice 5a):
    /// the reply also raises `app.changed { reason: "health" }`, so the
    /// header's lamp follows.
    pub health_changed: bool,
}
