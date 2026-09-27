//! `word/numbering.xml`: what a list paragraph's bullet or number is (§3.2:
//! "bullets and numbering, as a dash or the number"). A paragraph names a list
//! (`w:numId`) and a level in it (`w:ilvl`, 0–8); the list (`w:num`) points at
//! a definition (`w:abstractNum`) whose level gives the number's format, its
//! text (`%1.`, `%1.%2`) and where it starts. A list may start a level again
//! (`w:lvlOverride`/`w:startOverride`) or define a level of its own.

use std::collections::HashMap;

use quick_xml::events::{BytesStart, Event};

use super::{attribute, local, number, walk_xml};

const LEVELS: usize = 9;
/// What a bullet becomes, whatever Word draws: an en dash and a space.
const BULLET: &str = "– ";

#[derive(Clone, Default)]
struct Level {
    /// `w:numFmt`: `bullet`, `decimal`, `lowerLetter`, `upperRoman` …
    format: String,
    /// `w:lvlText`: the number's text, `%1` to `%9` standing for the count
    /// at levels 0 to 8.
    text: String,
    start: Option<i64>,
    /// `w:pStyle`: the paragraph style that puts a paragraph at this level.
    style: Option<String>,
}

#[derive(Default)]
struct List {
    definition: Option<u32>,
    start_overrides: [Option<i64>; LEVELS],
    level_overrides: [Option<Level>; LEVELS],
}

#[derive(Default)]
pub(super) struct Numbering {
    definitions: HashMap<u32, [Option<Level>; LEVELS]>,
    lists: HashMap<u32, List>,
}

/// Where each list's count stands, per list (`w:numId`) and level.
#[derive(Default)]
pub(super) struct ListCounters(HashMap<u32, [Option<i64>; LEVELS]>);

impl Numbering {
    pub(super) fn read(part: &[u8]) -> Self {
        let mut reader = NumberingReader::default();
        let _ = walk_xml(part, |event| reader.event(event));
        reader.numbering
    }

    fn level(&self, list: u32, level: usize) -> Option<&Level> {
        let entry = self.lists.get(&list)?;
        if let Some(own) = entry.level_overrides.get(level)?.as_ref() {
            return Some(own);
        }
        self.definitions
            .get(&entry.definition?)?
            .get(level)?
            .as_ref()
    }

    /// Where a level's count starts. A level with no `w:start` starts at 0,
    /// as the standard says and Word does.
    fn start(&self, list: u32, level: usize) -> i64 {
        self.lists
            .get(&list)
            .and_then(|entry| entry.start_overrides.get(level).copied().flatten())
            .or_else(|| self.level(list, level).and_then(|level| level.start))
            .unwrap_or(0)
    }

    /// The level whose `w:pStyle` is `style`, for a paragraph whose style
    /// names the list but not the level (Word's numbered headings).
    pub(super) fn level_for_style(&self, list: u32, style: &str) -> Option<u32> {
        (0..LEVELS)
            .find(|&level| {
                self.level(list, level)
                    .is_some_and(|found| found.style.as_deref() == Some(style))
            })
            .and_then(|level| u32::try_from(level).ok())
    }

    /// Counts a paragraph at `level` of `list` and gives what goes in front of
    /// its text: `– ` for a bullet, the level's text with its counts for a
    /// number (`3. `, `2.1 `, `b) `), `None` for no list (`w:numId` 0) or a
    /// level with no text. A level's count starts again whenever a shallower
    /// level of the same list counts on.
    pub(super) fn prefix(
        &self,
        counters: &mut ListCounters,
        list: u32,
        level: u32,
    ) -> Option<String> {
        let level = usize::try_from(level)
            .ok()
            .filter(|&level| level < LEVELS)?;
        if list == 0 {
            return None;
        }
        let definition = self.level(list, level)?;
        let counts = counters.0.entry(list).or_insert([None; LEVELS]);
        counts[level] = Some(match counts[level] {
            Some(count) => count.saturating_add(1),
            None => self.start(list, level),
        });
        for deeper in &mut counts[level + 1..] {
            *deeper = None;
        }
        if definition.format == "bullet" {
            return Some(BULLET.to_string());
        }
        let mut text = String::new();
        let mut characters = definition.text.chars().peekable();
        while let Some(character) = characters.next() {
            let digit = characters.peek().and_then(|next| next.to_digit(10));
            let shown = match (character, digit) {
                ('%', Some(digit @ 1..=9)) => (digit - 1) as usize,
                _ => {
                    text.push(character);
                    continue;
                }
            };
            characters.next();
            let count = counts[shown].unwrap_or_else(|| self.start(list, shown));
            let format = self
                .level(list, shown)
                .map_or("decimal", |level| level.format.as_str());
            text.push_str(&formatted(count, format));
        }
        let text = text.trim();
        (!text.is_empty()).then(|| format!("{text} "))
    }
}

/// A count as a level's `w:numFmt` writes it. Formats beyond these (Word has
/// dozens: ordinals, Chinese counting, `001`) are written as decimal; `none`
/// shows no number.
fn formatted(count: i64, format: &str) -> String {
    let written = match format {
        "lowerLetter" => letters(count),
        "upperLetter" => letters(count).map(|letters| letters.to_uppercase()),
        "lowerRoman" => roman(count).map(|roman| roman.to_lowercase()),
        "upperRoman" => roman(count),
        "none" => Some(String::new()),
        _ => None,
    };
    written.unwrap_or_else(|| count.to_string())
}

/// `a` to `z`, then `aa`, `bb` … as Word counts. Past 780 (thirty `z`s)
/// the count is written as decimal.
fn letters(count: i64) -> Option<String> {
    let index = usize::try_from(count.checked_sub(1)?)
        .ok()
        .filter(|&index| index < 780)?;
    let letter = char::from(b'a' + u8::try_from(index % 26).ok()?);
    Some(letter.to_string().repeat(index / 26 + 1))
}

/// Roman numerals, 1 to 3,999.
fn roman(count: i64) -> Option<String> {
    const NUMERALS: [(i64, &str); 13] = [
        (1000, "M"),
        (900, "CM"),
        (500, "D"),
        (400, "CD"),
        (100, "C"),
        (90, "XC"),
        (50, "L"),
        (40, "XL"),
        (10, "X"),
        (9, "IX"),
        (5, "V"),
        (4, "IV"),
        (1, "I"),
    ];
    if !(1..=3999).contains(&count) {
        return None;
    }
    let mut rest = count;
    let mut out = String::new();
    for (value, numeral) in NUMERALS {
        while rest >= value {
            out.push_str(numeral);
            rest -= value;
        }
    }
    Some(out)
}

#[derive(Default)]
struct NumberingReader {
    numbering: Numbering,
    definition: Option<(u32, [Option<Level>; LEVELS])>,
    list: Option<(u32, List)>,
    /// The level a `w:lvlOverride` is about.
    override_level: Option<usize>,
    level: Option<(usize, Level)>,
}

impl NumberingReader {
    fn event(&mut self, event: Event<'_>) {
        match event {
            Event::Start(element) => self.open(&element, false),
            Event::Empty(element) => self.open(&element, true),
            Event::End(element) => self.close(element.local_name().into_inner()),
            _ => {}
        }
    }

    fn open(&mut self, element: &BytesStart<'_>, empty: bool) {
        let name = local(element);
        match name {
            "abstractNum" => {
                self.definition =
                    whole_number(element, "abstractNumId").map(|id| (id, Default::default()));
            }
            "num" => {
                self.list = whole_number(element, "numId").map(|id| (id, List::default()));
            }
            "lvl" => {
                self.level = level_index(element).map(|index| (index, Level::default()));
            }
            "lvlOverride" => self.override_level = level_index(element),
            "numFmt" | "lvlText" | "start" | "pStyle" => {
                let Some((_, level)) = self.level.as_mut() else {
                    return;
                };
                let value = attribute(element, "val");
                match name {
                    "numFmt" => level.format = value.unwrap_or_default().trim().to_string(),
                    "lvlText" => level.text = value.unwrap_or_default(),
                    "start" => level.start = value.and_then(|value| value.trim().parse().ok()),
                    _ => level.style = value,
                }
            }
            "abstractNumId" => {
                if let Some((_, list)) = self.list.as_mut() {
                    list.definition = number(element);
                }
            }
            "startOverride" => {
                if let (Some((_, list)), Some(level)) = (self.list.as_mut(), self.override_level) {
                    list.start_overrides[level] =
                        attribute(element, "val").and_then(|value| value.trim().parse().ok());
                }
            }
            _ => {}
        }
        if empty {
            self.close(name);
        }
    }

    fn close(&mut self, name: &str) {
        match name {
            "lvl" => {
                let Some((index, level)) = self.level.take() else {
                    return;
                };
                if let (Some(_), Some((_, list))) = (self.override_level, self.list.as_mut()) {
                    list.level_overrides[index] = Some(level);
                } else if let Some((_, levels)) = self.definition.as_mut() {
                    levels[index] = Some(level);
                }
            }
            "lvlOverride" => self.override_level = None,
            "abstractNum" => {
                if let Some((id, levels)) = self.definition.take() {
                    self.numbering.definitions.entry(id).or_insert(levels);
                }
            }
            "num" => {
                if let Some((id, list)) = self.list.take() {
                    self.numbering.lists.entry(id).or_insert(list);
                }
            }
            _ => {}
        }
    }
}

fn whole_number(element: &BytesStart<'_>, name: &str) -> Option<u32> {
    attribute(element, name)?.trim().parse().ok()
}

/// A `w:ilvl` attribute that names one of the nine levels.
fn level_index(element: &BytesStart<'_>) -> Option<usize> {
    whole_number(element, "ilvl")
        .and_then(|level| usize::try_from(level).ok())
        .filter(|&level| level < LEVELS)
}
