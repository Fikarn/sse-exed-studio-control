import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUDIO_TALKBACK_HEARTBEAT_MS, useMomentaryTalkback } from "./useMomentaryTalkback";

// 2026-09 audit remediation, Slice 6: talkback is a hold, never a latch. The
// only talkback coverage before this was a Playwright assertion that the
// button exists with an aria-pressed attribute.
// New pages program, Slice 3 (D7): the page-wide T hold key went, and with it
// the case that held T; the disabled case no longer presses T.

describe("useMomentaryTalkback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("engages once, heartbeats while held, and releases exactly once", () => {
    const hold = vi.fn();
    const { result } = renderHook(() => useMomentaryTalkback({ enabled: true, hold }));

    act(() => result.current.engage());
    expect(hold).toHaveBeenCalledTimes(1);
    expect(hold).toHaveBeenLastCalledWith(true);
    expect(result.current.holding).toBe(true);

    // A second engage while holding is ignored (pointer + key at once).
    act(() => result.current.engage());
    expect(hold).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(AUDIO_TALKBACK_HEARTBEAT_MS * 2 + 10);
    });
    expect(hold.mock.calls.filter(([engaged]) => engaged === true)).toHaveLength(3);

    act(() => result.current.release());
    expect(hold).toHaveBeenLastCalledWith(false);
    expect(result.current.holding).toBe(false);
    const callsAfterRelease = hold.mock.calls.length;

    // No heartbeat after release, and releasing when idle sends nothing.
    act(() => {
      vi.advanceTimersByTime(AUDIO_TALKBACK_HEARTBEAT_MS * 4);
      result.current.release();
    });
    expect(hold).toHaveBeenCalledTimes(callsAfterRelease);
  });

  it("releases on window blur, on a hidden document and on unmount", () => {
    const hold = vi.fn();
    const { result, unmount } = renderHook(() => useMomentaryTalkback({ enabled: true, hold }));

    act(() => result.current.engage());
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(hold).toHaveBeenLastCalledWith(false);
    expect(result.current.holding).toBe(false);

    act(() => result.current.engage());
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    visibility.mockRestore();
    expect(hold).toHaveBeenLastCalledWith(false);

    act(() => result.current.engage());
    expect(hold).toHaveBeenLastCalledWith(true);
    unmount();
    expect(hold).toHaveBeenLastCalledWith(false);
    expect(hold.mock.calls.filter(([engaged]) => engaged === false)).toHaveLength(3);
  });

  it("never engages while disabled and releases when the gate closes mid-hold", () => {
    const hold = vi.fn();
    const { result, rerender } = renderHook(({ enabled }) => useMomentaryTalkback({ enabled, hold }), {
      initialProps: { enabled: false },
    });

    act(() => result.current.engage());
    expect(hold).not.toHaveBeenCalled();

    rerender({ enabled: true });
    act(() => result.current.engage());
    expect(hold).toHaveBeenLastCalledWith(true);

    rerender({ enabled: false });
    expect(hold).toHaveBeenLastCalledWith(false);
    expect(result.current.holding).toBe(false);
  });
});
