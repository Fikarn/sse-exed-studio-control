//! The prompter's script model (new pages program, Slice 4; the Teleprompter
//! proposal, `docs/redesign/teleprompter-2026-09.md`, §3 and §4.2).
//!
//! A script is a list of paragraphs, and a paragraph a list of runs that keep
//! the presenter's emphasis — bold, italic, underline — and nothing else of a
//! page's look (§3.2). A line break inside a paragraph is a `\n` in a run's
//! text.
//!
//! **Words.** A word is a maximal run of characters that are not white space
//! (`char::is_whitespace`). The place is a paragraph and the index of a word
//! in it (§5.2), so the front end, which reports the layout line by line
//! (`prompter.layout.report`), counts words the same way: `/\S+/gu` in
//! JavaScript. The two definitions of white space differ only at U+0085 and
//! U+FEFF, and `sanitize_text` takes both out of every text that comes in.
//!
//! **Cues.** A cue is text in square brackets on one line (§4.2): `[PAUSE]`,
//! `[look at CAM 2]`. A Word heading becomes one on import. A line whose text
//! is a cue and nothing else is a jump target; a cue inside a sentence is only
//! drawn in the cue colour. A cue is never read aloud, so its words do not
//! count towards the pace (`read_word_count`).

use serde::{Deserialize, Serialize};

/// The longest script: about 3½ hours at 140 words a minute (§3.2).
pub(crate) const MAX_SCRIPT_WORDS: usize = 30_000;
/// The largest file the page may send, and the largest paste.
pub(crate) const MAX_IMPORT_BYTES: usize = 20 * 1024 * 1024;
/// The longest name a script keeps.
pub(crate) const MAX_SCRIPT_NAME_CHARS: usize = 80;

/// One run of text with the emphasis it keeps.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct PrompterRun {
    pub text: String,
    #[serde(default)]
    pub bold: bool,
    #[serde(default)]
    pub italic: bool,
    #[serde(default)]
    pub underline: bool,
}

impl PrompterRun {
    pub(crate) fn plain(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            ..Self::default()
        }
    }

    fn same_marks(&self, other: &Self) -> bool {
        self.bold == other.bold && self.italic == other.italic && self.underline == other.underline
    }
}

/// One paragraph: the unit of the place and of the jumps (§4.2).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct PrompterParagraph {
    pub runs: Vec<PrompterRun>,
}

impl PrompterParagraph {
    pub(crate) fn plain(text: impl Into<String>) -> Self {
        Self {
            runs: vec![PrompterRun::plain(text)],
        }
    }

    /// The paragraph's text, its runs joined.
    pub(crate) fn text(&self) -> String {
        self.runs.iter().map(|run| run.text.as_str()).collect()
    }

    /// Whether the paragraph holds no word at all.
    pub(crate) fn is_blank(&self) -> bool {
        self.runs.iter().all(|run| run.text.trim().is_empty())
    }

    /// The same paragraph with neighbouring runs of the same emphasis joined
    /// and empty runs left out, so a stored script carries no noise.
    pub(crate) fn normalized(&self) -> Self {
        let mut runs: Vec<PrompterRun> = Vec::with_capacity(self.runs.len());
        for run in &self.runs {
            if run.text.is_empty() {
                continue;
            }
            match runs.last_mut() {
                Some(last) if last.same_marks(run) => last.text.push_str(&run.text),
                _ => runs.push(run.clone()),
            }
        }
        Self { runs }
    }
}

/// Takes out of an incoming text what the two word counts would read
/// differently or what the glass cannot draw: U+FEFF goes, U+0085, U+2028,
/// U+2029, a carriage return and a CR LF become a line break, a tab becomes a
/// space, and any other control character goes.
pub(crate) fn sanitize_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut characters = text.chars().peekable();
    while let Some(character) = characters.next() {
        match character {
            '\u{FEFF}' => {}
            '\r' => {
                if characters.peek() == Some(&'\n') {
                    characters.next();
                }
                out.push('\n');
            }
            '\u{0085}' | '\u{2028}' | '\u{2029}' => out.push('\n'),
            '\t' => out.push(' '),
            '\n' => out.push('\n'),
            other if other.is_control() => {}
            other => out.push(other),
        }
    }
    out
}

/// The byte ranges of the words in `text`.
pub(crate) fn word_spans(text: &str) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    let mut start: Option<usize> = None;
    for (index, character) in text.char_indices() {
        if character.is_whitespace() {
            if let Some(begin) = start.take() {
                spans.push((begin, index));
            }
        } else if start.is_none() {
            start = Some(index);
        }
    }
    if let Some(begin) = start {
        spans.push((begin, text.len()));
    }
    spans
}

/// The byte ranges of the cues in `text`, brackets included: a `[` and the
/// next `]` on the same line. A `[` with no `]` before the line ends is text.
pub(crate) fn cue_spans(text: &str) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    let mut open: Option<usize> = None;
    for (index, character) in text.char_indices() {
        match character {
            '[' if open.is_none() => open = Some(index),
            ']' => {
                if let Some(begin) = open.take() {
                    spans.push((begin, index + 1));
                }
            }
            '\n' => open = None,
            _ => {}
        }
    }
    spans
}

/// How many words a paragraph has, cues included: the place's word index
/// runs over these.
pub(crate) fn paragraph_word_count(paragraph: &PrompterParagraph) -> usize {
    word_spans(&paragraph.text()).len()
}

/// Every word of a script, cues included: the length limit counts these.
pub(crate) fn word_count(paragraphs: &[PrompterParagraph]) -> usize {
    paragraphs.iter().map(paragraph_word_count).sum()
}

/// For each word of a paragraph, whether the presenter reads it: a word
/// with a character outside every cue. A word that is all cue (`[PAUSE]`,
/// `[look`, `CAM 2]`) is a direction, never read aloud.
pub(crate) fn read_flags(paragraph: &PrompterParagraph) -> Vec<bool> {
    let text = paragraph.text();
    let cues = cue_spans(&text);
    word_spans(&text)
        .into_iter()
        .map(|(begin, end)| {
            text[begin..end].char_indices().any(|(offset, _)| {
                let at = begin + offset;
                !cues
                    .iter()
                    .any(|(cue_begin, cue_end)| at >= *cue_begin && at < *cue_end)
            })
        })
        .collect()
}

/// The words the presenter reads: every word outside a cue. The pace, the
/// length at a pace and the time left count these.
pub(crate) fn read_word_count(paragraphs: &[PrompterParagraph]) -> usize {
    paragraphs
        .iter()
        .map(|paragraph| {
            read_flags(paragraph)
                .into_iter()
                .filter(|read| *read)
                .count()
        })
        .sum()
}

/// A cue on a line of its own, which a jump can go to (§4.2, §6.2).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CueTarget {
    /// The paragraph, from 0.
    pub paragraph: usize,
    /// The index of the cue's first word in the paragraph.
    pub word: usize,
    /// The cue's words, brackets taken off.
    pub text: String,
}

/// Every cue on a line of its own, in the script's order.
pub(crate) fn cue_targets(paragraphs: &[PrompterParagraph]) -> Vec<CueTarget> {
    let mut targets = Vec::new();
    for (paragraph_index, paragraph) in paragraphs.iter().enumerate() {
        let text = paragraph.text();
        let mut line_start = 0;
        for line in text.split('\n') {
            let trimmed = line.trim();
            let is_cue = trimmed.len() >= 2 && cue_spans(trimmed) == vec![(0, trimmed.len())];
            if is_cue {
                let first_word_offset = line_start + (line.len() - line.trim_start().len());
                let word = word_spans(&text)
                    .iter()
                    .position(|(begin, _)| *begin == first_word_offset)
                    .unwrap_or(0);
                targets.push(CueTarget {
                    paragraph: paragraph_index,
                    word,
                    text: trimmed[1..trimmed.len() - 1].trim().to_string(),
                });
            }
            line_start += line.len() + 1;
        }
    }
    targets
}

/// A count as the operator reads it: `1,240`.
pub(crate) fn format_count(count: usize) -> String {
    let digits = count.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            out.push(',');
        }
        out.push(digit);
    }
    out
}

/// `1 paragraph`, `18 paragraphs`, with the count as `format_count` writes it.
pub(crate) fn counted(count: usize, singular: &str, plural: &str) -> String {
    if count == 1 {
        format!("1 {singular}")
    } else {
        format!("{} {plural}", format_count(count))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paragraph(text: &str) -> PrompterParagraph {
        PrompterParagraph::plain(text)
    }

    #[test]
    fn words_are_runs_of_characters_that_are_not_white_space() {
        let text = "  Hej  då,\nvärlden\u{00A0}igen ";
        let words: Vec<&str> = word_spans(text)
            .into_iter()
            .map(|(begin, end)| &text[begin..end])
            .collect();
        assert_eq!(words, ["Hej", "då,", "världen", "igen"]);
    }

    #[test]
    fn a_cue_is_bracketed_text_on_one_line() {
        let text = "Say [PAUSE] then [look at\nCAM 2] and [end]";
        let cues: Vec<&str> = cue_spans(text)
            .into_iter()
            .map(|(begin, end)| &text[begin..end])
            .collect();
        assert_eq!(cues, ["[PAUSE]", "[end]"]);
    }

    #[test]
    fn cue_words_do_not_count_towards_the_pace() {
        let script = [
            paragraph("[INTRO]"),
            paragraph("Welcome to the studio [smile] today."),
        ];
        assert_eq!(word_count(&script), 7);
        assert_eq!(read_word_count(&script), 5);
    }

    #[test]
    fn only_a_cue_on_a_line_of_its_own_is_a_jump_target() {
        let script = [
            paragraph("[ Intro ]"),
            paragraph("Hello [smile] there.\n[PAUSE]\nAgain."),
        ];
        assert_eq!(
            cue_targets(&script),
            vec![
                CueTarget {
                    paragraph: 0,
                    word: 0,
                    text: String::from("Intro"),
                },
                CueTarget {
                    paragraph: 1,
                    word: 3,
                    text: String::from("PAUSE"),
                },
            ]
        );
    }

    #[test]
    fn sanitizing_leaves_one_kind_of_line_break_and_no_controls() {
        assert_eq!(
            sanitize_text("\u{FEFF}a\r\nb\rc\u{2028}d\te\u{0007}f\u{0085}g"),
            "a\nb\nc\nd ef\ng"
        );
    }

    #[test]
    fn normalizing_joins_runs_of_the_same_emphasis() {
        let paragraph = PrompterParagraph {
            runs: vec![
                PrompterRun::plain("Hello "),
                PrompterRun::plain(""),
                PrompterRun::plain("there "),
                PrompterRun {
                    text: String::from("now"),
                    bold: true,
                    ..PrompterRun::default()
                },
            ],
        };
        assert_eq!(
            paragraph.normalized().runs,
            vec![
                PrompterRun::plain("Hello there "),
                PrompterRun {
                    text: String::from("now"),
                    bold: true,
                    ..PrompterRun::default()
                },
            ]
        );
    }

    #[test]
    fn counts_read_as_the_operator_writes_them() {
        assert_eq!(format_count(7), "7");
        assert_eq!(format_count(1240), "1,240");
        assert_eq!(format_count(30000), "30,000");
        assert_eq!(format_count(1234567), "1,234,567");
        assert_eq!(counted(1, "cue", "cues"), "1 cue");
        assert_eq!(counted(1240, "word", "words"), "1,240 words");
    }
}
