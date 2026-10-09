use super::companion::{
    answer_is_kept, display_path, generate_companion_config, kept_workspace, AGE,
    COMPANION_EXPORT_FORMAT_VERSION, DISPLAYS_PATH, INSTANCE_ID, INSTANCE_LABEL, KEPT,
    LINK_LOST_AFTER_SECONDS, RAW,
};
use super::images::deck_images;
use super::model::{DECK_FACE, DECK_INK_4, DECK_PALETTE};
use super::profile::streamdeck_surface_id_from;
use super::snapshot::build_control_surface_snapshot;
use crate::control_surface::{DisplayShape, DECK_DISPLAYS, DECK_DISPLAYS_MARK};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

// 2026-09-28: a development build does not ask Companion for its deck;
// the studio's build does, and reads the deck's id from the answer.
#[test]
fn only_the_studio_build_asks_companion_for_its_deck() {
    let answer = r#"{"surfaces":{"emulator:1":{},"streamdeck:A00TEST":{}}}"#;
    let mut asked = false;
    assert_eq!(
        streamdeck_surface_id_from(true, || {
            asked = true;
            Some(String::from(answer))
        }),
        None
    );
    assert!(!asked, "a development build asks nobody");

    assert_eq!(
        streamdeck_surface_id_from(false, || Some(String::from(answer))),
        Some(String::from("streamdeck:A00TEST"))
    );
    assert_eq!(streamdeck_surface_id_from(false, || None), None);
}

const TEST_TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

fn profile() -> Value {
    generate_companion_config(
        "http://127.0.0.1:38201",
        Some("streamdeck:TESTSERIAL"),
        TEST_TOKEN,
    )
}

/// Every object in `value` that `keep` keeps, depth first.
fn objects<'a>(value: &'a Value, keep: &dyn Fn(&Value) -> bool, into: &mut Vec<&'a Value>) {
    match value {
        Value::Object(map) => {
            if keep(value) {
                into.push(value);
            }
            for child in map.values() {
                objects(child, keep, into);
            }
        }
        Value::Array(items) => {
            for item in items {
                objects(item, keep, into);
            }
        }
        _ => {}
    }
}

fn bridge_actions(value: &Value) -> Vec<&Value> {
    let mut actions = Vec::new();
    objects(
        value,
        &|object| object["connectionId"] == INSTANCE_ID,
        &mut actions,
    );
    actions
}

/// Every action and feedback of the profile: the entities of its buttons
/// and triggers.
fn entities(value: &Value) -> Vec<&Value> {
    let mut entities = Vec::new();
    objects(
        value,
        &|object| {
            matches!(object["type"].as_str(), Some("action" | "feedback"))
                && object.get("definitionId").is_some()
        },
        &mut entities,
    );
    entities
}

/// A control of a page, by its page number, row and column.
fn control<'a>(profile: &'a Value, page: &str, row: u8, col: u8) -> &'a Value {
    &profile["pages"][page]["controls"][row.to_string()][col.to_string()]
}

/// What a control's set posts first: its route and its body.
fn posted(control: &Value, set: &str) -> Option<(String, Value)> {
    let action = control["steps"]["0"]["action_sets"][set]
        .as_array()?
        .iter()
        .find(|action| action["definitionId"] == "post")?;
    let body = serde_json::from_str(action["options"]["body"]["value"].as_str()?).ok()?;
    Some((
        action["options"]["url"]["value"].as_str()?.to_string(),
        body,
    ))
}

/// Where a control's set turns the deck to, if it does.
fn jumps(control: &Value, set: &str) -> Vec<i64> {
    control["steps"]["0"]["action_sets"][set]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|action| action["definitionId"] == "set_page")
        .filter_map(|action| action["options"]["page"]["value"].as_i64())
        .collect()
}

/// `value` without its entities' ids, which name the page and the place.
fn without_ids(value: &Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(
            map.iter()
                .filter(|(key, _)| key.as_str() != "id" && key.as_str() != "overrideId")
                .map(|(key, value)| (key.clone(), without_ids(value)))
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.iter().map(without_ids).collect()),
        other => other.clone(),
    }
}

/// A layer of a control, by its id.
fn layer<'a>(control: &'a Value, id: &str) -> &'a Value {
    control["style"]["layers"]
        .as_array()
        .and_then(|layers| layers.iter().find(|layer| layer["id"] == id))
        .unwrap_or(&Value::Null)
}

/// The picture a key or a cell shows at rest, by its name.
fn art(control: &Value) -> Option<String> {
    layer(control, "art")["base64Image"]["value"]
        .as_str()
        .and_then(|value| value.strip_prefix("$(image:"))
        .and_then(|value| value.strip_suffix(')'))
        .map(String::from)
}

/// Every image a control draws, by its name: its layers' and its rules'.
fn images_of(control: &Value) -> BTreeSet<String> {
    let text = control.to_string();
    let marker = "$(image:";
    text.match_indices(marker)
        .map(|(at, _)| {
            let rest = &text[at + marker.len()..];
            rest[..rest.find(')').expect("a closed reference")].to_string()
        })
        .collect()
}

/// The pictures a control's rules swap in for its layer `id`, by the rule's
/// condition.
fn swaps(control: &Value, id: &str) -> Vec<(String, String)> {
    control["feedbacks"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|feedback| {
            let when = feedback["options"]["expression"]["value"]
                .as_str()
                .unwrap_or_default()
                .to_string();
            feedback["styleOverrides"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(move |change| {
                    change["elementId"] == id && change["elementProperty"] == "base64Image"
                })
                .filter_map(|change| change["override"]["value"].as_str())
                .map(move |image| (when.clone(), image.to_string()))
        })
        .collect()
}

// 2026-09 production readiness, Slice 2 (finding F01): the profile is the
// client the bridge accepts, so every request it makes must carry the
// token — and nothing else in the file may.
#[test]
fn companion_export_carries_the_bridge_token_on_every_request() {
    let config = profile();
    let actions = bridge_actions(&config);
    assert!(
        actions.len() > 50,
        "every deck key, dial and the poll talk to the bridge: {}",
        actions.len()
    );
    let expected = json!({ "Authorization": format!("Bearer {TEST_TOKEN}") });
    for action in &actions {
        assert_eq!(
            action["options"]["header"]["isExpression"], false,
            "{action}"
        );
        let header = action["options"]["header"]["value"]
            .as_str()
            .unwrap_or_else(|| panic!("bridge action without a header option: {action}"));
        let parsed: Value = serde_json::from_str(header)
            .expect("the header option is the JSON object generic-http parses");
        assert_eq!(parsed, expected, "{action}");
        assert_eq!(action["upgradeIndex"], 1, "{action}");
    }
    assert_eq!(
        config.to_string().matches(TEST_TOKEN).count(),
        actions.len(),
        "the token appears once per bridge request and nowhere else"
    );
}

#[test]
fn companion_export_contains_native_bridge_instance() {
    let config = generate_companion_config("http://127.0.0.1:38201", None, TEST_TOKEN);
    let instance = &config["instances"][INSTANCE_ID];
    assert_eq!(instance["config"]["prefix"], "http://127.0.0.1:38201");
    assert_eq!(instance["label"], INSTANCE_LABEL);
    assert!(
        !INSTANCE_LABEL.contains(' '),
        "Companion connection labels must not contain spaces"
    );
    // Companion 5 reads `moduleId` (`instance_type` was renamed by its
    // upgrade from version 9), and keeps the module the file was made for.
    assert_eq!(instance["moduleId"], "generic-http");
    assert!(instance.get("instance_type").is_none());
    assert_eq!(instance["moduleVersionId"], "2.7.0");
    assert_eq!(instance["updatePolicy"], "manual");
    assert_eq!(instance["lastUpgradeIndex"], 1);
    assert_eq!(
        config["instances"].as_object().map(|map| map.len()),
        Some(1)
    );
}

#[test]
fn companion_export_uses_override_base_url() {
    let config = generate_companion_config("http://localhost:3000", None, TEST_TOKEN);
    assert_eq!(
        config["instances"][INSTANCE_ID]["config"]["prefix"],
        "http://localhost:3000"
    );
}

// 2026-10-03: the profile is Companion 5's own format, as 5.0.6 writes a
// full export: version 12, layered buttons, every option of an action, a
// feedback or a layer wrapped, an event's options plain.
#[test]
fn the_profile_is_companion_5s_own_full_export() {
    let config = profile();
    assert_eq!(config["version"], COMPANION_EXPORT_FORMAT_VERSION);
    assert_eq!(config["version"], 12);
    assert_eq!(config["type"], "full");
    assert!(config["companionBuild"]
        .as_str()
        .is_some_and(|build| build.starts_with("5.0.6")));
    assert!(config.get("surfaces").is_none());
    for key in [
        "triggerCollections",
        "customVariablesCollections",
        "expressionVariablesCollections",
        "connectionCollections",
        "imageLibraryCollections",
    ] {
        assert_eq!(config[key], json!([]), "{key}");
    }
    assert_eq!(config, profile(), "an export is the same file every time");

    for (number, id, name) in [
        ("1", "sse-page-lights", "LIGHTS"),
        ("2", "sse-page-audio", "AUDIO"),
        ("3", "sse-page-cameras", "CAMERAS"),
        ("4", "sse-page-prompter", "PROMPTER"),
    ] {
        let page = &config["pages"][number];
        assert_eq!(
            (page["id"].as_str(), page["name"].as_str()),
            (Some(id), Some(name))
        );
        for (row, columns) in page["controls"].as_object().expect("rows") {
            assert_eq!(
                columns.as_object().map(|columns| columns.len()),
                Some(4),
                "page {number} row {row}: every place has a control"
            );
            for (col, button) in columns.as_object().expect("columns") {
                let at = format!("{number}/{row}/{col}");
                assert_eq!(button["type"], "button-layered", "{at}");
                let canvas = &button["style"]["layers"][0];
                assert_eq!(canvas["type"], "canvas", "{at}");
                assert_eq!(
                    canvas["decoration"],
                    json!({"isExpression": false, "value": "none"})
                );
                assert_eq!(
                    canvas["showStatusIcons"],
                    json!({"isExpression": false, "value": "none"})
                );
                assert_eq!(button["options"]["rotaryActions"], row == "3", "{at}");
                let sets = button["steps"]["0"]["action_sets"]
                    .as_object()
                    .expect("a step's action sets");
                assert!(sets.contains_key("down") && sets.contains_key("up"), "{at}");
                assert_eq!(sets.contains_key("rotate_left"), row == "3", "{at}");
                assert_eq!(sets["up"], json!([]), "{at}");
                for layer in button["style"]["layers"]
                    .as_array()
                    .expect("layers")
                    .iter()
                    .skip(1)
                {
                    for (property, value) in layer.as_object().expect("a layer") {
                        if ["id", "name", "usage", "type"].contains(&property.as_str()) {
                            continue;
                        }
                        assert!(
                            value.get("isExpression").is_some_and(Value::is_boolean)
                                && value.get("value").is_some(),
                            "{at}: {property} of {layer}"
                        );
                    }
                }
            }
        }
    }

    for entity in entities(&config) {
        for (option, value) in entity["options"].as_object().expect("options") {
            assert!(
                value.get("isExpression").is_some_and(Value::is_boolean)
                    && value.get("value").is_some(),
                "{option} of {entity}"
            );
        }
        if entity["type"] == "feedback" {
            assert!(
                entity["isInverted"]["isExpression"].is_boolean(),
                "{entity}"
            );
        }
    }
    for trigger in config["triggers"].as_object().expect("triggers").values() {
        for event in trigger["events"].as_array().expect("events") {
            for value in event["options"].as_object().expect("options").values() {
                assert!(value.get("isExpression").is_none(), "{event}");
            }
        }
    }
}

// Companion draws nothing on a Stream Deck+'s dials (row 3): every display
// is a cell of the strip (row 2), over its dial. Until 2026-10-03 the LIGHTS
// page's four displays sat on its dials, and the strip was black.
#[test]
fn every_display_is_on_the_strip_and_no_dial_shows_anything() {
    let config = profile();
    for page in ["1", "2", "3", "4"] {
        for col in 0..4 {
            let dial = control(&config, page, 3, col);
            let text = dial.to_string();
            assert!(!text.contains("$(expression:"), "{page}/3/{col}: {text}");
            assert_eq!(dial["feedbacks"], json!([]), "{page}/3/{col}");
            let cell = control(&config, page, 2, col);
            assert!(
                layer(cell, "value")["text"]["value"]
                    .as_str()
                    .is_some_and(|text| text.starts_with("$(expression:deck_")),
                "{page}/2/{col}: the cell shows a display"
            );
            // The strip only shows: a tap does nothing, and a swipe turns
            // nothing (no rotary actions on row 2).
            assert_eq!(cell["steps"]["0"]["action_sets"]["down"], json!([]));
            assert_eq!(cell["options"]["rotaryActions"], false);
        }
    }
}

/// The approved layout, by page, row and column: the picture each key shows
/// at rest, which draws its words (`""`: dark). Its name is the page
/// model's (`control_surface_snapshot_matches_the_deck_page_model`).
const LAYOUT: [(&str, [[&str; 4]; 2]); 4] = [
    (
        "1",
        [
            ["key_rec", "key_all_on", "key_save", "key_page_audio"],
            ["key_play", "key_all_off", "", "key_recall"],
        ],
    ),
    (
        "2",
        [
            ["key_rec", "key_main_out", "key_phones", "key_page_cameras"],
            ["key_play", "key_audio_bank", "key_dim", "key_solo"],
        ],
    ),
    (
        "3",
        [
            ["key_rec", "key_camera_bank", "", "key_page_prompter"],
            ["key_play", "key_cam_1", "key_cam_2", "key_cam_3"],
        ],
    ),
    (
        "4",
        [
            ["key_rec", "key_cue_back", "key_cue_next", "key_page_lights"],
            ["key_play", "key_back", "", "key_top"],
        ],
    ),
];

// The approved layout (2026-10-03): REC top left and PLAY under it on every
// page, the page key top right, and the pages' own keys where the owner
// approved them, each drawn by its picture. A dark key is the black glass
// and does nothing.
#[test]
fn the_four_pages_hold_the_approved_layout() {
    let config = profile();
    for (page, rows) in LAYOUT {
        for (row, pictures) in rows.iter().enumerate() {
            for (col, expected) in pictures.iter().enumerate() {
                let key = control(&config, page, row as u8, col as u8);
                let at = format!("{page}/{row}/{col}");
                match *expected {
                    "" => {
                        assert_eq!(key["steps"]["0"]["action_sets"]["down"], json!([]), "{at}");
                        assert_eq!(art(key).as_deref(), Some("key_dark"), "{at}");
                        assert_eq!(key["feedbacks"], json!([]), "{at}");
                        assert_eq!(
                            key["style"]["layers"].as_array().map(Vec::len),
                            Some(3),
                            "{at}: the canvas, the glass and its picture, nothing else"
                        );
                    }
                    picture => assert_eq!(art(key).as_deref(), Some(picture), "{at}"),
                }
            }
        }
        // REC and PLAY are the same on every page.
        assert_eq!(
            posted(control(&config, page, 0, 0), "down"),
            Some((
                String::from("/api/deck/camera-action"),
                json!({ "action": "rec" })
            )),
            "page {page}'s REC"
        );
        assert_eq!(
            posted(control(&config, page, 1, 0), "down"),
            Some((
                String::from("/api/deck/prompter-action"),
                json!({ "action": "playPause" })
            )),
            "page {page}'s PLAY"
        );
        for (row, what) in [(0, "REC"), (1, "PLAY")] {
            assert_eq!(
                without_ids(&control(&config, page, row, 0)["feedbacks"]),
                without_ids(&control(&config, "1", row, 0)["feedbacks"]),
                "{what} follows the same rules on every page"
            );
        }
    }
    // PHONES says which phones mix is the target: its pictures name it.
    let phones = swaps(control(&config, "2", 0, 2), "art");
    for (word, picture) in [("phones-a", "key_phones_1"), ("phones-b", "key_phones_2")] {
        assert!(
            phones.contains(&(
                format!("$(expression:deck_audio_state_target) == '{word}'"),
                format!("$(image:{picture})")
            )),
            "PHONES shows {picture} for {word}: {phones:?}"
        );
    }
}

// D5: LIGHTS, AUDIO, CAMERAS and PROMPTER, chained by the page keys and by
// the deck following the app. The page keys make a ring, top right on every
// page (2026-10-03), each to the page after it, PROMPTER's round to LIGHTS.
// Setup has no deck page, so nothing follows it and the deck stays put. The
// Overview has none either, and turns the deck to PROMPTER (D49).
#[test]
fn the_page_keys_and_follow_triggers_chain_the_four_pages() {
    let config = profile();
    let mut every_jump = Vec::new();
    for (page, next) in [("1", 2), ("2", 3), ("3", 4), ("4", 1)] {
        for row in 0..4_u8 {
            for col in 0..4_u8 {
                let key = control(&config, page, row, col);
                let found: Vec<i64> = ["down", "rotate_left", "rotate_right"]
                    .iter()
                    .flat_map(|set| jumps(key, set))
                    .collect();
                if (row, col) == (0, 3) {
                    assert_eq!(found, vec![next], "page {page}'s page key");
                    assert!(posted(key, "down").is_none(), "a page key posts nothing");
                    assert_eq!(
                        key["steps"]["0"]["action_sets"]["down"][0]["options"]["surfaceId"]
                            ["value"],
                        "self",
                        "a key turns the deck it was pressed on"
                    );
                } else {
                    assert_eq!(found, Vec::<i64>::new(), "{page}/{row}/{col}");
                }
                every_jump.extend(found);
            }
        }
    }
    assert_eq!(every_jump, vec![2, 3, 4, 1]);

    let triggers = config["triggers"].as_object().expect("triggers");
    let mut follows = triggers
        .iter()
        .filter(|(_, trigger)| trigger["events"][0]["type"] == "condition_true")
        .map(|(id, trigger)| {
            assert_eq!(trigger["condition"][0]["definitionId"], "check_expression");
            assert_eq!(trigger["actions"][0]["definitionId"], "set_page");
            // A trigger names the deck: `self` names no surface there.
            assert_eq!(
                trigger["actions"][0]["options"]["surfaceId"]["value"],
                "streamdeck:TESTSERIAL"
            );
            assert!(bridge_actions(trigger).is_empty(), "{id} sends nothing");
            (
                trigger["condition"][0]["options"]["expression"]["value"]
                    .as_str()
                    .expect("a follow tests the saved page")
                    .to_string(),
                trigger["actions"][0]["options"]["page"]["value"]
                    .as_i64()
                    .expect("a page"),
            )
        })
        .collect::<Vec<_>>();
    follows.sort();
    let on = |workspace: &str| format!("{} == '{workspace}'", kept_workspace());
    assert_eq!(
        follows,
        vec![
            (on("audio"), 2),
            (on("cameras"), 3),
            (on("lighting"), 1),
            // D49: the Overview turns the deck to PROMPTER, the
            // Teleprompter's deck page.
            (on("overview"), 4),
            // The page's word in the app is the one the hardware link
            // accepts (`shell_settings::WORKSPACES`).
            (on("teleprompter"), 4),
        ]
    );
    for workspace in ["audio", "cameras", "lighting", "overview", "teleprompter"] {
        assert!(crate::shell_settings::WORKSPACES.contains(&workspace));
    }
    assert_eq!(config["pages"]["4"]["name"], "PROMPTER");
    let overview = &triggers["sse-trigger-follow-overview"];
    assert_eq!(overview["options"]["name"], "SSE follow app - overview");
    assert_eq!(overview["actions"][0]["options"]["page"]["value"], 4);

    let fallback = generate_companion_config("http://127.0.0.1:38201", None, TEST_TOKEN);
    assert_eq!(
        fallback["triggers"]["sse-trigger-follow-audio"]["actions"][0]["options"]["surfaceId"]
            ["value"],
        "self"
    );
}

/// What every key and dial of the four pages posts, by page, row, column and
/// set: the approved layout's presses (2026-10-03).
fn presses() -> Vec<(&'static str, u8, u8, &'static str, &'static str, Value)> {
    let light = "/api/deck/light-action";
    let audio = "/api/deck/audio-action";
    let camera = "/api/deck/camera-action";
    let prompter = "/api/deck/prompter-action";
    let mut presses = vec![
        ("1", 0, 1, "down", light, json!({ "action": "allOn" })),
        ("1", 0, 2, "down", light, json!({ "action": "saveScene" })),
        ("1", 1, 1, "down", light, json!({ "action": "allOff" })),
        ("1", 1, 3, "down", light, json!({ "action": "recallScene" })),
        ("1", 3, 0, "down", light, json!({ "action": "toggleLight" })),
        (
            "1",
            3,
            0,
            "rotate_left",
            light,
            json!({ "action": "selectPrevLight" }),
        ),
        (
            "1",
            3,
            0,
            "rotate_right",
            light,
            json!({ "action": "selectNextLight" }),
        ),
        (
            "1",
            3,
            1,
            "down",
            light,
            json!({ "action": "resetIntensity" }),
        ),
        (
            "1",
            3,
            1,
            "rotate_left",
            light,
            json!({ "action": "intensityDown" }),
        ),
        (
            "1",
            3,
            1,
            "rotate_right",
            light,
            json!({ "action": "intensityUp" }),
        ),
        ("1", 3, 2, "down", light, json!({ "action": "resetCct" })),
        (
            "1",
            3,
            2,
            "rotate_left",
            light,
            json!({ "action": "cctDown" }),
        ),
        (
            "1",
            3,
            2,
            "rotate_right",
            light,
            json!({ "action": "cctUp" }),
        ),
        ("1", 3, 3, "down", light, json!({ "action": "recallScene" })),
        (
            "1",
            3,
            3,
            "rotate_left",
            light,
            json!({ "action": "selectPrevScene" }),
        ),
        (
            "1",
            3,
            3,
            "rotate_right",
            light,
            json!({ "action": "selectNextScene" }),
        ),
        (
            "2",
            0,
            1,
            "down",
            audio,
            json!({ "action": "setMixTarget", "value": "main" }),
        ),
        (
            "2",
            0,
            2,
            "down",
            audio,
            json!({ "action": "setMixTarget", "value": "phones" }),
        ),
        ("2", 1, 1, "down", audio, json!({ "action": "cycleBank" })),
        ("2", 1, 2, "down", audio, json!({ "action": "dimToggle" })),
        (
            "2",
            1,
            3,
            "down",
            audio,
            json!({ "action": "soloClearAll" }),
        ),
        ("3", 0, 1, "down", camera, json!({ "action": "bank" })),
        (
            "3",
            1,
            1,
            "down",
            camera,
            json!({ "action": "select", "value": "1" }),
        ),
        (
            "3",
            1,
            2,
            "down",
            camera,
            json!({ "action": "select", "value": "2" }),
        ),
        (
            "3",
            1,
            3,
            "down",
            camera,
            json!({ "action": "select", "value": "3" }),
        ),
        (
            "4",
            0,
            1,
            "down",
            prompter,
            json!({ "action": "cue", "value": "previous" }),
        ),
        (
            "4",
            0,
            2,
            "down",
            prompter,
            json!({ "action": "cue", "value": "next" }),
        ),
        ("4", 1, 1, "down", prompter, json!({ "action": "back" })),
        ("4", 1, 3, "down", prompter, json!({ "action": "top" })),
        (
            "4",
            3,
            0,
            "down",
            prompter,
            json!({ "action": "playPause" }),
        ),
        (
            "4",
            3,
            0,
            "rotate_left",
            prompter,
            json!({ "action": "speed", "value": "down" }),
        ),
        (
            "4",
            3,
            0,
            "rotate_right",
            prompter,
            json!({ "action": "speed", "value": "up" }),
        ),
        (
            "4",
            3,
            1,
            "rotate_left",
            prompter,
            json!({ "action": "line", "value": "previous" }),
        ),
        (
            "4",
            3,
            1,
            "rotate_right",
            prompter,
            json!({ "action": "line", "value": "next" }),
        ),
        (
            "4",
            3,
            2,
            "rotate_left",
            prompter,
            json!({ "action": "paragraph", "value": "previous" }),
        ),
        (
            "4",
            3,
            2,
            "rotate_right",
            prompter,
            json!({ "action": "paragraph", "value": "next" }),
        ),
        (
            "4",
            3,
            3,
            "down",
            prompter,
            json!({ "action": "size", "value": "standard" }),
        ),
        (
            "4",
            3,
            3,
            "rotate_left",
            prompter,
            json!({ "action": "size", "value": "down" }),
        ),
        (
            "4",
            3,
            3,
            "rotate_right",
            prompter,
            json!({ "action": "size", "value": "up" }),
        ),
    ];
    for (col, dial) in [(0, "1"), (1, "2"), (2, "3"), (3, "4")] {
        let way = |direction: &str| Value::String(format!("{dial}:{direction}"));
        presses.push((
            "2",
            3,
            col,
            "down",
            audio,
            json!({ "action": "dialPress", "value": dial }),
        ));
        presses.push((
            "2",
            3,
            col,
            "rotate_left",
            audio,
            json!({ "action": "dialTurn", "value": way("down") }),
        ));
        presses.push((
            "2",
            3,
            col,
            "rotate_right",
            audio,
            json!({ "action": "dialTurn", "value": way("up") }),
        ));
        presses.push((
            "3",
            3,
            col,
            "down",
            camera,
            json!({ "action": "dialPush", "value": dial }),
        ));
        presses.push((
            "3",
            3,
            col,
            "rotate_left",
            camera,
            json!({ "action": "dial", "value": way("down") }),
        ));
        presses.push((
            "3",
            3,
            col,
            "rotate_right",
            camera,
            json!({ "action": "dial", "value": way("up") }),
        ));
    }
    presses
}

// What every press, push and turn posts, and that it reads the displays
// again with it: one read of every display (2026-10-03), which the bridge
// answers after the press. GAIN's switch, the strip taps and Del Scene left
// the deck; PROMPTER's SIZE and PARAGRAPH dials swapped places.
#[test]
fn every_press_posts_its_pages_key_and_reads_the_displays_again() {
    let config = profile();
    let mut expected: BTreeMap<String, (String, Value)> = BTreeMap::new();
    for page in ["1", "2", "3", "4"] {
        expected.insert(
            format!("{page}/0/0/down"),
            (
                String::from("/api/deck/camera-action"),
                json!({ "action": "rec" }),
            ),
        );
        expected.insert(
            format!("{page}/1/0/down"),
            (
                String::from("/api/deck/prompter-action"),
                json!({ "action": "playPause" }),
            ),
        );
    }
    for (page, row, col, set, route, body) in presses() {
        expected.insert(
            format!("{page}/{row}/{col}/{set}"),
            (String::from(route), body),
        );
    }
    let mut found = BTreeMap::new();
    for page in ["1", "2", "3", "4"] {
        for row in 0..4_u8 {
            for col in 0..4_u8 {
                let key = control(&config, page, row, col);
                for (set, actions) in key["steps"]["0"]["action_sets"].as_object().expect("sets") {
                    let actions = actions.as_array().expect("a set");
                    if let Some(posted) = posted(key, set) {
                        assert_eq!(actions.len(), 2, "{page}/{row}/{col}/{set}");
                        let read = &actions[1];
                        assert_eq!(read["definitionId"], "get");
                        assert_eq!(read["options"]["url"]["value"], DISPLAYS_PATH);
                        assert_eq!(read["options"]["jsonResultDataVariable"]["value"], RAW);
                        found.insert(format!("{page}/{row}/{col}/{set}"), posted);
                    }
                }
            }
        }
    }
    assert_eq!(found, expected);
    let every = config.to_string();
    for gone in [
        "toggleDialMode",
        "stripTap",
        "deleteScene",
        "/api/deck/lcd",
        "\"phones-a\"",
    ] {
        assert!(!every.contains(gone), "the profile still sends {gone}");
    }
}

// The deck reads every display in one request a second (2026-10-03: until
// then a request a display, 47 at once), into one custom variable, and keeps
// only an answer of the bridge's own that is not older than the one it has:
// generic-http stores an error's body too, and sends a refused read again.
// Without an answer for a while, the deck shows nothing it does not know.
#[test]
fn the_displays_come_in_one_read_a_second_and_a_bad_answer_is_never_shown() {
    let config = profile();
    let triggers = &config["triggers"];
    let poll = &triggers["sse-trigger-deck-poll"];
    assert_eq!(poll["events"][0]["type"], "interval");
    assert_eq!(poll["events"][0]["options"]["seconds"], 1);
    assert_eq!(poll["actions"].as_array().map(Vec::len), Some(1));
    let read = &poll["actions"][0];
    assert_eq!(read["definitionId"], "get");
    assert_eq!(read["options"]["url"]["value"], DISPLAYS_PATH);
    assert_eq!(read["options"]["jsonResultDataVariable"]["value"], RAW);
    assert_eq!(read["options"]["result_stringify"]["value"], true);

    let answer = &triggers["sse-trigger-deck-answer"];
    assert_eq!(answer["events"][0]["type"], "variable_changed");
    assert_eq!(
        answer["events"][0]["options"]["variableId"],
        format!("custom:{RAW}")
    );
    let keep = &answer["actions"][0];
    assert_eq!(keep["definitionId"], "custom_variable_set_value");
    assert_eq!(keep["options"]["name"]["value"], KEPT);
    assert_eq!(keep["options"]["value"]["isExpression"], true);
    let kept = keep["options"]["value"]["value"]
        .as_str()
        .expect("an expression");
    assert!(kept.starts_with(&format!(
        "jsonpath($(custom:{RAW}), '$.sse') == '{DECK_DISPLAYS_MARK}' && "
    )));
    assert!(kept.contains("'$.at'") && kept.ends_with(&format!("$(custom:{KEPT})")));
    let heard = &answer["actions"][1];
    assert_eq!(heard["options"]["name"]["value"], AGE);
    // The link is heard by the keep's own rule (the review of #293): an answer
    // the deck drops does not count. `>=` because the two actions may run in
    // either order, and a kept answer's moment is then the kept one's.
    assert_eq!(
        kept,
        format!(
            "{} ? $(custom:{RAW}) : $(custom:{KEPT})",
            answer_is_kept(">")
        )
    );
    assert_eq!(
        heard["options"]["value"]["value"],
        format!("{} ? 0 : $(custom:{AGE})", answer_is_kept(">="))
    );
    assert_eq!(
        answer_is_kept(">="),
        answer_is_kept(">").replacen("') > (", "') >= (", 1)
    );
    let age = &triggers["sse-trigger-deck-age"];
    assert_eq!(age["events"][0]["options"]["seconds"], 1);
    assert_eq!(age["actions"][0]["options"]["name"]["value"], AGE);
    assert!(bridge_actions(answer).is_empty() && bridge_actions(age).is_empty());

    let variables = config["custom_variables"]
        .as_object()
        .expect("custom variables");
    assert_eq!(
        variables.keys().cloned().collect::<BTreeSet<_>>(),
        BTreeSet::from([String::from(AGE), String::from(KEPT), String::from(RAW)])
    );
    assert_eq!(
        variables[AGE]["defaultValue"], LINK_LOST_AFTER_SECONDS,
        "lost until heard"
    );
    assert_eq!(variables[KEPT]["defaultValue"], "{}");
    for variable in variables.values() {
        assert_eq!(variable["persistCurrentValue"], false);
    }

    // An error's body is never the bridge's answer: it has no mark.
    let refusal = crate::control_surface::ControlSurfaceError::Busy(String::from("busy"));
    assert!(!json!({ "error": refusal.message() })
        .to_string()
        .contains("\"sse\""));

    // Every display line is blank while the link is lost, and `deck_link`
    // says so for the keys to grey.
    let expressions = config["expressionVariables"]
        .as_object()
        .expect("expression variables");
    let lost = format!("$(custom:{AGE}) >= {LINK_LOST_AFTER_SECONDS} ? ");
    for (id, variable) in expressions {
        let source = variable["entity"]["options"]["expression"]["value"]
            .as_str()
            .expect("an expression");
        assert_eq!(variable["entity"]["definitionId"], "expression_value");
        assert!(source.starts_with(&lost), "{id}: {source}");
        if variable["options"]["variableName"] != "deck_link" {
            assert!(source.ends_with("?? '')"), "{id}: {source}");
            assert!(
                source.contains(&format!("jsonpath($(custom:{KEPT}), '$.")),
                "{id}"
            );
        }
    }
}

/// Every expression variable the profile reads, by name.
fn read_variables(config: &Value) -> BTreeSet<String> {
    let text = config["pages"].to_string() + &config["triggers"].to_string();
    let marker = "$(expression:";
    text.match_indices(marker)
        .map(|(at, _)| {
            let rest = &text[at + marker.len()..];
            rest[..rest.find(')').expect("a closed reference")].to_string()
        })
        .collect()
}

// Every line the deck reads is a display the bridge answers, in the shape
// the bridge gives it, and every display the bridge answers for the deck is
// shown: the profile and `GET /api/deck/displays` hold the same 39.
#[test]
fn every_display_the_deck_reads_is_one_the_bridge_answers() {
    let config = profile();
    let read = read_variables(&config);
    let defined = config["expressionVariables"]
        .as_object()
        .expect("expression variables")
        .values()
        .map(|variable| {
            variable["options"]["variableName"]
                .as_str()
                .unwrap_or_default()
                .to_string()
        })
        .collect::<BTreeSet<_>>();
    assert_eq!(
        read, defined,
        "the profile defines what it reads, and nothing else"
    );

    let mut shown = BTreeSet::new();
    // The follow triggers read the page the app is on out of the kept
    // answer themselves (`a_silence_turns_no_page_of_the_deck`).
    if config["triggers"]
        .to_string()
        .contains("'$.words.workspace'")
    {
        shown.insert("workspace");
    }
    for name in read.iter().filter(|name| *name != "deck_link") {
        let (path, display) =
            display_path(name).unwrap_or_else(|| panic!("{name} is no display of the bridge's"));
        shown.insert(display);
        let shape = DECK_DISPLAYS
            .iter()
            .find(|(key, _)| *key == display)
            .map(|(_, shape)| *shape)
            .expect("a display");
        match shape {
            DisplayShape::Word => assert_eq!(path, format!("$.words.{display}")),
            DisplayShape::Lines => assert!(
                path == format!("$.lines.{display}.value")
                    || path == format!("$.lines.{display}.head"),
                "{path}"
            ),
        }
    }
    assert_eq!(
        shown,
        DECK_DISPLAYS
            .iter()
            .map(|(key, _)| *key)
            .collect::<BTreeSet<_>>(),
        "the deck shows every display the bridge answers for it"
    );
    assert_eq!(DECK_DISPLAYS.len(), 39);

    // The bridge answers every path the deck reads.
    let _preview_guard = crate::lighting::shared_preview_test_guard();
    let test_dir = crate::control_surface::test_support::ready_audio_test_db("profile-displays");
    let answer = crate::control_surface::read_deck_displays(
        &test_dir.db_path(),
        true,
        std::time::Instant::now(),
    )
    .expect("the bridge answers");
    assert_eq!(answer["sse"], DECK_DISPLAYS_MARK);
    for name in read.iter().filter(|name| *name != "deck_link") {
        let (path, _) = display_path(name).expect("a display");
        let pointer = path.trim_start_matches('$').replace('.', "/");
        assert!(
            answer.pointer(&pointer).is_some_and(Value::is_string),
            "the bridge does not answer {path}: {answer}"
        );
    }
    assert!(answer
        .pointer("/words/workspace")
        .is_some_and(Value::is_string));
}

/// The words a display can be, as the bridge says them (`control_surface`,
/// `cameras::deck`, `prompter::deck`, `lighting::scene_state`).
fn bridge_words(display: &str) -> Vec<String> {
    let words: Vec<&str> = match display {
        "scene_state" => crate::lighting::SCENE_STATES.to_vec(),
        "prompter_state_play" => crate::prompter::deck::PLAY_STATES.to_vec(),
        "prompter_state_on" | "audio_state_gated" => vec!["yes", "no"],
        "camera_state_rec" => vec!["ready", "recording", "armed", "last-known", "locked"],
        "camera_state_dials" => vec!["live", "doubt", "locked"],
        "camera_state_selected" => vec!["1", "2", "3"],
        "camera_key_1" | "camera_key_2" | "camera_key_3" => {
            vec!["HELD", "UNREACHABLE", "RELEASED", "NOT SET UP"]
        }
        // The bank's word under BANK, as `cameras::deck` says it.
        "camera_key_bank" => {
            return crate::cameras::snapshot::CameraDialBank::ALL
                .iter()
                .map(|bank| bank.key().to_uppercase())
                .collect()
        }
        "audio_state_target" => vec!["main", "phones-a", "phones-b"],
        "audio_state_bank" => vec!["inputs", "playback", "outputs"],
        "audio_state_dim" => vec!["on", "off"],
        "light_key_off" => vec!["OFF?", "ALL OFF"],
        "workspace" => crate::shell_settings::WORKSPACES.to_vec(),
        other => panic!("the deck's colours read {other}, whose words this test does not know"),
    };
    words.into_iter().map(String::from).collect()
}

// The deck's colours follow the bridge's state words with exact equality:
// change one side without the other and a colour disappears without a word.
// Every word a rule or a key's line tests is one the bridge can say, letter
// for letter, and the new ones are pinned here (2026-10-03).
#[test]
fn the_words_the_deck_tests_are_the_bridges_letter_for_letter() {
    let config = profile();
    let text = config.to_string().replace("\\\"", "\"");
    let mut tested: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let marker = "$(expression:deck_";
    for (at, _) in text.match_indices(marker) {
        let rest = &text[at + marker.len()..];
        let name = &rest[..rest.find(')').expect("a closed reference")];
        let after = rest[name.len() + 1..].trim_start();
        let Some(compared) = after
            .strip_prefix("== '")
            .or_else(|| after.strip_prefix("!= '"))
        else {
            continue;
        };
        let word = &compared[..compared.find('\'').expect("a closed word")];
        tested
            .entry(String::from(name))
            .or_default()
            .insert(String::from(word));
    }
    for (name, words) in &tested {
        if name == "link" {
            assert_eq!(words, &BTreeSet::from([String::from("lost")]));
            continue;
        }
        // A level word is tested against its bar's ends, not a list.
        if name.ends_with("_level") {
            assert!(words.is_subset(&BTreeSet::from([
                String::new(),
                String::from("off"),
                String::from("empty")
            ])));
            continue;
        }
        let known = bridge_words(name);
        for word in words {
            assert!(
                known.contains(word),
                "the deck tests {name} == {word:?}, which the bridge never says"
            );
        }
    }
    for (display, word) in [
        ("scene_state", "live"),
        ("scene_state", "unsaved"),
        ("scene_state", "preview"),
        ("scene_state", "none"),
        ("prompter_state_play", "end"),
        ("prompter_state_play", "no-xl"),
        ("prompter_state_play", "playing"),
        ("camera_state_rec", "recording"),
        ("camera_state_rec", "armed"),
        ("camera_state_rec", "last-known"),
        ("audio_state_target", "phones-a"),
        ("audio_state_target", "phones-b"),
        ("light_key_off", "OFF?"),
        // The pictures of the bank keys and the camera keys (2026-10-03, the
        // deck's look): each picks its picture by the word it draws.
        ("audio_state_bank", "inputs"),
        ("audio_state_bank", "playback"),
        ("audio_state_bank", "outputs"),
        ("camera_key_bank", "EXPOSURE"),
        ("camera_key_bank", "COLOUR"),
        ("camera_key_bank", "FOCUS"),
        ("camera_key_1", "HELD"),
        ("camera_key_1", "RELEASED"),
        ("camera_key_1", "NOT SET UP"),
        ("camera_key_1", "UNREACHABLE"),
    ] {
        assert!(
            tested
                .get(display)
                .is_some_and(|words| words.contains(word)),
            "the deck no longer tests {display} == {word}"
        );
    }
    assert_eq!(
        crate::lighting::SCENE_STATES,
        ["live", "unsaved", "chosen", "preview", "none"]
    );
    assert_eq!(
        crate::prompter::deck::PLAY_STATES,
        ["playing", "ready", "end", "no-xl", "locked"]
    );
}

// Each rule names a layer of its own control, and a property that layer has.
#[test]
fn every_rule_overrides_a_property_of_its_own_layers() {
    let config = profile();
    let properties = |kind: &str| -> &'static [&'static str] {
        match kind {
            "box" => &["color", "borderWidth", "borderColor", "enabled"],
            "text" => &["color", "text", "enabled"],
            "image" => &["base64Image", "enabled"],
            "gauge" => &["enabled"],
            _ => &[],
        }
    };
    for page in ["1", "2", "3", "4"] {
        for row in 0..4_u8 {
            for col in 0..4_u8 {
                let key = control(&config, page, row, col);
                for feedback in key["feedbacks"].as_array().expect("feedbacks") {
                    assert_eq!(feedback["definitionId"], "check_expression");
                    assert_eq!(feedback["connectionId"], "internal");
                    for change in feedback["styleOverrides"].as_array().expect("overrides") {
                        let target = layer(key, change["elementId"].as_str().expect("an id"));
                        let kind = target["type"].as_str().unwrap_or_else(|| {
                            panic!("{page}/{row}/{col}: no layer {}", change["elementId"])
                        });
                        assert!(
                            properties(kind)
                                .contains(&change["elementProperty"].as_str().unwrap_or("")),
                            "{page}/{row}/{col}: {change}"
                        );
                    }
                }
            }
        }
    }
}

// The image library: an image of its own for every key and cell, at the
// deck's own size (120 x 120, 200 x 100), each named once and each used.
#[test]
fn every_key_and_cell_has_an_image_of_its_own_at_the_decks_size() {
    let config = profile();
    let library = config["imageLibrary"]
        .as_array()
        .expect("the image library");
    let names: BTreeSet<String> = library
        .iter()
        .map(|image| image["info"]["name"].as_str().expect("a name").to_string())
        .collect();
    assert_eq!(names.len(), library.len(), "each image named once");
    for image in library {
        let name = image["info"]["name"].as_str().expect("a name");
        assert!(
            name.chars()
                .all(|character| character.is_ascii_alphanumeric() || character == '_'),
            "{name}"
        );
        assert!(image["originalImage"]
            .as_str()
            .is_some_and(|data| data.starts_with("data:image/png;base64,iVBOR")));
        assert_eq!(image["info"]["checksum"].as_str().map(str::len), Some(40));
    }
    for image in deck_images() {
        let expected = if image.name.starts_with("cell_") {
            (200, 100)
        } else {
            (120, 120)
        };
        assert_eq!((image.width, image.height), expected, "{}", image.name);
    }

    let text = config["pages"].to_string();
    let marker = "$(image:";
    let used: BTreeSet<String> = text
        .match_indices(marker)
        .map(|(at, _)| {
            let rest = &text[at + marker.len()..];
            rest[..rest.find(')').expect("a closed reference")].to_string()
        })
        .collect();
    assert_eq!(
        used, names,
        "every image is used, and every image used is there"
    );
    // Every picture a key or a cell shows, at rest or in a state, is drawn at
    // its own size: 120 x 120 on a key, 200 x 100 on a cell of the strip.
    let sizes: BTreeMap<String, (u32, u32)> = deck_images()
        .into_iter()
        .map(|image| (image.name, (image.width, image.height)))
        .collect();
    for page in ["1", "2", "3", "4"] {
        for row in 0..3_u8 {
            for col in 0..4_u8 {
                let at = format!("{page}/{row}/{col}");
                let control = control(&config, page, row, col);
                let rest = art(control).unwrap_or_default();
                let (prefix, size) = if row == 2 {
                    ("cell_", (200, 100))
                } else {
                    ("key_", (120, 120))
                };
                assert!(rest.starts_with(prefix), "{at}: {rest}");
                for image in images_of(control) {
                    assert_eq!(sizes.get(&image), Some(&size), "{at}: {image}");
                }
                // A rule swaps the picture of the control's own kind.
                for (_, picture) in swaps(control, "art") {
                    assert!(
                        picture.starts_with(&format!("$(image:{prefix}")),
                        "{at}: {picture}"
                    );
                }
            }
        }
    }
}

// The review of #293: the follow triggers turned the deck to the app's page
// after every silence of 4 s, mid-take, because they read the workspace's
// display line, which goes blank while the link is lost and comes back when
// it is heard again. They read the kept answer, which a silence leaves as it
// was: a follow fires only when the app's page changes.
#[test]
fn a_silence_turns_no_page_of_the_deck() {
    let config = profile();
    assert_eq!(
        kept_workspace(),
        format!("(jsonpath($(custom:{KEPT}), '$.words.workspace') ?? '')")
    );
    let follows: Vec<&Value> = config["triggers"]
        .as_object()
        .expect("triggers")
        .values()
        .filter(|trigger| trigger["events"][0]["type"] == "condition_true")
        .collect();
    // The four deck pages' and the Overview's (D49).
    assert_eq!(follows.len(), 5);
    for follow in follows {
        let condition = follow["condition"][0]["options"]["expression"]["value"]
            .as_str()
            .expect("a condition");
        assert!(condition.starts_with(&kept_workspace()), "{condition}");
        for blanked in [AGE, "$(expression:", "deck_link"] {
            assert!(!condition.contains(blanked), "{condition} reads {blanked}");
        }
    }
    // The display lines do go blank while the link is lost: the follows must
    // not read them.
    assert!(read_variables(&config)
        .iter()
        .all(|name| name != "deck_workspace"));
    let lines = config["expressionVariables"].to_string();
    assert!(lines.contains(&format!(
        "$(custom:{AGE}) >= {LINK_LOST_AFTER_SECONDS} ? ''"
    )));
}

// The review of #293: on a locked Console the hardware link still sends the
// mix target, the dim and the solos, and an AUDIO key kept its amber or
// yellow fill under grey words. Its lock rule comes after its state rules
// and shows the locked form, on the key's face; only the lost link's comes
// after it, which shows the key disabled. Since the deck's look
// (2026-10-03), the forms are pictures: `<key>_locked` (a dashed edge, the
// words in the fourth ink) and `<key>_off`.
#[test]
fn every_audio_key_is_dark_and_grey_while_the_console_is_locked() {
    let config = profile();
    let locked = "$(expression:deck_audio_state_gated) == 'yes'";
    for (row, col) in [(0, 1), (0, 2), (1, 1), (1, 2), (1, 3)] {
        let key = control(&config, "2", row, col);
        let at = format!("2/{row}/{col}");
        let rest = art(key).expect("a picture");
        let picturing: Vec<&Value> = key["feedbacks"]
            .as_array()
            .expect("feedbacks")
            .iter()
            .filter(|feedback| {
                feedback["styleOverrides"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .any(|change| {
                        change["elementId"] == "art" && change["elementProperty"] == "base64Image"
                    })
            })
            .collect();
        assert!(
            picturing.len() >= 3,
            "{at}: a state, the lock and the lost link"
        );
        let [.., lock, lost] = picturing.as_slice() else {
            panic!("{at}: no lock and lost rules");
        };
        assert_eq!(lock["options"]["expression"]["value"], locked, "{at}");
        assert_eq!(
            lost["options"]["expression"]["value"], "$(expression:deck_link) == 'lost'",
            "{at}"
        );
        assert_eq!(
            key["feedbacks"].as_array().and_then(|rules| rules.last()),
            Some(*lost),
            "{at}: the lost link's rule is the last"
        );
        for (rule, form) in [(lock, "locked"), (lost, "off")] {
            let changes = rule["styleOverrides"].as_array().expect("overrides");
            let set = |id: &str, property: &str| {
                changes
                    .iter()
                    .find(|change| {
                        change["elementId"] == id && change["elementProperty"] == property
                    })
                    .map(|change| change["override"]["value"].clone())
            };
            assert_eq!(
                set("art", "base64Image"),
                Some(json!(format!("$(image:{rest}_{form})"))),
                "{at}"
            );
            assert_eq!(set("fill", "color"), Some(json!(DECK_FACE)), "{at}");
            if !layer(key, "value").is_null() {
                assert_eq!(set("value", "color"), Some(json!(DECK_INK_4)), "{at}");
            }
        }
    }
}

// The deck's look (2026-10-03): the pictures draw every fixed word, in the
// brand's faces. What Companion draws as text on a key or a cell is live —
// a display's line, a value worked out from it — never a fixed word over a
// picture that draws the same word; no rule sets a word either (`STOP?`,
// `OFF?` are pictures now). Only the dials (row 3), which the deck never
// draws, keep their names, for Companion's editor.
#[test]
fn no_key_or_cell_draws_a_fixed_word_over_its_picture() {
    let config = profile();
    for page in ["1", "2", "3", "4"] {
        for row in 0..3_u8 {
            for col in 0..4_u8 {
                let at = format!("{page}/{row}/{col}");
                let control = control(&config, page, row, col);
                assert!(art(control).is_some(), "{at}: a picture");
                for layer in control["style"]["layers"].as_array().expect("layers") {
                    if layer["type"] == "text" {
                        assert_eq!(layer["text"]["isExpression"], true, "{at}: {layer}");
                        assert!(
                            layer["text"]["value"]
                                .as_str()
                                .is_some_and(|text| text.contains("$(expression:deck_")),
                            "{at}: {layer}"
                        );
                    }
                }
                assert!(
                    layer(control, "label").is_null(),
                    "{at}: the label is the picture's"
                );
                for feedback in control["feedbacks"].as_array().expect("feedbacks") {
                    for change in feedback["styleOverrides"].as_array().expect("overrides") {
                        assert_ne!(change["elementProperty"], "text", "{at}: {change}");
                    }
                }
            }
        }
        for col in 0..4_u8 {
            let dial = control(&config, page, 3, col);
            assert!(art(dial).is_none() && images_of(dial).is_empty());
        }
    }
    // The review's look items: no ASCII hyphen for a minus (DIM's −20 dB is
    // the picture's), no word Companion draws in place of a picture.
    let pages = config["pages"].to_string();
    for gone in [
        "-20 dB",
        "'ON RIG'",
        "'UNSAVED'",
        "'PHONES 1'",
        "STOP?",
        "OFF?\"",
    ] {
        assert!(!pages.contains(gone), "the pages still draw {gone}");
    }
}

// The deck's palette is the screen's (docs/DESIGN.md §4): every colour of
// every layer and every rule is one of its tokens (a text's outline is
// none). Today's khaki, amber, ember, the bank's brown tint and the white
// are gone.
#[test]
fn every_colour_of_the_profile_is_the_screens_palette() {
    fn colours<'a>(value: &'a Value, path: &str, into: &mut Vec<(String, &'a Value)>) {
        match value {
            Value::Object(map) => {
                for (key, child) in map {
                    let at = format!("{path}/{key}");
                    if ["color", "borderColor", "outlineColor", "markerColor"]
                        .contains(&key.as_str())
                    {
                        into.push((at.clone(), child));
                    }
                    if key == "styleOverrides" {
                        for change in child.as_array().into_iter().flatten() {
                            if ["color", "borderColor"]
                                .contains(&change["elementProperty"].as_str().unwrap_or(""))
                            {
                                into.push((format!("{at}/override"), &change["override"]));
                            }
                        }
                    }
                    colours(child, &at, into);
                }
            }
            Value::Array(items) => {
                for (index, item) in items.iter().enumerate() {
                    colours(item, &format!("{path}/{index}"), into);
                }
            }
            _ => {}
        }
    }
    let config = profile();
    let mut found = Vec::new();
    colours(&config["pages"], "", &mut found);
    assert!(found.len() > 300, "{}", found.len());
    let palette: BTreeSet<u64> = DECK_PALETTE
        .iter()
        .map(|(_, colour)| u64::from(*colour))
        .collect();
    let mut used = BTreeSet::new();
    for (at, colour) in found {
        assert_eq!(colour["isExpression"], false, "{at}");
        let value = colour["value"]
            .as_u64()
            .unwrap_or_else(|| panic!("{at}: {colour}"));
        if at.ends_with("/outlineColor") {
            // Companion keeps a colour's alpha inverted: no outline.
            assert_eq!(value, 0xFF00_0000, "{at}");
            continue;
        }
        assert!(
            palette.contains(&value),
            "{at}: #{value:06X} is not the screen's"
        );
        used.insert(value);
    }
    for (name, colour) in [
        ("face", DECK_FACE),
        ("ink-4", DECK_INK_4),
        ("yellow", 0x00F2_DE6F),
        ("burgundy", 0x0067_1919),
        ("dark-green", 0x0000_4932),
    ] {
        assert!(
            used.contains(&u64::from(colour)),
            "the deck no longer uses {name}"
        );
    }
}

// The deck's look changes nothing the bridge reads or says (2026-10-03):
// the profile reads the same 48 display lines as before it, and `deck_link`.
#[test]
fn the_look_reads_the_displays_it_read_before() {
    let config = profile();
    let mut expected: BTreeSet<String> = [
        "light_nav",
        "light_nav_head",
        "light_intensity",
        "light_cct",
        "scene_nav",
        "scene_nav_head",
        "light_key_off",
        "scene_state",
        "audio_state_target",
        "audio_state_bank",
        "audio_state_dim",
        "audio_state_solo",
        "audio_state_gated",
        "camera_key_1",
        "camera_key_2",
        "camera_key_3",
        "camera_key_bank",
        "camera_key_rec",
        "camera_state_selected",
        "camera_state_rec",
        "camera_state_dials",
        "prompter_speed",
        "prompter_line",
        "prompter_place",
        "prompter_size",
        "prompter_left",
        "prompter_state_play",
        "prompter_state_on",
        "link",
    ]
    .iter()
    .map(|name| format!("deck_{name}"))
    .collect();
    for strip in 1..=4 {
        for name in [
            format!("audio_strip_{strip}"),
            format!("audio_strip_{strip}_head"),
            format!("audio_strip_{strip}_level"),
            format!("camera_strip_{strip}"),
            format!("camera_strip_{strip}_head"),
        ] {
            expected.insert(format!("deck_{name}"));
        }
    }
    assert_eq!(expected.len(), 49);
    assert_eq!(read_variables(&config), expected);
    assert_eq!(
        config["expressionVariables"]
            .as_object()
            .map(|variables| variables.len()),
        Some(49)
    );
}

// The bridge's worst instant (2026-10-03): the poll is one read of every
// display, and a press its action and that read again.
#[test]
fn the_decks_worst_instant_is_three_requests() {
    let worst = super::deck_worst_instant_requests();
    assert_eq!(
        (worst.poll, worst.follow, worst.press, worst.total()),
        (1, 0, 2, 3)
    );
}

// Nothing of Planning is left on the deck: no PROJECTS or TASKS page, no
// key on the Planning route (`/api/deck/action`), no deck-mode key (a
// Planning setting), no project, task or sort display, no Planning follow.
#[test]
fn the_deck_profile_and_page_model_carry_no_planning() {
    let profile = profile().to_string().to_lowercase();
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

#[test]
fn control_surface_snapshot_matches_the_deck_page_model() {
    let snapshot = build_control_surface_snapshot();
    // D5: LIGHTS is page 1, AUDIO page 2, CAMERAS page 3, PROMPTER page 4.
    assert_eq!(
        snapshot
            .pages
            .iter()
            .map(|page| (page.id.as_str(), page.label.as_str()))
            .collect::<Vec<_>>(),
        [
            ("lights", "LIGHTS"),
            ("audio", "AUDIO"),
            ("cameras", "CAMERAS"),
            ("prompter", "PROMPTER"),
        ]
    );
    // The approved layout: the keys at their places (a dark key is none),
    // and the four cells of the strip, 9 to 12.
    let places = |index: usize| {
        snapshot.pages[index]
            .buttons
            .iter()
            .map(|control| control.position)
            .collect::<Vec<_>>()
    };
    assert_eq!(places(0), [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12]);
    assert_eq!(places(1), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    assert_eq!(places(2), [1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    assert_eq!(places(3), [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12]);
    let words = |index: usize| {
        snapshot.pages[index]
            .buttons
            .iter()
            .map(|control| control.label.as_str())
            .collect::<Vec<_>>()
    };
    assert_eq!(
        words(0),
        [
            "REC",
            "ALL ON",
            "SAVE",
            "AUDIO \u{203a}",
            "PLAY",
            "ALL OFF",
            "RECALL",
            "LIGHT",
            "INTENSITY",
            "CCT",
            "SCENE"
        ]
    );
    assert_eq!(
        words(1)[..8],
        [
            "REC",
            "MAIN OUT",
            "PHONES",
            "CAMERAS \u{203a}",
            "PLAY",
            "BANK",
            "DIM",
            "SOLO"
        ]
    );
    assert_eq!(
        words(2),
        [
            "REC",
            "BANK",
            "PROMPTER \u{203a}",
            "PLAY",
            "CAM 1",
            "CAM 2",
            "CAM 3",
            "DIAL 1",
            "DIAL 2",
            "DIAL 3",
            "DIAL 4"
        ]
    );
    assert_eq!(
        words(3),
        [
            "REC",
            "\u{25c2} CUE",
            "CUE \u{25b8}",
            "LIGHTS \u{203a}",
            "PLAY",
            "BACK",
            "TOP",
            "SPEED",
            "LINE",
            "PARAGRAPH",
            "SIZE"
        ]
    );
    for page in &snapshot.pages {
        assert_eq!(page.dials.len(), 12, "{}", page.label);
        // The strip only shows; every key is pressed.
        for control in &page.buttons {
            assert_eq!(
                control.control_type,
                if control.position > 8 {
                    "display"
                } else {
                    "button"
                },
                "{}",
                control.id
            );
        }
        let page_key = page
            .buttons
            .iter()
            .find(|control| control.position == 4)
            .expect("the page key");
        assert_eq!(page_key.is_page_nav, Some(true));
        assert_eq!(page_key.method, None, "a page key posts nothing");
    }
    assert_eq!(
        snapshot
            .pages
            .iter()
            .map(|page| page.buttons.iter().chain(&page.dials).count())
            .sum::<usize>(),
        93
    );
    assert_eq!(
        snapshot
            .pages
            .iter()
            .map(|page| {
                page.buttons
                    .iter()
                    .find(|control| control.position == 4)
                    .and_then(|control| control.page_nav_target.clone())
                    .unwrap_or_default()
            })
            .collect::<Vec<_>>(),
        ["AUDIO", "CAMERAS", "PROMPTER", "LIGHTS"]
    );
}

// Setup draws every page from the page model: each control says what it
// does in the operator's words.
#[test]
fn the_page_model_says_what_each_control_does() {
    let snapshot = build_control_surface_snapshot();
    for page in &snapshot.pages {
        for control in page.buttons.iter().chain(&page.dials) {
            assert!(
                control.description.ends_with('.')
                    && control
                        .description
                        .chars()
                        .next()
                        .is_some_and(char::is_uppercase),
                "{}: {:?}",
                control.id,
                control.description
            );
            assert!(!control.description.starts_with("Send "), "{}", control.id);
        }
    }
    let by_id = |page: usize, id: &str| {
        snapshot.pages[page]
            .buttons
            .iter()
            .chain(&snapshot.pages[page].dials)
            .find(|control| control.id == id)
            .unwrap_or_else(|| panic!("{id}"))
            .clone()
    };
    assert_eq!(
        by_id(0, "lights-btn-8").description,
        "Recall the selected lighting scene, with the Lighting page's Fade."
    );
    assert_eq!(
        by_id(0, "lights-btn-4").description,
        "Turn the deck to the AUDIO page."
    );
    assert_eq!(
        by_id(0, "lights-btn-9").description,
        "Shows the light the dials set, and its place among the lights."
    );
    assert_eq!(
        by_id(0, "lights-dial-4-left").description,
        "Select the previous scene."
    );
    assert_eq!(
        ["audio-btn-2", "audio-btn-3"].map(|id| by_id(1, id).description),
        [
            "Make Main Out the active mix target.",
            "Make the next phones mix the active mix target: Phones 1, then Phones 2."
        ]
    );
    assert_eq!(
        by_id(2, "cameras-btn-1").description,
        "Start recording on CAM 1. While it records: arm the stop, then stop."
    );
    assert_eq!(by_id(2, "cameras-dial-2-left").label, "Dial 2 Down");
    assert_eq!(
        by_id(2, "cameras-dial-2-left").description,
        "Step shutter or tint down on the selected camera, as the bank says."
    );
    assert_eq!(
        by_id(3, "prompter-btn-5").description,
        "Play or pause the prompter."
    );
    assert_eq!(
        by_id(3, "prompter-dial-2-press").description,
        "A push of the LINE dial does nothing."
    );
    assert_eq!(by_id(3, "prompter-dial-3-right").label, "Next Paragraph");
    assert_eq!(by_id(3, "prompter-dial-4-right").label, "Size Up");
}

/// The pages' test double draws the deck's pages from a file, so that Setup
/// shows in development the keys, the words and the descriptions it shows in
/// the studio. The file is the page model itself, and this test holds it so:
/// a key, a label or a description that changes here is written to the file
/// (`SSE_WRITE_DECK_PAGES=1`, this test alone, then Prettier on the file).
#[test]
fn the_doubles_deck_pages_are_the_page_model() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../frontend/packages/engine-client/src/transports/fixture/deckPages.json");
    let model = serde_json::to_value(build_control_surface_snapshot()).expect("page model");
    if std::env::var_os("SSE_WRITE_DECK_PAGES").is_some() {
        let text = serde_json::to_string_pretty(&model).expect("page model");
        std::fs::write(&path, text).expect("deckPages.json is written");
    }
    let file: Value = serde_json::from_str(
        &std::fs::read_to_string(&path).expect("deckPages.json is beside the double"),
    )
    .expect("deckPages.json is JSON");
    assert!(
        file == model,
        "deckPages.json is not the page model. Write it again: SSE_WRITE_DECK_PAGES=1 cargo test -p studio-control-engine --bins the_doubles_deck_pages_are_the_page_model, then npx prettier --write on the file."
    );
}
