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
//! text boxes, headers and footers, footnotes and comments; a table's cells
//! come in row by row, one paragraph each; tracked changes come in as if
//! accepted. The import sentence counts what was left out.

mod docx;
mod html;
mod txt;
mod zip;

use crate::prompter::model::{
    counted, cue_targets, format_count, word_count, PrompterParagraph, MAX_IMPORT_BYTES,
    MAX_SCRIPT_WORDS,
};

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
    pub comments: usize,
    pub footnotes: usize,
    pub headers_and_footers: usize,
}

impl LeftOut {
    fn phrases(&self) -> Vec<String> {
        [
            (self.pictures, "picture", "pictures"),
            (self.text_boxes, "text box", "text boxes"),
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
    /// Over `MAX_IMPORT_BYTES`.
    TooLarge { bytes: usize },
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
            Self::TooLarge { bytes } => format!(
                "{source} is {} MB; Studio Control opens files up to {} MB.",
                bytes.div_ceil(1024 * 1024),
                MAX_IMPORT_BYTES / (1024 * 1024)
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
        return Err(ImportRefusal::TooLarge { bytes: size });
    }
    if let Some(html) = html.filter(|html| !html.trim().is_empty()) {
        let imported = html::read_html(html);
        if !imported.paragraphs.is_empty() {
            return checked(imported);
        }
    }
    checked(txt::read_plain(text))
}

fn checked(imported: ImportedText) -> Result<ImportedText, ImportRefusal> {
    if imported.paragraphs.is_empty() {
        return Err(ImportRefusal::Empty);
    }
    let words = word_count(&imported.paragraphs);
    if words > MAX_SCRIPT_WORDS {
        return Err(ImportRefusal::TooLong { words });
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

#[cfg(test)]
mod tests;
