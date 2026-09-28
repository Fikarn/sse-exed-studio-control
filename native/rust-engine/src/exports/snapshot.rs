//! The page model: what `controlSurface.snapshot` says of the deck's pages,
//! which Setup draws. It is read off the same controls the profile is made of.

use super::controls::ControlDef;
use super::pages::{deck_page_number, DECK_PAGES};
use serde::Serialize;
use serde_json::Value;

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

pub fn build_control_surface_snapshot() -> ControlSurfaceSnapshot {
    ControlSurfaceSnapshot {
        pages: DECK_PAGES
            .iter()
            .map(|page| control_surface_page(page.id, page.label, (page.controls)()))
            .collect(),
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
            // A cell of the touch strip that only shows: it sends nothing and
            // turns no page. (AUDIO's cells are tapped, and are buttons.)
            let control_type = if control.down.is_empty() {
                "display"
            } else {
                "button"
            };
            buttons.push(control_surface_control(
                format!("{prefix}-btn-{position}"),
                String::from(control_type),
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
        let value = primary_payload_value(actions).unwrap_or_default();
        let dial = value.split(':').next().unwrap_or_default().to_string();
        return match (action.as_str(), direction) {
            // The PROMPTER page's dials.
            ("speed", "left") => String::from("Speed Down"),
            ("speed", _) => String::from("Speed Up"),
            ("line", "left") => String::from("Line Back"),
            ("line", _) => String::from("Line On"),
            ("size", "left") => String::from("Size Down"),
            ("size", _) => String::from("Size Up"),
            ("paragraph", "left") => String::from("Prev Paragraph"),
            ("paragraph", _) => String::from("Next Paragraph"),
            // The CAMERAS page's: what a dial sets is the bank's to say.
            ("dial", "left") => format!("Dial {dial} Down"),
            ("dial", _) => format!("Dial {dial} Up"),
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

/// What a dial of the CAMERAS page sets, whatever the bank: exposure,
/// colour, focus (D14).
fn camera_dial_sets(dial: &str) -> &'static str {
    match dial {
        "1" => "ISO, white balance or focus",
        "2" => "shutter or tint",
        "3" => "iris",
        _ => "ND",
    }
}

fn control_description(actions: &[Value], fallback_label: &str, interaction: &str) -> String {
    let Some(action) = primary_payload_action(actions) else {
        if let Some(page_target) = extract_page_nav_target(actions) {
            return format!("Navigate to the {page_target} page.");
        }
        // A control that sends nothing: a strip cell that only shows, or a
        // dial whose push is not used.
        if actions.is_empty() {
            return match interaction {
                "button" => format!("Shows {}.", fallback_label.to_lowercase()),
                "press" => format!("A push of {fallback_label} does nothing."),
                _ => format!("{interaction} {fallback_label}."),
            };
        }
        return format!("{interaction} {fallback_label}.");
    };

    let value = primary_payload_value(actions);
    let way = value.as_deref().unwrap_or_default();
    let (dial, turn) = way.split_once(':').unwrap_or((way, ""));
    match (action.as_str(), way) {
        // The PROMPTER page (`docs/design/teleprompter.md` §9).
        ("playPause", _) => return String::from("Play or pause the prompter."),
        ("back", _) => return String::from("Go back to the start of the paragraph."),
        ("top", _) => return String::from("Go to the top, and pause."),
        ("cue", "previous") => return String::from("Go to the cue before the reading line."),
        ("cue", _) => return String::from("Go to the cue after the reading line."),
        ("speed", "down") => return String::from("Slow the prompter by 5 words a minute."),
        ("speed", _) => return String::from("Speed the prompter up by 5 words a minute."),
        ("line", "previous") => return String::from("Move the text back by a line."),
        ("line", _) => return String::from("Move the text on by a line."),
        ("paragraph", "previous") => return String::from("Go to the paragraph before."),
        ("paragraph", _) => return String::from("Go to the next paragraph."),
        ("size", "down") => return String::from("Make the text 4 px smaller."),
        ("size", "up") => return String::from("Make the text 4 px larger."),
        ("size", _) => return String::from("Return the text to its standard size."),
        // The CAMERAS page (D14).
        ("select", camera) => {
            return format!("Select CAM {camera}: the dials, the plate and the big picture follow.")
        }
        ("bank", _) => return String::from("Put the dials on exposure, colour or focus, in turn."),
        ("dial", _) => {
            return format!(
                "Step {} {} on the selected camera, as the bank says.",
                camera_dial_sets(dial),
                if turn == "down" { "down" } else { "up" }
            )
        }
        ("dialPush", "1") => return String::from("Autofocus once, while the dials are on focus."),
        ("dialPush", _) => return format!("A push of dial {dial} does nothing."),
        ("rec", _) => {
            return String::from(
                "Start recording on CAM 1. While it records: arm the stop, then stop.",
            )
        }
        _ => {}
    }
    match action.as_str() {
        "toggleLight" => String::from("Toggle the selected light."),
        "allOn" => String::from("Turn all lights on."),
        "allOff" => String::from("Turn all lights off."),
        "saveScene" => String::from("Save the current lighting scene."),
        "recallScene" => String::from("Recall the selected lighting scene."),
        "deleteScene" => String::from("Delete the selected lighting scene."),
        "selectPrevLight" => String::from("Select the previous light."),
        "selectNextLight" => String::from("Select the next light."),
        "selectPrevScene" => String::from("Select the previous scene."),
        "selectNextScene" => String::from("Select the next scene."),
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
        // The outputs by the names the Audio page gives them.
        "setMixTarget" => format!(
            "Make {} the active mix target.",
            match value.as_deref() {
                Some("main") => String::from("Main Out"),
                Some("phones-a") => String::from("Phones 1"),
                Some("phones-b") => String::from("Phones 2"),
                Some(other) => format_payload_value(other),
                None => String::from("the selected output"),
            }
        ),
        "cycleBank" => String::from("Cycle the dial bank: inputs, playback, outputs."),
        "toggleDialMode" => String::from("Toggle the input dials between fader and gain."),
        "dimToggle" => String::from("Toggle control-room dim on the main out."),
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
