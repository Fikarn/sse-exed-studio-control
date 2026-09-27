//! `word/styles.xml`: what the document's styles say about headings, lists
//! and emphasis. A paragraph or a run names its style by id, which Word
//! localizes ("Rubrik1" in a Swedish Word); a built-in style is recognised by
//! its `w:name`, which Word does not ("heading 1" in every language).

use std::collections::HashMap;

use quick_xml::events::{BytesStart, Event};

use super::{attribute, local, number, toggle_is_on, underline_is_on, walk_xml};

/// How far a chain of `w:basedOn` is followed. Word writes no loop, but a
/// damaged file may hold one.
const LONGEST_CHAIN: usize = 10;

/// Bold, italic and underline as a style sets them in its `w:rPr`; `None`
/// where it says nothing, so the next style down the chain decides.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(super) struct Emphasis {
    pub bold: Option<bool>,
    pub italic: Option<bool>,
    pub underline: Option<bool>,
}

impl Emphasis {
    /// This emphasis, with what it leaves unsaid taken from `below`.
    pub(super) fn or(self, below: Self) -> Self {
        Self {
            bold: self.bold.or(below.bold),
            italic: self.italic.or(below.italic),
            underline: self.underline.or(below.underline),
        }
    }
}

#[derive(Default)]
struct Style {
    /// `w:name`, lower-cased.
    name: String,
    based_on: Option<String>,
    outline_level: Option<u32>,
    list: Option<u32>,
    list_level: Option<u32>,
    emphasis: Emphasis,
}

impl Style {
    /// The style's own emphasis. Word's "Strong" is bold and its "Emphasis"
    /// italic even when a file leaves their `w:rPr` out.
    fn own_emphasis(&self) -> Emphasis {
        let mut emphasis = self.emphasis;
        match self.name.as_str() {
            "strong" => emphasis.bold = emphasis.bold.or(Some(true)),
            "emphasis" => emphasis.italic = emphasis.italic.or(Some(true)),
            _ => {}
        }
        emphasis
    }
}

#[derive(Default)]
pub(super) struct Styles {
    paragraph: HashMap<String, Style>,
    character: HashMap<String, Style>,
    /// The paragraph style of a paragraph that names none ("Normal").
    default_paragraph: Option<String>,
}

impl Styles {
    pub(super) fn read(part: &[u8]) -> Self {
        let mut reader = StylesReader::default();
        let _ = walk_xml(part, |event| reader.event(event));
        reader.styles
    }

    /// Whether a paragraph of this style is a heading: its style, or one it
    /// is based on, is a built-in heading or the title, or gives the
    /// paragraph an outline level (0–8; 9 is body text). The nearest style
    /// that names an outline level decides.
    pub(super) fn is_heading(&self, id: Option<&str>) -> bool {
        for style in self.paragraph_chain(id) {
            if is_heading_name(&style.name) {
                return true;
            }
            if let Some(level) = style.outline_level {
                return level <= 8;
            }
        }
        false
    }

    /// The list (`w:numId`) and level a paragraph style puts its paragraphs
    /// in, as Word's "List Bullet" and "List Number" do.
    pub(super) fn list(&self, id: Option<&str>) -> (Option<u32>, Option<u32>) {
        self.paragraph_chain(id)
            .find(|style| style.list.is_some())
            .map_or((None, None), |style| (style.list, style.list_level))
    }

    /// The emphasis a paragraph style gives its text (a bold "Speaker"),
    /// the nearest style in its chain that says anything deciding.
    pub(super) fn paragraph_emphasis(&self, id: Option<&str>) -> Emphasis {
        emphasis_of(self.paragraph_chain(id))
    }

    /// The emphasis a character style gives its run.
    pub(super) fn character_emphasis(&self, id: &str) -> Emphasis {
        emphasis_of(chain(&self.character, Some(id)))
    }

    fn paragraph_chain<'a>(&'a self, id: Option<&'a str>) -> impl Iterator<Item = &'a Style> {
        chain(&self.paragraph, id.or(self.default_paragraph.as_deref()))
    }
}

/// A style and the styles it is based on, nearest first.
fn chain<'a>(
    styles: &'a HashMap<String, Style>,
    id: Option<&'a str>,
) -> impl Iterator<Item = &'a Style> {
    let mut next = id;
    std::iter::from_fn(move || {
        let style = styles.get(next?)?;
        next = style.based_on.as_deref();
        Some(style)
    })
    .take(LONGEST_CHAIN)
}

fn emphasis_of<'a>(chain: impl Iterator<Item = &'a Style>) -> Emphasis {
    chain.fold(Emphasis::default(), |nearer, style| {
        nearer.or(style.own_emphasis())
    })
}

fn is_heading_name(name: &str) -> bool {
    name == "title"
        || name.strip_prefix("heading ").is_some_and(|level| {
            matches!(level, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
        })
}

#[derive(Clone, Copy)]
enum Kind {
    Paragraph,
    Character,
    Other,
}

#[derive(Default)]
struct StylesReader {
    styles: Styles,
    current: Option<(Kind, String, Style)>,
    in_paragraph_properties: bool,
    in_list_properties: bool,
    /// In the style's own `w:rPr`.
    in_run_properties: bool,
    /// In a `w:rPrChange`: the run properties as they were before a
    /// tracked change, which are not the style's.
    in_change: bool,
}

impl StylesReader {
    fn event(&mut self, event: Event<'_>) {
        match event {
            Event::Start(element) => self.open(&element, false),
            Event::Empty(element) => self.open(&element, true),
            Event::End(element) => match element.local_name().into_inner() {
                "style" => self.finish_style(),
                "pPr" => self.in_paragraph_properties = false,
                "numPr" => self.in_list_properties = false,
                "rPrChange" => self.in_change = false,
                "rPr" if !self.in_change => self.in_run_properties = false,
                _ => {}
            },
            _ => {}
        }
    }

    fn open(&mut self, element: &BytesStart<'_>, empty: bool) {
        let name = local(element);
        if name == "style" {
            let kind = match attribute(element, "type").as_deref() {
                Some("paragraph") => Kind::Paragraph,
                Some("character") => Kind::Character,
                _ => Kind::Other,
            };
            let id = attribute(element, "styleId").unwrap_or_default();
            let is_default = attribute(element, "default")
                .is_some_and(|value| matches!(value.trim(), "1" | "true" | "on"));
            if matches!(kind, Kind::Paragraph) && is_default {
                self.styles.default_paragraph = Some(id.clone());
            }
            self.current = Some((kind, id, Style::default()));
            if empty {
                self.finish_style();
            }
            return;
        }
        let Some((_, _, style)) = self.current.as_mut() else {
            return;
        };
        match name {
            "name" => {
                style.name = attribute(element, "val")
                    .unwrap_or_default()
                    .trim()
                    .to_lowercase();
            }
            "basedOn" => style.based_on = attribute(element, "val"),
            "pPr" if !empty => self.in_paragraph_properties = true,
            "outlineLvl" if self.in_paragraph_properties => style.outline_level = number(element),
            "numPr" if self.in_paragraph_properties && !empty => self.in_list_properties = true,
            "numId" if self.in_list_properties => style.list = number(element),
            "ilvl" if self.in_list_properties => style.list_level = number(element),
            "rPr" if !self.in_paragraph_properties && !empty => self.in_run_properties = true,
            "rPrChange" if !empty => self.in_change = true,
            "b" | "i" | "u" if self.in_run_properties && !self.in_change => {
                let value = attribute(element, "val");
                let value = value.as_deref();
                match name {
                    "b" => style.emphasis.bold = Some(toggle_is_on(value)),
                    "i" => style.emphasis.italic = Some(toggle_is_on(value)),
                    _ => style.emphasis.underline = Some(underline_is_on(value)),
                }
            }
            _ => {}
        }
    }

    fn finish_style(&mut self) {
        self.in_paragraph_properties = false;
        self.in_list_properties = false;
        self.in_run_properties = false;
        self.in_change = false;
        let Some((kind, id, style)) = self.current.take() else {
            return;
        };
        let styles = match kind {
            Kind::Paragraph => &mut self.styles.paragraph,
            Kind::Character => &mut self.styles.character,
            Kind::Other => return,
        };
        styles.entry(id).or_insert(style);
    }
}
