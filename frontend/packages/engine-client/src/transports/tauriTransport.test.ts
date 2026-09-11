import { beforeEach, describe, expect, it, vi } from "vitest";

// 2026-09 production readiness, Slice 3 (finding F02): an engine that refuses
// its database emits `engine.startupFailed` within milliseconds of starting.
// A Tauri event emitted before the webview listens is dropped, so the
// transport must hold the registered listener before it asks the shell to
// start the engine — otherwise the recovery surface shows a ready timeout
// instead of what the engine said.
//
// Slice 4 (finding F08): request ids were `${method}:${Date.now()}`, so two
// requests for one method inside the same millisecond shared one id — and one
// reply slot in the shell. The transport now numbers its requests and tags
// them with a per-instance session nonce.

const { calls, requestIds } = vi.hoisted(() => ({ calls: [] as string[], requestIds: [] as string[] }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string, args?: Record<string, unknown>) => {
    calls.push(`invoke:${command}`);
    if (command === "engine_start") {
      if (calls.includes("fail:engine_start")) {
        throw new Error("engine_start refused");
      }
      return { binary_path: "engine", generation: 3, pid: 4242, protocol: "1", running: true };
    }
    if (command === "engine_request") {
      const { request } = args as { request: { id: string; method: string } };
      requestIds.push(request.id);
      return { type: "response", id: request.id, ok: true, result: {} };
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
    requestIds.length = 0;
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

  // 2026-09 production readiness, Slice 5 (finding F09): the shell's launch
  // summary reaches the store, which keeps the launch number to tell a stale
  // `engine.exited` from a current one.
  it("resolves initialize with the launch the shell reported", async () => {
    const transport = createTauriTransport();

    await expect(transport.initialize?.()).resolves.toEqual({ generation: 3, pid: 4242 });
    // A second initialize on a live listener changes nothing and reports nothing.
    await expect(transport.initialize?.()).resolves.toBeUndefined();
    expect(calls.filter((call) => call === "invoke:engine_start")).toHaveLength(1);
  });

  it("ids unique within one millisecond", async () => {
    const transport = createTauriTransport();

    // Two hundred requests for one method, issued in the same tick — the
    // store's refresh fan-out in miniature. Nothing about the id depends on
    // the clock, so the same millisecond cannot produce the same id twice.
    await Promise.all(Array.from({ length: 200 }, () => transport.request("app.snapshot")));

    expect(requestIds).toHaveLength(200);
    expect(new Set(requestIds).size).toBe(200);
    for (const id of requestIds) {
      expect(id).toMatch(/^app\.snapshot:\d+:[a-z0-9]+$/);
    }
    // The sequence climbs by one per request; the nonce is constant within
    // one transport instance.
    expect(requestIds.map((id) => Number(id.split(":")[1]))).toEqual(
      Array.from({ length: 200 }, (_, index) => index + 1)
    );
    expect(new Set(requestIds.map((id) => id.split(":")[2])).size).toBe(1);
  });

  it("a second transport instance carries its own session nonce", async () => {
    const first = createTauriTransport();
    const second = createTauriTransport();

    await first.request("app.snapshot");
    await second.request("app.snapshot");

    const [firstId, secondId] = requestIds;
    // Both sequences start at 1; only the nonce keeps the two sessions apart.
    expect(firstId.split(":")[1]).toBe("1");
    expect(secondId.split(":")[1]).toBe("1");
    expect(firstId).not.toBe(secondId);
    expect(firstId.split(":")[2]).not.toBe(secondId.split(":")[2]);
  });
});
