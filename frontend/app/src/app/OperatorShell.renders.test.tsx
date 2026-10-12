import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createShellStore,
  type EngineTransport,
  type EventEnvelope,
  type EventName,
  type JsonObject,
} from "@sse/engine-client";
import { createFixtureTransport } from "@sse/engine-client/fixture";
import { getFixtureScenario } from "@sse/test-fixtures";

import { OperatorShell } from "./OperatorShell";

// The shell renders at every store change, since it is the store's one
// subscriber; a page is drawn again only when something of its own changed
// (the page roots are memoised, the audit of 2026-10-12). The count is the
// page tests' (`__SSE_TEST_RENDER_COUNTS__`, `shared/renderCounts.ts`).

/** The test double, with a way to raise an event as the hardware link would. */
function transportWithEvents(fixtureId: string) {
  const double = createFixtureTransport(getFixtureScenario(fixtureId));
  const listeners = new Set<Parameters<EngineTransport["subscribe"]>[0]>();
  const transport: EngineTransport = {
    initialize: () => (double.initialize ? double.initialize() : Promise.resolve()),
    request: (method, params) => double.request(method, params),
    subscribe: (listener) => {
      listeners.add(listener);
      const release = double.subscribe(listener);
      return () => {
        listeners.delete(listener);
        release();
      };
    },
    dispose: async () => {},
  };
  const emit = (event: EventName, payload: JsonObject) => {
    const envelope: EventEnvelope<EventName> = { type: "event", event, payload };
    for (const listener of [...listeners]) listener(envelope);
  };
  return { emit, transport };
}

const settled = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 60)));

/**
 * The page settles its own state over its first second (the plot's framing,
 * the undo memory): the count once it has stopped moving for two settles in
 * a row.
 */
async function quietCount(read: () => number): Promise<number> {
  let last = read();
  for (let attempt = 0; attempt < 40; attempt++) {
    await settled();
    const now = read();
    if (now === last) {
      await settled();
      if (read() === now) return now;
    }
    last = read();
  }
  throw new Error(`the page never stopped rendering on its own (${read()} renders)`);
}

describe("a page is drawn again only for a change of its own", () => {
  // jsdom measures nothing and has no media queries: the plot and the layout
  // provider ask for both.
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    vi.stubGlobal("matchMedia", (media: string) => ({
      matches: false,
      media,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    delete window.__SSE_TEST_RENDER_COUNTS__;
  });

  it("a change of the cameras renders the shell and leaves the Lighting page alone", async () => {
    const counts: NonNullable<Window["__SSE_TEST_RENDER_COUNTS__"]> = {};
    window.__SSE_TEST_RENDER_COUNTS__ = counts;
    const lightingRenders = () => counts.lightingWorkspace ?? 0;
    const { emit, transport } = transportWithEvents("lighting-populated");
    const store = createShellStore(transport);

    render(
      <OperatorShell
        environment={{
          crashWorkspace: null,
          fixtureId: "lighting-populated",
          liveTransportRequested: false,
          pictures: null,
          store,
        }}
      />
    );
    await waitFor(() => expect(store.getSnapshot().lifecycle).toBe("ready"));
    if (store.getSnapshot().activeWorkspace !== "lighting") {
      await act(() => store.setWorkspace("lighting"));
    }
    // The page's chunk is fetched and the rig is read before the plot stands.
    await screen.findByTestId("lighting-stage", {}, { timeout: 15_000 });
    const before = await quietCount(lightingRenders);
    expect(before).toBeGreaterThan(0);

    // The cameras change: the store reads them again, the shell renders with
    // the new cameras, and the Lighting page is not drawn again.
    const camerasBefore = store.getSnapshot().camerasSnapshot;
    act(() => emit("cameras.changed", { reason: "state", camera: null }));
    await waitFor(() => expect(store.getSnapshot().camerasSnapshot).not.toBe(camerasBefore));
    await settled();
    await settled();
    expect(lightingRenders()).toBe(before);

    // The rig changes: the page is drawn again.
    act(() => emit("lighting.changed", { reason: "fixture" }));
    await waitFor(() => expect(lightingRenders()).toBeGreaterThan(before), { timeout: 5_000 });

    await store.dispose();
  }, 30_000);
});
