import latinExtItalic from "@fontsource-variable/inter/files/inter-latin-ext-wght-italic.woff2?url";
import latinItalic from "@fontsource-variable/inter/files/inter-latin-wght-italic.woff2?url";

// Inter's own italic for the glass (new pages program, Slice 5a): a cue and the
// script's own italics are drawn in it, never in a slanted upright. The app
// loads only Inter's upright faces, and one screen draws an italic line in that
// slanted upright; loading Inter's italic for the whole app would redraw it. So
// the italic is a family of its own, `Prompter Glass Italic`, that only the
// glass names — the Latin and Latin Extended sets, which hold å, ä and ö.

export const GLASS_ITALIC_FAMILY = "Prompter Glass Italic";

const FACES: ReadonlyArray<{ url: string; unicodeRange: string }> = [
  {
    url: latinItalic,
    unicodeRange:
      "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
  },
  {
    url: latinExtItalic,
    unicodeRange:
      "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF",
  },
];

let registered = false;

/** Adds the glass's italic to the document's fonts, once; a no-op where there are none (the unit tests). */
export function registerGlassItalic(): void {
  if (registered || typeof document === "undefined" || !document.fonts || typeof FontFace === "undefined") return;
  registered = true;
  for (const face of FACES) {
    document.fonts.add(
      new FontFace(GLASS_ITALIC_FAMILY, `url(${face.url}) format("woff2")`, {
        style: "italic",
        weight: "100 900",
        unicodeRange: face.unicodeRange,
        display: "block",
      })
    );
  }
}
