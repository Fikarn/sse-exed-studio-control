import { afterEach, describe, expect, it, vi } from "vitest";

import { createAudioControlDraftStore } from "./audioControlDraftStore";

describe("audio control draft store", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps notifying the other listeners when one throws, and warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const store = createAudioControlDraftStore();
    try {
      let secondListenerRan = false;
      store.subscribe("fader:a", () => {
        throw new Error("boom from the first listener");
      });
      store.subscribe("fader:a", () => {
        secondListenerRan = true;
      });

      store.set("fader:a", 0.42);

      expect(secondListenerRan).toBe(true);
      expect(warn.mock.calls.some((call) => String(call[0]).includes("draft listener threw"))).toBe(true);
    } finally {
      store.dispose();
    }
  });
});
