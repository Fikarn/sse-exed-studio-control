//! `.docx`: Word's document, a zip of XML parts (`word/document.xml`, with
//! `word/styles.xml` for the headings and `word/numbering.xml` for the lists).

use super::{ImportRefusal, ImportedText};

pub(super) fn read_docx(bytes: &[u8]) -> Result<ImportedText, ImportRefusal> {
    let _ = super::zip::read_entry(bytes, "word/document.xml", 0);
    Err(ImportRefusal::Unreadable(String::from("not read yet")))
}
