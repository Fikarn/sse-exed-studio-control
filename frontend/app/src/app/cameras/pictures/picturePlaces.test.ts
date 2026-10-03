import { describe, expect, it } from "vitest";

import { MAX_HOLES, MAX_PICTURES, buildPlaces, type MeasuredPicture, type MeasuredPlaces } from "./picturePlaces";

// What the page reports to the shell for the native picture layer (D30): the builder,
// from a layout as measured. The shell's side of the same numbers is
// `native/protocol/rust/src/picture_layer.rs`, whose tests use this layout.

const WHOLE = { x: 0, y: 0, width: 1920, height: 1080 };
/** Where the loupe looks at 2:1, in the whole view. */
const LOUPE = { x: 818, y: 472, width: 284, height: 136 };
const NO_AIDS = { guides: false, zebras: false, peaking: false, marker: null };

// The big picture with every aid and the loupe's marker, the loupe with zebras and
// peaking, a small picture with none.
const hero: MeasuredPicture = {
  camera: 1,
  box: { x: 444, y: 138, width: 1680, height: 945 },
  part: WHOLE,
  smooth: true,
  guides: true,
  zebras: true,
  peaking: true,
  marker: LOUPE,
};
const tile: MeasuredPicture = {
  camera: 2,
  box: { x: 444, y: 1095, width: 544, height: 306 },
  part: WHOLE,
  smooth: true,
  ...NO_AIDS,
};
const loupe: MeasuredPicture = {
  camera: 1,
  box: { x: 1556, y: 1129, width: 568, height: 272 },
  part: LOUPE,
  smooth: false,
  ...NO_AIDS,
  zebras: true,
  peaking: true,
};
const chip = { x: 454, y: 1105, width: 120, height: 28 };

function layout(over: Partial<MeasuredPlaces> = {}): MeasuredPlaces {
  return {
    scale: 1,
    visible: true,
    covered: false,
    bay: { x: 428, y: 76, width: 1712, height: 1344 },
    pictures: [hero, tile, loupe],
    floating: [chip],
    ...over,
  };
}

describe("the page's report of its pictures", () => {
  it("says each picture's box, part, smoothing, aids and marker, and the chip as a hole", () => {
    expect(buildPlaces(layout())).toEqual({
      showing: true,
      scale: 1,
      bay: { x: 428, y: 76, width: 1712, height: 1344 },
      pictures: [
        {
          camera: 1,
          at: hero.box,
          part: WHOLE,
          smooth: true,
          guides: true,
          zebras: true,
          peaking: true,
          marker: LOUPE,
        },
        { camera: 2, at: tile.box, part: WHOLE, smooth: true, ...NO_AIDS },
        { camera: 1, at: loupe.box, part: LOUPE, smooth: false, ...NO_AIDS, zebras: true, peaking: true },
      ],
      holes: [chip],
    });
  });

  it("shows no picture under a dialog, in a hidden window, or with no picture on the page", () => {
    const cases: Array<[string, Partial<MeasuredPlaces>]> = [
      ["a dialog", { covered: true }],
      ["a hidden window", { visible: false }],
      ["no picture", { pictures: [] }],
    ];
    for (const [why, over] of cases) {
      const places = buildPlaces(layout(over));
      expect(places.showing, why).toBe(false);
      expect(places.pictures, why).toEqual([]);
      expect(places.holes, why).toEqual([]);
      // The bay and the scale are still said: the report keeps its shape.
      expect(places.bay, why).toEqual({ x: 428, y: 76, width: 1712, height: 1344 });
    }
  });

  it("leaves a hole only where something stands over a picture", () => {
    const toastOverHero = { x: 1700, y: 900, width: 400, height: 64 };
    const toastBesideTheBay = { x: 2160, y: 100, width: 380, height: 64 };
    const touching = { x: 2124, y: 138, width: 10, height: 10 };
    const empty = { x: 500, y: 200, width: 0, height: 40 };
    const places = buildPlaces(layout({ floating: [chip, toastBesideTheBay, toastOverHero, touching, empty] }));
    expect(places.holes).toEqual([chip, toastOverHero]);
  });

  it("holds no more than the scene does, and no picture without a size", () => {
    const many = Array.from({ length: 6 }, () => hero);
    expect(buildPlaces(layout({ pictures: many })).pictures).toHaveLength(MAX_PICTURES);
    const holes = Array.from({ length: MAX_HOLES }, (_, index) => ({ x: 500 + index, y: 200, width: 10, height: 10 }));
    expect(buildPlaces(layout({ floating: holes })).holes).toHaveLength(MAX_HOLES);
    // One more than the helper can leave clear hides the pictures: a picture is
    // never drawn over a floating layer.
    const tooMany = [...holes, { x: 520, y: 200, width: 10, height: 10 }];
    expect(buildPlaces(layout({ floating: tooMany }))).toMatchObject({ showing: false, pictures: [], holes: [] });
    const unsized = { ...tile, box: { ...tile.box, width: 0 } };
    expect(buildPlaces(layout({ pictures: [unsized] })).showing).toBe(false);
  });

  it("says a part in whole pixels, as the shell reads it", () => {
    const places = buildPlaces(
      layout({ pictures: [{ ...loupe, part: { x: 818.4, y: 471.6, width: 284, height: 136 } }] })
    );
    expect(places.pictures[0]?.part).toEqual({ x: 818, y: 472, width: 284, height: 136 });
    const marked = buildPlaces(
      layout({ pictures: [{ ...hero, marker: { x: 817.6, y: 472.4, width: 283.5, height: 136.2 } }] })
    );
    expect(marked.pictures[0]?.marker).toEqual({ x: 818, y: 472, width: 284, height: 136 });
  });

  it("has the shell's bounds", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, resolve } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(here, "../../../../../../native/protocol/rust/src/picture_layer.rs"), "utf8");
    expect(source).toContain(`pub const MAX_PICTURES: usize = ${MAX_PICTURES};`);
    expect(source).toContain(`pub const MAX_HOLES: usize = ${MAX_HOLES};`);
    // The aids and the marker are read as the page says them.
    for (const field of ["pub guides: bool,", "pub zebras: bool,", "pub peaking: bool,", "pub marker: Option<Part>,"]) {
      expect(source).toContain(field);
    }
  });
});
