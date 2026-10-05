import { describe, expect, it, vi } from "vitest";

import { LIGHTING_COLOR_TAG_PALETTE, lightingColorTagHex } from "./lightingColorTags";
import { buildFixtureMenu, buildGroupMenu, buildPaletteMenu, type LightingMenu } from "./lightingMenus";

// The visual overhaul's polish (2026-10-05). The colour tags are the design
// tokens `--tag-0` … `--tag-7` under quiet names, each in its stored slot; a
// colour-temperature palette shows no tag, so its menu offers no Colour…; a
// fixture's and a group's power is a toggle that says its value, as their
// plate keys do.

const noop = () => {};
const ids = (menu: LightingMenu) => menu.items.map((item) => item.id);

describe("the Lighting colour tags", () => {
  it("are the eight tag tokens, each slot under its name", () => {
    expect(LIGHTING_COLOR_TAG_PALETTE.map((swatch) => swatch.name)).toEqual([
      "Clay",
      "Ochre",
      "Sand",
      "Olive",
      "Slate",
      "Mist",
      "Plum",
      "Heather",
    ]);
    LIGHTING_COLOR_TAG_PALETTE.forEach((swatch, index) => {
      expect(swatch.index).toBe(index);
      expect(swatch.hex).toBe(`var(--tag-${index})`);
    });
    expect(lightingColorTagHex(null)).toBeNull();
    expect(lightingColorTagHex(8)).toBeNull();
  });
});

describe("the Lighting menus", () => {
  const palette = {
    detail: "50 %",
    first: false,
    last: false,
    onEdit: noop,
    onMoveEarlier: noop,
    onMoveLater: noop,
    onColour: noop,
    onDelete: noop,
    testIdPrefix: "palette",
  };

  it("a colour-temperature palette offers no Colour…; an intensity palette names its tag", () => {
    const cct = buildPaletteMenu({ ...palette, palette: { id: "warm", name: "Warm", kind: "cct", colorIndex: 0 } });
    expect(ids(cct)).toEqual(["edit", "earlier", "later"]);
    const intensity = buildPaletteMenu({
      ...palette,
      palette: { id: "half", name: "Half", kind: "intensity", colorIndex: 2 },
    });
    expect(intensity.items.find((item) => item.id === "colour")).toMatchObject({ label: "Colour…", value: "sand" });
  });

  it("a fixture's and a group's power say their value, and a press toggles it", () => {
    const onFixturePower = vi.fn();
    const fixture = buildFixtureMenu({
      fixture: { id: "key", name: "Key", on: true },
      detail: "76 % · 3200 K",
      groups: [],
      onTogglePower: onFixturePower,
      onIdentify: noop,
      onAssignGroup: noop,
      onCreateGroup: noop,
      onEditPlacement: noop,
      onResetRotation: noop,
      onRename: noop,
      onDelete: noop,
      testIdPrefix: "fixture",
    });
    const fixturePower = fixture.items[0];
    expect(fixturePower).toMatchObject({ kind: "check", id: "power", label: "Light", checked: true });
    if (fixturePower?.kind === "check") fixturePower.onCheckedChange(false);
    expect(onFixturePower).toHaveBeenCalledTimes(1);

    const group = buildGroupMenu({
      group: { id: "front", name: "Front", on: false },
      detail: "2 fixtures · off",
      onTogglePower: noop,
      onInspect: noop,
      onRename: noop,
      onColour: noop,
      onDelete: noop,
      testIdPrefix: "group",
    });
    expect(group.items[0]).toMatchObject({ kind: "check", id: "power", label: "Group", checked: false });
  });
});
