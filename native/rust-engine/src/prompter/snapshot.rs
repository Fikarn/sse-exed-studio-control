//! What the prompter reads out (`prompter.snapshot`, `prompter.glass.snapshot`
//! and `prompter.script.snapshot`): only what the hardware link holds, never
//! what a view drew.
//!
//! Since 2026-10-02 the glass's part comes from the prompter's memory, and
//! the scripts' rows are read before the prompter's lock is taken; the glass
//! script's row then takes the newest place and pace the saver holds, so a
//! new pace reads at once although the disk has it a moment later.

use crate::prompter::clock::{PrompterAnchor, PrompterPlace};
use crate::prompter::look::PrompterLook;
use crate::prompter::model::{cue_targets, PrompterParagraph};
use crate::prompter::runtime::Prompter;
use crate::prompter::screen::PrompterScreenSummary;
use crate::prompter::store::{self, ScriptRow, StoredScript, VersionRow};
use crate::prompter::PrompterError;
use rusqlite::Connection;
use serde::Serialize;
use std::cmp::Ordering;
use std::time::Instant;

/// A cue on a line of its own: a jump target and a key on the page.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct PrompterCue {
    pub paragraph: u32,
    pub word: u32,
    /// The cue's words, brackets taken off.
    pub text: String,
}

/// One script in the lists.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct PrompterScriptSummary {
    pub id: String,
    pub name: String,
    /// The file it came from, without its folder; `null` for a pasted or new
    /// script.
    #[serde(rename = "sourceFileName")]
    pub source_file_name: Option<String>,
    #[serde(rename = "paragraphCount")]
    pub paragraph_count: u32,
    /// The words the presenter reads (cues left out).
    #[serde(rename = "readWords")]
    pub read_words: u32,
    #[serde(rename = "speedWpm")]
    pub speed_wpm: u32,
    /// The length at the script's own pace, from the words.
    #[serde(rename = "lengthSeconds")]
    pub length_seconds: f64,
    pub place: PrompterPlace,
    #[serde(rename = "atEnd")]
    pub at_end: bool,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "changedAt")]
    pub changed_at: String,
    #[serde(rename = "removedAt")]
    pub removed_at: Option<String>,
    #[serde(rename = "onPrompter")]
    pub on_prompter: bool,
}

/// The script on the glass, as the prompter runs it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct PrompterGlassSummary {
    #[serde(rename = "scriptId")]
    pub script_id: String,
    pub name: String,
    /// The layout the view must report for the glass as it is now.
    #[serde(rename = "layoutKey")]
    pub layout_key: String,
    /// Whether the hardware link holds that layout.
    #[serde(rename = "laidOut")]
    pub laid_out: bool,
    /// The script was edited after it went on; the glass still shows the
    /// earlier text until Update.
    #[serde(rename = "notUpdated")]
    pub not_updated: bool,
    #[serde(rename = "speedWpm")]
    pub speed_wpm: u32,
    pub place: PrompterPlace,
    #[serde(rename = "paragraphCount")]
    pub paragraph_count: u32,
    pub playing: bool,
    #[serde(rename = "atEnd")]
    pub at_end: bool,
    /// Until `END` reaches the reading line at the pace (§5.3); while paused,
    /// how long a play would take.
    #[serde(rename = "timeLeftSeconds")]
    pub time_left_seconds: f64,
    /// The whole script at the pace, from the top.
    #[serde(rename = "lengthSeconds")]
    pub length_seconds: f64,
    /// True while the times come from the words, before a layout.
    pub estimated: bool,
    pub cues: Vec<PrompterCue>,
    pub anchor: PrompterAnchor,
}

/// `prompter.snapshot`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct PrompterSnapshot {
    pub look: PrompterLook,
    /// The take's text size; the standard is in the look.
    #[serde(rename = "sizePx")]
    pub size_px: u32,
    /// `null` when nothing is on the prompter.
    pub glass: Option<PrompterGlassSummary>,
    /// The scripts, sorted by name with numbers in their natural order.
    pub scripts: Vec<PrompterScriptSummary>,
    /// Removed, the most recently removed first.
    pub removed: Vec<PrompterScriptSummary>,
    /// The Prompter XL as Windows last reported it (Slice 5a).
    pub screen: PrompterScreenSummary,
}

/// `prompter.glass.snapshot`: what the glass draws.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct PrompterGlassSnapshot {
    #[serde(rename = "scriptId")]
    pub script_id: Option<String>,
    pub name: Option<String>,
    #[serde(rename = "layoutKey")]
    pub layout_key: Option<String>,
    /// The text as it went on the glass; empty when nothing is on it.
    pub paragraphs: Vec<PrompterParagraph>,
    pub look: PrompterLook,
    #[serde(rename = "sizePx")]
    pub size_px: u32,
    pub anchor: Option<PrompterAnchor>,
}

/// A kept version, without its text.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct PrompterVersionSummary {
    pub id: u32,
    #[serde(rename = "readWords")]
    pub read_words: u32,
    #[serde(rename = "keptAt")]
    pub kept_at: String,
    /// `imported`, `pasted`, `put-on`, `replaced`, `updated`,
    /// `before-file-update`, `before-bringing-back` or `from-backup`.
    pub reason: String,
}

/// `prompter.script.snapshot`: one script with its text and its versions.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct PrompterScriptSnapshot {
    pub script: PrompterScriptSummary,
    pub paragraphs: Vec<PrompterParagraph>,
    pub cues: Vec<PrompterCue>,
    /// Newest first.
    pub versions: Vec<PrompterVersionSummary>,
}

pub(crate) fn cues_of(paragraphs: &[PrompterParagraph]) -> Vec<PrompterCue> {
    cue_targets(paragraphs)
        .into_iter()
        .map(|target| PrompterCue {
            paragraph: target.paragraph as u32,
            word: target.word as u32,
            text: target.text,
        })
        .collect()
}

pub(crate) fn summary_of(row: ScriptRow, on_prompter: bool) -> PrompterScriptSummary {
    let at_end = row.place.paragraph >= row.paragraph_count;
    PrompterScriptSummary {
        length_seconds: f64::from(row.read_words) * 60.0 / f64::from(row.speed_wpm.max(1)),
        id: row.id,
        name: row.name,
        source_file_name: row.source_file_name,
        paragraph_count: row.paragraph_count,
        read_words: row.read_words,
        speed_wpm: row.speed_wpm,
        place: row.place,
        at_end,
        created_at: row.created_at,
        changed_at: row.changed_at,
        removed_at: row.removed_at,
        on_prompter,
    }
}

/// Names in the order a person reads a list: letters without regard to
/// case, and a run of digits by its number (`2` before `10`).
pub(crate) fn natural_order(left: &str, right: &str) -> Ordering {
    let mut left_chars = left.chars().peekable();
    let mut right_chars = right.chars().peekable();
    loop {
        match (left_chars.peek().copied(), right_chars.peek().copied()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(a), Some(b)) if a.is_ascii_digit() && b.is_ascii_digit() => {
                let take = |chars: &mut std::iter::Peekable<std::str::Chars<'_>>| {
                    let mut digits = String::new();
                    while let Some(digit) = chars.peek().copied().filter(char::is_ascii_digit) {
                        digits.push(digit);
                        chars.next();
                    }
                    digits
                };
                let (a, b) = (take(&mut left_chars), take(&mut right_chars));
                let (a_trimmed, b_trimmed) = (a.trim_start_matches('0'), b.trim_start_matches('0'));
                let order = a_trimmed
                    .len()
                    .cmp(&b_trimmed.len())
                    .then_with(|| a_trimmed.cmp(b_trimmed));
                if order != Ordering::Equal {
                    return order;
                }
            }
            (Some(a), Some(b)) => {
                let order = a.to_lowercase().cmp(b.to_lowercase());
                if order != Ordering::Equal {
                    return order;
                }
                left_chars.next();
                right_chars.next();
            }
        }
    }
}

/// The glass script's row with the newest place and pace the saver holds.
fn with_kept_values(prompter: &Prompter, mut row: ScriptRow) -> ScriptRow {
    if let Some((script_id, place, speed_wpm)) = prompter.kept_values() {
        if script_id == row.id {
            row.place = place;
            row.speed_wpm = speed_wpm;
        }
    }
    row
}

/// `prompter.snapshot`, from the scripts' rows read before the lock was
/// taken.
pub(crate) fn read_snapshot(
    prompter: &Prompter,
    rows: Vec<ScriptRow>,
    now: Instant,
) -> PrompterSnapshot {
    let glass_id = prompter.glass.as_ref().map(|glass| glass.script_id.clone());
    let glass = match (&prompter.glass, prompter.anchor(now)) {
        (Some(glass), Some(anchor)) => {
            let (time_left, estimated) = glass.time_left(now);
            let (length, _) = glass.length();
            Some(PrompterGlassSummary {
                script_id: glass.script_id.clone(),
                name: prompter.glass_name.clone(),
                layout_key: glass.layout_key.clone(),
                laid_out: glass.layout.is_some(),
                not_updated: prompter.glass_text_differs,
                speed_wpm: glass.speed_wpm,
                place: glass.place_at(now),
                paragraph_count: glass.paragraph_count(),
                playing: glass.playing,
                at_end: glass.at_end(now),
                time_left_seconds: time_left,
                length_seconds: length,
                estimated,
                cues: cues_of(&glass.paragraphs),
                anchor,
            })
        }
        _ => None,
    };
    let rows = rows.into_iter().map(|row| with_kept_values(prompter, row));
    let (removed, kept): (Vec<ScriptRow>, Vec<ScriptRow>) =
        rows.partition(|row| row.removed_at.is_some());
    let mut scripts: Vec<PrompterScriptSummary> = kept
        .into_iter()
        .map(|row| {
            let on = glass_id.as_deref() == Some(row.id.as_str());
            summary_of(row, on)
        })
        .collect();
    scripts.sort_by(|a, b| natural_order(&a.name, &b.name).then_with(|| a.id.cmp(&b.id)));
    let mut removed: Vec<PrompterScriptSummary> = removed
        .into_iter()
        .map(|row| summary_of(row, false))
        .collect();
    removed.sort_by(|a, b| {
        b.removed_at
            .cmp(&a.removed_at)
            .then_with(|| a.id.cmp(&b.id))
    });
    PrompterSnapshot {
        look: prompter.look,
        size_px: prompter.size_px,
        glass,
        scripts,
        removed,
        screen: prompter.screen.summary(),
    }
}

/// The name of the script on the glass when it was edited after it went on
/// (`NOT UPDATED`); `None` when it was not, or when nothing is on the glass.
pub(crate) fn glass_edited_name(prompter: &Prompter) -> Option<String> {
    (prompter.glass.is_some() && prompter.glass_text_differs).then(|| prompter.glass_name.clone())
}

pub(crate) fn read_glass_snapshot(prompter: &Prompter, now: Instant) -> PrompterGlassSnapshot {
    match &prompter.glass {
        Some(glass) => PrompterGlassSnapshot {
            name: Some(prompter.glass_name.clone()),
            script_id: Some(glass.script_id.clone()),
            layout_key: Some(glass.layout_key.clone()),
            paragraphs: glass.paragraphs.as_ref().clone(),
            look: prompter.look,
            size_px: prompter.size_px,
            anchor: prompter.anchor(now),
        },
        None => PrompterGlassSnapshot {
            script_id: None,
            name: None,
            layout_key: None,
            paragraphs: Vec::new(),
            look: prompter.look,
            size_px: prompter.size_px,
            anchor: None,
        },
    }
}

/// What `prompter.script.snapshot` reads from the disk, before the
/// prompter's lock is taken.
pub(crate) struct ScriptParts {
    script: StoredScript,
    row: ScriptRow,
    versions: Vec<VersionRow>,
}

pub(crate) fn read_script_parts(
    connection: &Connection,
    script_id: &str,
) -> Result<ScriptParts, PrompterError> {
    let script = crate::prompter::commands::existing_script(connection, script_id)?;
    let row = store::list_scripts(connection)?
        .into_iter()
        .find(|row| row.id == script_id)
        .ok_or_else(crate::prompter::commands::unknown_script)?;
    let versions = store::list_versions(connection, script_id)?;
    Ok(ScriptParts {
        script,
        row,
        versions,
    })
}

pub(crate) fn read_script_snapshot(
    prompter: &Prompter,
    parts: ScriptParts,
) -> PrompterScriptSnapshot {
    let ScriptParts {
        script,
        row,
        versions,
    } = parts;
    let on_prompter = prompter
        .glass
        .as_ref()
        .is_some_and(|glass| glass.script_id == row.id);
    let versions = versions
        .into_iter()
        .map(|version| PrompterVersionSummary {
            id: u32::try_from(version.id).unwrap_or(u32::MAX),
            read_words: version.read_words,
            kept_at: version.kept_at,
            reason: version.reason,
        })
        .collect();
    PrompterScriptSnapshot {
        script: summary_of(with_kept_values(prompter, row), on_prompter),
        cues: cues_of(&script.paragraphs),
        paragraphs: script.paragraphs,
        versions,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_sort_with_numbers_in_their_natural_order() {
        let mut names = vec!["10 Outro", "2 Guest", "01 Intro", "b roll", "A take"];
        names.sort_by(|a, b| natural_order(a, b));
        assert_eq!(
            names,
            ["01 Intro", "2 Guest", "10 Outro", "A take", "b roll"]
        );
    }
}
