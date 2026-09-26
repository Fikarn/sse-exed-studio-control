import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ArmKey, Key, Segmented } from "../Key";
import { Drawer } from "../Drawer";
import { LampWord, Latch } from "../LampWord";
import { Meter } from "../Meter";
import { ControlRow, Danger, Fields, PlateHead, Readouts, Section } from "../Plate";
import { Groove, Slider } from "../Slider";
import { StateDisplay } from "../StateDisplay";
import { Field, Readout, Screen, Well } from "../Well";
import { useArm } from "../useArm";

// Visual overhaul A, Slice 3: the primitives (plan S3 tests).

const cssOf = (name: string) =>
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", name), "utf8");

describe("StateDisplay", () => {
  it("is a fixed-height well region carrying the word, the sentence, the code and the way out", () => {
    render(
      <StateDisplay
        tone="error"
        word="OFFLINE"
        sentence="Audio may still pass, but the app cannot see or change the console right now."
        code="Console did not answer OSC ping · AUDIO_SYNC_FAILED"
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

  it("the tone word takes the display ink of its tone", () => {
    const css = cssOf("StateDisplay.module.css");
    expect(css).toMatch(/\.ok \.word \{\s*color: var\(--display-green\)/);
    expect(css).toMatch(/\.attention \.word \{\s*color: var\(--display-amber\)/);
    expect(css).toMatch(/\.error \.word \{\s*color: var\(--display-red\)/);
    expect(css).toMatch(/\.info \.word \{\s*color: var\(--display-blue\)/);
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
  it("renders every mode with its data attribute and the cap in mono uppercase", () => {
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
    expect(css).toMatch(/\.cap \{[^}]*font-family-mono[^}]*\}/);
    expect(css).toMatch(/\.cap \{[^}]*text-transform: uppercase/);
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
      <Key mode="momentary" cap="Talkback" live>
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
    expect(css).toMatch(/\.locked \{[^}]*opacity: 0\.55[^}]*border-style: dashed/);
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

  it("a segmented group is a well of keys with one lit choice", () => {
    render(
      <Segmented label="Mix target" testId="seg">
        <Key mode="segmented" cap="Main Out" engaged />
        <Key mode="segmented" cap="Phones 1" />
      </Segmented>
    );
    expect(screen.getByRole("group", { name: "Mix target" })).toHaveAttribute("data-well");
    expect(screen.getAllByRole("button").filter((b) => b.hasAttribute("data-lit"))).toHaveLength(1);
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
});

describe("Wells", () => {
  it("wells scope the display inks with data-well", () => {
    render(
      <Well>
        <span>display</span>
      </Well>
    );
    expect(screen.getByText("display").parentElement).toHaveAttribute("data-well");
  });

  it("a readout prints the value, marks doubt, and prints — when empty", () => {
    const { rerender } = render(<Readout value="-3.8 dB" testId="r" />);
    expect(screen.getByTestId("r")).toHaveTextContent("-3.8 dB");
    rerender(<Readout value="-3.8 dB" doubt testId="r" />);
    expect(screen.getByTestId("r")).toHaveAttribute("data-doubt");
    rerender(<Readout value="-3.8 dB" empty testId="r" />);
    expect(screen.getByTestId("r")).toHaveTextContent("—");
    expect(cssOf("Well.module.css")).toMatch(/\.doubt \{[^}]*border: 1px dashed var\(--display-amber\)/);
  });

  it("a field prints its label and value on a well", () => {
    render(<Field label="Stage X" value="2.9 m" testId="f" />);
    expect(screen.getByTestId("f")).toHaveAttribute("data-well");
    expect(screen.getByText("Stage X")).toBeInTheDocument();
    expect(screen.getByText("2.9 m")).toBeInTheDocument();
  });

  it("a screen is a well with an optional head and the blue keyline for preview", () => {
    render(
      <Screen head={<span>Stage plot</span>} info testId="screen">
        <svg />
      </Screen>
    );
    expect(screen.getByText("Stage plot")).toBeInTheDocument();
    expect(screen.getByTestId("screen").querySelector("[data-well]")).toBeInTheDocument();
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
  it("draws the ramp and the glow when live, and marks the ramp as signal", () => {
    const { container } = render(<Meter label="Host" level={0.6} peak={0.7} />);
    expect(container.querySelectorAll('[data-signal="meter"]')).toHaveLength(2);
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

  it("empty leaves the well with the reference only; stale drops the glow and dims", () => {
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
    expect(container.querySelectorAll('[data-signal="meter"]')).toHaveLength(4);
    expect(screen.getByRole("meter")).not.toHaveAttribute("data-clip");
    rerender(<Meter label="Main" level={0.5} levelRight={0.4} clip />);
    expect(screen.getByRole("meter")).toHaveAttribute("data-clip");
  });

  it("the ramp stops are the signal token: green to 70 %, yellow to 90 %, orange to 95 %, red above", () => {
    expect(cssOf("Meter.module.css")).toContain("var(--signal-ramp-v)");
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
