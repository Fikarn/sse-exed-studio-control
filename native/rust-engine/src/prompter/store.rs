//! The prompter's saved data (schema 9, `storage.rs`): the scripts, their
//! last versions and the prompter's one row. Only this file writes SQL for
//! the prompter; every write is one transaction the caller commits.

use crate::prompter::clock::PrompterPlace;
use crate::prompter::look::PrompterLook;
use crate::prompter::model::{read_word_count, PrompterParagraph};
use crate::storage::EngineResult;
use rusqlite::{params, Connection, OptionalExtension, Transaction};

/// Each script keeps its last 20 versions (the proposal §3.3).
pub(crate) const VERSIONS_KEPT: i64 = 20;
/// SQLite's clock as the action log writes it: `2026-09-27T14:02:11.123Z`.
const NOW: &str = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/// Why a version was kept.
pub(crate) mod reason {
    pub(crate) const IMPORTED: &str = "imported";
    pub(crate) const PASTED: &str = "pasted";
    pub(crate) const PUT_ON: &str = "put-on";
    pub(crate) const REPLACED: &str = "replaced";
    pub(crate) const UPDATED: &str = "updated";
    pub(crate) const BEFORE_FILE_UPDATE: &str = "before-file-update";
    pub(crate) const BEFORE_BRINGING_BACK: &str = "before-bringing-back";
    pub(crate) const FROM_BACKUP: &str = "from-backup";
}

/// A script as saved, its text included.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct StoredScript {
    pub id: String,
    pub name: String,
    pub source_file_name: Option<String>,
    pub paragraphs: Vec<PrompterParagraph>,
    pub created_at: String,
    pub changed_at: String,
    pub speed_wpm: u32,
    pub place: PrompterPlace,
    pub removed_at: Option<String>,
}

/// A script's row for the lists, without its text.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ScriptRow {
    pub id: String,
    pub name: String,
    pub source_file_name: Option<String>,
    pub paragraph_count: u32,
    pub read_words: u32,
    pub created_at: String,
    pub changed_at: String,
    pub speed_wpm: u32,
    pub place: PrompterPlace,
    pub removed_at: Option<String>,
}

/// A kept version, without its text.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct VersionRow {
    pub id: i64,
    pub read_words: u32,
    pub kept_at: String,
    pub reason: String,
}

/// The prompter's one row.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct StoredPrompter {
    pub look: PrompterLook,
    pub size_px: u32,
    pub glass_script_id: Option<String>,
    pub glass_paragraphs: Option<Vec<PrompterParagraph>>,
    pub glass_revision: i64,
    pub look_revision: i64,
}

fn paragraphs_json(paragraphs: &[PrompterParagraph]) -> EngineResult<String> {
    Ok(serde_json::to_string(paragraphs)?)
}

fn paragraphs_from(raw: &str) -> Vec<PrompterParagraph> {
    serde_json::from_str(raw).unwrap_or_default()
}

fn place_from(paragraph: i64, word: i64) -> PrompterPlace {
    PrompterPlace {
        paragraph: u32::try_from(paragraph).unwrap_or(0),
        word: u32::try_from(word).unwrap_or(0),
    }
}

pub(crate) fn read_prompter(connection: &Connection) -> EngineResult<StoredPrompter> {
    let row = connection.query_row(
        "SELECT look, size_px, glass_script_id, glass_paragraphs, glass_revision, look_revision
         FROM prompter_state WHERE id = 1",
        [],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
            ))
        },
    )?;
    let (look, size_px, glass_script_id, glass_paragraphs, glass_revision, look_revision) = row;
    let size_px = u32::try_from(size_px)
        .ok()
        .filter(|size| crate::prompter::look::size_is_valid(*size))
        .unwrap_or(crate::prompter::look::STANDARD_SIZE_PX);
    Ok(StoredPrompter {
        look: PrompterLook::from_stored(&look),
        size_px,
        glass_script_id,
        glass_paragraphs: glass_paragraphs.as_deref().map(paragraphs_from),
        glass_revision,
        look_revision,
    })
}

const SCRIPT_COLUMNS: &str =
    "id, name, source_file_name, paragraph_count, read_words, created_at, \
     changed_at, speed_wpm, place_paragraph, place_word, removed_at";

fn script_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ScriptRow> {
    Ok(ScriptRow {
        id: row.get(0)?,
        name: row.get(1)?,
        source_file_name: row.get(2)?,
        paragraph_count: row.get::<_, i64>(3)?.try_into().unwrap_or(0),
        read_words: row.get::<_, i64>(4)?.try_into().unwrap_or(0),
        created_at: row.get(5)?,
        changed_at: row.get(6)?,
        speed_wpm: row.get::<_, i64>(7)?.try_into().unwrap_or(0),
        place: place_from(row.get(8)?, row.get(9)?),
        removed_at: row.get(10)?,
    })
}

/// Every script, the removed ones included, in the order they were made.
pub(crate) fn list_scripts(connection: &Connection) -> EngineResult<Vec<ScriptRow>> {
    let mut statement = connection.prepare(&format!(
        "SELECT {SCRIPT_COLUMNS} FROM prompter_scripts ORDER BY created_at, id"
    ))?;
    let rows = statement
        .query_map([], script_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub(crate) fn read_script(connection: &Connection, id: &str) -> EngineResult<Option<StoredScript>> {
    let found = connection
        .query_row(
            &format!("SELECT {SCRIPT_COLUMNS}, paragraphs FROM prompter_scripts WHERE id = ?1"),
            [id],
            |row| Ok((script_row(row)?, row.get::<_, String>(11)?)),
        )
        .optional()?;
    Ok(found.map(|(row, paragraphs)| StoredScript {
        id: row.id,
        name: row.name,
        source_file_name: row.source_file_name,
        paragraphs: paragraphs_from(&paragraphs),
        created_at: row.created_at,
        changed_at: row.changed_at,
        speed_wpm: row.speed_wpm,
        place: row.place,
        removed_at: row.removed_at,
    }))
}

/// A new script's id: `script-` and sixteen hex digits from the system's
/// randomness, so a script restored from another workstation's archive
/// never takes an id this one has.
/// A script's name, without its text: the Stream Deck's strip asks for it
/// once a second.
pub(crate) fn read_script_name(connection: &Connection, id: &str) -> EngineResult<Option<String>> {
    Ok(connection
        .query_row(
            "SELECT name FROM prompter_scripts WHERE id = ?1",
            [id],
            |row| row.get::<_, String>(0),
        )
        .optional()?)
}

pub(crate) fn new_script_id() -> EngineResult<String> {
    let mut bytes = [0u8; 8];
    getrandom::fill(&mut bytes)
        .map_err(|error| format!("no randomness for a script id: {error}"))?;
    Ok(format!(
        "script-{}",
        bytes
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    ))
}

/// What a new script is made of.
pub(crate) struct NewScript<'a> {
    pub id: &'a str,
    pub name: &'a str,
    pub source_file_name: Option<&'a str>,
    pub paragraphs: &'a [PrompterParagraph],
    pub speed_wpm: u32,
    pub place: PrompterPlace,
    /// A restored script keeps its own times and whether it was removed.
    pub created_at: Option<&'a str>,
    pub changed_at: Option<&'a str>,
    pub removed_at: Option<&'a str>,
}

pub(crate) fn insert_script(
    transaction: &Transaction<'_>,
    script: NewScript<'_>,
) -> EngineResult<()> {
    transaction.execute(
        &format!(
            "INSERT INTO prompter_scripts
               (id, name, source_file_name, paragraphs, paragraph_count, read_words,
                created_at, changed_at, speed_wpm, place_paragraph, place_word, removed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, COALESCE(?7, {NOW}), COALESCE(?8, {NOW}),
                     ?9, ?10, ?11, ?12)"
        ),
        params![
            script.id,
            script.name,
            script.source_file_name,
            paragraphs_json(script.paragraphs)?,
            script.paragraphs.len() as i64,
            read_word_count(script.paragraphs) as i64,
            script.created_at,
            script.changed_at,
            i64::from(script.speed_wpm),
            i64::from(script.place.paragraph),
            i64::from(script.place.word),
            script.removed_at,
        ],
    )?;
    Ok(())
}

/// A script's new text and the place moved with it; `changed_at` moves on.
pub(crate) fn write_script_text(
    transaction: &Transaction<'_>,
    id: &str,
    paragraphs: &[PrompterParagraph],
    place: PrompterPlace,
) -> EngineResult<()> {
    transaction.execute(
        &format!(
            "UPDATE prompter_scripts
                SET paragraphs = ?2, paragraph_count = ?3, read_words = ?4,
                    place_paragraph = ?5, place_word = ?6, changed_at = {NOW}
              WHERE id = ?1"
        ),
        params![
            id,
            paragraphs_json(paragraphs)?,
            paragraphs.len() as i64,
            read_word_count(paragraphs) as i64,
            i64::from(place.paragraph),
            i64::from(place.word),
        ],
    )?;
    Ok(())
}

pub(crate) fn write_script_name(
    transaction: &Transaction<'_>,
    id: &str,
    name: &str,
) -> EngineResult<()> {
    transaction.execute(
        &format!("UPDATE prompter_scripts SET name = ?2, changed_at = {NOW} WHERE id = ?1"),
        params![id, name],
    )?;
    Ok(())
}

/// The place, saved about once a second while the text scrolls and at every
/// stop, jump and change. It is not an edit: `changed_at` stays.
pub(crate) fn write_script_place(
    connection: &Connection,
    id: &str,
    place: PrompterPlace,
) -> EngineResult<()> {
    connection.execute(
        "UPDATE prompter_scripts SET place_paragraph = ?2, place_word = ?3 WHERE id = ?1",
        params![id, i64::from(place.paragraph), i64::from(place.word)],
    )?;
    Ok(())
}

pub(crate) fn write_script_speed(
    connection: &Connection,
    id: &str,
    speed_wpm: u32,
) -> EngineResult<()> {
    connection.execute(
        "UPDATE prompter_scripts SET speed_wpm = ?2 WHERE id = ?1",
        params![id, i64::from(speed_wpm)],
    )?;
    Ok(())
}

pub(crate) fn write_script_removed(
    transaction: &Transaction<'_>,
    id: &str,
    removed: bool,
) -> EngineResult<()> {
    let sql = if removed {
        format!("UPDATE prompter_scripts SET removed_at = {NOW} WHERE id = ?1")
    } else {
        String::from("UPDATE prompter_scripts SET removed_at = NULL WHERE id = ?1")
    };
    transaction.execute(&sql, [id])?;
    Ok(())
}

/// Ends a script and its versions.
pub(crate) fn delete_script(transaction: &Transaction<'_>, id: &str) -> EngineResult<()> {
    transaction.execute(
        "DELETE FROM prompter_script_versions WHERE script_id = ?1",
        [id],
    )?;
    transaction.execute("DELETE FROM prompter_scripts WHERE id = ?1", [id])?;
    Ok(())
}

/// Keeps `paragraphs` as the script's newest version, unless the newest one
/// already holds that text, and lets the oldest go past `VERSIONS_KEPT`.
pub(crate) fn keep_version(
    transaction: &Transaction<'_>,
    id: &str,
    paragraphs: &[PrompterParagraph],
    reason: &str,
) -> EngineResult<()> {
    let text = paragraphs_json(paragraphs)?;
    let newest: Option<String> = transaction
        .query_row(
            "SELECT paragraphs FROM prompter_script_versions
              WHERE script_id = ?1 ORDER BY id DESC LIMIT 1",
            [id],
            |row| row.get(0),
        )
        .optional()?;
    if newest.as_deref() == Some(text.as_str()) {
        return Ok(());
    }
    transaction.execute(
        &format!(
            "INSERT INTO prompter_script_versions(script_id, paragraphs, read_words, kept_at, reason)
             VALUES (?1, ?2, ?3, {NOW}, ?4)"
        ),
        params![id, text, read_word_count(paragraphs) as i64, reason],
    )?;
    transaction.execute(
        "DELETE FROM prompter_script_versions
          WHERE script_id = ?1 AND id NOT IN
            (SELECT id FROM prompter_script_versions
              WHERE script_id = ?1 ORDER BY id DESC LIMIT ?2)",
        params![id, VERSIONS_KEPT],
    )?;
    Ok(())
}

/// Whether any kept version of the script holds exactly this text.
pub(crate) fn has_version_with(
    connection: &Connection,
    id: &str,
    paragraphs: &[PrompterParagraph],
) -> EngineResult<bool> {
    let count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM prompter_script_versions WHERE script_id = ?1 AND paragraphs = ?2",
        params![id, paragraphs_json(paragraphs)?],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

/// The script's kept versions, newest first, without their text.
pub(crate) fn list_versions(connection: &Connection, id: &str) -> EngineResult<Vec<VersionRow>> {
    let mut statement = connection.prepare(
        "SELECT id, read_words, kept_at, reason FROM prompter_script_versions
          WHERE script_id = ?1 ORDER BY id DESC",
    )?;
    let rows = statement
        .query_map([id], |row| {
            Ok(VersionRow {
                id: row.get(0)?,
                read_words: row.get::<_, i64>(1)?.try_into().unwrap_or(0),
                kept_at: row.get(2)?,
                reason: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Every kept version of the script with its text, oldest first, for the
/// backup archive.
pub(crate) fn read_versions(
    connection: &Connection,
    id: &str,
) -> EngineResult<Vec<(VersionRow, Vec<PrompterParagraph>)>> {
    let mut statement = connection.prepare(
        "SELECT id, read_words, kept_at, reason, paragraphs FROM prompter_script_versions
          WHERE script_id = ?1 ORDER BY id",
    )?;
    let rows = statement
        .query_map([id], |row| {
            Ok((
                VersionRow {
                    id: row.get(0)?,
                    read_words: row.get::<_, i64>(1)?.try_into().unwrap_or(0),
                    kept_at: row.get(2)?,
                    reason: row.get(3)?,
                },
                row.get::<_, String>(4)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows
        .into_iter()
        .map(|(row, paragraphs)| (row, paragraphs_from(&paragraphs)))
        .collect())
}

/// A kept version as the archive restore writes it back: its own time.
pub(crate) fn insert_version(
    transaction: &Transaction<'_>,
    id: &str,
    paragraphs: &[PrompterParagraph],
    kept_at: Option<&str>,
    reason: &str,
) -> EngineResult<()> {
    transaction.execute(
        &format!(
            "INSERT INTO prompter_script_versions(script_id, paragraphs, read_words, kept_at, reason)
             VALUES (?1, ?2, ?3, COALESCE(?4, {NOW}), ?5)"
        ),
        params![
            id,
            paragraphs_json(paragraphs)?,
            read_word_count(paragraphs) as i64,
            kept_at,
            reason
        ],
    )?;
    Ok(())
}

pub(crate) fn read_version(
    connection: &Connection,
    script_id: &str,
    version_id: i64,
) -> EngineResult<Option<Vec<PrompterParagraph>>> {
    let found: Option<String> = connection
        .query_row(
            "SELECT paragraphs FROM prompter_script_versions WHERE script_id = ?1 AND id = ?2",
            params![script_id, version_id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(found.as_deref().map(paragraphs_from))
}

/// What the glass shows: a script and its text as it went on, or nothing.
/// Every change moves the glass's revision on.
pub(crate) fn write_glass(
    transaction: &Transaction<'_>,
    script_id: Option<&str>,
    paragraphs: Option<&[PrompterParagraph]>,
) -> EngineResult<i64> {
    let text = paragraphs.map(paragraphs_json).transpose()?;
    transaction.execute(
        "UPDATE prompter_state
            SET glass_script_id = ?1, glass_paragraphs = ?2, glass_revision = glass_revision + 1
          WHERE id = 1",
        params![script_id, text],
    )?;
    Ok(transaction.query_row(
        "SELECT glass_revision FROM prompter_state WHERE id = 1",
        [],
        |row| row.get(0),
    )?)
}

/// The look and the take's size; the look's revision moves on when the text
/// has to be laid out again.
pub(crate) fn write_look(
    connection: &Connection,
    look: &PrompterLook,
    size_px: u32,
    relayout: bool,
) -> EngineResult<i64> {
    connection.execute(
        "UPDATE prompter_state
            SET look = ?1, size_px = ?2, look_revision = look_revision + ?3
          WHERE id = 1",
        params![
            serde_json::to_string(look)?,
            i64::from(size_px),
            i64::from(relayout)
        ],
    )?;
    Ok(connection.query_row(
        "SELECT look_revision FROM prompter_state WHERE id = 1",
        [],
        |row| row.get(0),
    )?)
}
