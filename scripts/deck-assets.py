# Renders the Stream Deck+ images the Companion profile carries in its image
# library (native/rust-engine/assets/deck/): a PNG of each, to look at, and
# images.json, which the engine embeds (include_str!) and writes into the
# profile's `imageLibrary`. Standalone authoring tool, not part of any npm
# lane: `python scripts/deck-assets.py` with Pillow installed renders every
# image; `--out <folder>` writes them elsewhere. Another Pillow packs the
# same picture into other bytes, so a render is committed whole.
#
# Design (2026-10-03, the Companion 5 profile): every key and every strip
# cell of the deck has an image of its own name, drawn at the deck's own
# size, 120 x 120 for a key and 200 x 100 for a strip cell (Companion 5 draws
# them at those sizes; the 144 px squares of before were letterboxed in a
# cell). This render keeps the look of before: the AUDIO keys' glyphs in
# khaki over the key's colour, the lamps of REC, the AUDIO strip's floor and
# track; the other images are clear, and the words are drawn by Companion
# over them. The brand's label images (PT Sans, SSE Adelia) replace these by
# name later; the profile then needs no other change but its colours.
#
# The AUDIO strip's bar is a Companion gauge drawn over the floor, its unity
# mark a box over the gauge, at RME's 0 dB fader position (step 836 of 1023 =
# the app's AUDIO_FADER_UNITY, see native/rust-engine/src/audio/fader_curve.rs).

import argparse
import base64
import hashlib
import io
import json
from pathlib import Path

from PIL import Image, ImageDraw

KEY = (120, 120)
CELL = (200, 100)
OUT = Path(__file__).resolve().parent.parent / "native" / "rust-engine" / "assets" / "deck"
# When this render was made: the library's createdAt and modifiedAt, fixed so
# that an export is the same file every time.
RENDERED_AT_MS = 1_759_449_600_000  # 2026-10-03T00:00:00Z

# Today's palette (the deck's Console vocabulary).
STRIP_BG = (22, 19, 12, 255)  # #16130C
TRACK = (35, 32, 26, 255)
GLYPH = (169, 156, 120, 230)  # #A99C78
LAMP_RED = (255, 97, 97)  # the screen's red: a hazard that is on
LAMP_AMBER = (232, 177, 61)  # the deck's amber: doubt
LAMP_OFF = (58, 55, 47)  # an unlit lamp

# The track of the AUDIO strip's bar, in the cell: the gauge is drawn over it
# at the same place (exports/audio.rs, `BAR_*`).
BAR_X0, BAR_X1 = 12, 188
BAR_Y0, BAR_Y1 = 84, 94


def png_bytes(img):
    buffer = io.BytesIO()
    img.save(buffer, "PNG", optimize=True)
    return buffer.getvalue()


def clear(size):
    return Image.new("RGBA", size, (0, 0, 0, 0))


# --- The AUDIO keys' glyphs, drawn as before on a 144 px square and set at
# the top of a 120 px key, over the key's colour and above its words. ---


def glyph_canvas():
    img = Image.new("RGBA", (144, 144), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)


def ico_main():
    img, draw = glyph_canvas()
    # speaker body + horn
    draw.polygon([(46, 28), (60, 28), (60, 56), (46, 56)], outline=GLYPH, width=6)
    draw.polygon([(60, 28), (76, 16), (76, 68), (60, 56)], outline=GLYPH, width=6)
    draw.arc([80, 26, 104, 58], -55, 55, fill=GLYPH, width=6)
    return img


def ico_phones():
    img, draw = glyph_canvas()
    draw.arc([44, 16, 100, 72], 180, 360, fill=GLYPH, width=7)
    draw.rounded_rectangle([40, 42, 54, 68], radius=6, fill=GLYPH)
    draw.rounded_rectangle([90, 42, 104, 68], radius=6, fill=GLYPH)
    return img


def ico_bank():
    img, draw = glyph_canvas()
    for y in (20, 38, 56):
        draw.rounded_rectangle([46, y, 98, y + 12], radius=5, fill=GLYPH)
    return img


def ico_dim():
    img, draw = glyph_canvas()
    draw.ellipse([48, 18, 96, 66], outline=GLYPH, width=6)
    draw.pieslice([48, 18, 96, 66], 90, 270, fill=GLYPH)
    return img


def ico_solo():
    img, draw = glyph_canvas()
    draw.ellipse([48, 18, 96, 66], outline=GLYPH, width=7)
    draw.line([(62, 42), (82, 42)], fill=GLYPH, width=7)
    return img


def key_with_glyph(glyph):
    """The glyph's top half of the 144 px square, at the top of a key."""
    top = glyph.crop((32, 8, 112, 80)).resize((50, 45), Image.LANCZOS)
    img = clear(KEY)
    img.alpha_composite(top, (35, 4))
    return img


def lamp(colour, lit=True):
    # A lamp over the key's word: a bloom, and the lamp itself, as before;
    # unlit, the lamp alone in a dark grey. REC is a red lamp and the word on
    # a dark key, never a red fill (docs/DESIGN.md).
    img, draw = glyph_canvas()
    cx, cy = 72, 30
    if lit:
        for radius, alpha in ((22, 40), (18, 70), (15, 110)):
            draw.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=colour + (alpha,))
    draw.ellipse([cx - 11, cy - 11, cx + 11, cy + 11], fill=colour + (255,))
    return img.resize(KEY, Image.LANCZOS)


def audio_strip_floor():
    img = Image.new("RGBA", CELL, STRIP_BG)
    ImageDraw.Draw(img).rectangle([BAR_X0, BAR_Y0, BAR_X1, BAR_Y1], fill=TRACK)
    return img


# Every image of the profile, by the name its keys and cells take it by, and
# what it is for (Companion shows the description in its library).
KEYS = [
    ("key_rec", "REC", None),
    ("key_play", "PLAY", None),
    ("key_all_on", "ALL ON", None),
    ("key_save", "SAVE", None),
    ("key_all_off", "ALL OFF", None),
    ("key_recall", "RECALL", None),
    ("key_main_out", "MAIN OUT", ico_main),
    ("key_phones", "PHONES", ico_phones),
    ("key_audio_bank", "BANK (AUDIO)", ico_bank),
    ("key_dim", "DIM", ico_dim),
    ("key_solo", "SOLO", ico_solo),
    ("key_camera_bank", "BANK (CAMERAS)", ico_bank),
    ("key_cam_1", "CAM 1", None),
    ("key_cam_2", "CAM 2", None),
    ("key_cam_3", "CAM 3", None),
    ("key_cue_back", "CUE back", None),
    ("key_cue_next", "CUE on", None),
    ("key_back", "BACK", None),
    ("key_top", "TOP", None),
    ("key_page_lights", "The page key to LIGHTS", None),
    ("key_page_audio", "The page key to AUDIO", None),
    ("key_page_cameras", "The page key to CAMERAS", None),
    ("key_page_prompter", "The page key to PROMPTER", None),
    ("key_dark", "A key that does nothing", None),
]
CELLS = [
    ("cell_light", "The LIGHT dial's cell"),
    ("cell_intensity", "The INTENSITY dial's cell"),
    ("cell_cct", "The CCT dial's cell"),
    ("cell_scene", "The SCENE dial's cell"),
    ("cell_audio_strip", "An AUDIO strip's cell: the floor and the bar's track"),
    ("cell_camera_dial", "A CAMERAS dial's cell"),
    ("cell_speed", "The SPEED dial's cell"),
    ("cell_line", "The LINE dial's cell"),
    ("cell_paragraph", "The PARAGRAPH dial's cell"),
    ("cell_size", "The SIZE dial's cell"),
]


def images():
    for name, description, glyph in KEYS:
        yield name, description, (lambda glyph=glyph: key_with_glyph(glyph()) if glyph else clear(KEY))
    for name, description in CELLS:
        if name == "cell_audio_strip":
            yield name, description, audio_strip_floor
        else:
            yield name, description, (lambda: clear(CELL))
    yield "lamp_off", "REC's lamp, unlit", lambda: lamp(LAMP_OFF, lit=False)
    yield "lamp_red", "REC's lamp while CAM 1 records", lambda: lamp(LAMP_RED)
    yield "lamp_amber", "REC's lamp while CAM 1 does not answer mid-take", lambda: lamp(LAMP_AMBER)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=OUT, help="the folder the images are written to")
    out = parser.parse_args().out
    out.mkdir(parents=True, exist_ok=True)
    manifest = []
    for name, description, render in images():
        img = render()
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
    (out / "images.json").write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"{len(manifest)} images and images.json are in {out}")


if __name__ == "__main__":
    main()
