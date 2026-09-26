import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OperatorLayoutProvider } from "./OperatorLayoutProvider";

// New pages program, Slice 3 (D6, decision 1): Studio Preview leaves the
// operator's screens. Only the address opens it; a choice an older build
// remembered no longer does, because nothing on screen could leave it.

const RETIRED_KEY = "app.operator.reviewSurface";

class NoResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function reviewSurface() {
  return document.querySelector("[data-operator-review-viewport]")?.getAttribute("data-review-surface");
}

beforeEach(() => {
  // jsdom has neither; the provider measures with both.
  vi.stubGlobal("ResizeObserver", NoResizeObserver);
  vi.stubGlobal("matchMedia", () => ({ addEventListener() {}, removeEventListener() {} }));
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("Studio Preview", () => {
  it("does not open from a remembered choice, and forgets it", () => {
    window.localStorage.setItem(RETIRED_KEY, "studioPreview");
    render(
      <OperatorLayoutProvider>
        <p>shell</p>
      </OperatorLayoutProvider>
    );
    expect(reviewSurface()).toBe("native");
    expect(screen.queryByText(/Studio Preview/)).toBeNull();
    expect(window.localStorage.getItem(RETIRED_KEY)).toBeNull();
  });

  it("opens from the address, and is not remembered", () => {
    window.history.replaceState(null, "", "/?operatorReview=studio");
    render(
      <OperatorLayoutProvider>
        <p>shell</p>
      </OperatorLayoutProvider>
    );
    expect(reviewSurface()).toBe("studioPreview");
    expect(screen.getByText(/Studio Preview — 2560 × 1440 at/)).toBeTruthy();
    expect(window.localStorage.getItem(RETIRED_KEY)).toBeNull();
  });
});
