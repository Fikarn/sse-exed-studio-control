# Renders the Stream Deck+ audio-surface PNG assets embedded by the Companion
# profile export (native/rust-engine/assets/deck/). Standalone authoring tool,
# not part of any npm lane: `python scripts/deck-assets.py` with Pillow
# installed regenerates every .png and its .b64 sibling (the engine embeds the
# .b64 files via include_str!).
#
# Design: 144x144 canvas (2x the Companion 72px button canvas, scaled by
# Companion per surface). Bars sit in the bottom band with the unity notch at
# RME's 0 dB fader position (step 836 of 1023 = the app's AUDIO_FADER_UNITY,
# see native/rust-engine/src/audio/fader_curve.rs; 2026-09 audit Slice 5);
# icons are transparent-background glyphs so feedback bgcolor changes show
# through beneath them.

import base64
from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 144
OUT = Path(__file__).resolve().parent.parent / "native" / "rust-engine" / "assets" / "deck"

STRIP_BG = (22, 19, 12, 255)  # #16130C
TRACK = (35, 32, 26, 255)
NOTCH = (247, 231, 189, 140)
GLYPH = (169, 156, 120, 230)  # #A99C78

BAR_X0, BAR_X1 = 8, 136
BAR_Y0, BAR_Y1 = 118, 138
UNITY_X = BAR_X0 + round((BAR_X1 - BAR_X0) * 836 / 1023)

FILL_NORMAL = ((138, 106, 31), (232, 177, 61))  # amber ramp
FILL_MUTED = ((90, 36, 28), (194, 87, 66))  # ember ramp


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def save(img, name):
    OUT.mkdir(parents=True, exist_ok=True)
    png_path = OUT / f"{name}.png"
    img.save(png_path, "PNG", optimize=True)
    encoded = base64.b64encode(png_path.read_bytes()).decode("ascii")
    (OUT / f"{name}.b64").write_text(encoded + "\n", encoding="ascii", newline="\n")


def bar_image(bucket, ramp, with_notch=True, with_track=True):
    img = Image.new("RGBA", (SIZE, SIZE), STRIP_BG)
    draw = ImageDraw.Draw(img)
    if with_track:
        draw.rectangle([BAR_X0, BAR_Y0, BAR_X1, BAR_Y1], fill=TRACK)
    if bucket > 0:
        fill_w = round((BAR_X1 - BAR_X0) * bucket / 12)
        lo, hi = ramp
        for x in range(fill_w):
            t = x / max(1, (BAR_X1 - BAR_X0) - 1)
            draw.line(
                [(BAR_X0 + x, BAR_Y0 + 2), (BAR_X0 + x, BAR_Y1 - 2)],
                fill=lerp(lo, hi, t) + (255,),
            )
    if with_notch:
        draw.rectangle([UNITY_X - 1, BAR_Y0 - 4, UNITY_X + 1, BAR_Y1 + 4], fill=NOTCH)
    return img


def glyph_canvas():
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
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
    for i, y in enumerate((20, 38, 56)):
        draw.rounded_rectangle([46, y, 98, y + 12], radius=5, fill=GLYPH)
    return img


def ico_dim():
    img, draw = glyph_canvas()
    draw.ellipse([48, 18, 96, 66], outline=GLYPH, width=6)
    draw.pieslice([48, 18, 96, 66], 90, 270, fill=GLYPH)
    return img


def ico_talk():
    img, draw = glyph_canvas()
    draw.rounded_rectangle([62, 14, 82, 46], radius=10, fill=GLYPH)
    draw.arc([52, 26, 92, 58], 0, 180, fill=GLYPH, width=6)
    draw.line([(72, 58), (72, 68)], fill=GLYPH, width=6)
    return img


def ico_solo():
    img, draw = glyph_canvas()
    draw.ellipse([48, 18, 96, 66], outline=GLYPH, width=7)
    draw.line([(62, 42), (82, 42)], fill=GLYPH, width=7)
    return img


def ico_gain():
    img, draw = glyph_canvas()
    draw.ellipse([48, 18, 96, 66], outline=GLYPH, width=7)
    draw.line([(72, 42), (88, 26)], fill=GLYPH, width=7)
    return img


def main():
    for bucket in range(13):
        save(bar_image(bucket, FILL_NORMAL), f"bar_f{bucket}")
        save(bar_image(bucket, FILL_MUTED), f"bar_m{bucket}")
    save(bar_image(0, FILL_NORMAL, with_notch=False), "strip_off")
    save(
        bar_image(0, FILL_NORMAL, with_notch=False, with_track=False),
        "strip_empty",
    )
    for name, fn in (
        ("ico_main", ico_main),
        ("ico_phones", ico_phones),
        ("ico_bank", ico_bank),
        ("ico_dim", ico_dim),
        ("ico_talk", ico_talk),
        ("ico_solo", ico_solo),
        ("ico_gain", ico_gain),
    ):
        save(fn(), name)
    print(f"wrote assets to {OUT}")


if __name__ == "__main__":
    main()
