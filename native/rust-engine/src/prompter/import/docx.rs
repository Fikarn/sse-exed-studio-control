//! `.docx`: Word's document, a zip of XML parts (§3.2). `word/document.xml`
//! holds the text; `word/styles.xml` says which paragraphs are headings, which
//! become cues (`styles.rs`); `word/numbering.xml` says what a list
//! paragraph's bullet or number is (`numbering.rs`). Headers, footers,
//! footnotes and comments are parts of their own: left out, and counted.
//!
//! The walk over `document.xml` keeps its own stack of open elements rather
//! than recursing, so a document nested a million tables deep cannot overflow
//! the stack. Elements are matched on their local name: the prefix bound to
//! Word's namespace is the writer's choice (`w:` in Word, others elsewhere).

mod numbering;
mod styles;

use std::borrow::Cow;

use quick_xml::events::{BytesRef, BytesStart, Event};
use quick_xml::{Reader, XmlVersion};

use self::numbering::{ListCounters, Numbering};
use self::styles::Styles;
use super::zip::Zip;
use super::{cue_paragraph, finished_paragraph, ImportRefusal, ImportedText, LeftOut};
use crate::prompter::model::{PrompterParagraph, PrompterRun};

const ZIP_SIGNATURE: &[u8] = b"PK\x03\x04";
/// A compound file: how Word saves a password-protected `.docx` (the package
/// encrypted inside it), and how it saved the old `.doc`.
const COMPOUND_FILE_SIGNATURE: &[u8] = &[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
const UTF8_BOM: &[u8] = &[0xEF, 0xBB, 0xBF];
const UTF16_LE_BOM: &[u8] = &[0xFF, 0xFE];
const UTF16_BE_BOM: &[u8] = &[0xFE, 0xFF];
/// The inflated size of `word/document.xml` Studio Control reads: a 30,000
/// word script is about 5 MB of Word's XML.
const DOCUMENT_LIMIT: usize = 64 * 1024 * 1024;
/// The inflated size of any other part it reads.
const PART_LIMIT: usize = 16 * 1024 * 1024;
/// The inflated size of all the header and footer parts together.
const HEADERS_AND_FOOTERS_LIMIT: usize = 32 * 1024 * 1024;
/// The most header and footer parts read: Word writes up to three of each
/// per section. A file of more counts no further.
const MOST_HEADERS_AND_FOOTERS: usize = 64;
const MAIN_DOCUMENT: &str = "word/document.xml";
/// The content types `[Content_Types].xml` gives a Word document's main part:
/// a document, a template, and the two with macros (which are never run; only
/// the text is read).
const MAIN_CONTENT_TYPES: [&str; 4] = [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml",
    "application/vnd.ms-word.document.macroEnabled.main+xml",
    "application/vnd.ms-word.template.macroEnabledTemplate.main+xml",
];
const DAMAGED_TEXT: &str = "its text is damaged";

/// Elements left out with everything inside them, without a count: properties
/// that hold none of the document's text (some would be read as if they did),
/// field codes, ruby guides, equations, a page's background.
const SKIPPED: [&str; 22] = [
    "sectPr",
    "sdtPr",
    "sdtEndPr",
    "tblPr",
    "tblGrid",
    "tcPr",
    "tblPrEx",
    "customXmlPr",
    "smartTagPr",
    "tabs",
    "rt",
    "rubyPr",
    "oMath",
    "oMathPara",
    "instrText",
    "delText",
    "delInstrText",
    "ffData",
    "fldData",
    "footnotePr",
    "endnotePr",
    "background",
];

/// Tracked changes that go when changes are taken as accepted: deleted text,
/// text moved away, and the formatting as it was before a change.
const TRACKED_REMOVALS: [&str; 11] = [
    "del",
    "moveFrom",
    "pPrChange",
    "rPrChange",
    "sectPrChange",
    "tblPrChange",
    "tblPrExChange",
    "trPrChange",
    "tcPrChange",
    "tblGridChange",
    "numberingChange",
];

/// Reads a `.docx`'s bytes. A compound file is refused as protected with a
/// password, or as the old format when it holds a `.doc`'s stream; anything
/// else that is not a zip (an old workbook or deck among them), or a zip
/// without a Word document in it (a workbook, a deck), is not what its name
/// says.
pub(super) fn read_docx(bytes: &[u8]) -> Result<ImportedText, ImportRefusal> {
    if bytes.starts_with(COMPOUND_FILE_SIGNATURE) {
        return Err(compound_file_refusal(bytes));
    }
    if !bytes.starts_with(ZIP_SIGNATURE) {
        return Err(not_a_docx());
    }
    let zip = Zip::open(bytes).map_err(ImportRefusal::Unreadable)?;
    let document = main_document(&zip)?;
    // A damaged styles or numbering part costs the headings and the lists
    // their look; the text still comes in.
    let styles = optional_part(&zip, "word/styles.xml")
        .map_or_else(Styles::default, |part| Styles::read(&part));
    let numbering = optional_part(&zip, "word/numbering.xml")
        .map_or_else(Numbering::default, |part| Numbering::read(&part));
    let mut body = Body::new(&styles, &numbering);
    walk_xml(&document, |event| body.event(event)).map_err(ImportRefusal::Unreadable)?;
    let mut imported = body.finish();
    imported.left_out.headers_and_footers = headers_and_footers(&zip);
    Ok(imported)
}

fn not_a_docx() -> ImportRefusal {
    ImportRefusal::NotWhatItsNameSays { expected: ".docx" }
}

/// Word saves a password-protected `.docx` as a compound file holding an
/// `EncryptedPackage` stream; an old `.doc` renamed `.docx` is a compound file
/// holding a `WordDocument` stream. A compound file with neither is another
/// program's (an old `.xls`, `.ppt`, an Outlook `.msg`). The stream names are
/// UTF-16 in the file's directory.
fn compound_file_refusal(bytes: &[u8]) -> ImportRefusal {
    let holds = |name: &str| {
        let needle: Vec<u8> = name.encode_utf16().flat_map(u16::to_le_bytes).collect();
        bytes.windows(needle.len()).any(|window| window == needle)
    };
    if holds("EncryptedPackage") {
        ImportRefusal::PasswordProtected
    } else if holds("WordDocument") {
        ImportRefusal::OldWordFormat
    } else {
        not_a_docx()
    }
}

/// The main document part: the one `[Content_Types].xml` names, else
/// `word/document.xml`.
fn main_document(zip: &Zip<'_>) -> Result<Vec<u8>, ImportRefusal> {
    let named = optional_part(zip, "[Content_Types].xml").and_then(|part| main_part_name(&part));
    for name in named.iter().map(String::as_str).chain([MAIN_DOCUMENT]) {
        if let Some(document) = zip
            .read(name, DOCUMENT_LIMIT)
            .map_err(ImportRefusal::Unreadable)?
        {
            return Ok(document);
        }
    }
    Err(not_a_docx())
}

fn main_part_name(content_types: &[u8]) -> Option<String> {
    let mut found = None;
    let _ = walk_xml(content_types, |event| {
        if let Event::Start(element) | Event::Empty(element) = event {
            let is_main = local(&element) == "Override"
                && attribute(&element, "ContentType").is_some_and(|content_type| {
                    MAIN_CONTENT_TYPES
                        .iter()
                        .any(|main| main.eq_ignore_ascii_case(content_type.trim()))
                });
            if is_main && found.is_none() {
                found = attribute(&element, "PartName")
                    .map(|name| name.trim().trim_start_matches('/').to_string());
            }
        }
    });
    found
}

/// A part that may be missing or damaged without the import failing.
fn optional_part(zip: &Zip<'_>, name: &str) -> Option<Vec<u8>> {
    zip.read(name, PART_LIMIT).ok().flatten()
}

/// How many header and footer parts hold any text. Word writes one part per
/// kind of header (first page, even pages, the rest) and per section. The
/// parts share one inflating budget, so a file of many small parts that each
/// unpack to 16 MB cannot keep the import busy for minutes; a part past it is
/// not counted, and no more than `MOST_HEADERS_AND_FOOTERS` are read.
fn headers_and_footers(zip: &Zip<'_>) -> usize {
    let mut names: Vec<String> = zip
        .names()
        .map(str::to_ascii_lowercase)
        .filter(|name| {
            name.strip_prefix("word/").is_some_and(|rest| {
                (rest.starts_with("header") || rest.starts_with("footer"))
                    && rest.ends_with(".xml")
                    && !rest.contains('/')
            })
        })
        .collect();
    names.sort();
    names.dedup();
    names.truncate(MOST_HEADERS_AND_FOOTERS);
    let mut budget = HEADERS_AND_FOOTERS_LIMIT;
    let mut count = 0;
    for name in &names {
        if budget == 0 {
            break;
        }
        let limit = budget.min(PART_LIMIT);
        match zip.read(name, limit) {
            Ok(Some(part)) => {
                budget = budget.saturating_sub(part.len());
                count += usize::from(has_text(&part));
            }
            Ok(None) => {}
            // A part too large or damaged may have cost that much to find out.
            Err(_) => budget = budget.saturating_sub(limit),
        }
    }
    count
}

/// Whether a part holds a `w:t` with anything but white space in it.
fn has_text(part: &[u8]) -> bool {
    let mut in_text = false;
    let mut found = false;
    let _ = walk_xml(part, |event| match event {
        Event::Start(element) if local(&element) == "t" => in_text = true,
        Event::End(element) if element.local_name().into_inner() == "t" => in_text = false,
        Event::Text(text) if in_text => found |= !text.trim().is_empty(),
        Event::GeneralRef(entity) if in_text => {
            found |= reference(&entity).is_some_and(|character| !character.is_whitespace());
        }
        _ => {}
    });
    found
}

/// Walks an XML part's events in order; damaged XML ends the walk with the
/// reason the refusal gives.
fn walk_xml(part: &[u8], mut visit: impl FnMut(Event<'_>)) -> Result<(), String> {
    let text = xml_text(part).ok_or(DAMAGED_TEXT)?;
    let mut reader = Reader::from_str(&text);
    loop {
        match reader.read_event() {
            Ok(Event::Eof) => return Ok(()),
            Ok(event) => visit(event),
            Err(_) => return Err(DAMAGED_TEXT.to_string()),
        }
    }
}

/// An XML part's text: UTF-8 (a byte-order mark dropped), or UTF-16 with its
/// mark. Word writes UTF-8; other programs may not.
fn xml_text(part: &[u8]) -> Option<Cow<'_, str>> {
    if let Some(rest) = part.strip_prefix(UTF16_LE_BOM) {
        super::txt::utf16(rest, false).map(Cow::Owned)
    } else if let Some(rest) = part.strip_prefix(UTF16_BE_BOM) {
        super::txt::utf16(rest, true).map(Cow::Owned)
    } else {
        let rest = part.strip_prefix(UTF8_BOM).unwrap_or(part);
        std::str::from_utf8(rest).ok().map(Cow::Borrowed)
    }
}

fn local<'a>(element: &'a BytesStart<'_>) -> &'a str {
    element.local_name().into_inner()
}

/// The value of the attribute whose local name is `name` (`w:val` is `val`).
/// A damaged attribute ends the search.
fn attribute(element: &BytesStart<'_>, name: &str) -> Option<String> {
    let mut attributes = element.attributes();
    attributes.with_checks(false);
    attributes
        .map_while(Result::ok)
        .find(|attribute| attribute.key.local_name().into_inner() == name)
        .and_then(|attribute| {
            attribute
                .normalized_value(XmlVersion::Implicit1_0)
                .ok()
                .map(Cow::into_owned)
        })
}

/// A `w:val` that is a whole number (`w:ilvl`, `w:numId`, `w:outlineLvl`).
fn number(element: &BytesStart<'_>) -> Option<u32> {
    attribute(element, "val")?.trim().parse().ok()
}

/// The text of `&amp;` or `&#229;` in an XML part: a character reference or
/// one of XML's five named ones. Any other name needs a DTD, which Word never
/// writes, so it stands for nothing.
fn reference(entity: &BytesRef<'_>) -> Option<char> {
    if let Ok(Some(character)) = entity.resolve_char_ref() {
        return Some(character);
    }
    match &**entity {
        "amp" => Some('&'),
        "lt" => Some('<'),
        "gt" => Some('>'),
        "quot" => Some('"'),
        "apos" => Some('\''),
        _ => None,
    }
}

/// What an open element in `document.xml` is to the walk. Most are `Other`:
/// walked into, and nothing more.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Open {
    Paragraph,
    ParagraphProperties,
    ListProperties,
    Run,
    RunProperties,
    Text,
    Row,
    RowProperties,
    Cell,
    AlternateContent { choice_taken: bool },
    Other,
}

/// An element being skipped with everything inside it.
struct Skip {
    /// Elements opened inside it and not yet closed.
    depth: usize,
    kind: SkipKind,
}

enum SkipKind {
    /// Left out without a count.
    Silent,
    /// A `w:drawing` or `w:pict`: a text box when it holds `w:txbxContent`,
    /// else a picture (a photo, a shape, a chart).
    Drawing { text_box: bool },
    /// A `w:object`: an embedded object, counted as a picture.
    Object,
    /// The rest of a table row whose `w:trPr` marks it deleted; the row's own
    /// end closes the skip.
    RestOfRow,
}

/// A field's two parts: its code (`PAGE`, `HYPERLINK "…"`), which is left
/// out, and its result, the text Word shows, which is kept.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FieldPart {
    Code,
    Result,
}

#[derive(Default)]
struct Paragraph {
    runs: Vec<PrompterRun>,
    style: Option<String>,
    outline_level: Option<u32>,
    list: Option<u32>,
    list_level: Option<u32>,
}

/// A run's own emphasis (`None`: as its styles say), its character style,
/// and whether it is hidden text (`w:vanish`), which is left out.
#[derive(Default)]
struct Run {
    bold: Option<bool>,
    italic: Option<bool>,
    underline: Option<bool>,
    style: Option<String>,
    hidden: bool,
}

/// The walk over `document.xml`.
struct Body<'a> {
    styles: &'a Styles,
    numbering: &'a Numbering,
    counters: ListCounters,
    open: Vec<Open>,
    skip: Option<Skip>,
    paragraph: Option<Paragraph>,
    run: Run,
    fields: Vec<FieldPart>,
    /// How many of `fields` are in their code, where text is left out.
    field_codes: usize,
    /// How many table cells are open (tables nest).
    cells: usize,
    /// The open cell's text so far: its paragraphs joined by line breaks.
    cell: Vec<PrompterRun>,
    row_deleted: bool,
    paragraphs: Vec<PrompterParagraph>,
    left_out: LeftOut,
    tracked_changes: bool,
}

impl<'a> Body<'a> {
    fn new(styles: &'a Styles, numbering: &'a Numbering) -> Self {
        Self {
            styles,
            numbering,
            counters: ListCounters::default(),
            open: Vec::new(),
            skip: None,
            paragraph: None,
            run: Run::default(),
            fields: Vec::new(),
            field_codes: 0,
            cells: 0,
            cell: Vec::new(),
            row_deleted: false,
            paragraphs: Vec::new(),
            left_out: LeftOut::default(),
            tracked_changes: false,
        }
    }

    fn finish(mut self) -> ImportedText {
        self.end_paragraph();
        self.flush_cell();
        ImportedText {
            paragraphs: self.paragraphs,
            left_out: self.left_out,
            tracked_changes_accepted: self.tracked_changes,
            encoding: None,
        }
    }

    fn event(&mut self, event: Event<'_>) {
        if let Some(skip) = self.skip.as_mut() {
            match &event {
                Event::Start(element) | Event::Empty(element) => {
                    if local(element) == "txbxContent" {
                        if let SkipKind::Drawing { text_box } = &mut skip.kind {
                            *text_box = true;
                        }
                    }
                    if matches!(event, Event::Start(_)) {
                        skip.depth += 1;
                    }
                }
                Event::End(_) if skip.depth == 0 => self.end_skip(),
                Event::End(_) => skip.depth -= 1,
                _ => {}
            }
            return;
        }
        let in_text = self.open.last() == Some(&Open::Text);
        match event {
            Event::Start(element) => self.open(&element, false),
            Event::Empty(element) => self.open(&element, true),
            Event::End(_) => self.close(),
            Event::Text(text) if in_text => self.push_text(&text.xml10_content()),
            Event::CData(data) if in_text => self.push_text(&data.xml10_content()),
            Event::GeneralRef(entity) if in_text => {
                if let Some(character) = reference(&entity) {
                    self.push_text(character.encode_utf8(&mut [0; 4]));
                }
            }
            _ => {}
        }
    }

    fn open(&mut self, element: &BytesStart<'_>, empty: bool) {
        let name = local(element);
        let parent = self.open.last().copied();
        let opened = match name {
            "p" => {
                self.begin_paragraph();
                Open::Paragraph
            }
            "pPr" if parent == Some(Open::Paragraph) => Open::ParagraphProperties,
            "pStyle" if parent == Some(Open::ParagraphProperties) => {
                self.paragraph().style = attribute(element, "val");
                Open::Other
            }
            "outlineLvl" if parent == Some(Open::ParagraphProperties) => {
                self.paragraph().outline_level = number(element);
                Open::Other
            }
            "numPr" if parent == Some(Open::ParagraphProperties) => Open::ListProperties,
            "numId" if parent == Some(Open::ListProperties) => {
                self.paragraph().list = number(element);
                Open::Other
            }
            "ilvl" if parent == Some(Open::ListProperties) => {
                self.paragraph().list_level = number(element);
                Open::Other
            }
            "r" => {
                self.run = Run::default();
                Open::Run
            }
            "rPr" if parent == Some(Open::Run) => Open::RunProperties,
            "b" | "i" | "u" | "rStyle" | "vanish" if parent == Some(Open::RunProperties) => {
                self.run_property(name, element);
                Open::Other
            }
            "t" if parent == Some(Open::Run) => Open::Text,
            "tab" | "ptab" if parent == Some(Open::Run) => {
                self.push_text(" ");
                Open::Other
            }
            "br" | "cr" if parent == Some(Open::Run) => {
                self.push_text("\n");
                Open::Other
            }
            "noBreakHyphen" if parent == Some(Open::Run) => {
                self.push_text("-");
                Open::Other
            }
            "fldChar" => {
                self.field_character(element);
                Open::Other
            }
            "footnoteReference" | "endnoteReference" => {
                self.left_out.footnotes += 1;
                Open::Other
            }
            "commentReference" => {
                self.left_out.comments += 1;
                Open::Other
            }
            "ins" | "moveTo" => {
                self.tracked_changes = true;
                Open::Other
            }
            "del" if parent == Some(Open::RowProperties) => {
                self.tracked_changes = true;
                self.row_deleted = true;
                return self.skip(empty, SkipKind::Silent);
            }
            _ if TRACKED_REMOVALS.contains(&name) => {
                self.tracked_changes = true;
                return self.skip(empty, SkipKind::Silent);
            }
            "drawing" | "pict" => return self.skip(empty, SkipKind::Drawing { text_box: false }),
            "object" => return self.skip(empty, SkipKind::Object),
            // Another document kept whole inside this one (HTML, RTF, a
            // `.docx`), which Word reads in when it opens the file.
            "altChunk" => {
                self.left_out.embedded_documents += 1;
                return self.skip(empty, SkipKind::Silent);
            }
            "AlternateContent" => Open::AlternateContent {
                choice_taken: false,
            },
            // The first choice is read and the rest skipped, so a text box
            // Word writes twice (as DrawingML and as VML) counts once; the
            // fallback is read only when there was no choice.
            "Choice" | "Fallback" => {
                let taken = match self.open.last_mut() {
                    Some(Open::AlternateContent { choice_taken }) => {
                        std::mem::replace(choice_taken, true)
                    }
                    _ => false,
                };
                if taken {
                    return self.skip(empty, SkipKind::Silent);
                }
                Open::Other
            }
            // A table inside a cell: the cell's text so far is a paragraph,
            // and the inner table's cells come in as the outer's do.
            "tbl" => {
                if self.cells > 0 {
                    self.end_paragraph();
                    self.flush_cell();
                }
                Open::Other
            }
            "tr" => {
                self.row_deleted = false;
                Open::Row
            }
            "trPr" if parent == Some(Open::Row) => Open::RowProperties,
            "tc" => {
                self.end_paragraph();
                self.flush_cell();
                self.cells += 1;
                Open::Cell
            }
            _ if SKIPPED.contains(&name) => return self.skip(empty, SkipKind::Silent),
            _ => Open::Other,
        };
        if empty {
            self.close_element(opened);
        } else {
            self.open.push(opened);
        }
    }

    fn close(&mut self) {
        if let Some(closed) = self.open.pop() {
            self.close_element(closed);
        }
    }

    fn close_element(&mut self, closed: Open) {
        match closed {
            Open::Paragraph => self.end_paragraph(),
            Open::RowProperties if self.row_deleted => {
                self.skip = Some(Skip {
                    depth: 0,
                    kind: SkipKind::RestOfRow,
                });
            }
            Open::Cell => {
                self.end_paragraph();
                self.flush_cell();
                self.cells = self.cells.saturating_sub(1);
            }
            _ => {}
        }
    }

    fn skip(&mut self, empty: bool, kind: SkipKind) {
        self.skip = Some(Skip { depth: 0, kind });
        if empty {
            self.end_skip();
        }
    }

    fn end_skip(&mut self) {
        let Some(skip) = self.skip.take() else {
            return;
        };
        match skip.kind {
            SkipKind::Silent => {}
            SkipKind::Drawing { text_box: true } => self.left_out.text_boxes += 1,
            SkipKind::Drawing { text_box: false } | SkipKind::Object => {
                self.left_out.pictures += 1;
            }
            SkipKind::RestOfRow => self.close(),
        }
    }

    /// The open paragraph; text outside any (which Word never writes) gets
    /// one of its own.
    fn paragraph(&mut self) -> &mut Paragraph {
        self.paragraph.get_or_insert_with(Paragraph::default)
    }

    fn run_property(&mut self, name: &str, element: &BytesStart<'_>) {
        let value = attribute(element, "val");
        match name {
            "b" => self.run.bold = Some(toggle_is_on(value.as_deref())),
            "i" => self.run.italic = Some(toggle_is_on(value.as_deref())),
            "u" => self.run.underline = Some(underline_is_on(value.as_deref())),
            "vanish" => self.run.hidden = toggle_is_on(value.as_deref()),
            _ => self.run.style = value,
        }
    }

    fn field_character(&mut self, element: &BytesStart<'_>) {
        match attribute(element, "fldCharType").as_deref().map(str::trim) {
            Some("begin") => {
                self.fields.push(FieldPart::Code);
                self.field_codes += 1;
            }
            Some("separate") => {
                if let Some(part) = self
                    .fields
                    .last_mut()
                    .filter(|part| **part == FieldPart::Code)
                {
                    *part = FieldPart::Result;
                    self.field_codes -= 1;
                }
            }
            Some("end") => {
                let ended = self.fields.pop();
                self.field_codes -= usize::from(ended == Some(FieldPart::Code));
            }
            _ => {}
        }
    }

    /// Adds text to the open paragraph with the run's emphasis: the
    /// paragraph style's, then the character style's, then the run's own,
    /// each winning over the one before where it says anything.
    fn push_text(&mut self, text: &str) {
        if self.field_codes > 0 || self.run.hidden || text.is_empty() {
            return;
        }
        let paragraph_style = self
            .paragraph
            .as_ref()
            .and_then(|paragraph| paragraph.style.as_deref());
        let from_styles = self
            .run
            .style
            .as_deref()
            .map(|style| self.styles.character_emphasis(style))
            .unwrap_or_default()
            .or(self.styles.paragraph_emphasis(paragraph_style));
        let bold = self.run.bold.or(from_styles.bold).unwrap_or(false);
        let italic = self.run.italic.or(from_styles.italic).unwrap_or(false);
        let underline = self
            .run
            .underline
            .or(from_styles.underline)
            .unwrap_or(false);
        let runs = &mut self.paragraph().runs;
        match runs.last_mut() {
            Some(last)
                if last.bold == bold && last.italic == italic && last.underline == underline =>
            {
                last.text.push_str(text);
            }
            _ => runs.push(PrompterRun {
                text: text.to_string(),
                bold,
                italic,
                underline,
            }),
        }
    }

    fn begin_paragraph(&mut self) {
        self.end_paragraph();
        self.paragraph = Some(Paragraph::default());
    }

    /// Ends the open paragraph: its bullet or number in front, a heading made
    /// a cue, an empty one dropped (the list still counts it, as Word does).
    fn end_paragraph(&mut self) {
        let Some(paragraph) = self.paragraph.take() else {
            return;
        };
        let prefix = self.list_prefix(&paragraph);
        if paragraph.runs.iter().all(|run| run.text.trim().is_empty()) {
            return;
        }
        let heading = match paragraph.outline_level {
            Some(level) => level <= 8,
            None => self.styles.is_heading(paragraph.style.as_deref()),
        };
        let mut runs = Vec::with_capacity(paragraph.runs.len() + 1);
        runs.extend(prefix.map(PrompterRun::plain));
        runs.extend(paragraph.runs);
        let finished = if heading {
            cue_paragraph(&runs)
        } else {
            finished_paragraph(runs)
        };
        if let Some(finished) = finished {
            self.add(finished);
        }
    }

    /// The paragraph's bullet or number, from its own `w:numPr` or its
    /// style's; a paragraph whose style is linked from a list level (Word's
    /// numbered headings) takes that level.
    fn list_prefix(&mut self, paragraph: &Paragraph) -> Option<String> {
        let style = paragraph.style.as_deref();
        let (style_list, style_level) = self.styles.list(style);
        let list = paragraph.list.or(style_list)?;
        let level = paragraph
            .list_level
            .or(style_level)
            .or_else(|| style.and_then(|style| self.numbering.level_for_style(list, style)))
            .unwrap_or(0);
        self.numbering.prefix(&mut self.counters, list, level)
    }

    fn add(&mut self, paragraph: PrompterParagraph) {
        if self.cells == 0 {
            self.paragraphs.push(paragraph);
            return;
        }
        if !self.cell.is_empty() {
            self.cell.push(PrompterRun::plain("\n"));
        }
        self.cell.extend(paragraph.runs);
    }

    /// The open cell's text so far as one paragraph (§3.2: a table's cells
    /// come in row by row, one paragraph each).
    fn flush_cell(&mut self) {
        let runs = std::mem::take(&mut self.cell);
        if let Some(paragraph) = finished_paragraph(runs) {
            self.paragraphs.push(paragraph);
        }
    }
}

/// `w:b`, `w:i` and `w:vanish` are on unless their `w:val` turns them off.
fn toggle_is_on(value: Option<&str>) -> bool {
    !matches!(value.map(str::trim), Some("0" | "false" | "off"))
}

/// `w:u` underlines unless its `w:val` is `none`.
fn underline_is_on(value: Option<&str>) -> bool {
    value.map(str::trim) != Some("none")
}
