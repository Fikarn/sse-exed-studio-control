//! The prompter's part of the backup archive (format 6, new pages program,
//! Slice 4; the proposal §3.3): the scripts with their versions and places
//! and speeds, the removed ones, the look and the take's size. What the
//! glass shows is not part of it — a restore never changes the prompter's
//! screen (D12).
//!
//! A restore adds scripts and never removes or overwrites one: a script the
//! saved data does not have comes back whole, with its own id, times, place,
//! speed, versions and whether it was removed; one it has keeps its text,
//! name, place and speed, and the archive's text, when it differs and is not
//! already a kept version, comes back as an earlier version of it. The look
//! and the size come back as they were saved; the words at the reading line
//! stay where they are (`after_archive_restore`).

use crate::prompter::clock::{speed_is_valid, PrompterPlace, SPEED_DEFAULT_WPM};
use crate::prompter::look::{size_is_valid, PrompterLook, STANDARD_SIZE_PX};
use crate::prompter::model::{sanitize_text, PrompterParagraph, MAX_SCRIPT_NAME_CHARS};
use crate::prompter::store::{self, reason, NewScript};
use crate::storage::EngineResult;
use rusqlite::{Connection, Transaction};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct PrompterArchive {
    pub look: PrompterLook,
    #[serde(rename = "sizePx")]
    pub size_px: u32,
    pub scripts: Vec<ArchivedScript>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct ArchivedScript {
    pub id: String,
    pub name: String,
    #[serde(rename = "sourceFileName")]
    pub source_file_name: Option<String>,
    pub paragraphs: Vec<PrompterParagraph>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "changedAt")]
    pub changed_at: String,
    #[serde(rename = "speedWpm")]
    pub speed_wpm: u32,
    pub place: PrompterPlace,
    #[serde(rename = "removedAt")]
    pub removed_at: Option<String>,
    /// Oldest first.
    #[serde(default)]
    pub versions: Vec<ArchivedVersion>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct ArchivedVersion {
    pub paragraphs: Vec<PrompterParagraph>,
    #[serde(rename = "keptAt")]
    pub kept_at: String,
    pub reason: String,
}

/// What a restore did with the prompter's part.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct PrompterRestoreOutcome {
    /// Scripts the saved data did not have.
    pub added: usize,
    /// Scripts it had whose archived text came back as an earlier version.
    pub earlier_versions: usize,
}

pub(crate) fn build_prompter_archive(connection: &Connection) -> EngineResult<PrompterArchive> {
    let stored = store::read_prompter(connection)?;
    let mut scripts = Vec::new();
    for row in store::list_scripts(connection)? {
        let Some(script) = store::read_script(connection, &row.id)? else {
            continue;
        };
        let versions = store::read_versions(connection, &row.id)?
            .into_iter()
            .map(|(version, paragraphs)| ArchivedVersion {
                paragraphs,
                kept_at: version.kept_at,
                reason: version.reason,
            })
            .collect();
        scripts.push(ArchivedScript {
            id: script.id,
            name: script.name,
            source_file_name: script.source_file_name,
            paragraphs: script.paragraphs,
            created_at: script.created_at,
            changed_at: script.changed_at,
            speed_wpm: script.speed_wpm,
            place: script.place,
            removed_at: script.removed_at,
            versions,
        });
    }
    Ok(PrompterArchive {
        look: stored.look,
        size_px: stored.size_px,
        scripts,
    })
}

/// The archive's text as the saved data keeps text: sanitized runs,
/// neighbours of one emphasis joined, at least one paragraph.
fn cleaned(paragraphs: &[PrompterParagraph]) -> Vec<PrompterParagraph> {
    let mut cleaned: Vec<PrompterParagraph> = paragraphs
        .iter()
        .map(|paragraph| {
            let mut paragraph = paragraph.clone();
            for run in &mut paragraph.runs {
                run.text = sanitize_text(&run.text);
            }
            paragraph.normalized()
        })
        .collect();
    if cleaned.is_empty() {
        cleaned.push(PrompterParagraph::default());
    }
    cleaned
}

fn cleaned_name(name: &str) -> String {
    let name: String = sanitize_text(name)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(MAX_SCRIPT_NAME_CHARS)
        .collect();
    if name.trim().is_empty() {
        String::from("Restored script")
    } else {
        name.trim().to_string()
    }
}

/// Applies the prompter's part inside the restore's transaction.
pub(crate) fn restore_prompter_archive(
    transaction: &Transaction<'_>,
    archive: &PrompterArchive,
) -> EngineResult<PrompterRestoreOutcome> {
    let mut outcome = PrompterRestoreOutcome::default();
    let stored = store::read_prompter(transaction)?;
    let look = PrompterLook::from_stored(&serde_json::to_string(&archive.look)?);
    let size = if size_is_valid(archive.size_px) {
        archive.size_px
    } else {
        STANDARD_SIZE_PX
    };
    let relayout = stored.look.lays_out_differently(&look) || stored.size_px != size;
    if look != stored.look || size != stored.size_px {
        store::write_look(transaction, &look, size, relayout)?;
    }
    for script in &archive.scripts {
        if script.id.trim().is_empty() {
            continue;
        }
        let paragraphs = cleaned(&script.paragraphs);
        match store::read_script(transaction, &script.id)? {
            Some(existing) => {
                let differs = existing.paragraphs != paragraphs;
                if differs && !store::has_version_with(transaction, &script.id, &paragraphs)? {
                    store::keep_version(transaction, &script.id, &paragraphs, reason::FROM_BACKUP)?;
                    outcome.earlier_versions += 1;
                }
            }
            None => {
                store::insert_script(
                    transaction,
                    NewScript {
                        id: &script.id,
                        name: &cleaned_name(&script.name),
                        source_file_name: script.source_file_name.as_deref(),
                        paragraphs: &paragraphs,
                        speed_wpm: if speed_is_valid(script.speed_wpm) {
                            script.speed_wpm
                        } else {
                            SPEED_DEFAULT_WPM
                        },
                        place: script.place.clamped(&paragraphs),
                        created_at: Some(&script.created_at),
                        changed_at: Some(&script.changed_at),
                        removed_at: script.removed_at.as_deref(),
                    },
                )?;
                let keep_from = script
                    .versions
                    .len()
                    .saturating_sub(store::VERSIONS_KEPT as usize);
                for version in &script.versions[keep_from..] {
                    store::insert_version(
                        transaction,
                        &script.id,
                        &cleaned(&version.paragraphs),
                        Some(&version.kept_at),
                        &version.reason,
                    )?;
                }
                outcome.added += 1;
            }
        }
    }
    Ok(outcome)
}

/// The restore's sentence on the scripts, when it did anything with them.
pub(crate) fn restore_sentence(outcome: PrompterRestoreOutcome) -> Option<String> {
    use crate::prompter::model::counted;
    let mut parts = Vec::new();
    if outcome.added > 0 {
        parts.push(format!(
            "{} added to the Teleprompter",
            counted(outcome.added, "script", "scripts")
        ));
    }
    if outcome.earlier_versions > 0 {
        parts.push(format!(
            "{} came back as an earlier version of a script already here",
            counted(outcome.earlier_versions, "script", "scripts")
        ));
    }
    if parts.is_empty() {
        return None;
    }
    let sentence = parts.join("; ");
    let mut characters = sentence.chars();
    let first = characters
        .next()
        .map(|c| c.to_uppercase().to_string())
        .unwrap_or_default();
    Some(format!("{first}{}.", characters.as_str()))
}
