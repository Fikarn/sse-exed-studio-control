//! `.txt` and a plain paste: paragraphs are text between empty lines.
//!
//! A `.txt` carries no word of its encoding, so the bytes decide (§3.2): a
//! byte-order mark names UTF-8 or UTF-16; else valid UTF-8 is UTF-8 (plain
//! ASCII is both); else the file is Windows-1252, what Notepad and Word save
//! as "ANSI" on a Swedish or English Windows. The import sentence names the
//! encoding, so å, ä and ö never arrive broken without a word.

use super::{finished_paragraph, ImportRefusal, ImportedText, LeftOut, TextEncoding};
use crate::prompter::model::{sanitize_text, PrompterParagraph, PrompterRun};

/// A file whose bytes are not text.
const NOT_TEXT: ImportRefusal = ImportRefusal::NotWhatItsNameSays { expected: ".txt" };
const UTF8_BOM: &[u8] = &[0xEF, 0xBB, 0xBF];
const UTF16_LE_BOM: &[u8] = &[0xFF, 0xFE];
const UTF16_BE_BOM: &[u8] = &[0xFE, 0xFF];

/// Windows-1252 at 0x80–0x9F, where it differs from Latin-1; `None` for the
/// five bytes it leaves undefined. 0xA0–0xFF are Latin-1.
const WINDOWS_1252_HIGH: [Option<char>; 32] = [
    Some('€'),
    None,
    Some('‚'),
    Some('ƒ'),
    Some('„'),
    Some('…'),
    Some('†'),
    Some('‡'),
    Some('ˆ'),
    Some('‰'),
    Some('Š'),
    Some('‹'),
    Some('Œ'),
    None,
    Some('Ž'),
    None,
    None,
    Some('‘'),
    Some('’'),
    Some('“'),
    Some('”'),
    Some('•'),
    Some('–'),
    Some('—'),
    Some('˜'),
    Some('™'),
    Some('š'),
    Some('›'),
    Some('œ'),
    None,
    Some('ž'),
    Some('Ÿ'),
];

/// Reads a `.txt`'s bytes. A text holding U+0000 is refused: that is a
/// binary file (a picture, a zip, a Word document) with a `.txt` name, which
/// no text editor writes.
pub(super) fn read_txt(bytes: &[u8]) -> Result<ImportedText, ImportRefusal> {
    let (text, encoding) = if let Some(rest) = bytes.strip_prefix(UTF8_BOM) {
        // A file that says it is UTF-8 is read as UTF-8; a damaged byte shows
        // as U+FFFD rather than turning the whole file into Windows-1252.
        (
            String::from_utf8_lossy(rest).into_owned(),
            TextEncoding::Utf8,
        )
    } else if let Some(rest) = bytes.strip_prefix(UTF16_LE_BOM) {
        (utf16(rest, false).ok_or(NOT_TEXT)?, TextEncoding::Utf16)
    } else if let Some(rest) = bytes.strip_prefix(UTF16_BE_BOM) {
        (utf16(rest, true).ok_or(NOT_TEXT)?, TextEncoding::Utf16)
    } else if let Ok(text) = std::str::from_utf8(bytes) {
        (text.to_string(), TextEncoding::Utf8)
    } else {
        (windows_1252(bytes), TextEncoding::Windows1252)
    };
    if text.contains('\0') {
        return Err(NOT_TEXT);
    }
    let mut imported = read_plain(&text);
    imported.encoding = Some(encoding);
    Ok(imported)
}

/// Reads plain text: a `.txt` once decoded, or a paste that held no
/// formatting (`encoding` stays `None`). A paragraph is the text between empty
/// lines (a line that is empty or only white space); a single line break
/// inside a paragraph stays a line break. Square brackets stay as they are:
/// they are cues by the model's rule (§4.2).
pub(super) fn read_plain(text: &str) -> ImportedText {
    let mut paragraphs = Vec::new();
    let mut lines: Vec<&str> = Vec::new();
    let sanitized = sanitize_text(text);
    for line in sanitized.split('\n') {
        if line.trim().is_empty() {
            push_lines(&mut paragraphs, &mut lines);
        } else {
            lines.push(line);
        }
    }
    push_lines(&mut paragraphs, &mut lines);
    ImportedText {
        paragraphs,
        left_out: LeftOut::default(),
        tracked_changes_accepted: false,
        encoding: None,
    }
}

fn push_lines(paragraphs: &mut Vec<PrompterParagraph>, lines: &mut Vec<&str>) {
    if lines.is_empty() {
        return;
    }
    let text = lines.join("\n");
    lines.clear();
    if let Some(paragraph) = finished_paragraph(vec![PrompterRun::plain(text)]) {
        paragraphs.push(paragraph);
    }
}

/// UTF-16 after its byte-order mark; `None` for an odd number of bytes or a
/// lone surrogate, which no UTF-16 text holds. Also used for an XML part in
/// UTF-16 (`docx.rs`).
pub(super) fn utf16(bytes: &[u8], big_endian: bool) -> Option<String> {
    if !bytes.len().is_multiple_of(2) {
        return None;
    }
    let units = bytes.chunks_exact(2).map(|pair| {
        if big_endian {
            u16::from_be_bytes([pair[0], pair[1]])
        } else {
            u16::from_le_bytes([pair[0], pair[1]])
        }
    });
    char::decode_utf16(units)
        .collect::<Result<String, _>>()
        .ok()
}

/// A byte as Windows-1252; `None` for the five bytes it leaves undefined.
/// Also used for an HTML numeric reference in 128–159 (`html.rs`), which the
/// HTML standard reads the same way.
pub(super) fn windows_1252_char(byte: u8) -> Option<char> {
    match byte {
        0x80..=0x9F => WINDOWS_1252_HIGH[usize::from(byte - 0x80)],
        other => Some(char::from(other)),
    }
}

fn windows_1252(bytes: &[u8]) -> String {
    bytes
        .iter()
        .filter_map(|&byte| windows_1252_char(byte))
        .collect()
}
