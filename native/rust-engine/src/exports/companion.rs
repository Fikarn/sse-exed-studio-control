//! The profile in Companion 5's own format (2026-10-03): a full export at
//! `version: 12`, as Companion 5.0.6 writes one, built from scratch. Until
//! then the profile was a version-9 file that Companion upgraded on import,
//! guessing each key's look from its own settings.
//!
//! - **Buttons** are layered (`button-layered`): a background, an image of
//!   the profile's image library that draws every fixed word (a picture a
//!   state, picked by the button's rules), and the live values in
//!   Companion's own type over it, with no top bar, no pressed border and no
//!   status icons. Every option of an action, a feedback or a layer is
//!   wrapped `{isExpression, value}`.
//! - **The displays** come in one read a second (`GET /api/deck/displays`)
//!   into one custom variable, `deck_raw`, whatever the answer. A trigger
//!   keeps it in `deck_displays` only when it is the bridge's own answer and
//!   no older than the one kept: generic-http stores an error's body too, and
//!   sends a refused read again up to twice, so an answer can arrive late.
//!   An expression variable a display reads its line out of the kept answer
//!   (`jsonpath`); a button redraws only when one of its own changes.
//! - **The link**: `deck_age` counts the seconds since the bridge's last
//!   answer. From `LINK_LOST_AFTER_SECONDS` on, every value is blank and every
//!   key grey (`deck_link`): what the deck showed is no longer known.
//! - **Presses** post to the page's route and read the displays again, two
//!   requests; the page keys turn the deck alone. The bridge's token is in
//!   every request's header, and nowhere else.
//! - **Triggers**: the poll, the answer, the age, and the deck following the
//!   app's page, which name the deck (`streamdeck:<serial>`): in a trigger,
//!   `self` names no surface.

use super::images::image_library;
use super::model::{Control, Element, ElementKind, Place, Prop, Step, DECK_CAP};
use super::pages::{deck_page_number, DeckPage, DECK_PAGES};
use crate::control_surface::{DisplayShape, DECK_DISPLAYS, DECK_DISPLAYS_MARK};
use serde_json::{json, Map, Value};
use std::collections::BTreeSet;

/// The format Companion 5.0.6 writes its own exports in; it upgrades a file
/// to its own (16) on import, and the steps from 12 change nothing a native
/// layered file holds.
pub(super) const COMPANION_EXPORT_FORMAT_VERSION: u64 = 12;
/// The Companion the profile was made for (the studio's).
const COMPANION_BUILD: &str = "5.0.6+9750-stable-1acd2318f5";
/// The bridge's connection, in the file (Companion gives it an id of its own
/// on import).
pub(super) const INSTANCE_ID: &str = "sse_bridge";
// Companion connection labels only allow letters, digits, underscore, and dash.
pub(super) const INSTANCE_LABEL: &str = "SSE_Studio_Control";
const GENERIC_HTTP_MODULE_VERSION: &str = "2.7.0";
/// generic-http 2.7.0 has two upgrade scripts: an action of the file is
/// upgraded by none of them.
const GENERIC_HTTP_UPGRADE_INDEX: u64 = 1;
/// The bridge's one read of every display.
pub(super) const DISPLAYS_PATH: &str = "/api/deck/displays";
/// Seconds without an answer of the bridge's after which the deck greys.
pub(super) const LINK_LOST_AFTER_SECONDS: u64 = 4;
/// What the deck counts up to: it is lost either way.
const AGE_CAP_SECONDS: u64 = 60;
/// An answer older than the kept one is dropped, unless it is older by this
/// much: the hardware link restarted, or the clock was set back.
const ANSWERS_CROSS_WITHIN_MS: u64 = 5_000;

/// The custom variables: the last answer as Companion got it, the last one
/// that was the bridge's own, and the seconds since.
pub(super) const RAW: &str = "deck_raw";
pub(super) const KEPT: &str = "deck_displays";
pub(super) const AGE: &str = "deck_age";

/// A fixed option or property.
fn fixed(value: impl Into<Value>) -> Value {
    json!({ "isExpression": false, "value": value.into() })
}

/// An option or property Companion evaluates.
fn expression(source: &str) -> Value {
    json!({ "isExpression": true, "value": source })
}

fn prop(value: &Prop) -> Value {
    match value {
        Prop::Fixed(value) => fixed(value.clone()),
        Prop::Expr(source) => expression(source),
    }
}

/// What every request to the bridge carries, and what the file is made for.
struct Writer<'a> {
    /// The generic-http `header` option: the bridge's token.
    header: String,
    /// The deck, for the triggers; `self` when it is not known.
    surface: &'a str,
}

/// The generic-http `header` option: a JSON object the module parses and
/// sends with every request. Carrying the bridge token here is what makes
/// the exported profile a client the bridge accepts (2026-09 production
/// readiness, Slice 2 — finding F01).
fn bridge_auth_header_option(bridge_token: &str) -> String {
    json!({ "Authorization": format!("Bearer {bridge_token}") }).to_string()
}

pub(super) fn generate_companion_config(
    base_url: &str,
    deck_surface_id: Option<&str>,
    bridge_token: &str,
) -> Value {
    let writer = Writer {
        header: bridge_auth_header_option(bridge_token),
        surface: deck_surface_id.unwrap_or("self"),
    };
    let mut pages = Map::new();
    for page in &DECK_PAGES {
        pages.insert(
            deck_page_number(page.id).to_string(),
            page_document(page, &writer),
        );
    }
    let pages = Value::Object(pages);
    let triggers = triggers(&writer);
    let expression_variables = expression_variables(&[&pages, &triggers]);

    json!({
        "version": COMPANION_EXPORT_FORMAT_VERSION,
        "type": "full",
        "companionBuild": COMPANION_BUILD,
        "pages": pages,
        "triggers": triggers,
        "triggerCollections": [],
        "custom_variables": custom_variables(),
        "customVariablesCollections": [],
        "expressionVariables": expression_variables,
        "expressionVariablesCollections": [],
        "instances": {
            INSTANCE_ID: {
                "moduleInstanceType": "connection",
                "moduleId": "generic-http",
                "moduleVersionId": GENERIC_HTTP_MODULE_VERSION,
                // The module the file was written for: a newer one takes
                // other options.
                "updatePolicy": "manual",
                "label": INSTANCE_LABEL,
                "config": {
                    "prefix": base_url,
                    "proxyAddress": "",
                    "rejectUnauthorized": true
                },
                "secrets": {},
                "isFirstInit": false,
                "lastUpgradeIndex": GENERIC_HTTP_UPGRADE_INDEX,
                "enabled": true,
                "sortOrder": 0
            }
        },
        "connectionCollections": [],
        "imageLibrary": image_library(),
        "imageLibraryCollections": []
    })
}

// ---------------------------------------------------------------------------
// Pages and buttons
// ---------------------------------------------------------------------------

fn page_document(page: &DeckPage, writer: &Writer) -> Value {
    let mut rows = Map::new();
    for control in (page.controls)() {
        let row = control.place.row().to_string();
        let col = control.place.col().to_string();
        let button = button(page.id, &control, writer);
        rows.entry(row)
            .or_insert_with(|| Value::Object(Map::new()))
            .as_object_mut()
            .expect("a row is an object")
            .insert(col, button);
    }
    json!({
        "id": page.companion_id,
        "name": page.label,
        "controls": rows,
        "gridSize": { "minColumn": 0, "maxColumn": 3, "minRow": 0, "maxRow": 3 }
    })
}

fn button(page_id: &str, control: &Control, writer: &Writer) -> Value {
    let at = format!("{page_id}-{}-{}", control.place.row(), control.place.col());
    let rotary = matches!(control.place, Place::Dial(_));
    let mut action_sets = Map::new();
    action_sets.insert(
        String::from("down"),
        Value::Array(step_actions(
            control.press.as_ref(),
            &format!("{at}-down"),
            writer,
        )),
    );
    // No key acts on its release or while it is held (D26).
    action_sets.insert(String::from("up"), json!([]));
    if rotary {
        action_sets.insert(
            String::from("rotate_left"),
            Value::Array(step_actions(
                control.left.as_ref(),
                &format!("{at}-left"),
                writer,
            )),
        );
        action_sets.insert(
            String::from("rotate_right"),
            Value::Array(step_actions(
                control.right.as_ref(),
                &format!("{at}-right"),
                writer,
            )),
        );
    }
    let mut layers = vec![json!({
        "id": "canvas",
        "name": "Canvas",
        "usage": "auto",
        "type": "canvas",
        // No top bar and no pressed border; no status icons: the deck shows
        // a lost link itself, grey (`deck_link`).
        "decoration": fixed("none"),
        "showStatusIcons": fixed("none")
    })];
    layers.extend(control.elements.iter().map(layer));
    json!({
        "type": "button-layered",
        "options": {
            "stepProgression": "auto",
            "stepExpression": "",
            "rotaryActions": rotary,
            "canModifyStyleInApis": false,
            "notes": control.label
        },
        "style": { "layers": layers },
        "feedbacks": feedbacks(control, &at),
        "steps": {
            "0": {
                "action_sets": action_sets,
                "options": { "runWhileHeld": [] }
            }
        },
        "localVariables": []
    })
}

fn layer(element: &Element) -> Value {
    let [x, y, width, height] = element.bounds;
    let (kind, name) = match &element.kind {
        ElementKind::Fill { .. } => ("box", "Background"),
        ElementKind::Image { .. } => ("image", "Image"),
        ElementKind::Text { .. } => ("text", "Words"),
        ElementKind::Gauge { .. } => ("gauge", "Bar"),
    };
    let mut layer = json!({
        "id": element.id,
        "name": format!("{name} ({})", element.id),
        "usage": "auto",
        "type": kind,
        "enabled": prop(&element.enabled),
        "opacity": fixed(100),
        "x": fixed(x),
        "y": fixed(y),
        "width": fixed(width),
        "height": fixed(height),
        "rotation": fixed(0)
    });
    let properties = match &element.kind {
        ElementKind::Fill { colour } => json!({
            "color": prop(colour),
            "borderWidth": fixed(0),
            "borderColor": fixed(0),
            "borderPosition": fixed("inside")
        }),
        ElementKind::Image { image } => json!({
            "base64Image": fixed(format!("$(image:{image})")),
            "halign": fixed("center"),
            "valign": fixed("center"),
            "fillMode": fixed("fit")
        }),
        ElementKind::Text {
            text,
            size,
            colour,
            align,
        } => json!({
            "text": prop(text),
            "fontsize": fixed(*size),
            "fontsizeAllowShrink": fixed(true),
            "font": fixed("companion-sans"),
            "color": prop(colour),
            // No outline (Companion keeps a colour's alpha inverted).
            "outlineColor": fixed(4_278_190_080_u64),
            "halign": fixed(align.word()),
            "valign": fixed("center")
        }),
        ElementKind::Gauge { value, max, colour } => json!({
            "value": prop(value),
            "min": fixed(0),
            "max": fixed(*max),
            "origin": fixed(Value::Null),
            "symmetric": fixed(false),
            "orientation": fixed("horizontal"),
            "reverse": fixed(false),
            "trackWidth": fixed(100),
            "startAngle": fixed(0),
            "endAngle": fixed(360),
            "ringWidth": fixed(20),
            "roundedEnds": fixed(false),
            "fillEnabled": fixed(true),
            "multiColour": fixed(true),
            "stops": fixed(json!([{
                "_id": fixed("fill"),
                "value": fixed(0),
                "color": fixed(*colour),
                "gradient": fixed(false)
            }])),
            "markerEnabled": fixed(false),
            "markerColor": fixed(DECK_CAP),
            "markerWidth": fixed(15),
            "trackStyle": fixed("transparent"),
            "trackAmount": fixed(30)
        }),
    };
    if let (Some(layer), Value::Object(properties)) = (layer.as_object_mut(), properties) {
        layer.extend(properties);
    }
    layer
}

/// The control's colour rules: an internal `check_expression` each, which
/// overrides element properties while it is true. Later rules win.
fn feedbacks(control: &Control, at: &str) -> Value {
    Value::Array(
        control
            .rules
            .iter()
            .enumerate()
            .map(|(index, rule)| {
                let id = format!("{at}-fb-{}", index + 1);
                json!({
                    "type": "feedback",
                    "id": id,
                    "definitionId": "check_expression",
                    "connectionId": "internal",
                    "options": { "expression": fixed(rule.when.as_str()) },
                    "isInverted": fixed(false),
                    "styleOverrides": rule
                        .set
                        .iter()
                        .enumerate()
                        .map(|(override_index, (element, property, value))| json!({
                            "overrideId": format!("{id}-{}", override_index + 1),
                            "elementId": element,
                            "elementProperty": property,
                            "override": prop(value)
                        }))
                        .collect::<Vec<_>>()
                })
            })
            .collect(),
    )
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/// What a press, a push or a turn sends: a key's post and a read of every
/// display, or a page key's turn of the deck alone.
fn step_actions(step: Option<&Step>, at: &str, writer: &Writer) -> Vec<Value> {
    match step {
        None => Vec::new(),
        Some(Step::Post {
            route,
            action,
            value,
        }) => {
            let body = match value {
                Some(value) => json!({ "action": action, "value": value }),
                None => json!({ "action": action }),
            };
            vec![
                post(&format!("{at}-1"), route, &body, writer),
                read_displays(&format!("{at}-2"), writer),
            ]
        }
        Some(Step::Jump(page_id)) => vec![json!({
            "type": "action",
            "id": format!("{at}-1"),
            "definitionId": "set_page",
            "connectionId": "internal",
            "options": {
                // The surface the key was pressed on.
                "surfaceId": fixed("self"),
                "page": fixed(deck_page_number(page_id))
            }
        })],
    }
}

fn post(id: &str, route: &str, body: &Value, writer: &Writer) -> Value {
    json!({
        "type": "action",
        "id": id,
        "definitionId": "post",
        "connectionId": INSTANCE_ID,
        "upgradeIndex": GENERIC_HTTP_UPGRADE_INDEX,
        "options": {
            "url": fixed(route),
            "body": fixed(body.to_string()),
            "header": fixed(writer.header.as_str()),
            "contenttype": fixed("application/json"),
            "jsonResultDataVariable": fixed(""),
            "result_stringify": fixed(true),
            "statusCodeVariable": fixed("")
        }
    })
}

/// One read of every display, stored as text in `deck_raw`, whatever it is.
fn read_displays(id: &str, writer: &Writer) -> Value {
    json!({
        "type": "action",
        "id": id,
        "definitionId": "get",
        "connectionId": INSTANCE_ID,
        "upgradeIndex": GENERIC_HTTP_UPGRADE_INDEX,
        "options": {
            "url": fixed(DISPLAYS_PATH),
            "header": fixed(writer.header.as_str()),
            "jsonResultDataVariable": fixed(RAW),
            "result_stringify": fixed(true),
            "statusCodeVariable": fixed("")
        }
    })
}

/// Sets a custom variable to what `value` (an expression) says.
fn set_custom(id: &str, name: &str, value: &str) -> Value {
    json!({
        "type": "action",
        "id": id,
        "definitionId": "custom_variable_set_value",
        "connectionId": "internal",
        "options": {
            "name": fixed(name),
            "create": fixed(false),
            "value": expression(value)
        }
    })
}

// ---------------------------------------------------------------------------
// The displays, the link, and the triggers
// ---------------------------------------------------------------------------

/// Whether `deck_raw` is an answer of the bridge's own: an error's body
/// never carries the mark.
pub(super) fn answer_is_the_bridges() -> String {
    format!("jsonpath($(custom:{RAW}), '$.sse') == '{DECK_DISPLAYS_MARK}'")
}

/// What `deck_displays` becomes at a new `deck_raw`: the new answer when it
/// is the bridge's and newer than the kept one (or older by far: the
/// hardware link restarted), else the kept one, unchanged.
pub(super) fn kept_displays() -> String {
    format!(
        "{} ? $(custom:{RAW}) : $(custom:{KEPT})",
        answer_is_kept(">")
    )
}

/// Whether `deck_raw` is an answer the deck keeps: the bridge's own, and
/// newer than the kept one (`newer` is `>`), or older by far (the hardware
/// link restarted, or the clock was set back). The link counts as heard by
/// the same rule, with `>=`: the trigger's two actions may run in either
/// order, and once the answer is kept its moment equals the kept one's
/// (the review of #293: an answer the deck drops does not count as heard).
pub(super) fn answer_is_kept(newer: &str) -> String {
    let raw_at = format!("jsonpath($(custom:{RAW}), '$.at')");
    let kept_at = format!("(jsonpath($(custom:{KEPT}), '$.at') ?? 0)");
    format!(
        "{} && ({raw_at} {newer} {kept_at} || {raw_at} < {kept_at} - {ANSWERS_CROSS_WITHIN_MS})",
        answer_is_the_bridges()
    )
}

/// The page the app is on, as the kept answer says it, whether the link is
/// lost or not: a follow trigger fires only when the app's page changes,
/// never when the deck hears the hardware link again after a silence (the
/// review of #293: the display lines go blank while the link is lost, and a
/// follow on them turned the deck to the app's page at every recovery).
pub(super) fn kept_workspace() -> String {
    format!("(jsonpath($(custom:{KEPT}), '$.words.workspace') ?? '')")
}

/// While the deck has not heard the bridge for `LINK_LOST_AFTER_SECONDS`.
fn link_is_lost() -> String {
    format!("$(custom:{AGE}) >= {LINK_LOST_AFTER_SECONDS}")
}

/// The JSON path of an expression variable's line in the bridge's answer,
/// and what the variable is for; `None` for a name that is not a display's.
pub(super) fn display_path(variable: &str) -> Option<(String, &'static str)> {
    let name = variable.strip_prefix("deck_")?;
    DECK_DISPLAYS.iter().find_map(|(display, shape)| {
        if name == *display {
            Some(match shape {
                DisplayShape::Word => (format!("$.words.{display}"), *display),
                DisplayShape::Lines => (format!("$.lines.{display}.value"), *display),
            })
        } else if name.strip_suffix("_head") == Some(display) && *shape == DisplayShape::Lines {
            Some((format!("$.lines.{display}.head"), *display))
        } else {
            None
        }
    })
}

/// Every expression variable the pages and the triggers read: one a
/// display line, and `deck_link`.
fn expression_variables(readers: &[&Value]) -> Value {
    let text = readers
        .iter()
        .map(|reader| reader.to_string())
        .collect::<String>();
    let marker = "$(expression:";
    let mut names: BTreeSet<String> = text
        .match_indices(marker)
        .map(|(at, _)| {
            let rest = &text[at + marker.len()..];
            rest[..rest.find(')').unwrap_or(rest.len())].to_string()
        })
        .collect();
    names.insert(String::from("deck_link"));
    let mut variables = Map::new();
    for (sort_order, name) in names.iter().enumerate() {
        let (source, description) = if name == "deck_link" {
            (
                format!("{} ? 'lost' : 'ok'", link_is_lost()),
                String::from("Whether the deck hears the Studio Control hardware link: ok or lost"),
            )
        } else {
            let (path, display) = display_path(name).unwrap_or_else(|| {
                panic!("the deck reads {name}, which is no display of the hardware link's")
            });
            (
                format!(
                    "{} ? '' : (jsonpath($(custom:{KEPT}), '{path}') ?? '')",
                    link_is_lost()
                ),
                format!(
                    "A line of the deck's display {display}, from the Studio Control hardware link"
                ),
            )
        };
        let id = format!("sse-expression-{name}");
        variables.insert(
            id.clone(),
            json!({
                "type": "expression-variable",
                "options": {
                    "variableName": name,
                    "description": description,
                    "sortOrder": sort_order,
                    "notes": ""
                },
                "entity": {
                    "type": "feedback",
                    "id": format!("{id}-value"),
                    "definitionId": "expression_value",
                    "connectionId": "internal",
                    "options": { "expression": fixed(source) },
                    "isInverted": fixed(false),
                    "styleOverrides": []
                },
                "localVariables": []
            }),
        );
    }
    Value::Object(variables)
}

// generic-http stores into a custom variable only when the profile brought
// it (the lesson of 2026-09-01).
fn custom_variables() -> Value {
    json!({
        RAW: {
            // Companion shows these to whoever opens its variables, so they
            // name the hardware link, not the engine.
            "description": "The deck's displays as the Studio Control hardware link last answered, error or not",
            "defaultValue": "",
            "persistCurrentValue": false,
            "sortOrder": 0
        },
        KEPT: {
            "description": "The deck's displays: the Studio Control hardware link's last own answer",
            "defaultValue": "{}",
            "persistCurrentValue": false,
            "sortOrder": 1
        },
        AGE: {
            "description": "Seconds since the Studio Control hardware link last answered the deck",
            // Lost until the first answer.
            "defaultValue": LINK_LOST_AFTER_SECONDS,
            "persistCurrentValue": false,
            "sortOrder": 2
        }
    })
}

fn trigger(
    name: &str,
    sort_order: usize,
    actions: Vec<Value>,
    condition: Vec<Value>,
    event: Value,
) -> Value {
    json!({
        "type": "trigger",
        "options": { "name": name, "enabled": true, "sortOrder": sort_order, "notes": "" },
        "actions": actions,
        "condition": condition,
        "events": [event],
        "localVariables": []
    })
}

fn every_second(id: &str) -> Value {
    json!({ "id": id, "type": "interval", "enabled": true, "options": { "seconds": 1 } })
}

fn triggers(writer: &Writer) -> Value {
    let mut triggers = Map::new();
    // Once a second, every display in one read.
    triggers.insert(
        String::from("sse-trigger-deck-poll"),
        trigger(
            "SSE deck poll",
            0,
            vec![read_displays("sse-act-deck-poll", writer)],
            Vec::new(),
            every_second("sse-evt-deck-poll"),
        ),
    );
    // Each answer, kept when it is the bridge's own and the newer; and the
    // link heard.
    triggers.insert(
        String::from("sse-trigger-deck-answer"),
        trigger(
            "SSE deck answer",
            1,
            vec![
                set_custom("sse-act-deck-keep", KEPT, &kept_displays()),
                set_custom(
                    "sse-act-deck-heard",
                    AGE,
                    &format!("{} ? 0 : $(custom:{AGE})", answer_is_kept(">=")),
                ),
            ],
            Vec::new(),
            json!({
                "id": "sse-evt-deck-answer",
                "type": "variable_changed",
                "enabled": true,
                "options": { "variableId": format!("custom:{RAW}") }
            }),
        ),
    );
    // Once a second, a second more since the last answer.
    triggers.insert(
        String::from("sse-trigger-deck-age"),
        trigger(
            "SSE deck age",
            2,
            vec![set_custom(
                "sse-act-deck-age",
                AGE,
                &format!("min(max($(custom:{AGE}), 0) + 1, {AGE_CAP_SECONDS})"),
            )],
            Vec::new(),
            every_second("sse-evt-deck-age"),
        ),
    );

    // The deck follows the app's page: one trigger per deck page, on the
    // page the app saves (`workspace`), read from the kept answer, which a
    // silence leaves as it was. The app's Setup page has no deck page, so
    // the deck stays where it is while Setup is open.
    for (index, deck_page) in DECK_PAGES.iter().enumerate() {
        let slug = deck_page.workspace;
        triggers.insert(
            format!("sse-trigger-follow-{slug}"),
            trigger(
                &format!("SSE follow app - {slug}"),
                index + 3,
                vec![json!({
                    "type": "action",
                    "id": format!("sse-act-follow-{slug}"),
                    "definitionId": "set_page",
                    "connectionId": "internal",
                    "options": {
                        "surfaceId": fixed(writer.surface),
                        "page": fixed(deck_page_number(deck_page.id))
                    }
                })],
                vec![json!({
                    "type": "feedback",
                    "id": format!("sse-cond-follow-{slug}"),
                    "definitionId": "check_expression",
                    "connectionId": "internal",
                    "options": {
                        "expression": fixed(format!("{} == '{slug}'", kept_workspace()))
                    },
                    "isInverted": fixed(false)
                })],
                json!({
                    "id": format!("sse-evt-follow-{slug}"),
                    "type": "condition_true",
                    "enabled": true,
                    "options": {}
                }),
            ),
        );
    }
    Value::Object(triggers)
}
