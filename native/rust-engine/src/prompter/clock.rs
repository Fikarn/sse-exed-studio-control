//! The scroll's clock (new pages program, Slice 4; the operator's answer to
//! the slice's first step, 2026-09-27: the clock runs in layout units).
//!
//! **Who knows what.** Only the front end has the fonts, so the view that
//! draws the glass reports its layout (`prompter.layout.report`): every
//! line's paragraph, first word, top and height, in the glass's own pixels at
//! its 1,920 px width, and where `END` falls. The hardware link runs the clock
//! in those pixels and holds everything else: the script on the glass, the
//! place, the pace, playing or not, and the stop at `END`.
//!
//! **The anchor.** The two processes share no clock, so every change sends an
//! anchor (`PrompterAnchor`): the place in words at that moment (a paragraph,
//! a word and how far down its line), its position in pixels when laid out,
//! the pace before and after with the 0.3 s ease, and how old the anchor was
//! when sent. The glass and the page's copy both draw the motion from it:
//!
//! ```text
//! words(t) = (v0·t + (v1 − v0)·t²/(2r)) / 60          while t < r
//!          = ((v0 + v1)/2·r + v1·(t − r)) / 60        after
//! position(t) = min(position + pxPerReadWord · words(t), endPosition)
//! ```
//!
//! with `t` in seconds since the anchor, `r` the ramp in seconds and `v0`,
//! `v1` the pace in words a minute. The speed in pixels a second is the pace
//! times the layout's height per read word, so a bigger size or wider
//! margins keep the pace (the proposal §5.1), and the whole script's length
//! at a pace is its read words ÷ the pace, whatever the look.
//!
//! **Without a layout** (nothing drawn since the start, or a new look or an
//! Update not yet laid out) the place is held in words, the time left is
//! estimated from the words, and a line step or a play is refused. A new look
//! arriving while the text scrolls keeps the words at the reading line: the
//! motion goes on in words until the new layout comes, and is then
//! re-anchored in the new pixels.

use crate::prompter::model::{paragraph_word_count, read_flags, PrompterParagraph};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Instant;

/// Starting, stopping and changing the pace ease over 0.3 s (§5).
pub(crate) const RAMP_MS: f64 = 300.0;
/// A jump moves the text in 0.2 s on the glass (§5); the place is the target
/// at once.
pub(crate) const JUMP_MOVE_MS: f64 = 200.0;
pub(crate) const SPEED_MIN_WPM: u32 = 40;
pub(crate) const SPEED_MAX_WPM: u32 = 300;
pub(crate) const SPEED_STEP_WPM: u32 = 5;
pub(crate) const SPEED_DEFAULT_WPM: u32 = 140;
/// A place this close to a line's top reads as that line's start.
const AT_LINE_START: f64 = 0.02;

/// A place in a script: a paragraph and a word in it, both from 0. The
/// paragraph after the last one (`paragraph == paragraph count`, word 0) is
/// the end: `END` at the reading line.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, Default,
)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct PrompterPlace {
    pub paragraph: u32,
    pub word: u32,
}

impl PrompterPlace {
    pub(crate) const TOP: Self = Self {
        paragraph: 0,
        word: 0,
    };

    pub(crate) fn end_of(paragraphs: &[PrompterParagraph]) -> Self {
        Self {
            paragraph: paragraphs.len() as u32,
            word: 0,
        }
    }

    /// The place a stored or restored script can stand on: inside the
    /// script, or its end.
    pub(crate) fn clamped(self, paragraphs: &[PrompterParagraph]) -> Self {
        let end = Self::end_of(paragraphs);
        if self >= end {
            return end;
        }
        let words = paragraph_word_count(&paragraphs[self.paragraph as usize]) as u32;
        Self {
            paragraph: self.paragraph,
            word: self.word.min(words.saturating_sub(1)),
        }
    }
}

/// One line of the layout the front end reports.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct PrompterLayoutLine {
    pub paragraph: u32,
    /// The line's first word in its paragraph.
    pub word: u32,
    /// The line's top and height in the glass's pixels.
    pub top: f64,
    pub height: f64,
}

/// A reported layout, checked against the text it lays out.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Layout {
    pub key: String,
    pub lines: Vec<PrompterLayoutLine>,
    /// Where the reading line stands when `END` reaches it.
    pub end_top: f64,
    /// The layout's height per read word: the pace's pixels.
    pub px_per_read_word: f64,
}

impl Layout {
    /// Checks a report against the text on the glass: at least one line;
    /// lines in order, each with a height, each paragraph's first line at its
    /// first word, every line's word inside its paragraph; `END` below the
    /// last line. Anything else is refused with a sentence.
    pub(crate) fn new(
        key: String,
        lines: Vec<PrompterLayoutLine>,
        end_top: f64,
        paragraphs: &[PrompterParagraph],
    ) -> Result<Self, String> {
        let Some(first) = lines.first() else {
            return Err(String::from("The layout has no lines."));
        };
        if first.paragraph != 0 || first.word != 0 {
            return Err(String::from(
                "The layout's first line must start the first paragraph.",
            ));
        }
        let word_counts: Vec<u32> = paragraphs
            .iter()
            .map(|paragraph| paragraph_word_count(paragraph) as u32)
            .collect();
        let mut previous: Option<&PrompterLayoutLine> = None;
        let mut paragraphs_started = 0u32;
        for line in &lines {
            let finite = line.top.is_finite() && line.height.is_finite();
            if !finite || line.top < 0.0 || line.height <= 0.0 || line.height > 10_000.0 {
                return Err(String::from(
                    "Each line of the layout needs a top and a height in pixels.",
                ));
            }
            let Some(words) = word_counts.get(line.paragraph as usize) else {
                return Err(format!(
                    "The layout names paragraph {}, and the text on the glass has {}.",
                    line.paragraph + 1,
                    paragraphs.len()
                ));
            };
            if line.word > 0 && line.word >= *words {
                return Err(format!(
                    "The layout starts a line at word {} of paragraph {}, which has {}.",
                    line.word + 1,
                    line.paragraph + 1,
                    words
                ));
            }
            if let Some(previous) = previous {
                let in_order = (line.paragraph, line.word) > (previous.paragraph, previous.word)
                    && line.top >= previous.top + previous.height - 0.5;
                if !in_order {
                    return Err(String::from("The layout's lines are not in order."));
                }
            }
            let starts_paragraph =
                previous.is_none_or(|previous| previous.paragraph != line.paragraph);
            if starts_paragraph {
                if line.paragraph != paragraphs_started || line.word != 0 {
                    return Err(format!(
                        "The layout must start paragraph {} on a line of its own.",
                        paragraphs_started + 1
                    ));
                }
                paragraphs_started += 1;
            }
            previous = Some(line);
        }
        if paragraphs_started as usize != paragraphs.len() {
            return Err(format!(
                "The layout lays out {paragraphs_started} paragraphs, and the text on the glass has {}.",
                paragraphs.len()
            ));
        }
        let last = lines[lines.len() - 1];
        let text_bottom = last.top + last.height;
        if !end_top.is_finite() || end_top < text_bottom - 0.5 {
            return Err(String::from(
                "The layout's END must stand below its last line.",
            ));
        }
        let read_words: usize = paragraphs
            .iter()
            .map(|paragraph| read_flags(paragraph).iter().filter(|read| **read).count())
            .sum();
        let px_per_read_word = (text_bottom - first.top) / read_words.max(1) as f64;
        Ok(Self {
            key,
            lines,
            end_top,
            px_per_read_word,
        })
    }

    /// The index of the line that holds `place`: the last line starting at
    /// or before it.
    fn line_of(&self, place: PrompterPlace) -> usize {
        self.lines
            .partition_point(|line| (line.paragraph, line.word) <= (place.paragraph, place.word))
            .saturating_sub(1)
    }

    /// The index of the line at the reading line when it stands at
    /// `position`.
    fn line_at(&self, position: f64) -> usize {
        self.lines
            .partition_point(|line| line.top <= position)
            .saturating_sub(1)
    }

    /// Where the reading line stands for a place `fraction` of the way down
    /// its line; the end is `end_top`.
    pub(crate) fn position_of(
        &self,
        place: PrompterPlace,
        fraction: f64,
        paragraph_count: u32,
    ) -> f64 {
        if place.paragraph >= paragraph_count {
            return self.end_top;
        }
        let line = self.lines[self.line_of(place)];
        (line.top + fraction.clamp(0.0, 1.0) * line.height).min(self.end_top)
    }

    /// The place at the reading line when it stands at `position`, and how
    /// far down its line.
    pub(crate) fn place_at(&self, position: f64, paragraph_count: u32) -> (PrompterPlace, f64) {
        if position >= self.end_top {
            return (
                PrompterPlace {
                    paragraph: paragraph_count,
                    word: 0,
                },
                0.0,
            );
        }
        let line = self.lines[self.line_at(position)];
        let fraction = ((position - line.top) / line.height).clamp(0.0, 0.999);
        (
            PrompterPlace {
                paragraph: line.paragraph,
                word: line.word,
            },
            fraction,
        )
    }

    /// One line on or back from `position`, keeping how far down the line
    /// the reading line stands (§5: a line step never stops the scroll).
    pub(crate) fn line_step(&self, position: f64, forward: bool) -> f64 {
        let index = self.line_at(position);
        let line = self.lines[index];
        let target = if forward {
            position + line.height
        } else {
            let before = index
                .checked_sub(1)
                .map_or(line, |before| self.lines[before]);
            position - before.height
        };
        target.clamp(self.lines[0].top, self.end_top)
    }
}

/// The motion from an anchor: where it stood, and the pace easing from one
/// speed to another.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Motion {
    pub at: Instant,
    pub place: PrompterPlace,
    /// How far down its line the place stands, 0 to 1.
    pub fraction: f64,
    pub from_wpm: f64,
    pub to_wpm: f64,
    pub ramp_ms: f64,
    /// A jump's start on the glass, drawn over `JUMP_MOVE_MS`.
    pub move_from: Option<f64>,
}

impl Motion {
    pub(crate) fn resting(at: Instant, place: PrompterPlace, fraction: f64) -> Self {
        Self {
            at,
            place,
            fraction,
            from_wpm: 0.0,
            to_wpm: 0.0,
            ramp_ms: 0.0,
            move_from: None,
        }
    }

    fn elapsed_ms(&self, now: Instant) -> f64 {
        now.saturating_duration_since(self.at).as_secs_f64() * 1000.0
    }

    /// The read words the text has moved since the anchor.
    pub(crate) fn words_advanced(&self, elapsed_ms: f64) -> f64 {
        let seconds = elapsed_ms.max(0.0) / 1000.0;
        let ramp = self.ramp_ms / 1000.0;
        let (from, to) = (self.from_wpm, self.to_wpm);
        let word_minutes = if ramp > 0.0 && seconds < ramp {
            from * seconds + (to - from) * seconds * seconds / (2.0 * ramp)
        } else {
            (from + to) / 2.0 * ramp + to * (seconds - ramp)
        };
        word_minutes / 60.0
    }

    /// The pace at `elapsed_ms`, in words a minute.
    pub(crate) fn speed_at(&self, elapsed_ms: f64) -> f64 {
        if self.ramp_ms > 0.0 && elapsed_ms < self.ramp_ms {
            self.from_wpm + (self.to_wpm - self.from_wpm) * elapsed_ms.max(0.0) / self.ramp_ms
        } else {
            self.to_wpm
        }
    }

    /// Whether the text still moves at `elapsed_ms`.
    fn moving(&self, elapsed_ms: f64) -> bool {
        self.speed_at(elapsed_ms) > 0.0 || self.to_wpm > 0.0
    }
}

/// What the anchor says to a view, as `prompter.changed` and the prompter's
/// state carry it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct PrompterAnchor {
    /// The layout this anchor's pixels belong to; a view whose layout has
    /// another key draws from `place` and `lineFraction` and reports its
    /// layout.
    #[serde(rename = "layoutKey")]
    pub layout_key: String,
    pub place: PrompterPlace,
    #[serde(rename = "lineFraction")]
    pub line_fraction: f64,
    /// The reading line's position at the anchor, in the glass's pixels;
    /// `null` until the layout is reported.
    pub position: Option<f64>,
    #[serde(rename = "endPosition")]
    pub end_position: Option<f64>,
    #[serde(rename = "pxPerReadWord")]
    pub px_per_read_word: Option<f64>,
    pub playing: bool,
    #[serde(rename = "atEnd")]
    pub at_end: bool,
    #[serde(rename = "fromWpm")]
    pub from_wpm: f64,
    #[serde(rename = "toWpm")]
    pub to_wpm: f64,
    #[serde(rename = "rampMs")]
    pub ramp_ms: f64,
    /// Where a jump's 0.2 s move starts on the glass, while it lasts.
    #[serde(rename = "moveFromPosition")]
    pub move_from_position: Option<f64>,
    #[serde(rename = "moveMs")]
    pub move_ms: f64,
    /// How old the anchor was when this was sent, in milliseconds.
    #[serde(rename = "ageMs")]
    pub age_ms: f64,
}

/// The clock of the script on the glass.
#[derive(Debug, Clone)]
pub(crate) struct GlassClock {
    pub script_id: String,
    /// The text as it went on the glass.
    pub paragraphs: Arc<Vec<PrompterParagraph>>,
    /// The layout the view must report for the glass as it is now.
    pub layout_key: String,
    pub layout: Option<Layout>,
    pub motion: Motion,
    pub playing: bool,
    /// The script's own pace.
    pub speed_wpm: u32,
}

impl GlassClock {
    /// A clock standing at `place`, paused: how every start leaves it.
    pub(crate) fn paused(
        now: Instant,
        script_id: String,
        paragraphs: Arc<Vec<PrompterParagraph>>,
        layout_key: String,
        place: PrompterPlace,
        speed_wpm: u32,
    ) -> Self {
        let place = place.clamped(&paragraphs);
        Self {
            script_id,
            paragraphs,
            layout_key,
            layout: None,
            motion: Motion::resting(now, place, 0.0),
            playing: false,
            speed_wpm,
        }
    }

    pub(crate) fn paragraph_count(&self) -> u32 {
        self.paragraphs.len() as u32
    }

    /// The reading line's position at `now`, when laid out.
    pub(crate) fn position_at(&self, now: Instant) -> Option<f64> {
        let layout = self.layout.as_ref()?;
        let base = layout.position_of(
            self.motion.place,
            self.motion.fraction,
            self.paragraph_count(),
        );
        let advanced = self.motion.words_advanced(self.motion.elapsed_ms(now));
        Some((base + advanced * layout.px_per_read_word).min(layout.end_top))
    }

    /// The place at `now` and how far down its line: from the layout when
    /// there is one, else by counting the read words the text has moved.
    pub(crate) fn place_at(&self, now: Instant) -> (PrompterPlace, f64) {
        match (self.position_at(now), self.layout.as_ref()) {
            (Some(position), Some(layout)) => layout.place_at(position, self.paragraph_count()),
            _ => {
                let advanced = self.motion.words_advanced(self.motion.elapsed_ms(now));
                if advanced < 1.0 {
                    (self.motion.place, self.motion.fraction)
                } else {
                    (
                        advance_by_read_words(
                            &self.paragraphs,
                            self.motion.place,
                            advanced.floor() as usize,
                        ),
                        0.0,
                    )
                }
            }
        }
    }

    pub(crate) fn at_end(&self, now: Instant) -> bool {
        self.place_at(now).0.paragraph >= self.paragraph_count()
    }

    /// Folds the motion so far into a new anchor at `now`, keeping the pace
    /// and what is left of an ease.
    fn rebase(&mut self, now: Instant) {
        let elapsed = self.motion.elapsed_ms(now);
        let (place, fraction) = self.place_at(now);
        let speed = self.motion.speed_at(elapsed);
        let ramp_left = (self.motion.ramp_ms - elapsed).max(0.0);
        self.motion = Motion {
            at: now,
            place,
            fraction,
            from_wpm: speed,
            to_wpm: self.motion.to_wpm,
            ramp_ms: ramp_left,
            move_from: None,
        };
    }

    /// `PLAY`: from where the reading line is, easing up to the pace. The
    /// caller refuses a play at the end or without a layout.
    pub(crate) fn play(&mut self, now: Instant) {
        self.rebase(now);
        self.motion.to_wpm = f64::from(self.speed_wpm);
        self.motion.ramp_ms = RAMP_MS;
        self.playing = true;
    }

    /// Pause: the text eases to a stop over 0.3 s.
    pub(crate) fn pause(&mut self, now: Instant) {
        if !self.playing {
            return;
        }
        self.rebase(now);
        self.motion.to_wpm = 0.0;
        self.motion.ramp_ms = RAMP_MS;
        self.playing = false;
    }

    /// A new pace: eased to at once while playing, else kept for the next
    /// play.
    pub(crate) fn set_speed(&mut self, now: Instant, speed_wpm: u32) {
        self.speed_wpm = speed_wpm;
        if self.playing {
            self.rebase(now);
            self.motion.to_wpm = f64::from(speed_wpm);
            self.motion.ramp_ms = RAMP_MS;
        }
    }

    /// A jump to `place` (`fraction` of its line down): the place is the
    /// target at once, the glass draws a 0.2 s move, and the scroll goes on
    /// as it was — or stops when `pause` (`TOP`).
    pub(crate) fn jump(&mut self, now: Instant, place: PrompterPlace, fraction: f64, pause: bool) {
        let from = self.position_at(now);
        if pause {
            self.playing = false;
        }
        let speed = if self.playing {
            f64::from(self.speed_wpm)
        } else {
            0.0
        };
        self.motion = Motion {
            at: now,
            place: place.clamped(&self.paragraphs),
            fraction,
            from_wpm: speed,
            to_wpm: speed,
            ramp_ms: 0.0,
            move_from: from,
        };
    }

    /// The glass is to be laid out again (a new look or size): the words at
    /// the reading line are kept, and the motion goes on in words until the
    /// new layout is reported.
    pub(crate) fn relayout(&mut self, now: Instant, layout_key: String) {
        self.rebase(now);
        self.layout = None;
        self.layout_key = layout_key;
    }

    /// New text on the glass (an Update): the place is `place` in the new
    /// text, the scroll goes on as it was, and the layout waits for the view.
    pub(crate) fn replace_text(
        &mut self,
        now: Instant,
        paragraphs: Arc<Vec<PrompterParagraph>>,
        layout_key: String,
        place: PrompterPlace,
    ) {
        let (_, fraction) = self.place_at(now);
        self.rebase(now);
        self.paragraphs = paragraphs;
        self.motion.place = place.clamped(&self.paragraphs);
        self.motion.fraction = if place == self.motion.place {
            fraction
        } else {
            0.0
        };
        self.layout = None;
        self.layout_key = layout_key;
    }

    /// A reported layout for the glass as it is now: the anchor moves into
    /// its pixels at `now`, the motion so far kept.
    pub(crate) fn accept_layout(&mut self, now: Instant, layout: Layout) {
        let elapsed = self.motion.elapsed_ms(now);
        let base = layout.position_of(
            self.motion.place,
            self.motion.fraction,
            self.paragraph_count(),
        );
        let position = (base + self.motion.words_advanced(elapsed) * layout.px_per_read_word)
            .min(layout.end_top);
        let (place, fraction) = layout.place_at(position, self.paragraph_count());
        self.motion = Motion {
            at: now,
            place,
            fraction,
            from_wpm: self.motion.speed_at(elapsed),
            to_wpm: self.motion.to_wpm,
            ramp_ms: (self.motion.ramp_ms - elapsed).max(0.0),
            move_from: None,
        };
        self.layout = Some(layout);
    }

    /// Stops the text at `END` once the reading line has reached it: `PLAY`
    /// goes out and the text stands there (§5.4). True when it stopped now.
    pub(crate) fn settle(&mut self, now: Instant) -> bool {
        let moving = self.motion.moving(self.motion.elapsed_ms(now));
        if !moving || !self.at_end(now) {
            return false;
        }
        self.playing = false;
        self.motion = Motion::resting(now, PrompterPlace::end_of(&self.paragraphs), 0.0);
        true
    }

    /// How long until the text reaches `END` at the motion it has, for the
    /// timer; `None` when it does not move or is not laid out.
    pub(crate) fn time_to_end_ms(&self, now: Instant) -> Option<f64> {
        let layout = self.layout.as_ref()?;
        if !self.motion.moving(self.motion.elapsed_ms(now)) || self.motion.to_wpm <= 0.0 {
            return None;
        }
        let base = layout.position_of(
            self.motion.place,
            self.motion.fraction,
            self.paragraph_count(),
        );
        let reached = |elapsed: f64| {
            base + self.motion.words_advanced(elapsed) * layout.px_per_read_word >= layout.end_top
        };
        let started = self.motion.elapsed_ms(now);
        if reached(started) {
            return Some(0.0);
        }
        let mut high = started + 1000.0;
        while !reached(high) {
            high = started + (high - started) * 2.0;
            if high - started > 1.0e9 {
                return None;
            }
        }
        let mut low = started;
        for _ in 0..60 {
            let middle = (low + high) / 2.0;
            if reached(middle) {
                high = middle;
            } else {
                low = middle;
            }
        }
        Some(high - started)
    }

    /// The time left until `END` reaches the reading line at the script's
    /// pace (§5.3), in seconds, and whether it is only estimated from the
    /// words (no layout yet).
    pub(crate) fn time_left(&self, now: Instant) -> (f64, bool) {
        let pace = f64::from(self.speed_wpm.max(1));
        match (self.position_at(now), self.layout.as_ref()) {
            (Some(position), Some(layout)) => {
                let pixels_a_second = layout.px_per_read_word * pace / 60.0;
                (
                    ((layout.end_top - position) / pixels_a_second).max(0.0),
                    false,
                )
            }
            _ => {
                let (place, _) = self.place_at(now);
                (
                    read_words_from(&self.paragraphs, place) as f64 * 60.0 / pace,
                    true,
                )
            }
        }
    }

    /// The whole script's length at its pace, from the top to `END`.
    pub(crate) fn length(&self) -> (f64, bool) {
        let pace = f64::from(self.speed_wpm.max(1));
        match self.layout.as_ref() {
            Some(layout) => {
                let pixels_a_second = layout.px_per_read_word * pace / 60.0;
                (
                    (layout.end_top - layout.lines[0].top) / pixels_a_second,
                    false,
                )
            }
            None => (
                read_words_from(&self.paragraphs, PrompterPlace::TOP) as f64 * 60.0 / pace,
                true,
            ),
        }
    }

    /// The anchor as a view reads it at `now`.
    pub(crate) fn anchor(&self, now: Instant) -> PrompterAnchor {
        let layout = self.layout.as_ref();
        let age_ms = self.motion.elapsed_ms(now);
        PrompterAnchor {
            layout_key: self.layout_key.clone(),
            place: self.motion.place,
            line_fraction: self.motion.fraction,
            position: layout.map(|layout| {
                layout.position_of(
                    self.motion.place,
                    self.motion.fraction,
                    self.paragraph_count(),
                )
            }),
            end_position: layout.map(|layout| layout.end_top),
            px_per_read_word: layout.map(|layout| layout.px_per_read_word),
            playing: self.playing,
            at_end: self.at_end(now),
            from_wpm: self.motion.from_wpm,
            to_wpm: self.motion.to_wpm,
            ramp_ms: self.motion.ramp_ms,
            move_from_position: self.motion.move_from,
            move_ms: if self.motion.move_from.is_some() {
                JUMP_MOVE_MS
            } else {
                0.0
            },
            age_ms,
        }
    }

    /// Whether the reading line stands at the start of its line.
    pub(crate) fn at_line_start(&self, now: Instant) -> bool {
        self.place_at(now).1 < AT_LINE_START
    }
}

/// The read words from `place` to the end.
pub(crate) fn read_words_from(paragraphs: &[PrompterParagraph], place: PrompterPlace) -> usize {
    paragraphs
        .iter()
        .enumerate()
        .skip(place.paragraph as usize)
        .map(|(index, paragraph)| {
            let skip = if index == place.paragraph as usize {
                place.word as usize
            } else {
                0
            };
            read_flags(paragraph)
                .into_iter()
                .skip(skip)
                .filter(|read| *read)
                .count()
        })
        .sum()
}

/// The place `words` read words on from `place`; the end when the script
/// runs out first.
pub(crate) fn advance_by_read_words(
    paragraphs: &[PrompterParagraph],
    place: PrompterPlace,
    words: usize,
) -> PrompterPlace {
    let mut left = words;
    for (index, paragraph) in paragraphs.iter().enumerate().skip(place.paragraph as usize) {
        let start = if index == place.paragraph as usize {
            place.word as usize
        } else {
            0
        };
        for (word, read) in read_flags(paragraph).into_iter().enumerate().skip(start) {
            if left == 0 {
                return PrompterPlace {
                    paragraph: index as u32,
                    word: word as u32,
                };
            }
            if read {
                left -= 1;
            }
        }
    }
    PrompterPlace::end_of(paragraphs)
}

/// A pace inside 40–300 words a minute on a 5-word step.
pub(crate) fn speed_is_valid(speed_wpm: u32) -> bool {
    (SPEED_MIN_WPM..=SPEED_MAX_WPM).contains(&speed_wpm) && speed_wpm.is_multiple_of(SPEED_STEP_WPM)
}

#[cfg(test)]
mod tests;
