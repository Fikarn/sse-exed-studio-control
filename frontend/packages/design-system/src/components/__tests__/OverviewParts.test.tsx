import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { Door } from "../Door";
import { GroupedList, GroupedListRow } from "../GroupedList";
import { Key } from "../Key";
import { Latch, LatchSlot } from "../LampWord";
import { Room } from "../Room";
import { SpeedTape } from "../SpeedTape";
import { StateDisplay } from "../StateDisplay";
import { StatusCard } from "../StatusCard";
import { Tray } from "../Tray";

// The Overview's parts (D47; docs/design/overview-3.md): the room, its door,
// the tray, the one list, the status card and the speed tape. Each reads the
// tokens only, and the existing primitives inside them keep their own
// stylesheets.

const here = path.dirname(fileURLToPath(import.meta.url));
const fileOf = (name: string) => readFileSync(path.join(here, "..", name), "utf8");

/** The stylesheet's rules without its comments, for what a file must not draw. */
const rulesOf = (name: string) => fileOf(name).replace(/\/\*[\s\S]*?\*\//g, "");

const STYLESHEETS = [
  "Room.module.css",
  "Door.module.css",
  "Tray.module.css",
  "GroupedList.module.css",
  "StatusCard.module.css",
  "SpeedTape.module.css",
];

describe("Room", () => {
  it("is a region named by its name, with the job, the facts, the door and the body", () => {
    render(
      <Room
        tone="green"
        name="The picture"
        job="watch"
        facts={<b>CAM 1</b>}
        actions={<Door page="Cameras" />}
        testId="overview-room-picture"
      >
        <p>pictures</p>
      </Room>
    );
    const room = screen.getByRole("region", { name: "The picture" });
    expect(room).toBe(screen.getByTestId("overview-room-picture"));
    expect(room).toHaveAttribute("data-room", "green");
    expect(room).not.toHaveAttribute("data-alert");
    expect(room.querySelector("[data-room-lintel]")).toHaveTextContent(/The picture\s*watch\s*CAM 1/);
    expect(room.querySelector("[data-room-lintel]")).toContainElement(
      screen.getByRole("button", { name: "Open Cameras" })
    );
    expect(room.querySelector("[data-room-body]")).toHaveTextContent("pictures");
    expect(room.querySelector("[data-room-floor]")).toBeNull();
  });

  it("marks its alert and draws its floor only when asked", () => {
    const { rerender } = render(
      <Room tone="umber" name="The sound" job="listen" alert="attention" floor={48} testId="r" />
    );
    const room = screen.getByTestId("r");
    expect(room).toHaveAttribute("data-alert", "attention");
    expect(room.querySelector("[data-room-floor]")).toHaveStyle({ height: "48px" });
    rerender(<Room tone="umber" name="The sound" job="listen" alert={null} floor={0} testId="r" />);
    expect(room).not.toHaveAttribute("data-alert");
    expect(room.querySelector("[data-room-floor]")).toBeNull();
    const css = fileOf("Room.module.css");
    expect(css).toMatch(
      /\.room\[data-alert="error"\] \{\s*outline: 2px solid var\(--role-coral-text\);\s*outline-offset: 0/
    );
    expect(css).toMatch(
      /\.room\[data-alert="attention"\] \{\s*outline: 2px solid var\(--role-yellow-line\);\s*outline-offset: 0/
    );
  });

  it("is a raised panel at 12 in its tone; each tone sets the room's variables from its own tokens", () => {
    const css = fileOf("Room.module.css");
    expect(css).toMatch(
      /\.room \{[^}]*border-radius: var\(--radius-panel\);\s*background: var\(--room-wall\);\s*box-shadow: var\(--elevation-edge-light\)/
    );
    for (const tone of ["stone", "green", "slate", "umber"]) {
      for (const part of ["wall", "lintel", "floor", "tray", "key", "line", "line2"]) {
        expect(css).toContain(`--room-${part}: var(--room-${tone}-${part});`);
      }
    }
  });

  it("re-declares the primitives' bases from its tone, so a key, a list and a hairline take the room's", () => {
    const css = fileOf("Room.module.css");
    expect(css).toMatch(
      /\.room \{[^}]*--material-key: var\(--room-key\);\s*--material-line: var\(--room-line\);\s*--material-line2: var\(--room-line2\);/
    );
    // The radius stays the system's: only the keys are rounded at 8.
    expect(rulesOf("Room.module.css")).not.toMatch(/--radius-base:/);
  });

  it("rounds its keys at 8 and gives a key at rest the light edge; a lit or locked key has none", () => {
    const css = fileOf("Room.module.css");
    expect(css).toMatch(
      /\.room \[data-material="key"\]:not\(\[data-key-mode="segmented"\]\) \{\s*border-radius: var\(--radius-control\)/
    );
    expect(css).toMatch(
      /\.room \[data-material="key"\]:not\(\[data-lit\], \[data-locked\]\) \{\s*box-shadow: var\(--elevation-edge-light\)/
    );
    // The hooks those rules read are the key's own.
    render(
      <Room tone="stone" name="The take" job="act">
        <Key>Back</Key>
        <Key live>Play</Key>
      </Room>
    );
    expect(screen.getByRole("button", { name: "Back" })).toHaveAttribute("data-material", "key");
    expect(screen.getByRole("button", { name: "Back" })).not.toHaveAttribute("data-lit");
    expect(screen.getByRole("button", { name: "Play" })).toHaveAttribute("data-lit");
  });

  it("names itself in Adelia tracked as a room, its job in PT Serif italic in the quiet ink on the lintel", () => {
    const css = fileOf("Room.module.css");
    expect(css).toMatch(
      /\.name \{[^}]*var\(--font-size-word\)[^}]*var\(--font-family-display\);\s*letter-spacing: var\(--font-tracking-room\);\s*text-transform: uppercase/
    );
    expect(css).toMatch(/\.job \{[^}]*italic[^}]*var\(--font-family-serif\);\s*color: var\(--text-text3\)/);
    expect(css).toMatch(
      /\.lintel \{[^}]*height: 44px;[^}]*border-bottom: 1px solid var\(--room-line\);\s*background: var\(--room-lintel\)/
    );
    expect(css).toMatch(/\.floor \{[^}]*border-top: 1px solid var\(--room-line\);\s*background: var\(--room-floor\)/);
  });
});

describe("Door", () => {
  it("opens its page: the name, Adelia's arrow, and the words of where it goes", () => {
    const onClick = vi.fn();
    render(<Door page="Teleprompter" onClick={onClick} testId="overview-door-teleprompter" />);
    const door = screen.getByRole("button", { name: "Open Teleprompter" });
    expect(door).toBe(screen.getByTestId("overview-door-teleprompter"));
    expect(door).toHaveAttribute("data-door");
    expect(door).toHaveAttribute("title", "Open the Teleprompter page");
    expect(door).toHaveTextContent("Teleprompter→");
    fireEvent.click(door);
    expect(onClick).toHaveBeenCalledTimes(1);
    const css = fileOf("Door.module.css");
    expect(css).toMatch(
      /\.door \{[^}]*height: 30px;[^}]*border: 1px solid var\(--material-line2\);\s*border-radius: var\(--radius-control\);\s*background: var\(--material-key\);\s*box-shadow: var\(--elevation-edge-light\);\s*color: var\(--text-text2\)/
    );
    expect(css).toMatch(/\.door:hover:not\(:disabled\) \{\s*color: var\(--text-text\);\s*\}/);
  });
});

describe("Tray", () => {
  it("is a recess at 12 in the room's tray tone with the soft inner edge, 4 px round its keys", () => {
    render(
      <Tray testId="tray">
        <Key>− 5</Key>
        <Key>+ 5</Key>
      </Tray>
    );
    expect(screen.getByTestId("tray")).toHaveAttribute("data-tray");
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(fileOf("Tray.module.css")).toMatch(
      /\.tray \{[^}]*gap: 4px;[^}]*padding: 4px;\s*border-radius: var\(--radius-panel\);\s*background: var\(--room-tray, var\(--material-floor\)\);\s*box-shadow: var\(--elevation-recess\)/
    );
  });
});

describe("GroupedList", () => {
  it("prints a label, its value and the value's note on each row; a tall list marks itself", () => {
    const { rerender } = render(
      <GroupedList testId="list">
        <GroupedListRow label="Take length" value="04:12" note="counted here" testId="row-length" />
        <GroupedListRow label="Battery" value="100 %" />
      </GroupedList>
    );
    const list = screen.getByTestId("list");
    expect(list).toHaveAttribute("data-grouped-list");
    expect(list).not.toHaveAttribute("data-tall");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    const row = screen.getByTestId("row-length");
    expect(row).toHaveAttribute("data-grouped-row");
    expect(row).toHaveTextContent("Take length04:12counted here");
    expect(row).not.toHaveAttribute("data-doubt");
    rerender(
      <GroupedList tall testId="list">
        <GroupedListRow>
          <b>Console</b>
        </GroupedListRow>
      </GroupedList>
    );
    expect(list).toHaveAttribute("data-tall");
    expect(screen.getByRole("listitem")).toHaveTextContent("Console");
  });

  it("marks a doubted value, which takes the yellow and the dashed keyline 2 px off it", () => {
    render(
      <GroupedList>
        <GroupedListRow label="Card time left" value="46 min" note="last read" doubt testId="row" />
      </GroupedList>
    );
    const row = screen.getByTestId("row");
    expect(row).toHaveAttribute("data-doubt");
    expect(screen.getByText("46 min")).toHaveAttribute("data-row-value");
    expect(fileOf("GroupedList.module.css")).toMatch(
      /\.row\[data-doubt\] \[data-row-value\] \{\s*color: var\(--role-yellow-text\);\s*outline: 1px dashed var\(--role-yellow-line\);\s*outline-offset: 2px/
    );
  });

  it("is one face at 12 in the key's tone; rows 34 (42 tall) on hairlines that start 14 px in; never the quiet ink", () => {
    const css = fileOf("GroupedList.module.css");
    expect(css).toMatch(/\.list \{[^}]*border-radius: var\(--radius-panel\);\s*background: var\(--material-key\)/);
    expect(css).toMatch(
      /\.list::after \{[^}]*border: 1px solid var\(--material-line\);[^}]*box-shadow: var\(--elevation-edge-light\)/
    );
    expect(css).toMatch(/\.row \{[^}]*height: 34px;[^}]*padding: 0 14px/);
    expect(css).toMatch(/\.tall \.row \{\s*height: 42px/);
    expect(css).toMatch(
      /\.row \+ \.row::before \{[^}]*left: 14px;\s*right: 0;[^}]*height: 1px;\s*background: var\(--material-line\)/
    );
    expect(css).toMatch(/\.label \{[^}]*color: var\(--text-text2\)/);
    expect(rulesOf("GroupedList.module.css")).not.toMatch(/--text-text3/);
  });
});

describe("StatusCard", () => {
  it("holds the state display, unchanged, then the latch slot in its lower row", () => {
    render(
      <StatusCard testId="overview-status-card">
        <StateDisplay tone="ok" word="READY" sentence="Every link answers." testId="overview-state-display" />
        <LatchSlot testId="overview-latch-slot" />
      </StatusCard>
    );
    const card = screen.getByTestId("overview-status-card");
    expect(card).toHaveAttribute("data-status-card");
    expect(card).not.toHaveAttribute("data-tone");
    expect(card).not.toHaveAttribute("data-latched");
    const display = screen.getByTestId("overview-state-display");
    expect(display).toHaveAttribute("data-region", "state-display");
    expect(card.firstElementChild).toBe(display);
    const row = card.querySelector("[data-status-latch-row]");
    expect(row).toContainElement(screen.getByTestId("overview-latch-slot"));
    expect(card.lastElementChild).toBe(row);
  });

  it("an error draws the coral keyline round the card; a latch tints the row", () => {
    render(
      <StatusCard error latched testId="card">
        <StateDisplay tone="error" word="OFFLINE" />
        <LatchSlot>
          <Latch who="Clip" action={<Key size="small">Clear</Key>}>
            on Host
          </Latch>
        </LatchSlot>
      </StatusCard>
    );
    const card = screen.getByTestId("card");
    expect(card).toHaveAttribute("data-tone", "error");
    expect(card).toHaveAttribute("data-latched");
    expect(card.querySelector("[data-status-latch-row] [data-latch]")).toHaveTextContent("Clip");
    const css = fileOf("StatusCard.module.css");
    expect(css).toMatch(
      /\.card \{[^}]*border-radius: var\(--radius-panel\);\s*background: var\(--material-well\);\s*outline: 1px solid var\(--material-line\);\s*outline-offset: -1px/
    );
    expect(css).toMatch(
      /\.card\[data-tone="error"\] \{\s*outline: 2px solid var\(--role-coral-text\);\s*outline-offset: -2px/
    );
    expect(css).toMatch(
      /\.card \[data-region="state-display"\] \{\s*border-color: transparent;\s*border-radius: 0;\s*background: transparent/
    );
    expect(css).toMatch(/\.latchRow \{[^}]*height: 72px;[^}]*border-top: 1px solid var\(--material-line\)/);
    expect(css).toMatch(
      /\.card\[data-latched\] \.latchRow \{\s*border-top-color: var\(--material-latch-edge\);\s*background: var\(--material-latch-tint\)/
    );
    // The display's own box stays: the card takes only its edge's colour, so
    // the width of the error border (and the padding beside it) is kept.
    expect(rulesOf("StatusCard.module.css")).not.toMatch(
      /\[data-region="state-display"\][^{]*\{[^}]*(padding|border-width|height)/
    );
  });
});

describe("SpeedTape", () => {
  it("is a meter: its value, its ends and its words, and it clamps to the tape", () => {
    const { rerender } = render(<SpeedTape value={140} caption="the script's own speed" testId="tape" />);
    const tape = screen.getByRole("meter", { name: "Speed 140 words a minute" });
    expect(tape).toBe(screen.getByTestId("tape"));
    expect(tape).toHaveAttribute("data-speed-tape");
    expect(tape).toHaveAttribute("data-value", "140");
    expect(tape).toHaveAttribute("aria-valuemin", "40");
    expect(tape).toHaveAttribute("aria-valuemax", "300");
    expect(tape).toHaveAttribute("data-caption", "the script's own speed");
    expect(tape.querySelector("[data-tape-pointer]")).toHaveTextContent("140words/min");
    rerender(<SpeedTape value={20} caption="" testId="tape" />);
    expect(tape).toHaveAttribute("data-value", "40");
    expect(tape).toHaveAttribute("aria-valuenow", "40");
    rerender(<SpeedTape value={420} caption="" testId="tape" />);
    expect(tape).toHaveAttribute("data-value", "300");
  });

  it("draws one tick a detent and a label every 20, and slides so the value stands on the centre line", () => {
    const { rerender } = render(<SpeedTape value={140} caption="" testId="tape" />);
    const strip = screen.getByTestId("tape").querySelector<HTMLElement>("[data-tape-strip]")!;
    // 40 to 300 in fives: 53 ticks, 14 of them labelled; 13 px a detent.
    expect(strip.querySelectorAll("i")).toHaveLength(53);
    expect([...strip.querySelectorAll("span")].map((label) => label.textContent)).toEqual([
      "40",
      "60",
      "80",
      "100",
      "120",
      "140",
      "160",
      "180",
      "200",
      "220",
      "240",
      "260",
      "280",
      "300",
    ]);
    // 140 is 32 detents below 300.
    expect(strip.style.transform).toBe("translateY(-416px)");
    rerender(<SpeedTape value={145} caption="" testId="tape" />);
    expect(strip.style.transform).toBe("translateY(-403px)");
    const css = fileOf("SpeedTape.module.css");
    expect(css).toMatch(
      /\.strip \{[^}]*transition: transform var\(--motion-duration-move\) var\(--motion-easing-mech\)/
    );
    expect(css).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*\.strip \{\s*transition: none/);
    expect(rulesOf("SpeedTape.module.css")).not.toMatch(/animation/);
  });

  it("marks a turn on the deck and draws the take's range beside the labels", () => {
    render(<SpeedTape value={145} range={[150, 140]} turned caption="turned on the deck" testId="tape" />);
    const tape = screen.getByTestId("tape");
    expect(tape).toHaveAttribute("data-turned");
    expect(tape).toHaveAttribute("data-caption", "turned on the deck");
    expect(tape).toHaveTextContent("turned on the deck");
    // From 150 (30 detents below 300) to 140 (32): 26 px and its last pixel.
    expect(tape.querySelector("[data-tape-range]")).toHaveStyle({ top: "390px", height: "27px" });
    const css = fileOf("SpeedTape.module.css");
    expect(css).toMatch(/\.turned \.pointer \{\s*outline: 2px solid var\(--accent\);\s*outline-offset: -2px/);
    expect(css).toMatch(/\.turned \.caption \{\s*color: var\(--accent\)/);
  });

  it("draws the deck's dials with the one it follows lit, the pointer's unit in the second ink", () => {
    render(<SpeedTape value={140} caption="" testId="tape" />);
    const dials = [...screen.getByTestId("tape").querySelectorAll("[data-dial]")];
    expect(dials.map((dial) => dial.textContent)).toEqual(["Speed", "Line", "Paragraph", "Size"]);
    expect(dials.map((dial) => dial.hasAttribute("data-on"))).toEqual([true, false, false, false]);
    expect(fileOf("SpeedTape.module.css")).toMatch(/\.unit \{[^}]*color: var\(--text-text2\)/);
  });

  it("is a display only: no focus, no wheel, no key, no pointer handler", () => {
    render(<SpeedTape value={140} caption="" testId="tape" />);
    const tape = screen.getByTestId("tape");
    expect(tape).not.toHaveAttribute("tabindex");
    fireEvent.wheel(tape, { deltaY: -100 });
    fireEvent.keyDown(tape, { key: "ArrowUp" });
    expect(tape).toHaveAttribute("data-value", "140");
    expect(fileOf("SpeedTape.tsx")).not.toMatch(/on(Wheel|Key\w*|Pointer\w*|Mouse\w*|Click)\b|addEventListener/);
  });
});

describe("the Overview's stylesheets", () => {
  // The literal scan (css-literals.test.ts) allows a new file none; this says
  // so per file, with the rest of the rules the parts keep.
  it("carry no literal colour, size, radius or shadow; no gradient, no outer shadow, nothing animates", () => {
    for (const name of STYLESHEETS) {
      const css = rulesOf(name);
      expect(css, name).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/);
      for (const property of ["font-size", "border-radius", "box-shadow"]) {
        for (const match of css.matchAll(new RegExp(`(?:^|[;{\\s])${property}\\s*:\\s*([^;}]+)`, "g"))) {
          expect(match[1]!.trim(), `${name}: ${property}`).toMatch(/^(var\(|0$|inherit$)/);
        }
      }
      for (const match of css.matchAll(/box-shadow\s*:\s*([^;}]+)/g)) {
        expect(match[1]!.trim(), `${name}: box-shadow`).toMatch(/^var\(--elevation-(edge-light|recess)\)$/);
      }
      expect(css, name).not.toMatch(/gradient|animation|@keyframes|blur\(/);
      expect(css, name).toMatch(/^@layer components \{/m);
    }
  });
});
