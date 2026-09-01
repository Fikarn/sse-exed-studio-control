use crate::exports::{
    audio_action_with_refreshes, button, dial, expression_button, momentary_button, next_action_id,
    ControlDef,
};
use serde_json::{json, Map, Value};

// Every key the 1 s poll refreshes; each needs a matching custom variable.
// Keys 1-3 carry static labels (state reads through feedbacks), so they are
// not polled.
pub(crate) const AUDIO_LCD_KEYS: &[&str] = &[
    "audio_strip_1",
    "audio_strip_2",
    "audio_strip_3",
    "audio_strip_4",
    "audio_strip_1_state",
    "audio_strip_2_state",
    "audio_strip_3_state",
    "audio_strip_4_state",
    "audio_strip_1_level",
    "audio_strip_2_level",
    "audio_strip_3_level",
    "audio_strip_4_level",
    "audio_key_4",
    "audio_key_5",
    "audio_key_6",
    "audio_key_7",
    "audio_key_8",
    "audio_state_target",
    "audio_state_bank",
    "audio_state_mode",
    "audio_state_dim",
    "audio_state_talk",
    "audio_state_solo",
    "audio_state_gated",
    "workspace",
];

pub(crate) const LEGACY_LCD_KEYS: &[&str] = &[
    "project_nav",
    "project_status",
    "project_priority",
    "sort_mode",
    "task_nav",
    "light_nav",
    "light_intensity",
    "light_cct",
    "scene_nav",
];

pub(crate) const AUDIO_STRIP_TEXT_KEYS: &[&str] = &[
    "audio_strip_1",
    "audio_strip_2",
    "audio_strip_3",
    "audio_strip_4",
];
const AUDIO_STRIP_STATE_KEYS: &[&str] = &[
    "audio_strip_1_state",
    "audio_strip_2_state",
    "audio_strip_3_state",
    "audio_strip_4_state",
];
const AUDIO_STRIP_LEVEL_KEYS: &[&str] = &[
    "audio_strip_1_level",
    "audio_strip_2_level",
    "audio_strip_3_level",
    "audio_strip_4_level",
];

// Deck palette: the app's Console vocabulary, mirrored on the hardware.
pub(crate) const DECK_AMBER_BG: u32 = 0x00E8_B13D;
pub(crate) const DECK_AMBER_INK: u32 = 0x0024_1D0B;
pub(crate) const DECK_WARN_BG: u32 = 0x00FF_D33D;
pub(crate) const DECK_WARN_INK: u32 = 0x002A_2206;
pub(crate) const DECK_TALK_BG: u32 = 0x003F_7F48;
pub(crate) const DECK_TALK_INK: u32 = 0x00EA_FBE9;
pub(crate) const DECK_SELECT_BG: u32 = 0x0024_1C08;
pub(crate) const DECK_SELECT_INK: u32 = 0x00E8_B13D;
pub(crate) const DECK_MUTED_BG: u32 = 0x001A_0F0C;
pub(crate) const DECK_MUTED_INK: u32 = 0x00E0_7A63;
pub(crate) const DECK_GREY_INK: u32 = 0x006D_675A;
pub(crate) const DECK_BANK_TINT_BG: u32 = 0x004A_3A12;

// Base64 PNG assets rendered by scripts/deck-assets.py and checked in under
// native/rust-engine/assets/deck/.
pub(crate) fn deck_asset(name: &str) -> &'static str {
    let encoded = match name {
        "bar_f0" => include_str!("../assets/deck/bar_f0.b64"),
        "bar_f1" => include_str!("../assets/deck/bar_f1.b64"),
        "bar_f2" => include_str!("../assets/deck/bar_f2.b64"),
        "bar_f3" => include_str!("../assets/deck/bar_f3.b64"),
        "bar_f4" => include_str!("../assets/deck/bar_f4.b64"),
        "bar_f5" => include_str!("../assets/deck/bar_f5.b64"),
        "bar_f6" => include_str!("../assets/deck/bar_f6.b64"),
        "bar_f7" => include_str!("../assets/deck/bar_f7.b64"),
        "bar_f8" => include_str!("../assets/deck/bar_f8.b64"),
        "bar_f9" => include_str!("../assets/deck/bar_f9.b64"),
        "bar_f10" => include_str!("../assets/deck/bar_f10.b64"),
        "bar_f11" => include_str!("../assets/deck/bar_f11.b64"),
        "bar_f12" => include_str!("../assets/deck/bar_f12.b64"),
        "bar_m0" => include_str!("../assets/deck/bar_m0.b64"),
        "bar_m1" => include_str!("../assets/deck/bar_m1.b64"),
        "bar_m2" => include_str!("../assets/deck/bar_m2.b64"),
        "bar_m3" => include_str!("../assets/deck/bar_m3.b64"),
        "bar_m4" => include_str!("../assets/deck/bar_m4.b64"),
        "bar_m5" => include_str!("../assets/deck/bar_m5.b64"),
        "bar_m6" => include_str!("../assets/deck/bar_m6.b64"),
        "bar_m7" => include_str!("../assets/deck/bar_m7.b64"),
        "bar_m8" => include_str!("../assets/deck/bar_m8.b64"),
        "bar_m9" => include_str!("../assets/deck/bar_m9.b64"),
        "bar_m10" => include_str!("../assets/deck/bar_m10.b64"),
        "bar_m11" => include_str!("../assets/deck/bar_m11.b64"),
        "bar_m12" => include_str!("../assets/deck/bar_m12.b64"),
        "strip_off" => include_str!("../assets/deck/strip_off.b64"),
        "strip_empty" => include_str!("../assets/deck/strip_empty.b64"),
        "ico_main" => include_str!("../assets/deck/ico_main.b64"),
        "ico_phones" => include_str!("../assets/deck/ico_phones.b64"),
        "ico_bank" => include_str!("../assets/deck/ico_bank.b64"),
        "ico_dim" => include_str!("../assets/deck/ico_dim.b64"),
        "ico_talk" => include_str!("../assets/deck/ico_talk.b64"),
        "ico_solo" => include_str!("../assets/deck/ico_solo.b64"),
        "ico_gain" => include_str!("../assets/deck/ico_gain.b64"),
        _ => "",
    };
    encoded.trim_end()
}

fn state_feedback(variable_key: &str, value: &str, inverted: bool, style: Value) -> Value {
    json!({
        "id": next_action_id(),
        "definitionId": "variable_value",
        "connectionId": "internal",
        "options": {
            "variable": format!("custom:lcd_{variable_key}"),
            "op": "eq",
            "value": value
        },
        "type": "feedback",
        "isInverted": inverted,
        "children": {},
        "style": style
    })
}

fn color_feedback(variable_key: &str, value: &str, color: u32, bgcolor: u32) -> Value {
    state_feedback(
        variable_key,
        value,
        false,
        json!({ "color": color, "bgcolor": bgcolor }),
    )
}

fn png_feedback(variable_key: &str, value: &str, asset: &str) -> Value {
    state_feedback(
        variable_key,
        value,
        false,
        json!({ "png64": deck_asset(asset) }),
    )
}

fn audio_strip_feedbacks(strip: usize) -> Vec<Value> {
    let level_key = AUDIO_STRIP_LEVEL_KEYS[strip - 1];
    let state_key = AUDIO_STRIP_STATE_KEYS[strip - 1];
    let mut feedbacks = Vec::new();
    for bucket in 0..=12 {
        feedbacks.push(png_feedback(
            level_key,
            &bucket.to_string(),
            &format!("bar_f{bucket}"),
        ));
        feedbacks.push(png_feedback(
            level_key,
            &format!("m{bucket}"),
            &format!("bar_m{bucket}"),
        ));
    }
    feedbacks.push(png_feedback(level_key, "off", "strip_off"));
    feedbacks.push(png_feedback(level_key, "empty", "strip_empty"));
    feedbacks.push(color_feedback(
        state_key,
        "selected",
        DECK_SELECT_INK,
        DECK_SELECT_BG,
    ));
    feedbacks.push(color_feedback(
        state_key,
        "muted",
        DECK_MUTED_INK,
        DECK_MUTED_BG,
    ));
    feedbacks.push(state_feedback(
        state_key,
        "offline",
        false,
        json!({ "color": DECK_GREY_INK }),
    ));
    feedbacks
}

fn gated_grey_feedback() -> Value {
    state_feedback(
        "audio_state_gated",
        "yes",
        false,
        json!({ "color": DECK_GREY_INK }),
    )
}

// generic-http's jsonResultDataVariable stores into a pre-existing CUSTOM
// variable (referenced as $(custom:name)); a missing variable makes the store a
// silent no-op, so the profile must ship every LCD variable it polls into.
pub(crate) fn generate_companion_custom_variables() -> Value {
    let mut variables = Map::new();
    for (sort_order, key) in AUDIO_LCD_KEYS
        .iter()
        .chain(LEGACY_LCD_KEYS.iter())
        .enumerate()
    {
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

fn audio_strip_refresh_keys() -> Vec<&'static str> {
    AUDIO_STRIP_TEXT_KEYS
        .iter()
        .chain(AUDIO_STRIP_STATE_KEYS.iter())
        .chain(AUDIO_STRIP_LEVEL_KEYS.iter())
        .copied()
        .collect()
}

fn audio_target_key(
    col: &'static str,
    label: &'static str,
    target_value: &'static str,
    role_value: &'static str,
) -> ControlDef {
    let mut refreshes: Vec<&str> = vec!["audio_state_target"];
    refreshes.extend(audio_strip_refresh_keys());
    button(
        "0",
        col,
        label,
        audio_action_with_refreshes(
            json!({"action":"setMixTarget","value": target_value}),
            &refreshes,
        ),
    )
    .png("ico_main")
    .size("18")
    .no_topbar()
    .with_feedbacks(vec![
        color_feedback(
            "audio_state_target",
            role_value,
            DECK_AMBER_INK,
            DECK_AMBER_BG,
        ),
        gated_grey_feedback(),
    ])
}

pub(crate) fn audio_controls() -> Vec<ControlDef> {
    let strip_refreshes = audio_strip_refresh_keys();

    let mut bank_refreshes: Vec<&str> = vec![
        "audio_state_bank",
        "audio_state_mode",
        "audio_key_4",
        "audio_key_6",
    ];
    bank_refreshes.extend(strip_refreshes.clone());
    let mut mode_refreshes: Vec<&str> = vec!["audio_state_mode", "audio_key_6"];
    mode_refreshes.extend(strip_refreshes.clone());

    let mut controls = vec![
        audio_target_key("0", "MAIN", "main", "main"),
        audio_target_key("1", "PH 1", "phones-a", "phones-a").png("ico_phones"),
        audio_target_key("2", "PH 2", "phones-b", "phones-b").png("ico_phones"),
        expression_button(
            "0",
            "3",
            "BANK",
            "$(custom:lcd_audio_key_4)",
            audio_action_with_refreshes(json!({"action":"cycleBank"}), &bank_refreshes),
        )
        .png("ico_bank")
        .size("14")
        .no_topbar()
        .with_feedbacks(vec![
            state_feedback(
                "audio_state_bank",
                "playback",
                false,
                json!({ "bgcolor": DECK_BANK_TINT_BG }),
            ),
            state_feedback(
                "audio_state_bank",
                "outputs",
                false,
                json!({ "bgcolor": DECK_BANK_TINT_BG }),
            ),
            gated_grey_feedback(),
        ]),
        expression_button(
            "1",
            "0",
            "DIM",
            "$(custom:lcd_audio_key_5)",
            audio_action_with_refreshes(
                json!({"action":"dimToggle"}),
                &["audio_state_dim", "audio_key_5"],
            ),
        )
        .png("ico_dim")
        .size("14")
        .no_topbar()
        .with_feedbacks(vec![
            color_feedback("audio_state_dim", "on", DECK_AMBER_INK, DECK_AMBER_BG),
            gated_grey_feedback(),
        ]),
        expression_button(
            "1",
            "1",
            "GAIN",
            "$(custom:lcd_audio_key_6)",
            audio_action_with_refreshes(json!({"action":"toggleDialMode"}), &mode_refreshes),
        )
        .png("ico_gain")
        .size("14")
        .no_topbar()
        .with_feedbacks(vec![
            color_feedback("audio_state_mode", "gain", DECK_AMBER_INK, DECK_AMBER_BG),
            gated_grey_feedback(),
        ]),
        momentary_button(
            "1",
            "2",
            "TALK",
            "$(custom:lcd_audio_key_7)",
            audio_action_with_refreshes(
                json!({"action":"talkOn"}),
                &["audio_state_talk", "audio_key_7"],
            ),
            audio_action_with_refreshes(
                json!({"action":"talkOff"}),
                &["audio_state_talk", "audio_key_7"],
            ),
        )
        .png("ico_talk")
        .size("14")
        .no_topbar()
        .with_feedbacks(vec![
            color_feedback("audio_state_talk", "live", DECK_TALK_INK, DECK_TALK_BG),
            gated_grey_feedback(),
        ]),
        expression_button(
            "1",
            "3",
            "SOLO CLR",
            "$(custom:lcd_audio_key_8)",
            audio_action_with_refreshes(
                json!({"action":"soloClearAll"}),
                &["audio_state_solo", "audio_key_8"],
            ),
        )
        .png("ico_solo")
        .size("14")
        .no_topbar()
        .with_feedbacks(vec![
            state_feedback(
                "audio_state_solo",
                "0",
                true,
                json!({ "color": DECK_WARN_INK, "bgcolor": DECK_WARN_BG }),
            ),
            gated_grey_feedback(),
        ]),
    ];

    for strip in 1..=4_usize {
        type StripDef = (&'static str, &'static str, &'static str, &'static str);
        let (col, strip_label, dial_label, strip_text): StripDef = match strip {
            1 => ("0", "Strip 1", "Dial 1", "$(custom:lcd_audio_strip_1)"),
            2 => ("1", "Strip 2", "Dial 2", "$(custom:lcd_audio_strip_2)"),
            3 => ("2", "Strip 3", "Dial 3", "$(custom:lcd_audio_strip_3)"),
            _ => ("3", "Strip 4", "Dial 4", "$(custom:lcd_audio_strip_4)"),
        };
        let strip_key = AUDIO_STRIP_TEXT_KEYS[strip - 1];
        let state_key = AUDIO_STRIP_STATE_KEYS[strip - 1];
        let level_key = AUDIO_STRIP_LEVEL_KEYS[strip - 1];

        let tap_body = json!({"action":"stripTap","value": strip.to_string()});
        let mut tap_keys: Vec<&str> = Vec::new();
        tap_keys.extend(AUDIO_STRIP_TEXT_KEYS.iter().copied());
        tap_keys.extend(AUDIO_STRIP_STATE_KEYS.iter().copied());
        controls.push(
            expression_button(
                "2",
                col,
                strip_label,
                strip_text,
                audio_action_with_refreshes(tap_body, &tap_keys),
            )
            .size("14")
            .no_topbar()
            .with_feedbacks(audio_strip_feedbacks(strip)),
        );

        let turn_down = json!({"action":"dialTurn","value": format!("{strip}:down")});
        let turn_up = json!({"action":"dialTurn","value": format!("{strip}:up")});
        let press = json!({"action":"dialPress","value": strip.to_string()});
        controls.push(dial(
            "3",
            col,
            dial_label,
            None,
            audio_action_with_refreshes(press, &[strip_key, state_key, level_key]),
            audio_action_with_refreshes(turn_down, &[strip_key, level_key]),
            audio_action_with_refreshes(turn_up, &[strip_key, level_key]),
        ));
    }

    controls
}
