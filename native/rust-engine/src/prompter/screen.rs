//! The Prompter XL as Windows reports it (new pages program, Slice 5a; the
//! proposal §7–8, the ledger's D20). Only the shell reads Windows' display
//! configuration, so it reports what it found with `prompter.screen.report`
//! (sent from Slice 5b); the hardware link keeps the report in memory, works
//! out the screen's state from it, and owns what follows: `PLAY` is refused
//! while nothing is drawn on the glass, a scroll pauses when the glass goes,
//! and `checks.prompter` carries the state to the header's lamp.
//!
//! The slice's first steps, answered by the operator on 2026-09-27: until the
//! shell has reported, after every start, the Prompter XL reads
//! `NOT CONNECTED`; `checks.prompter` is the worse of the screen's state and
//! `NOT UPDATED`; and a Prompter XL state makes the whole status no worse
//! than attention, while the lamp itself goes red. Answered again the same
//! day, after CI's qualification lane found that the unreported state made
//! every lane's and test's status attention: only a state the shell has
//! reported counts toward the whole status; and at the review, `NOT UPDATED`
//! lights the lamp only (an edit waiting for Update is work, not a fault).

use crate::prompter::PrompterError;
use serde::Serialize;
use serde_json::Value;

/// The Prompter XL's own size: below it, the text is drawn soft.
pub(crate) const FULL_WIDTH_PX: u32 = 1920;
pub(crate) const FULL_HEIGHT_PX: u32 = 1080;
/// The longest reason a report may carry for a window that did not open.
const MAX_REASON_CHARS: usize = 300;

/// The screen's state, as the page, the lamp and the deck name it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
#[serde(rename_all = "kebab-case")]
pub enum PrompterScreenState {
    /// Windows sees the Prompter XL at its own size, and the glass is drawn.
    Connected,
    /// Windows does not see it, or the shell has not said since the start.
    NotConnected,
    /// Windows shows a copy of another screen on it: nothing is drawn there.
    Duplicated,
    /// Windows runs it below 1920×1080: the glass is drawn, soft.
    LowResolution,
    /// Studio Control's window on it does not show: it could not be opened,
    /// or its page does not draw. The shell opens it again by itself.
    NotShowing,
}

impl PrompterScreenState {
    /// The state word (system §8: the word the state display and the lamp
    /// show).
    pub(crate) fn word(self) -> &'static str {
        match self {
            Self::Connected => "CONNECTED",
            Self::NotConnected => "NOT CONNECTED",
            Self::Duplicated => "DUPLICATED",
            Self::LowResolution => "LOW RESOLUTION",
            Self::NotShowing => "NOT SHOWING",
        }
    }

    /// Whether the glass is drawn on the Prompter XL, so the text may scroll.
    pub(crate) fn draws(self) -> bool {
        matches!(self, Self::Connected | Self::LowResolution)
    }

    /// The lamp's tone: red while nothing reaches the glass (D20: the
    /// Prompter XL stays plugged in), amber while it is drawn soft.
    pub(crate) fn tone(self) -> PrompterCheckTone {
        match self {
            Self::Connected => PrompterCheckTone::Ok,
            Self::LowResolution => PrompterCheckTone::Attention,
            Self::NotConnected | Self::Duplicated | Self::NotShowing => PrompterCheckTone::Error,
        }
    }
}

/// A check's tone, worst last.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
#[serde(rename_all = "lowercase")]
pub enum PrompterCheckTone {
    Ok,
    Attention,
    Error,
}

impl PrompterCheckTone {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Ok => "ok",
            Self::Attention => "attention",
            Self::Error => "error",
        }
    }
}

/// What the shell last reported, kept in memory only: after a start the
/// shell reports again.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct PrompterScreen {
    /// The shell has reported since the start.
    pub reported: bool,
    /// Windows sees a screen named `Prompter XL`.
    pub found: bool,
    pub duplicated: bool,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub refresh_hz: Option<u32>,
    /// Why the window on it could not open, in the shell's words.
    pub window_error: Option<String>,
}

impl PrompterScreen {
    pub(crate) fn state(&self) -> PrompterScreenState {
        if !self.found {
            PrompterScreenState::NotConnected
        } else if self.duplicated {
            PrompterScreenState::Duplicated
        } else if self.window_error.is_some() {
            PrompterScreenState::NotShowing
        } else if self.width.unwrap_or(0) < FULL_WIDTH_PX
            || self.height.unwrap_or(0) < FULL_HEIGHT_PX
        {
            PrompterScreenState::LowResolution
        } else {
            PrompterScreenState::Connected
        }
    }

    /// `prompter.screen.report { found, duplicated?, width?, height?,
    /// refreshHz?, windowError? }`. A screen that was found carries its size;
    /// its refresh rate may be missing (Windows can report none) or a
    /// fraction (59.94), and is kept in whole hertz. A window error is kept
    /// only when it is what the state says (not while duplicated).
    pub(crate) fn from_report(params: &Value) -> Result<Self, PrompterError> {
        let found = params
            .get("found")
            .and_then(Value::as_bool)
            .ok_or_else(|| PrompterError::Invalid(String::from("found must be true or false.")))?;
        if !found {
            return Ok(Self {
                reported: true,
                ..Self::default()
            });
        }
        let duplicated = match params.get("duplicated") {
            None | Some(Value::Null) => false,
            Some(Value::Bool(value)) => *value,
            Some(_) => {
                return Err(PrompterError::Invalid(String::from(
                    "duplicated must be true or false.",
                )))
            }
        };
        let window_error = match params.get("windowError") {
            None | Some(Value::Null) => None,
            Some(Value::String(reason)) if !reason.trim().is_empty() => {
                Some(reason.trim().chars().take(MAX_REASON_CHARS).collect())
            }
            Some(_) => {
                return Err(PrompterError::Invalid(String::from(
                    "windowError must be a sentence.",
                )))
            }
        };
        let refresh_hz = match params.get("refreshHz") {
            None | Some(Value::Null) => None,
            Some(_) => Some(positive(params, "refreshHz")?),
        };
        Ok(Self {
            reported: true,
            found,
            duplicated,
            width: Some(positive(params, "width")?),
            height: Some(positive(params, "height")?),
            refresh_hz,
            window_error: window_error.filter(|_| !duplicated),
        })
    }

    /// `1920×1080 at 60 Hz`, or `1920×1080` when Windows gave no refresh
    /// rate, once a screen was found.
    fn mode(&self) -> Option<String> {
        match (self.width, self.height, self.refresh_hz) {
            (Some(width), Some(height), Some(refresh)) => {
                Some(format!("{width}×{height} at {refresh} Hz"))
            }
            (Some(width), Some(height), None) => Some(format!("{width}×{height}")),
            _ => None,
        }
    }

    /// The state's sentence (the proposal §8): what happened and what to do.
    pub(crate) fn sentence(&self) -> String {
        match self.state() {
            PrompterScreenState::Connected => format!(
                "The Prompter XL is connected: {}.",
                self.mode().unwrap_or_default()
            ),
            PrompterScreenState::LowResolution => format!(
                "Windows runs the Prompter XL at {}×{}. Set it to {FULL_WIDTH_PX}×{FULL_HEIGHT_PX} in Windows' display settings for the sharpest text.",
                self.width.unwrap_or(0),
                self.height.unwrap_or(0)
            ),
            PrompterScreenState::NotConnected if !self.reported => String::from(
                "Windows has not reported the Prompter XL since Studio Control started. The script and the place are kept, and nothing is shown on any other screen.",
            ),
            PrompterScreenState::NotConnected => String::from(
                "Windows does not see the Prompter XL. Check its USB-C cable; it needs 15 W. The script and the place are kept, and nothing is shown on any other screen.",
            ),
            PrompterScreenState::Duplicated => String::from(
                "Windows shows a copy of another screen on the Prompter XL, so the script is not drawn there. In Windows' display settings, choose Extend these displays.",
            ),
            PrompterScreenState::NotShowing => String::from(
                "Studio Control's window on the Prompter XL does not show, so the script is not drawn there. Studio Control opens it again by itself.",
            ),
        }
    }

    /// Why `PLAY` is refused while nothing is drawn on the glass.
    pub(crate) fn play_refusal(&self) -> Option<PrompterError> {
        let sentence = match self.state() {
            PrompterScreenState::Connected | PrompterScreenState::LowResolution => return None,
            PrompterScreenState::NotConnected => {
                "The Prompter XL is not connected, so the text cannot scroll. Jumps, speed and size still work, and the place they set is where it comes back."
            }
            PrompterScreenState::Duplicated => {
                "Windows shows a copy of another screen on the Prompter XL, so the text is not drawn there and cannot scroll."
            }
            PrompterScreenState::NotShowing => {
                "Studio Control's window on the Prompter XL is not open, so the text cannot scroll."
            }
        };
        Some(PrompterError::Refused(
            "PROMPTER_NOT_ON_GLASS",
            String::from(sentence),
        ))
    }

    pub(crate) fn summary(&self) -> PrompterScreenSummary {
        let state = self.state();
        PrompterScreenSummary {
            state,
            word: state.word().to_string(),
            tone: state.tone(),
            reported: self.reported,
            draws: state.draws(),
            width: self.width,
            height: self.height,
            refresh_hz: self.refresh_hz,
            window_error: self.window_error.clone(),
            sentence: self.sentence(),
        }
    }
}

/// A size or a rate the shell read from Windows: a number above 0, kept in
/// whole units (a refresh rate of 59.94 Hz is 60).
fn positive(params: &Value, key: &str) -> Result<u32, PrompterError> {
    params
        .get(key)
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite() && *value >= 0.5 && *value <= 100_000.0)
        .map(|value| value.round() as u32)
        .ok_or_else(|| {
            PrompterError::Invalid(format!(
                "{key} must be a number above 0 when the screen was found."
            ))
        })
}

/// The Prompter XL as the prompter's state and `checks.prompter` carry it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct PrompterScreenSummary {
    pub state: PrompterScreenState,
    /// `CONNECTED`, `NOT CONNECTED`, `DUPLICATED`, `LOW RESOLUTION` or
    /// `NOT SHOWING`.
    pub word: String,
    pub tone: PrompterCheckTone,
    /// The shell has reported the screen since the start.
    pub reported: bool,
    /// The glass is drawn on the Prompter XL, so the text may scroll.
    pub draws: bool,
    pub width: Option<u32>,
    pub height: Option<u32>,
    #[serde(rename = "refreshHz")]
    pub refresh_hz: Option<u32>,
    /// Why the window on it could not open (`NOT SHOWING`), in small type.
    #[serde(rename = "windowError")]
    pub window_error: Option<String>,
    pub sentence: String,
}

/// `checks.prompter` in `health.snapshot`: the worse of the screen's state
/// and `NOT UPDATED` (first step 3), so the header's lamp reads one check as
/// the other lamps read theirs.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct PrompterHealthCheck {
    pub ok: bool,
    pub status: PrompterCheckTone,
    /// The worse state's word: the screen's, or `NOT UPDATED`.
    pub word: String,
    /// The worse state's sentence.
    pub summary: String,
    /// The script on the glass was edited after it went on.
    #[serde(rename = "notUpdated")]
    pub not_updated: bool,
    pub screen: PrompterScreenSummary,
    /// What the whole status takes from it — a Prompter XL state the shell
    /// has reported, never `NOT UPDATED` — and the sentence that says why;
    /// `None` when nothing counts (`whole_status`).
    #[serde(skip)]
    #[cfg_attr(feature = "ts-rs", ts(skip))]
    counted: Option<(PrompterCheckTone, String)>,
}

impl PrompterHealthCheck {
    /// `edited` names the script on the glass when it was edited after it
    /// went on. At the same tone, `NOT UPDATED` wins over `LOW RESOLUTION`:
    /// it asks the operator for Update, on this page.
    pub(crate) fn new(screen: &PrompterScreen, edited: Option<&str>) -> Self {
        let screen = screen.summary();
        let not_updated = edited.map(|name| {
            format!(
                "{name} was edited after it went on the prompter. The prompter still shows the earlier text."
            )
        });
        let (status, word, summary) = match &not_updated {
            Some(sentence) if screen.tone <= PrompterCheckTone::Attention => (
                PrompterCheckTone::Attention,
                String::from("NOT UPDATED"),
                sentence.clone(),
            ),
            _ => (screen.tone, screen.word.clone(), screen.sentence.clone()),
        };
        // Only a Prompter XL state the shell has reported counts toward the
        // whole status, as attention at most; `NOT UPDATED` lights the lamp
        // only (the operator's answers of 2026-09-27, after CI and at the
        // review).
        let counted = (screen.reported && screen.tone > PrompterCheckTone::Ok).then(|| {
            (
                screen.tone.min(PrompterCheckTone::Attention),
                screen.sentence.clone(),
            )
        });
        Self {
            ok: status == PrompterCheckTone::Ok,
            status,
            word,
            summary,
            not_updated: edited.is_some(),
            screen,
            counted,
        }
    }

    /// What the whole status takes from it (first step 1): no worse than
    /// attention, since the sound and the light are unaffected; nothing from
    /// a Prompter XL the shell has not reported yet (answered after CI's
    /// qualification lane found every lane's status raised by it), and
    /// nothing from `NOT UPDATED` (answered at the review).
    pub(crate) fn whole_status(&self) -> PrompterCheckTone {
        self.counted
            .as_ref()
            .map_or(PrompterCheckTone::Ok, |(tone, _)| *tone)
    }

    /// The sentence of the state that raises the whole status, for the
    /// health summary Setup / Support shows; `None` when nothing does.
    pub(crate) fn whole_status_sentence(&self) -> Option<&str> {
        self.counted.as_ref().map(|(_, sentence)| sentence.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn report(params: Value) -> PrompterScreen {
        PrompterScreen::from_report(&params).expect("a report")
    }

    #[test]
    fn before_a_report_the_prompter_xl_is_not_connected() {
        let screen = PrompterScreen::default();
        assert_eq!(screen.state(), PrompterScreenState::NotConnected);
        assert!(!screen.state().draws());
        assert!(screen.sentence().starts_with("Windows has not reported"));
        let (code, _) = match screen.play_refusal() {
            Some(PrompterError::Refused(code, sentence)) => (code, sentence),
            other => panic!("PLAY should be refused: {other:?}"),
        };
        assert_eq!(code, "PROMPTER_NOT_ON_GLASS");
        let summary = screen.summary();
        assert!(!summary.reported);
        assert_eq!(summary.word, "NOT CONNECTED");
        assert_eq!(summary.tone, PrompterCheckTone::Error);
    }

    #[test]
    fn the_state_follows_what_windows_reports() {
        let full = json!({ "found": true, "width": 1920, "height": 1080, "refreshHz": 60 });
        assert_eq!(report(full.clone()).state(), PrompterScreenState::Connected);
        assert_eq!(
            report(full.clone()).sentence(),
            "The Prompter XL is connected: 1920×1080 at 60 Hz."
        );
        let low = json!({ "found": true, "width": 1280, "height": 720, "refreshHz": 60 });
        assert_eq!(
            report(low.clone()).state(),
            PrompterScreenState::LowResolution
        );
        assert!(report(low)
            .sentence()
            .starts_with("Windows runs the Prompter XL at 1280×720."));
        let mut duplicated = full.clone();
        duplicated["duplicated"] = json!(true);
        duplicated["windowError"] = json!("ignored while duplicated");
        assert_eq!(report(duplicated).state(), PrompterScreenState::Duplicated);
        let mut failed = full;
        failed["windowError"] = json!("  The window could not be created.  ");
        let failed = report(failed);
        assert_eq!(failed.state(), PrompterScreenState::NotShowing);
        assert_eq!(
            failed.summary().window_error.as_deref(),
            Some("The window could not be created.")
        );
        let gone = report(json!({ "found": false, "width": 1920 }));
        assert_eq!(gone.state(), PrompterScreenState::NotConnected);
        assert!(gone.reported);
        assert!(gone
            .sentence()
            .starts_with("Windows does not see the Prompter XL."));
        assert_eq!(gone.width, None, "a screen that is gone has no size");
    }

    // Review of the slice's push: Windows reports a refresh rate as a
    // fraction, or none; either is kept, never a refused report that would
    // leave a good Prompter XL NOT CONNECTED.
    #[test]
    fn a_refresh_rate_may_be_a_fraction_or_missing() {
        let fraction =
            report(json!({ "found": true, "width": 1920.0, "height": 1080, "refreshHz": 59.94 }));
        assert_eq!(fraction.state(), PrompterScreenState::Connected);
        assert_eq!(fraction.refresh_hz, Some(60));
        let missing = report(json!({ "found": true, "width": 1920, "height": 1080 }));
        assert_eq!(missing.state(), PrompterScreenState::Connected);
        assert_eq!(missing.refresh_hz, None);
        assert_eq!(
            missing.sentence(),
            "The Prompter XL is connected: 1920×1080."
        );
        let duplicated = report(
            json!({ "found": true, "duplicated": true, "windowError": "no", "width": 1920, "height": 1080 }),
        );
        assert_eq!(duplicated.window_error, None, "not what the state says");
    }

    #[test]
    fn only_a_drawn_glass_lets_the_text_scroll() {
        for (params, plays) in [
            (
                json!({ "found": true, "width": 1920, "height": 1080, "refreshHz": 60 }),
                true,
            ),
            (
                json!({ "found": true, "width": 1280, "height": 720, "refreshHz": 60 }),
                true,
            ),
            (json!({ "found": false }), false),
            (
                json!({ "found": true, "duplicated": true, "width": 1920, "height": 1080, "refreshHz": 60 }),
                false,
            ),
            (
                json!({ "found": true, "windowError": "no", "width": 1920, "height": 1080, "refreshHz": 60 }),
                false,
            ),
        ] {
            let screen = report(params.clone());
            assert_eq!(screen.play_refusal().is_none(), plays, "{params}");
            assert_eq!(screen.state().draws(), plays, "{params}");
        }
    }

    #[test]
    fn a_report_that_is_not_one_is_refused() {
        for params in [
            json!({}),
            json!({ "found": "yes" }),
            json!({ "found": true }),
            json!({ "found": true, "width": 1920 }),
            json!({ "found": true, "width": 1920, "height": 1080, "refreshHz": 0 }),
            json!({ "found": true, "width": 0, "height": 1080, "refreshHz": 60 }),
            json!({ "found": true, "width": 1920, "height": 1080, "refreshHz": 60, "duplicated": 1 }),
            json!({ "found": true, "width": 1920, "height": 1080, "refreshHz": 60, "windowError": " " }),
        ] {
            assert!(
                matches!(
                    PrompterScreen::from_report(&params),
                    Err(PrompterError::Invalid(_))
                ),
                "{params}"
            );
        }
    }

    #[test]
    fn the_check_is_the_worse_of_the_screen_and_not_updated() {
        let full = report(json!({ "found": true, "width": 1920, "height": 1080, "refreshHz": 60 }));
        let check = PrompterHealthCheck::new(&full, None);
        assert!(check.ok);
        assert_eq!(check.word, "CONNECTED");
        assert_eq!(check.whole_status(), PrompterCheckTone::Ok);

        let edited = PrompterHealthCheck::new(&full, Some("Intro"));
        assert_eq!(edited.status, PrompterCheckTone::Attention);
        assert_eq!(edited.word, "NOT UPDATED");
        assert_eq!(
            edited.summary,
            "Intro was edited after it went on the prompter. The prompter still shows the earlier text."
        );
        assert!(edited.not_updated);

        let low = report(json!({ "found": true, "width": 1280, "height": 720, "refreshHz": 60 }));
        assert_eq!(
            PrompterHealthCheck::new(&low, Some("Intro")).word,
            "NOT UPDATED"
        );
        assert_eq!(PrompterHealthCheck::new(&low, None).word, "LOW RESOLUTION");

        let gone = report(json!({ "found": false }));
        let check = PrompterHealthCheck::new(&gone, Some("Intro"));
        assert_eq!(check.status, PrompterCheckTone::Error);
        assert_eq!(check.word, "NOT CONNECTED");
        assert!(check.not_updated, "the flag stays for the page");
        assert_eq!(
            check.whole_status(),
            PrompterCheckTone::Attention,
            "the whole status goes no worse than attention"
        );
        assert_eq!(
            check.whole_status_sentence(),
            Some("Windows does not see the Prompter XL. Check its USB-C cable; it needs 15 W. The script and the place are kept, and nothing is shown on any other screen.")
        );
    }

    // Answered after CI's qualification lane: a Prompter XL the shell has not
    // reported yet reads NOT CONNECTED on its lamp and locks PLAY, and leaves
    // the whole status alone; and at the review: NOT UPDATED lights the lamp
    // only.
    #[test]
    fn only_a_reported_state_counts_toward_the_whole_status() {
        let unreported = PrompterScreen::default();
        let check = PrompterHealthCheck::new(&unreported, None);
        assert_eq!(check.word, "NOT CONNECTED");
        assert_eq!(check.status, PrompterCheckTone::Error);
        assert_eq!(check.whole_status(), PrompterCheckTone::Ok);
        assert_eq!(check.whole_status_sentence(), None);

        let edited = PrompterHealthCheck::new(&unreported, Some("Intro"));
        assert_eq!(edited.word, "NOT CONNECTED", "the lamp shows the worse");
        assert_eq!(edited.whole_status(), PrompterCheckTone::Ok);
        let full = report(json!({ "found": true, "width": 1920, "height": 1080, "refreshHz": 60 }));
        let waiting = PrompterHealthCheck::new(&full, Some("Intro"));
        assert_eq!(waiting.word, "NOT UPDATED", "the lamp says so");
        assert_eq!(
            waiting.whole_status(),
            PrompterCheckTone::Ok,
            "an edit waiting for Update is work, not a fault"
        );

        let low = report(json!({ "found": true, "width": 1280, "height": 720, "refreshHz": 60 }));
        let check = PrompterHealthCheck::new(&low, Some("Intro"));
        assert_eq!(check.word, "NOT UPDATED");
        assert_eq!(check.whole_status(), PrompterCheckTone::Attention);
        assert!(check
            .whole_status_sentence()
            .unwrap()
            .starts_with("Windows runs the Prompter XL at 1280×720."));
        assert_eq!(
            PrompterHealthCheck::new(&full, None).whole_status(),
            PrompterCheckTone::Ok
        );
    }
}
