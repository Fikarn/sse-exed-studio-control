//! What a deck page is made of (2026-10-03, the Companion 5 profile): a
//! control is a key, a cell of the touch strip or a dial, what a press, a
//! push or a turn of it sends, and how it is drawn — layers of a background,
//! an image from the profile's image library, and the live values over it,
//! and the rules that pick its image and colour its values from the bridge's
//! state words. The profile (`companion.rs`) and the page model Setup draws
//! (`snapshot.rs`) are both read off these, and neither reads the other's
//! JSON.
//!
//! The look (2026-10-03, the visual overhaul): the image draws every fixed
//! word of a key or a cell, in the brand's faces, with a picture for each
//! state the deck shows (`scripts/deck-assets.py`); a rule on a word the
//! bridge already sends picks the picture. Only what changes freely is
//! Companion's own text: values, names, the take's length, a count. A
//! control's `label` stays its name for Setup's map and Companion's editor;
//! the deck never draws it as text.

use serde_json::Value;

// The deck's palette: the screen's (docs/DESIGN.md §4, the tokens'
// `core.json`), and the hardware's black glass. Nothing else is drawn; the
// tests hold every colour of the profile to `DECK_PALETTE`.
/// The black glass: a key that does nothing, and the words on a lit fill.
pub(super) const DECK_BLACK: u32 = 0x0000_0000;
/// The face of a key at rest.
pub(super) const DECK_FACE: u32 = 0x0011_1A17;
/// A black display well: the touch strip.
pub(super) const DECK_WELL: u32 = 0x0004_0706;
/// Beige Light, the main ink: a value.
pub(super) const DECK_INK: u32 = 0x00F6_F5E8;
/// The second ink: a live line under a key's word.
pub(super) const DECK_INK_2: u32 = 0x00C5_C7B9;
/// The quiet ink: a dial's name over its value, a disabled key's reason.
pub(super) const DECK_INK_3: u32 = 0x008D_9389;
/// The fourth ink: what cannot act or is not known.
pub(super) const DECK_INK_4: u32 = 0x0059_625C;
/// A fader's cap.
pub(super) const DECK_CAP: u32 = 0x00D8_D7C5;
/// Live and on: the prompter's text scrolls, the rig holds the scene.
pub(super) const DECK_GREEN: u32 = 0x0099_BA92;
/// Engaged and attention: the mix target, a strip muted, a scene unsaved, a
/// Console that is not verified.
pub(super) const DECK_YELLOW: u32 = 0x00F2_DE6F;
/// The armed form: the second press does it.
pub(super) const DECK_BURGUNDY: u32 = 0x0067_1919;
/// Information: Preview.
pub(super) const DECK_BLUE: u32 = 0x003A_87E5;
/// The page keys.
pub(super) const DECK_DARK_GREEN: u32 = 0x0000_4932;

/// Every colour the deck may draw: the screen's palette by its token names.
#[cfg(test)]
pub(super) const DECK_PALETTE: [(&str, u32); 17] = [
    ("black", DECK_BLACK),
    ("face", DECK_FACE),
    ("well", DECK_WELL),
    ("line", 0x0021_2D28),
    ("line-2", 0x0036_453E),
    ("ink", DECK_INK),
    ("ink-2", DECK_INK_2),
    ("ink-3", DECK_INK_3),
    ("ink-4", DECK_INK_4),
    ("cap", DECK_CAP),
    ("green", DECK_GREEN),
    ("yellow", DECK_YELLOW),
    ("coral", 0x00FF_7D55),
    ("burgundy", DECK_BURGUNDY),
    ("beige", 0x00ED_EBD1),
    ("blue", DECK_BLUE),
    ("dark-green", DECK_DARK_GREEN),
];

/// Where a control is on the deck: a key (rows 0 and 1), a cell of the touch
/// strip (row 2, over its dial) or a dial (row 3, which Companion never
/// draws on a Stream Deck+).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Place {
    Key { row: u8, col: u8 },
    Cell(u8),
    Dial(u8),
}

impl Place {
    pub(super) fn row(self) -> u8 {
        match self {
            Self::Key { row, .. } => row,
            Self::Cell(_) => 2,
            Self::Dial(_) => 3,
        }
    }

    pub(super) fn col(self) -> u8 {
        match self {
            Self::Key { col, .. } | Self::Cell(col) | Self::Dial(col) => col,
        }
    }
}

/// What a press, a push or a turn sends.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Step {
    /// A key of a page, to the page's route. The deck reads every display
    /// again with it, so the key's own displays follow at once.
    Post {
        route: &'static str,
        action: &'static str,
        value: Option<&'static str>,
    },
    /// Turns the deck alone to a page (its page id); sends nothing to the
    /// hardware link.
    Jump(&'static str),
}

/// A property of an element: a fixed value, or an expression Companion
/// evaluates against the displays (`companion.rs`).
#[derive(Debug, Clone, PartialEq)]
pub(super) enum Prop {
    Fixed(Value),
    Expr(String),
}

impl Prop {
    pub(super) fn colour(colour: u32) -> Self {
        Self::Fixed(Value::from(colour))
    }

    pub(super) fn text(text: &str) -> Self {
        Self::Fixed(Value::from(text))
    }

    pub(super) fn flag(on: bool) -> Self {
        Self::Fixed(Value::from(on))
    }

    /// An image of the profile's library, by its name.
    pub(super) fn image(name: &str) -> Self {
        Self::Expr(format!("$(image:{name})"))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Align {
    Left,
    Center,
}

impl Align {
    pub(super) fn word(self) -> &'static str {
        match self {
            Self::Left => "left",
            Self::Center => "center",
        }
    }
}

/// One layer of a control, placed in percent of the control.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct Element {
    pub(super) id: &'static str,
    pub(super) kind: ElementKind,
    pub(super) bounds: [f64; 4],
    /// Whether it is drawn: a fixed answer, or an expression.
    pub(super) enabled: Prop,
}

impl Element {
    pub(super) fn new(id: &'static str, kind: ElementKind, bounds: [f64; 4]) -> Self {
        Self {
            id,
            kind,
            bounds,
            enabled: Prop::flag(true),
        }
    }

    pub(super) fn drawn_while(mut self, when: String) -> Self {
        self.enabled = Prop::Expr(when);
        self
    }

    /// Not drawn until a rule says so.
    pub(super) fn hidden(mut self) -> Self {
        self.enabled = Prop::flag(false);
        self
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(super) enum ElementKind {
    /// A box: the control's background, or a mark.
    Fill { colour: Prop },
    /// An image of the profile's library, by its name.
    Image { image: &'static str },
    /// Words: a live value (a fixed label is the image's). `size` is
    /// Companion's, a percentage of the element's height: a box `h` px high
    /// draws `size * h / 120` px type.
    Text {
        text: Prop,
        size: f64,
        colour: Prop,
        align: Align,
    },
    /// A bar from 0 to `max` (Companion 5's gauge).
    Gauge { value: Prop, max: f64, colour: u32 },
}

/// A colour rule: while `when` (a Companion expression) is true, the
/// element properties take these values. Later rules win.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct Rule {
    pub(super) when: String,
    pub(super) set: Vec<(&'static str, &'static str, Prop)>,
}

/// One control of a page.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct Control {
    pub(super) place: Place,
    /// Its name: Setup's map prints it, and Companion's editor shows it.
    pub(super) label: &'static str,
    /// What a cell that only shows says it shows, for Setup's map.
    pub(super) shows: Option<&'static str>,
    pub(super) press: Option<Step>,
    pub(super) left: Option<Step>,
    pub(super) right: Option<Step>,
    pub(super) elements: Vec<Element>,
    pub(super) rules: Vec<Rule>,
}

impl Control {
    fn new(place: Place, label: &'static str) -> Self {
        Self {
            place,
            label,
            shows: None,
            press: None,
            left: None,
            right: None,
            elements: Vec::new(),
            rules: Vec::new(),
        }
    }

    pub(super) fn on_press(mut self, step: Step) -> Self {
        self.press = Some(step);
        self
    }

    pub(super) fn rule(
        mut self,
        when: impl Into<String>,
        set: Vec<(&'static str, &'static str, Prop)>,
    ) -> Self {
        self.rules.push(Rule {
            when: when.into(),
            set,
        });
        self
    }

    pub(super) fn element(mut self, element: Element) -> Self {
        self.elements.push(element);
        self
    }

    /// The text elements of the control, for a rule that inks them all.
    fn texts(&self) -> Vec<&'static str> {
        self.elements
            .iter()
            .filter(|element| matches!(element.kind, ElementKind::Text { .. }))
            .map(|element| element.id)
            .collect()
    }

    /// The image the control shows at rest; the pictures of its states are
    /// named after it (`<art>_locked`, `<art>_off`).
    pub(super) fn art(&self) -> Option<&'static str> {
        self.elements.iter().find_map(|element| match element.kind {
            ElementKind::Image { image } if element.id == ART => Some(image),
            _ => None,
        })
    }

    /// Every live text of the control in `colour` while `when` holds.
    pub(super) fn inked(self, when: impl Into<String>, colour: u32) -> Self {
        let set = self
            .texts()
            .into_iter()
            .map(|id| (id, "color", Prop::colour(colour)))
            .collect();
        self.rule(when, set)
    }

    /// The picture `image` on a background of `fill` while `when` holds: a
    /// state of the key (`DIM` on, `OFF?` asking).
    pub(super) fn shows(self, when: impl Into<String>, image: &str, fill: u32) -> Self {
        self.shows_and(when, image, fill, Vec::new())
    }

    /// The picture, its background, and `more`, while `when` holds: one rule.
    pub(super) fn shows_and(
        self,
        when: impl Into<String>,
        image: &str,
        fill: u32,
        more: Vec<(&'static str, &'static str, Prop)>,
    ) -> Self {
        let mut set: Vec<(&'static str, &'static str, Prop)> = vec![
            (ART, "base64Image", Prop::image(image)),
            (FILL, "color", Prop::colour(fill)),
        ];
        set.extend(more);
        self.rule(when, set)
    }

    /// The locked form while `when` holds (the AUDIO keys while the Console
    /// is locked): the key's `<art>_locked` picture, a dashed edge and its
    /// words in the fourth ink, and any live text in that ink. It comes
    /// after the key's state rules, so a state the hardware link still sends
    /// shows nothing while it cannot act; only the lost link's comes after.
    pub(super) fn locked_while(self, when: impl Into<String>) -> Self {
        let art = self.art().expect("a locked key has an image");
        let mut set: Vec<(&'static str, &'static str, Prop)> = vec![
            (ART, "base64Image", Prop::image(&format!("{art}_locked"))),
            (FILL, "color", Prop::colour(DECK_FACE)),
        ];
        set.extend(
            self.texts()
                .into_iter()
                .map(|id| (id, "color", Prop::colour(DECK_INK_4))),
        );
        self.rule(when, set)
    }

    /// Grey, and every value gone, while the deck has not heard the hardware
    /// link for a while (`companion.rs`, `deck_link`): what it showed is no
    /// longer known. A key shows its `<art>_off` picture, its words in the
    /// fourth ink; a cell keeps its dial's name, which does not change. Last,
    /// so it wins over every other rule.
    pub(super) fn grey_without_the_link(self) -> Self {
        let mut set: Vec<(&'static str, &'static str, Prop)> = Vec::new();
        match self.place {
            Place::Cell(_) => set.push((FILL, "color", Prop::colour(DECK_WELL))),
            _ => {
                let art = self.art().expect("a key has an image");
                set.push((ART, "base64Image", Prop::image(&format!("{art}_off"))));
                set.push((FILL, "color", Prop::colour(DECK_FACE)));
            }
        }
        for element in &self.elements {
            match element.kind {
                ElementKind::Text { .. } => {
                    set.push((element.id, "color", Prop::colour(DECK_INK_4)))
                }
                // The marks over the picture: the bar, its unity mark, the
                // lamp, the selection's keyline.
                ElementKind::Gauge { .. } => set.push((element.id, "enabled", Prop::flag(false))),
                ElementKind::Fill { .. } | ElementKind::Image { .. }
                    if element.id != FILL && element.id != ART =>
                {
                    set.push((element.id, "enabled", Prop::flag(false)))
                }
                _ => {}
            }
        }
        self.rule(link_lost(), set)
    }
}

/// The ids of a control's layers.
pub(super) const FILL: &str = "fill";
pub(super) const ART: &str = "art";
pub(super) const LAMP: &str = "lamp";
pub(super) const LABEL: &str = "label";
pub(super) const HEAD: &str = "head";
pub(super) const VALUE: &str = "value";

/// A display's value line, or its word, as the profile reads it.
pub(super) fn shown(display: &str) -> String {
    format!("$(expression:deck_{display})")
}

/// A display's line above its value, as the profile reads it.
pub(super) fn shown_head(display: &str) -> String {
    format!("$(expression:deck_{display}_head)")
}

/// A display's word is `word` (an expression).
pub(super) fn reads(display: &str, word: &str) -> String {
    format!("{} == '{word}'", shown(display))
}

/// While the deck has not heard the hardware link for a while.
pub(super) fn link_lost() -> String {
    String::from("$(expression:deck_link) == 'lost'")
}

/// Where a key's live text sits, over its picture, and its size: the
/// pictures leave its place free (`scripts/deck-assets.py`). Every box
/// keeps inside a keyline (12 to 108 px across), so a long word shrinks
/// rather than cross it.
#[derive(Debug, Clone, Copy)]
pub(super) struct Line {
    bounds: [f64; 4],
    size: f64,
    colour: u32,
}

/// Under the key's word, where a sub-word would be (the take's length, the
/// time left, `LAST KNOWN`): 22 px, its middle 79 px down.
pub(super) const SUB_LINE: Line = Line {
    bounds: [10.0, 54.0, 80.0, 24.0],
    size: 92.0,
    colour: DECK_INK_2,
};
/// Between `SOLO` and `Clear all`: the count, 20 px.
pub(super) const MIDDLE_LINE: Line = Line {
    bounds: [10.0, 36.0, 80.0, 22.0],
    size: 91.0,
    colour: DECK_INK_2,
};
/// Where a bank key's picture draws its bank: the word when it is none of
/// the pictures', 20 px.
pub(super) const BANK_LINE: Line = Line {
    bounds: [10.0, 38.0, 80.0, 24.0],
    size: 83.0,
    colour: DECK_INK,
};
/// Where a camera key's picture draws its state: the word when it is none of
/// the pictures', 20 px.
pub(super) const STATE_LINE: Line = Line {
    bounds: [10.0, 52.0, 80.0, 24.0],
    size: 83.0,
    colour: DECK_INK_2,
};

fn text(
    id: &'static str,
    text: Prop,
    bounds: [f64; 4],
    size: f64,
    colour: u32,
    align: Align,
) -> Element {
    Element::new(
        id,
        ElementKind::Text {
            text,
            size,
            colour: Prop::colour(colour),
            align,
        },
        bounds,
    )
}

fn base(place: Place, label: &'static str, art: &'static str, fill: u32) -> Control {
    Control::new(place, label)
        .element(Element::new(
            FILL,
            ElementKind::Fill {
                colour: Prop::colour(fill),
            },
            [0.0, 0.0, 100.0, 100.0],
        ))
        .element(Element::new(
            ART,
            ElementKind::Image { image: art },
            [0.0, 0.0, 100.0, 100.0],
        ))
}

/// A key its picture draws whole: `ALL ON`, `TOP`, `DIM`.
pub(super) fn key(row: u8, col: u8, label: &'static str, art: &'static str) -> Control {
    base(Place::Key { row, col }, label, art, DECK_FACE)
}

/// A key with a live text over its picture: `PLAY` over the time left.
pub(super) fn key_with_value(
    row: u8,
    col: u8,
    label: &'static str,
    value: Prop,
    art: &'static str,
    line: Line,
) -> Control {
    key(row, col, label, art).element(text(
        VALUE,
        value,
        line.bounds,
        line.size,
        line.colour,
        Align::Center,
    ))
}

/// `REC`'s lamp, over its picture, and the take's length under its word.
pub(super) fn lamp_key(row: u8, col: u8, label: &'static str, value: Prop) -> Control {
    key(row, col, label, "key_rec")
        .element(Element::new(
            LAMP,
            ElementKind::Image { image: "lamp_off" },
            [0.0, 0.0, 100.0, 100.0],
        ))
        .element(text(
            VALUE,
            value,
            SUB_LINE.bounds,
            SUB_LINE.size,
            SUB_LINE.colour,
            Align::Center,
        ))
}

/// The page key: the next page's tab word on Dark Green, with a pip a page.
pub(super) fn page_key_base(row: u8, col: u8, label: &'static str, art: &'static str) -> Control {
    base(Place::Key { row, col }, label, art, DECK_DARK_GREEN)
}

/// A key that does nothing: the black glass, whatever Companion's own
/// settings say.
pub(super) fn dark_key(row: u8, col: u8) -> Control {
    base(Place::Key { row, col }, "", "key_dark", DECK_BLACK)
}

/// What a cell's value is, for its size: a number with its unit (38 px), a
/// name (30 px), or an AUDIO strip's level under the strip's name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum CellValue {
    Number,
    Name,
    Strip,
}

/// A cell of the touch strip: the dial's name over its value (two lines).
/// The name is the picture's when it is a fixed word (`INTENSITY`), else
/// (`head`) a display's live line above its value (`LIGHT 2/4`). It only
/// shows: a tap does nothing.
pub(super) fn cell(
    col: u8,
    label: &'static str,
    shows: &'static str,
    head: Option<Prop>,
    display: &str,
    art: &'static str,
    value: CellValue,
) -> Control {
    let mut control = base(Place::Cell(col), label, art, DECK_WELL);
    // The head 20 px in the quiet ink, its box from 4 to 34 px down; a
    // strip's name 24 px in the main ink, from 2 to 32 px.
    let (head_bounds, head_size, head_colour) = match value {
        CellValue::Strip => ([6.0, 2.0, 88.0, 30.0], 96.0, DECK_INK),
        _ => ([6.0, 4.0, 88.0, 30.0], 80.0, DECK_INK_3),
    };
    if let Some(head) = head {
        control = control.element(text(
            HEAD,
            head,
            head_bounds,
            head_size,
            head_colour,
            Align::Left,
        ));
    }
    // The value from 36 to 92 px down; a strip's level from 32 to 78 px,
    // over its bar.
    let (value_bounds, value_size) = match value {
        CellValue::Number => ([6.0, 36.0, 88.0, 56.0], 81.0),
        CellValue::Name => ([6.0, 36.0, 88.0, 56.0], 64.0),
        CellValue::Strip => ([6.0, 32.0, 88.0, 46.0], 89.0),
    };
    control = control.element(text(
        VALUE,
        Prop::Expr(shown(display)),
        value_bounds,
        value_size,
        DECK_INK,
        Align::Left,
    ));
    control.shows = Some(shows);
    control
}

/// A dial: what its push and its turns send. Companion never draws it on a
/// Stream Deck+; its name shows in Companion's editor only.
pub(super) fn dial(
    col: u8,
    label: &'static str,
    press: Option<Step>,
    left: Step,
    right: Step,
) -> Control {
    let mut control = Control::new(Place::Dial(col), label).element(text(
        LABEL,
        Prop::text(label),
        [0.0, 0.0, 100.0, 100.0],
        30.0,
        DECK_INK,
        Align::Center,
    ));
    control.press = press;
    control.left = Some(left);
    control.right = Some(right);
    control
}
