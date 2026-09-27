//! The Teleprompter's import (new pages program, Slice 4; the proposal §3.1
//! and §3.2). The hardware link reads the file itself: Word does not have to be
//! installed, and nothing is sent anywhere. The page sends a file's name and
//! its bytes (the operator's answer of 2026-09-27, first step 2a) or the
//! clipboard's HTML and plain text (first step 3a); no path is ever named.
//!
//! - `.docx`: `docx.rs`, over the zip reader in `zip.rs`.
//! - `.txt`: `txt.rs` — UTF-8, UTF-16 with its byte-order mark, else
//!   Windows-1252.
//! - pasted text: `html.rs` when the clipboard holds formatting, else the
//!   `.txt` rules.
//!
//! Kept: the text and its paragraphs, a line break inside a paragraph, bold,
//! italic and underline, Word headings as cues, bullets and numbering as a
//! dash or the number. Dropped: fonts, sizes, colours, highlighting, pictures,
//! text boxes, embedded documents, headers and footers, footnotes and
//! comments, hidden text; a table's cells come in row by row, one paragraph
//! each; tracked changes come in as if accepted. The import sentence counts
//! what was left out.
//!
//! White space is collapsed as each paragraph is built (`finished_paragraph`):
//! a run of it inside a line is one space, and a run of line breaks at most
//! one blank line. A script's text is capped (`MAX_SCRIPT_TEXT_BYTES`) as well
//! as its words, so one enormous word cannot pass.

mod docx;
mod html;
mod txt;
mod zip;

use crate::prompter::model::{
    counted, cue_spans, cue_targets, format_count, sanitize_text, word_count, PrompterParagraph,
    PrompterRun, MAX_IMPORT_BYTES, MAX_SCRIPT_WORDS,
};

/// The most text a script may hold once imported. A 30,000-word script is
/// about 0.2 MB.
pub(crate) const MAX_SCRIPT_TEXT_BYTES: usize = 2 * 1024 * 1024;
const MEGABYTE: usize = 1024 * 1024;

/// What a file or a paste held, ready to become a script.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ImportedText {
    /// Every paragraph that holds a word, normalized
    /// (`PrompterParagraph::normalized`) and sanitized (`sanitize_text`).
    pub paragraphs: Vec<PrompterParagraph>,
    /// What the import sentence counts as left out.
    pub left_out: LeftOut,
    /// Whether the document held tracked changes, taken as accepted.
    pub tracked_changes_accepted: bool,
    /// Which encoding a `.txt` or a plain paste was read as.
    pub encoding: Option<TextEncoding>,
}

/// What an import leaves out and counts (§3.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct LeftOut {
    pub pictures: usize,
    pub text_boxes: usize,
    /// Word's `w:altChunk`: another document (HTML, RTF, a `.docx`) kept
    /// whole inside this one.
    pub embedded_documents: usize,
    pub comments: usize,
    pub footnotes: usize,
    pub headers_and_footers: usize,
}

impl LeftOut {
    fn phrases(&self) -> Vec<String> {
        [
            (self.pictures, "picture", "pictures"),
            (self.text_boxes, "text box", "text boxes"),
            (
                self.embedded_documents,
                "embedded document",
                "embedded documents",
            ),
            (self.comments, "comment", "comments"),
            (self.footnotes, "footnote", "footnotes"),
            (
                self.headers_and_footers,
                "header or footer",
                "headers and footers",
            ),
        ]
        .into_iter()
        .filter(|(count, _, _)| *count > 0)
        .map(|(count, singular, plural)| counted(count, singular, plural))
        .collect()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TextEncoding {
    Utf8,
    Utf16,
    Windows1252,
}

impl TextEncoding {
    fn name(self) -> &'static str {
        match self {
            Self::Utf8 => "UTF-8",
            Self::Utf16 => "UTF-16",
            Self::Windows1252 => "Windows-1252",
        }
    }
}

/// Why a file or a paste was refused. Each has one sentence the operator
/// reads (`sentence`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ImportRefusal {
    /// A `.doc`: Word's old format.
    OldWordFormat,
    /// A `.docx` that Word saved with a password.
    PasswordProtected,
    /// A file whose bytes are not what its name says (`expected` is `.docx`
    /// or `.txt`).
    NotWhatItsNameSays { expected: &'static str },
    /// A name that ends in anything but `.docx` or `.txt` (`extension` as it
    /// was written, without the dot; empty when there is none).
    UnsupportedKind { extension: String },
    /// Over `MAX_SCRIPT_WORDS`.
    TooLong { words: usize },
    /// Text over `MAX_SCRIPT_TEXT_BYTES`, however few its words.
    TooMuchText { bytes: usize },
    /// A file over `MAX_IMPORT_BYTES`.
    TooLarge { bytes: usize },
    /// A paste over `MAX_IMPORT_BYTES`.
    PasteTooLarge { bytes: usize },
    /// No word in it.
    Empty,
    /// A damaged file: the reason in a few words.
    Unreadable(String),
}

impl ImportRefusal {
    /// The sentence the operator reads. `source` is the file's name, or
    /// "The pasted text" for a paste.
    pub(crate) fn sentence(&self, source: &str) -> String {
        match self {
            Self::OldWordFormat => format!(
                "{source} is in Word's old format (.doc), which Studio Control does not read. Save it as .docx in Word, then open that."
            ),
            Self::PasswordProtected => format!(
                "{source} is protected with a password. Save a copy without the password in Word, then open that."
            ),
            Self::NotWhatItsNameSays { expected } => format!(
                "{source} is not a {expected} file, whatever its name says. Save it again as {expected}, then open that."
            ),
            Self::UnsupportedKind { extension } if extension.is_empty() => format!(
                "{source} has no .docx or .txt at the end of its name. Studio Control opens Word documents (.docx) and plain text (.txt)."
            ),
            Self::UnsupportedKind { extension } => format!(
                "Studio Control does not open .{extension} files. Save the script as .docx or .txt, then open that."
            ),
            Self::TooLong { words } => format!(
                "{source} has {} words; a script can have up to {}. Split it into shorter scripts.",
                format_count(*words),
                format_count(MAX_SCRIPT_WORDS)
            ),
            Self::TooMuchText { .. } => format!(
                "{source} holds more text than a script can hold ({} MB). Split it into shorter scripts.",
                MAX_SCRIPT_TEXT_BYTES / MEGABYTE
            ),
            Self::TooLarge { bytes } => format!(
                "{source} is {} MB; Studio Control opens files up to {} MB.",
                bytes.div_ceil(MEGABYTE),
                MAX_IMPORT_BYTES / MEGABYTE
            ),
            Self::PasteTooLarge { bytes } => format!(
                "{source} is {} MB; Studio Control takes pastes up to {} MB.",
                bytes.div_ceil(MEGABYTE),
                MAX_IMPORT_BYTES / MEGABYTE
            ),
            Self::Empty => format!("{source} has no text in it."),
            Self::Unreadable(reason) => {
                format!("{source} could not be read: {reason}.")
            }
        }
    }
}

/// Reads a file the page's file picker sent, by the end of its name:
/// `.docx` or `.txt` (any case). `.doc`, `.pdf`, `.rtf` and the rest are
/// refused by name before a byte is read.
pub(crate) fn import_file(file_name: &str, bytes: &[u8]) -> Result<ImportedText, ImportRefusal> {
    if bytes.len() > MAX_IMPORT_BYTES {
        return Err(ImportRefusal::TooLarge { bytes: bytes.len() });
    }
    let extension = file_name
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase())
        .unwrap_or_default();
    let imported = match extension.as_str() {
        "docx" => docx::read_docx(bytes)?,
        "txt" => txt::read_txt(bytes)?,
        "doc" => return Err(ImportRefusal::OldWordFormat),
        _ => {
            return Err(ImportRefusal::UnsupportedKind {
                extension: file_name
                    .rsplit_once('.')
                    .map(|(_, extension)| extension.to_string())
                    .unwrap_or_default(),
            })
        }
    };
    checked(imported)
}

/// Reads what the page took from the clipboard: its HTML when it held
/// formatting (copied from Word, a browser, Google Docs), else its plain text.
/// HTML that yields no word falls back to the plain text.
pub(crate) fn import_paste(html: Option<&str>, text: &str) -> Result<ImportedText, ImportRefusal> {
    let size = html.map_or(0, str::len) + text.len();
    if size > MAX_IMPORT_BYTES {
        return Err(ImportRefusal::PasteTooLarge { bytes: size });
    }
    if let Some(html) = html.filter(|html| !html.trim().is_empty()) {
        let imported = html::read_html(html);
        if !imported.paragraphs.is_empty() {
            return checked(imported);
        }
    }
    checked(txt::read_plain(text))
}

/// The bytes of a script's text, the measure `MAX_SCRIPT_TEXT_BYTES` caps.
pub(crate) fn script_text_bytes(paragraphs: &[PrompterParagraph]) -> usize {
    paragraphs
        .iter()
        .flat_map(|paragraph| &paragraph.runs)
        .map(|run| run.text.len())
        .sum()
}

fn checked(imported: ImportedText) -> Result<ImportedText, ImportRefusal> {
    if imported.paragraphs.is_empty() {
        return Err(ImportRefusal::Empty);
    }
    let words = word_count(&imported.paragraphs);
    if words > MAX_SCRIPT_WORDS {
        return Err(ImportRefusal::TooLong { words });
    }
    let bytes = script_text_bytes(&imported.paragraphs);
    if bytes > MAX_SCRIPT_TEXT_BYTES {
        return Err(ImportRefusal::TooMuchText { bytes });
    }
    Ok(imported)
}

/// The import sentence (§3.2): "Imported Interview intro.docx: 18 paragraphs,
/// 1,240 words, 3 cues. Left out: 2 pictures, 1 comment. Tracked changes were
/// taken as accepted." `source` is the file's name, or "the pasted text".
pub(crate) fn import_sentence(source: &str, imported: &ImportedText) -> String {
    let paragraphs = &imported.paragraphs;
    let mut sentence = format!(
        "Imported {source}: {}, {}, {}.",
        counted(paragraphs.len(), "paragraph", "paragraphs"),
        counted(word_count(paragraphs), "word", "words"),
        counted(cue_targets(paragraphs).len(), "cue", "cues"),
    );
    let left_out = imported.left_out.phrases();
    if !left_out.is_empty() {
        sentence.push_str(&format!(" Left out: {}.", left_out.join(", ")));
    }
    if imported.tracked_changes_accepted {
        sentence.push_str(" Tracked changes were taken as accepted.");
    }
    if let Some(encoding) = imported.encoding {
        sentence.push_str(&format!(" Read as {}.", encoding.name()));
    }
    sentence
}

/// White space waiting in `finished_paragraph` for the next character that is
/// not white space, so none ends a line or the paragraph. It is only ever one
/// space or two line breaks, however long the run it stands for.
#[derive(Debug, Clone, Copy)]
enum Waiting {
    Nothing,
    /// White space inside a line: the run it began in, its first character,
    /// and whether more followed (then it is one plain space).
    Space {
        from: usize,
        first: char,
        more: bool,
    },
    /// Line breaks at a line's start, after the paragraph's first word: the
    /// run each began in, at most two (one blank line).
    Breaks {
        from: [usize; 2],
        count: usize,
    },
}

/// A paragraph as every reader hands it on: each run sanitized
/// (`sanitize_text`), the white space at both ends of each line taken off (a
/// ragged edge on the glass, which no source means), a run of white space
/// inside a line made one space (a lone no-break space stays), a run of line
/// breaks made at most one blank line, line breaks at the paragraph's start
/// and end taken off, neighbouring runs of the same emphasis joined. What is
/// waiting stays the same size whatever the text (`Waiting`). `None` when no
/// word is left: Word and HTML use empty paragraphs for spacing, and a script
/// keeps none.
fn finished_paragraph(runs: Vec<PrompterRun>) -> Option<PrompterParagraph> {
    let mut out: Vec<PrompterRun> = Vec::with_capacity(runs.len());
    // Line breaks wait only at a line's start and white space only after a
    // character, so `waiting` holds one kind or the other.
    let mut waiting = Waiting::Nothing;
    let mut at_line_start = true;
    let mut has_text = false;
    for run in runs {
        let text = sanitize_text(&run.text);
        out.push(PrompterRun {
            text: String::new(),
            ..run
        });
        let index = out.len() - 1;
        for character in text.chars() {
            if character == '\n' {
                if !at_line_start {
                    // The white space that ended the line.
                    waiting = Waiting::Nothing;
                }
                if has_text {
                    waiting = match waiting {
                        Waiting::Breaks { mut from, count } if count < 2 => {
                            from[count] = index;
                            Waiting::Breaks {
                                from,
                                count: count + 1,
                            }
                        }
                        Waiting::Breaks { .. } => waiting,
                        _ => Waiting::Breaks {
                            from: [index; 2],
                            count: 1,
                        },
                    };
                }
                at_line_start = true;
            } else if character.is_whitespace() {
                if !at_line_start {
                    waiting = match waiting {
                        Waiting::Space { from, first, .. } => Waiting::Space {
                            from,
                            first,
                            more: true,
                        },
                        _ => Waiting::Space {
                            from: index,
                            first: character,
                            more: false,
                        },
                    };
                }
            } else {
                match std::mem::replace(&mut waiting, Waiting::Nothing) {
                    Waiting::Nothing => {}
                    Waiting::Space { from, first, more } => {
                        out[from].text.push(if more { ' ' } else { first });
                    }
                    Waiting::Breaks { from, count } => {
                        for &from in &from[..count] {
                            out[from].text.push('\n');
                        }
                    }
                }
                out[index].text.push(character);
                at_line_start = false;
                has_text = true;
            }
        }
    }
    let paragraph = PrompterParagraph { runs: out }.normalized();
    (!paragraph.is_blank()).then_some(paragraph)
}

/// A Word heading or an HTML `h1`–`h6` as a cue (§4.2): its words on one line
/// in square brackets, so the heading is a jump target. A heading that already
/// is one cue stays as it is; square brackets inside any other become round
/// ones, so the cue cannot end early. The emphasis goes: a cue is drawn in the
/// cue colour and never read aloud.
fn cue_paragraph(runs: &[PrompterRun]) -> Option<PrompterParagraph> {
    let text: String = runs.iter().map(|run| run.text.as_str()).collect();
    let text = sanitize_text(&text);
    let words: Vec<&str> = text.split_whitespace().collect();
    if words.is_empty() {
        return None;
    }
    let line = words.join(" ");
    if cue_spans(&line) == [(0, line.len())] {
        return Some(PrompterParagraph::plain(line));
    }
    let inside = line.replace('[', "(").replace(']', ")");
    Some(PrompterParagraph::plain(format!("[{inside}]")))
}

#[cfg(test)]
mod test_support;

#[cfg(test)]
mod tests;

#[cfg(test)]
mod docx_tests;

#[cfg(test)]
mod fuzz;
