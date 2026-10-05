import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ArmKey, Key, Segmented } from "../Key";
import { ColorPicker } from "../ColorPicker";
import { Drawer } from "../Drawer";
import { EmptyLine } from "../EmptyLine";
import { LampWord, Latch, LatchSlot } from "../LampWord";
import { Meter } from "../Meter";
import { ControlRow, Danger, Fields, PlateHead, Readouts, Section } from "../Plate";
import { Groove, Slider } from "../Slider";
import { StateDisplay } from "../StateDisplay";
import { Field, Readout, Screen, Well } from "../Well";
import { useArm } from "../useArm";

// Visual overhaul A, Slice 3: the primitives (plan S3 tests).

const cssOf = (name: string) =>
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", name), "utf8");

/** The stylesheet's rules without its comments, for what a file must not draw. */
const rulesOf = (name: string) => cssOf(name).replace(/\/\*[\s\S]*?\*\//g, "");

describe("StateDisplay", () => {
  it("is a fixed-height well region carrying the word, the sentence, the code and the way out", () => {
    render(
      <StateDisplay
        tone="error"
        word="OFFLINE"
        sentence="Audio may still pass, but the app cannot see or change the console right now."
        code="TotalMix did not answer · AUDIO_SYNC_FAILED"
        actions={<Key mode="primary">Run audio probe</Key>}
        testId="audio-state-display"
      />
    );
    const display = screen.getByTestId("audio-state-display");
    expect(display).toHaveAttribute("data-region", "state-display");
    expect(display).toHaveAttribute("data-well");
    expect(display).toHaveAttribute("data-tone", "error");
    expect(screen.getByText("OFFLINE")).toBeInTheDocument();
    expect(screen.getByText(/cannot see or change/)).toBeInTheDocument();
    expect(screen.getByText(/AUDIO_SYNC_FAILED/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run audio probe" })).toBeInTheDocument();
    const css = cssOf("StateDisplay.module.css");
    expect(css).toContain("height: calc(var(--chrome-studio-state-display)");
  });

  // Visual overhaul 2026-10-03 (Atrium). Old: the word took the display inks
  // (`--display-green` …). New: the role text tokens, the same on every surface.
  it("the tone word takes the ink of its tone", () => {
    const css = cssOf("StateDisplay.module.css");
    expect(css).toMatch(/\.ok \.word \{\s*color: var\(--role-green-text\)/);
    expect(css).toMatch(/\.attention \.word \{\s*color: var\(--role-yellow-text\)/);
    expect(css).toMatch(/\.error \.word \{\s*color: var\(--role-coral-text\)/);
    expect(css).toMatch(/\.info \.word \{\s*color: var\(--role-blue-text\)/);
  });

  it("the word is SSE Adelia in capitals and drops to the readout size past ten characters", () => {
    const { rerender } = render(<StateDisplay tone="attention" word="NOT VERIFIED" />);
    expect(screen.getByText("NOT VERIFIED")).toHaveAttribute("data-long");
    rerender(<StateDisplay tone="ok" word="VERIFIED" />);
    expect(screen.getByText("VERIFIED")).not.toHaveAttribute("data-long");
    const css = cssOf("StateDisplay.module.css");
    expect(css).toMatch(
      /\.word \{[^}]*var\(--font-size-display\)[^}]*var\(--font-family-display\)[^}]*text-transform: uppercase/
    );
    expect(css).toMatch(/\.word\[data-long\] \{\s*font-size: var\(--font-size-readout\)/);
  });

  it("an error draws the 2 px coral keyline; the sentence is PT Serif italic on two lines; nothing is tinted", () => {
    const css = cssOf("StateDisplay.module.css");
    expect(css).toMatch(
      /\.display \{[^}]*border: 1px solid var\(--material-line\);\s*background: var\(--material-well\)/
    );
    expect(css).toMatch(/\.error \{[^}]*border: 2px solid var\(--role-coral-text\)/);
    expect(css).toMatch(/\.sentence \{[^}]*italic[^}]*var\(--font-family-serif\)[^}]*-webkit-line-clamp: 2/);
    expect(rulesOf("StateDisplay.module.css")).not.toMatch(/elevation-tint|--display-|box-shadow/);
  });

  it("the armed row is the one armed form: the Burgundy fill, the Beige ink, a 3 px bar", () => {
    const css = cssOf("StateDisplay.module.css");
    expect(css).toMatch(
      /\.armedRow \{[^}]*background: var\(--role-burgundy-fill\);\s*color: var\(--role-burgundy-ink\)/
    );
    expect(css).toMatch(/\.bar \{[^}]*height: 3px/);
    expect(css).toMatch(/\.bar i \{[^}]*background: var\(--role-burgundy-ink\)/);
  });

  it("renders the armed row in place of the meta line", () => {
    const { rerender } = render(<StateDisplay tone="ok" word="VERIFIED" meta="42 values confirmed" />);
    expect(screen.getByText("42 values confirmed")).toBeInTheDocument();
    rerender(
      <StateDisplay
        tone="ok"
        word="VERIFIED"
        meta="42 values confirmed"
        armed={{
          text: "Recall Interview block · press again to apply",
          secondsLeft: 3.9,
          progress: 0.87,
        }}
      />
    );
    expect(screen.queryByText("42 values confirmed")).not.toBeInTheDocument();
    expect(screen.getByText("ARMED")).toBeInTheDocument();
    expect(screen.getByText("3.9 s")).toBeInTheDocument();
    expect(document.querySelector("[data-armed-row]")).toBeInTheDocument();
  });
});

describe("Key", () => {
  // Visual overhaul 2026-10-03 (Atrium). Old: the cap was the mono face in
  // capitals. New: the cap is SSE Adelia (the display family) in capitals.
  it("renders every mode with its data attribute and the cap in SSE Adelia capitals", () => {
    for (const mode of ["command", "primary", "danger", "toggle", "momentary", "arm", "hazard", "segmented"] as const) {
      const { unmount } = render(
        <Key mode={mode} cap={mode}>
          label
        </Key>
      );
      expect(screen.getByRole("button")).toHaveAttribute("data-key-mode", mode);
      unmount();
    }
    const css = cssOf("Key.module.css");
    expect(css).toMatch(/\.cap \{[^}]*font-family-display[^}]*\}/);
    expect(css).toMatch(/\.cap \{[^}]*text-transform: uppercase/);
    expect(css).not.toMatch(/font-family-mono/);
  });

  it("keys are flat: one face, a 1 px edge, no shadow and no gradient", () => {
    const css = cssOf("Key.module.css");
    expect(css).toMatch(
      /\.key \{[^}]*border-radius: var\(--radius-base\);\s*background: var\(--material-key\);\s*border: 1px solid var\(--material-line2\)/
    );
    expect(rulesOf("Key.module.css")).not.toMatch(/box-shadow|gradient|blur\(/);
  });

  it("a selected key carries the Beige keyline and data-selected", () => {
    const { rerender } = render(<Key>Rename</Key>);
    expect(screen.getByRole("button")).not.toHaveAttribute("data-selected");
    rerender(<Key selected>Rename</Key>);
    expect(screen.getByRole("button")).toHaveAttribute("data-selected");
    expect(cssOf("Key.module.css")).toMatch(/\.selected \{[^}]*border-color: var\(--accent\)/);
  });

  it("engaged and live are lit fills marked data-lit; a toggle exposes aria-pressed", () => {
    const { rerender } = render(
      <Key mode="toggle" cap="Dim" engaged>
        engaged
      </Key>
    );
    const key = screen.getByRole("button");
    expect(key).toHaveAttribute("data-lit");
    expect(key).toHaveAttribute("aria-pressed", "true");
    rerender(
      <Key mode="momentary" cap="Hold" live>
        live
      </Key>
    );
    expect(screen.getByRole("button")).toHaveAttribute("data-live");
    expect(screen.getByRole("button")).toHaveAttribute("data-lit");
  });

  it("a locked key is aria-disabled, exposes the reason and does not fire", () => {
    const onClick = vi.fn();
    render(
      <Key
        mode="toggle"
        cap="Mono"
        locked
        reason="Console controls stay locked until the audio probe passes."
        onClick={onClick}
      >
        mono
      </Key>
    );
    const key = screen.getByRole("button");
    expect(key).toHaveAttribute("aria-disabled", "true");
    expect(key).toHaveAttribute("title", "Console controls stay locked until the audio probe passes.");
    expect(key).not.toHaveAttribute("data-lit");
    fireEvent.click(key);
    expect(onClick).not.toHaveBeenCalled();
    const css = cssOf("Key.module.css");
    // Atrium: the locked form is a dashed edge on no face at 55 %.
    expect(css).toMatch(/\.locked \{[^}]*opacity: 0\.55;\s*background: transparent;\s*border-style: dashed/);
  });

  // The visual overhaul's polish (2026-10-05). Old: a locked key dropped its
  // state, so a muted strip or a dimmed room read as open while the desk was
  // offline. New: it keeps it, the word and the dashed edge in yellow while
  // engaged and in green while live, still unlit at 55 %, before the segmented
  // rules so a locked group keeps its hairlines.
  it("a locked key keeps its state: engaged in yellow, live in green, still dashed and unlit", () => {
    const reason = "Console controls stay locked until the audio probe passes.";
    const { rerender } = render(
      <Key mode="toggle" cap="Solo" engaged locked reason={reason}>
        solo
      </Key>
    );
    const key = screen.getByRole("button");
    expect(key).toHaveAttribute("data-engaged");
    expect(key).toHaveAttribute("aria-disabled", "true");
    expect(key).not.toHaveAttribute("data-lit");
    rerender(
      <Key mode="momentary" cap="Hold" live locked reason={reason}>
        hold
      </Key>
    );
    expect(screen.getByRole("button")).toHaveAttribute("data-live");
    expect(screen.getByRole("button")).not.toHaveAttribute("data-lit");
    const css = cssOf("Key.module.css");
    expect(css).toMatch(
      /^\s*\.locked\[data-engaged\] \{\s*color: var\(--role-yellow-text\);\s*border-color: var\(--role-yellow-line\);\s*\}/m
    );
    expect(css).toMatch(
      /^\s*\.locked\[data-live\] \{\s*color: var\(--role-green-text\);\s*border-color: var\(--role-green-text\);\s*\}/m
    );
    expect(css.search(/^\s*\.locked\[data-engaged\] \{/m)).toBeLessThan(css.indexOf(".segmented .key {"));
  });

  it("keys never travel: no transform on hover", () => {
    const css = cssOf("Key.module.css");
    expect(css).not.toMatch(/:hover \{[^}]*transform/);
  });

  it("a hazard key carries a lamp that is lit only when the hazard is on", () => {
    const { rerender, container } = render(<Key mode="hazard">48 V</Key>);
    expect(container.querySelector("[data-lamp]")).toHaveAttribute("data-lamp", "off");
    rerender(
      <Key mode="hazard" lit>
        48 V
      </Key>
    );
    expect(container.querySelector("[data-lamp]")).toHaveAttribute("data-lit");
  });

  // Visual overhaul 2026-10-03 (Atrium). Old: a well of keys. New: one
  // outlined row; `data-well` stays on the group for the pages that find it.
  it("a segmented group is one outlined row of keys with one lit choice", () => {
    render(
      <Segmented label="Mix target" testId="seg">
        <Key mode="segmented" cap="Main Out" engaged />
        <Key mode="segmented" cap="Phones 1" />
      </Segmented>
    );
    expect(screen.getByRole("group", { name: "Mix target" })).toHaveAttribute("data-well");
    expect(screen.getAllByRole("button").filter((b) => b.hasAttribute("data-lit"))).toHaveLength(1);
    expect(cssOf("Key.module.css")).toMatch(
      /\.segmented \{[^}]*border: 1px solid var\(--material-line2\);\s*border-radius: var\(--radius-base\);\s*background: var\(--material-key\)/
    );
  });

  it("take-time keys declare data-take and measure at least 36 px tall in the stylesheet", () => {
    render(
      <Key cap="Dim" take>
        dim
      </Key>
    );
    expect(screen.getByRole("button")).toHaveAttribute("data-take");
    expect(cssOf("Key.module.css")).toMatch(/\.key \{[^}]*min-height: 36px/);
  });

  it("comes in four heights: small 28, default 36, large 48, tall 64", () => {
    render(<Key size="large">Turn off</Key>);
    expect(screen.getByRole("button").className).toMatch(/large/);
    const css = cssOf("Key.module.css");
    expect(css).toMatch(/\.small \{[^}]*min-height: 28px/);
    expect(css).toMatch(/\.large \{[^}]*min-height: 48px/);
    expect(css).toMatch(/\.tall \{[^}]*min-height: 64px/);
  });
});

describe("ArmKey", () => {
  // New pages program, Slice 3 (D6). Old: the tag read `ARMED · press again ·
  // Esc cancels · 3.9 s`. New: `ARMED · press again · 3.9 s`. Reason: Esc still
  // cancels the arm (useArm), but its hint goes with every other key hint.
  it("renders the tag, the label and the countdown bar only while armed", () => {
    const { rerender } = render(
      <ArmKey armed={false} timeoutMs={4500} cap="3">
        Interview block
      </ArmKey>
    );
    expect(screen.getByRole("button")).toHaveAttribute("data-armed", "false");
    expect(screen.queryByTestId("audio-arm-countdown")).not.toBeInTheDocument();
    rerender(
      <ArmKey armed timeoutMs={4500} secondsLeft={3.9} cap="3">
        Interview block
      </ArmKey>
    );
    expect(screen.getByRole("button")).toHaveAttribute("data-armed", "true");
    expect(screen.getByText("ARMED · press again · 3.9 s")).toBeInTheDocument();
    expect(screen.getByRole("button")).not.toHaveTextContent(/Esc/);
    const bar = screen.getByTestId("audio-arm-countdown");
    expect(bar.getAttribute("style")).toContain("--arm-duration: 4500ms");
  });

  // Visual overhaul 2026-10-03 (Atrium): the one armed form is the Burgundy
  // fill with the Beige ink, and its countdown a 3 px bar in that ink.
  it("armed is the Burgundy fill with the Beige ink and a 3 px countdown bar", () => {
    const css = cssOf("Key.module.css");
    expect(css).toMatch(
      /\.armed \{[^}]*background: var\(--role-burgundy-fill\);\s*border-color: var\(--role-burgundy-fill\);\s*color: var\(--role-burgundy-ink\)/
    );
    expect(css).toMatch(/\.countdown \{[^}]*height: 3px[^}]*background: var\(--role-burgundy-ink\)/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*\.countdown \{[^}]*animation: none/);
  });
});

describe("ArmKey as a hazard", () => {
  it("is a red lamp and the word at rest, an armed key when armed, and the same key all along", () => {
    const { rerender } = render(<ArmKey hazard armed={false} timeoutMs={3000} cap="REC" hint="press twice to stop" />);
    const key = screen.getByRole("button");
    expect(key).toHaveAttribute("data-key-mode", "hazard");
    expect(key.querySelector("[data-lamp='error']")).toHaveAttribute("data-lit");
    expect(key).toHaveTextContent("REC");

    rerender(<ArmKey hazard armed timeoutMs={3000} cap="STOP?" hint="press twice to stop" />);
    expect(screen.getByRole("button")).toBe(key);
    expect(key).toHaveAttribute("data-key-mode", "arm");
    expect(key).toHaveAttribute("data-armed", "true");
    expect(key.querySelector("[data-lamp]")).toBeNull();
    expect(key).toHaveTextContent("STOP?");
  });
});

describe("useArm", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("arms on the first press, ignores a press inside the dwell, applies after it, only for the same key", () => {
    let clock = 0;
    const now = () => clock;
    const apply = vi.fn();
    const { result } = renderHook(() => useArm({ now }));
    act(() => result.current.armOrApply("recall:3", "Recall Interview block", apply));
    expect(result.current.armed?.key).toBe("recall:3");
    clock = 100;
    act(() => result.current.armOrApply("recall:3", "Recall Interview block", apply));
    expect(apply).not.toHaveBeenCalled();
    expect(result.current.armed?.key).toBe("recall:3");
    clock = 400;
    act(() => result.current.armOrApply("recall:4", "Recall Credits", apply));
    expect(apply).not.toHaveBeenCalled();
    expect(result.current.armed?.key).toBe("recall:4");
    clock = 800;
    act(() => result.current.armOrApply("recall:4", "Recall Credits", apply));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(result.current.armed).toBeNull();
  });

  // The visual overhaul's Teleprompter (2026-10-05): a menu's hand-off arms
  // the plate's key and must never be its second press, whenever it lands.
  it("arms only with armOnly: a key armed already is left as it is, and nothing is applied", () => {
    let clock = 0;
    const now = () => clock;
    const apply = vi.fn();
    const { result } = renderHook(() => useArm({ now }));
    act(() => result.current.armOnly("replace:4", "Replace with 04 Outro"));
    expect(result.current.armed).toMatchObject({ key: "replace:4", armedAt: 0, timeoutMs: 4500 });
    clock = 1000;
    act(() => result.current.armOnly("replace:4", "Replace with 04 Outro"));
    expect(result.current.armed).toMatchObject({ key: "replace:4", armedAt: 0 });
    act(() => result.current.armOnly("clear", "Clear the prompter", 3000));
    expect(result.current.armed).toMatchObject({ key: "clear", timeoutMs: 3000 });
    clock = 2000;
    act(() => result.current.armOrApply("clear", "Clear the prompter", apply));
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("times out after the window and disarms on Escape", () => {
    const onDisarm = vi.fn();
    const { result } = renderHook(() => useArm({ now: () => 0, onDisarm }));
    act(() => result.current.armOrApply("k", "K", () => {}));
    act(() => {
      vi.advanceTimersByTime(4500);
    });
    expect(result.current.armed).toBeNull();
    expect(onDisarm).toHaveBeenCalledWith(expect.objectContaining({ key: "k" }), "timeout");

    act(() => result.current.armOrApply("k", "K", () => {}));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(result.current.armed).toBeNull();
    expect(onDisarm).toHaveBeenLastCalledWith(expect.objectContaining({ key: "k" }), "escape");
  });

  // The Esc order: a layer above (a dialog, a drawer, a menu) that took the
  // Esc closes alone, and the next Esc disarms.
  it("leaves an Esc that a layer above took to that layer", () => {
    const onDisarm = vi.fn();
    const { result } = renderHook(() => useArm({ now: () => 0, onDisarm }));
    act(() => result.current.armOrApply("k", "K", () => {}));
    act(() => {
      const taken = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
      taken.preventDefault();
      window.dispatchEvent(taken);
    });
    expect(result.current.armed?.key).toBe("k");
    expect(onDisarm).not.toHaveBeenCalled();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    });
    expect(result.current.armed).toBeNull();
  });

  // A key with a window of its own (the Cameras page's stop has the deck's
  // 3 s) disarms after that, and the next key has the surface's again.
  it("gives a key its own window when it names one", () => {
    const onDisarm = vi.fn();
    const { result } = renderHook(() => useArm({ now: () => 0, onDisarm }));
    act(() => result.current.armOrApply("stop", "Stop recording", () => {}, 3000));
    expect(result.current.armed).toMatchObject({ key: "stop", timeoutMs: 3000 });
    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(result.current.armed?.key).toBe("stop");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.armed).toBeNull();
    expect(onDisarm).toHaveBeenCalledWith(expect.objectContaining({ key: "stop" }), "timeout");

    act(() => result.current.armOrApply("release", "Release CAM 1", () => {}));
    expect(result.current.armed).toMatchObject({ key: "release", timeoutMs: 4500 });
  });

  // Slice 3 review (#27): Enter held on the focused arm key repeats, and the
  // browser presses the key again on every repeat, so the first repeat after the
  // dwell (Windows repeats after about 500 ms) would confirm the arm. While a
  // key is armed a repeated Enter is cancelled, which keeps the key from being
  // pressed; a fresh Enter is left alone, so it can still confirm.
  it("cancels a held Enter's repeats while a key is armed, and not a fresh Enter", () => {
    const { result } = renderHook(() => useArm({ now: () => 0 }));
    const armKey = document.createElement("button");
    document.body.appendChild(armKey);
    armKey.focus();
    // fireEvent answers false when the keydown was cancelled.
    const enter = (repeat: boolean) => fireEvent.keyDown(armKey, { key: "Enter", repeat });

    expect(enter(true)).toBe(true);

    act(() => result.current.armOrApply("recall:3", "Recall Interview block", () => {}));
    expect(enter(true)).toBe(false);
    expect(enter(false)).toBe(true);
    expect(result.current.armed?.key).toBe("recall:3");
    armKey.remove();
  });
});

describe("LampWord and Latch", () => {
  it("a lamp word keeps its lamp beside the word", () => {
    const { container } = render(<LampWord tone="attention">ASSUMED</LampWord>);
    expect(container.querySelector("[data-lamp]")).toHaveAttribute("data-lit");
    expect(screen.getByText("ASSUMED")).toBeInTheDocument();
  });

  it("a latch names who latched and carries the clearing key", () => {
    render(
      <Latch who="1 solo engaged" action={<Key>Clear all solo</Key>} testId="latch">
        on FX 3/4
      </Latch>
    );
    expect(screen.getByTestId("latch")).toHaveAttribute("data-latch");
    expect(screen.getByRole("button", { name: "Clear all solo" })).toBeInTheDocument();
  });

  it("a latch is a 56 px keyline in its tone; a state word is SSE Adelia in capitals", () => {
    const css = cssOf("LampWord.module.css");
    expect(css).toMatch(/\.latch \{[^}]*height: 56px[^}]*border: 1px solid var\(--role-yellow-line\)/);
    expect(css).toMatch(/\.cap \{[^}]*var\(--font-family-display\)[^}]*text-transform: uppercase/);
  });

  it("a lamp is a circle with no bloom: hollow when off, filled with its tone when lit", () => {
    const css = cssOf("Lamp.module.css");
    expect(css).toMatch(
      /\.lamp \{[^}]*border-radius: var\(--radius-pill\);\s*border: 1px solid var\(--text-text3\);\s*background: transparent/
    );
    expect(css).toMatch(/\.error \{[^}]*background: var\(--role-coral-text\)/);
    expect(rulesOf("Lamp.module.css")).not.toMatch(/elevation-lamp|bloom|box-shadow/);
  });

  // The latch slot (new, Atrium): the same 56 px row under the state display
  // on every page, so the keys below it never move whether anything is
  // latched or not.
  it("a latch slot keeps its row: the resting form with nothing latched, the latches when there are", () => {
    const { rerender } = render(<LatchSlot testId="slot" />);
    const slot = screen.getByTestId("slot");
    expect(slot).toHaveAttribute("data-latch-slot");
    expect(slot).toHaveAttribute("data-count", "0");
    expect(slot).toHaveTextContent("Nothing latched");
    expect(slot.querySelector("[data-lamp]")).toHaveAttribute("data-lamp", "off");
    expect(slot.querySelector("[data-lamp]")).not.toHaveAttribute("data-lit");
    expect(slot.querySelector("[data-latch]")).toBeNull();
    rerender(<LatchSlot testId="slot" emptyLabel="No solo" />);
    expect(slot).toHaveTextContent("No solo");
    rerender(
      <LatchSlot testId="slot">
        <Latch who="Solo" action={<Key>Clear all solo</Key>}>
          on FX 3/4
        </Latch>
        {null}
        <Latch who="Scene" tone="info" action={<Key>Save</Key>}>
          changed since it was saved
        </Latch>
      </LatchSlot>
    );
    expect(screen.getByTestId("slot")).toBe(slot);
    expect(slot).toHaveAttribute("data-count", "2");
    expect(slot.querySelectorAll("[data-latch]")).toHaveLength(2);
    expect(slot).not.toHaveTextContent("Nothing latched");
    const css = cssOf("LampWord.module.css");
    // A fixed height that does not shrink, whatever it holds.
    expect(css).toMatch(/\.latchSlot \{[^}]*height: 56px;\s*flex: none/);
    expect(css).not.toMatch(/\.latchSlot \{[^}]*min-height/);
    // The resting form: a hairline edge, the one radius, no fill.
    expect(css).toMatch(
      /\.resting \{[^}]*border: 1px solid var\(--material-line\);\s*border-radius: var\(--radius-base\)/
    );
    expect(css).toMatch(/\.emptyLabel \{[^}]*color: var\(--text-text3\)/);
    // Two latches: each keeps its word and its key, and its text gives way.
    expect(css).toMatch(/\.crowded \.text \{\s*display: none/);
  });
});

describe("Wells", () => {
  it("a well is marked data-well: one step down, a hairline edge, flat", () => {
    render(
      <Well>
        <span>display</span>
      </Well>
    );
    expect(screen.getByText("display").parentElement).toHaveAttribute("data-well");
    expect(cssOf("Well.module.css")).toMatch(
      /\.well \{[^}]*background: var\(--material-well\);\s*border: 1px solid var\(--material-line\)/
    );
    expect(rulesOf("Well.module.css")).not.toMatch(/box-shadow|gradient/);
  });

  // Visual overhaul 2026-10-03 (Atrium). Old: doubt was dashed in
  // `--display-yellow` on a readout box. New: the readout is the value itself
  // (a transparent edge), and doubt dashes that edge in `--role-yellow-line`,
  // so nothing moves; the unit prints at half size.
  it("a readout prints the value, marks doubt, and prints — when empty", () => {
    const { rerender } = render(<Readout value="-3.8 dB" testId="r" />);
    expect(screen.getByTestId("r")).toHaveTextContent("-3.8 dB");
    rerender(<Readout value="-3.8 dB" doubt testId="r" />);
    expect(screen.getByTestId("r")).toHaveAttribute("data-doubt");
    rerender(<Readout value="-3.8 dB" empty testId="r" />);
    expect(screen.getByTestId("r")).toHaveTextContent("—");
    rerender(<Readout value="-3.8" unit="dB" testId="r" />);
    expect(screen.getByTestId("r")).toHaveTextContent("-3.8 dB");
    expect(screen.getByText("dB")).toBeInTheDocument();
    const css = cssOf("Well.module.css");
    expect(css).toMatch(/\.readout \{[^}]*border: 1px solid transparent/);
    expect(css).toMatch(/\.doubt \{[^}]*border: 1px dashed var\(--role-yellow-line\)/);
    expect(css).toMatch(/\.readout\[data-empty\] \{\s*color: var\(--text-text3\)/);
    expect(css).toMatch(/\.unit \{[^}]*font-size: var\(--font-size-tick\);\s*color: var\(--text-text3\)/);
  });

  it("a field prints its label and value on a well", () => {
    render(<Field label="Stage X" value="2.9 m" testId="f" />);
    expect(screen.getByTestId("f")).toHaveAttribute("data-well");
    expect(screen.getByText("Stage X")).toBeInTheDocument();
    expect(screen.getByText("2.9 m")).toBeInTheDocument();
    expect(cssOf("Well.module.css")).toMatch(/\.field:focus-within \{\s*border-color: var\(--accent\)/);
  });

  it("a screen is a well with an optional head and the blue keyline for preview", () => {
    render(
      <Screen head={<span>Stage plot</span>} info testId="screen">
        <svg />
      </Screen>
    );
    expect(screen.getByText("Stage plot")).toBeInTheDocument();
    expect(screen.getByTestId("screen").querySelector("[data-well]")).toBeInTheDocument();
    expect(cssOf("Well.module.css")).toMatch(/\.info \{\s*border-color: var\(--role-blue-text\)/);
  });
});

describe("Slider and Groove", () => {
  // New pages program, Slice 3 (decision 9). Old: "…, Shift multiplies by five",
  // Shift+ArrowDown → 0.45. New: a plain ArrowDown → 0.49, and Home joins End.
  // Reason: a focused slider takes the arrows, Home and End and nothing with
  // Shift, Ctrl or Alt; the modified arrow has a case of its own below.
  it("a slider is a slider with the value in per cent; arrows step it, Home and End go to the ends", () => {
    const onChange = vi.fn();
    render(<Slider label="Main level" value={0.5} unity={0.8172} onChange={onChange} valueText="-6.0 dB" />);
    const slider = screen.getByRole("slider", { name: "Main level" });
    expect(slider).toHaveAttribute("aria-valuenow", "50");
    expect(slider).toHaveAttribute("aria-valuetext", "-6.0 dB");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(0.51);
    fireEvent.keyDown(slider, { key: "ArrowDown" });
    expect(onChange).toHaveBeenLastCalledWith(0.49);
    fireEvent.keyDown(slider, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(slider, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  // Decision 9: no Shift ×5 step. Shift+ArrowUp on a focused slider or fader
  // moves exactly one plain step, and so do Ctrl and Alt.
  it("a modified arrow on a focused slider or groove moves exactly one plain step", () => {
    const onSlider = vi.fn();
    const onGroove = vi.fn();
    render(
      <>
        <Slider label="Main level" value={0.5} onChange={onSlider} />
        <Groove label="Host fader" value={0.5} onChange={onGroove} />
      </>
    );
    fireEvent.keyDown(screen.getByRole("slider", { name: "Main level" }), { key: "ArrowUp", shiftKey: true });
    expect(onSlider).toHaveBeenLastCalledWith(0.51);
    fireEvent.keyDown(screen.getByRole("slider", { name: "Host fader" }), { key: "ArrowUp", shiftKey: true });
    expect(onGroove).toHaveBeenLastCalledWith(0.51);
    fireEvent.keyDown(screen.getByRole("slider", { name: "Host fader" }), { key: "ArrowDown", ctrlKey: true });
    expect(onGroove).toHaveBeenLastCalledWith(0.49);
    fireEvent.keyDown(screen.getByRole("slider", { name: "Host fader" }), { key: "ArrowDown", altKey: true });
    expect(onGroove).toHaveBeenLastCalledWith(0.49);
  });

  it("a locked slider is aria-disabled and ignores keys; a doubted one is marked", () => {
    const onChange = vi.fn();
    render(<Slider label="Send" value={0.4} locked doubt onChange={onChange} />);
    const slider = screen.getByRole("slider", { name: "Send" });
    expect(slider).toHaveAttribute("aria-disabled", "true");
    expect(slider).toHaveAttribute("data-doubt");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("a groove is a vertical slider on a 44 px target column with the unity notch", () => {
    render(<Groove label="Host fader" value={0.8172} take testId="g" />);
    const groove = screen.getByRole("slider", { name: "Host fader" });
    expect(groove).toHaveAttribute("aria-valuenow", "82");
    expect(groove).toHaveAttribute("data-take");
    expect(cssOf("Slider.module.css")).toMatch(/\.groove \{[^}]*width: 44px/);
    expect(cssOf("Slider.module.css")).toMatch(/\.grooveWell \{[^}]*left: 13px;\s*right: 13px/);
    // The travel keeps its 14 px insets, the same as the meter's bars, so a
    // groove and the meter beside it read on one scale.
    expect(cssOf("Slider.module.css")).toMatch(/\.travel \{[^}]*top: 14px;\s*bottom: 14px/);
    expect(cssOf("Slider.module.css")).toMatch(/\.slot \{[^}]*width: 2px[^}]*background: var\(--material-line\)/);
  });

  // Visual overhaul 2026-10-03 (Atrium): the caps are matte and light (the
  // cap fill, the one radius, no shadow), the groove's cap carries a 2 px
  // index line, and the horizontal slider has no box, only a 28 px hit area.
  it("caps are matte and light, with the one radius and no shadow", () => {
    const css = cssOf("Slider.module.css");
    expect(css).toMatch(/\.cap \{[^}]*border-radius: var\(--radius-base\);\s*background: var\(--role-cap-fill\)/);
    expect(css).toMatch(/\.grooveCap \{[^}]*border-radius: var\(--radius-base\);\s*background: var\(--role-cap-fill\)/);
    expect(css).toMatch(/\.grooveCap::after \{[^}]*height: 2px[^}]*background: var\(--role-cap-line\)/);
    expect(css).toMatch(/\.slider \{[^}]*height: 28px/);
    expect(css).toMatch(/\.track \{[^}]*height: 2px;\s*margin-top: -1px;\s*background: var\(--material-line2\)/);
    expect(css).toMatch(/\.doubt \.cap,\s*\.doubt \.grooveCap \{\s*outline: 1px dashed var\(--role-yellow-line\)/);
    expect(rulesOf("Slider.module.css")).not.toMatch(/box-shadow|gradient/);
  });

  it("the colour temperature track is signal and draws no fill", () => {
    const { container, rerender } = render(<Slider label="Main level" value={0.2} />);
    expect(container.querySelector('[class*="fill"]')).not.toBeNull();
    rerender(<Slider label="Colour temperature" value={0.2} cct />);
    expect(container.querySelectorAll('[data-signal="cct"]')).toHaveLength(1);
    expect(container.querySelector('[class*="fill"]')).toBeNull();
    expect(cssOf("Slider.module.css")).toMatch(/\.cct \.track \{[^}]*background: var\(--signal-cct-track\)/);
  });

  it("a groove draws the ticks it is given, and none without them", () => {
    const { container, rerender } = render(<Groove label="Host fader" value={0.5} ticks={[0.1, 0.5, 0.9]} />);
    expect(container.querySelectorAll("[data-tick]")).toHaveLength(3);
    rerender(<Groove label="Host fader" value={0.5} />);
    expect(container.querySelectorAll("[data-tick]")).toHaveLength(0);
  });

  // Visual overhaul A, Slice 4b: the Console's faders are this groove, so the
  // engine carries what the desk expects of a fader — the axis it runs on,
  // typed entry, and unity by hand.
  it("says which axis it runs on", () => {
    render(
      <>
        <Slider label="Main level" value={0.5} />
        <Groove label="Host fader" value={0.5} />
      </>
    );
    expect(screen.getByRole("slider", { name: "Main level" })).toHaveAttribute("aria-orientation", "horizontal");
    expect(screen.getByRole("slider", { name: "Host fader" })).toHaveAttribute("aria-orientation", "vertical");
  });

  it("asks the host for typed entry on Enter and on a double press", () => {
    const onRequestTypedEntry = vi.fn();
    render(<Groove label="Host fader" value={0.5} onRequestTypedEntry={onRequestTypedEntry} />);
    const groove = screen.getByRole("slider", { name: "Host fader" });
    fireEvent.keyDown(groove, { key: "Enter" });
    expect(onRequestTypedEntry).toHaveBeenCalledTimes(1);
    // jsdom has no PointerEvent, so the double press is dispatched as the
    // mouse event React listens for, carrying its `detail`.
    fireEvent(groove, new MouseEvent("pointerdown", { bubbles: true, button: 0, detail: 2 }));
    expect(onRequestTypedEntry).toHaveBeenCalledTimes(2);
  });

  // New pages program, Slice 3 (decision 10). Old: "Shift jumps to it" — a
  // Shift + press set 0.8172 and committed it. New: Shift is not read, so the
  // press lands where it points (0.5 here), and a press beside unity settles
  // on it. Reason: a key held while pointing is a shortcut; the drag that
  // settles on unity and right-click › "Reset to unity" stay.
  it("puts a fader back on unity by hand: a press beside it settles on it, and Shift adds nothing", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(<Groove label="Host fader" value={0.3} unity={0.8172} snapUnity onChange={onChange} onCommit={onCommit} />);
    const groove = screen.getByRole("slider", { name: "Host fader" });
    groove.setPointerCapture = () => {};
    groove.releasePointerCapture = () => {};
    // A 228 px column: 14 px insets and 200 px of travel, so y = 14 + (1 − value) × 200.
    groove.getBoundingClientRect = () =>
      ({ x: 0, y: 0, left: 0, top: 0, right: 44, bottom: 228, width: 44, height: 228 }) as DOMRect;
    // jsdom has no PointerEvent, so the press is the mouse event React listens for.
    fireEvent(groove, new MouseEvent("pointerdown", { bubbles: true, button: 0, clientY: 114, shiftKey: true }));
    expect(onChange).toHaveBeenLastCalledWith(0.5);
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent(groove, new MouseEvent("pointerup", { bubbles: true, button: 0, clientY: 114 }));
    expect(onCommit).toHaveBeenLastCalledWith(0.5);
    // 0.82 lands within the snap of 0.8172 and settles on unity exactly.
    fireEvent(groove, new MouseEvent("pointerdown", { bubbles: true, button: 0, clientY: 50 }));
    expect(onChange).toHaveBeenLastCalledWith(0.8172);
    fireEvent(groove, new MouseEvent("pointerup", { bubbles: true, button: 0, clientY: 50 }));
    expect(onCommit).toHaveBeenLastCalledWith(0.8172);
  });
});

describe("Meter", () => {
  // Visual overhaul 2026-10-03 (Atrium). Old: a blurred glow copy of the ramp
  // stood under it, so a bar drew two signal elements. New: nothing glows; a
  // bar draws its one ramp.
  it("draws the ramp when live and marks it as signal; nothing glows", () => {
    const { container } = render(<Meter label="Host" level={0.6} peak={0.7} />);
    expect(container.querySelectorAll('[data-signal="meter"]')).toHaveLength(1);
    expect(screen.getByRole("meter", { name: "Host" })).toHaveAttribute("aria-valuenow", "60");
  });

  // Visual overhaul A, Slice 4b: a meter that names an engine entry is painted
  // live by the Console's canvas, which needs to know which way each bar runs
  // and which track, fill and peak it is looking at.
  it("names each bar's track, axis, fill and peak for the live painter", () => {
    const { container } = render(
      <Meter
        label="Host"
        level={0.6}
        levelRight={0.5}
        peak={0.7}
        peakRight={0.6}
        meterId="audio-input-9"
        meterKind="channel"
      />
    );
    const bars = container.querySelectorAll("[data-mini-meter-kind]");
    expect(bars).toHaveLength(2);
    expect(bars[0]).toHaveAttribute("data-mini-meter-orientation", "vertical");
    expect(bars[0]).toHaveAttribute("data-meter-track", "left");
    expect(bars[1]).toHaveAttribute("data-meter-track", "right");
    expect(container.querySelector('[data-meter-fill="left"]')).not.toBeNull();
    expect(container.querySelector('[data-meter-peak="right"]')).not.toBeNull();
  });

  it("empty leaves the slots and the reference only; stale dims the last frame to 0.4", () => {
    const { container, rerender } = render(<Meter label="Host" level={0.6} peak={0.7} empty />);
    expect(container.querySelectorAll('[data-signal="meter"]')).toHaveLength(0);
    expect(screen.getByRole("meter")).toHaveAttribute("data-empty");
    rerender(<Meter label="Host" level={0.6} peak={0.7} stale />);
    expect(container.querySelectorAll('[data-signal="meter"]')).toHaveLength(1);
    expect(screen.getByRole("meter")).toHaveAttribute("data-stale");
    expect(cssOf("Meter.module.css")).toMatch(/\.stale \.ramp,\s*\.stale \.peak \{[^}]*opacity: 0\.4/);
  });

  it("a stereo meter draws two bars and the clip lamp lights only on clip", () => {
    const { container, rerender } = render(<Meter label="Main" level={0.5} levelRight={0.4} />);
    expect(container.querySelectorAll('[data-signal="meter"]')).toHaveLength(2);
    expect(screen.getByRole("meter")).not.toHaveAttribute("data-clip");
    rerender(<Meter label="Main" level={0.5} levelRight={0.4} clip />);
    expect(screen.getByRole("meter")).toHaveAttribute("data-clip");
  });

  it("the ramp is the signal token: green to 70 %, yellow to 95 %, coral above", () => {
    expect(cssOf("Meter.module.css")).toContain("var(--signal-ramp-v)");
    expect(cssOf("Meter.module.css")).toContain("var(--signal-ramp-h)");
  });

  it("is flat: a slot in each bar, a 2 px peak tick, a coral clip lamp, no glow", () => {
    const css = cssOf("Meter.module.css");
    expect(css).toMatch(
      /\.meter \{[^}]*background: var\(--material-well\);\s*border: 1px solid var\(--material-line\)/
    );
    expect(css).toMatch(/\.bar \{[^}]*background: var\(--material-bg\)/);
    expect(css).toMatch(/\.peak \{[^}]*background: var\(--signal-peak\)/);
    expect(css).toMatch(/\.vertical \.peak \{[^}]*height: 2px/);
    expect(css).toMatch(/\.horizontal \.peak \{[^}]*width: 2px/);
    expect(css).toMatch(/\.clipLit \{[^}]*background: var\(--role-coral-fill\)/);
    expect(rulesOf("Meter.module.css")).not.toMatch(/box-shadow|blur\(|filter/);
  });
});

describe("Plate sections", () => {
  it("renders the head, a section with its detail and actions, fields, readouts, a control row and the danger slot", () => {
    render(
      <>
        <PlateHead title="FX 3/4" sub="Playback bus · Stereo → Main Out" action={<Key>Rename</Key>} />
        <Section title="Sends" detail="into Phones 1 and 2" actions={<Key mode="command">Reset</Key>}>
          <Fields>
            <Field label="Stage X" value="2.9 m" />
          </Fields>
          <Readouts rows={[{ label: "Peak L", value: "-6.1 dB" }]} />
          <ControlRow label="Send to Main Out" value="+2.1 dB">
            <Slider label="Send to Main Out" value={0.7} />
          </ControlRow>
        </Section>
        <Danger>
          <Key mode="danger">Delete fixture…</Key>
        </Danger>
      </>
    );
    expect(screen.getByRole("heading", { name: "FX 3/4" })).toBeInTheDocument();
    expect(screen.getByText("into Phones 1 and 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument();
    expect(screen.getByText("Peak L")).toBeInTheDocument();
    expect(screen.getByText("+2.1 dB")).toBeInTheDocument();
    expect(document.querySelector("[data-danger]")).toContainElement(
      screen.getByRole("button", { name: "Delete fixture…" })
    );
  });

  // Visual overhaul 2026-10-03 (Atrium): the plate head is the Dark Green
  // title plate, its title PT Sans keeping its case; a section head is SSE
  // Adelia in capitals over the brand's 2 px heavy rule.
  it("the head is the Dark Green title plate; a section head is Adelia over the heavy rule", () => {
    const css = cssOf("Plate.module.css");
    expect(css).toMatch(/\.head \{[^}]*background: var\(--sse-dark-green\)/);
    expect(css).toMatch(/\.title \{[^}]*font: 700 var\(--font-size-readout\) \/ 1\.1 var\(--font-family-ui\)/);
    expect(css).not.toMatch(/\.title \{[^}]*text-transform/);
    expect(css).toMatch(/\.sectionHead \{[^}]*border-bottom: 2px solid var\(--material-line2\)/);
    expect(css).toMatch(/\.sectionTitle \{[^}]*var\(--font-family-display\)[^}]*text-transform: uppercase/);
    expect(css).toMatch(/\.readoutLabel,\s*\.readoutValue \{[^}]*border-bottom: 1px solid var\(--material-line\)/);
  });

  // The visual overhaul's polish (2026-10-05). Old: the title plate centred
  // its key, so the plate's ⋯ stood lower the more the sub-line held; a
  // section head centred its row, so a head with a key stood taller and the
  // key sat on the rule. New: the key stands on the title's line; the section
  // head's row stands 4 px above the rule, with or without keys.
  it("the title plate's key stands on the title's line; a section head's row stands 4 px above its rule", () => {
    const css = cssOf("Plate.module.css");
    expect(css).toMatch(/\.head \{[^}]*align-items: flex-start/);
    expect(css).toMatch(
      /\.sectionHead \{[^}]*align-items: last baseline;\s*align-content: end;[^}]*min-height: 28px;[^}]*padding-bottom: 4px;\s*border-bottom: 2px solid/
    );
    expect(css).toMatch(/\.sectionActions \{[^}]*align-self: end/);
  });

  it("a control row prints its value with the unit at half size in the quiet ink", () => {
    render(
      <ControlRow label="Phones 1" value="-7.2" unit="dB" testId="cr">
        <Slider label="Phones 1" value={0.5} />
      </ControlRow>
    );
    expect(screen.getByTestId("cr")).toHaveTextContent("-7.2 dB");
    expect(screen.getByText("dB")).toBeInTheDocument();
    expect(cssOf("Plate.module.css")).toMatch(
      /\.controlUnit \{\s*font-size: var\(--font-size-tick\);\s*color: var\(--text-text3\)/
    );
  });
});

// The visual overhaul's polish (2026-10-05): the one form of an empty list or
// section. Old: four forms page by page (body 16 or label 14, the second or
// the quiet ink, Adelia capitals, a helper sentence after the words). New: one
// quiet line, the explanation in its tooltip, an optional lamp and one key.
describe("EmptyLine", () => {
  it("is one quiet line whose text is exactly its words", () => {
    render(<EmptyLine testId="empty">No scenes saved yet</EmptyLine>);
    const line = screen.getByTestId("empty");
    expect(line.tagName).toBe("P");
    expect(line).toHaveAttribute("data-empty-line");
    expect(line.textContent).toBe("No scenes saved yet");
    expect(line.querySelector("[data-lamp]")).toBeNull();
    const css = cssOf("EmptyLine.module.css");
    expect(css).toMatch(
      /\.emptyLine \{[^}]*margin: 0;\s*font: var\(--font-weight-regular\) var\(--font-size-body\)[^}]*color: var\(--text-text3\);\s*white-space: nowrap/
    );
    expect(css).toMatch(/\.words \{[^}]*min-width: 0;\s*overflow: hidden;\s*text-overflow: ellipsis/);
    expect(rulesOf("EmptyLine.module.css")).not.toMatch(/border|background|box-shadow/);
  });

  it("sets the latch slot's hollow lamp before the words, with no text of its own", () => {
    render(
      <EmptyLine lamp testId="empty">
        Nothing on the prompter
      </EmptyLine>
    );
    const line = screen.getByTestId("empty");
    const lamp = line.querySelector("[data-lamp]");
    expect(lamp).toHaveAttribute("data-lamp", "off");
    expect(lamp).not.toHaveAttribute("data-lit");
    expect(lamp).toHaveAttribute("aria-hidden", "true");
    expect(line.firstElementChild).toBe(lamp);
    expect(line.textContent).toBe("Nothing on the prompter");
  });

  it("puts the explanation in the words' tooltip and one key at the end", () => {
    render(
      <EmptyLine
        tip="A group switches its fixtures together."
        action={<Key size="small">Add group</Key>}
        testId="empty"
      >
        No groups yet
      </EmptyLine>
    );
    const line = screen.getByTestId("empty");
    const words = screen.getByText("No groups yet");
    const trigger = words.closest("[aria-describedby]");
    expect(trigger).not.toBeNull();
    expect(document.getElementById(trigger!.getAttribute("aria-describedby")!)).toHaveTextContent(
      "A group switches its fixtures together."
    );
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    const key = screen.getByRole("button", { name: "Add group" });
    expect(line.lastElementChild).toContainElement(key);
  });
});

// The visual overhaul's polish (2026-10-05). Old: the Clear key read "Clear
// color tag", and with no tag chosen the focus started on the first swatch,
// which read as chosen. New: the words say "colour", as the menus do, and the
// focus starts on Clear colour, the current choice.
describe("ColorPicker", () => {
  const swatches = [
    { index: 0, name: "Clay", hex: "var(--tag-0)" },
    { index: 1, name: "Ochre", hex: "var(--tag-1)" },
    { index: 2, name: "Sand", hex: "var(--tag-2)" },
  ];

  it("says colour, and starts on Clear colour when no tag is chosen", () => {
    const { rerender } = render(
      <ColorPicker x={10} y={10} swatches={swatches} selectedIndex={null} onSelect={() => {}} onClose={() => {}} />
    );
    expect(screen.getByRole("group", { name: "Pick a colour" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Colour swatches" })).toBeInTheDocument();
    const clear = screen.getByRole("button", { name: "Clear colour" });
    expect(clear).toHaveAttribute("aria-pressed", "true");
    expect(clear).toHaveAttribute("data-autofocus");
    expect(screen.getByRole("button", { name: "Clay" })).not.toHaveAttribute("data-autofocus");
    rerender(
      <ColorPicker x={10} y={10} swatches={swatches} selectedIndex={2} onSelect={() => {}} onClose={() => {}} />
    );
    expect(screen.getByRole("button", { name: "Sand (current)" })).toHaveAttribute("data-autofocus");
    expect(screen.getByRole("button", { name: "Clear colour" })).not.toHaveAttribute("data-autofocus");
  });
});

describe("Drawer", () => {
  it("floats at level +3, moves focus in, closes on Escape and on its Close key", () => {
    const onClose = vi.fn();
    render(
      <Drawer open title="Fixture" onClose={onClose} testId="drawer">
        <p>body</p>
      </Drawer>
    );
    const drawer = screen.getByTestId("drawer");
    expect(drawer).toHaveAttribute("data-level", "float");
    expect(drawer).toHaveAttribute("role", "dialog");
    expect(drawer).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    // Atrium: the floating layer — the raised surface and the float shadow,
    // no backdrop blur, none of the retired plate or mono tokens.
    expect(cssOf("Drawer.module.css")).toMatch(
      /\.drawer \{[^}]*background: var\(--material-raise\);\s*box-shadow: var\(--elevation-float\)/
    );
    expect(rulesOf("Drawer.module.css")).not.toMatch(/backdrop-filter|--font-family-mono|--elevation-plate-fill/);
  });

  it("renders nothing when closed", () => {
    render(
      <Drawer open={false} title="Fixture" onClose={() => {}} testId="drawer">
        <p>body</p>
      </Drawer>
    );
    expect(screen.queryByTestId("drawer")).not.toBeInTheDocument();
  });
});
