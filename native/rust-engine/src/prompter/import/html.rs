//! A paste that held formatting: the clipboard's HTML (Word, a browser,
//! Google Docs).

use super::{ImportedText, LeftOut};

pub(super) fn read_html(_html: &str) -> ImportedText {
    ImportedText {
        paragraphs: Vec::new(),
        left_out: LeftOut::default(),
        tracked_changes_accepted: false,
        encoding: None,
    }
}
