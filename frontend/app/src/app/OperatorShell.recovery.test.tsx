import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createShellStore, type EngineTransport, type EventEnvelope, type EventName } from "@sse/engine-client";
import { createFixtureTransport } from "@sse/engine-client/fixture";
import { getFixtureScenario } from "@sse/test-fixtures";

import { OperatorShell } from "./OperatorShell";

// 2026-09-28: one recovery screen. Until then the screen with Export
// diagnostics and the restore keys was drawn only when Setup was the open
// page; a stop during a session, with the Console or Lighting open, drew a
// smaller one that had neither.

/**
 * The test double with a hardware link that can stop: the first start is the
 * double's own, `stop()` reports the process gone as the shell does, and the
 * restart the store then asks for never answers, so the screen stays.
 */
function transportThatCanStop(fixtureId: string) {
  const double = createFixtureTransport(getFixtureScenario(fixtureId));
  const listeners = new Set<Parameters<EngineTransport["subscribe"]>[0]>();
  let launches = 0;
  const transport: EngineTransport = {
    initialize: async () => {
      launches += 1;
      if (launches > 1) {
        await new Promise<never>(() => {});
      }
      await double.initialize?.();
      return { generation: 1, pid: 4242 };
    },
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
  const stop = () => {
    const event: EventEnvelope<EventName> = {
      type: "event",
      event: "engine.exited",
      payload: { generation: 1, graceful: false, pid: 4242, status: 1 },
    };
    for (const listener of [...listeners]) listener(event);
  };
  return { stop, transport };
}

describe("the recovery screen is one screen", () => {
  afterEach(() => {
    cleanup();
  });

  it("a stop while the Console is open shows Export diagnostics and the restore keys", async () => {
    const { stop, transport } = transportThatCanStop("audio-populated");
    const store = createShellStore(transport);

    // The shell starts the hardware link itself, as it does in the app.
    render(
      <OperatorShell
        environment={{ crashWorkspace: null, fixtureId: "audio-populated", liveTransportRequested: false, store }}
      />
    );
    await waitFor(() => expect(store.getSnapshot().lifecycle).toBe("ready"));
    expect(store.getSnapshot().activeWorkspace).toBe("audio");

    act(() => stop());
    expect(store.getSnapshot().recovery).toBe("recovery");
    expect(store.getSnapshot().activeWorkspace).toBe("audio");

    const surface = await screen.findByTestId("setup-recovery-surface");
    expect(screen.getByTestId("setup-recovery-surface-state-display").textContent).toContain("ENGINE_EXITED");
    const keys = within(surface)
      .getAllByRole("button")
      .map((key) => key.textContent);
    for (const key of ["Retry startup", "Reset the window layout", "Export diagnostics", "Restore latest"]) {
      expect(keys, key).toContain(key);
    }
    expect(screen.queryByTestId("recovery-surface")).toBeNull();

    await store.dispose();
  });
});
