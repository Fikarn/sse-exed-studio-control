//! The action log (2026-09 production readiness, Slice 11 — finding F30): one
//! row per discrete action that changed what a device receives, with who did
//! it. `support.snapshot` carries the newest rows as `recentEvents`, and
//! Setup / Support lists them as Recent actions.
//!
//! This is not `engine_events.rs` — that module *sends* protocol events to the
//! shell. The table keeps the design's name, `event_log`.
//!
//! **What is a row.** A discrete operator action that reaches a device: power,
//! recall, mute, 48 V, talkback, arming the light outputs, a patch change. A
//! ride is not — a fader, a gain, an intensity, a colour temperature, the
//! grand master, a Stream Deck dial detent: a commit waits for the disk
//! (about 35 ms on the workstation), a dial sends a key per detent, and a row
//! per detent would be a log nobody can read. Neither is a change staged in
//! the lighting preview (it never touched the rig; the recall that later puts
//! it there is a row), a refused action (nothing reached a device; the last
//! action status and the log carry it), or bookkeeping — selections, scene
//! and group edits.
//!
//! **Who knows the source.** The entry points, not the functions they share:
//! `EngineApp::handle_request` (the screen), the bridge's
//! `handle_control_surface_http_action` (the Stream Deck), the console flush
//! on the metering thread (a change made at TotalMix), the talkback watchdog,
//! and the bootstrap (a safe start, an applied database restore).
//!
//! **What a row costs.** The Stream Deck's row rides the transaction that
//! stamps its last event and the console's rows ride the flush's own write, so
//! neither waits for the disk a second time; a screen action pays one more
//! commit on the IPC thread, which is why only discrete actions are rows. A
//! row is on disk before the reply says ok. The prune runs in the insert's
//! transaction.

use crate::diagnostics::{log_event, LogLevel};
use crate::storage::{open_connection, EngineResult};
use rusqlite::{params, Transaction};
use serde::Serialize;
use serde_json::Value;
use std::path::Path;

/// How many rows `support.snapshot` carries.
pub(crate) const RECENT_ACTIONS_LIMIT: usize = 50;
/// How many rows the table keeps; older ones leave with the next insert.
pub(crate) const ACTION_LOG_MAX_ROWS: i64 = 5_000;

pub(crate) const DOMAIN_LIGHTING: &str = "lighting";
pub(crate) const DOMAIN_AUDIO: &str = "audio";
pub(crate) const DOMAIN_SETUP: &str = "setup";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ActionSource {
    /// A request from the screen.
    Ui,
    /// A Stream Deck key, through the bridge.
    Deck,
    /// A change made at TotalMix that the console reported back.
    Console,
    /// The talkback watchdog releasing a hold nobody released.
    Watchdog,
    /// The start of the app: a safe start, an applied database restore.
    Launch,
}

impl ActionSource {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Ui => "ui",
            Self::Deck => "deck",
            Self::Console => "console",
            Self::Watchdog => "watchdog",
            Self::Launch => "launch",
        }
    }
}

/// One action to be written. `detail` is the sentence the operator reads.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ActionRecord {
    pub(crate) source: ActionSource,
    pub(crate) domain: &'static str,
    pub(crate) action: &'static str,
    pub(crate) target: String,
    pub(crate) detail: String,
}

impl ActionRecord {
    pub(crate) fn new(
        source: ActionSource,
        domain: &'static str,
        action: &'static str,
        target: impl Into<String>,
        detail: impl Into<String>,
    ) -> Self {
        Self {
            source,
            domain,
            action,
            target: target.into(),
            detail: detail.into(),
        }
    }
}

/// One stored row, as `recentEvents` carries it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct RecordedAction {
    pub(crate) id: i64,
    /// UTC, `2026-09-17T14:03:22.123Z`, stamped by SQLite as the row is written.
    pub(crate) at: String,
    pub(crate) source: String,
    pub(crate) domain: String,
    pub(crate) action: String,
    pub(crate) target: String,
    pub(crate) detail: String,
}

/// Writes the rows inside the caller's transaction and prunes in the same
/// one. Ids only ever leave from the bottom, so the newest
/// `ACTION_LOG_MAX_ROWS` are the ones above `MAX(id) - ACTION_LOG_MAX_ROWS`.
pub(crate) fn insert_actions(
    transaction: &Transaction<'_>,
    actions: &[ActionRecord],
) -> Result<(), rusqlite::Error> {
    if actions.is_empty() {
        return Ok(());
    }
    for action in actions {
        transaction.execute(
            "INSERT INTO event_log(at, source, domain, action, target, detail)
             VALUES (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?1, ?2, ?3, ?4, ?5)",
            params![
                action.source.as_str(),
                action.domain,
                action.action,
                action.target,
                action.detail,
            ],
        )?;
    }
    transaction.execute(
        "DELETE FROM event_log WHERE id <= (SELECT MAX(id) FROM event_log) - ?1",
        [ACTION_LOG_MAX_ROWS],
    )?;
    Ok(())
}

/// Writes the rows in a transaction of their own: one wait for the disk.
pub(crate) fn record_actions(db_path: &Path, actions: &[ActionRecord]) -> EngineResult<()> {
    if actions.is_empty() {
        return Ok(());
    }
    let mut connection = open_connection(db_path)?;
    let transaction = connection.transaction()?;
    insert_actions(&transaction, actions)?;
    transaction.commit()?;
    Ok(())
}

/// `record_actions` for the entry points: the action has already happened, so
/// a row that cannot be written is a `WARN` line, never a failed action.
pub(crate) fn record_actions_or_log(db_path: &Path, actions: &[ActionRecord]) {
    if let Err(error) = record_actions(db_path, actions) {
        log_event(
            LogLevel::Warn,
            &format!(
                "Action log: {} row(s) could not be written: {error}",
                actions.len()
            ),
        );
    }
}

/// The newest rows first, in the order they were written.
pub(crate) fn list_recent_actions(
    db_path: &Path,
    limit: usize,
) -> EngineResult<Vec<RecordedAction>> {
    let connection = open_connection(db_path)?;
    let mut statement = connection.prepare(
        "SELECT id, at, source, domain, action, target, detail
         FROM event_log ORDER BY id DESC LIMIT ?1",
    )?;
    let rows = statement
        .query_map([limit as i64], |row| {
            Ok(RecordedAction {
                id: row.get(0)?,
                at: row.get(1)?,
                source: row.get(2)?,
                domain: row.get(3)?,
                action: row.get(4)?,
                target: row.get(5)?,
                detail: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, rusqlite::Error>>()?;
    Ok(rows)
}

// ---------------------------------------------------------------------------
// The screen: method → rows
// ---------------------------------------------------------------------------

/// How the action log sees one protocol method. Every method of the contract
/// has a class (`every_contract_method_is_classified`), so a method added
/// later is a decision, not an omission.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum UiMethodClass {
    /// Can produce rows — `ui_actions` says which requests do.
    Recorded,
    /// Reads, selections, editor bookkeeping, files: no device sees it.
    NotAnAction,
}

const RECORDED_UI_METHODS: &[&str] = &[
    "audio.channel.dynamics.update",
    "audio.channel.eq.update",
    "audio.channel.send.update",
    "audio.channel.update",
    "audio.mixTarget.update",
    "audio.settings.update",
    "audio.snapshot.recall",
    "audio.solo.clearAll",
    "audio.talkback.hold",
    "commissioning.check.run",
    "lighting.fixture.create",
    "lighting.fixture.delete",
    "lighting.fixture.highlight",
    "lighting.fixture.identify",
    "lighting.fixture.identify.clearAll",
    "lighting.fixture.identifySequence",
    "lighting.fixture.update",
    "lighting.group.power",
    "lighting.output.setArmed",
    "lighting.palette.apply",
    "lighting.power.all",
    "lighting.scene.recall",
    "lighting.settings.update",
    "support.backup.restore",
];

const NOT_AN_ACTION_UI_METHODS: &[&str] = &[
    // Reads.
    "app.snapshot",
    "audio.snapshot",
    "commissioning.snapshot",
    "controlSurface.snapshot",
    "engine.ping",
    "health.snapshot",
    "lighting.dmxMonitor.snapshot",
    "lighting.fixtureCatalog.snapshot",
    "lighting.palette.list",
    "lighting.snapshot",
    "settings.get",
    "support.backup.verify",
    "support.snapshot",
    // A console pull reads TotalMix and never writes to it; the clip lamps
    // are the app's own.
    "audio.sync",
    "audio.clip.clear",
    // The Console's stored scenes: saving, renaming and deleting one changes
    // no device — the recall does, and is a row.
    "audio.snapshot.create",
    "audio.snapshot.delete",
    "audio.snapshot.update",
    // The lighting editor's bookkeeping: what a scene, a group or a palette
    // is, and the preview buffer, which never reaches the rig by itself.
    "lighting.editor.previewDiscard",
    "lighting.editor.previewMode",
    "lighting.group.create",
    "lighting.group.delete",
    "lighting.group.reorder",
    "lighting.group.update",
    "lighting.palette.create",
    "lighting.palette.delete",
    "lighting.palette.update",
    "lighting.scene.create",
    "lighting.scene.delete",
    "lighting.scene.pin",
    "lighting.scene.reorder",
    "lighting.scene.update",
    // The shell's own settings, files.
    "commissioning.update",
    "dev.parityFixture.load",
    "exports.companion.export",
    "settings.update",
    "support.backup.export",
];

pub(crate) fn ui_method_class(method: &str) -> Option<UiMethodClass> {
    if RECORDED_UI_METHODS.contains(&method) {
        Some(UiMethodClass::Recorded)
    } else if NOT_AN_ACTION_UI_METHODS.contains(&method) {
        Some(UiMethodClass::NotAnAction)
    } else {
        None
    }
}

/// The lighting methods that stage their change while the preview is on.
const PREVIEW_AWARE_UI_METHODS: &[&str] = &[
    "lighting.fixture.update",
    "lighting.group.power",
    "lighting.palette.apply",
    "lighting.power.all",
    "lighting.scene.recall",
];

pub(crate) fn ui_method_stages_in_preview(method: &str) -> bool {
    PREVIEW_AWARE_UI_METHODS.contains(&method)
}

fn on_off(on: bool) -> &'static str {
    if on {
        "on"
    } else {
        "off"
    }
}

fn text<'a>(value: &'a Value, pointer: &str) -> Option<&'a str> {
    value
        .pointer(pointer)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
}

fn flag(value: &Value, key: &str) -> Option<bool> {
    value.get(key).and_then(Value::as_bool)
}

/// The rows a successful request from the screen leaves. `params` is what was
/// asked, `result` what the engine answered; `staged` is true when the method
/// is preview-aware and the preview was on, so nothing reached the rig.
pub(crate) fn ui_actions(
    method: &str,
    params: &Value,
    result: &Value,
    staged: bool,
) -> Vec<ActionRecord> {
    if staged {
        return Vec::new();
    }
    let lighting = |action: &'static str, target: &str, detail: String| {
        ActionRecord::new(ActionSource::Ui, DOMAIN_LIGHTING, action, target, detail)
    };
    let audio = |action: &'static str, target: &str, detail: String| {
        ActionRecord::new(ActionSource::Ui, DOMAIN_AUDIO, action, target, detail)
    };

    match method {
        "lighting.power.all" => flag(params, "on")
            .map(|on| {
                vec![lighting(
                    if on { "all-on" } else { "all-off" },
                    "All lights",
                    format!("All lights {}", on_off(on)),
                )]
            })
            .unwrap_or_default(),
        "lighting.group.power" => flag(params, "on")
            .map(|on| {
                let name = text(result, "/groupName").unwrap_or("Group");
                vec![lighting(
                    if on { "group-on" } else { "group-off" },
                    name,
                    format!("Group {name} {}", on_off(on)),
                )]
            })
            .unwrap_or_default(),
        "lighting.fixture.update" => {
            let name = text(result, "/fixture/name").unwrap_or("Light");
            let mut rows = Vec::new();
            if let Some(on) = flag(params, "on") {
                rows.push(lighting(
                    if on { "light-on" } else { "light-off" },
                    name,
                    format!("{name} {}", on_off(on)),
                ));
            }
            let repatched = [
                "universe",
                "dmxStartAddress",
                "type",
                "definitionId",
                "modeId",
            ]
            .iter()
            .any(|key| params.get(*key).is_some_and(|value| !value.is_null()));
            if repatched {
                rows.push(lighting(
                    "light-repatched",
                    name,
                    format!(
                        "{name} repatched to U{} · {}",
                        result
                            .pointer("/fixture/universe")
                            .and_then(Value::as_i64)
                            .unwrap_or(0),
                        result
                            .pointer("/fixture/dmxStartAddress")
                            .and_then(Value::as_i64)
                            .unwrap_or(0)
                    ),
                ));
            }
            rows
        }
        "lighting.fixture.create" => {
            let name = text(result, "/fixture/name").unwrap_or("Light");
            vec![lighting(
                "light-added",
                name,
                format!("{name} added to the rig"),
            )]
        }
        "lighting.fixture.delete" => {
            let id = text(result, "/fixtureId").unwrap_or("light");
            vec![lighting(
                "light-removed",
                id,
                format!("Light removed from the rig ({id})"),
            )]
        }
        "lighting.scene.recall" => {
            let name = text(result, "/sceneName").unwrap_or("Scene");
            let fade = result
                .pointer("/fadeDurationSeconds")
                .and_then(Value::as_f64)
                .unwrap_or(0.0);
            let detail = if fade > 0.0 {
                format!("Scene recalled: {name} · {fade:.1} s fade")
            } else {
                format!("Scene recalled: {name}")
            };
            vec![lighting("scene-recalled", name, detail)]
        }
        "lighting.palette.apply" => {
            let name = text(result, "/paletteName").unwrap_or("Palette");
            let lights = result
                .pointer("/affectedFixtures")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            vec![lighting(
                "palette-applied",
                name,
                format!("Palette applied: {name} · {lights} light(s)"),
            )]
        }
        "lighting.settings.update" => {
            let mut rows = Vec::new();
            if let Some(enabled) = flag(params, "enabled") {
                rows.push(lighting(
                    if enabled {
                        "lighting-enabled"
                    } else {
                        "lighting-disabled"
                    },
                    "Lighting",
                    format!("Lighting switched {}", on_off(enabled)),
                ));
            }
            if params.get("bridgeIp").is_some() || params.get("universe").is_some() {
                rows.push(lighting(
                    "bridge-address-set",
                    "Bridge",
                    format!(
                        "Bridge address set: {} · universe {}",
                        text(result, "/bridgeIp").unwrap_or("none"),
                        result
                            .pointer("/universe")
                            .and_then(Value::as_i64)
                            .unwrap_or(0)
                    ),
                ));
            }
            rows
        }
        "lighting.fixture.identify" => {
            let id = text(result, "/fixtureId").unwrap_or("light");
            vec![lighting("identify", id, format!("Identify flash ({id})"))]
        }
        "lighting.fixture.identifySequence" => {
            let lights = result
                .pointer("/fixtureCount")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            vec![lighting(
                "identify-sequence",
                "Rig",
                format!("Identify sequence across {lights} light(s)"),
            )]
        }
        "lighting.fixture.identify.clearAll" => vec![lighting(
            "identify-cleared",
            "Rig",
            String::from("Identify flashes cleared"),
        )],
        "lighting.fixture.highlight" => {
            let lights = result
                .pointer("/fixtureCount")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            match text(result, "/mode") {
                Some("highlight") => vec![lighting(
                    "highlight-on",
                    "Rig",
                    format!("Highlight on · {lights} light(s)"),
                )],
                Some("solo") => vec![lighting(
                    "solo-on",
                    "Rig",
                    format!("Light solo on · {lights} light(s)"),
                )],
                _ => vec![lighting(
                    "highlight-off",
                    "Rig",
                    String::from("Highlight and light solo off"),
                )],
            }
        }
        "lighting.output.setArmed" => flag(result, "armed")
            .map(|armed| {
                vec![lighting(
                    if armed {
                        "outputs-armed"
                    } else {
                        "outputs-held"
                    },
                    "Light outputs",
                    String::from(if armed {
                        "Light outputs armed"
                    } else {
                        "Light outputs held"
                    }),
                )]
            })
            .unwrap_or_default(),

        "audio.channel.update" => {
            let name = text(result, "/name").unwrap_or("Channel");
            [
                ("mute", "mute", "Mute"),
                ("solo", "solo", "Solo"),
                ("phantom", "phantom", "48 V"),
                ("phase", "phase", "Phase invert"),
                ("pad", "pad", "Pad"),
                ("instrument", "instrument", "Instrument input"),
                ("autoSet", "auto-set", "AutoSet"),
            ]
            .iter()
            .filter_map(|(key, action, label)| flag(params, key).map(|on| (*action, *label, on)))
            .map(|(action, label, on)| {
                audio(action, name, format!("{label} {}: {name}", on_off(on)))
            })
            .collect()
        }
        "audio.mixTarget.update" => {
            let name = text(result, "/name").unwrap_or("Output");
            [
                ("mute", "mute", "Mute"),
                ("dim", "dim", "Dim"),
                ("mono", "mono", "Mono"),
                ("talkback", "talkback", "Talkback"),
            ]
            .iter()
            .filter_map(|(key, action, label)| flag(params, key).map(|on| (*action, *label, on)))
            .map(|(action, label, on)| {
                audio(action, name, format!("{label} {}: {name}", on_off(on)))
            })
            .collect()
        }
        "audio.channel.eq.update" => {
            let name = text(result, "/name").unwrap_or("Channel");
            let mut rows = Vec::new();
            if let Some(on) = flag(params, "enabled") {
                rows.push(audio("eq", name, format!("EQ {}: {name}", on_off(on))));
            }
            if let Some(on) = flag(params, "lowCutEnabled") {
                rows.push(audio(
                    "low-cut",
                    name,
                    format!("Low cut {}: {name}", on_off(on)),
                ));
            }
            if let Some(on) = flag(params, "bandEnabled") {
                rows.push(audio(
                    "eq-band",
                    name,
                    format!(
                        "EQ band {} {}: {name}",
                        text(params, "/bandId").unwrap_or("?"),
                        on_off(on)
                    ),
                ));
            }
            rows
        }
        "audio.channel.dynamics.update" => {
            let name = text(result, "/name").unwrap_or("Channel");
            flag(params, "enabled")
                .map(|on| {
                    vec![audio(
                        "dynamics",
                        name,
                        format!(
                            "Dynamics ({}) {}: {name}",
                            text(params, "/section").unwrap_or("section"),
                            on_off(on)
                        ),
                    )]
                })
                .unwrap_or_default()
        }
        "audio.channel.send.update" => {
            let name = text(result, "/name").unwrap_or("Channel");
            let output = text(params, "/mixTargetId").unwrap_or("output");
            [
                ("mute", "send-mute", "Send mute"),
                ("solo", "send-solo", "Send solo"),
                ("preFader", "send-pre-fader", "Send pre-fader"),
                ("linkStereo", "send-link", "Send stereo link"),
            ]
            .iter()
            .filter_map(|(key, action, label)| flag(params, key).map(|on| (*action, *label, on)))
            .map(|(action, label, on)| {
                audio(
                    action,
                    name,
                    format!("{label} {}: {name} to {output}", on_off(on)),
                )
            })
            .collect()
        }
        "audio.snapshot.recall" => {
            let name = text(result, "/snapshotName").unwrap_or("Console mix");
            vec![audio(
                "console-snapshot-recalled",
                name,
                format!("Console mix recalled: {name}"),
            )]
        }
        "audio.talkback.hold" => {
            if flag(result, "changed") != Some(true) {
                return Vec::new();
            }
            let on = flag(result, "talkback").unwrap_or(false);
            vec![audio(
                if on { "talkback-on" } else { "talkback-off" },
                "Talkback",
                format!("Talkback {}", on_off(on)),
            )]
        }
        "audio.solo.clearAll" => vec![audio(
            "solo-cleared",
            "Console",
            String::from("Every solo cleared"),
        )],
        "audio.settings.update" => {
            let mut rows = Vec::new();
            if let Some(on) = flag(params, "oscEnabled") {
                rows.push(audio(
                    if on {
                        "console-control-on"
                    } else {
                        "console-control-off"
                    },
                    "TotalMix",
                    format!("TotalMix control switched {}", on_off(on)),
                ));
            }
            if ["sendHost", "sendPort", "receivePort"]
                .iter()
                .any(|key| params.get(*key).is_some_and(|value| !value.is_null()))
            {
                rows.push(audio(
                    "console-address-set",
                    "TotalMix",
                    format!(
                        "TotalMix address set: {}:{}",
                        text(result, "/sendHost").unwrap_or("none"),
                        result
                            .pointer("/sendPort")
                            .and_then(Value::as_i64)
                            .unwrap_or(0)
                    ),
                ));
            }
            rows
        }

        // A probe that was given an address stores it, and the address is
        // where the light output and the console sends go from then on.
        "commissioning.check.run" => match text(params, "/target") {
            Some("lighting")
                if params.get("bridgeIp").is_some() || params.get("universe").is_some() =>
            {
                vec![lighting(
                    "bridge-address-set",
                    "Bridge",
                    format!(
                        "Bridge address set by the bridge probe: {}",
                        text(params, "/bridgeIp").unwrap_or("unchanged")
                    ),
                )]
            }
            Some("audio")
                if ["sendHost", "sendPort", "receivePort"]
                    .iter()
                    .any(|key| params.get(*key).is_some_and(|value| !value.is_null())) =>
            {
                vec![audio(
                    "console-address-set",
                    "TotalMix",
                    format!(
                        "TotalMix address set by the audio probe: {}",
                        text(params, "/sendHost").unwrap_or("unchanged")
                    ),
                )]
            }
            _ => Vec::new(),
        },

        // An applied archive rewrites the lighting and audio state the
        // devices are driven from. A database backup is only staged here; the
        // start that applies it writes its own row.
        "support.backup.restore" => {
            if flag(result, "requiresRestart") == Some(true) {
                return Vec::new();
            }
            vec![ActionRecord::new(
                ActionSource::Ui,
                DOMAIN_SETUP,
                "backup-restored",
                "Saved data",
                String::from("Backup archive restored: lighting and audio state replaced"),
            )]
        }
        _ => Vec::new(),
    }
}

// ---------------------------------------------------------------------------
// The Stream Deck: route + key + reply → rows
// ---------------------------------------------------------------------------

/// The rows a successful Stream Deck key leaves, from the route, the key, its
/// value and the bridge's reply (which says whether the key was staged in the
/// preview). Dial detents, selections and the bank leave none.
pub(crate) fn deck_actions(path: &str, action: &str, reply: &Value) -> Vec<ActionRecord> {
    let staged = flag(reply, "preview") == Some(true);
    let lighting = |action: &'static str, target: &str, detail: String| {
        ActionRecord::new(ActionSource::Deck, DOMAIN_LIGHTING, action, target, detail)
    };
    let audio = |action: &'static str, target: &str, detail: String| {
        ActionRecord::new(ActionSource::Deck, DOMAIN_AUDIO, action, target, detail)
    };

    match (path, action) {
        ("/api/deck/light-action", _) if staged => Vec::new(),
        ("/api/deck/light-action", "allOn" | "allOff") => {
            let on = action == "allOn";
            vec![lighting(
                if on { "all-on" } else { "all-off" },
                "All lights",
                format!("All lights {}", on_off(on)),
            )]
        }
        ("/api/deck/light-action", "toggleLight") => {
            let name = text(reply, "/light/name").unwrap_or("Light");
            reply
                .pointer("/light/on")
                .and_then(Value::as_bool)
                .map(|on| {
                    vec![lighting(
                        if on { "light-on" } else { "light-off" },
                        name,
                        format!("{name} {}", on_off(on)),
                    )]
                })
                .unwrap_or_default()
        }
        ("/api/deck/light-action", "resetIntensity") => {
            let name = text(reply, "/light/name").unwrap_or("Light");
            vec![lighting(
                "intensity-reset",
                name,
                format!("{name} intensity reset to 100 %"),
            )]
        }
        ("/api/deck/light-action", "resetCct") => {
            let name = text(reply, "/light/name").unwrap_or("Light");
            vec![lighting(
                "cct-reset",
                name,
                format!("{name} colour temperature reset"),
            )]
        }
        ("/api/deck/light-action", "recallScene") => {
            let name = text(reply, "/recalled").unwrap_or("Scene");
            vec![lighting(
                "scene-recalled",
                name,
                format!("Scene recalled: {name}"),
            )]
        }

        ("/api/deck/audio-action", "recallSnapshot") => {
            let name = text(reply, "/recalled").unwrap_or("Console mix");
            vec![audio(
                "console-snapshot-recalled",
                name,
                format!("Console mix recalled: {name}"),
            )]
        }
        ("/api/deck/audio-action", "dialPress") => {
            let name = text(reply, "/name").unwrap_or("Strip");
            flag(reply, "mute")
                .map(|on| vec![audio("mute", name, format!("Mute {}: {name}", on_off(on)))])
                .unwrap_or_default()
        }
        ("/api/deck/audio-action", "dimToggle") => flag(reply, "dim")
            .map(|on| {
                vec![audio(
                    "dim",
                    "Main out",
                    format!("Dim {}: main out", on_off(on)),
                )]
            })
            .unwrap_or_default(),
        ("/api/deck/audio-action", "talkOn" | "talkOff") => {
            // Companion repeats `talkOn` while the key is held; only the
            // press and the release change anything.
            if flag(reply, "changed") != Some(true) {
                return Vec::new();
            }
            let on = flag(reply, "talkback").unwrap_or(false);
            vec![audio(
                if on { "talkback-on" } else { "talkback-off" },
                "Talkback",
                format!("Talkback {}", on_off(on)),
            )]
        }
        ("/api/deck/audio-action", "soloClearAll") => {
            let cleared = reply
                .pointer("/cleared")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            if cleared == 0 {
                return Vec::new();
            }
            vec![audio(
                "solo-cleared",
                "Console",
                String::from("Every solo cleared"),
            )]
        }
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests;
