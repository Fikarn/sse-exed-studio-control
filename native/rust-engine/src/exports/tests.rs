use super::audio::AUDIO_LCD_KEYS;
use super::controls::{DECK_AMBER_BG, DECK_MUTED_INK};
use super::controls::{DECK_GREY_INK, DECK_HAZARD_INK, DECK_LIVE_BG};
use super::lights::LIGHT_LCD_KEYS;
use super::profile::{
    generate_companion_config, polled_lcd_keys, streamdeck_surface_id_from,
    COMPANION_EXPORT_FORMAT_VERSION, INSTANCE_ID, INSTANCE_LABEL,
};
use super::snapshot::build_control_surface_snapshot;
use crate::cameras::deck::CAMERA_LCD_KEYS;
use crate::prompter::deck::PROMPTER_LCD_KEYS;
use serde_json::{json, Value};
use std::collections::BTreeSet;

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
    // D5: LIGHTS, AUDIO, CAMERAS and PROMPTER.
    assert_eq!(
        config["pages"].as_object().map(|pages| pages.len()),
        Some(4)
    );
    for (number, id) in [
        ("1", "sse-page-lights"),
        ("2", "sse-page-audio"),
        ("3", "sse-page-cameras"),
        ("4", "sse-page-prompter"),
    ] {
        assert_eq!(config["pages"][number]["id"], id);
    }
    assert!(config.get("surfaces").is_none());

    let custom_variables = config["custom_variables"]
        .as_object()
        .expect("custom variables should exist");
    assert_eq!(
        custom_variables.len(),
        AUDIO_LCD_KEYS.len()
            + LIGHT_LCD_KEYS.len()
            + CAMERA_LCD_KEYS.len()
            + PROMPTER_LCD_KEYS.len()
    );
    assert_eq!(custom_variables.len(), 45);
    assert!(custom_variables.contains_key("lcd_camera_key_rec"));
    assert!(custom_variables.contains_key("lcd_prompter_state_play"));
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

    // Row 1, column 2 held TALK until 2026-09-28 (D26); the page key of
    // the ring stands there now.
    for (row, columns) in [("0", 4), ("1", 4), ("2", 4), ("3", 4)] {
        assert_eq!(
            controls[row].as_object().map(|columns| columns.len()),
            Some(columns),
            "audio row {row}"
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

    // Row 1, column 2 held TALK until 2026-09-28 (D26). The ring's page
    // key is there, and every other key is where it was.
    let page_key = &controls["1"]["2"];
    assert_eq!(page_key["style"]["text"], "CAMS\\n>>");
    let jump = &page_key["steps"]["0"]["action_sets"]["down"][0];
    assert_eq!(jump["definitionId"], "set_page");
    assert_eq!(jump["options"]["page"], 3);
    assert_eq!(
        page_key["steps"]["0"]["action_sets"]["down"]
            .as_array()
            .map(Vec::len),
        Some(1),
        "a page key posts nothing"
    );
    for (row, col, text) in [
        ("0", "0", "MAIN"),
        ("0", "1", "PH\\n1"),
        ("0", "2", "PH\\n2"),
        ("0", "3", "$(custom:lcd_audio_key_4)"),
        ("1", "0", "$(custom:lcd_audio_key_5)"),
        ("1", "1", "$(custom:lcd_audio_key_6)"),
        ("1", "3", "$(custom:lcd_audio_key_8)"),
    ] {
        assert_eq!(controls[row][col]["style"]["text"], text, "{row}/{col}");
    }
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
    // The poll, and a follow trigger for each of the deck's four pages.
    assert_eq!(triggers.len(), 5);

    let poll = &triggers["sse-trigger-lcd-poll"];
    assert_eq!(poll["options"]["enabled"], true);
    assert_eq!(poll["events"][0]["type"], "interval");
    assert_eq!(poll["events"][0]["options"]["seconds"], 1);
    assert_eq!(
        poll["actions"].as_array().map(Vec::len),
        Some(polled_lcd_keys().len())
    );
    assert_eq!(polled_lcd_keys().len(), 41);

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
        "audio page should model 7 keys, the page key and 4 touch-strip cells"
    );
    let cameras_key = audio
        .buttons
        .iter()
        .find(|control| control.position == 7)
        .expect("the page key stands at position 7");
    assert_eq!(cameras_key.label, "CAMS >>");
    assert_eq!(cameras_key.page_nav_target.as_deref(), Some("CAMERAS"));
    assert_eq!(cameras_key.method, None, "a page key posts nothing");
    assert_eq!(audio.dials.len(), 12);
    assert!(audio.buttons.iter().any(|control| control
        .body
        .as_ref()
        .is_some_and(|body| body.get("action").and_then(Value::as_str) == Some("setMixTarget"))));
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

// D5: LIGHTS, AUDIO, CAMERAS and PROMPTER, chained by the page keys and by
// the deck following the app. The page keys make a ring: each page has one,
// to the page after it, and PROMPTER's goes round to LIGHTS. Setup has no
// deck page, so nothing follows it and the deck stays where it is.
#[test]
fn the_page_keys_and_follow_triggers_chain_the_four_pages() {
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
        vec![
            (1, String::from("LIGHTS")),
            (2, String::from("AUDIO")),
            (3, String::from("CAMERAS")),
            (4, String::from("PROMPTER")),
        ]
    );

    let mut all_jumps = Vec::new();
    page_jumps(&profile, &mut all_jumps);
    assert!(
        all_jumps.iter().all(|page| (1..=4).contains(page)),
        "every jump lands on a page the profile has: {all_jumps:?}"
    );

    // One page key a page, to the page after it; the last to the first.
    for (page, next, place) in [
        ("1", 2, ("1", "3")),
        ("2", 3, ("1", "2")),
        ("3", 4, ("1", "3")),
        ("4", 1, ("1", "3")),
    ] {
        let mut jumps = Vec::new();
        page_jumps(&pages[page], &mut jumps);
        assert_eq!(jumps, vec![next], "page {page}'s one page key");
        let mut at_its_place = Vec::new();
        page_jumps(
            &pages[page]["controls"][place.0][place.1],
            &mut at_its_place,
        );
        assert_eq!(
            at_its_place,
            vec![next],
            "page {page}'s page key stands at {place:?}"
        );
    }
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
            (String::from("cameras"), vec![3]),
            (String::from("lighting"), vec![1]),
            // The page's word in the app is the one the hardware link
            // accepts (`shell_settings::WORKSPACES`).
            (String::from("teleprompter"), vec![4]),
        ]
    );
    for follow in follows.iter().map(|(workspace, _)| workspace.as_str()) {
        assert!(
            crate::shell_settings::WORKSPACES.contains(&follow),
            "{follow} is a page the app can be on"
        );
    }

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

// ---------------------------------------------------------------------------
// The CAMERAS and PROMPTER pages (D14; `docs/design/teleprompter.md` §9)
// ---------------------------------------------------------------------------

/// The body a control's first action posts, with its route.
fn posted(control: &Value, set: &str) -> Option<(String, Value)> {
    let action = control["steps"]["0"]["action_sets"][set].get(0)?;
    if action["definitionId"] != "post" {
        return None;
    }
    let body = serde_json::from_str(action["options"]["body"].as_str()?).ok()?;
    Some((action["options"]["url"].as_str()?.to_string(), body))
}

#[test]
fn the_cameras_page_is_three_cameras_the_bank_and_rec() {
    let profile = test_profile();
    let controls = &profile["pages"]["3"]["controls"];
    assert_eq!(profile["pages"]["3"]["name"], "CAMERAS");

    for (col, camera) in [("0", "1"), ("1", "2"), ("2", "3")] {
        let key = &controls["0"][col];
        assert_eq!(
            key["style"]["text"],
            format!("$(custom:lcd_camera_key_{camera})")
        );
        assert_eq!(
            posted(key, "down"),
            Some((
                String::from("/api/deck/camera-action"),
                json!({ "action": "select", "value": camera })
            ))
        );
        // Amber is selected, and it is the page's selection.
        let selected = &key["feedbacks"][0];
        assert_eq!(
            selected["options"]["variable"],
            "custom:lcd_camera_state_selected"
        );
        assert_eq!(selected["options"]["value"], camera);
        assert_eq!(selected["style"]["bgcolor"], DECK_AMBER_BG);
    }
    assert_eq!(
        posted(&controls["0"]["3"], "down").map(|(_, body)| body),
        Some(json!({ "action": "bank" }))
    );

    // `REC`: a red lamp and the word on a dark key, never a red fill (D19).
    let rec = &controls["1"]["0"];
    assert_eq!(rec["style"]["text"], "$(custom:lcd_camera_key_rec)");
    assert_eq!(rec["style"]["bgcolor"], 0);
    assert_eq!(
        posted(rec, "down").map(|(_, body)| body),
        Some(json!({ "action": "rec" }))
    );
    let recording = rec["feedbacks"]
        .as_array()
        .expect("feedbacks")
        .iter()
        .find(|feedback| feedback["options"]["value"] == "recording")
        .expect("the recording feedback");
    assert_eq!(recording["style"]["color"], DECK_HAZARD_INK);
    assert!(recording["style"].get("bgcolor").is_none(), "{recording}");
    assert!(recording["style"]["png64"]
        .as_str()
        .is_some_and(|png| png.starts_with("iVBOR")));
    for (value, ink) in [("locked", DECK_GREY_INK), ("last-known", DECK_AMBER_BG)] {
        assert!(
            rec["feedbacks"]
                .as_array()
                .expect("feedbacks")
                .iter()
                .any(|feedback| feedback["options"]["value"] == value
                    && feedback["style"]["color"] == ink),
            "{value}"
        );
    }

    // Rows 1's other places stay dark, but the page key.
    assert!(controls["1"].get("1").is_none());
    assert!(controls["1"].get("2").is_none());
    assert_eq!(controls["1"]["3"]["style"]["text"], "PROMPTER\\n>>");

    for (col, dial) in [("0", "1"), ("1", "2"), ("2", "3"), ("3", "4")] {
        let cell = &controls["2"][col];
        assert_eq!(
            cell["style"]["text"],
            format!("$(custom:lcd_camera_strip_{dial})")
        );
        assert_eq!(
            cell["steps"]["0"]["action_sets"]["down"],
            json!([]),
            "a strip cell only shows"
        );
        let encoder = &controls["3"][col];
        assert_eq!(encoder["options"]["rotaryActions"], true);
        assert_eq!(
            posted(encoder, "rotate_left").map(|(_, body)| body),
            Some(json!({ "action": "dial", "value": format!("{dial}:down") }))
        );
        assert_eq!(
            posted(encoder, "rotate_right").map(|(_, body)| body),
            Some(json!({ "action": "dial", "value": format!("{dial}:up") }))
        );
        assert_eq!(
            posted(encoder, "down").map(|(_, body)| body),
            Some(json!({ "action": "dialPush", "value": dial }))
        );
    }
}

#[test]
fn the_prompter_page_is_the_takes_keys_and_four_dials() {
    let profile = test_profile();
    let controls = &profile["pages"]["4"]["controls"];
    assert_eq!(profile["pages"]["4"]["name"], "PROMPTER");

    let keys: [(&str, &str, &str, Value); 5] = [
        ("0", "0", "PLAY", json!({ "action": "playPause" })),
        ("0", "1", "BACK", json!({ "action": "back" })),
        ("0", "2", "TOP", json!({ "action": "top" })),
        (
            "1",
            "0",
            "CUE\\n<",
            json!({ "action": "cue", "value": "previous" }),
        ),
        (
            "1",
            "1",
            "CUE\\n>",
            json!({ "action": "cue", "value": "next" }),
        ),
    ];
    for (row, col, text, body) in keys {
        let key = &controls[row][col];
        assert_eq!(key["style"]["text"], text, "{row}/{col}");
        assert_eq!(
            posted(key, "down"),
            Some((String::from("/api/deck/prompter-action"), body)),
            "{text}"
        );
    }
    // The other keys stay dark (§9), but the page key, which goes round.
    assert!(controls["0"].get("3").is_none());
    assert!(controls["1"].get("2").is_none());
    assert_eq!(controls["1"]["3"]["style"]["text"], "LIGHTS\\n>>");

    // `PLAY` is lit green while the text scrolls, and grey while it cannot
    // be pressed.
    let play = controls["0"]["0"]["feedbacks"]
        .as_array()
        .expect("feedbacks");
    assert!(play.iter().any(|feedback| {
        feedback["options"]["variable"] == "custom:lcd_prompter_state_play"
            && feedback["options"]["value"] == "playing"
            && feedback["style"]["bgcolor"] == DECK_LIVE_BG
    }));
    assert!(play.iter().any(|feedback| {
        feedback["options"]["value"] == "locked" && feedback["style"]["color"] == DECK_GREY_INK
    }));

    let dials: [(&str, Option<Value>, Value, Value); 4] = [
        (
            "0",
            Some(json!({ "action": "playPause" })),
            json!({ "action": "speed", "value": "down" }),
            json!({ "action": "speed", "value": "up" }),
        ),
        (
            "1",
            None,
            json!({ "action": "line", "value": "previous" }),
            json!({ "action": "line", "value": "next" }),
        ),
        (
            "2",
            Some(json!({ "action": "size", "value": "standard" })),
            json!({ "action": "size", "value": "down" }),
            json!({ "action": "size", "value": "up" }),
        ),
        (
            "3",
            None,
            json!({ "action": "paragraph", "value": "previous" }),
            json!({ "action": "paragraph", "value": "next" }),
        ),
    ];
    for (col, push, left, right) in dials {
        let encoder = &controls["3"][col];
        assert_eq!(posted(encoder, "down").map(|(_, body)| body), push, "{col}");
        assert_eq!(
            posted(encoder, "rotate_left").map(|(_, body)| body),
            Some(left)
        );
        assert_eq!(
            posted(encoder, "rotate_right").map(|(_, body)| body),
            Some(right)
        );
    }
    for (col, key) in [
        ("0", "prompter_speed"),
        ("1", "prompter_place"),
        ("2", "prompter_left"),
        ("3", "prompter_name"),
    ] {
        assert_eq!(
            controls["2"][col]["style"]["text"],
            format!("$(custom:lcd_{key})")
        );
    }
}

// Setup draws every page from the page model: each control says what it
// does in the operator's words, and none falls back to the words of a
// control nobody described. (Until the CAMERAS and PROMPTER pages the scene
// dial's turns read `left Scene.` and `right Scene.`, and a mix target's key
// `Make phones a the active mix target.`.)
#[test]
fn the_page_model_says_what_the_new_pages_controls_do() {
    let snapshot = build_control_surface_snapshot();
    let cameras = &snapshot.pages[2];
    let prompter = &snapshot.pages[3];
    for page in [cameras, prompter] {
        assert_eq!(
            page.buttons.len(),
            10,
            "{}: 6 keys and 4 strip cells",
            page.label
        );
        assert_eq!(page.dials.len(), 12, "{}", page.label);
        // The strip's cells only show; every other key is pressed.
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
            assert_eq!(
                control.position > 8,
                control.url.is_none() && control.is_page_nav.is_none()
            );
        }
    }
    for page in &snapshot.pages[..2] {
        for control in &page.buttons {
            assert_eq!(control.control_type, "button", "{}", control.id);
        }
    }
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
            for fallback in ["button ", "press ", "left ", "right "] {
                assert!(
                    !control.description.starts_with(fallback),
                    "{}: {:?}",
                    control.id,
                    control.description
                );
            }
        }
    }
    let by_id = |page: &super::snapshot::ControlSurfacePage, id: &str| {
        page.buttons
            .iter()
            .chain(&page.dials)
            .find(|control| control.id == id)
            .unwrap_or_else(|| panic!("{id}"))
            .clone()
    };
    assert_eq!(
        by_id(&snapshot.pages[0], "lights-dial-4-left").description,
        "Select the previous scene."
    );
    assert_eq!(
        by_id(&snapshot.pages[0], "lights-dial-4-right").description,
        "Select the next scene."
    );
    assert_eq!(
        ["audio-btn-1", "audio-btn-2", "audio-btn-3"]
            .map(|id| by_id(&snapshot.pages[1], id).description),
        [
            "Make Main Out the active mix target.",
            "Make Phones 1 the active mix target.",
            "Make Phones 2 the active mix target."
        ]
    );
    assert_eq!(
        by_id(cameras, "cameras-btn-5").description,
        "Start recording on CAM 1. While it records: arm the stop, then stop."
    );
    assert_eq!(
        by_id(cameras, "cameras-btn-5").lcd_key.as_deref(),
        Some("camera_key_rec")
    );
    assert_eq!(
        by_id(cameras, "cameras-dial-2-left").description,
        "Step shutter or tint down on the selected camera, as the bank says."
    );
    assert_eq!(by_id(cameras, "cameras-dial-2-left").label, "Dial 2 Down");
    assert_eq!(
        by_id(cameras, "cameras-dial-3-press").description,
        "A push of dial 3 does nothing."
    );
    assert_eq!(
        by_id(cameras, "cameras-btn-9").description,
        "Shows what dial 1 sets."
    );
    assert_eq!(
        by_id(prompter, "prompter-btn-1").description,
        "Play or pause the prompter."
    );
    assert_eq!(
        by_id(prompter, "prompter-dial-2-press").description,
        "A push of Position does nothing."
    );
    assert_eq!(by_id(prompter, "prompter-dial-1-right").label, "Speed Up");
    assert_eq!(
        by_id(prompter, "prompter-btn-8").page_nav_target.as_deref(),
        Some("LIGHTS")
    );
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
