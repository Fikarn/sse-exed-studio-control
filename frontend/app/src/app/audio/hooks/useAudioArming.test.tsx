import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUDIO_ARM_MIN_DWELL_MS, AUDIO_ARM_TIMEOUT_MS } from "../audioConstants";
import { useAudioArming } from "./useAudioArming";

// 2026-09 audit remediation, Slice 7: arm-then-apply needs a minimum dwell.
// Before this the second activation applied no matter how soon it came, so a
// double-click on 48V or a bounced key press armed and applied in one go.

const candidate = {
  key: "phantom:audio-input-9:true",
  label: "Enable 48V on Host",
  targetId: "audio-input-9",
  targetKind: "phantom" as const,
  timeoutMs: AUDIO_ARM_TIMEOUT_MS,
};

function setup() {
  let now = 1_000;
  const setFeedback = vi.fn();
  const apply = vi.fn();
  const hook = renderHook(() => useAudioArming({ now: () => now, resetTriggers: {}, setFeedback }));
  return {
    advance(ms: number) {
      now += ms;
      act(() => {
        vi.advanceTimersByTime(ms);
      });
    },
    apply,
    hook,
    setFeedback,
    trigger() {
      act(() => hook.result.current.armOrApplyAction(candidate, apply));
    },
  };
}

describe("useAudioArming dwell", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("ignores a second activation inside the dwell and applies one after it", () => {
    const { advance, apply, hook, setFeedback, trigger } = setup();

    trigger();
    expect(hook.result.current.armedAction?.key).toBe(candidate.key);
    expect(apply).not.toHaveBeenCalled();
    expect(setFeedback).toHaveBeenCalledTimes(1);
    expect(setFeedback.mock.calls[0][0]?.message).toMatch(/^Armed: Enable 48V on Host/);

    // A double-click: the same key again, well inside the dwell.
    advance(AUDIO_ARM_MIN_DWELL_MS - 50);
    trigger();
    expect(apply).not.toHaveBeenCalled();
    expect(hook.result.current.armedAction?.key).toBe(candidate.key);
    expect(setFeedback).toHaveBeenCalledTimes(1);

    // Past the dwell the same activation is the confirm.
    advance(100);
    trigger();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(hook.result.current.armedAction).toBeNull();
  });

  it("still lets a different key re-arm immediately and still expires on the timeout", () => {
    const { advance, apply, hook, trigger } = setup();
    trigger();
    act(() =>
      hook.result.current.armOrApplyAction(
        { ...candidate, key: "snapshot-recall:one", label: "Recall one", targetKind: "snapshot-recall" },
        apply
      )
    );
    expect(hook.result.current.armedAction?.key).toBe("snapshot-recall:one");
    expect(apply).not.toHaveBeenCalled();

    advance(AUDIO_ARM_TIMEOUT_MS + 10);
    expect(hook.result.current.armedAction).toBeNull();

    // After expiry the original key arms again instead of applying.
    trigger();
    expect(apply).not.toHaveBeenCalled();
    expect(hook.result.current.armedAction?.key).toBe(candidate.key);
  });

  it("pins the dwell inside the arm window", () => {
    expect(AUDIO_ARM_MIN_DWELL_MS).toBe(350);
    expect(AUDIO_ARM_MIN_DWELL_MS).toBeLessThan(AUDIO_ARM_TIMEOUT_MS);
  });
});

// New pages program, Slice 3 (D6): Esc still cancels an armed action. It used
// to be one branch of the Console's page-wide key handler, which went with the
// keyboard shortcuts; the arm hook listens for it now, and only while armed.
describe("useAudioArming Esc", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function pressEscape(init: KeyboardEventInit = {}) {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape", ...init });
    act(() => {
      window.dispatchEvent(event);
    });
    return event;
  }

  it("cancels an armed action and says so", () => {
    const { apply, hook, setFeedback, trigger } = setup();
    trigger();
    expect(hook.result.current.armedAction?.key).toBe(candidate.key);

    const escape = pressEscape();
    expect(hook.result.current.armedAction).toBeNull();
    expect(escape.defaultPrevented).toBe(true);
    expect(setFeedback).toHaveBeenLastCalledWith({ message: "Armed audio action canceled.", tone: "info" });
    expect(apply).not.toHaveBeenCalled();
  });

  it("binds nothing while nothing is armed", () => {
    const { setFeedback } = setup();
    const escape = pressEscape();
    expect(escape.defaultPrevented).toBe(false);
    expect(setFeedback).not.toHaveBeenCalled();
  });

  it("leaves the arm alone when a dialog already took the Esc", () => {
    const { hook, setFeedback, trigger } = setup();
    trigger();
    const dialogEscape = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" });
    dialogEscape.preventDefault();
    act(() => {
      window.dispatchEvent(dialogEscape);
    });
    expect(hook.result.current.armedAction?.key).toBe(candidate.key);
    expect(setFeedback).toHaveBeenCalledTimes(1);
  });
});

// New pages program, Slice 3, on review: Enter presses the focused key again on
// every auto-repeat of a held Enter, and the repeats run on past the dwell, so
// a held Enter on a focused arm key armed it and then applied it. While
// something is armed the hook cancels a repeated Enter's keydown, and in the
// browser a cancelled keydown presses nothing (audio-arm-countdown.spec.ts
// holds Enter on the real keys).
describe("useAudioArming held Enter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function pressEnter(init: KeyboardEventInit = {}) {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter", ...init });
    act(() => {
      window.dispatchEvent(event);
    });
    return event;
  }

  it("cancels a held Enter's repeats while armed, and leaves a fresh Enter to press the key", () => {
    const { advance, apply, hook, setFeedback, trigger } = setup();
    trigger();
    advance(AUDIO_ARM_MIN_DWELL_MS + 50);

    expect(pressEnter({ repeat: true }).defaultPrevented).toBe(true);
    expect(pressEnter({ repeat: true }).defaultPrevented).toBe(true);
    expect(pressEnter().defaultPrevented).toBe(false);
    // Neither applies nor cancels the arm by itself.
    expect(hook.result.current.armedAction?.key).toBe(candidate.key);
    expect(apply).not.toHaveBeenCalled();
    expect(setFeedback).toHaveBeenCalledTimes(1);
  });

  it("binds nothing while nothing is armed, before the arm and after its apply", () => {
    const { advance, apply, hook, trigger } = setup();
    expect(pressEnter({ repeat: true }).defaultPrevented).toBe(false);

    trigger();
    advance(AUDIO_ARM_MIN_DWELL_MS + 50);
    trigger();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(hook.result.current.armedAction).toBeNull();
    expect(pressEnter({ repeat: true }).defaultPrevented).toBe(false);
  });
});
