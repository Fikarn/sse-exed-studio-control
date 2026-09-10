import { beforeEach, describe, expect, it, vi } from "vitest";

// 2026-09 production readiness, Slice 3 (finding F02): an engine that refuses
// its database emits `engine.startupFailed` within milliseconds of starting.
// A Tauri event emitted before the webview listens is dropped, so the
// transport must hold the registered listener before it asks the shell to
// start the engine — otherwise the recovery surface shows a ready timeout
// instead of what the engine said.

const { calls } = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string) => {
    calls.push(`invoke:${command}`);
    if (command === "engine_start" && calls.includes("fail:engine_start")) {
      throw new Error("engine_start refused");
    }
    return undefined;
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string) => {
    calls.push(`listen:${name}`);
    // The registration is an IPC round trip; it resolves on a later tick.
    await new Promise((resolve) => setTimeout(resolve, 0));
    calls.push(`listening:${name}`);
    return () => {
      calls.push(`unlisten:${name}`);
    };
  }),
}));

import { createTauriTransport } from "./tauriTransport";

describe("createTauriTransport", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("is listening for engine events before it starts the engine", async () => {
    const transport = createTauriTransport();

    await transport.initialize?.();

    const listening = calls.indexOf("listening:engine://event");
    const started = calls.indexOf("invoke:engine_start");
    expect(listening).toBeGreaterThanOrEqual(0);
    expect(started).toBeGreaterThanOrEqual(0);
    expect(listening).toBeLessThan(started);
  });

  it("releases the listener when the shell refuses to start the engine", async () => {
    calls.push("fail:engine_start");
    const transport = createTauriTransport();

    await expect(transport.initialize?.()).rejects.toThrow("engine_start refused");
    expect(calls).toContain("unlisten:engine://event");

    // A second initialize registers again instead of assuming the first stuck.
    calls.length = 0;
    await transport.initialize?.();
    expect(calls).toContain("listening:engine://event");
    expect(calls).toContain("invoke:engine_start");
  });
});
