use crate::bootstrap::RuntimeContext;
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

const AUDIO_LCD_KEYS: &[&str] = &[
    "audio_strip_1",
    "audio_strip_2",
    "audio_strip_3",
    "audio_strip_4",
    "audio_key_1",
    "audio_key_2",
    "audio_key_3",
    "audio_key_4",
    "audio_key_5",
    "audio_key_6",
    "audio_key_7",
    "audio_key_8",
    "workspace",
];

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
    let config = generate_companion_config(base_url, deck_surface_id.as_deref());
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
        pages: vec![
            control_surface_page("projects", "PROJECTS", "proj", project_controls()),
            control_surface_page("tasks", "TASKS", "tasks", task_controls()),
            control_surface_page("lights", "LIGHTS", "lights", light_controls()),
            control_surface_page("audio", "AUDIO", "audio", audio_controls()),
        ],
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

fn generate_companion_config(base_url: &str, deck_surface_id: Option<&str>) -> Value {
    let mut pages = Map::new();
    pages.insert(
        String::from("1"),
        build_page("sse-page-projects", "PROJECTS", project_controls()),
    );
    pages.insert(
        String::from("2"),
        build_page("sse-page-tasks", "TASKS", task_controls()),
    );
    pages.insert(
        String::from("3"),
        build_page("sse-page-lights", "LIGHTS", light_controls()),
    );
    pages.insert(
        String::from("4"),
        build_page("sse-page-audio", "AUDIO", audio_controls()),
    );

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

// generic-http's jsonResultDataVariable stores into a pre-existing CUSTOM
// variable (referenced as $(custom:name)); a missing variable makes the store a
// silent no-op, so the profile must ship every LCD variable it polls into.
fn generate_companion_custom_variables() -> Value {
    let mut variables = Map::new();
    for (sort_order, key) in AUDIO_LCD_KEYS.iter().enumerate() {
        variables.insert(
            format!("lcd_{key}"),
            json!({
                "description": "SSE deck LCD text (engine-owned, polled from the bridge)",
                "defaultValue": "",
                "persistCurrentValue": false,
                "sortOrder": sort_order
            }),
        );
    }
    Value::Object(variables)
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

    for (slug, workspace, page, sort_order) in [
        ("audio", "audio", 4, 1),
        ("lighting", "lighting", 3, 2),
        ("planning", "planning", 1, 3),
    ] {
        triggers.insert(
            format!("sse-trigger-follow-{slug}"),
            json!({
                "type": "trigger",
                "options": {
                    "name": format!("SSE follow app - {slug}"),
                    "enabled": true,
                    "sortOrder": sort_order
                },
                "actions": [
                    {
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
                    }
                ],
                "condition": [
                    {
                        "id": format!("sse-cond-follow-{slug}"),
                        "definitionId": "variable_value",
                        "connectionId": "internal",
                        "options": {
                            "variable": "custom:lcd_workspace",
                            "op": "eq",
                            "value": workspace
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
struct ControlDef {
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
}

fn control_surface_page(
    page_id: &str,
    label: &str,
    prefix: &str,
    controls: Vec<ControlDef>,
) -> ControlSurfacePage {
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
        return match page {
            1 => Some("PROJECTS"),
            2 => Some("TASKS"),
            3 => Some("LIGHTS"),
            4 => Some("AUDIO"),
            _ => None,
        };
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
            ("selectPrevProject", _) => String::from("Prev Project"),
            ("selectNextProject", _) => String::from("Next Project"),
            ("selectPrevTask", _) => String::from("Prev Task"),
            ("selectNextTask", _) => String::from("Next Task"),
            ("prevStatus", _) => String::from("Prev Status"),
            ("nextStatus", _) => String::from("Next Status"),
            ("prevPriority", _) => String::from("Prev Priority"),
            ("nextPriority", _) => String::from("Next Priority"),
            ("prevSort", _) => String::from("Prev Sort"),
            ("nextSort", _) => String::from("Next Sort"),
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
        "setFilter" => format!(
            "Set view filter to {}.",
            value
                .as_deref()
                .map(format_filter_value)
                .unwrap_or_else(|| String::from("the selected column"))
        ),
        "createProject" => String::from("Create a new project."),
        "openDetail" => String::from("Open the current project or task detail."),
        "selectPrevProject" => String::from("Select the previous project."),
        "selectNextProject" => String::from("Select the next project."),
        "setStatus" => format!(
            "Set status to {}.",
            value
                .as_deref()
                .map(format_filter_value)
                .unwrap_or_else(|| String::from("the selected value"))
        ),
        "prevStatus" => String::from("Cycle status backward."),
        "nextStatus" => String::from("Cycle status forward."),
        "prevPriority" => String::from("Cycle priority backward."),
        "nextPriority" => String::from("Cycle priority forward."),
        "resetSort" => String::from("Reset sort order to manual."),
        "prevSort" => String::from("Cycle sort order backward."),
        "nextSort" => String::from("Cycle sort order forward."),
        "toggleTimer" => String::from("Start or stop the selected task timer."),
        "toggleTaskComplete" => String::from("Toggle completion on the selected task."),
        "selectPrevTask" => String::from("Select the previous task."),
        "selectNextTask" => String::from("Select the next task."),
        "switchToDeckMode" => format!(
            "Switch deck mode to {}.",
            value
                .as_deref()
                .map(format_filter_value)
                .unwrap_or_else(|| String::from("the selected workspace"))
        ),
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
                .map(format_filter_value)
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

fn format_filter_value(value: &str) -> String {
    value.replace('-', " ")
}

fn build_page(page_id: &str, name: &str, controls: Vec<ControlDef>) -> Value {
    let mut rows = Map::new();
    for control in controls {
        let style = if let Some(expression) = control.text_expression {
            json!({
                "text": expression,
                "textExpression": true,
                "size": "auto",
                "png64": Value::Null,
                "alignment": "center:center",
                "pngalignment": "center:center",
                "color": 16777215,
                "bgcolor": 0,
                "show_topbar": "default"
            })
        } else {
            json!({
                "text": control.label.replace(' ', "\\n"),
                "textExpression": false,
                "size": "auto",
                "png64": Value::Null,
                "alignment": "center:center",
                "pngalignment": "center:center",
                "color": 16777215,
                "bgcolor": 0,
                "show_topbar": "default"
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
            "feedbacks": [],
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

fn project_controls() -> Vec<ControlDef> {
    vec![
        button(
            "0",
            "0",
            "All",
            http_post(
                "/api/deck/action",
                json!({"action":"setFilter","value":"all"}),
            ),
        ),
        button(
            "0",
            "1",
            "To Do",
            http_post(
                "/api/deck/action",
                json!({"action":"setFilter","value":"todo"}),
            ),
        ),
        button(
            "0",
            "2",
            "In Prog",
            http_post(
                "/api/deck/action",
                json!({"action":"setFilter","value":"in-progress"}),
            ),
        ),
        button(
            "0",
            "3",
            "TASKS >>",
            page_jump(2)
                .into_iter()
                .chain(lcd_refreshes(&[
                    "project_nav",
                    "task_nav",
                    "project_status",
                    "project_priority",
                ]))
                .collect(),
        ),
        button(
            "1",
            "0",
            "Blocked",
            http_post(
                "/api/deck/action",
                json!({"action":"setFilter","value":"blocked"}),
            ),
        ),
        button(
            "1",
            "1",
            "Done",
            http_post(
                "/api/deck/action",
                json!({"action":"setFilter","value":"done"}),
            ),
        ),
        button(
            "1",
            "2",
            "New Proj",
            http_post("/api/deck/action", json!({"action":"createProject"})),
        ),
        button(
            "1",
            "3",
            "LIGHTS >>",
            page_jump(3)
                .into_iter()
                .chain(http_post(
                    "/api/deck/light-action",
                    json!({"action":"switchToDeckMode","value":"light"}),
                ))
                .chain(lcd_refreshes(&[
                    "light_nav",
                    "light_intensity",
                    "light_cct",
                    "scene_nav",
                ]))
                .collect(),
        ),
        dial(
            "3",
            "0",
            "Project",
            Some("$(custom:lcd_project_nav)"),
            http_post("/api/deck/action", json!({"action":"openDetail"}))
                .into_iter()
                .chain(lcd_refreshes(&[
                    "project_nav",
                    "project_status",
                    "project_priority",
                    "task_nav",
                    "sort_mode",
                ]))
                .collect(),
            http_post("/api/deck/action", json!({"action":"selectPrevProject"})),
            http_post("/api/deck/action", json!({"action":"selectNextProject"})),
        ),
        dial(
            "3",
            "1",
            "Status",
            Some("$(custom:lcd_project_status)"),
            http_post(
                "/api/deck/action",
                json!({"action":"setStatus","value":"in-progress"}),
            ),
            http_post("/api/deck/action", json!({"action":"prevStatus"})),
            http_post("/api/deck/action", json!({"action":"nextStatus"})),
        ),
        dial(
            "3",
            "2",
            "Priority",
            Some("$(custom:lcd_project_priority)"),
            Vec::new(),
            http_post("/api/deck/action", json!({"action":"prevPriority"})),
            http_post("/api/deck/action", json!({"action":"nextPriority"})),
        ),
        dial(
            "3",
            "3",
            "Sort",
            Some("$(custom:lcd_sort_mode)"),
            http_post("/api/deck/action", json!({"action":"resetSort"})),
            http_post("/api/deck/action", json!({"action":"prevSort"})),
            http_post("/api/deck/action", json!({"action":"nextSort"})),
        ),
    ]
}

fn task_controls() -> Vec<ControlDef> {
    vec![
        button("0", "0", "<< PROJ", page_jump(1)),
        button(
            "0",
            "1",
            "Timer",
            http_post("/api/deck/action", json!({"action":"toggleTimer"})),
        ),
        button(
            "0",
            "2",
            "Complete",
            http_post("/api/deck/action", json!({"action":"toggleTaskComplete"})),
        ),
        button(
            "0",
            "3",
            "In Prog",
            http_post(
                "/api/deck/action",
                json!({"action":"setStatus","value":"in-progress"}),
            ),
        ),
        button(
            "1",
            "0",
            "To Do",
            http_post(
                "/api/deck/action",
                json!({"action":"setStatus","value":"todo"}),
            ),
        ),
        button(
            "1",
            "1",
            "Blocked",
            http_post(
                "/api/deck/action",
                json!({"action":"setStatus","value":"blocked"}),
            ),
        ),
        button(
            "1",
            "2",
            "Done",
            http_post(
                "/api/deck/action",
                json!({"action":"setStatus","value":"done"}),
            ),
        ),
        button(
            "1",
            "3",
            "New Proj",
            http_post("/api/deck/action", json!({"action":"createProject"})),
        ),
        dial(
            "3",
            "0",
            "Project",
            Some("$(custom:lcd_project_nav)"),
            http_post("/api/deck/action", json!({"action":"openDetail"}))
                .into_iter()
                .chain(lcd_refreshes(&[
                    "project_nav",
                    "project_status",
                    "project_priority",
                    "task_nav",
                ]))
                .collect(),
            http_post("/api/deck/action", json!({"action":"selectPrevProject"})),
            http_post("/api/deck/action", json!({"action":"selectNextProject"})),
        ),
        dial(
            "3",
            "1",
            "Task",
            Some("$(custom:lcd_task_nav)"),
            http_post("/api/deck/action", json!({"action":"toggleTimer"})),
            http_post("/api/deck/action", json!({"action":"selectPrevTask"})),
            http_post("/api/deck/action", json!({"action":"selectNextTask"})),
        ),
        dial(
            "3",
            "2",
            "Status",
            Some("$(custom:lcd_project_status)"),
            http_post(
                "/api/deck/action",
                json!({"action":"setStatus","value":"in-progress"}),
            ),
            http_post("/api/deck/action", json!({"action":"prevStatus"})),
            http_post("/api/deck/action", json!({"action":"nextStatus"})),
        ),
        dial(
            "3",
            "3",
            "Priority",
            Some("$(custom:lcd_project_priority)"),
            http_post("/api/deck/action", json!({"action":"toggleTaskComplete"})),
            http_post("/api/deck/action", json!({"action":"prevPriority"})),
            http_post("/api/deck/action", json!({"action":"nextPriority"})),
        ),
    ]
}

fn light_controls() -> Vec<ControlDef> {
    vec![
        button(
            "0",
            "0",
            "<< PROJ",
            page_jump(1)
                .into_iter()
                .chain(http_post(
                    "/api/deck/light-action",
                    json!({"action":"switchToDeckMode","value":"project"}),
                ))
                .chain(lcd_refreshes(&[
                    "project_nav",
                    "project_status",
                    "project_priority",
                    "sort_mode",
                ]))
                .collect(),
        ),
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
        button(
            "1",
            "3",
            "AUDIO >>",
            page_jump(4)
                .into_iter()
                .chain(http_post(
                    "/api/deck/audio-action",
                    json!({"action":"switchToDeckMode","value":"audio"}),
                ))
                .chain(lcd_refreshes(&[
                    "audio_ch_nav",
                    "audio_gain1",
                    "audio_gain2",
                    "audio_gain3",
                ]))
                .collect(),
        ),
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

const AUDIO_STRIP_LCD_KEYS: &[&str] = &[
    "audio_strip_1",
    "audio_strip_2",
    "audio_strip_3",
    "audio_strip_4",
];

fn audio_action_with_refreshes(body: Value, refresh_keys: &[&str]) -> Vec<Value> {
    http_post("/api/deck/audio-action", body)
        .into_iter()
        .chain(lcd_refreshes(refresh_keys))
        .collect()
}

fn audio_controls() -> Vec<ControlDef> {
    let mut controls = vec![
        expression_button(
            "0",
            "0",
            "-> MAIN",
            "$(custom:lcd_audio_key_1)",
            audio_action_with_refreshes(
                json!({"action":"setMixTarget","value":"main"}),
                &[
                    "audio_key_1",
                    "audio_key_2",
                    "audio_key_3",
                    "audio_strip_1",
                    "audio_strip_2",
                    "audio_strip_3",
                    "audio_strip_4",
                ],
            ),
        ),
        expression_button(
            "0",
            "1",
            "-> PH 1",
            "$(custom:lcd_audio_key_2)",
            audio_action_with_refreshes(
                json!({"action":"setMixTarget","value":"phones-a"}),
                &[
                    "audio_key_1",
                    "audio_key_2",
                    "audio_key_3",
                    "audio_strip_1",
                    "audio_strip_2",
                    "audio_strip_3",
                    "audio_strip_4",
                ],
            ),
        ),
        expression_button(
            "0",
            "2",
            "-> PH 2",
            "$(custom:lcd_audio_key_3)",
            audio_action_with_refreshes(
                json!({"action":"setMixTarget","value":"phones-b"}),
                &[
                    "audio_key_1",
                    "audio_key_2",
                    "audio_key_3",
                    "audio_strip_1",
                    "audio_strip_2",
                    "audio_strip_3",
                    "audio_strip_4",
                ],
            ),
        ),
        expression_button(
            "0",
            "3",
            "BANK",
            "$(custom:lcd_audio_key_4)",
            audio_action_with_refreshes(
                json!({"action":"cycleBank"}),
                &[
                    "audio_key_4",
                    "audio_key_6",
                    "audio_strip_1",
                    "audio_strip_2",
                    "audio_strip_3",
                    "audio_strip_4",
                ],
            ),
        ),
        expression_button(
            "1",
            "0",
            "DIM",
            "$(custom:lcd_audio_key_5)",
            audio_action_with_refreshes(json!({"action":"dimToggle"}), &["audio_key_5"]),
        ),
        expression_button(
            "1",
            "1",
            "GAIN",
            "$(custom:lcd_audio_key_6)",
            audio_action_with_refreshes(
                json!({"action":"toggleDialMode"}),
                &[
                    "audio_key_6",
                    "audio_strip_1",
                    "audio_strip_2",
                    "audio_strip_3",
                    "audio_strip_4",
                ],
            ),
        ),
        momentary_button(
            "1",
            "2",
            "TALK",
            "$(custom:lcd_audio_key_7)",
            http_post("/api/deck/audio-action", json!({"action":"talkOn"})),
            audio_action_with_refreshes(json!({"action":"talkOff"}), &["audio_key_7"]),
        ),
        expression_button(
            "1",
            "3",
            "SOLO CLR",
            "$(custom:lcd_audio_key_8)",
            audio_action_with_refreshes(
                json!({"action":"soloClearAll"}),
                &[
                    "audio_key_8",
                    "audio_strip_1",
                    "audio_strip_2",
                    "audio_strip_3",
                    "audio_strip_4",
                ],
            ),
        ),
    ];

    for strip in 1..=4_usize {
        type StripDef = (
            &'static str,
            &'static str,
            &'static str,
            &'static str,
            &'static str,
        );
        let (col, strip_label, dial_label, strip_text, strip_key): StripDef = match strip {
            1 => (
                "0",
                "Strip 1",
                "Dial 1",
                "$(custom:lcd_audio_strip_1)",
                "audio_strip_1",
            ),
            2 => (
                "1",
                "Strip 2",
                "Dial 2",
                "$(custom:lcd_audio_strip_2)",
                "audio_strip_2",
            ),
            3 => (
                "2",
                "Strip 3",
                "Dial 3",
                "$(custom:lcd_audio_strip_3)",
                "audio_strip_3",
            ),
            _ => (
                "3",
                "Strip 4",
                "Dial 4",
                "$(custom:lcd_audio_strip_4)",
                "audio_strip_4",
            ),
        };
        let tap_body = json!({"action":"stripTap","value": strip.to_string()});
        let mut tap_refreshes = Vec::from(AUDIO_STRIP_LCD_KEYS);
        tap_refreshes.retain(|key| *key != strip_key);
        let mut tap_keys: Vec<&str> = vec![strip_key];
        tap_keys.extend(tap_refreshes);
        controls.push(expression_button(
            "2",
            col,
            strip_label,
            strip_text,
            audio_action_with_refreshes(tap_body, &tap_keys),
        ));

        let turn_down = json!({"action":"dialTurn","value": format!("{strip}:down")});
        let turn_up = json!({"action":"dialTurn","value": format!("{strip}:up")});
        let press = json!({"action":"dialPress","value": strip.to_string()});
        controls.push(dial(
            "3",
            col,
            dial_label,
            None,
            audio_action_with_refreshes(press, &[strip_key]),
            audio_action_with_refreshes(turn_down, &[strip_key]),
            audio_action_with_refreshes(turn_up, &[strip_key]),
        ));
    }

    controls
}

fn button(
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
    }
}

fn expression_button(
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

fn momentary_button(
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

fn dial(
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

fn http_post(path: &'static str, body: Value) -> Vec<Value> {
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

fn lcd_refreshes(keys: &[&str]) -> Vec<Value> {
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

fn next_action_id() -> String {
    use std::sync::atomic::{AtomicUsize, Ordering};

    static ACTION_COUNTER: AtomicUsize = AtomicUsize::new(1);
    let next = ACTION_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("act-{next}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn companion_export_contains_native_bridge_instance() {
        let config = generate_companion_config("http://127.0.0.1:38201", None);
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
        let config = generate_companion_config("http://localhost:3000", None);
        let prefix = config["instances"][INSTANCE_ID]["config"]["prefix"]
            .as_str()
            .expect("prefix should be a string");
        assert_eq!(prefix, "http://localhost:3000");
    }

    #[test]
    fn companion_export_is_a_native_v9_full_config() {
        let config = generate_companion_config("http://127.0.0.1:38201", None);
        assert_eq!(config["version"], COMPANION_EXPORT_FORMAT_VERSION);
        assert_eq!(config["type"], "full");
        assert_eq!(
            config["pages"].as_object().map(|pages| pages.len()),
            Some(4)
        );
        assert!(config["pages"]["4"]["id"].is_string());
        assert!(config.get("surfaces").is_none());

        let custom_variables = config["custom_variables"]
            .as_object()
            .expect("custom variables should exist");
        assert_eq!(custom_variables.len(), AUDIO_LCD_KEYS.len());
        assert!(
            custom_variables.contains_key("lcd_workspace"),
            "the polled LCD variables must ship with the profile - generic-http stores are silent no-ops without them"
        );

        let sample_action =
            &config["pages"]["1"]["controls"]["0"]["0"]["steps"]["0"]["action_sets"]["down"][0];
        assert_eq!(sample_action["connectionId"], INSTANCE_ID);
        assert_eq!(sample_action["definitionId"], "post");
    }

    #[test]
    fn companion_export_audio_page_maps_the_deck_hardware() {
        let config = generate_companion_config("http://127.0.0.1:38201", None);
        let controls = config["pages"]["4"]["controls"]
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
    fn companion_export_triggers_poll_and_follow_the_app() {
        let config =
            generate_companion_config("http://127.0.0.1:38201", Some("streamdeck:TESTSERIAL"));
        let triggers = config["triggers"]
            .as_object()
            .expect("triggers should exist");
        assert_eq!(triggers.len(), 4);

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
        assert_eq!(follow["actions"][0]["options"]["page"], 4);

        let fallback = generate_companion_config("http://127.0.0.1:38201", None);
        assert_eq!(
            fallback["triggers"]["sse-trigger-follow-audio"]["actions"][0]["options"]["controller"],
            "self"
        );
    }

    #[test]
    fn control_surface_snapshot_matches_the_deck_page_model() {
        let snapshot = build_control_surface_snapshot();
        assert_eq!(snapshot.pages.len(), 4);
        assert_eq!(snapshot.pages[0].label, "PROJECTS");
        assert_eq!(snapshot.pages[0].buttons.len(), 8);
        assert_eq!(snapshot.pages[0].dials.len(), 12);
        assert_eq!(snapshot.pages[0].buttons[0].id, "proj-btn-1");
        assert_eq!(snapshot.pages[0].buttons[0].position, 1);
        assert_eq!(
            snapshot.pages[0].buttons[0].url.as_deref(),
            Some("/api/deck/action")
        );
        assert_eq!(
            snapshot.pages[0].buttons[3].page_nav_target.as_deref(),
            Some("TASKS")
        );
        assert_eq!(snapshot.pages[0].buttons[3].method, None);
        assert_eq!(
            snapshot.pages[0].buttons[3]
                .lcd_refresh_keys
                .as_ref()
                .map(Vec::len),
            Some(4)
        );
        assert_eq!(
            snapshot.pages[0].buttons[7].page_nav_target.as_deref(),
            Some("LIGHTS")
        );
        assert_eq!(snapshot.pages[0].buttons[7].method.as_deref(), Some("POST"));
        assert_eq!(snapshot.pages[0].dials[0].id, "proj-dial-1-press");
        assert_eq!(
            snapshot.pages[0].dials[0].lcd_key.as_deref(),
            Some("project_nav")
        );

        let audio = &snapshot.pages[3];
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
}
