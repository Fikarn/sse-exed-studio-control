//! The `prompter.*` methods (new pages program, Slice 4; the proposal §3, §5
//! and §6.3). Each runs under the prompter's lock (`with_prompter`), so a
//! request and the clock thread never interleave. What the operator reads —
//! a refusal, an import sentence — is written here.
//!
//! The rules the design sets (D11, D12, D19, D20): nothing but the
//! operator's controls moves the place; only `TOP` pauses a scroll; at a
//! script's end `PLAY` is refused until a jump moves the place back;
//! replacing what the prompter shows needs `replace: true` (the page's
//! second press); an edit never reaches the glass before Update; the script
//! on the prompter cannot be removed; only a removed script can be deleted
//! for good.

use crate::prompter::clock::{
    speed_is_valid, PrompterLayoutLine, PrompterPlace, SPEED_DEFAULT_WPM, SPEED_MAX_WPM,
    SPEED_MIN_WPM, SPEED_STEP_WPM,
};
use crate::prompter::clock::{GlassClock, Layout};
use crate::prompter::edits::map_place;
use crate::prompter::import::{import_file, import_paste, import_sentence};
use crate::prompter::look::{size_is_valid, SIZE_MAX_PX, SIZE_MIN_PX, SIZE_STEP_PX};
use crate::prompter::model::{
    cue_targets, sanitize_text, word_count, PrompterParagraph, MAX_IMPORT_BYTES,
    MAX_SCRIPT_NAME_CHARS, MAX_SCRIPT_WORDS,
};
use crate::prompter::runtime::{with_prompter, Prompter};
use crate::prompter::snapshot::{read_glass_snapshot, read_script_snapshot, read_snapshot};
use crate::prompter::store::{self, reason, NewScript, StoredScript};
use crate::prompter::{PrompterError, PrompterReply};
use base64::Engine as _;
use rusqlite::Connection;
use serde_json::{json, Value};
use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

type Handled = Result<(Value, Option<&'static str>), PrompterError>;

/// Answers one `prompter.*` request.
pub(crate) fn handle_prompter_request(
    db_path: &Path,
    method: &str,
    params: &Value,
) -> Result<PrompterReply, PrompterError> {
    with_prompter(db_path, |prompter, connection, now| {
        let (result, reason) = match method {
            "prompter.snapshot" => (
                serde_json::to_value(read_snapshot(prompter, connection, now)?)?,
                None,
            ),
            "prompter.glass.snapshot" => (
                serde_json::to_value(read_glass_snapshot(prompter, connection, now)?)?,
                None,
            ),
            "prompter.script.snapshot" => (
                serde_json::to_value(read_script_snapshot(
                    prompter,
                    connection,
                    script_id(params)?,
                )?)?,
                None,
            ),
            "prompter.script.import" => import_request(prompter, connection, params, now)?,
            "prompter.script.paste" => paste_request(connection, params)?,
            "prompter.script.create" => create_request(connection, params)?,
            "prompter.script.rename" => rename_request(connection, params)?,
            "prompter.script.edit" => edit_request(prompter, connection, params)?,
            "prompter.script.remove" => remove_request(prompter, connection, params, true)?,
            "prompter.script.restore" => remove_request(prompter, connection, params, false)?,
            "prompter.script.delete" => delete_request(connection, params)?,
            "prompter.script.version.bringBack" => {
                bring_back_request(prompter, connection, params)?
            }
            "prompter.putOn" => put_on_request(prompter, connection, params, now)?,
            "prompter.update" => update_request(prompter, connection, now)?,
            "prompter.clear" => clear_request(prompter, connection, now)?,
            "prompter.play" => play_request(prompter, connection, now)?,
            "prompter.pause" => pause_request(prompter, connection, now)?,
            "prompter.speed" => speed_request(prompter, connection, params, now)?,
            "prompter.jump" => jump_request(prompter, connection, params, now)?,
            "prompter.textSize" => text_size_request(prompter, connection, params, now)?,
            "prompter.look.update" => look_request(prompter, connection, params, now)?,
            "prompter.layout.report" => layout_request(prompter, params, now)?,
            other => {
                return Err(PrompterError::Invalid(format!(
                    "Unsupported method: {other}"
                )))
            }
        };
        Ok(PrompterReply {
            result,
            reason,
            anchor: prompter.glass.as_ref().map(|glass| glass.anchor(now)),
        })
    })
}

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

fn text_param<'a>(params: &'a Value, key: &str) -> Result<&'a str, PrompterError> {
    params
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| PrompterError::Invalid(format!("{key} must be a string that is not empty.")))
}

fn optional_text<'a>(params: &'a Value, key: &str) -> Result<Option<&'a str>, PrompterError> {
    match params.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.as_str())),
        Some(_) => Err(PrompterError::Invalid(format!("{key} must be a string."))),
    }
}

fn whole_param(params: &Value, key: &str) -> Result<Option<u32>, PrompterError> {
    match params.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_u64()
            .and_then(|number| u32::try_from(number).ok())
            .map(Some)
            .ok_or_else(|| PrompterError::Invalid(format!("{key} must be a whole number."))),
    }
}

fn step_param(params: &Value) -> Result<Option<i64>, PrompterError> {
    match params.get("step") {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_i64()
            .filter(|step| (-100..=100).contains(step) && *step != 0)
            .map(Some)
            .ok_or_else(|| {
                PrompterError::Invalid(String::from("step must be a whole number of steps, not 0."))
            }),
    }
}

fn script_id(params: &Value) -> Result<&str, PrompterError> {
    text_param(params, "scriptId")
}

pub(crate) fn unknown_script() -> PrompterError {
    PrompterError::Refused(
        "PROMPTER_SCRIPT_UNKNOWN",
        String::from("There is no such script; it may have been deleted for good."),
    )
}

pub(crate) fn existing_script(
    connection: &Connection,
    id: &str,
) -> Result<StoredScript, PrompterError> {
    store::read_script(connection, id)?.ok_or_else(unknown_script)
}

fn kept_script(connection: &Connection, id: &str) -> Result<StoredScript, PrompterError> {
    let script = existing_script(connection, id)?;
    if script.removed_at.is_some() {
        return Err(PrompterError::Refused(
            "PROMPTER_SCRIPT_REMOVED",
            format!("{} is in Removed. Restore it first.", script.name),
        ));
    }
    Ok(script)
}

/// A name as the lists show it: one line, spaces collapsed, at most
/// `MAX_SCRIPT_NAME_CHARS` characters; `None` when nothing is left.
fn clean_name(raw: &str) -> Option<String> {
    let name = sanitize_text(raw)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let name: String = name.chars().take(MAX_SCRIPT_NAME_CHARS).collect();
    let name = name.trim().to_string();
    (!name.is_empty()).then_some(name)
}

/// A file's name without its folder or its ending: `Interview intro.docx`
/// is `Interview intro`.
fn file_stem(file_name: &str) -> String {
    let base = file_name.rsplit(['/', '\\']).next().unwrap_or(file_name);
    let stem = base.rsplit_once('.').map_or(base, |(stem, _)| stem);
    clean_name(stem).unwrap_or_else(|| String::from("Imported script"))
}

/// A pasted script's name: the first words of its first line.
fn first_words(paragraphs: &[PrompterParagraph]) -> String {
    let first_line = paragraphs
        .first()
        .map(|paragraph| paragraph.text())
        .unwrap_or_default();
    let first_line = first_line.lines().next().unwrap_or_default();
    let mut name = String::new();
    for word in first_line.split_whitespace().take(6) {
        if !name.is_empty() && name.chars().count() + 1 + word.chars().count() > 40 {
            break;
        }
        if !name.is_empty() {
            name.push(' ');
        }
        name.push_str(word);
    }
    clean_name(&name).unwrap_or_else(|| String::from("Pasted script"))
}

/// `New script`, or `New script 2`, `3`… when the name is taken.
fn new_script_name(connection: &Connection) -> Result<String, PrompterError> {
    let names: Vec<String> = store::list_scripts(connection)?
        .into_iter()
        .map(|row| row.name)
        .collect();
    let base = "New script";
    if !names.iter().any(|name| name == base) {
        return Ok(String::from(base));
    }
    Ok((2..)
        .map(|number| format!("{base} {number}"))
        .find(|name| !names.contains(name))
        .expect("an unused number exists"))
}

/// The text the editor sends, cleaned as an import is: sanitized runs,
/// neighbours of one emphasis joined. Empty paragraphs stay (the editor is
/// typing into them); an empty script is one empty paragraph.
fn edited_paragraphs(params: &Value) -> Result<Vec<PrompterParagraph>, PrompterError> {
    let raw = params.get("paragraphs").cloned().ok_or_else(|| {
        PrompterError::Invalid(String::from("paragraphs must be the script's text."))
    })?;
    let paragraphs: Vec<PrompterParagraph> = serde_json::from_value(raw).map_err(|error| {
        PrompterError::Invalid(format!("paragraphs must be a list of paragraphs: {error}"))
    })?;
    let mut paragraphs: Vec<PrompterParagraph> = paragraphs
        .into_iter()
        .map(|mut paragraph| {
            for run in &mut paragraph.runs {
                run.text = sanitize_text(&run.text);
            }
            paragraph.normalized()
        })
        .collect();
    if paragraphs.is_empty() {
        paragraphs.push(PrompterParagraph::default());
    }
    let words = word_count(&paragraphs);
    if words > MAX_SCRIPT_WORDS {
        return Err(PrompterError::Refused(
            "PROMPTER_SCRIPT_TOO_LONG",
            format!(
                "The script would have {words} words; a script can have up to {MAX_SCRIPT_WORDS}. Split it into shorter scripts."
            ),
        ));
    }
    Ok(paragraphs)
}

fn on_glass(prompter: &Prompter, id: &str) -> bool {
    prompter
        .glass
        .as_ref()
        .is_some_and(|glass| glass.script_id == id)
}

// ---------------------------------------------------------------------------
// Scripts
// ---------------------------------------------------------------------------

/// `prompter.script.import { fileName, contentBase64, updateScriptId? }`: a
/// `.docx` or `.txt` from the page's file picker. With `updateScriptId` the
/// file's text replaces that script's (the page asks first, when a file of
/// the same name was opened before); its earlier text is kept as a version.
fn import_request(
    prompter: &mut Prompter,
    connection: &mut Connection,
    params: &Value,
    _now: Instant,
) -> Handled {
    let file_name = text_param(params, "fileName")?;
    let file_name = file_name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(file_name)
        .to_string();
    let content = text_param(params, "contentBase64")?;
    if content.len() > MAX_IMPORT_BYTES / 3 * 4 + 8 {
        return Err(PrompterError::Refused(
            "PROMPTER_IMPORT_REFUSED",
            crate::prompter::import::ImportRefusal::TooLarge {
                bytes: content.len() / 4 * 3,
            }
            .sentence(&file_name),
        ));
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(content.trim())
        .map_err(|_| {
            PrompterError::Invalid(String::from(
                "contentBase64 must be the file's bytes in base64.",
            ))
        })?;
    let imported = import_file(&file_name, &bytes).map_err(|refusal| {
        PrompterError::Refused("PROMPTER_IMPORT_REFUSED", refusal.sentence(&file_name))
    })?;
    let mut sentence = import_sentence(&file_name, &imported);
    let transaction = connection.transaction()?;
    let (id, name, reason) = match optional_text(params, "updateScriptId")? {
        Some(id) => {
            let script = kept_script(&transaction, id)?;
            let place = if on_glass(prompter, id) {
                script.place
            } else {
                map_place(&script.paragraphs, &imported.paragraphs, script.place).0
            };
            store::keep_version(
                &transaction,
                id,
                &script.paragraphs,
                reason::BEFORE_FILE_UPDATE,
            )?;
            store::write_script_text(&transaction, id, &imported.paragraphs, place)?;
            store::keep_version(&transaction, id, &imported.paragraphs, reason::IMPORTED)?;
            sentence.push_str(&format!(
                " It is now the text of {}; the earlier text is kept among its versions.",
                script.name
            ));
            (script.id, script.name, "script-updated-from-file")
        }
        None => {
            let id = store::new_script_id()?;
            let name = file_stem(&file_name);
            store::insert_script(
                &transaction,
                NewScript {
                    id: &id,
                    name: &name,
                    source_file_name: Some(&file_name),
                    paragraphs: &imported.paragraphs,
                    speed_wpm: SPEED_DEFAULT_WPM,
                    place: PrompterPlace::TOP,
                    created_at: None,
                    changed_at: None,
                    removed_at: None,
                },
            )?;
            store::keep_version(&transaction, &id, &imported.paragraphs, reason::IMPORTED)?;
            (id, name, "script-imported")
        }
    };
    transaction.commit()?;
    Ok((
        json!({ "scriptId": id, "name": name, "sentence": sentence }),
        Some(reason),
    ))
}

/// `prompter.script.paste { html?, text }`: what the page read from the
/// clipboard, as a new script named after its first words.
fn paste_request(connection: &mut Connection, params: &Value) -> Handled {
    let html = optional_text(params, "html")?;
    let text = optional_text(params, "text")?.unwrap_or_default();
    const SOURCE: &str = "The pasted text";
    let imported = import_paste(html, text).map_err(|refusal| {
        PrompterError::Refused("PROMPTER_IMPORT_REFUSED", refusal.sentence(SOURCE))
    })?;
    let id = store::new_script_id()?;
    let name = first_words(&imported.paragraphs);
    let transaction = connection.transaction()?;
    store::insert_script(
        &transaction,
        NewScript {
            id: &id,
            name: &name,
            source_file_name: None,
            paragraphs: &imported.paragraphs,
            speed_wpm: SPEED_DEFAULT_WPM,
            place: PrompterPlace::TOP,
            created_at: None,
            changed_at: None,
            removed_at: None,
        },
    )?;
    store::keep_version(&transaction, &id, &imported.paragraphs, reason::PASTED)?;
    transaction.commit()?;
    Ok((
        json!({
            "scriptId": id,
            "name": name,
            "sentence": import_sentence("the pasted text", &imported),
        }),
        Some("script-pasted"),
    ))
}

/// `prompter.script.create { name? }`: an empty script for the editor.
fn create_request(connection: &mut Connection, params: &Value) -> Handled {
    let name = match optional_text(params, "name")? {
        Some(raw) => clean_name(raw)
            .ok_or_else(|| PrompterError::Invalid(String::from("name must hold a word.")))?,
        None => new_script_name(connection)?,
    };
    let id = store::new_script_id()?;
    let transaction = connection.transaction()?;
    store::insert_script(
        &transaction,
        NewScript {
            id: &id,
            name: &name,
            source_file_name: None,
            paragraphs: &[PrompterParagraph::default()],
            speed_wpm: SPEED_DEFAULT_WPM,
            place: PrompterPlace::TOP,
            created_at: None,
            changed_at: None,
            removed_at: None,
        },
    )?;
    transaction.commit()?;
    Ok((
        json!({ "scriptId": id, "name": name }),
        Some("script-created"),
    ))
}

fn rename_request(connection: &mut Connection, params: &Value) -> Handled {
    let id = script_id(params)?;
    let name = clean_name(text_param(params, "name")?)
        .ok_or_else(|| PrompterError::Invalid(String::from("name must hold a word.")))?;
    existing_script(connection, id)?;
    let transaction = connection.transaction()?;
    store::write_script_name(&transaction, id, &name)?;
    transaction.commit()?;
    Ok((
        json!({ "scriptId": id, "name": name }),
        Some("script-renamed"),
    ))
}

/// `prompter.script.edit { scriptId, paragraphs }`: the editor's text, saved
/// as the operator types (§3.3). The glass keeps what it shows until Update
/// (§6.3), so the place of the script on the glass stays with the glass's
/// text; any other script's place moves with the edit.
fn edit_request(prompter: &mut Prompter, connection: &mut Connection, params: &Value) -> Handled {
    let id = script_id(params)?;
    let script = kept_script(connection, id)?;
    let paragraphs = edited_paragraphs(params)?;
    let place = if on_glass(prompter, id) {
        script.place
    } else {
        map_place(&script.paragraphs, &paragraphs, script.place).0
    };
    let transaction = connection.transaction()?;
    store::write_script_text(&transaction, id, &paragraphs, place)?;
    transaction.commit()?;
    let changed_at = existing_script(connection, id)?.changed_at;
    Ok((
        json!({ "scriptId": id, "changedAt": changed_at }),
        Some("script-edited"),
    ))
}

/// `prompter.script.remove` / `prompter.script.restore { scriptId }`: to
/// Removed and back. The script on the prompter cannot be removed.
fn remove_request(
    prompter: &mut Prompter,
    connection: &mut Connection,
    params: &Value,
    remove: bool,
) -> Handled {
    let id = script_id(params)?;
    let script = existing_script(connection, id)?;
    if remove && on_glass(prompter, id) {
        return Err(PrompterError::Refused(
            "PROMPTER_SCRIPT_ON_PROMPTER",
            format!(
                "{} is on the prompter. Clear the prompter first.",
                script.name
            ),
        ));
    }
    let transaction = connection.transaction()?;
    store::write_script_removed(&transaction, id, remove)?;
    transaction.commit()?;
    Ok((
        json!({ "scriptId": id }),
        Some(if remove {
            "script-removed"
        } else {
            "script-restored"
        }),
    ))
}

/// `prompter.script.delete { scriptId }`: "Delete for good…" in Removed, the
/// only way a script ends (§3.3). The page asks first.
fn delete_request(connection: &mut Connection, params: &Value) -> Handled {
    let id = script_id(params)?;
    let script = existing_script(connection, id)?;
    if script.removed_at.is_none() {
        return Err(PrompterError::Refused(
            "PROMPTER_SCRIPT_NOT_REMOVED",
            format!(
                "{} is not in Removed. Remove it first; only a removed script can be deleted for good.",
                script.name
            ),
        ));
    }
    let transaction = connection.transaction()?;
    store::delete_script(&transaction, id)?;
    transaction.commit()?;
    Ok((json!({ "scriptId": id }), Some("script-deleted")))
}

/// `prompter.script.version.bringBack { scriptId, versionId }`: a kept
/// version becomes the script's text; the text it had is kept first.
fn bring_back_request(
    prompter: &mut Prompter,
    connection: &mut Connection,
    params: &Value,
) -> Handled {
    let id = script_id(params)?;
    let version_id = whole_param(params, "versionId")?
        .ok_or_else(|| PrompterError::Invalid(String::from("versionId must be a whole number.")))?;
    let script = kept_script(connection, id)?;
    let paragraphs =
        store::read_version(connection, id, i64::from(version_id))?.ok_or_else(|| {
            PrompterError::Refused(
                "PROMPTER_VERSION_UNKNOWN",
                format!(
                    "{} has no such version; it may have been let go.",
                    script.name
                ),
            )
        })?;
    let place = if on_glass(prompter, id) {
        script.place
    } else {
        map_place(&script.paragraphs, &paragraphs, script.place).0
    };
    let transaction = connection.transaction()?;
    if !store::has_version_with(&transaction, id, &script.paragraphs)? {
        store::keep_version(
            &transaction,
            id,
            &script.paragraphs,
            reason::BEFORE_BRINGING_BACK,
        )?;
    }
    store::write_script_text(&transaction, id, &paragraphs, place)?;
    transaction.commit()?;
    Ok((json!({ "scriptId": id }), Some("version-brought-back")))
}

// ---------------------------------------------------------------------------
// What the glass shows (D11: replacing, updating and clearing are armed)
// ---------------------------------------------------------------------------

fn nothing_on() -> PrompterError {
    PrompterError::Refused(
        "PROMPTER_NOTHING_ON",
        String::from("Nothing is on the prompter. Put a script on first."),
    )
}

/// `prompter.putOn { scriptId, replace? }`: the script's text goes on the
/// glass, paused at its own place — at the top when it was left at its end
/// (§5.5). When the prompter shows another script, `replace: true` (the
/// page's second press) is needed.
fn put_on_request(
    prompter: &mut Prompter,
    connection: &mut Connection,
    params: &Value,
    now: Instant,
) -> Handled {
    let id = script_id(params)?;
    let replace = params
        .get("replace")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let script = kept_script(connection, id)?;
    let replaced = match &prompter.glass {
        Some(glass) if glass.script_id == id => {
            return Err(PrompterError::Refused(
                "PROMPTER_ALREADY_ON",
                format!("{} is already on the prompter.", script.name),
            ))
        }
        Some(glass) => {
            let shown = existing_script(connection, &glass.script_id)
                .map(|shown| shown.name)
                .unwrap_or_default();
            if !replace {
                return Err(PrompterError::Refused(
                    "PROMPTER_REPLACE_NOT_CONFIRMED",
                    format!(
                        "The prompter shows {shown}. Replacing it with {} needs the second press.",
                        script.name
                    ),
                ));
            }
            prompter.save_place(connection, now)?;
            Some(shown)
        }
        None => None,
    };
    let place = if script.place >= PrompterPlace::end_of(&script.paragraphs) {
        PrompterPlace::TOP
    } else {
        script.place.clamped(&script.paragraphs)
    };
    let transaction = connection.transaction()?;
    store::keep_version(
        &transaction,
        id,
        &script.paragraphs,
        if replaced.is_some() {
            reason::REPLACED
        } else {
            reason::PUT_ON
        },
    )?;
    let revision = store::write_glass(&transaction, Some(id), Some(&script.paragraphs))?;
    transaction.commit()?;
    store::write_script_place(connection, id, place)?;
    prompter.glass_revision = revision;
    prompter.glass = Some(GlassClock::paused(
        now,
        script.id.clone(),
        Arc::new(script.paragraphs),
        prompter.layout_key(),
        place,
        script.speed_wpm,
    ));
    prompter.place_saved_as(Some(place), now);
    let (action, sentence) = match &replaced {
        Some(shown) => (
            "replaced",
            format!("Replaced {shown} with {} on the prompter.", script.name),
        ),
        None => ("put-on", format!("Put {} on the prompter.", script.name)),
    };
    Ok((
        json!({
            "action": action,
            "name": script.name,
            "replacedName": replaced,
            "sentence": sentence,
        }),
        Some(if replaced.is_some() {
            "replaced"
        } else {
            "put-on"
        }),
    ))
}

/// `prompter.update`: the script's edited text goes on the glass (§6.3),
/// the same words at the reading line; when the paragraph there was deleted,
/// the place moves to the start of the next one, and the sentence says so.
/// The scroll goes on as it was.
fn update_request(prompter: &mut Prompter, connection: &mut Connection, now: Instant) -> Handled {
    let Some(glass) = prompter.glass.as_ref() else {
        return Err(nothing_on());
    };
    let script = existing_script(connection, &glass.script_id)?;
    if script.paragraphs == *glass.paragraphs {
        return Err(PrompterError::Refused(
            "PROMPTER_UP_TO_DATE",
            format!(
                "The prompter already shows the latest text of {}.",
                script.name
            ),
        ));
    }
    let (current, _) = glass.place_at(now);
    let (place, moved) = map_place(&glass.paragraphs, &script.paragraphs, current);
    let transaction = connection.transaction()?;
    store::keep_version(
        &transaction,
        &script.id,
        &script.paragraphs,
        reason::UPDATED,
    )?;
    let revision = store::write_glass(&transaction, Some(&script.id), Some(&script.paragraphs))?;
    transaction.commit()?;
    prompter.glass_revision = revision;
    let key = prompter.layout_key();
    let glass = prompter.glass.as_mut().expect("checked above");
    glass.replace_text(now, Arc::new(script.paragraphs.clone()), key, place);
    prompter.save_place(connection, now)?;
    let mut sentence = format!("Updated {} on the prompter.", script.name);
    if moved {
        if place.paragraph >= script.paragraphs.len() as u32 {
            sentence.push_str(" The paragraph at the reading line was deleted, so the prompter now stands at the end.");
        } else {
            sentence.push_str(&format!(
                " The paragraph at the reading line was deleted, so the prompter now starts at paragraph {}.",
                place.paragraph + 1
            ));
        }
    }
    Ok((
        json!({ "action": "updated", "name": script.name, "sentence": sentence }),
        Some("updated"),
    ))
}

/// `prompter.clear`: the glass goes black; the script keeps its place.
fn clear_request(prompter: &mut Prompter, connection: &mut Connection, now: Instant) -> Handled {
    let Some(glass) = prompter.glass.as_ref() else {
        return Err(nothing_on());
    };
    let name = existing_script(connection, &glass.script_id)
        .map(|script| script.name)
        .unwrap_or_default();
    prompter.save_place(connection, now)?;
    let transaction = connection.transaction()?;
    let revision = store::write_glass(&transaction, None, None)?;
    transaction.commit()?;
    prompter.glass_revision = revision;
    prompter.glass = None;
    prompter.place_saved_as(None, now);
    Ok((
        json!({ "action": "cleared", "name": name, "sentence": "Cleared the prompter." }),
        Some("cleared"),
    ))
}

// ---------------------------------------------------------------------------
// Running a take (all one press, D11; none starts the scroll but PLAY)
// ---------------------------------------------------------------------------

fn not_laid_out() -> PrompterError {
    PrompterError::Refused(
        "PROMPTER_NOT_LAID_OUT",
        String::from(
            "The prompter's text is not drawn yet, so it cannot scroll or step a line. Try again in a moment.",
        ),
    )
}

fn glass_mut(prompter: &mut Prompter) -> Result<&mut GlassClock, PrompterError> {
    prompter.glass.as_mut().ok_or_else(nothing_on)
}

fn play_request(prompter: &mut Prompter, connection: &mut Connection, now: Instant) -> Handled {
    let glass = glass_mut(prompter)?;
    if glass.at_end(now) {
        let name = existing_script(connection, &glass.script_id)
            .map(|script| script.name)
            .unwrap_or_default();
        return Err(PrompterError::Refused(
            "PROMPTER_AT_END",
            format!(
                "The prompter is at the end of {name}. Go back with BACK, TOP or a jump first."
            ),
        ));
    }
    if glass.layout.is_none() {
        return Err(not_laid_out());
    }
    if !glass.playing {
        glass.play(now);
    }
    Ok((json!({}), Some("played")))
}

fn pause_request(prompter: &mut Prompter, connection: &mut Connection, now: Instant) -> Handled {
    glass_mut(prompter)?.pause(now);
    prompter.save_place(connection, now)?;
    Ok((json!({}), Some("paused")))
}

/// `prompter.speed { wpm? | step? }`: the pace in words a minute, 40–300 in
/// steps of 5; `step` moves it that many steps and stops at the ends.
fn speed_request(
    prompter: &mut Prompter,
    connection: &mut Connection,
    params: &Value,
    now: Instant,
) -> Handled {
    let wpm = whole_param(params, "wpm")?;
    let step = step_param(params)?;
    let glass = glass_mut(prompter)?;
    let speed = match (wpm, step) {
        (Some(wpm), None) if speed_is_valid(wpm) => wpm,
        (Some(_), None) => {
            return Err(PrompterError::Invalid(format!(
                "wpm must be {SPEED_MIN_WPM}–{SPEED_MAX_WPM} in steps of {SPEED_STEP_WPM}."
            )))
        }
        (None, Some(step)) => (i64::from(glass.speed_wpm) + step * i64::from(SPEED_STEP_WPM))
            .clamp(i64::from(SPEED_MIN_WPM), i64::from(SPEED_MAX_WPM))
            as u32,
        _ => {
            return Err(PrompterError::Invalid(String::from(
                "Give the pace as wpm or as step, not both.",
            )))
        }
    };
    glass.set_speed(now, speed);
    let id = glass.script_id.clone();
    store::write_script_speed(connection, &id, speed)?;
    Ok((json!({ "speedWpm": speed }), Some("speed")))
}

/// `prompter.jump { to, paragraph?, word? }`: `top`, `back`, `nextLine`,
/// `previousLine`, `nextParagraph`, `previousParagraph`, `nextCue`,
/// `previousCue`, `paragraph` (with `paragraph`, from 0) or `place` (with
/// `paragraph` and `word`). A jump keeps the scroll as it was; only `top`
/// pauses (§14).
fn jump_request(
    prompter: &mut Prompter,
    connection: &mut Connection,
    params: &Value,
    now: Instant,
) -> Handled {
    let to = text_param(params, "to")?;
    let paragraph = whole_param(params, "paragraph")?;
    let word = whole_param(params, "word")?;
    let glass = glass_mut(prompter)?;
    let count = glass.paragraph_count();
    let (current, _) = glass.place_at(now);
    let start_of = |paragraph: u32| PrompterPlace { paragraph, word: 0 };
    let mut target_fraction = 0.0;
    let target = match to {
        "top" => {
            glass.jump(now, PrompterPlace::TOP, 0.0, true);
            prompter.save_place(connection, now)?;
            return Ok((json!({}), Some("jumped")));
        }
        // §5 (answered in §14): the start of the paragraph at the reading
        // line; from that paragraph's first line, the start of the one before.
        "back" => {
            if current.paragraph >= count {
                start_of(count.saturating_sub(1))
            } else if current.word == 0 {
                start_of(current.paragraph.saturating_sub(1))
            } else {
                start_of(current.paragraph)
            }
        }
        "nextLine" | "previousLine" => {
            let layout = glass.layout.as_ref().ok_or_else(not_laid_out)?;
            let position = glass.position_at(now).ok_or_else(not_laid_out)?;
            let moved = layout.line_step(position, to == "nextLine");
            let (place, fraction) = layout.place_at(moved, count);
            target_fraction = fraction;
            place
        }
        "nextParagraph" => start_of((current.paragraph + 1).min(count.saturating_sub(1))),
        "previousParagraph" => start_of(current.paragraph.saturating_sub(1)),
        "nextCue" | "previousCue" => {
            let cues = cue_targets(&glass.paragraphs);
            let here = (current.paragraph, current.word);
            let found = if to == "nextCue" {
                cues.iter()
                    .find(|cue| (cue.paragraph as u32, cue.word as u32) > here)
            } else {
                cues.iter().rev().find(|cue| {
                    let at = (cue.paragraph as u32, cue.word as u32);
                    at < here || (at == here && !glass.at_line_start(now))
                })
            };
            match found {
                Some(cue) => PrompterPlace {
                    paragraph: cue.paragraph as u32,
                    word: cue.word as u32,
                },
                None => {
                    return Err(PrompterError::Refused(
                        "PROMPTER_NO_CUE",
                        String::from(if to == "nextCue" {
                            "There is no cue after the reading line."
                        } else {
                            "There is no cue before the reading line."
                        }),
                    ))
                }
            }
        }
        "paragraph" | "place" => {
            let paragraph = paragraph.ok_or_else(|| {
                PrompterError::Invalid(String::from("paragraph must be a whole number."))
            })?;
            if paragraph >= count {
                return Err(PrompterError::Invalid(format!(
                    "The script on the prompter has {count} paragraphs; paragraph must be 0–{}.",
                    count.saturating_sub(1)
                )));
            }
            PrompterPlace {
                paragraph,
                word: if to == "place" { word.unwrap_or(0) } else { 0 },
            }
        }
        other => {
            return Err(PrompterError::Invalid(format!(
                "to must be top, back, nextLine, previousLine, nextParagraph, previousParagraph, nextCue, previousCue, paragraph or place, not {other}."
            )))
        }
    };
    glass.jump(now, target, target_fraction, false);
    prompter.save_place(connection, now)?;
    Ok((json!({}), Some("jumped")))
}

/// `prompter.textSize { sizePx? | step? | standard? }`: the take's size,
/// 48–160 px in steps of 4; `standard: true` returns to the look's standard.
/// The words at the reading line stay (§4.1).
fn text_size_request(
    prompter: &mut Prompter,
    connection: &mut Connection,
    params: &Value,
    now: Instant,
) -> Handled {
    let standard = params
        .get("standard")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let size = match (
        whole_param(params, "sizePx")?,
        step_param(params)?,
        standard,
    ) {
        (Some(size), None, false) if size_is_valid(size) => size,
        (Some(_), None, false) => {
            return Err(PrompterError::Invalid(format!(
                "sizePx must be {SIZE_MIN_PX}–{SIZE_MAX_PX} in steps of {SIZE_STEP_PX}."
            )))
        }
        (None, Some(step), false) => (i64::from(prompter.size_px) + step * i64::from(SIZE_STEP_PX))
            .clamp(i64::from(SIZE_MIN_PX), i64::from(SIZE_MAX_PX))
            as u32,
        (None, None, true) => prompter.look.standard_size_px,
        _ => {
            return Err(PrompterError::Invalid(String::from(
                "Give the size as sizePx, step or standard, one of them.",
            )))
        }
    };
    let relayout = size != prompter.size_px;
    set_look(prompter, connection, prompter.look, size, relayout, now)?;
    Ok((json!({ "sizePx": size }), Some("size")))
}

/// `prompter.look.update { …fields of the look }`: one press each (§10).
/// When the standard size changes and the take's size was the standard, the
/// take's size follows it.
fn look_request(
    prompter: &mut Prompter,
    connection: &mut Connection,
    params: &Value,
    now: Instant,
) -> Handled {
    let look = prompter
        .look
        .updated(params)
        .map_err(PrompterError::Invalid)?;
    let size = if prompter.size_px == prompter.look.standard_size_px {
        look.standard_size_px
    } else {
        prompter.size_px
    };
    let relayout = prompter.look.lays_out_differently(&look) || size != prompter.size_px;
    set_look(prompter, connection, look, size, relayout, now)?;
    Ok((json!({}), Some("look")))
}

fn set_look(
    prompter: &mut Prompter,
    connection: &mut Connection,
    look: crate::prompter::look::PrompterLook,
    size_px: u32,
    relayout: bool,
    now: Instant,
) -> Result<(), PrompterError> {
    prompter.save_place(connection, now)?;
    let revision = store::write_look(connection, &look, size_px, relayout)?;
    prompter.look = look;
    prompter.size_px = size_px;
    prompter.look_revision = revision;
    if relayout {
        let key = prompter.layout_key();
        if let Some(glass) = prompter.glass.as_mut() {
            glass.relayout(now, key);
        }
    }
    Ok(())
}

/// `prompter.layout.report { layoutKey, lines, endTop }`: a view's layout of
/// the glass. A report for an older key is answered `accepted: false` and
/// changes nothing; one that does not fit the text is refused.
fn layout_request(prompter: &mut Prompter, params: &Value, now: Instant) -> Handled {
    let key = text_param(params, "layoutKey")?;
    let lines: Vec<PrompterLayoutLine> =
        serde_json::from_value(params.get("lines").cloned().ok_or_else(|| {
            PrompterError::Invalid(String::from("lines must be the layout's lines."))
        })?)
        .map_err(|error| {
            PrompterError::Invalid(format!("lines must be the layout's lines: {error}"))
        })?;
    let end_top = params
        .get("endTop")
        .and_then(Value::as_f64)
        .ok_or_else(|| PrompterError::Invalid(String::from("endTop must be a number.")))?;
    let Some(glass) = prompter.glass.as_mut() else {
        return Ok((json!({ "accepted": false }), None));
    };
    if glass.layout_key != key {
        return Ok((json!({ "accepted": false }), None));
    }
    if glass
        .layout
        .as_ref()
        .is_some_and(|layout| layout.lines == lines && layout.end_top == end_top)
    {
        return Ok((json!({ "accepted": true }), None));
    }
    let layout = Layout::new(key.to_string(), lines, end_top, &glass.paragraphs)
        .map_err(PrompterError::Invalid)?;
    glass.accept_layout(now, layout);
    Ok((json!({ "accepted": true }), Some("laid-out")))
}

/// Pauses the prompter where it is, at once, keeping the place: a restore
/// never scrolls (D12). Used after an archive restore, which also brings the
/// look back.
pub(crate) fn after_archive_restore(
    db_path: &Path,
) -> Result<Option<crate::prompter::clock::PrompterAnchor>, PrompterError> {
    with_prompter(db_path, |prompter, connection, now| {
        if let Some(glass) = prompter.glass.as_mut() {
            let (place, fraction) = glass.place_at(now);
            glass.jump(now, place, fraction, true);
            glass.motion.move_from = None;
        }
        prompter.save_place(connection, now)?;
        let stored = store::read_prompter(connection)?;
        let relayout =
            stored.look.lays_out_differently(&prompter.look) || stored.size_px != prompter.size_px;
        prompter.look = stored.look;
        prompter.size_px = stored.size_px;
        prompter.look_revision = stored.look_revision;
        if relayout {
            let key = prompter.layout_key();
            if let Some(glass) = prompter.glass.as_mut() {
                glass.relayout(now, key);
            }
        }
        Ok(prompter.glass.as_ref().map(|glass| glass.anchor(now)))
    })
}
