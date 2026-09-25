use crate::bootstrap::RuntimeContext;
use crate::exports_audio::{
    audio_controls, deck_asset, generate_companion_custom_variables, AUDIO_LCD_KEYS, LIGHT_LCD_KEYS,
};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::fs;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

const INSTANCE_ID: &str = "projmgr";
// Companion connection labels only allow letters, digits, underscore, and dash;
// every $(label:variable) reference below must use this exact token.
const INSTANCE_LABEL: &str = "SSE_Studio_Control";
const GENERIC_HTTP_MODULE_VERSION: &str = "2.7.0";
const COMPANION_EXPORT_FORMAT_VERSION: u64 = 9;
const DEFAULT_COMPANION_URL: &str = "http://127.0.0.1:8000";

/// One page of the exported Stream Deck profile.
struct DeckPage {
    /// Companion's id for the page.
    companion_id: &'static str,
    /// The control-surface snapshot's page id, which also prefixes its
    /// control ids (`lights-btn-2`).
    id: &'static str,
    label: &'static str,
    /// The app page (`shell.workspace`) whose page-follow trigger brings the
    /// deck here.
    workspace: &'static str,
    /// The LCDs the page-follow trigger refreshes as the deck arrives: the
    /// LIGHTS texts are refreshed only by keys, the AUDIO ones by the 1 s poll.
    arrival_refreshes: &'static [&'static str],
    controls: fn() -> Vec<ControlDef>,
}

/// The deck's pages in their Companion order (new pages program, D5: the
/// pages follow the app's tabs). PROJECTS and TASKS left with Planning in
/// Slice 2, so LIGHTS is page 1 and AUDIO page 2; CAMERAS and PROMPTER join
/// with Part C. The page numbers, the page keys' jumps, the page-follow
/// triggers and the snapshot's page-nav targets all come from this list.
const DECK_PAGES: [DeckPage; 2] = [
    DeckPage {
        companion_id: "sse-page-lights",
        id: "lights",
        label: "LIGHTS",
        workspace: "lighting",
        arrival_refreshes: LIGHT_LCD_KEYS,
        controls: light_controls,
    },
    DeckPage {
        companion_id: "sse-page-audio",
        id: "audio",
        label: "AUDIO",
        workspace: "audio",
        arrival_refreshes: &[],
        controls: audio_controls,
    },
];

/// A page's Companion page number (1-based), 0 for a page the deck lacks.
fn deck_page_number(page_id: &str) -> i64 {
    DECK_PAGES
        .iter()
        .position(|page| page.id == page_id)
        .and_then(|index| i64::try_from(index + 1).ok())
        .unwrap_or(0)
}

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

#[derive(Debug, Serialize, Clone)]
pub struct ControlSurfaceSnapshot {
    pub pages: Vec<ControlSurfacePage>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ControlSurfacePage {
    pub id: String,
    pub label: String,
    pub buttons: Vec<ControlSurfaceControl>,
    pub dials: Vec<ControlSurfaceControl>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ControlSurfaceControl {
    pub id: String,
    #[serde(rename = "type")]
    pub control_type: String,
    pub position: i64,
    pub label: String,
    pub description: String,
    #[serde(rename = "isPageNav", skip_serializing_if = "Option::is_none")]
    pub is_page_nav: Option<bool>,
    #[serde(rename = "pageNavTarget", skip_serializing_if = "Option::is_none")]
    pub page_nav_target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<Value>,
    #[serde(rename = "lcdKey", skip_serializing_if = "Option::is_none")]
    pub lcd_key: Option<String>,
    #[serde(rename = "lcdRefreshKeys", skip_serializing_if = "Option::is_none")]
    pub lcd_refresh_keys: Option<Vec<String>>,
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
fn discover_streamdeck_surface_id() -> Option<String> {
    let companion_url =
        std::env::var("SSE_COMPANION_URL").unwrap_or_else(|_| String::from(DEFAULT_COMPANION_URL));
    let body = fetch_companion_export_json(&companion_url)?;
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

pub fn build_control_surface_snapshot() -> ControlSurfaceSnapshot {
    ControlSurfaceSnapshot {
        pages: DECK_PAGES
            .iter()
            .map(|page| control_surface_page(page.id, page.label, (page.controls)()))
            .collect(),
    }
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

fn generate_companion_config(
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

fn generate_companion_triggers(deck_surface_id: Option<&str>) -> Value {
    let controller = deck_surface_id.unwrap_or("self");
    let mut triggers = Map::new();

    triggers.insert(
        String::from("sse-trigger-lcd-poll"),
        json!({
            "type": "trigger",
            "options": {
                "name": "SSE audio LCD poll",
                "enabled": true,
                "sortOrder": 0
            },
            "actions": trigger_lcd_refreshes(AUDIO_LCD_KEYS),
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

#[derive(Clone)]
pub(crate) struct ControlDef {
    row: &'static str,
    col: &'static str,
    label: &'static str,
    is_rotary: bool,
    down: Vec<Value>,
    up: Vec<Value>,
    rotate_left: Vec<Value>,
    rotate_right: Vec<Value>,
    text_expression: Option<&'static str>,
    hold_repeats_down: bool,
    png_asset: Option<&'static str>,
    text_size: Option<&'static str>,
    hide_topbar: bool,
    feedbacks: Vec<Value>,
}

impl ControlDef {
    pub(crate) fn png(mut self, asset: &'static str) -> Self {
        self.png_asset = Some(asset);
        self
    }

    pub(crate) fn size(mut self, size: &'static str) -> Self {
        self.text_size = Some(size);
        self
    }

    pub(crate) fn no_topbar(mut self) -> Self {
        self.hide_topbar = true;
        self
    }

    pub(crate) fn with_feedbacks(mut self, feedbacks: Vec<Value>) -> Self {
        self.feedbacks = feedbacks;
        self
    }
}

fn control_surface_page(
    page_id: &str,
    label: &str,
    controls: Vec<ControlDef>,
) -> ControlSurfacePage {
    let prefix = page_id;
    let mut buttons = Vec::new();
    let mut dials = Vec::new();

    for control in controls {
        if control.is_rotary {
            let position = control.col.parse::<i64>().unwrap_or(0) + 1;
            dials.push(control_surface_control(
                format!("{prefix}-dial-{position}-press"),
                String::from("dial-press"),
                position,
                dial_press_label(&control),
                control_description(&control.down, control.label, "press"),
                &control.down,
                control.text_expression,
            ));
            dials.push(control_surface_control(
                format!("{prefix}-dial-{position}-left"),
                String::from("dial-turn-left"),
                position,
                dial_rotation_label(&control.rotate_left, "left"),
                control_description(&control.rotate_left, control.label, "left"),
                &control.rotate_left,
                None,
            ));
            dials.push(control_surface_control(
                format!("{prefix}-dial-{position}-right"),
                String::from("dial-turn-right"),
                position,
                dial_rotation_label(&control.rotate_right, "right"),
                control_description(&control.rotate_right, control.label, "right"),
                &control.rotate_right,
                None,
            ));
        } else {
            let row = control.row.parse::<i64>().unwrap_or(0);
            let col = control.col.parse::<i64>().unwrap_or(0);
            let position = row * 4 + col + 1;
            buttons.push(control_surface_control(
                format!("{prefix}-btn-{position}"),
                String::from("button"),
                position,
                String::from(control.label),
                control_description(&control.down, control.label, "button"),
                &control.down,
                control.text_expression,
            ));
        }
    }

    ControlSurfacePage {
        id: String::from(page_id),
        label: String::from(label),
        buttons,
        dials,
    }
}

fn control_surface_control(
    id: String,
    control_type: String,
    position: i64,
    label: String,
    description: String,
    actions: &[Value],
    text_expression: Option<&str>,
) -> ControlSurfaceControl {
    let page_nav_target = extract_page_nav_target(actions).map(String::from);
    let request = extract_primary_request(actions);
    let lcd_refresh_keys = extract_lcd_refresh_keys(actions);

    ControlSurfaceControl {
        id,
        control_type,
        position,
        label,
        description,
        is_page_nav: page_nav_target.as_ref().map(|_| true),
        page_nav_target,
        method: request.as_ref().map(|(method, _, _)| method.clone()),
        url: request.as_ref().map(|(_, url, _)| url.clone()),
        body: request.and_then(|(_, _, body)| body),
        lcd_key: text_expression.and_then(extract_lcd_key).map(String::from),
        lcd_refresh_keys: (!lcd_refresh_keys.is_empty()).then_some(lcd_refresh_keys),
    }
}

fn extract_page_nav_target(actions: &[Value]) -> Option<&'static str> {
    for action in actions {
        if action.get("connectionId").and_then(Value::as_str) != Some("internal") {
            continue;
        }
        if action.get("definitionId").and_then(Value::as_str) != Some("set_page") {
            continue;
        }
        let page = action
            .get("options")
            .and_then(Value::as_object)
            .and_then(|options| options.get("page"))
            .and_then(Value::as_i64)?;
        return DECK_PAGES
            .iter()
            .find(|deck_page| deck_page_number(deck_page.id) == page)
            .map(|deck_page| deck_page.label);
    }

    None
}

fn extract_primary_request(actions: &[Value]) -> Option<(String, String, Option<Value>)> {
    for action in actions {
        let Some(action_name) = action.get("definitionId").and_then(Value::as_str) else {
            continue;
        };
        let method = match action_name {
            "post" => "POST",
            "get" => "GET",
            _ => continue,
        };
        let Some(options) = action.get("options").and_then(Value::as_object) else {
            continue;
        };
        let Some(url) = options.get("url").and_then(Value::as_str) else {
            continue;
        };
        if url.starts_with("/api/deck/lcd?") {
            continue;
        }
        let body = options.get("body").and_then(|value| match value {
            Value::String(serialized) => serde_json::from_str(serialized).ok(),
            Value::Object(_) => Some(value.clone()),
            _ => None,
        });
        return Some((String::from(method), String::from(url), body));
    }

    None
}

fn extract_lcd_key(expression: &str) -> Option<&str> {
    expression.split("lcd_").nth(1)?.strip_suffix(')')
}

fn extract_lcd_refresh_keys(actions: &[Value]) -> Vec<String> {
    actions
        .iter()
        .filter_map(|action| {
            let options = action.get("options").and_then(Value::as_object)?;
            let url = options.get("url").and_then(Value::as_str)?;
            url.split("key=").nth(1).map(String::from)
        })
        .collect()
}

fn dial_press_label(control: &ControlDef) -> String {
    String::from(control.label)
}

fn dial_rotation_label(actions: &[Value], direction: &str) -> String {
    if let Some(action) = primary_payload_action(actions) {
        return match (action.as_str(), direction) {
            ("selectPrevLight", _) => String::from("Prev Light"),
            ("selectNextLight", _) => String::from("Next Light"),
            ("intensityDown", _) => String::from("Intensity Down"),
            ("intensityUp", _) => String::from("Intensity Up"),
            ("cctDown", _) => String::from("CCT Down"),
            ("cctUp", _) => String::from("CCT Up"),
            ("selectPrevScene", _) => String::from("Prev Scene"),
            ("selectNextScene", _) => String::from("Next Scene"),
            ("dialTurn", "left") => String::from("Level Down"),
            ("dialTurn", "right") => String::from("Level Up"),
            _ => {
                if direction == "left" {
                    String::from("Previous")
                } else {
                    String::from("Next")
                }
            }
        };
    }

    if direction == "left" {
        String::from("Previous")
    } else {
        String::from("Next")
    }
}

fn control_description(actions: &[Value], fallback_label: &str, interaction: &str) -> String {
    let Some(action) = primary_payload_action(actions) else {
        if let Some(page_target) = extract_page_nav_target(actions) {
            return format!("Navigate to the {page_target} page.");
        }
        return format!("{interaction} {fallback_label}.");
    };

    let value = primary_payload_value(actions);
    match action.as_str() {
        "toggleLight" => String::from("Toggle the selected light."),
        "allOn" => String::from("Turn all lights on."),
        "allOff" => String::from("Turn all lights off."),
        "saveScene" => String::from("Save the current lighting scene."),
        "recallScene" => String::from("Recall the selected lighting scene."),
        "deleteScene" => String::from("Delete the selected lighting scene."),
        "selectPrevLight" => String::from("Select the previous light."),
        "selectNextLight" => String::from("Select the next light."),
        "resetIntensity" => String::from("Reset the selected light intensity."),
        "intensityDown" => String::from("Lower the selected light intensity."),
        "intensityUp" => String::from("Raise the selected light intensity."),
        "resetCct" => String::from("Reset the selected light CCT."),
        "cctDown" => String::from("Lower the selected light CCT."),
        "cctUp" => String::from("Raise the selected light CCT."),
        "recallSnapshot" => String::from("Recall the current audio snapshot."),
        "dialTurn" => format!(
            "Ride the level on strip {}.",
            value
                .as_deref()
                .and_then(|value| value.split(':').next())
                .unwrap_or("the selected")
        ),
        "dialPress" => format!(
            "Toggle mute on strip {}.",
            value.unwrap_or_else(|| String::from("the selected"))
        ),
        "stripTap" => format!(
            "Select strip {} in the app inspector.",
            value.unwrap_or_else(|| String::from("the tapped"))
        ),
        "setMixTarget" => format!(
            "Make {} the active mix target.",
            value
                .as_deref()
                .map(format_payload_value)
                .unwrap_or_else(|| String::from("the selected output"))
        ),
        "cycleBank" => String::from("Cycle the dial bank: inputs, playback, outputs."),
        "toggleDialMode" => String::from("Toggle the input dials between fader and gain."),
        "dimToggle" => String::from("Toggle control-room dim on the main out."),
        "talkOn" => String::from("Hold to talk to the phones mixes."),
        "talkOff" => String::from("Release talkback."),
        "soloClearAll" => String::from("Clear solo on every audio channel."),
        _ => format!("{interaction} {fallback_label}."),
    }
}

fn primary_payload_action(actions: &[Value]) -> Option<String> {
    primary_payload_body(actions)?
        .get("action")
        .and_then(Value::as_str)
        .map(String::from)
}

fn primary_payload_value(actions: &[Value]) -> Option<String> {
    primary_payload_body(actions)?
        .get("value")
        .and_then(Value::as_str)
        .map(String::from)
}

fn primary_payload_body(actions: &[Value]) -> Option<Value> {
    extract_primary_request(actions).and_then(|(_, _, body)| body)
}

fn format_payload_value(value: &str) -> String {
    value.replace('-', " ")
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
        let run_while_held = if control.hold_repeats_down {
            control
                .down
                .iter()
                .filter_map(|action| action.get("id").and_then(Value::as_str))
                .map(String::from)
                .collect::<Vec<_>>()
        } else {
            Vec::new()
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
                        "up": control.up,
                        "rotate_left": control.rotate_left,
                        "rotate_right": control.rotate_right
                    },
                    "options": {
                        "runWhileHeld": run_while_held
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

/// The LIGHTS page (page 1). New pages program, Slice 2: its `<< PROJ` key
/// (row 0, column 0) left with Planning and the slot stays empty, since
/// LIGHTS is the first page. The page keys post nothing to the bridge any
/// more: the deck mode they stored was a Planning setting nothing read.
fn light_controls() -> Vec<ControlDef> {
    vec![
        button(
            "0",
            "1",
            "Toggle",
            http_post("/api/deck/light-action", json!({"action":"toggleLight"})),
        ),
        button(
            "0",
            "2",
            "All On",
            http_post("/api/deck/light-action", json!({"action":"allOn"})),
        ),
        button(
            "0",
            "3",
            "All Off",
            http_post("/api/deck/light-action", json!({"action":"allOff"})),
        ),
        button(
            "1",
            "0",
            "Save",
            http_post("/api/deck/light-action", json!({"action":"saveScene"})),
        ),
        button(
            "1",
            "1",
            "Recall",
            http_post("/api/deck/light-action", json!({"action":"recallScene"})),
        ),
        button(
            "1",
            "2",
            "Del Scene",
            http_post("/api/deck/light-action", json!({"action":"deleteScene"})),
        ),
        // The next page. Its LCD refreshes named four keys the audio surface
        // retired in 2026-09 (`audio_ch_nav`, `audio_gain1`–`3`), which the
        // bridge refused on every press; the 1 s poll keeps AUDIO current.
        button("1", "3", "AUDIO >>", page_jump(deck_page_number("audio"))),
        dial(
            "3",
            "0",
            "Light",
            Some("$(custom:lcd_light_nav)"),
            http_post("/api/deck/light-action", json!({"action":"toggleLight"}))
                .into_iter()
                .chain(lcd_refreshes(&[
                    "light_nav",
                    "light_intensity",
                    "light_cct",
                ]))
                .collect(),
            http_post(
                "/api/deck/light-action",
                json!({"action":"selectPrevLight"}),
            ),
            http_post(
                "/api/deck/light-action",
                json!({"action":"selectNextLight"}),
            ),
        ),
        dial(
            "3",
            "1",
            "Intensity",
            Some("$(custom:lcd_light_intensity)"),
            http_post("/api/deck/light-action", json!({"action":"resetIntensity"})),
            http_post("/api/deck/light-action", json!({"action":"intensityDown"})),
            http_post("/api/deck/light-action", json!({"action":"intensityUp"})),
        ),
        dial(
            "3",
            "2",
            "CCT",
            Some("$(custom:lcd_light_cct)"),
            http_post("/api/deck/light-action", json!({"action":"resetCct"})),
            http_post("/api/deck/light-action", json!({"action":"cctDown"})),
            http_post("/api/deck/light-action", json!({"action":"cctUp"})),
        ),
        dial(
            "3",
            "3",
            "Scene",
            Some("$(custom:lcd_scene_nav)"),
            http_post("/api/deck/light-action", json!({"action":"recallScene"})),
            http_post(
                "/api/deck/light-action",
                json!({"action":"selectPrevScene"}),
            ),
            http_post(
                "/api/deck/light-action",
                json!({"action":"selectNextScene"}),
            ),
        ),
    ]
}

pub(crate) fn audio_action_with_refreshes(body: Value, refresh_keys: &[&str]) -> Vec<Value> {
    http_post("/api/deck/audio-action", body)
        .into_iter()
        .chain(lcd_refreshes(refresh_keys))
        .collect()
}

pub(crate) fn button(
    row: &'static str,
    col: &'static str,
    label: &'static str,
    down: Vec<Value>,
) -> ControlDef {
    ControlDef {
        row,
        col,
        label,
        is_rotary: false,
        down,
        up: Vec::new(),
        rotate_left: Vec::new(),
        rotate_right: Vec::new(),
        text_expression: None,
        hold_repeats_down: false,
        png_asset: None,
        text_size: None,
        hide_topbar: false,
        feedbacks: Vec::new(),
    }
}

pub(crate) fn expression_button(
    row: &'static str,
    col: &'static str,
    label: &'static str,
    text_expression: &'static str,
    down: Vec<Value>,
) -> ControlDef {
    ControlDef {
        text_expression: Some(text_expression),
        ..button(row, col, label, down)
    }
}

pub(crate) fn momentary_button(
    row: &'static str,
    col: &'static str,
    label: &'static str,
    text_expression: &'static str,
    down: Vec<Value>,
    up: Vec<Value>,
) -> ControlDef {
    ControlDef {
        up,
        text_expression: Some(text_expression),
        hold_repeats_down: true,
        ..button(row, col, label, down)
    }
}

pub(crate) fn dial(
    row: &'static str,
    col: &'static str,
    label: &'static str,
    text_expression: Option<&'static str>,
    down: Vec<Value>,
    rotate_left: Vec<Value>,
    rotate_right: Vec<Value>,
) -> ControlDef {
    ControlDef {
        row,
        col,
        label,
        is_rotary: true,
        down,
        up: Vec::new(),
        rotate_left,
        rotate_right,
        text_expression,
        hold_repeats_down: false,
        png_asset: None,
        text_size: None,
        hide_topbar: false,
        feedbacks: Vec::new(),
    }
}

fn page_jump(page: i64) -> Vec<Value> {
    vec![json!({
        "id": next_action_id(),
        "definitionId": "set_page",
        "connectionId": "internal",
        "options": {
            "page": page,
            "controller": "self"
        },
        "type": "action",
        "children": {}
    })]
}

pub(crate) fn http_post(path: &'static str, body: Value) -> Vec<Value> {
    vec![json!({
        "id": next_action_id(),
        "definitionId": "post",
        "connectionId": INSTANCE_ID,
        "options": {
            "url": path,
            "header": "",
            "contenttype": "application/json",
            "jsonResultDataVariable": "",
            "result_stringify": true,
            "statusCodeVariable": "",
            "body": body.to_string()
        },
        "type": "action"
    })]
}

pub(crate) fn lcd_refreshes(keys: &[&str]) -> Vec<Value> {
    keys.iter()
        .map(|key| {
            json!({
                "id": next_action_id(),
                "definitionId": "get",
                "connectionId": INSTANCE_ID,
                "options": {
                    "url": format!("/api/deck/lcd?key={key}"),
                    "header": "",
                    "contenttype": "application/json",
                    "jsonResultDataVariable": format!("lcd_{key}"),
                    "result_stringify": false,
                    "statusCodeVariable": ""
                },
                "type": "action"
            })
        })
        .collect()
}

pub(crate) fn next_action_id() -> String {
    use std::sync::atomic::{AtomicUsize, Ordering};

    static ACTION_COUNTER: AtomicUsize = AtomicUsize::new(1);
    let next = ACTION_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("act-{next}")
}

/// The most bridge requests the exported profile can have in flight at one
/// instant: its once-a-second LCD poll, which sends every request at once,
/// meeting the page-follow trigger the poll's own answer can set off and the
/// one press or turn that sends the most. The bridge's worker pool is sized to
/// hold them all (`control_surface_http`,
/// `the_pool_holds_the_decks_worst_instant`). New pages program, Slice 2: the
/// follow triggers sent nothing to the bridge until the lighting one took over
/// the LIGHTS LCD refreshes of the PROJECTS page's `LIGHTS >>` key (4).
#[cfg(test)]
pub(crate) fn deck_worst_instant_requests() -> usize {
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
    poll + largest_follow + largest_press
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::exports_audio::{DECK_AMBER_BG, DECK_MUTED_INK};
    use std::collections::BTreeSet;

    const TEST_TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    fn collect_bridge_actions<'a>(value: &'a Value, into: &mut Vec<&'a Value>) {
        match value {
            Value::Object(map) => {
                if map.get("connectionId").and_then(Value::as_str) == Some(INSTANCE_ID) {
                    into.push(value);
                }
                for child in map.values() {
                    collect_bridge_actions(child, into);
                }
            }
            Value::Array(items) => {
                for item in items {
                    collect_bridge_actions(item, into);
                }
            }
            _ => {}
        }
    }

    // 2026-09 production readiness, Slice 2 (finding F01): the profile is the
    // client the bridge accepts, so every request it makes must carry the
    // token — and nothing else in the file may.
    #[test]
    fn companion_export_carries_the_bridge_token_on_every_request() {
        let config = generate_companion_config(
            "http://127.0.0.1:38201",
            Some("streamdeck:TESTSERIAL"),
            TEST_TOKEN,
        );
        let mut actions = Vec::new();
        collect_bridge_actions(&config, &mut actions);
        assert!(
            actions.len() > 50,
            "every deck key, dial and LCD refresh talks to the bridge: {}",
            actions.len()
        );

        let expected = json!({ "Authorization": format!("Bearer {TEST_TOKEN}") });
        for action in &actions {
            let header = action["options"]["header"]
                .as_str()
                .unwrap_or_else(|| panic!("bridge action without a header option: {action}"));
            let parsed: Value = serde_json::from_str(header)
                .expect("the header option is the JSON object generic-http parses");
            assert_eq!(parsed, expected, "{action}");
        }

        let poll_actions = config["triggers"]["sse-trigger-lcd-poll"]["actions"]
            .as_array()
            .expect("poll actions");
        assert!(
            !poll_actions.is_empty()
                && poll_actions.iter().all(|action| action["options"]["header"]
                    .as_str()
                    .is_some_and(|header| header.contains(TEST_TOKEN))),
            "the 1 s LCD poll must be authenticated too"
        );

        let serialized = config.to_string();
        assert_eq!(
            serialized.matches(TEST_TOKEN).count(),
            actions.len(),
            "the token appears once per bridge request and nowhere else"
        );
    }

    #[test]
    fn companion_export_contains_native_bridge_instance() {
        let config = generate_companion_config("http://127.0.0.1:38201", None, TEST_TOKEN);
        let prefix = config["instances"][INSTANCE_ID]["config"]["prefix"]
            .as_str()
            .expect("prefix should be a string");
        assert_eq!(prefix, "http://127.0.0.1:38201");
        assert_eq!(config["instances"][INSTANCE_ID]["label"], INSTANCE_LABEL);
        assert!(
            !INSTANCE_LABEL.contains(' '),
            "Companion connection labels must not contain spaces"
        );
    }

    #[test]
    fn companion_export_uses_override_base_url() {
        let config = generate_companion_config("http://localhost:3000", None, TEST_TOKEN);
        let prefix = config["instances"][INSTANCE_ID]["config"]["prefix"]
            .as_str()
            .expect("prefix should be a string");
        assert_eq!(prefix, "http://localhost:3000");
    }

    #[test]
    fn companion_export_is_a_native_v9_full_config() {
        let config = generate_companion_config("http://127.0.0.1:38201", None, TEST_TOKEN);
        assert_eq!(config["version"], COMPANION_EXPORT_FORMAT_VERSION);
        assert_eq!(config["type"], "full");
        // New pages program, Slice 2 (D5): LIGHTS and AUDIO; PROJECTS and
        // TASKS left with Planning.
        assert_eq!(
            config["pages"].as_object().map(|pages| pages.len()),
            Some(2)
        );
        assert!(config["pages"]["2"]["id"].is_string());
        assert!(config.get("surfaces").is_none());

        let custom_variables = config["custom_variables"]
            .as_object()
            .expect("custom variables should exist");
        assert_eq!(
            custom_variables.len(),
            AUDIO_LCD_KEYS.len() + LIGHT_LCD_KEYS.len()
        );
        assert!(custom_variables.contains_key("lcd_light_nav"));
        assert!(custom_variables.contains_key("lcd_audio_strip_1_level"));
        assert!(
            custom_variables.contains_key("lcd_workspace"),
            "the polled LCD variables must ship with the profile - generic-http stores are silent no-ops without them"
        );

        // LIGHTS' first key sits in column 1: column 0 held `<< PROJ`.
        let sample_action =
            &config["pages"]["1"]["controls"]["0"]["1"]["steps"]["0"]["action_sets"]["down"][0];
        assert_eq!(sample_action["connectionId"], INSTANCE_ID);
        assert_eq!(sample_action["definitionId"], "post");
    }

    #[test]
    fn companion_export_audio_page_maps_the_deck_hardware() {
        let config = generate_companion_config("http://127.0.0.1:38201", None, TEST_TOKEN);
        let controls = config["pages"]["2"]["controls"]
            .as_object()
            .expect("audio controls should exist");

        for row in ["0", "1", "2", "3"] {
            assert_eq!(
                controls[row].as_object().map(|columns| columns.len()),
                Some(4),
                "audio row {row} should populate all four columns"
            );
        }

        let strip_cell = &controls["2"]["0"];
        assert_eq!(strip_cell["style"]["text"], "$(custom:lcd_audio_strip_1)");
        let tap_body = strip_cell["steps"]["0"]["action_sets"]["down"][0]["options"]["body"]
            .as_str()
            .expect("tap body should exist");
        assert!(tap_body.contains("stripTap"));

        let encoder = &controls["3"]["0"];
        assert_eq!(encoder["options"]["rotaryActions"], true);
        let left_body = encoder["steps"]["0"]["action_sets"]["rotate_left"][0]["options"]["body"]
            .as_str()
            .expect("rotate body should exist");
        assert!(left_body.contains("dialTurn") && left_body.contains("1:down"));
        let press_body = encoder["steps"]["0"]["action_sets"]["down"][0]["options"]["body"]
            .as_str()
            .expect("press body should exist");
        assert!(press_body.contains("dialPress"));

        let talk = &controls["1"]["2"];
        let talk_down_id = talk["steps"]["0"]["action_sets"]["down"][0]["id"]
            .as_str()
            .expect("talk down action id");
        let run_while_held = talk["steps"]["0"]["options"]["runWhileHeld"]
            .as_array()
            .expect("runWhileHeld should be an array");
        assert_eq!(run_while_held[0], talk_down_id);
        let talk_up_body = talk["steps"]["0"]["action_sets"]["up"][0]["options"]["body"]
            .as_str()
            .expect("talk up body should exist");
        assert!(talk_up_body.contains("talkOff"));
    }

    #[test]
    fn companion_export_audio_page_carries_the_visual_language() {
        let config = generate_companion_config("http://127.0.0.1:38201", None, TEST_TOKEN);
        let controls = config["pages"]["2"]["controls"]
            .as_object()
            .expect("audio controls should exist");

        let main_key = &controls["0"]["0"];
        assert_eq!(main_key["style"]["text"], "MAIN");
        assert_eq!(main_key["style"]["textExpression"], false);
        assert_eq!(main_key["style"]["show_topbar"], false);
        assert!(main_key["style"]["png64"]
            .as_str()
            .is_some_and(|png| png.starts_with("iVBOR")));
        let main_feedbacks = main_key["feedbacks"].as_array().expect("feedbacks");
        assert_eq!(
            main_feedbacks[0]["options"]["variable"],
            "custom:lcd_audio_state_target"
        );
        assert_eq!(main_feedbacks[0]["options"]["value"], "main");
        assert_eq!(main_feedbacks[0]["style"]["bgcolor"], DECK_AMBER_BG);

        let talk_key = &controls["1"]["2"];
        let talk_feedbacks = talk_key["feedbacks"].as_array().expect("feedbacks");
        assert_eq!(
            talk_feedbacks[0]["options"]["variable"],
            "custom:lcd_audio_state_talk"
        );
        assert_eq!(talk_feedbacks[0]["options"]["value"], "live");

        let solo_key = &controls["1"]["3"];
        let solo_feedbacks = solo_key["feedbacks"].as_array().expect("feedbacks");
        assert_eq!(solo_feedbacks[0]["isInverted"], true);
        assert_eq!(solo_feedbacks[0]["options"]["value"], "0");

        let strip = &controls["2"]["0"];
        assert_eq!(strip["style"]["show_topbar"], false);
        let strip_feedbacks = strip["feedbacks"].as_array().expect("strip feedbacks");
        // 13 normal + 13 muted bars, off, empty, plus 3 state color feedbacks.
        assert_eq!(strip_feedbacks.len(), 31);
        let png_feedbacks = strip_feedbacks
            .iter()
            .filter(|fb| fb["style"]["png64"].is_string())
            .count();
        assert_eq!(png_feedbacks, 28);
        assert!(strip_feedbacks.iter().any(|fb| {
            fb["options"]["variable"] == "custom:lcd_audio_strip_1_state"
                && fb["options"]["value"] == "muted"
                && fb["style"]["color"] == DECK_MUTED_INK
        }));
    }

    #[test]
    fn companion_export_triggers_poll_and_follow_the_app() {
        let config = generate_companion_config(
            "http://127.0.0.1:38201",
            Some("streamdeck:TESTSERIAL"),
            TEST_TOKEN,
        );
        let triggers = config["triggers"]
            .as_object()
            .expect("triggers should exist");
        // New pages program, Slice 2: the poll and a follow trigger per deck
        // page (the Planning one left with PROJECTS).
        assert_eq!(triggers.len(), 3);

        let poll = &triggers["sse-trigger-lcd-poll"];
        assert_eq!(poll["options"]["enabled"], true);
        assert_eq!(poll["events"][0]["type"], "interval");
        assert_eq!(poll["events"][0]["options"]["seconds"], 1);
        assert_eq!(
            poll["actions"].as_array().map(Vec::len),
            Some(AUDIO_LCD_KEYS.len())
        );

        let follow = &triggers["sse-trigger-follow-audio"];
        assert_eq!(follow["events"][0]["type"], "condition_true");
        assert_eq!(
            follow["condition"][0]["options"]["variable"],
            "custom:lcd_workspace"
        );
        assert_eq!(follow["condition"][0]["options"]["value"], "audio");
        assert_eq!(follow["actions"][0]["definitionId"], "set_page");
        assert_eq!(
            follow["actions"][0]["options"]["controller"],
            "streamdeck:TESTSERIAL"
        );
        assert_eq!(follow["actions"][0]["options"]["page"], 2);

        let fallback = generate_companion_config("http://127.0.0.1:38201", None, TEST_TOKEN);
        assert_eq!(
            fallback["triggers"]["sse-trigger-follow-audio"]["actions"][0]["options"]["controller"],
            "self"
        );
    }

    #[test]
    fn control_surface_snapshot_matches_the_deck_page_model() {
        let snapshot = build_control_surface_snapshot();
        // New pages program, Slice 2 (D5): LIGHTS is page 1, AUDIO page 2.
        // The PROJECTS page's model (its first key, its `TASKS >>` and
        // `LIGHTS >>` keys, its project dial) left with it; LIGHTS carries
        // the same checks.
        assert_eq!(snapshot.pages.len(), 2);
        let lights = &snapshot.pages[0];
        assert_eq!(lights.id, "lights");
        assert_eq!(lights.label, "LIGHTS");
        assert_eq!(
            lights.buttons.len(),
            7,
            "the LIGHTS page's eight keys less `<< PROJ`"
        );
        assert_eq!(lights.dials.len(), 12);
        assert_eq!(lights.buttons[0].id, "lights-btn-2");
        assert_eq!(lights.buttons[0].position, 2);
        assert_eq!(
            lights.buttons[0].url.as_deref(),
            Some("/api/deck/light-action")
        );
        let audio_key = &lights.buttons[6];
        assert_eq!(audio_key.label, "AUDIO >>");
        assert_eq!(audio_key.page_nav_target.as_deref(), Some("AUDIO"));
        assert_eq!(audio_key.is_page_nav, Some(true));
        assert_eq!(audio_key.method, None, "a page key posts nothing");
        assert_eq!(audio_key.lcd_refresh_keys, None);
        assert_eq!(audio_key.description, "Navigate to the AUDIO page.");
        assert_eq!(lights.dials[0].id, "lights-dial-1-press");
        assert_eq!(lights.dials[0].lcd_key.as_deref(), Some("light_nav"));
        assert_eq!(
            lights.dials[0].lcd_refresh_keys.as_ref().map(Vec::len),
            Some(3)
        );

        let audio = &snapshot.pages[1];
        assert_eq!(audio.label, "AUDIO");
        assert_eq!(
            audio.buttons.len(),
            12,
            "audio page should model 8 keys plus 4 touch-strip cells"
        );
        assert_eq!(audio.dials.len(), 12);
        assert!(audio.buttons.iter().any(|control| control
            .body
            .as_ref()
            .is_some_and(
                |body| body.get("action").and_then(Value::as_str) == Some("setMixTarget")
            )));
        let strip_cell = audio
            .buttons
            .iter()
            .find(|control| control.position == 9)
            .expect("strip cell should sit at position 9");
        assert_eq!(strip_cell.lcd_key.as_deref(), Some("audio_strip_1"));
        assert!(audio
            .dials
            .iter()
            .any(|control| control.control_type == "dial-turn-right"
                && control.body.as_ref().is_some_and(|body| {
                    body.get("action").and_then(Value::as_str) == Some("dialTurn")
                })));
    }

    // -----------------------------------------------------------------
    // New pages program, Slice 2 (D5): PROJECTS and TASKS leave the deck.
    // -----------------------------------------------------------------

    fn test_profile() -> Value {
        generate_companion_config(
            "http://127.0.0.1:38201",
            Some("streamdeck:TESTSERIAL"),
            TEST_TOKEN,
        )
    }

    /// Every `set_page` jump in `value`, as (the page it jumps to).
    fn page_jumps(value: &Value, into: &mut Vec<i64>) {
        match value {
            Value::Object(map) => {
                if map.get("definitionId").and_then(Value::as_str) == Some("set_page") {
                    into.push(value["options"]["page"].as_i64().unwrap_or(-1));
                }
                for child in map.values() {
                    page_jumps(child, into);
                }
            }
            Value::Array(items) => {
                for item in items {
                    page_jumps(item, into);
                }
            }
            _ => {}
        }
    }

    /// The LCD keys a profile touches: the ones it shows or tests
    /// (`custom:lcd_<key>`), the ones it asks the bridge for
    /// (`/api/deck/lcd?key=<key>`) and the variables those answers are
    /// stored in (`jsonResultDataVariable`).
    #[derive(Default)]
    struct LcdKeys {
        read: BTreeSet<String>,
        requested: BTreeSet<String>,
        stored: BTreeSet<String>,
    }

    fn collect_lcd_keys(value: &Value, into: &mut LcdKeys) {
        fn key_after<'a>(text: &'a str, marker: &str) -> Vec<&'a str> {
            text.match_indices(marker)
                .map(|(at, _)| {
                    let rest = &text[at + marker.len()..];
                    let end = rest
                        .find(|character: char| {
                            !(character.is_ascii_alphanumeric() || character == '_')
                        })
                        .unwrap_or(rest.len());
                    &rest[..end]
                })
                .collect()
        }
        match value {
            Value::String(text) => {
                into.read
                    .extend(key_after(text, "custom:lcd_").into_iter().map(String::from));
                into.requested.extend(
                    key_after(text, "/api/deck/lcd?key=")
                        .into_iter()
                        .map(String::from),
                );
            }
            Value::Object(map) => {
                if let Some(variable) = map
                    .get("jsonResultDataVariable")
                    .and_then(Value::as_str)
                    .filter(|variable| !variable.is_empty())
                {
                    into.stored.insert(
                        variable
                            .strip_prefix("lcd_")
                            .unwrap_or_else(|| panic!("an answer stored outside lcd_: {variable}"))
                            .to_string(),
                    );
                }
                for child in map.values() {
                    collect_lcd_keys(child, into);
                }
            }
            Value::Array(items) => {
                for item in items {
                    collect_lcd_keys(item, into);
                }
            }
            _ => {}
        }
    }

    // Nothing of Planning is left on the deck: no PROJECTS or TASKS page, no
    // key on the Planning route (`/api/deck/action`), no deck-mode key (a
    // Planning setting), no project, task or sort LCD, no Planning follow.
    #[test]
    fn the_deck_profile_and_page_model_carry_no_planning() {
        let profile = test_profile().to_string().to_lowercase();
        let snapshot = serde_json::to_string(&build_control_surface_snapshot())
            .expect("the snapshot serializes")
            .to_lowercase();
        for (what, text) in [("profile", &profile), ("page model", &snapshot)] {
            for word in [
                "projects",
                "tasks",
                "project",
                "task_",
                "sort_mode",
                "planning",
                "/api/deck/action\"",
                "switchtodeckmode",
                "deckmode",
                "<< proj",
            ] {
                assert!(!text.contains(word), "the {what} still says {word:?}");
            }
        }
    }

    // generic-http stores an answer only into a custom variable the profile
    // ships (the lesson of 2026-09-01), so every LCD the deck shows or asks
    // for must have one; every LCD it shows must be refreshed by something
    // (the poll, a key or a follow trigger); and every key it asks the bridge
    // for must be one the bridge answers. At `e8d43c5` the `AUDIO >>` key
    // asked for four keys the audio surface had retired (refused, with no
    // variable to land in); taking PROJECTS away took the only refresh of
    // `scene_nav` with it, until the lighting follow trigger took it over.
    #[test]
    fn every_lcd_the_deck_shows_is_shipped_refreshed_and_answered() {
        let profile = test_profile();
        let mut keys = LcdKeys::default();
        collect_lcd_keys(&profile, &mut keys);
        let variables = profile["custom_variables"]
            .as_object()
            .expect("custom variables")
            .keys()
            .map(|name| {
                name.strip_prefix("lcd_")
                    .unwrap_or_else(|| panic!("a variable outside lcd_: {name}"))
                    .to_string()
            })
            .collect::<BTreeSet<_>>();

        assert_eq!(
            keys.requested, keys.stored,
            "each LCD request stores into its own key's variable"
        );
        assert_eq!(
            keys.read, variables,
            "the profile ships a variable for every LCD it shows, and none it does not"
        );
        assert_eq!(
            keys.requested, variables,
            "every LCD the profile shows is refreshed by something, and it asks for no other"
        );

        let _preview_guard = crate::lighting::shared_preview_test_guard();
        let test_dir = crate::control_surface::test_support::ready_audio_test_db("profile-lcds");
        for key in &keys.requested {
            if let Err(error) =
                crate::control_surface::read_control_surface_lcd_text(&test_dir.db_path(), key)
            {
                panic!(
                    "the profile asks for LCD {key:?}, which the bridge refuses: {}",
                    error.message()
                );
            }
        }
    }

    // D5: LIGHTS (page 1) and AUDIO (page 2), chained by the page keys and by
    // the deck following the app. LIGHTS' `AUDIO >>` is the one page key: the
    // AUDIO page's sixteen places all hold audio controls, so the deck goes
    // back to LIGHTS by following the app. Setup has no deck page, so nothing
    // follows it and the deck stays where it is.
    #[test]
    fn the_page_keys_and_follow_triggers_chain_lights_and_audio() {
        let profile = test_profile();
        let pages = profile["pages"].as_object().expect("pages");
        let page_names = pages
            .iter()
            .map(|(number, page)| {
                (
                    number.parse::<i64>().expect("page numbers"),
                    page["name"].as_str().expect("page names").to_string(),
                )
            })
            .collect::<Vec<_>>();
        assert_eq!(
            page_names,
            vec![(1, String::from("LIGHTS")), (2, String::from("AUDIO"))]
        );

        let mut all_jumps = Vec::new();
        page_jumps(&profile, &mut all_jumps);
        assert!(
            all_jumps.iter().all(|page| (1..=2).contains(page)),
            "every jump lands on a page the profile has: {all_jumps:?}"
        );

        let mut lights_jumps = Vec::new();
        page_jumps(&pages["1"], &mut lights_jumps);
        assert_eq!(lights_jumps, vec![2], "LIGHTS' page key goes to AUDIO");
        let mut audio_jumps = Vec::new();
        page_jumps(&pages["2"], &mut audio_jumps);
        assert!(audio_jumps.is_empty(), "{audio_jumps:?}");
        assert!(
            pages["1"]["controls"]["0"].get("0").is_none(),
            "`<< PROJ` left LIGHTS' first place empty"
        );

        let triggers = profile["triggers"].as_object().expect("triggers");
        let mut follows = triggers
            .values()
            .filter(|trigger| trigger["events"][0]["type"] == "condition_true")
            .map(|trigger| {
                let mut jumps = Vec::new();
                page_jumps(&trigger["actions"], &mut jumps);
                (
                    trigger["condition"][0]["options"]["value"]
                        .as_str()
                        .expect("a follow trigger tests the saved page")
                        .to_string(),
                    jumps,
                )
            })
            .collect::<Vec<_>>();
        follows.sort();
        assert_eq!(
            follows,
            vec![
                (String::from("audio"), vec![2]),
                (String::from("lighting"), vec![1]),
            ]
        );

        let mut lighting_keys = LcdKeys::default();
        collect_lcd_keys(
            &triggers["sse-trigger-follow-lighting"]["actions"],
            &mut lighting_keys,
        );
        assert_eq!(
            lighting_keys.requested,
            LIGHT_LCD_KEYS
                .iter()
                .map(|key| key.to_string())
                .collect::<BTreeSet<_>>(),
            "arriving on LIGHTS refreshes its LCDs, as the PROJECTS page's `LIGHTS >>` did"
        );
    }
}
