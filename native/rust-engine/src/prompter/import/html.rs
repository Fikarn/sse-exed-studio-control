//! A paste that held formatting: the clipboard's HTML, from Word, a browser or
//! Google Docs (§3.1). No HTML crate: a small tolerant tokenizer that never
//! fails. A clipboard's HTML is a fragment, often with elements left open, and
//! the worst a surprise in it can do is cost a paragraph break.
//!
//! What each source writes, and what becomes of it:
//! - Word: `<p class=MsoNormal>`, `<o:p>&nbsp;</o:p>` for an empty paragraph,
//!   a list paragraph as `<p style='mso-list:l0 level1 lfo1'>` with the bullet
//!   or number Word draws inside `<![if !supportLists]>…<![endif]>`, and each
//!   picture twice: as VML in a conditional comment and as an `<img>`. A
//!   tracked change is `<del>` and `<ins>`: the deletion goes and the
//!   insertion stays, as if accepted. A footnote's or a comment's mark is an
//!   `<a style='mso-footnote-id:…'>` or `<a class=msocomanchor>`, counted and
//!   left out, and the notes and comments come after the text in `div`s
//!   styled `mso-element:footnote-list` (and the like), which are left out.
//! - Google Docs: everything inside `<b style="font-weight:normal">`, the
//!   emphasis in each span's `style` (`font-weight:700`), a list item's text
//!   as `<li><p>`.
//! - a browser: plain HTML.

mod entities;

use self::entities::decode_entities;
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
/// Where Word's HTML draws, for programs without a feature, what it would
/// otherwise make itself, up to `WORD_CONDITIONAL_END`.
const WORD_CONDITIONALS: [(&str, WordConditional); 3] = [
    ("<![if !supportLists]>", WordConditional::Lists),
    ("<![if !supportFootnotes]>", WordConditional::Footnotes),
    ("<![if !supportAnnotations]>", WordConditional::Annotations),
];
const WORD_CONDITIONAL_END: &str = "<![endif]>";
/// The `mso-element` values of Word's footnotes, endnotes and comments,
/// which follow the text: left out with everything inside them.
const WORD_NOTES: [&str; 6] = [
    "footnote-list",
    "endnote-list",
    "comment-list",
    "footnote",
    "endnote",
    "comment",
];
/// The attributes the reader uses; the others are passed over and not kept.
const KEPT_ATTRIBUTES: [&str; 4] = ["style", "class", "start", "value"];
/// How many attributes of one tag are read. Word and Google Docs write a
/// handful; past these, the tag's end is looked for and nothing more read.
const MOST_ATTRIBUTES: usize = 256;
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
        tracked_changes_accepted: reader.tracked_changes,
        encoding: None,
    }
}

/// What Word draws inside one of its conditionals (`WORD_CONDITIONALS`).
#[derive(Debug, Clone, Copy)]
enum WordConditional {
    /// A list paragraph's bullet or number.
    Lists,
    /// A footnote's or an endnote's mark (`[1]`), and the rule above the
    /// notes.
    Footnotes,
    /// A comment's anchor (`[EL1]`) and the frame around the comment.
    Annotations,
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

/// A start tag's name and the attributes the reader uses
/// (`KEPT_ATTRIBUTES`), each as first written.
#[derive(Default)]
struct StartTag {
    name: String,
    style: Option<String>,
    class: Option<String>,
    start: Option<String>,
    value: Option<String>,
    self_closing: bool,
}

impl StartTag {
    /// Where the attribute `key` (any case) is kept, if it is one the reader
    /// uses.
    fn slot(&mut self, key: &str) -> Option<&mut Option<String>> {
        let kept = KEPT_ATTRIBUTES
            .iter()
            .position(|kept| kept.eq_ignore_ascii_case(key))?;
        Some(match kept {
            0 => &mut self.style,
            1 => &mut self.class,
            2 => &mut self.start,
            _ => &mut self.value,
        })
    }
}

/// What a start tag adds to the import's counts, besides its frame.
#[derive(Debug, Clone, Copy, Default)]
struct Counted {
    /// A Word list paragraph.
    word_list: bool,
    /// A footnote's or an endnote's mark.
    footnote: bool,
    /// A comment's anchor.
    comment: bool,
    /// A tracked change (`del`, `ins`).
    tracked_change: bool,
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
    /// No `<![endif]>` follows the Word conditional last read.
    no_conditional_end: bool,
    paragraphs: Vec<PrompterParagraph>,
    left_out: LeftOut,
    tracked_changes: bool,
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
        } else if let Some((marker, conditional)) = word_conditional(rest) {
            let content = at + marker.len();
            // Once no `<![endif]>` follows, none follows a later conditional
            // either: searching again for each would make a paste of them
            // slow.
            let end = if self.no_conditional_end {
                None
            } else {
                find_ignore_case(html, content, WORD_CONDITIONAL_END)
            };
            match end {
                Some(end) => {
                    self.word_conditional(conditional, slice(html, content, end));
                    end + WORD_CONDITIONAL_END.len()
                }
                None => {
                    self.no_conditional_end = true;
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
        let (mut frame, counted) = self.child_frame(tag);
        if !hidden {
            self.left_out.footnotes += usize::from(counted.footnote);
            self.left_out.comments += usize::from(counted.comment);
            self.tracked_changes |= counted.tracked_change;
        }
        if tag.self_closing || self.frames.len() >= DEEPEST {
            return;
        }
        match name {
            "ul" | "ol" => {
                let start = tag
                    .start
                    .as_deref()
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
                    .value
                    .as_deref()
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
            _ if counted.word_list => {
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
    /// whole paste in `<b style="font-weight:normal">`). Also what it adds to
    /// the counts: whether it is a Word list paragraph, a note's or a
    /// comment's mark (left out), or a tracked change (`<del>` left out,
    /// `<ins>` kept as it is).
    fn child_frame(&self, tag: &StartTag) -> (Frame, Counted) {
        let parent = self.top();
        let name = tag.name.as_str();
        let mut frame = Frame {
            name: tag.name.clone(),
            marks: parent.marks,
            hidden: parent.hidden || HIDDEN.contains(&name) || name == "del",
            ignored: parent.ignored,
            pre: parent.pre || name == "pre",
            heading: parent.heading || is_heading(name),
            in_cell: parent.in_cell || matches!(name, "td" | "th"),
            opens_list: false,
            sets_prefix: false,
        };
        let mut counted = Counted {
            tracked_change: matches!(name, "del" | "ins"),
            ..Counted::default()
        };
        match name {
            "b" | "strong" => frame.marks.bold = true,
            "i" | "em" | "cite" => frame.marks.italic = true,
            "u" => frame.marks.underline = true,
            _ => {}
        }
        // Word's comment anchor (`[EL1]`) in the text, and its mark in the
        // comment.
        for class in tag.class.as_deref().unwrap_or_default().split_whitespace() {
            if class.eq_ignore_ascii_case("msocomanchor") {
                frame.hidden = true;
                counted.comment = true;
            } else if class.eq_ignore_ascii_case("msocomoff") {
                frame.hidden = true;
            }
        }
        for declaration in tag.style.as_deref().unwrap_or_default().split(';') {
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
                "mso-list" => counted.word_list = value != "none" && is_block(name),
                // The notes and comments after the text, and a note's or a
                // comment's mark in it.
                "mso-element" if WORD_NOTES.contains(&value) => frame.hidden = true,
                "mso-special-character" if matches!(value, "footnote" | "comment") => {
                    frame.hidden = true;
                }
                "mso-footnote-id" | "mso-endnote-id" => {
                    frame.hidden = true;
                    counted.footnote = true;
                }
                _ => {}
            }
        }
        (frame, counted)
    }

    /// What Word drew inside one of its conditionals: a list paragraph's
    /// number is kept; a note's mark and a comment's anchor are left out, the
    /// anchor counted.
    fn word_conditional(&mut self, conditional: WordConditional, content: &str) {
        match conditional {
            WordConditional::Lists => self.word_list_marker(content),
            WordConditional::Footnotes => {}
            WordConditional::Annotations => {
                if !self.top().hidden {
                    self.left_out.comments += count_ignore_case(content, "msocomanchor");
                }
            }
        }
    }

    /// The number Word draws for a list paragraph, from inside
    /// `<![if !supportLists]>`: a number (`1.`, `b)`, `iv.`, `1.1`, `3`) is
    /// kept; a bullet (Word draws `·`, `o` or `§` in a symbol font) stays a
    /// dash.
    fn word_list_marker(&mut self, content: &str) {
        if self.prefix.is_none() {
            return;
        }
        let marker: String = visible_text(content)
            .chars()
            .filter(|character| !character.is_whitespace())
            .collect();
        let numeral =
            |character: char| character.is_ascii_alphanumeric() || ".()".contains(character);
        let is_number = marker.len() <= 9
            && marker.chars().all(numeral)
            && (marker.contains(|character: char| character.is_ascii_digit())
                || marker
                    .strip_suffix(['.', ')'])
                    .is_some_and(|body| !body.is_empty()));
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
        // A blank line — a second break with no word since the first — ends
        // the paragraph, as an empty line does in a `.txt` (§3.2): e-mail and
        // web pastes often part their paragraphs with `<br><br>`. In a table
        // cell or a heading it stays a line of the one paragraph.
        if self.has_text && !self.heading && !self.top().in_cell && self.at_blank_line() {
            self.flush();
            return;
        }
        self.push("\n", Marks::default());
        self.last_space = true;
    }

    /// Whether the text so far ends in a line break followed by nothing but
    /// white space.
    fn at_blank_line(&self) -> bool {
        for run in self.current.iter().rev() {
            for character in run.text.chars().rev() {
                if character == '\n' {
                    return true;
                }
                if !character.is_whitespace() {
                    return false;
                }
            }
        }
        false
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

/// A start tag's name and the attributes the reader uses, from just after its
/// `<`, and where the text after it starts. Values may be quoted either way or
/// not at all; an attribute with no value has an empty one. Only the first
/// `MOST_ATTRIBUTES` attributes are read, and only the `KEPT_ATTRIBUTES` kept,
/// so a tag of millions costs one pass and no memory.
fn start_tag(html: &str, from: usize) -> (StartTag, usize) {
    let bytes = html.as_bytes();
    let (name, mut at) = tag_name(html, from);
    let mut tag = StartTag {
        name,
        ..StartTag::default()
    };
    let mut attributes = 0;
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
                    tag.self_closing = true;
                    at += 1;
                    break;
                }
                continue;
            }
            _ if attributes == MOST_ATTRIBUTES => {
                at = after(html, at, ">");
                break;
            }
            _ => attributes += 1,
        }
        let key_start = at;
        while bytes
            .get(at)
            .is_some_and(|byte| !byte.is_ascii_whitespace() && !b"=>/".contains(byte))
        {
            at += 1;
        }
        let key = slice(html, key_start, at);
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
        if let Some(slot) = tag.slot(key).filter(|slot| slot.is_none()) {
            *slot = Some(decode_entities(value).into_owned());
        }
    }
    (tag, at)
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

/// The Word conditional `rest` starts with, and its marker.
fn word_conditional(rest: &str) -> Option<(&'static str, WordConditional)> {
    WORD_CONDITIONALS
        .iter()
        .copied()
        .find(|(marker, _)| starts_with_ignore_case(rest, marker))
}

/// How many times `needle` (ASCII) is in `text`, case ignored.
fn count_ignore_case(text: &str, needle: &str) -> usize {
    text.as_bytes()
        .windows(needle.len())
        .filter(|window| window.eq_ignore_ascii_case(needle.as_bytes()))
        .count()
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
