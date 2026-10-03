# Renders the Stream Deck+ label images the Companion profile carries in its
# image library (native/rust-engine/assets/deck/): a PNG of each, to look at,
# and images.json, which the engine embeds (include_str!) and writes into the
# profile's `imageLibrary`. Standalone authoring tool, not part of any npm
# lane: `python scripts/deck-assets.py` with Pillow installed renders every
# image; `--out <folder>` writes them elsewhere; `--adelia <file>` names the
# SSE Adelia font file when it is not installed where the script looks.
# Another Pillow packs the same picture into other bytes, so a render is
# committed whole.
#
# The look (2026-10-03, the visual overhaul, direction Atrium): the deck is a
# small copy of the screen. Every key and every strip cell has an image of its
# own name, drawn at the deck's own size, 120 x 120 for a key and 200 x 100
# for a strip cell, in the screen's palette (docs/DESIGN.md section 4) and its
# faces, with a picture for each state the deck shows; the profile picks the
# picture by a rule on a word the hardware link already sends, and draws only
# what changes freely (values, names, the take's length) in Companion's own
# type over it. The forms, each meaning one thing as on the screen:
#
#   at rest      the key's face (#111A17), no drawn edge: the cap is the edge
#   on, engaged  a lit fill (Green, Yellow) with black words
#   latched      a 4 px keyline, a lamp and the word (SOLO Yellow, REC Coral)
#   selected     a 4 px Beige keyline (the selected camera), its own picture
#   destructive  the word and a 2 px edge in Coral, no lamp (ALL OFF)
#   armed        Burgundy, the word in Beige, "press again", the bar (drawn
#                full: the hardware link counts no seconds for the deck)
#   doubt        a dashed Yellow keyline on the value (REC last known, a
#                camera's last values)
#   locked       a dashed edge in the second line colour at 55 %, the words
#                in the fourth ink (REC with its reason, the AUDIO keys while
#                the Console is locked: the strip says why)
#   disabled     the words in the fourth ink (`_off`: the deck has not heard
#                the hardware link, or nothing is on the prompter)
#
# Type: SSE Adelia Bold for words, commands and state words (capitals only;
# never a value, a unit, a number that changes or a name that keeps its case:
# its "1" reads as an "I", so "CAM 1" is PT Sans Bold); PT Sans Bold for names
# and the page keys' tab words; PT Sans Regular for sub-words; real minus
# signs. Lines are 2 px or more (the deck's JPEG is 4:2:2), and what a key
# shows keeps 9 px clear of its edge, which the cap's bezel hides.
#
# Fonts: PT Sans from the repository (frontend/packages/tokens/src/fonts/,
# SIL OFL). SSE Adelia is SSE's licensed face and the repository is public:
# its file is never copied here, committed or embedded; the script reads the
# copy installed on the studio PC, and only the rendered PNGs are committed.
# The script stops when a font is missing. The render is the same bytes for
# the same fonts and Pillow: no timestamps, a fixed library date.
#
# The AUDIO strip's bar is a Companion gauge drawn over the cell's track, its
# unity mark a box over the gauge, at RME's 0 dB fader position (step 836 of
# 1023 = the app's AUDIO_FADER_UNITY, see native/rust-engine/src/audio/
# fader_curve.rs); the gauge and the texts' boxes are placed by the profile
# (native/rust-engine/src/exports/model.rs and audio.rs), which these
# pictures are drawn to fit.

import argparse
import base64
import hashlib
import io
import json
import os
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "native" / "rust-engine" / "assets" / "deck"
PT_SANS = ROOT / "frontend" / "packages" / "tokens" / "src" / "fonts"
KEY = (120, 120)
CELL = (200, 100)
# Drawn at four times the size and reduced, so that circles and type are
# smooth and a 2 px line is exactly 2 px.
S = 4
# When this render was made: the library's createdAt and modifiedAt, fixed so
# that an export is the same file every time.
RENDERED_AT_MS = 1_759_449_600_000  # 2026-10-03T00:00:00Z

# The screen's palette (frontend/packages/tokens/src/tokens/core.json), and
# the hardware's black glass. Nothing else is drawn.
FACE = "#111A17"
WELL = "#040706"
LINE = "#212D28"
LINE_2 = "#36453E"
INK = "#F6F5E8"
INK_2 = "#C5C7B9"
INK_3 = "#8D9389"
INK_4 = "#59625C"
GREEN = "#99BA92"
YELLOW = "#F2DE6F"
CORAL = "#FF7D55"
BURGUNDY = "#671919"
BEIGE = "#EDEBD1"
BLUE = "#3A87E5"
DARK_GREEN = "#004932"
BLACK = "#000000"

# A key's content keeps this far from its edge; a keyline sits inside it.
CLEAR = 9
KEYLINE_INSET = 5
KEYLINE_RADIUS = 8


def rgb(colour):
    colour = colour.lstrip("#")
    return tuple(int(colour[at : at + 2], 16) for at in (0, 2, 4))


def mix(colour, under, share):
    """`colour` at `share` over `under` (an edge drawn at 55 %)."""
    top, bottom = rgb(colour), rgb(under)
    return "#" + "".join(f"{round(t * share + b * (1 - share)):02X}" for t, b in zip(top, bottom))


# ---------------------------------------------------------------------------
# Fonts
# ---------------------------------------------------------------------------


def find_adelia(given):
    if given:
        return Path(given)
    names = ("SSEAdelia-Bold.otf", "SSEAdelia-Bold.ttf", "SSE Adelia Bold.otf", "SSE Adelia Bold.ttf")
    folders = []
    if os.environ.get("LOCALAPPDATA"):
        folders.append(Path(os.environ["LOCALAPPDATA"]) / "Microsoft" / "Windows" / "Fonts")
    folders.append(Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts")
    for folder in folders:
        for name in names:
            if (folder / name).is_file():
                return folder / name
    return None


def find_pt_sans(file_name):
    candidates = [PT_SANS / file_name]
    if os.environ.get("LOCALAPPDATA"):
        candidates.append(Path(os.environ["LOCALAPPDATA"]) / "Microsoft" / "Windows" / "Fonts" / file_name)
    candidates.append(Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts" / file_name)
    return next((path for path in candidates if path.is_file()), None)


class Faces:
    """The three faces, at any size, at the drawing's scale."""

    def __init__(self, adelia):
        missing = []
        self.paths = {
            "adelia": find_adelia(adelia),
            "sans": find_pt_sans("PTSans-Regular.ttf"),
            "sans-bold": find_pt_sans("PTSans-Bold.ttf"),
        }
        for face, path in self.paths.items():
            if path is None or not Path(path).is_file():
                missing.append(face)
        if missing:
            sys.exit(
                "deck-assets: a font is missing: "
                + ", ".join(missing)
                + ". SSE Adelia Bold is read from the copy installed for the user"
                " (%LOCALAPPDATA%\\Microsoft\\Windows\\Fonts\\SSEAdelia-Bold.otf) or named"
                " with --adelia <file>; it is never copied into the repository."
                " PT Sans is read from frontend/packages/tokens/src/fonts/."
            )
        self.cache = {}

    def get(self, face, size):
        key = (face, size)
        if key not in self.cache:
            self.cache[key] = ImageFont.truetype(str(self.paths[face]), round(size * S))
        return self.cache[key]


# The tracking of docs/DESIGN.md: Adelia 0.03 em at 20 px and below, PT Sans
# in capitals 0.04 em, nothing else.
def tracking(face, size, text):
    if face == "adelia" and size <= 20:
        return 0.03 * size
    if face != "adelia" and text.upper() == text and any(ch.isalpha() for ch in text):
        return 0.04 * size
    return 0.0


# ---------------------------------------------------------------------------
# A picture
# ---------------------------------------------------------------------------


class Art:
    def __init__(self, faces, size, background):
        self.faces = faces
        self.size = size
        self.img = Image.new("RGBA", (size[0] * S, size[1] * S), background and rgb(background) + (255,) or (0, 0, 0, 0))
        self.draw = ImageDraw.Draw(self.img)

    # -- type ---------------------------------------------------------------

    def measure(self, text, face, size):
        """The ink's left and right edge of `text` from its origin, in px."""
        font = self.faces.get(face, size)
        track = tracking(face, size, text) * S
        first = font.getbbox(text[0], anchor="ls")[0]
        last_at = font.getlength(text[:-1]) + track * (len(text) - 1)
        last = last_at + font.getbbox(text[-1], anchor="ls")[2]
        return first / S, last / S

    def width(self, text, face, size):
        left, right = self.measure(text, face, size)
        return right - left

    def fit(self, text, face, size, room):
        """The largest size up to `size` at which `text` fits `room` px."""
        while size > 12 and self.width(text, face, size) > room:
            size -= 1
        return size

    def cap(self, face, size):
        font = self.faces.get(face, size)
        return -font.getbbox("H", anchor="ls")[1] / S

    def text(self, text, face, size, colour, cy, cx=None, left=None):
        """`text` with its capitals' middle at `cy`, centred on `cx` or set
        from `left` (where its ink starts)."""
        font = self.faces.get(face, size)
        track = tracking(face, size, text) * S
        ink_left, ink_right = self.measure(text, face, size)
        if left is None:
            cx = self.size[0] / 2 if cx is None else cx
            left = cx - (ink_right - ink_left) / 2
        origin = (left - ink_left) * S
        baseline = (cy + self.cap(face, size) / 2) * S
        for at, character in enumerate(text):
            x = origin + font.getlength(text[:at]) + track * at
            self.draw.text((round(x), round(baseline)), character, font=font, fill=rgb(colour), anchor="ls")

    def row(self, parts, cy, cx=None, gap=8):
        """Items side by side, centred together: ("lamp", d, colour, hollow)
        or ("text", text, face, size, colour)."""
        widths = []
        for part in parts:
            widths.append(part[1] if part[0] == "lamp" else self.width(part[1], part[2], part[3]))
        total = sum(widths) + gap * (len(parts) - 1)
        x = (self.size[0] / 2 if cx is None else cx) - total / 2
        places = []
        for part, width in zip(parts, widths):
            if part[0] == "lamp":
                self.lamp(x + width / 2, cy, width, part[2], hollow=part[3])
            else:
                self.text(part[1], part[2], part[3], part[4], cy, left=x)
            places.append((x, width))
            x += width + gap
        return places

    # -- marks --------------------------------------------------------------

    def rect(self, x0, y0, x1, y1, colour):
        self.draw.rectangle([round(x0 * S), round(y0 * S), round(x1 * S) - 1, round(y1 * S) - 1], fill=rgb(colour))

    def keyline(self, colour, width, inset=KEYLINE_INSET, radius=KEYLINE_RADIUS, box=None):
        x0, y0, x1, y1 = box or (inset, inset, self.size[0] - inset, self.size[1] - inset)
        self.draw.rounded_rectangle(
            [x0 * S, y0 * S, x1 * S - 1, y1 * S - 1], radius=radius * S, outline=rgb(colour), width=width * S
        )

    def dashed(self, colour, width, inset=KEYLINE_INSET, radius=KEYLINE_RADIUS, box=None, dash=8, gap=6):
        """A dashed keyline: the corners whole, the sides in dashes spread
        evenly between them."""
        x0, y0, x1, y1 = box or (inset, inset, self.size[0] - inset, self.size[1] - inset)
        r, w = radius, width
        # The corners: quarter arcs.
        for (cx, cy, start) in ((x0 + r, y0 + r, 180), (x1 - r, y0 + r, 270), (x1 - r, y1 - r, 0), (x0 + r, y1 - r, 90)):
            self.draw.arc(
                [(cx - r) * S, (cy - r) * S, (cx + r) * S - 1, (cy + r) * S - 1], start, start + 90, fill=rgb(colour), width=w * S
            )

        def spread(a, b):
            length = b - a
            count = max(1, round((length + gap) / (dash + gap)))
            step = (length + gap) / count
            span = step - gap
            return [(a + i * step, a + i * step + span) for i in range(count)]

        for a, b in spread(x0 + r + gap / 2, x1 - r - gap / 2):
            self.rect(a, y0, b, y0 + w, colour)
            self.rect(a, y1 - w, b, y1, colour)
        for a, b in spread(y0 + r + gap / 2, y1 - r - gap / 2):
            self.rect(x0, a, x0 + w, b, colour)
            self.rect(x1 - w, a, x1, b, colour)

    def lamp(self, cx, cy, diameter, colour, hollow=False):
        r = diameter / 2
        box = [(cx - r) * S, (cy - r) * S, (cx + r) * S - 1, (cy + r) * S - 1]
        if hollow:
            self.draw.ellipse(box, outline=rgb(colour), width=2 * S)
        else:
            self.draw.ellipse(box, fill=rgb(colour))

    def pips(self, count, lit, cy, on, off, diameter=8, gap=8):
        """The place in a cycle: one pip a page or a bank, `lit` (0-based)
        filled, the others rings."""
        total = count * diameter + (count - 1) * gap
        x = self.size[0] / 2 - total / 2 + diameter / 2
        for index in range(count):
            self.lamp(x, cy, diameter, on if index == lit else off, hollow=index != lit)
            x += diameter + gap

    def arrow(self, cx, cy, colour, length=40, head=7, stroke=3):
        x0, x1 = cx - length / 2, cx + length / 2
        self.rect(x0, cy - stroke / 2, x1 - 1, cy + stroke / 2, colour)
        line = rgb(colour)
        tip = (x1 * S, cy * S)
        for dy in (-head, head):
            self.draw.line([((x1 - head) * S, (cy + dy) * S), tip], fill=line, width=stroke * S)

    def triangle(self, cx, cy, colour, pointing, w=12, h=18):
        if pointing == "left":
            points = [(cx + w / 2, cy - h / 2), (cx + w / 2, cy + h / 2), (cx - w / 2, cy)]
        else:
            points = [(cx - w / 2, cy - h / 2), (cx - w / 2, cy + h / 2), (cx + w / 2, cy)]
        self.draw.polygon([(x * S, y * S) for x, y in points], fill=rgb(colour))

    def armed_bar(self, colour, segments=3, lit=3, y=96, height=6, left=16, right=16, gap=5):
        room = self.size[0] - left - right - gap * (segments - 1)
        width = room / segments
        for index in range(segments):
            x = left + index * (width + gap)
            self.rect(x, y, x + width, y + height, colour if index < lit else mix(colour, BURGUNDY, 0.22))

    def image(self):
        return self.img.reduce(S)


# ---------------------------------------------------------------------------
# The keys' layouts (the profile's live texts are placed to fit them)
# ---------------------------------------------------------------------------

# A key of a word over a sub-word: the word's capitals centred on WORD_Y, the
# sub-word's (or the live value's, drawn by Companion) on SUB_Y.
WORD_Y = 45
SUB_Y = 79
ROOM = KEY[0] - 2 * CLEAR


def word_key(faces, word, sub=None, *, colour=INK, sub_colour=INK_3, fill=FACE, size=34, edge=None, dashed=None):
    art = Art(faces, KEY, fill)
    if edge:
        art.keyline(edge, 2, inset=6)
    if dashed:
        art.dashed(mix(LINE_2, fill, 0.55), 3)
    size = art.fit(word, "adelia", size, ROOM)
    art.text(word, "adelia", size, colour, WORD_Y if sub is not None else 60)
    if sub:
        art.text(sub, "sans", 22, sub_colour, SUB_Y)
    return art.image()


def two_word_key(faces, first, second, *, colour=INK, fill=FACE, edge=None):
    art = Art(faces, KEY, fill)
    if edge:
        art.keyline(edge, 2, inset=6)
    art.text(first, "adelia", 28, colour, 45)
    art.text(second, "adelia", 28, colour, 75)
    return art.image()


def armed_key(faces, word):
    art = Art(faces, KEY, BURGUNDY)
    art.text(word, "adelia", art.fit(word, "adelia", 34, ROOM), BEIGE, 38)
    art.text("press again", "sans", 20, BEIGE, 70)
    art.armed_bar(BEIGE)
    return art.image()


def name_key(faces, name, *, colour=INK_2, fill=FACE, dashed=False):
    art = Art(faces, KEY, fill)
    if dashed:
        art.dashed(mix(LINE_2, fill, 0.55), 3)
    art.text(name, "sans-bold", art.fit(name, "sans-bold", 24, ROOM), colour, 60)
    return art.image()


# REC: the lamp and the word in one row; the lamp is its own layer
# (`lamp_*`), drawn at the same place as the gap the word leaves for it.
REC_LAMP = 14
REC_GAP = 8


def rec_lamp_at(faces):
    art = Art(faces, KEY, FACE)
    total = REC_LAMP + REC_GAP + art.width("REC", "adelia", 34)
    x = KEY[0] / 2 - total / 2
    return x + REC_LAMP / 2, x + REC_LAMP + REC_GAP


def rec_key(faces, *, colour=INK, keyline=None, dashed_keyline=None, sub=None):
    art = Art(faces, KEY, FACE)
    if keyline:
        art.keyline(keyline, 4)
    if dashed_keyline:
        art.dashed(dashed_keyline, 4)
    _, word_left = rec_lamp_at(faces)
    art.text("REC", "adelia", 34, colour, WORD_Y, left=word_left)
    if sub:
        art.text(sub, "sans", 22, INK_3, SUB_Y)
    return art.image()


def rec_lamp(faces, colour, hollow=False):
    art = Art(faces, KEY, None)
    lamp_x, _ = rec_lamp_at(faces)
    art.lamp(lamp_x, WORD_Y, REC_LAMP, colour, hollow=hollow)
    return art.image()


def rec_locked(faces):
    art = Art(faces, KEY, FACE)
    art.dashed(mix(LINE_2, FACE, 0.55), 3)
    art.text("REC", "adelia", 34, INK_4, WORD_Y)
    art.text("locked", "sans", 20, INK_3, SUB_Y)
    return art.image()


# The bank keys: BANK, the bank's word, and a pip a bank.
def bank_key(faces, word, place, count, *, fill=FACE, dark=False, dashed=False):
    ink, quiet, ring = (BLACK, BLACK, BLACK) if dark else (INK, INK_3, INK_3)
    art = Art(faces, KEY, fill)
    if dashed:
        art.dashed(mix(LINE_2, fill, 0.55), 3)
    if word is None:
        quiet = ink = ring = INK_4
    art.text("BANK", "sans", 20, quiet, 32)
    if word:
        art.text(word, "adelia", art.fit(word, "adelia", 20, ROOM), ink, 60)
    art.pips(count, place, 90, ink, ring)
    return art.image()


# The camera keys: a lamp and the camera's name, its state under it.
def camera_key(faces, number, state=None, colour=INK_4, *, name_colour=INK):
    art = Art(faces, KEY, FACE)
    hollow = state is None
    art.row([("lamp", 12, colour, hollow), ("text", f"CAM {number}", "sans-bold", 26, name_colour)], 38, gap=8)
    if state:
        lines = {"NOT SET UP": ["NOT", "SET UP"], "UNREACHABLE": ["UNREACH-", "ABLE"]}.get(state, [state])
        if len(lines) == 1:
            art.text(state, "adelia", 20, colour, 74)
        else:
            for line, cy in zip(lines, (68, 90)):
                art.text(line, "adelia", art.fit(line, "adelia", 20, ROOM), colour, cy)
    return art.image()


def selected_keyline(faces):
    art = Art(faces, KEY, None)
    art.keyline(BEIGE, 4)
    return art.image()


def solo_key(faces, form):
    art = Art(faces, KEY, FACE)
    if form == "latched":
        art.keyline(YELLOW, 4)
        size = art.fit("SOLO", "adelia", 28, KEY[0] - 2 * 13 - 12 - 6)
        art.row([("lamp", 12, YELLOW, False), ("text", "SOLO", "adelia", size, YELLOW)], 30, gap=6)
        art.text("Clear all", "sans-bold", 22, INK, 86)
    elif form == "rest":
        art.row([("lamp", 12, INK_4, True), ("text", "SOLO", "adelia", 28, INK)], 60, gap=8)
    else:
        if form == "locked":
            art.dashed(mix(LINE_2, FACE, 0.55), 3)
        art.text("SOLO", "adelia", 28, INK_4, 60)
    return art.image()


def recall_key(faces, state=None, colour=None):
    art = Art(faces, KEY, FACE)
    word_colour = INK_4 if state in ("none", "off") else INK
    art.text("RECALL", "adelia", art.fit("RECALL", "adelia", 28, ROOM), word_colour, WORD_Y)
    if state is None:
        art.text("scene", "sans", 22, INK_3, SUB_Y)
    elif state == "none":
        art.text("no scenes", "sans", 20, INK_3, SUB_Y)
    elif state != "off":
        size = art.fit(state, "adelia", 20, ROOM - 10 - 6)
        art.row([("lamp", 10, colour, False), ("text", state, "adelia", size, colour)], SUB_Y, gap=6)
    return art.image()


def page_key(faces, word, place):
    art = Art(faces, KEY, DARK_GREEN)
    art.text(word, "sans-bold", art.fit(word, "sans-bold", 24, ROOM), INK, 38)
    art.arrow(KEY[0] / 2, 62, INK_2)
    art.pips(4, place, 90, INK, INK_2)
    return art.image()


def cue_key(faces, pointing, colour=INK):
    art = Art(faces, KEY, FACE)
    word = art.width("Cue", "sans-bold", 28)
    total = word + 10 + 12
    x = KEY[0] / 2 - total / 2
    if pointing == "left":
        art.triangle(x + 6, 60, colour, "left")
        art.text("Cue", "sans-bold", 28, colour, 60, left=x + 22)
    else:
        art.text("Cue", "sans-bold", 28, colour, 60, left=x)
        art.triangle(x + word + 10 + 6, 60, colour, "right")
    return art.image()


def dim_key(faces, form):
    fill = YELLOW if form == "on" else FACE
    ink = {"on": BLACK, "rest": INK}.get(form, INK_4)
    sub = {"on": BLACK, "rest": INK_3}.get(form, INK_4)
    return word_key(faces, "DIM", "\u221220 dB", colour=ink, sub_colour=sub, fill=fill, dashed=form == "locked")


# ---------------------------------------------------------------------------
# The strip's cells
# ---------------------------------------------------------------------------

# The cell's head (the dial's name) in PT Sans 20, where the profile draws a
# live head: its box starts at 6 % of the cell and Companion keeps 3 % of the
# box clear, so the ink starts at 17 px, its capitals' middle at 19 px.
HEAD_LEFT = 17
HEAD_Y = 19
# The AUDIO strip's bar (exports/audio.rs, `BAR`): 6 % to 94 % of the cell's
# width, 82 to 88 px down.
BAR_X0, BAR_X1 = 12, 188
BAR_Y0, BAR_Y1 = 82, 88


def cell(faces, head=None):
    art = Art(faces, CELL, WELL)
    # The 2 px rule between two cells: 1 px on each side of each.
    art.rect(0, 0, 1, CELL[1], LINE)
    art.rect(CELL[0] - 1, 0, CELL[0], CELL[1], LINE)
    if head:
        art.text(head, "sans", 20, INK_3, HEAD_Y, left=HEAD_LEFT)
    return art


def audio_strip_cell(faces):
    art = cell(faces)
    art.rect(BAR_X0, BAR_Y0, BAR_X1, BAR_Y1, LINE_2)
    return art.image()


def camera_doubt_cell(faces):
    art = cell(faces)
    # Around the value (the profile's value box, 12 to 188 px across and 36
    # to 92 px down), not the whole cell.
    art.dashed(YELLOW, 2, radius=4, box=(8, 34, 192, 96), dash=8, gap=6)
    return art.image()


# ---------------------------------------------------------------------------
# Every image, by the name its layers take it by
# ---------------------------------------------------------------------------


def images(faces):
    """(name, description, render) for every image of the library."""
    yield "key_rec", "REC, ready: CAM 1's record key under an unlit lamp", lambda: rec_key(faces, sub="CAM 1")
    yield "key_rec_recording", "REC while CAM 1 records: the Coral keyline and word (the take's length is live)", lambda: rec_key(faces, colour=CORAL, keyline=CORAL)
    yield "key_rec_armed", "REC asking: STOP?, press again", lambda: armed_key(faces, "STOP?")
    yield "key_rec_last_known", "REC while CAM 1 does not answer mid-take: doubt", lambda: rec_key(faces, dashed_keyline=YELLOW)
    yield "key_rec_locked", "REC locked: CAM 1 released or not set up", lambda: rec_locked(faces)
    yield "key_rec_off", "REC while the deck does not hear the hardware link", lambda: word_key(faces, "REC", colour=INK_4)
    yield "lamp_off", "REC's lamp, unlit", lambda: rec_lamp(faces, INK_4, hollow=True)
    yield "lamp_red", "REC's lamp while CAM 1 records (Coral)", lambda: rec_lamp(faces, CORAL)
    yield "lamp_amber", "REC's lamp while CAM 1 does not answer mid-take (Yellow)", lambda: rec_lamp(faces, YELLOW)

    yield "key_play", "PLAY (the time left is live)", lambda: word_key(faces, "PLAY", "")
    yield "key_play_playing", "PLAY while the text scrolls: the Green fill", lambda: word_key(faces, "PLAY", "", colour=BLACK, fill=GREEN)
    yield "key_play_off", "PLAY that cannot play (the reason is live), or without the hardware link", lambda: word_key(faces, "PLAY", "", colour=INK_4)

    yield "key_all_on", "ALL ON", lambda: two_word_key(faces, "ALL", "ON")
    yield "key_all_on_off", "ALL ON without the hardware link", lambda: two_word_key(faces, "ALL", "ON", colour=INK_4)
    yield "key_save", "SAVE: the rig as a new scene", lambda: word_key(faces, "SAVE", "scene")
    yield "key_save_off", "SAVE without the hardware link", lambda: word_key(faces, "SAVE", "scene", colour=INK_4, sub_colour=INK_4)
    yield "key_all_off", "ALL OFF: destructive, Coral", lambda: two_word_key(faces, "ALL", "OFF", colour=CORAL, edge=CORAL)
    yield "key_all_off_armed", "ALL OFF asking: OFF?, press again", lambda: armed_key(faces, "OFF?")
    yield "key_all_off_off", "ALL OFF without the hardware link", lambda: two_word_key(faces, "ALL", "OFF", colour=INK_4)
    yield "key_recall", "RECALL the chosen scene", lambda: recall_key(faces)
    yield "key_recall_live", "RECALL: the rig holds the chosen scene", lambda: recall_key(faces, "ON RIG", GREEN)
    yield "key_recall_unsaved", "RECALL: the rig changed since the scene was put on it", lambda: recall_key(faces, "UNSAVED", YELLOW)
    yield "key_recall_preview", "RECALL while Preview is on", lambda: recall_key(faces, "PREVIEW", BLUE)
    yield "key_recall_none", "RECALL with no scene", lambda: recall_key(faces, "none")
    yield "key_recall_off", "RECALL without the hardware link", lambda: recall_key(faces, "off")

    yield "key_main_out", "Main Out", lambda: name_key(faces, "Main Out")
    yield "key_main_out_on", "Main Out, the mix target: the Yellow fill", lambda: name_key(faces, "Main Out", colour=BLACK, fill=YELLOW)
    yield "key_main_out_locked", "Main Out while the Console is locked", lambda: name_key(faces, "Main Out", colour=INK_4, dashed=True)
    yield "key_main_out_off", "Main Out without the hardware link", lambda: name_key(faces, "Main Out", colour=INK_4)
    yield "key_phones", "Phones: to a phones mix", lambda: name_key(faces, "Phones")
    yield "key_phones_1", "Phones 1, the mix target: the Yellow fill", lambda: name_key(faces, "Phones 1", colour=BLACK, fill=YELLOW)
    yield "key_phones_2", "Phones 2, the mix target: the Yellow fill", lambda: name_key(faces, "Phones 2", colour=BLACK, fill=YELLOW)
    yield "key_phones_locked", "Phones while the Console is locked", lambda: name_key(faces, "Phones", colour=INK_4, dashed=True)
    yield "key_phones_off", "Phones without the hardware link", lambda: name_key(faces, "Phones", colour=INK_4)
    yield "key_audio_bank", "BANK (AUDIO), its bank not known", lambda: bank_key(faces, "", -1, 3)
    yield "key_audio_bank_inputs", "BANK (AUDIO) on the inputs", lambda: bank_key(faces, "INPUTS", 0, 3)
    yield "key_audio_bank_playback", "BANK (AUDIO) on playback: off the microphones, the Yellow fill", lambda: bank_key(faces, "PLAYBACK", 1, 3, fill=YELLOW, dark=True)
    yield "key_audio_bank_outputs", "BANK (AUDIO) on the outputs: off the microphones, the Yellow fill", lambda: bank_key(faces, "OUTPUTS", 2, 3, fill=YELLOW, dark=True)
    yield "key_audio_bank_locked", "BANK (AUDIO) while the Console is locked", lambda: bank_key(faces, None, -1, 3, dashed=True)
    yield "key_audio_bank_off", "BANK (AUDIO) without the hardware link", lambda: bank_key(faces, None, -1, 3)
    yield "key_dim", "DIM: Main Out 20 dB down", lambda: dim_key(faces, "rest")
    yield "key_dim_on", "DIM on: the Yellow fill", lambda: dim_key(faces, "on")
    yield "key_dim_locked", "DIM while the Console is locked", lambda: dim_key(faces, "locked")
    yield "key_dim_off", "DIM without the hardware link", lambda: dim_key(faces, "off")
    yield "key_solo", "SOLO: nothing soloed", lambda: solo_key(faces, "rest")
    yield "key_solo_latched", "SOLO latched: the Yellow keyline, lamp and word, Clear all (the count is live)", lambda: solo_key(faces, "latched")
    yield "key_solo_locked", "SOLO while the Console is locked", lambda: solo_key(faces, "locked")
    yield "key_solo_off", "SOLO without the hardware link", lambda: solo_key(faces, "off")

    yield "key_camera_bank", "BANK (CAMERAS), its bank not known", lambda: bank_key(faces, "", -1, 3)
    yield "key_camera_bank_exposure", "BANK (CAMERAS) on exposure", lambda: bank_key(faces, "EXPOSURE", 0, 3)
    yield "key_camera_bank_colour", "BANK (CAMERAS) on colour", lambda: bank_key(faces, "COLOUR", 1, 3)
    yield "key_camera_bank_focus", "BANK (CAMERAS) on focus", lambda: bank_key(faces, "FOCUS", 2, 3)
    yield "key_camera_bank_off", "BANK (CAMERAS) without the hardware link", lambda: bank_key(faces, None, -1, 3)
    for number in (1, 2, 3):
        yield f"key_cam_{number}", f"CAM {number}, its state not known (the state is live)", lambda number=number: camera_key(faces, number)
        yield f"key_cam_{number}_held", f"CAM {number} held", lambda number=number: camera_key(faces, number, "HELD", GREEN)
        yield f"key_cam_{number}_released", f"CAM {number} released", lambda number=number: camera_key(faces, number, "RELEASED", YELLOW)
        yield f"key_cam_{number}_not_set_up", f"CAM {number} not set up", lambda number=number: camera_key(faces, number, "NOT SET UP", YELLOW)
        yield f"key_cam_{number}_unreachable", f"CAM {number} unreachable", lambda number=number: camera_key(faces, number, "UNREACHABLE", CORAL)
        yield f"key_cam_{number}_off", f"CAM {number} without the hardware link", lambda number=number: camera_key(faces, number, name_colour=INK_4)
    yield "key_selected", "The selected camera's Beige keyline, over its key", lambda: selected_keyline(faces)

    yield "key_cue_back", "Cue back", lambda: cue_key(faces, "left")
    yield "key_cue_back_off", "Cue back with nothing on, or without the hardware link", lambda: cue_key(faces, "left", INK_4)
    yield "key_cue_next", "Cue on", lambda: cue_key(faces, "right")
    yield "key_cue_next_off", "Cue on with nothing on, or without the hardware link", lambda: cue_key(faces, "right", INK_4)
    yield "key_back", "BACK", lambda: word_key(faces, "BACK")
    yield "key_back_off", "BACK with nothing on, or without the hardware link", lambda: word_key(faces, "BACK", colour=INK_4)
    yield "key_top", "TOP", lambda: word_key(faces, "TOP")
    yield "key_top_off", "TOP with nothing on, or without the hardware link", lambda: word_key(faces, "TOP", colour=INK_4)

    # The page keys, in Dark Green with the screen's tab words, a pip a page
    # of the ring LIGHTS, AUDIO, CAMERAS, PROMPTER: the page the key turns to
    # is lit. "Prompter" stands for the tab "Teleprompter", which no key holds.
    for place, (page, word) in enumerate((("lights", "Lighting"), ("audio", "Audio"), ("cameras", "Cameras"), ("prompter", "Prompter"))):
        yield f"key_page_{page}", f"The page key to {page.upper()}", lambda word=word, place=place: page_key(faces, word, place)
    yield "key_dark", "A key that does nothing: the black glass", lambda: Art(faces, KEY, BLACK).image()

    yield "cell_light", "The LIGHT dial's cell (its head and value are live)", lambda: cell(faces).image()
    yield "cell_intensity", "The INTENSITY dial's cell", lambda: cell(faces, "INTENSITY").image()
    yield "cell_cct", "The CCT dial's cell", lambda: cell(faces, "CCT").image()
    yield "cell_scene", "The SCENE dial's cell (its head and value are live)", lambda: cell(faces).image()
    yield "cell_audio_strip", "An AUDIO strip's cell: the bar's track", lambda: audio_strip_cell(faces)
    yield "cell_camera_dial", "A CAMERAS dial's cell (its head and value are live)", lambda: cell(faces).image()
    yield "cell_camera_dial_doubt", "A CAMERAS dial's cell while the camera does not answer: doubt on the value", lambda: camera_doubt_cell(faces)
    yield "cell_speed", "The SPEED dial's cell", lambda: cell(faces, "SPEED").image()
    yield "cell_line", "The LINE dial's cell", lambda: cell(faces, "LINE").image()
    yield "cell_paragraph", "The PARAGRAPH dial's cell", lambda: cell(faces, "PARAGRAPH").image()
    yield "cell_size", "The SIZE dial's cell", lambda: cell(faces, "SIZE").image()
    yield "cell_empty", "A cell with nothing to show: a strip the bank does not have, a locked Console", lambda: cell(faces).image()


def png_bytes(img):
    buffer = io.BytesIO()
    img.save(buffer, "PNG", optimize=True)
    return buffer.getvalue()


def main():
    parser = argparse.ArgumentParser(description="Renders the Stream Deck+ label images and images.json.")
    parser.add_argument("--out", type=Path, default=OUT, help="the folder the images are written to")
    parser.add_argument("--adelia", help="the SSE Adelia Bold font file, when it is not installed for the user")
    arguments = parser.parse_args()
    faces = Faces(arguments.adelia)
    out = arguments.out
    out.mkdir(parents=True, exist_ok=True)
    manifest = []
    names = set()
    for name, description, render in images(faces):
        if name in names:
            sys.exit(f"deck-assets: {name} is drawn twice")
        names.add(name)
        img = render()
        expected = CELL if name.startswith("cell_") else KEY
        if img.size != expected:
            sys.exit(f"deck-assets: {name} is {img.size}, not {expected}")
        data = png_bytes(img)
        (out / f"{name}.png").write_bytes(data)
        data_url = "data:image/png;base64," + base64.b64encode(data).decode("ascii")
        manifest.append(
            {
                "name": name,
                "description": description,
                "width": img.width,
                "height": img.height,
                # Companion's own checksum of an upload: the SHA-1 of the data URL.
                "checksum": hashlib.sha1(data_url.encode("ascii")).hexdigest(),
                "dataUrl": data_url,
            }
        )
        print(f"drew {name} ({img.width} x {img.height}, {len(data)} bytes)")
    document = {"renderedAtMs": RENDERED_AT_MS, "images": manifest}
    with open(out / "images.json", "w", encoding="utf-8", newline="\n") as file:
        file.write(json.dumps(document, indent=2) + "\n")
    print(f"{len(manifest)} images and images.json are in {out}")


if __name__ == "__main__":
    main()
