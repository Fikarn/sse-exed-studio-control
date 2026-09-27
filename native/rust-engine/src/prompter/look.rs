//! The prompter's one look (the proposal §4.1): there is one presenter and
//! one glass, so one look, not one per script. Every size is in the Prompter
//! XL's own pixels (1920×1080, 0.18 mm a pixel).
//!
//! The standard text size is part of the look; the size of the take
//! (`size_px`, beside the look in `prompter_state`) moves away from it with
//! − / + and the deck's size dial, is saved too, and Standard returns to it.

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub(crate) const SIZE_MIN_PX: u32 = 48;
pub(crate) const SIZE_MAX_PX: u32 = 160;
pub(crate) const SIZE_STEP_PX: u32 = 4;
pub(crate) const STANDARD_SIZE_PX: u32 = 88;

/// The text's colour on the always black background.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
#[serde(rename_all = "lowercase")]
pub enum PrompterTextColour {
    #[default]
    White,
    Yellow,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
#[serde(default)]
pub struct PrompterLook {
    /// 48–160 px in 4 px steps; 88 px makes capitals about 11.5 mm, for a
    /// presenter about 2 m from the glass (§14).
    #[serde(rename = "standardSizePx")]
    pub standard_size_px: u32,
    /// The line spacing in hundredths: 110–200 in steps of 10 (1.1–2.0).
    #[serde(rename = "lineSpacingPercent")]
    pub line_spacing_percent: u32,
    /// Each side's margin: 0–30 % of the width.
    #[serde(rename = "marginPercent")]
    pub margin_percent: u32,
    #[serde(rename = "textColour")]
    pub text_colour: PrompterTextColour,
    /// The reading line's height: 20–60 % from the top.
    #[serde(rename = "readingLinePercent")]
    pub reading_line_percent: u32,
    /// A thin line across the text at the reading line (off by default).
    #[serde(rename = "readingLineAcross")]
    pub reading_line_across: bool,
    /// Text already read dimmed to 45 % above the reading line.
    #[serde(rename = "dimReadText")]
    pub dim_read_text: bool,
    /// Paragraph numbers on the glass (always on the operator's side).
    #[serde(rename = "paragraphNumbers")]
    pub paragraph_numbers: bool,
}

impl Default for PrompterLook {
    fn default() -> Self {
        Self {
            standard_size_px: STANDARD_SIZE_PX,
            line_spacing_percent: 140,
            margin_percent: 12,
            text_colour: PrompterTextColour::White,
            reading_line_percent: 35,
            reading_line_across: false,
            dim_read_text: true,
            paragraph_numbers: false,
        }
    }
}

impl PrompterLook {
    /// Whether going from `self` to `other` changes where the lines break
    /// or how tall they are, so the front end has to lay the text out again.
    pub(crate) fn lays_out_differently(&self, other: &Self) -> bool {
        self.line_spacing_percent != other.line_spacing_percent
            || self.margin_percent != other.margin_percent
            || self.paragraph_numbers != other.paragraph_numbers
    }

    /// The stored look, each unreadable or out-of-range field put back to
    /// the standard: a look is never a reason to refuse to start.
    pub(crate) fn from_stored(raw: &str) -> Self {
        let look: Self = serde_json::from_str(raw).unwrap_or_default();
        look.clamped()
    }

    fn clamped(mut self) -> Self {
        let standard = Self::default();
        if !size_is_valid(self.standard_size_px) {
            self.standard_size_px = standard.standard_size_px;
        }
        if !(110..=200).contains(&self.line_spacing_percent)
            || !self.line_spacing_percent.is_multiple_of(10)
        {
            self.line_spacing_percent = standard.line_spacing_percent;
        }
        if self.margin_percent > 30 {
            self.margin_percent = standard.margin_percent;
        }
        if !(20..=60).contains(&self.reading_line_percent) {
            self.reading_line_percent = standard.reading_line_percent;
        }
        self
    }

    /// Applies `prompter.look.update`'s fields to this look. Each field is
    /// optional; a present one must be in range, or the whole update is
    /// refused with a sentence and nothing changes.
    pub(crate) fn updated(&self, params: &Value) -> Result<Self, String> {
        let mut look = *self;
        let object = params
            .as_object()
            .ok_or_else(|| String::from("The look's update must be an object."))?;
        let mut changed = false;
        for (key, value) in object {
            changed = true;
            match key.as_str() {
                "standardSizePx" => {
                    let size = whole(value, key)?;
                    if !size_is_valid(size) {
                        return Err(format!(
                            "The standard text size must be {SIZE_MIN_PX}–{SIZE_MAX_PX} px in steps of {SIZE_STEP_PX}."
                        ));
                    }
                    look.standard_size_px = size;
                }
                "lineSpacingPercent" => {
                    let spacing = whole(value, key)?;
                    if !(110..=200).contains(&spacing) || !spacing.is_multiple_of(10) {
                        return Err(String::from(
                            "The line spacing must be 1.1–2.0 in steps of 0.1 (lineSpacingPercent 110–200 in steps of 10).",
                        ));
                    }
                    look.line_spacing_percent = spacing;
                }
                "marginPercent" => {
                    let margin = whole(value, key)?;
                    if margin > 30 {
                        return Err(String::from("The margins must be 0–30 % each side."));
                    }
                    look.margin_percent = margin;
                }
                "textColour" => {
                    look.text_colour = serde_json::from_value(value.clone())
                        .map_err(|_| String::from("The text colour must be white or yellow."))?;
                }
                "readingLinePercent" => {
                    let height = whole(value, key)?;
                    if !(20..=60).contains(&height) {
                        return Err(String::from(
                            "The reading line must be 20–60 % from the top.",
                        ));
                    }
                    look.reading_line_percent = height;
                }
                "readingLineAcross" => look.reading_line_across = switch(value, key)?,
                "dimReadText" => look.dim_read_text = switch(value, key)?,
                "paragraphNumbers" => look.paragraph_numbers = switch(value, key)?,
                other => return Err(format!("The look has no setting called {other}.")),
            }
        }
        if !changed {
            return Err(String::from("The look's update names no setting."));
        }
        Ok(look)
    }
}

pub(crate) fn size_is_valid(size: u32) -> bool {
    (SIZE_MIN_PX..=SIZE_MAX_PX).contains(&size) && (size - SIZE_MIN_PX).is_multiple_of(SIZE_STEP_PX)
}

fn whole(value: &Value, key: &str) -> Result<u32, String> {
    value
        .as_u64()
        .and_then(|number| u32::try_from(number).ok())
        .ok_or_else(|| format!("{key} must be a whole number."))
}

fn switch(value: &Value, key: &str) -> Result<bool, String> {
    value
        .as_bool()
        .ok_or_else(|| format!("{key} must be true or false."))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_standard_look_is_the_proposals() {
        let look = PrompterLook::default();
        assert_eq!(
            serde_json::to_value(look).unwrap(),
            json!({
                "standardSizePx": 88,
                "lineSpacingPercent": 140,
                "marginPercent": 12,
                "textColour": "white",
                "readingLinePercent": 35,
                "readingLineAcross": false,
                "dimReadText": true,
                "paragraphNumbers": false
            })
        );
    }

    #[test]
    fn a_stored_look_out_of_range_comes_back_as_the_standard() {
        let look = PrompterLook::from_stored(
            r#"{"standardSizePx":90,"lineSpacingPercent":250,"marginPercent":40,"textColour":"yellow","readingLinePercent":10}"#,
        );
        assert_eq!(look.standard_size_px, 88);
        assert_eq!(look.line_spacing_percent, 140);
        assert_eq!(look.margin_percent, 12);
        assert_eq!(look.text_colour, PrompterTextColour::Yellow);
        assert_eq!(look.reading_line_percent, 35);
        assert_eq!(
            PrompterLook::from_stored("not json"),
            PrompterLook::default()
        );
    }

    #[test]
    fn an_update_changes_only_what_it_names_and_refuses_a_value_out_of_range() {
        let look = PrompterLook::default();
        let updated = look
            .updated(&json!({ "textColour": "yellow", "marginPercent": 20 }))
            .unwrap();
        assert_eq!(updated.text_colour, PrompterTextColour::Yellow);
        assert_eq!(updated.margin_percent, 20);
        assert_eq!(updated.standard_size_px, 88);
        assert!(look.lays_out_differently(&updated));
        assert!(
            !look.lays_out_differently(&look.updated(&json!({ "dimReadText": false })).unwrap())
        );
        for refused in [
            json!({ "standardSizePx": 90 }),
            json!({ "lineSpacingPercent": 145 }),
            json!({ "marginPercent": 31 }),
            json!({ "textColour": "green" }),
            json!({ "readingLinePercent": 70 }),
            json!({ "blinking": true }),
            json!({}),
        ] {
            assert!(
                look.updated(&refused).is_err(),
                "{refused} should be refused"
            );
        }
    }
}
