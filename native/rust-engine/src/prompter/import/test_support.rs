//! What the import's tests build their files with: a small zip writer and a
//! `.docx` made of it, so every test document is XML written in the test
//! itself and no binary fixture is committed.

use miniz_oxide::deflate::compress_to_vec;

use crate::prompter::model::{PrompterParagraph, PrompterRun};

/// The namespaces a Word document's root declares (the ones the tests use).
pub(super) const NAMESPACES: &str = concat!(
    r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" "#,
    r#"xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" "#,
    r#"xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" "#,
    r#"xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" "#,
    r#"xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" "#,
    r#"xmlns:v="urn:schemas-microsoft-com:vml" "#,
    r#"xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships""#
);

const MAIN_CONTENT_TYPE: &str =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";

/// One entry of a zip the tests write.
pub(super) struct Entry<'a> {
    pub name: &'a str,
    pub data: &'a [u8],
    pub deflated: bool,
    /// Sets the entry's encryption flag (the data is not encrypted).
    pub encrypted: bool,
}

impl<'a> Entry<'a> {
    pub(super) fn deflated(name: &'a str, data: &'a [u8]) -> Self {
        Self {
            name,
            data,
            deflated: true,
            encrypted: false,
        }
    }

    pub(super) fn stored(name: &'a str, data: &'a [u8]) -> Self {
        Self {
            deflated: false,
            ..Self::deflated(name, data)
        }
    }
}

/// A zip of `entries`: local headers and data, the central directory, the
/// end record.
pub(super) fn zip(entries: &[Entry<'_>]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut central = Vec::new();
    for entry in entries {
        let offset = u32::try_from(out.len()).expect("a test zip is small");
        let packed = if entry.deflated {
            compress_to_vec(entry.data, 6)
        } else {
            entry.data.to_vec()
        };
        let method: u16 = if entry.deflated { 8 } else { 0 };
        let flags: u16 = 0x0800 | u16::from(entry.encrypted);
        let crc = crc32(entry.data);
        let name = entry.name.as_bytes();
        let sizes = [packed.len(), entry.data.len()]
            .map(|size| u32::try_from(size).expect("a test entry is small"));
        let name_len = u16::try_from(name.len()).expect("a test name is short");

        out.extend_from_slice(&0x0403_4b50_u32.to_le_bytes());
        for field in [20, flags, method, 0, 0] {
            out.extend_from_slice(&field.to_le_bytes());
        }
        out.extend_from_slice(&crc.to_le_bytes());
        out.extend_from_slice(&sizes[0].to_le_bytes());
        out.extend_from_slice(&sizes[1].to_le_bytes());
        out.extend_from_slice(&name_len.to_le_bytes());
        out.extend_from_slice(&0_u16.to_le_bytes());
        out.extend_from_slice(name);
        out.extend_from_slice(&packed);

        central.extend_from_slice(&0x0201_4b50_u32.to_le_bytes());
        for field in [20, 20, flags, method, 0, 0] {
            central.extend_from_slice(&field.to_le_bytes());
        }
        central.extend_from_slice(&crc.to_le_bytes());
        central.extend_from_slice(&sizes[0].to_le_bytes());
        central.extend_from_slice(&sizes[1].to_le_bytes());
        for field in [name_len, 0, 0, 0, 0] {
            central.extend_from_slice(&field.to_le_bytes());
        }
        central.extend_from_slice(&0_u32.to_le_bytes());
        central.extend_from_slice(&offset.to_le_bytes());
        central.extend_from_slice(name);
    }
    let count = u16::try_from(entries.len()).expect("a test zip has few entries");
    let central_offset = u32::try_from(out.len()).expect("a test zip is small");
    let central_size = u32::try_from(central.len()).expect("a test zip is small");
    out.extend_from_slice(&central);
    out.extend_from_slice(&0x0605_4b50_u32.to_le_bytes());
    for field in [0, 0, count, count] {
        out.extend_from_slice(&field.to_le_bytes());
    }
    out.extend_from_slice(&central_size.to_le_bytes());
    out.extend_from_slice(&central_offset.to_le_bytes());
    out.extend_from_slice(&0_u16.to_le_bytes());
    out
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc = !0_u32;
    for &byte in data {
        crc ^= u32::from(byte);
        for _ in 0..8 {
            crc = if crc & 1 == 1 {
                (crc >> 1) ^ 0xEDB8_8320
            } else {
                crc >> 1
            };
        }
    }
    !crc
}

/// A `.docx` the tests write: the body (the XML inside `w:body`), and the
/// styles, numbering and other parts a test gives it.
pub(super) struct Docx {
    body: String,
    parts: Vec<(String, String)>,
    deflated: bool,
}

impl Docx {
    pub(super) fn new(body: &str) -> Self {
        Self {
            body: body.to_string(),
            parts: Vec::new(),
            deflated: true,
        }
    }

    /// `word/styles.xml` holding these `w:style` elements.
    pub(super) fn styles(self, styles: &str) -> Self {
        let xml = format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles {NAMESPACES}>{styles}</w:styles>"#
        );
        self.part("word/styles.xml", &xml)
    }

    /// `word/numbering.xml` holding these `w:abstractNum` and `w:num`
    /// elements.
    pub(super) fn numbering(self, numbering: &str) -> Self {
        let xml = format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering {NAMESPACES}>{numbering}</w:numbering>"#
        );
        self.part("word/numbering.xml", &xml)
    }

    pub(super) fn part(mut self, name: &str, xml: &str) -> Self {
        self.parts.push((name.to_string(), xml.to_string()));
        self
    }

    pub(super) fn stored(mut self) -> Self {
        self.deflated = false;
        self
    }

    pub(super) fn document_xml(&self) -> String {
        format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {NAMESPACES}><w:body>{}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>"#,
            self.body
        )
    }

    pub(super) fn build(&self) -> Vec<u8> {
        let content_types = format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="{MAIN_CONTENT_TYPE}"/></Types>"#
        );
        let document = self.document_xml();
        let mut parts: Vec<(&str, &str)> = vec![
            ("[Content_Types].xml", content_types.as_str()),
            ("word/document.xml", document.as_str()),
        ];
        parts.extend(
            self.parts
                .iter()
                .map(|(name, xml)| (name.as_str(), xml.as_str())),
        );
        let entries: Vec<Entry<'_>> = parts
            .iter()
            .map(|(name, xml)| Entry {
                deflated: self.deflated,
                ..Entry::deflated(name, xml.as_bytes())
            })
            .collect();
        zip(&entries)
    }
}

/// A `.docx` with this body and nothing else.
pub(super) fn docx(body: &str) -> Vec<u8> {
    Docx::new(body).build()
}

/// A Word paragraph holding one plain run.
pub(super) fn p(text: &str) -> String {
    format!(r#"<w:p><w:r><w:t xml:space="preserve">{text}</w:t></w:r></w:p>"#)
}

/// The paragraphs' texts, runs joined.
pub(super) fn texts(paragraphs: &[PrompterParagraph]) -> Vec<String> {
    paragraphs.iter().map(PrompterParagraph::text).collect()
}

pub(super) fn run(text: &str, bold: bool, italic: bool, underline: bool) -> PrompterRun {
    PrompterRun {
        text: text.to_string(),
        bold,
        italic,
        underline,
    }
}
