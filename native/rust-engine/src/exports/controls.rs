//! What a deck page is made of: a control (a key, a touch-strip cell or a
//! dial), the actions it sends, the feedbacks that colour it, the deck's
//! palette and its pictures.

use super::profile::INSTANCE_ID;
use serde_json::{json, Value};

#[derive(Clone)]
pub(super) struct ControlDef {
    pub(super) row: &'static str,
    pub(super) col: &'static str,
    pub(super) label: &'static str,
    pub(super) is_rotary: bool,
    pub(super) down: Vec<Value>,
    pub(super) rotate_left: Vec<Value>,
    pub(super) rotate_right: Vec<Value>,
    pub(super) text_expression: Option<&'static str>,
    pub(super) png_asset: Option<&'static str>,
    pub(super) text_size: Option<&'static str>,
    pub(super) hide_topbar: bool,
    pub(super) feedbacks: Vec<Value>,
}

impl ControlDef {
    pub(super) fn png(mut self, asset: &'static str) -> Self {
        self.png_asset = Some(asset);
        self
    }

    pub(super) fn size(mut self, size: &'static str) -> Self {
        self.text_size = Some(size);
        self
    }

    pub(super) fn no_topbar(mut self) -> Self {
        self.hide_topbar = true;
        self
    }

    pub(super) fn with_feedbacks(mut self, feedbacks: Vec<Value>) -> Self {
        self.feedbacks = feedbacks;
        self
    }
}

pub(super) fn button(
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
        rotate_left: Vec::new(),
        rotate_right: Vec::new(),
        text_expression: None,
        png_asset: None,
        text_size: None,
        hide_topbar: false,
        feedbacks: Vec::new(),
    }
}

pub(super) fn expression_button(
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

pub(super) fn dial(
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
        rotate_left,
        rotate_right,
        text_expression,
        png_asset: None,
        text_size: None,
        hide_topbar: false,
        feedbacks: Vec::new(),
    }
}

pub(super) fn page_jump(page: i64) -> Vec<Value> {
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

pub(super) fn http_post(path: &'static str, body: Value) -> Vec<Value> {
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

pub(super) fn lcd_refreshes(keys: &[&str]) -> Vec<Value> {
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

pub(super) fn next_action_id() -> String {
    use std::sync::atomic::{AtomicUsize, Ordering};

    static ACTION_COUNTER: AtomicUsize = AtomicUsize::new(1);
    let next = ACTION_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("act-{next}")
}

// Deck palette: the app's Console vocabulary, mirrored on the hardware.
pub(super) const DECK_AMBER_BG: u32 = 0x00E8_B13D;
pub(super) const DECK_AMBER_INK: u32 = 0x0024_1D0B;
pub(super) const DECK_WARN_BG: u32 = 0x00FF_D33D;
pub(super) const DECK_WARN_INK: u32 = 0x002A_2206;
pub(super) const DECK_SELECT_BG: u32 = 0x0024_1C08;
pub(super) const DECK_SELECT_INK: u32 = 0x00E8_B13D;
pub(super) const DECK_MUTED_BG: u32 = 0x001A_0F0C;
pub(super) const DECK_MUTED_INK: u32 = 0x00E0_7A63;
pub(super) const DECK_GREY_INK: u32 = 0x006D_675A;
pub(super) const DECK_BANK_TINT_BG: u32 = 0x004A_3A12;

// Base64 PNG assets rendered by scripts/deck-assets.py and checked in under
// native/rust-engine/assets/deck/.
pub(super) fn deck_asset(name: &str) -> &'static str {
    let encoded = match name {
        "bar_f0" => include_str!("../../assets/deck/bar_f0.b64"),
        "bar_f1" => include_str!("../../assets/deck/bar_f1.b64"),
        "bar_f2" => include_str!("../../assets/deck/bar_f2.b64"),
        "bar_f3" => include_str!("../../assets/deck/bar_f3.b64"),
        "bar_f4" => include_str!("../../assets/deck/bar_f4.b64"),
        "bar_f5" => include_str!("../../assets/deck/bar_f5.b64"),
        "bar_f6" => include_str!("../../assets/deck/bar_f6.b64"),
        "bar_f7" => include_str!("../../assets/deck/bar_f7.b64"),
        "bar_f8" => include_str!("../../assets/deck/bar_f8.b64"),
        "bar_f9" => include_str!("../../assets/deck/bar_f9.b64"),
        "bar_f10" => include_str!("../../assets/deck/bar_f10.b64"),
        "bar_f11" => include_str!("../../assets/deck/bar_f11.b64"),
        "bar_f12" => include_str!("../../assets/deck/bar_f12.b64"),
        "bar_m0" => include_str!("../../assets/deck/bar_m0.b64"),
        "bar_m1" => include_str!("../../assets/deck/bar_m1.b64"),
        "bar_m2" => include_str!("../../assets/deck/bar_m2.b64"),
        "bar_m3" => include_str!("../../assets/deck/bar_m3.b64"),
        "bar_m4" => include_str!("../../assets/deck/bar_m4.b64"),
        "bar_m5" => include_str!("../../assets/deck/bar_m5.b64"),
        "bar_m6" => include_str!("../../assets/deck/bar_m6.b64"),
        "bar_m7" => include_str!("../../assets/deck/bar_m7.b64"),
        "bar_m8" => include_str!("../../assets/deck/bar_m8.b64"),
        "bar_m9" => include_str!("../../assets/deck/bar_m9.b64"),
        "bar_m10" => include_str!("../../assets/deck/bar_m10.b64"),
        "bar_m11" => include_str!("../../assets/deck/bar_m11.b64"),
        "bar_m12" => include_str!("../../assets/deck/bar_m12.b64"),
        "strip_off" => include_str!("../../assets/deck/strip_off.b64"),
        "strip_empty" => include_str!("../../assets/deck/strip_empty.b64"),
        "ico_main" => include_str!("../../assets/deck/ico_main.b64"),
        "ico_phones" => include_str!("../../assets/deck/ico_phones.b64"),
        "ico_bank" => include_str!("../../assets/deck/ico_bank.b64"),
        "ico_dim" => include_str!("../../assets/deck/ico_dim.b64"),
        "ico_solo" => include_str!("../../assets/deck/ico_solo.b64"),
        "ico_gain" => include_str!("../../assets/deck/ico_gain.b64"),
        _ => "",
    };
    encoded.trim_end()
}

pub(super) fn state_feedback(
    variable_key: &str,
    value: &str,
    inverted: bool,
    style: Value,
) -> Value {
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

pub(super) fn color_feedback(variable_key: &str, value: &str, color: u32, bgcolor: u32) -> Value {
    state_feedback(
        variable_key,
        value,
        false,
        json!({ "color": color, "bgcolor": bgcolor }),
    )
}

pub(super) fn png_feedback(variable_key: &str, value: &str, asset: &str) -> Value {
    state_feedback(
        variable_key,
        value,
        false,
        json!({ "png64": deck_asset(asset) }),
    )
}
