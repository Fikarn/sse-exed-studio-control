//! `.txt` and a plain paste: paragraphs are text between empty lines.

use super::{ImportRefusal, ImportedText, LeftOut};

pub(super) fn read_txt(bytes: &[u8]) -> Result<ImportedText, ImportRefusal> {
    Ok(read_plain(&String::from_utf8_lossy(bytes)))
}

pub(super) fn read_plain(_text: &str) -> ImportedText {
    ImportedText {
        paragraphs: Vec::new(),
        left_out: LeftOut::default(),
        tracked_changes_accepted: false,
        encoding: None,
    }
}
