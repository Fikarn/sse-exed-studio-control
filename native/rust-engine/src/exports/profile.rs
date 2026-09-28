//! The Companion profile: the file `exports.companion.export` writes, with
//! its pages, its triggers (the 1 s poll and the page-follow), the custom
//! variables its displays are stored in and the bridge's token on every
//! request.

use super::audio::AUDIO_LCD_KEYS;
use super::controls::{deck_asset, lcd_refreshes, ControlDef};
use super::lights::{LIGHT_LCD_KEYS, LIGHT_POLLED_LCD_KEYS};
use super::pages::{deck_page_number, DECK_PAGES};
use crate::bootstrap::RuntimeContext;
use crate::cameras::deck::CAMERA_LCD_KEYS;
use crate::prompter::deck::PROMPTER_LCD_KEYS;
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::fs;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

pub(super) const INSTANCE_ID: &str = "projmgr";
// Companion connection labels only allow letters, digits, underscore, and dash;
// every $(label:variable) reference below must use this exact token.
pub(super) const INSTANCE_LABEL: &str = "SSE_Studio_Control";
const GENERIC_HTTP_MODULE_VERSION: &str = "2.7.0";
pub(super) const COMPANION_EXPORT_FORMAT_VERSION: u64 = 9;
const DEFAULT_COMPANION_URL: &str = "http://127.0.0.1:8000";

#[derive(Debug)]
pub enum ExportCommandError {
    InvalidParams(String),
    Storage(String),
}

#[derive(Debug, Serialize)]
pub struct CompanionExportSummary {
    pub path: String,
    #[serde(rename = "fileName")]
    pub file_name: String,
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    #[serde(rename = "pageCount")]
    pub page_count: usize,
    #[serde(rename = "actionCount")]
    pub action_count: usize,
    #[serde(rename = "triggerCount")]
    pub trigger_count: usize,
    #[serde(rename = "deckSurfaceId")]
    pub deck_surface_id: Option<String>,
}

pub fn export_companion_config(
    runtime: &RuntimeContext,
    base_url_override: Option<&str>,
) -> Result<CompanionExportSummary, ExportCommandError> {
    if !runtime.control_surface_bridge.available {
        return Err(ExportCommandError::InvalidParams(format!(
            "Companion export is unavailable because the native control-surface bridge is not running: {}",
            runtime
                .control_surface_bridge
                .error
                .clone()
                .unwrap_or_else(|| String::from("bridge unavailable"))
        )));
    }

    let export_dir = runtime.app_data_dir.join("exports");
    fs::create_dir_all(&export_dir)
        .map_err(|error| ExportCommandError::Storage(error.to_string()))?;
    let timestamp = current_export_timestamp();
    let file_name = format!("sse-exed-studio-control-native-{timestamp}.companionconfig");
    let path = export_dir.join(&file_name);
    let base_url = base_url_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(&runtime.control_surface_bridge.base_url);
    let deck_surface_id = discover_streamdeck_surface_id();
    let config = generate_companion_config(
        base_url,
        deck_surface_id.as_deref(),
        &runtime.control_surface_token,
    );
    let action_count = count_companion_actions(&config);
    let page_count = config
        .get("pages")
        .and_then(Value::as_object)
        .map(|pages| pages.len())
        .unwrap_or(0);
    let trigger_count = config
        .get("triggers")
        .and_then(Value::as_object)
        .map(|triggers| triggers.len())
        .unwrap_or(0);
    let json = serde_json::to_vec_pretty(&config)
        .map_err(|error| ExportCommandError::Storage(error.to_string()))?;
    fs::write(&path, json).map_err(|error| ExportCommandError::Storage(error.to_string()))?;

    Ok(CompanionExportSummary {
        path: path.display().to_string(),
        file_name,
        base_url: String::from(base_url),
        page_count,
        action_count,
        trigger_count,
        deck_surface_id,
    })
}

// Asks the local Companion for its configured surfaces so the page-follow
// triggers can bind to the physical Stream Deck+ instead of "self" (which has
// no meaning in a trigger context). Companion being closed is not an error —
// the export then targets "self" and the operator re-exports with Companion
// running to get surface-bound follow.
//
// A development build asks nobody (2026-09-28): Companion is the studio's,
// and the bridge lane exports a profile at every run of the gate. Its export
// targets "self", as one made with Companion closed does.
fn discover_streamdeck_surface_id() -> Option<String> {
    streamdeck_surface_id_from(
        studio_control_protocol::development::development_build(),
        || fetch_companion_export_json(DEFAULT_COMPANION_URL),
    )
}

pub(super) fn streamdeck_surface_id_from<F>(development_build: bool, fetch: F) -> Option<String>
where
    F: FnOnce() -> Option<String>,
{
    if development_build {
        return None;
    }
    let body = fetch()?;
    let parsed = serde_json::from_str::<Value>(&body).ok()?;
    parsed
        .get("surfaces")
        .and_then(Value::as_object)?
        .keys()
        .find(|key| key.starts_with("streamdeck:"))
        .cloned()
}

fn fetch_companion_export_json(companion_url: &str) -> Option<String> {
    let host_port = companion_url
        .trim()
        .strip_prefix("http://")
        .unwrap_or(companion_url)
        .trim_end_matches('/');
    let host = host_port.split(':').next().unwrap_or("127.0.0.1");
    let stream = TcpStream::connect(host_port).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(3))).ok()?;
    stream
        .set_write_timeout(Some(Duration::from_secs(3)))
        .ok()?;
    let mut stream = stream;
    // HTTP/1.0 so the server closes the connection instead of chunking.
    stream
        .write_all(
            format!(
                "GET /int/export/full?format=json HTTP/1.0\r\nHost: {host}\r\nAccept: application/json\r\n\r\n"
            )
            .as_bytes(),
        )
        .ok()?;
    let mut response = Vec::new();
    stream.read_to_end(&mut response).ok()?;
    let response = String::from_utf8_lossy(&response);
    let (headers, body) = response.split_once("\r\n\r\n")?;
    if !headers.starts_with("HTTP/1.0 200") && !headers.starts_with("HTTP/1.1 200") {
        return None;
    }
    Some(String::from(body))
}

fn current_export_timestamp() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    now.to_string()
}

fn count_companion_actions(config: &Value) -> usize {
    config
        .get("pages")
        .and_then(Value::as_object)
        .map(|pages| {
            pages
                .values()
                .filter_map(|page| page.get("controls").and_then(Value::as_object))
                .flat_map(|rows| rows.values())
                .filter_map(Value::as_object)
                .flat_map(|columns| columns.values())
                .filter_map(|control| control.get("steps").and_then(Value::as_object))
                .flat_map(|steps| steps.values())
                .filter_map(|step| step.get("action_sets").and_then(Value::as_object))
                .map(|action_sets| {
                    action_sets
                        .values()
                        .filter_map(Value::as_array)
                        .map(Vec::len)
                        .sum::<usize>()
                })
                .sum()
        })
        .unwrap_or(0)
}

pub(super) fn generate_companion_config(
    base_url: &str,
    deck_surface_id: Option<&str>,
    bridge_token: &str,
) -> Value {
    let mut config = generate_companion_config_without_auth(base_url, deck_surface_id);
    apply_bridge_auth_header(&mut config, &bridge_auth_header_option(bridge_token));
    config
}

/// The generic-http `header` option: a JSON object the module parses and sends
/// with every request. Carrying the bridge token here is what makes the
/// exported profile a client the bridge accepts (2026-09 production readiness,
/// Slice 2 — finding F01).
fn bridge_auth_header_option(bridge_token: &str) -> String {
    json!({ "Authorization": format!("Bearer {bridge_token}") }).to_string()
}

/// Every action that talks to the bridge connection — key presses, dial turns,
/// the per-action LCD refreshes and the 1 s poll trigger — gets the auth
/// header, wherever it sits in the profile. Walking the finished profile is
/// what guarantees no request is left out.
fn apply_bridge_auth_header(value: &mut Value, header: &str) {
    match value {
        Value::Object(map) => {
            if map.get("connectionId").and_then(Value::as_str) == Some(INSTANCE_ID) {
                if let Some(Value::Object(options)) = map.get_mut("options") {
                    if options.contains_key("header") {
                        options.insert(String::from("header"), Value::String(header.to_string()));
                    }
                }
            }
            for child in map.values_mut() {
                apply_bridge_auth_header(child, header);
            }
        }
        Value::Array(items) => {
            for item in items {
                apply_bridge_auth_header(item, header);
            }
        }
        _ => {}
    }
}

fn generate_companion_config_without_auth(base_url: &str, deck_surface_id: Option<&str>) -> Value {
    let mut pages = Map::new();
    for page in &DECK_PAGES {
        pages.insert(
            deck_page_number(page.id).to_string(),
            build_page(page.companion_id, page.label, (page.controls)()),
        );
    }

    json!({
        "version": COMPANION_EXPORT_FORMAT_VERSION,
        "type": "full",
        "pages": pages,
        "triggers": generate_companion_triggers(deck_surface_id),
        "triggerCollections": [],
        "custom_variables": generate_companion_custom_variables(),
        "customVariablesCollections": [],
        "expressionVariables": {},
        "expressionVariablesCollections": [],
        "connectionCollections": [],
        "instances": {
            INSTANCE_ID: {
                "moduleInstanceType": "connection",
                "instance_type": "generic-http",
                "moduleVersionId": GENERIC_HTTP_MODULE_VERSION,
                "sortOrder": 0,
                "label": INSTANCE_LABEL,
                "isFirstInit": false,
                "config": {
                    "prefix": base_url,
                    "proxyAddress": "",
                    "rejectUnauthorized": true
                },
                "secrets": {},
                "lastUpgradeIndex": 1,
                "enabled": true
            }
        }
    })
}

/// Every display the 1 s poll refreshes: the AUDIO page's (with `workspace`,
/// which every page's follow reads), the CAMERAS page's, the PROMPTER
/// page's, and the two LIGHTS keys that ask first. The LIGHTS page's other
/// displays are refreshed as the deck arrives.
pub(crate) fn polled_lcd_keys() -> Vec<&'static str> {
    AUDIO_LCD_KEYS
        .iter()
        .chain(CAMERA_LCD_KEYS.iter())
        .chain(PROMPTER_LCD_KEYS.iter())
        .chain(LIGHT_POLLED_LCD_KEYS.iter())
        .copied()
        .collect()
}

fn generate_companion_triggers(deck_surface_id: Option<&str>) -> Value {
    let controller = deck_surface_id.unwrap_or("self");
    let mut triggers = Map::new();

    triggers.insert(
        String::from("sse-trigger-lcd-poll"),
        json!({
            "type": "trigger",
            "options": {
                "name": "SSE LCD poll",
                "enabled": true,
                "sortOrder": 0
            },
            "actions": trigger_lcd_refreshes(&polled_lcd_keys()),
            "condition": [],
            "events": [
                {
                    "id": "sse-evt-lcd-poll",
                    "type": "interval",
                    "enabled": true,
                    "options": { "seconds": 1 }
                }
            ],
            "localVariables": []
        }),
    );

    // The deck follows the app's page: one trigger per deck page, on the page
    // the app saves (`lcd_workspace`). The app's Setup page has no deck page,
    // so the deck stays where it is while Setup is open.
    for (index, deck_page) in DECK_PAGES.iter().enumerate() {
        let slug = deck_page.workspace;
        let page = deck_page_number(deck_page.id);
        let sort_order = index + 1;
        let mut actions = vec![json!({
            "id": format!("sse-act-follow-{slug}"),
            "definitionId": "set_page",
            "connectionId": "internal",
            "options": {
                "controller_from_variable": false,
                "controller": controller,
                "controller_variable": "self",
                "page_from_variable": false,
                "page": page,
                "page_variable": "1"
            },
            "type": "action",
            "children": {}
        })];
        actions.extend(trigger_lcd_refreshes(deck_page.arrival_refreshes));
        triggers.insert(
            format!("sse-trigger-follow-{slug}"),
            json!({
                "type": "trigger",
                "options": {
                    "name": format!("SSE follow app - {slug}"),
                    "enabled": true,
                    "sortOrder": sort_order
                },
                "actions": actions,
                "condition": [
                    {
                        "id": format!("sse-cond-follow-{slug}"),
                        "definitionId": "variable_value",
                        "connectionId": "internal",
                        "options": {
                            "variable": "custom:lcd_workspace",
                            "op": "eq",
                            "value": slug
                        },
                        "type": "feedback",
                        "style": {
                            "color": 16777215,
                            "bgcolor": 16711680
                        },
                        "isInverted": false,
                        "children": {}
                    }
                ],
                "events": [
                    {
                        "id": format!("sse-evt-follow-{slug}"),
                        "type": "condition_true",
                        "enabled": true,
                        "options": {}
                    }
                ],
                "localVariables": []
            }),
        );
    }

    Value::Object(triggers)
}

fn trigger_lcd_refreshes(keys: &[&str]) -> Vec<Value> {
    lcd_refreshes(keys)
        .into_iter()
        .map(|mut action| {
            if let Some(object) = action.as_object_mut() {
                object.insert(String::from("children"), json!({}));
            }
            action
        })
        .collect()
}

// generic-http's jsonResultDataVariable stores into a pre-existing CUSTOM
// variable (referenced as $(custom:name)); a missing variable makes the store a
// silent no-op, so the profile must ship every LCD variable it polls into.
fn generate_companion_custom_variables() -> Value {
    let mut variables = Map::new();
    for (sort_order, key) in polled_lcd_keys()
        .iter()
        .chain(LIGHT_LCD_KEYS.iter())
        .enumerate()
    {
        variables.insert(
            format!("lcd_{key}"),
            json!({
                // Companion shows this to whoever opens its variables, so it
                // names the hardware link, not the engine (new pages program).
                "description": "SSE deck LCD text (kept by the Studio Control hardware link)",
                "defaultValue": "",
                "persistCurrentValue": false,
                "sortOrder": sort_order
            }),
        );
    }
    Value::Object(variables)
}

fn build_page(page_id: &str, name: &str, controls: Vec<ControlDef>) -> Value {
    let mut rows = Map::new();
    for control in controls {
        let size = control.text_size.unwrap_or("auto");
        let png64 = control
            .png_asset
            .map(|asset| Value::String(String::from(deck_asset(asset))))
            .unwrap_or(Value::Null);
        let show_topbar: Value = if control.hide_topbar {
            Value::Bool(false)
        } else {
            Value::String(String::from("default"))
        };
        let style = if let Some(expression) = control.text_expression {
            json!({
                "text": expression,
                "textExpression": true,
                "size": size,
                "png64": png64,
                "alignment": "center:center",
                "pngalignment": "center:center",
                "color": 16777215,
                "bgcolor": 0,
                "show_topbar": show_topbar
            })
        } else {
            json!({
                "text": control.label.replace(' ', "\\n"),
                "textExpression": false,
                "size": size,
                "png64": png64,
                "alignment": "center:center",
                "pngalignment": "center:center",
                "color": 16777215,
                "bgcolor": 0,
                "show_topbar": show_topbar
            })
        };
        let control_value = json!({
            "type": "button",
            "style": style,
            "options": {
                "stepProgression": "auto",
                "stepExpression": "",
                "rotaryActions": control.is_rotary
            },
            "feedbacks": control.feedbacks,
            "steps": {
                "0": {
                    "action_sets": {
                        "down": control.down,
                        // No key acts on its release or while it is held:
                        // TALK, the one that did, is gone (D26).
                        "up": [],
                        "rotate_left": control.rotate_left,
                        "rotate_right": control.rotate_right
                    },
                    "options": {
                        "runWhileHeld": []
                    }
                }
            },
            "localVariables": []
        });
        rows.entry(control.row.to_string())
            .or_insert_with(|| Value::Object(Map::new()));
        rows.get_mut(control.row)
            .and_then(Value::as_object_mut)
            .expect("row should be an object")
            .insert(control.col.to_string(), control_value);
    }

    json!({
        "id": page_id,
        "name": name,
        "controls": rows,
        "gridSize": {
            "minColumn": 0,
            "maxColumn": 3,
            "minRow": 0,
            "maxRow": 3
        }
    })
}

/// The most bridge requests the exported profile can have in flight at one
/// instant: its once-a-second LCD poll, which sends every request at once,
/// meeting the page-follow trigger the poll's own answer can set off and the
/// one press or turn that sends the most. The bridge's worker pool is sized to
/// hold them all (`control_surface_http`,
/// `the_pool_holds_the_decks_worst_instant`). New pages program, Slice 2: the
/// follow triggers sent nothing to the bridge until the lighting one took over
/// the LIGHTS LCD refreshes of the PROJECTS page's `LIGHTS >>` key (4). With
/// the CAMERAS and PROMPTER pages the poll was 41 requests, and the instant 62;
/// with the LIGHTS page's `OFF?` and `DEL?` (2026-09-28) they are 43 and 64.
#[cfg(test)]
pub(crate) fn deck_worst_instant_requests() -> DeckWorstInstant {
    fn bridge_requests(value: &Value) -> usize {
        match value {
            Value::Object(map) => {
                usize::from(map.get("connectionId").and_then(Value::as_str) == Some(INSTANCE_ID))
                    + map.values().map(bridge_requests).sum::<usize>()
            }
            Value::Array(items) => items.iter().map(bridge_requests).sum(),
            _ => 0,
        }
    }
    fn entries(value: &Value) -> impl Iterator<Item = &Value> {
        value.as_object().into_iter().flat_map(Map::values)
    }

    let config = generate_companion_config(
        "http://127.0.0.1:38201",
        Some("streamdeck:TESTSERIAL"),
        "token",
    );
    let poll = bridge_requests(&config["triggers"]["sse-trigger-lcd-poll"]["actions"]);
    let largest_follow = entries(&config["triggers"])
        .filter(|trigger| trigger["events"][0]["type"] == "condition_true")
        .map(|trigger| bridge_requests(&trigger["actions"]))
        .max()
        .unwrap_or(0);
    let largest_press = entries(&config["pages"])
        .flat_map(|page| entries(&page["controls"]))
        .flat_map(entries)
        .flat_map(|control| entries(&control["steps"]))
        .flat_map(|step| entries(&step["action_sets"]))
        .map(bridge_requests)
        .max()
        .unwrap_or(0);
    DeckWorstInstant {
        poll,
        follow: largest_follow,
        press: largest_press,
    }
}

/// The requests of the deck's worst instant, by what sends them.
#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct DeckWorstInstant {
    /// The 1 s poll: a request a display.
    pub poll: usize,
    /// The follow trigger that sends the most.
    pub follow: usize,
    /// The key that sends the most: its action and its displays.
    pub press: usize,
}

#[cfg(test)]
impl DeckWorstInstant {
    pub(crate) fn total(self) -> usize {
        self.poll + self.follow + self.press
    }
}
