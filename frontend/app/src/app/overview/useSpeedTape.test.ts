import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PrompterGlassSummary } from "@sse/engine-client";

import { TURNED_MS, useSpeedTape, type SpeedTapeTake } from "./useSpeedTape";

// The speed tape's words (overview-2.md §3): the deck's turn told from the
// page's own presses, and the range of this take, which a take keeps while
// CAM 1 drops for a moment (the review of the page).

const glass = (speedWpm: number, scriptId = "script-2") => ({ scriptId, speedWpm }) as PrompterGlassSummary;
const take = (recording: boolean, startedAt: string | null = null): SpeedTapeTake => ({ recording, startedAt });

describe("useSpeedTape", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-09T10:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("says the deck turned the pace for a moment, and never after the page's own press", () => {
    const { result, rerender } = renderHook(({ g, t }) => useSpeedTape(g, t), {
      initialProps: { g: glass(140), t: take(false) },
    });
    expect(result.current.view).toMatchObject({ turned: false, caption: "this script's own pace" });

    rerender({ g: glass(145), t: take(false) });
    expect(result.current.view).toMatchObject({ turned: true, caption: "turned on the deck" });
    act(() => {
      vi.advanceTimersByTime(TURNED_MS + 10);
    });
    expect(result.current.view.turned).toBe(false);

    act(() => result.current.ownChange());
    rerender({ g: glass(150), t: take(false) });
    expect(result.current.view.turned).toBe(false);
  });

  it("keeps this take's range while CAM 1 drops for a moment, and starts it again with a new take", () => {
    const first = "2026-10-09T09:55:00Z";
    const { result, rerender } = renderHook(({ g, t }) => useSpeedTape(g, t), {
      initialProps: { g: glass(140), t: take(true, first) },
    });
    // The page's own + 5, twice.
    act(() => result.current.ownChange());
    rerender({ g: glass(150), t: take(true, first) });
    expect(result.current.view.range).toEqual([140, 150]);

    // CAM 1 stops answering: the take is last known, and its start unknown when it answers again.
    rerender({ g: glass(150), t: take(true, null) });
    expect(result.current.view.range).toEqual([140, 150]);
    expect(result.current.view.caption).toBe("this take 140 to 150");

    // A new take begins: its range is its own.
    rerender({ g: glass(150), t: take(true, "2026-10-09T10:05:00Z") });
    expect(result.current.view.range).toBeNull();
    expect(result.current.view.caption).toBe("this take at 150");
  });

  it("starts the range again with a new script", () => {
    const { result, rerender } = renderHook(({ g, t }) => useSpeedTape(g, t), {
      initialProps: { g: glass(140), t: take(true, "2026-10-09T09:55:00Z") },
    });
    rerender({ g: glass(160), t: take(true, "2026-10-09T09:55:00Z") });
    expect(result.current.view.range).toEqual([140, 160]);
    rerender({ g: glass(120, "script-3"), t: take(true, "2026-10-09T09:55:00Z") });
    expect(result.current.view.range).toBeNull();
  });
});
