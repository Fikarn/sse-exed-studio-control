//! What a deck page is made of (2026-10-03, the Companion 5 profile): a
//! control is a key, a cell of the touch strip or a dial, what a press, a
//! push or a turn of it sends, and how it is drawn — layers of a background,
//! an image from the profile's image library, its words and its live values,
//! and the rules that colour them from the bridge's state words. The profile
//! (`companion.rs`) and the page model Setup draws (`snapshot.rs`) are both
//! read off these, and neither reads the other's JSON.

use serde_json::Value;

// The deck's palette: the app's Console vocabulary, mirrored on the
// hardware. The brand's palette replaces it later; these are today's.
pub(super) const DECK_WHITE: u32 = 0x00FF_FFFF;
pub(super) const DECK_BLACK: u32 = 0x0000_0000;
pub(super) const DECK_AMBER_BG: u32 = 0x00E8_B13D;
pub(super) const DECK_AMBER_INK: u32 = 0x0024_1D0B;
pub(super) const DECK_WARN_BG: u32 = 0x00FF_D33D;
pub(super) const DECK_WARN_INK: u32 = 0x002A_2206;
pub(super) const DECK_MUTED_INK: u32 = 0x00E0_7A63;
pub(super) const DECK_GREY_INK: u32 = 0x006D_675A;
pub(super) const DECK_BANK_TINT_BG: u32 = 0x004A_3A12;
/// Live: running now (the prompter's text scrolls), and a scene the rig
/// holds, and a camera that is held. The screen's green.
pub(super) const DECK_LIVE_BG: u32 = 0x003D_DC7A;
pub(super) const DECK_LIVE_INK: u32 = 0x0004_200F;
/// A hazard that is on (`REC` while CAM 1 records): the word in the screen's
/// red under a red lamp, on a dark key, never a red fill (D19).
pub(super) const DECK_HAZARD_INK: u32 = 0x00FF_6B6B;
/// Doubt: what a device last reported before it stopped answering.
pub(super) const DECK_DOUBT_INK: u32 = DECK_AMBER_BG;
/// Preview: what the deck changes is staged, not on the rig. The screen's
/// blue for preview (2026-10-03: the deck had no blue until RECALL said
/// PREVIEW and the LIGHTS values turned blue).
pub(super) const DECK_PREVIEW_INK: u32 = 0x007C_C4FF;
/// The selected camera's outline (2026-10-03, F1): white, not an amber fill.
pub(super) const DECK_SELECT_LINE: u32 = DECK_WHITE;
/// The AUDIO strip's bar, as the images drew it: amber, and ember while the
/// strip is muted; the unity mark in cream at about half strength (Companion
/// keeps a colour's alpha inverted in its top byte).
pub(super) const DECK_BAR: u32 = 0x00E8_B13D;
pub(super) const DECK_BAR_MUTED: u32 = 0x00C2_5742;
pub(super) const DECK_UNITY_MARK: u32 = 0x73F7_E7BD;

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
}

#[derive(Debug, Clone, PartialEq)]
pub(super) enum ElementKind {
    /// A box: the control's background, or a mark.
    Fill { colour: Prop },
    /// An image of the profile's library, by its name.
    Image { image: &'static str },
    /// Words: a fixed label or a live value. `size` is Companion's, a
    /// percentage of the element's height.
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

    /// The text elements of the control, for a rule that greys them all.
    fn texts(&self) -> Vec<&'static str> {
        self.elements
            .iter()
            .filter(|element| matches!(element.kind, ElementKind::Text { .. }))
            .map(|element| element.id)
            .collect()
    }

    /// Every word of the control in `colour` while `when` holds.
    pub(super) fn inked(self, when: impl Into<String>, colour: u32) -> Self {
        let set = self
            .texts()
            .into_iter()
            .map(|id| (id, "color", Prop::colour(colour)))
            .collect();
        self.rule(when, set)
    }

    /// A fill and every word in its ink while `when` holds.
    pub(super) fn filled(self, when: impl Into<String>, fill: u32, ink: u32) -> Self {
        self.filled_and(when, fill, ink, Vec::new())
    }

    /// A fill, every word in its ink, and `more`, while `when` holds: one
    /// rule (`OFF?` and `STOP?` change their word too).
    pub(super) fn filled_and(
        self,
        when: impl Into<String>,
        fill: u32,
        ink: u32,
        more: Vec<(&'static str, &'static str, Prop)>,
    ) -> Self {
        let mut set: Vec<(&'static str, &'static str, Prop)> =
            vec![(FILL, "color", Prop::colour(fill))];
        set.extend(
            self.texts()
                .into_iter()
                .map(|id| (id, "color", Prop::colour(ink))),
        );
        set.extend(more);
        self.rule(when, set)
    }

    /// Grey, and every value gone, while the deck has not heard the hardware
    /// link for a while (`companion.rs`, `deck_link`): what it showed is no
    /// longer known. Last, so it wins over every other rule.
    pub(super) fn grey_without_the_link(self) -> Self {
        let mut set: Vec<(&'static str, &'static str, Prop)> =
            vec![(FILL, "color", Prop::colour(DECK_BLACK))];
        for element in &self.elements {
            match element.kind {
                ElementKind::Text { .. } => {
                    set.push((element.id, "color", Prop::colour(DECK_GREY_INK)))
                }
                // The marks on the art: the bar, its unity mark, the lamp.
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

fn text(id: &'static str, text: Prop, bounds: [f64; 4], size: f64, align: Align) -> Element {
    Element::new(
        id,
        ElementKind::Text {
            text,
            size,
            colour: Prop::colour(DECK_WHITE),
            align,
        },
        bounds,
    )
}

fn base(place: Place, label: &'static str, art: &'static str) -> Control {
    Control::new(place, label)
        .element(Element::new(
            FILL,
            ElementKind::Fill {
                colour: Prop::colour(DECK_BLACK),
            },
            [0.0, 0.0, 100.0, 100.0],
        ))
        .element(Element::new(
            ART,
            ElementKind::Image { image: art },
            [0.0, 0.0, 100.0, 100.0],
        ))
}

/// A key with one word, or words on two lines, filling it: `ALL ON`, `TOP`.
/// Companion's own type draws the words over the key's image until the
/// brand's label images take their place.
pub(super) fn key(
    row: u8,
    col: u8,
    label: &'static str,
    words: &str,
    art: &'static str,
) -> Control {
    base(Place::Key { row, col }, label, art).element(text(
        LABEL,
        Prop::text(words),
        [0.0, 0.0, 100.0, 100.0],
        28.0,
        Align::Center,
    ))
}

/// A key with its word over a live value: `BANK` over `INPUTS`.
pub(super) fn key_with_value(
    row: u8,
    col: u8,
    label: &'static str,
    words: Prop,
    value: Prop,
    art: &'static str,
) -> Control {
    base(Place::Key { row, col }, label, art)
        .element(text(
            LABEL,
            words,
            [0.0, 22.0, 100.0, 34.0],
            70.0,
            Align::Center,
        ))
        .element(text(
            VALUE,
            value,
            [0.0, 56.0, 100.0, 26.0],
            72.0,
            Align::Center,
        ))
}

/// A key whose image holds a glyph at its top (the AUDIO page's): its words
/// under the glyph, and a live value under them.
pub(super) fn glyph_key(
    row: u8,
    col: u8,
    label: &'static str,
    words: Prop,
    value: Option<Prop>,
    art: &'static str,
) -> Control {
    let control = base(Place::Key { row, col }, label, art);
    match value {
        Some(value) => control
            .element(text(
                LABEL,
                words,
                [0.0, 40.0, 100.0, 30.0],
                70.0,
                Align::Center,
            ))
            .element(text(
                VALUE,
                value,
                [0.0, 70.0, 100.0, 24.0],
                72.0,
                Align::Center,
            )),
        None => control.element(text(
            LABEL,
            words,
            [0.0, 42.0, 100.0, 50.0],
            48.0,
            Align::Center,
        )),
    }
}

/// `REC`'s lamp, over its art and under its words.
pub(super) fn lamp_key(row: u8, col: u8, label: &'static str, value: Prop) -> Control {
    base(Place::Key { row, col }, label, "key_rec")
        .element(Element::new(
            LAMP,
            ElementKind::Image { image: "lamp_off" },
            [0.0, 0.0, 100.0, 100.0],
        ))
        .element(text(
            LABEL,
            Prop::text("REC"),
            [0.0, 40.0, 100.0, 32.0],
            75.0,
            Align::Center,
        ))
        .element(text(
            VALUE,
            value,
            [0.0, 70.0, 100.0, 24.0],
            72.0,
            Align::Center,
        ))
}

/// A key that does nothing: dark, whatever Companion's own settings say.
pub(super) fn dark_key(row: u8, col: u8) -> Control {
    base(Place::Key { row, col }, "", "key_dark")
}

/// A cell of the touch strip: the dial's name over its value (two lines).
/// `head` is the name: a fixed word, or a display's live line above its
/// value. It only shows: a tap does nothing.
pub(super) fn cell(
    col: u8,
    label: &'static str,
    shows: &'static str,
    head: Prop,
    display: &str,
    art: &'static str,
) -> Control {
    let head_id = if matches!(head, Prop::Fixed(_)) {
        LABEL
    } else {
        HEAD
    };
    let mut control = base(Place::Cell(col), label, art)
        .element(text(
            head_id,
            head,
            [6.0, 4.0, 88.0, 34.0],
            62.0,
            Align::Left,
        ))
        .element(text(
            VALUE,
            Prop::Expr(shown(display)),
            [6.0, 38.0, 88.0, 46.0],
            80.0,
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
        Align::Center,
    ));
    control.press = press;
    control.left = Some(left);
    control.right = Some(right);
    control
}
