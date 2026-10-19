//! The session's settings (the Session page's step 2, D52), set in Setup /
//! Support: the sessions' folder, each kind's subfolders, and where the disk
//! reads Low and Nearly full. They stand under the session's own prefix,
//! beside `session.current` and `session.last`, outside the archive as those
//! are: `session.root` (the folder, as a JSON string), `session.subfolders`
//! (the three lists) and `session.thresholds` (the two levels, whole GB). A
//! setting that is absent reads as its default; one that does not read, or
//! that `session.settings.update` would refuse, reads as its default too,
//! with one `WARN` line for its key (`saved_json`). Nothing in the schema
//! changed.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::{Number, Value};

use crate::saved_json::parse_checked_saved_json;
use crate::session::folder::{name_problem, read_drive_path, windows_length, PathProblem};
use crate::session::snapshot::{
    SessionKind, SessionSettings, SessionSettingsReply, SessionSubfolders,
};
use crate::session::{SessionError, SessionReply};
use crate::storage::apply_settings;

pub(crate) const ROOT_KEY: &str = "session.root";
pub(crate) const SUBFOLDERS_KEY: &str = "session.subfolders";
pub(crate) const THRESHOLDS_KEY: &str = "session.thresholds";

/// The sessions' folder of the studio's build, a folder of the app's own
/// that the first Begin makes (D52; the sessions from before stay in
/// `D:\All`).
pub(crate) const DEFAULT_ROOT: &str = r"D:\Sessions";
pub(crate) const DEFAULT_LOW_BELOW_GB: u32 = 200;
pub(crate) const DEFAULT_NEARLY_FULL_BELOW_GB: u32 = 50;

/// The most characters the sessions' folder's path has, as Windows counts
/// them: a session's folder and its subfolders still fit in 200 after it.
pub(crate) const ROOT_MAX_CHARACTERS: usize = 120;
/// The most subfolders a kind has.
pub(crate) const SUBFOLDERS_MAX: usize = 8;
/// The most characters a subfolder's name has, after trimming.
pub(crate) const SUBFOLDER_NAME_MAX_CHARACTERS: usize = 40;
/// The highest level the disk can read Low under.
pub(crate) const THRESHOLD_MAX_GB: u32 = 100_000;

pub(crate) const SESSION_ROOT_INVALID: &str = "SESSION_ROOT_INVALID";
pub(crate) const SESSION_SUBFOLDERS_INVALID: &str = "SESSION_SUBFOLDERS_INVALID";
pub(crate) const SESSION_THRESHOLDS_INVALID: &str = "SESSION_THRESHOLDS_INVALID";

/// `session.changed`'s reason after an update.
pub(crate) const REASON_SETTINGS: &str = "settings";

/// The kinds' subfolders the owner chose (D52).
pub(crate) fn default_subfolders() -> SessionSubfolders {
    let list = |names: &[&str]| names.iter().map(|name| String::from(*name)).collect();
    SessionSubfolders {
        green_screen: list(&["Video", "vMix Recording", "Script", "Exports"]),
        podcast: list(&["Audio", "Video", "vMix Recording", "Exports"]),
        webinar: list(&["Slides", "vMix Recording", "Exports"]),
    }
}

/// The two levels as `session.thresholds` holds them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedThresholds {
    low_below_gb: u32,
    nearly_full_below_gb: u32,
}

/// The settings as saved, each read as its default when it is absent or
/// does not read.
pub(crate) fn read_settings(saved: &HashMap<String, String>) -> SessionSettings {
    let root = saved
        .get(ROOT_KEY)
        .and_then(|raw| parse_checked_saved_json(ROOT_KEY, raw, |root: String| checked_root(&root)))
        .unwrap_or_else(|| String::from(DEFAULT_ROOT));
    let subfolders = saved
        .get(SUBFOLDERS_KEY)
        .and_then(|raw| parse_checked_saved_json(SUBFOLDERS_KEY, raw, checked_subfolders))
        .unwrap_or_else(default_subfolders);
    let thresholds = saved
        .get(THRESHOLDS_KEY)
        .and_then(|raw| {
            parse_checked_saved_json(THRESHOLDS_KEY, raw, |saved: SavedThresholds| {
                checked_thresholds(
                    f64::from(saved.low_below_gb),
                    f64::from(saved.nearly_full_below_gb),
                )
                .map(|()| saved)
            })
        })
        .unwrap_or(SavedThresholds {
            low_below_gb: DEFAULT_LOW_BELOW_GB,
            nearly_full_below_gb: DEFAULT_NEARLY_FULL_BELOW_GB,
        });
    SessionSettings {
        root,
        subfolders,
        low_below_gb: thresholds.low_below_gb,
        nearly_full_below_gb: thresholds.nearly_full_below_gb,
    }
}

/// The sessions' folder as kept, or why it is refused: a folder's full path
/// on a lettered drive, every part a name Windows takes, at most 120
/// characters.
pub(crate) fn checked_root(text: &str) -> Result<String, String> {
    let root = read_drive_path(text).map_err(|problem| match problem {
        PathProblem::Share => String::from(
            "The sessions' folder is on a drive with a letter, such as Public (Z:), not a share's path.",
        ),
        PathProblem::Shape(sentence) => sentence,
    })?;
    let characters = windows_length(&root.text);
    if characters > ROOT_MAX_CHARACTERS {
        return Err(format!(
            "The sessions' folder's path has at most {ROOT_MAX_CHARACTERS} characters; this one has {characters}."
        ));
    }
    Ok(root.text)
}

/// The three lists as kept, each name trimmed, or why one is refused.
fn checked_subfolders(subfolders: SessionSubfolders) -> Result<SessionSubfolders, String> {
    let mut checked = subfolders;
    for kind in SessionKind::ALL {
        let list = checked_list(kind, checked.of(kind))?;
        *checked.of_mut(kind) = list;
    }
    Ok(checked)
}

/// One kind's list as kept, or why it is refused: at most eight names, each
/// 1 to 40 characters after trimming, a name Windows takes, and no two that
/// Windows takes for one.
pub(crate) fn checked_list(kind: SessionKind, names: &[String]) -> Result<Vec<String>, String> {
    let what = kind.name();
    if names.len() > SUBFOLDERS_MAX {
        return Err(format!(
            "{what} has at most {SUBFOLDERS_MAX} subfolders; this list has {}.",
            names.len()
        ));
    }
    let mut kept: Vec<String> = Vec::with_capacity(names.len());
    for name in names {
        let name = name.trim();
        if name.is_empty() {
            return Err(format!("A subfolder of {what} has no name."));
        }
        let characters = name.chars().count();
        if characters > SUBFOLDER_NAME_MAX_CHARACTERS {
            return Err(format!(
                "\"{name}\" has {characters} characters: a subfolder's name has at most {SUBFOLDER_NAME_MAX_CHARACTERS}."
            ));
        }
        if let Some(problem) = name_problem(name) {
            return Err(problem);
        }
        if let Some(earlier) = kept
            .iter()
            .find(|earlier| earlier.to_lowercase() == name.to_lowercase())
        {
            return Err(if earlier == name {
                format!("{what} has \"{name}\" twice.")
            } else {
                format!(
                    "{what} has \"{earlier}\" and \"{name}\", which Windows takes for one name."
                )
            });
        }
        kept.push(String::from(name));
    }
    Ok(kept)
}

/// Why the two levels are refused, or nothing: Nearly full at least 1 GB,
/// Low above it and at most 100,000 GB.
fn checked_thresholds(low: f64, nearly_full: f64) -> Result<(), String> {
    if nearly_full < 1.0 {
        return Err(String::from("Nearly full is at least 1 GB."));
    }
    if low <= nearly_full {
        return Err(format!(
            "Low must be above Nearly full: Low under {low} GB, Nearly full under {nearly_full} GB."
        ));
    }
    if low > f64::from(THRESHOLD_MAX_GB) {
        return Err(String::from("Low is at most 100,000 GB."));
    }
    Ok(())
}

/// `session.settings.update`'s request.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SettingsUpdate {
    #[serde(default)]
    root: Option<String>,
    #[serde(default)]
    subfolders: Option<SubfoldersUpdate>,
    #[serde(default)]
    low_below_gb: Option<Number>,
    #[serde(default)]
    nearly_full_below_gb: Option<Number>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SubfoldersUpdate {
    #[serde(default, rename = "green-screen")]
    green_screen: Option<Vec<String>>,
    #[serde(default)]
    podcast: Option<Vec<String>>,
    #[serde(default)]
    webinar: Option<Vec<String>>,
}

impl SubfoldersUpdate {
    fn of(&self, kind: SessionKind) -> Option<&Vec<String>> {
        match kind {
            SessionKind::GreenScreen => self.green_screen.as_ref(),
            SessionKind::Podcast => self.podcast.as_ref(),
            SessionKind::Webinar => self.webinar.as_ref(),
        }
    }
}

/// A level as given, a whole number of GB, or the refusal.
fn whole_gb(value: &Number, label: &str) -> Result<f64, SessionError> {
    let gb = value.as_f64().unwrap_or(f64::NAN);
    if !gb.is_finite() || gb.fract() != 0.0 {
        return Err(SessionError::Refused(
            SESSION_THRESHOLDS_INVALID,
            format!("{label} is a whole number of GB; {value} is not."),
        ));
    }
    Ok(gb)
}

/// `session.settings.update { root?, subfolders?, lowBelowGb?,
/// nearlyFullBelowGb? }`: what it gives is checked and written in one
/// transaction, and it answers the settings after it. `subfolders` gives a
/// list for any of the kinds; a level given alone is checked with the other
/// as saved. The checks run in this order: the request's shape
/// (`INVALID_PARAMS`), the folder, the lists, the levels.
pub(crate) fn update_settings(
    db_path: &std::path::Path,
    saved: SessionSettings,
    params: &Value,
) -> Result<SessionReply, SessionError> {
    let update: SettingsUpdate = serde_json::from_value(params.clone())
        .map_err(|error| SessionError::Invalid(format!("session.settings.update: {error}")))?;
    let gives_subfolders = update.subfolders.as_ref().is_some_and(|subfolders| {
        SessionKind::ALL
            .iter()
            .any(|kind| subfolders.of(*kind).is_some())
    });
    if update.root.is_none()
        && !gives_subfolders
        && update.low_below_gb.is_none()
        && update.nearly_full_below_gb.is_none()
    {
        return Err(SessionError::Invalid(String::from(
            "session.settings.update gives none of root, subfolders, lowBelowGb and nearlyFullBelowGb",
        )));
    }

    let mut settings = saved;
    let mut writes: Vec<(&str, String)> = Vec::new();
    if let Some(root) = &update.root {
        settings.root = checked_root(root)
            .map_err(|sentence| SessionError::Refused(SESSION_ROOT_INVALID, sentence))?;
        writes.push((ROOT_KEY, serde_json::to_string(&settings.root)?));
    }
    if let (true, Some(subfolders)) = (gives_subfolders, &update.subfolders) {
        for kind in SessionKind::ALL {
            if let Some(names) = subfolders.of(kind) {
                *settings.subfolders.of_mut(kind) =
                    checked_list(kind, names).map_err(|sentence| {
                        SessionError::Refused(SESSION_SUBFOLDERS_INVALID, sentence)
                    })?;
            }
        }
        writes.push((SUBFOLDERS_KEY, serde_json::to_string(&settings.subfolders)?));
    }
    if update.low_below_gb.is_some() || update.nearly_full_below_gb.is_some() {
        let low = match &update.low_below_gb {
            Some(value) => whole_gb(value, "Low")?,
            None => f64::from(settings.low_below_gb),
        };
        let nearly_full = match &update.nearly_full_below_gb {
            Some(value) => whole_gb(value, "Nearly full")?,
            None => f64::from(settings.nearly_full_below_gb),
        };
        checked_thresholds(low, nearly_full)
            .map_err(|sentence| SessionError::Refused(SESSION_THRESHOLDS_INVALID, sentence))?;
        // Both are whole and between 1 and 100,000 now.
        let thresholds = SavedThresholds {
            low_below_gb: low as u32,
            nearly_full_below_gb: nearly_full as u32,
        };
        settings.low_below_gb = thresholds.low_below_gb;
        settings.nearly_full_below_gb = thresholds.nearly_full_below_gb;
        writes.push((THRESHOLDS_KEY, serde_json::to_string(&thresholds)?));
    }
    apply_settings(db_path, &writes, &[])?;
    Ok(SessionReply {
        result: serde_json::to_value(SessionSettingsReply { settings })?,
        event: Some(REASON_SETTINGS),
    })
}
