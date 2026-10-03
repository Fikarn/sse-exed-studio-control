//! The page model: what `controlSurface.snapshot` says of the deck's pages,
//! which Setup draws. It is read off the same controls the profile is made of
//! (`model.rs`), never off the profile's JSON.

use super::model::{Control, Place, Step};
use super::pages::DECK_PAGES;
use serde::Serialize;
use serde_json::{json, Value};

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
}

pub fn build_control_surface_snapshot() -> ControlSurfaceSnapshot {
    ControlSurfaceSnapshot {
        pages: DECK_PAGES
            .iter()
            .map(|page| control_surface_page(page.id, page.label, (page.controls)()))
            .collect(),
    }
}

fn control_surface_page(page_id: &str, label: &str, controls: Vec<Control>) -> ControlSurfacePage {
    let mut buttons = Vec::new();
    let mut dials = Vec::new();

    for control in controls {
        match control.place {
            Place::Dial(col) => {
                let position = i64::from(col) + 1;
                for (kind, way, step) in [
                    ("dial-press", "press", control.press.as_ref()),
                    ("dial-turn-left", "left", control.left.as_ref()),
                    ("dial-turn-right", "right", control.right.as_ref()),
                ] {
                    let name = match way {
                        "press" => String::from(control.label),
                        _ => dial_rotation_label(step, way),
                    };
                    dials.push(control_surface_control(
                        format!("{page_id}-dial-{position}-{way}"),
                        kind,
                        position,
                        name,
                        describe(step, control.label, way),
                        step,
                    ));
                }
            }
            Place::Key { .. } | Place::Cell(_) => {
                // A dark key is no control: it does nothing and shows nothing.
                if control.label.is_empty() {
                    continue;
                }
                let position =
                    i64::from(control.place.row()) * 4 + i64::from(control.place.col()) + 1;
                // A cell of the touch strip only shows: a tap does nothing
                // (2026-10-03: the AUDIO page's cells were tapped until then).
                let (kind, description) = match (&control.press, control.shows) {
                    (Some(step), _) => ("button", describe(Some(step), control.label, "button")),
                    (None, Some(shows)) => ("display", format!("Shows {shows}.")),
                    (None, None) => ("display", format!("Shows {}.", control.label)),
                };
                buttons.push(control_surface_control(
                    format!("{page_id}-btn-{position}"),
                    kind,
                    position,
                    String::from(control.label),
                    description,
                    control.press.as_ref(),
                ));
            }
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
    control_type: &str,
    position: i64,
    label: String,
    description: String,
    step: Option<&Step>,
) -> ControlSurfaceControl {
    let page_nav_target = match step {
        Some(Step::Jump(page_id)) => DECK_PAGES
            .iter()
            .find(|page| page.id == *page_id)
            .map(|page| String::from(page.label)),
        _ => None,
    };
    let request = match step {
        Some(Step::Post {
            route,
            action,
            value,
        }) => Some((String::from(*route), body_of(action, *value))),
        _ => None,
    };
    ControlSurfaceControl {
        id,
        control_type: String::from(control_type),
        position,
        label,
        description,
        is_page_nav: page_nav_target.as_ref().map(|_| true),
        page_nav_target,
        method: request.as_ref().map(|_| String::from("POST")),
        url: request.as_ref().map(|(url, _)| url.clone()),
        body: request.map(|(_, body)| body),
    }
}

fn body_of(action: &str, value: Option<&str>) -> Value {
    match value {
        Some(value) => json!({ "action": action, "value": value }),
        None => json!({ "action": action }),
    }
}

fn dial_rotation_label(step: Option<&Step>, direction: &str) -> String {
    let fallback = || {
        String::from(if direction == "left" {
            "Previous"
        } else {
            "Next"
        })
    };
    let Some(Step::Post { action, value, .. }) = step else {
        return fallback();
    };
    let dial = value
        .unwrap_or_default()
        .split(':')
        .next()
        .unwrap_or_default();
    match (*action, direction) {
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
        ("dialTurn", _) => String::from("Level Up"),
        _ => fallback(),
    }
}

/// What a CAMERAS dial sets, whatever the bank: exposure, colour, focus
/// (D14).
fn camera_dial_sets(dial: &str) -> &'static str {
    match dial {
        "1" => "ISO, white balance or focus",
        "2" => "shutter or tint",
        "3" => "iris",
        _ => "ND",
    }
}

/// What a control does, in the operator's words.
fn describe(step: Option<&Step>, label: &str, interaction: &str) -> String {
    let (action, value) = match step {
        None => {
            return match interaction {
                "press" => format!("A push of the {label} dial does nothing."),
                _ => format!("Shows {label}."),
            }
        }
        Some(Step::Jump(page_id)) => {
            let target = DECK_PAGES
                .iter()
                .find(|page| page.id == *page_id)
                .map_or("next", |page| page.label);
            return format!("Turn the deck to the {target} page.");
        }
        Some(Step::Post { action, value, .. }) => (*action, value.unwrap_or_default()),
    };
    let (dial, turn) = value.split_once(':').unwrap_or((value, ""));
    match (action, value) {
        // The PROMPTER page (`docs/design/teleprompter.md` §9).
        ("playPause", _) => String::from("Play or pause the prompter."),
        ("back", _) => String::from("Go back to the start of the paragraph."),
        ("top", _) => String::from("Go to the top, and pause."),
        ("cue", "previous") => String::from("Go to the cue before the reading line."),
        ("cue", _) => String::from("Go to the cue after the reading line."),
        ("speed", "down") => String::from("Slow the prompter by 5 words a minute."),
        ("speed", _) => String::from("Speed the prompter up by 5 words a minute."),
        ("line", "previous") => String::from("Move the text back by a line."),
        ("line", _) => String::from("Move the text on by a line."),
        ("paragraph", "previous") => String::from("Go to the paragraph before."),
        ("paragraph", _) => String::from("Go to the next paragraph."),
        ("size", "down") => String::from("Make the text 4 px smaller."),
        ("size", "up") => String::from("Make the text 4 px larger."),
        ("size", _) => String::from("Return the text to its standard size."),
        // The CAMERAS page (D14).
        ("select", camera) => {
            format!("Select CAM {camera}: the dials, the plate and the big picture follow.")
        }
        ("bank", _) => String::from("Put the dials on exposure, colour or focus, in turn."),
        ("dial", _) => format!(
            "Step {} {} on the selected camera, as the bank says.",
            camera_dial_sets(dial),
            if turn == "down" { "down" } else { "up" }
        ),
        ("dialPush", "1") => String::from("Autofocus once, while the dials are on focus."),
        ("dialPush", _) => format!("A push of dial {dial} does nothing."),
        ("rec", _) => {
            String::from("Start recording on CAM 1. While it records: arm the stop, then stop.")
        }
        // The LIGHTS page.
        ("toggleLight", _) => String::from("Toggle the selected light."),
        ("allOn", _) => String::from("Turn all lights on."),
        ("allOff", _) => String::from("Turn all lights off: press, and press again within 3 s."),
        ("saveScene", _) => String::from("Save the current lighting scene."),
        ("recallScene", _) => {
            String::from("Recall the selected lighting scene, with the Lighting page's Fade.")
        }
        ("selectPrevLight", _) => String::from("Select the previous light."),
        ("selectNextLight", _) => String::from("Select the next light."),
        ("selectPrevScene", _) => String::from("Select the previous scene."),
        ("selectNextScene", _) => String::from("Select the next scene."),
        ("resetIntensity", _) => String::from("Reset the selected light intensity."),
        ("intensityDown", _) => String::from("Lower the selected light intensity."),
        ("intensityUp", _) => String::from("Raise the selected light intensity."),
        ("resetCct", _) => String::from("Reset the selected light CCT."),
        ("cctDown", _) => String::from("Lower the selected light CCT."),
        ("cctUp", _) => String::from("Raise the selected light CCT."),
        // The AUDIO page; the outputs by the names the Audio page gives them.
        ("dialTurn", _) => format!("Ride the level on strip {dial}."),
        ("dialPress", strip) => format!("Toggle mute on strip {strip}."),
        ("setMixTarget", "main") => String::from("Make Main Out the active mix target."),
        ("setMixTarget", "phones") => {
            String::from("Make the next phones mix the active mix target: Phones 1, then Phones 2.")
        }
        ("setMixTarget", "phones-a") => String::from("Make Phones 1 the active mix target."),
        ("setMixTarget", "phones-b") => String::from("Make Phones 2 the active mix target."),
        ("cycleBank", _) => String::from("Cycle the dial bank: inputs, playback, outputs."),
        ("dimToggle", _) => String::from("Toggle control-room dim on Main Out."),
        ("soloClearAll", _) => String::from("Clear solo on every audio channel."),
        _ => format!("Send {action} for {label}."),
    }
}
