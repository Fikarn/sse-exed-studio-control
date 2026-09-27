//! A paste that held formatting: the clipboard's HTML, from Word, a browser or
//! Google Docs (§3.1). No HTML crate: a small tolerant tokenizer that never
//! fails. A clipboard's HTML is a fragment, often with elements left open, and
//! the worst a surprise in it can do is cost a paragraph break.
//!
//! What each source writes, and what becomes of it:
//! - Word: `<p class=MsoNormal>`, `<o:p>&nbsp;</o:p>` for an empty paragraph,
//!   a list paragraph as `<p style='mso-list:l0 level1 lfo1'>` with the bullet
//!   or number Word draws inside `<![if !supportLists]>…<![endif]>`, and each
//!   picture twice: as VML in a conditional comment and as an `<img>`.
//! - Google Docs: everything inside `<b style="font-weight:normal">`, the
//!   emphasis in each span's `style` (`font-weight:700`), a list item's text
//!   as `<li><p>`.
//! - a browser: plain HTML.

use std::borrow::Cow;

use super::{cue_paragraph, finished_paragraph, ImportedText, LeftOut};
use crate::prompter::model::{PrompterParagraph, PrompterRun};

/// What a bullet becomes, as in a Word document: an en dash and a space.
const BULLET: &str = "– ";
/// Elements whose content is raw text, not elements: the tokenizer jumps to
/// their end tag.
const RAW_TEXT: [&str; 3] = ["script", "style", "title"];
/// Elements whose content is not the page's text.
const HIDDEN: [&str; 6] = ["head", "template", "noscript", "xml", "svg", "object"];
/// Elements that have no end tag (`br`, `img` and `hr` do something).
const VOID: [&str; 14] = [
    "area", "base", "basefont", "col", "embed", "frame", "input", "keygen", "link", "meta",
    "param", "source", "track", "wbr",
];
/// Elements that start and end a paragraph (`h1`–`h6` too).
const BLOCKS: [&str; 30] = [
    "p",
    "div",
    "li",
    "blockquote",
    "pre",
    "section",
    "article",
    "header",
    "footer",
    "address",
    "dt",
    "dd",
    "figcaption",
    "tr",
    "td",
    "th",
    "ul",
    "ol",
    "dl",
    "table",
    "caption",
    "main",
    "nav",
    "aside",
    "figure",
    "center",
    "form",
    "fieldset",
    "details",
    "summary",
];
/// Where Word's HTML draws a list paragraph's bullet or number for programs
/// without lists, up to `WORD_LIST_END`.
const WORD_LIST_MARKER: &str = "<![if !supportLists]>";
const WORD_LIST_END: &str = "<![endif]>";
/// Deeper nesting than this is read as if the extra elements were not there;
/// a page nests a few dozen deep.
const DEEPEST: usize = 512;
/// How far down the open elements an end tag looks for its start. An end tag
/// with no start near the top is ignored, so a paste full of end tags that
/// match nothing cannot make the reading slow.
const END_TAG_REACH: usize = 64;

/// Reads the clipboard's HTML. Always gives an answer; one without a word in
/// it sends the paste to its plain text (`import_paste`).
pub(super) fn read_html(html: &str) -> ImportedText {
    let mut reader = HtmlReader::default();
    reader.read(html);
    reader.flush();
    ImportedText {
        paragraphs: reader.paragraphs,
        left_out: reader.left_out,
        tracked_changes_accepted: false,
        encoding: None,
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct Marks {
    bold: bool,
    italic: bool,
    underline: bool,
}

/// An open element and what it means for the text inside it, worked out from
/// its parent's when it opens.
#[derive(Debug, Clone, Default)]
struct Frame {
    name: String,
    marks: Marks,
    /// Not the page's text (`head`, `svg`, …): nothing inside counts.
    hidden: bool,
    /// Word's `mso-list:Ignore`: the bullet it draws for other programs.
    ignored: bool,
    pre: bool,
    heading: bool,
    in_cell: bool,
    /// A `ul` or `ol`: closing it closes its entry in `lists`.
    opens_list: bool,
    /// An `li` or a Word list paragraph: closing it drops an unused prefix.
    sets_prefix: bool,
}

struct List {
    ordered: bool,
    next: i64,
}

struct StartTag {
    name: String,
    attributes: Vec<(String, String)>,
    self_closing: bool,
}

impl StartTag {
    fn attribute(&self, name: &str) -> Option<&str> {
        self.attributes
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }
}

#[derive(Default)]
struct HtmlReader {
    root: Frame,
    frames: Vec<Frame>,
    lists: Vec<List>,
    /// The paragraph being read.
    current: Vec<PrompterRun>,
    has_text: bool,
    /// The paragraph holds a heading's text: it becomes a cue.
    heading: bool,
    /// The last character written was white space (or none was yet): more
    /// white space collapses into it.
    last_space: bool,
    /// The bullet or number waiting for the list item's first word.
    prefix: Option<String>,
    /// No `<![endif]>` follows the Word list marker last read.
    no_word_list_end: bool,
    paragraphs: Vec<PrompterParagraph>,
    left_out: LeftOut,
}

impl HtmlReader {
    fn read(&mut self, html: &str) {
        self.last_space = true;
        let bytes = html.as_bytes();
        let mut at = clipboard_header_end(html);
        while at < bytes.len() {
            if bytes[at] == b'<' {
                at = self.markup(html, at);
            } else {
                let end = find_byte(bytes, at, b'<');
                self.text(slice(html, at, end));
                at = end;
            }
        }
    }

    /// Reads the markup that starts at `at` (a `<`) and gives where the text
    /// after it starts.
    fn markup(&mut self, html: &str, at: usize) -> usize {
        let rest = slice(html, at, html.len());
        let second = rest.as_bytes().get(1).copied();
        if rest.starts_with("<!--") {
            after(html, at + 4, "-->")
        } else if starts_with_ignore_case(rest, WORD_LIST_MARKER) {
            let content = at + WORD_LIST_MARKER.len();
            // Once no `<![endif]>` follows, none follows a later marker either:
            // searching again for each would make a paste of markers slow.
            let end = if self.no_word_list_end {
                None
            } else {
                find_ignore_case(html, content, WORD_LIST_END)
            };
            match end {
                Some(end) => {
                    self.word_list_marker(slice(html, content, end));
                    end + WORD_LIST_END.len()
                }
                None => {
                    self.no_word_list_end = true;
                    content
                }
            }
        } else if rest.starts_with("<![CDATA[") {
            after(html, at + 9, "]]>")
        } else if matches!(second, Some(b'!' | b'?')) {
            after(html, at + 2, ">")
        } else if second == Some(b'/') {
            if rest.as_bytes().get(2).is_some_and(u8::is_ascii_alphabetic) {
                let (name, end) = tag_name(html, at + 2);
                self.end_tag(&name);
                after(html, end, ">")
            } else {
                after(html, at + 2, ">")
            }
        } else if second.is_some_and(|byte| byte.is_ascii_alphabetic()) {
            let (tag, end) = start_tag(html, at + 1);
            self.start_tag(&tag);
            if RAW_TEXT.contains(&tag.name.as_str()) && !tag.self_closing {
                let close = format!("</{}", tag.name);
                find_ignore_case(html, end, &close)
                    .map_or(html.len(), |close| after(html, close, ">"))
            } else {
                end
            }
        } else {
            self.text("<");
            at + 1
        }
    }

    fn top(&self) -> &Frame {
        self.frames.last().unwrap_or(&self.root)
    }

    fn start_tag(&mut self, tag: &StartTag) {
        let name = tag.name.as_str();
        // A body closes a head left open, as a browser does.
        if name == "body" {
            self.close_to("head");
        }
        let hidden = self.top().hidden;
        match name {
            "br" if !hidden => return self.line_break(),
            "img" if !hidden => {
                self.left_out.pictures += 1;
                return;
            }
            "hr" if !hidden => return self.flush(),
            "br" | "img" | "hr" => return,
            _ if VOID.contains(&name) || RAW_TEXT.contains(&name) => return,
            _ => {}
        }
        if is_block(name) && !hidden {
            self.block_break(name);
        }
        if tag.self_closing || self.frames.len() >= DEEPEST {
            return;
        }
        let (mut frame, word_list) = self.child_frame(tag);
        match name {
            "ul" | "ol" => {
                let start = tag
                    .attribute("start")
                    .and_then(|start| start.trim().parse().ok())
                    .filter(|_| name == "ol");
                self.lists.push(List {
                    ordered: name == "ol",
                    next: start.unwrap_or(1),
                });
                frame.opens_list = true;
            }
            "li" => {
                let value = tag
                    .attribute("value")
                    .and_then(|value| value.trim().parse::<i64>().ok());
                let prefix = match self.lists.last_mut() {
                    Some(list) if list.ordered => {
                        let number = value.unwrap_or(list.next);
                        list.next = number.saturating_add(1);
                        format!("{number}. ")
                    }
                    _ => BULLET.to_string(),
                };
                self.prefix = Some(prefix);
                frame.sets_prefix = true;
            }
            _ if word_list => {
                self.prefix = Some(BULLET.to_string());
                frame.sets_prefix = true;
            }
            _ => {}
        }
        self.frames.push(frame);
    }

    fn end_tag(&mut self, name: &str) {
        self.close_to(name);
        if is_block(name) && !self.top().hidden {
            self.block_break(name);
        }
    }

    /// Closes the nearest open `name` and everything opened inside it.
    fn close_to(&mut self, name: &str) {
        let Some(from_top) = self
            .frames
            .iter()
            .rev()
            .take(END_TAG_REACH)
            .position(|frame| frame.name == name)
        else {
            return;
        };
        for _ in 0..=from_top {
            if let Some(frame) = self.frames.pop() {
                if frame.opens_list {
                    self.lists.pop();
                }
                if frame.sets_prefix {
                    self.prefix = None;
                }
            }
        }
    }

    /// The frame an element opens: its parent's marks, then the element's
    /// own, then its `style` attribute's, which win (Google Docs wraps a
    /// whole paste in `<b style="font-weight:normal">`). Also whether it is a
    /// Word list paragraph.
    fn child_frame(&self, tag: &StartTag) -> (Frame, bool) {
        let parent = self.top();
        let name = tag.name.as_str();
        let mut frame = Frame {
            name: tag.name.clone(),
            marks: parent.marks,
            hidden: parent.hidden || HIDDEN.contains(&name),
            ignored: parent.ignored,
            pre: parent.pre || name == "pre",
            heading: parent.heading || is_heading(name),
            in_cell: parent.in_cell || matches!(name, "td" | "th"),
            opens_list: false,
            sets_prefix: false,
        };
        match name {
            "b" | "strong" => frame.marks.bold = true,
            "i" | "em" | "cite" => frame.marks.italic = true,
            "u" | "ins" => frame.marks.underline = true,
            _ => {}
        }
        let mut word_list = false;
        for declaration in tag.attribute("style").unwrap_or_default().split(';') {
            let Some((property, value)) = declaration.split_once(':') else {
                continue;
            };
            let value = value.trim().to_ascii_lowercase();
            let value = value.trim_end_matches("!important").trim();
            match property.trim().to_ascii_lowercase().as_str() {
                "font-weight" => {
                    if let Some(bold) = font_weight_is_bold(value) {
                        frame.marks.bold = bold;
                    }
                }
                "font-style" => {
                    if value.starts_with("italic") || value.starts_with("oblique") {
                        frame.marks.italic = true;
                    } else if value == "normal" {
                        frame.marks.italic = false;
                    }
                }
                "text-decoration" | "text-decoration-line" => {
                    if value.contains("underline") {
                        frame.marks.underline = true;
                    } else if value.contains("none") {
                        frame.marks.underline = false;
                    }
                }
                "mso-list" if value == "ignore" => frame.ignored = true,
                "mso-list" => word_list = value != "none" && is_block(name),
                _ => {}
            }
        }
        (frame, word_list)
    }

    /// The number Word draws for a list paragraph, from inside
    /// `<![if !supportLists]>`: a number (`1.`, `b)`, `iv.`) is kept; a
    /// bullet (Word draws `·`, `o` or `§` in a symbol font) stays a dash.
    fn word_list_marker(&mut self, content: &str) {
        if self.prefix.is_none() {
            return;
        }
        let marker: String = visible_text(content)
            .chars()
            .filter(|character| !character.is_whitespace())
            .collect();
        let is_number = marker.strip_suffix(['.', ')']).is_some_and(|body| {
            !body.is_empty()
                && body.len() <= 8
                && body
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric() || ".(".contains(character))
        });
        if is_number {
            self.prefix = Some(format!("{marker} "));
        }
    }

    fn text(&mut self, raw: &str) {
        let frame = self.top();
        if frame.hidden || frame.ignored || raw.is_empty() {
            return;
        }
        let (marks, pre, heading) = (frame.marks, frame.pre, frame.heading);
        let decoded = decode_entities(raw);
        let mut out = String::with_capacity(decoded.len());
        for character in decoded.chars() {
            if pre {
                out.push(character);
                self.last_space = character.is_whitespace();
            } else if matches!(character, ' ' | '\t' | '\n' | '\r' | '\u{0C}') {
                if !self.last_space {
                    out.push(' ');
                    self.last_space = true;
                }
            } else {
                out.push(character);
                self.last_space = false;
            }
        }
        if out.chars().any(|character| !character.is_whitespace()) {
            if let Some(prefix) = self.prefix.take() {
                self.push(&prefix, Marks::default());
                out = out.trim_start().to_string();
            }
            self.has_text = true;
            self.heading |= heading;
        }
        self.push(&out, marks);
    }

    fn push(&mut self, text: &str, marks: Marks) {
        if text.is_empty() {
            return;
        }
        match self.current.last_mut() {
            Some(last)
                if (last.bold, last.italic, last.underline)
                    == (marks.bold, marks.italic, marks.underline) =>
            {
                last.text.push_str(text);
            }
            _ => self.current.push(PrompterRun {
                text: text.to_string(),
                bold: marks.bold,
                italic: marks.italic,
                underline: marks.underline,
            }),
        }
    }

    fn line_break(&mut self) {
        self.push("\n", Marks::default());
        self.last_space = true;
    }

    /// A block element starts or ends: a new paragraph, except inside a table
    /// cell, whose blocks are lines of the cell's one paragraph (a heading
    /// still stands alone, to stay a cue).
    fn block_break(&mut self, name: &str) {
        if matches!(name, "td" | "th") || is_heading(name) || !self.top().in_cell {
            self.flush();
        } else if self.has_text
            && !self
                .current
                .last()
                .is_some_and(|run| run.text.ends_with('\n'))
        {
            self.line_break();
        }
    }

    fn flush(&mut self) {
        let runs = std::mem::take(&mut self.current);
        let paragraph = if self.heading {
            cue_paragraph(&runs)
        } else {
            finished_paragraph(runs)
        };
        self.paragraphs.extend(paragraph);
        self.has_text = false;
        self.heading = false;
        self.last_space = true;
    }
}

fn is_block(name: &str) -> bool {
    BLOCKS.contains(&name) || is_heading(name)
}

fn is_heading(name: &str) -> bool {
    matches!(name, "h1" | "h2" | "h3" | "h4" | "h5" | "h6")
}

/// `bold`, `bolder` and 600–900 are bold; `normal`, `lighter` and 100–500
/// are not.
fn font_weight_is_bold(value: &str) -> Option<bool> {
    match value {
        "bold" | "bolder" => Some(true),
        "normal" | "lighter" => Some(false),
        number => number.parse::<u32>().ok().map(|weight| weight >= 600),
    }
}

/// Windows puts a description before the HTML it keeps on the clipboard
/// (`Version:0.9 StartHTML:…`). A WebView hands the HTML over without it; a
/// paste that still has it starts at the first tag.
fn clipboard_header_end(html: &str) -> usize {
    if html.starts_with("Version:") && html.contains("StartHTML:") {
        html.find('<').unwrap_or(html.len())
    } else {
        0
    }
}

/// A tag's name, lower-cased, from `from`, and where it ends.
fn tag_name(html: &str, from: usize) -> (String, usize) {
    let bytes = html.as_bytes();
    let mut end = from;
    while bytes
        .get(end)
        .is_some_and(|byte| byte.is_ascii_alphanumeric() || b":-_.".contains(byte))
    {
        end += 1;
    }
    (slice(html, from, end).to_ascii_lowercase(), end)
}

/// A start tag's name and attributes, from just after its `<`, and where the
/// text after it starts. Values may be quoted either way or not at all; an
/// attribute with no value has an empty one.
fn start_tag(html: &str, from: usize) -> (StartTag, usize) {
    let bytes = html.as_bytes();
    let (name, mut at) = tag_name(html, from);
    let mut attributes = Vec::new();
    let mut self_closing = false;
    loop {
        while bytes.get(at).is_some_and(u8::is_ascii_whitespace) {
            at += 1;
        }
        match bytes.get(at) {
            None => break,
            Some(b'>') => {
                at += 1;
                break;
            }
            Some(b'/') => {
                at += 1;
                if bytes.get(at) == Some(&b'>') {
                    self_closing = true;
                    at += 1;
                    break;
                }
                continue;
            }
            _ => {}
        }
        let key_start = at;
        while bytes
            .get(at)
            .is_some_and(|byte| !byte.is_ascii_whitespace() && !b"=>/".contains(byte))
        {
            at += 1;
        }
        let key = slice(html, key_start, at).to_ascii_lowercase();
        while bytes.get(at).is_some_and(u8::is_ascii_whitespace) {
            at += 1;
        }
        let mut value = "";
        if bytes.get(at) == Some(&b'=') {
            at += 1;
            while bytes.get(at).is_some_and(u8::is_ascii_whitespace) {
                at += 1;
            }
            match bytes.get(at) {
                Some(&quote) if quote == b'"' || quote == b'\'' => {
                    let end = find_byte(bytes, at + 1, quote);
                    value = slice(html, at + 1, end);
                    at = (end + 1).min(bytes.len());
                }
                _ => {
                    let start = at;
                    while bytes
                        .get(at)
                        .is_some_and(|byte| !byte.is_ascii_whitespace() && *byte != b'>')
                    {
                        at += 1;
                    }
                    value = slice(html, start, at);
                }
            }
        }
        if !key.is_empty() {
            attributes.push((key, decode_entities(value).into_owned()));
        }
    }
    (
        StartTag {
            name,
            attributes,
            self_closing,
        },
        at,
    )
}

/// The text of a piece of markup with its tags taken out and its entities
/// read.
fn visible_text(markup: &str) -> String {
    let mut text = String::new();
    let mut rest = markup;
    while let Some(open) = rest.find('<') {
        text.push_str(&rest[..open]);
        rest = rest[open..]
            .find('>')
            .map_or("", |close| &rest[open + close + 1..]);
    }
    text.push_str(rest);
    decode_entities(&text).into_owned()
}

/// Reads the character references in a text: `&#229;`, `&#xE5;` and the
/// names Word, browsers and Google Docs write. An unknown name stays as it
/// was written.
fn decode_entities(text: &str) -> Cow<'_, str> {
    if !text.contains('&') {
        return Cow::Borrowed(text);
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(ampersand) = rest.find('&') {
        out.push_str(&rest[..ampersand]);
        let after = &rest[ampersand + 1..];
        match entity(after) {
            Some((decoded, used)) => {
                out.push_str(&decoded);
                rest = slice(after, used, after.len());
            }
            None => {
                out.push('&');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    Cow::Owned(out)
}

/// The entity at the start of `after` (the text after a `&`): what it stands
/// for and how many bytes it takes, its `;` included.
fn entity(after: &str) -> Option<(String, usize)> {
    if let Some(number) = after.strip_prefix('#') {
        let (digits, radix, marker) = match number.strip_prefix(['x', 'X']) {
            Some(hex) => (hex, 16, 2),
            None => (number, 10, 1),
        };
        let length = digits
            .bytes()
            .take_while(|byte| byte.is_ascii_digit() || (radix == 16 && byte.is_ascii_hexdigit()))
            .count();
        if length == 0 {
            return None;
        }
        let code = u32::from_str_radix(slice(digits, 0, length.min(8)), radix).unwrap_or(0);
        let code = if length > 8 { 0 } else { code };
        let semicolon = usize::from(digits.as_bytes().get(length) == Some(&b';'));
        return Some((numeric_character(code), marker + length + semicolon));
    }
    let length = after.bytes().take_while(u8::is_ascii_alphanumeric).count();
    if length == 0 || after.as_bytes().get(length) != Some(&b';') {
        return None;
    }
    let decoded = named_entity(slice(after, 0, length))?;
    Some((decoded.to_string(), length + 1))
}

/// A numeric reference's character. 128–159 are read as Windows-1252, as the
/// HTML standard says (old Word pages write `&#150;` for an en dash); 0, a
/// surrogate or a number past Unicode is U+FFFD.
fn numeric_character(code: u32) -> String {
    let character = match u8::try_from(code) {
        Ok(byte @ 0x80..=0x9F) => super::txt::windows_1252_char(byte),
        _ if code == 0 => Some('\u{FFFD}'),
        _ => Some(char::from_u32(code).unwrap_or('\u{FFFD}')),
    };
    character.map(String::from).unwrap_or_default()
}

fn named_entity(name: &str) -> Option<&'static str> {
    Some(match name {
        "amp" => "&",
        "lt" => "<",
        "gt" => ">",
        "quot" => "\"",
        "apos" => "'",
        "nbsp" => "\u{00A0}",
        "ndash" => "–",
        "mdash" => "—",
        "hellip" => "…",
        "lsquo" => "‘",
        "rsquo" => "’",
        "sbquo" => "‚",
        "ldquo" => "“",
        "rdquo" => "”",
        "bdquo" => "„",
        "laquo" => "«",
        "raquo" => "»",
        "bull" => "•",
        "middot" => "·",
        "copy" => "©",
        "reg" => "®",
        "trade" => "™",
        "euro" => "€",
        "pound" => "£",
        "deg" => "°",
        "times" => "×",
        "divide" => "÷",
        "aring" => "å",
        "auml" => "ä",
        "ouml" => "ö",
        "Aring" => "Å",
        "Auml" => "Ä",
        "Ouml" => "Ö",
        "eacute" => "é",
        "Eacute" => "É",
        "egrave" => "è",
        "uuml" => "ü",
        "Uuml" => "Ü",
        "oslash" => "ø",
        "Oslash" => "Ø",
        "aelig" => "æ",
        "AElig" => "Æ",
        "szlig" => "ß",
        "ensp" => "\u{2002}",
        "emsp" => "\u{2003}",
        "thinsp" => "\u{2009}",
        "shy" | "zwnj" | "zwj" => "",
        _ => return None,
    })
}

/// `text[from..to]`, or nothing when the range is not one (the tokenizer only
/// cuts at ASCII bytes, which are always character boundaries).
fn slice(text: &str, from: usize, to: usize) -> &str {
    text.get(from..to).unwrap_or_default()
}

/// Where the next `byte` is from `from`, or the end.
fn find_byte(bytes: &[u8], from: usize, byte: u8) -> usize {
    bytes
        .get(from..)
        .and_then(|rest| rest.iter().position(|&found| found == byte))
        .map_or(bytes.len(), |position| from + position)
}

/// Where the text after the next `needle` from `from` starts, or the end.
fn after(html: &str, from: usize, needle: &str) -> usize {
    html.get(from..)
        .and_then(|rest| rest.find(needle))
        .map_or(html.len(), |position| from + position + needle.len())
}

fn find_ignore_case(html: &str, from: usize, needle: &str) -> Option<usize> {
    let needle = needle.as_bytes();
    html.as_bytes()
        .get(from..)?
        .windows(needle.len())
        .position(|window| window.eq_ignore_ascii_case(needle))
        .map(|position| from + position)
}

fn starts_with_ignore_case(text: &str, prefix: &str) -> bool {
    text.as_bytes()
        .get(..prefix.len())
        .is_some_and(|start| start.eq_ignore_ascii_case(prefix.as_bytes()))
}
