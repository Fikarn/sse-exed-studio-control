import { describe, expect, it } from "vitest";

import { getFixtureScenario } from "@sse/test-fixtures";

import { createFixtureTransport } from "../transports/fixtureTransport";
import type { EventEnvelope, EventName } from "../generated/protocol";
import type { EngineTransport } from "../types";
import { createShellStore } from "./createShellStore";

function recordingTransport(inner: EngineTransport, log: string[]): EngineTransport {
  return {
    initialize: () => inner.initialize?.() ?? Promise.resolve(),
    request: (method, params) => {
      log.push(method);
      return inner.request(method, params);
    },
    subscribe: (listener) => inner.subscribe(listener),
    dispose: () => inner.dispose?.() ?? Promise.resolve(),
  };
}

// 2026-09 audit remediation, Slice 3: a sync is a console pull that rewrites
// channel and mix-target state engine-side. The store used to paint
// "aligned / manual sync" from its own patch without asking the engine what
// it had pulled; now the only source of truth after a sync is a fresh
// `audio.snapshot`.
describe("createShellStore audio sync", () => {
  it("refetches audio.snapshot after audio.sync instead of patching locally", async () => {
    const log: string[] = [];
    const transport = recordingTransport(createFixtureTransport(getFixtureScenario("audio-populated")), log);
    const store = createShellStore(transport);
    await store.initialize();
    expect(store.getSnapshot().lifecycle).toBe("ready");

    // Console writes (sync included) need a passed audio probe.
    await store.runCommissioningCheck({
      target: "audio",
      sendHost: "127.0.0.1",
      sendPort: 7001,
      receivePort: 9001,
    });
    log.length = 0;

    const result = (await store.syncAudio()) as Record<string, unknown>;
    expect(result.synced).toBe(true);
    expect(result.complete).toBe(true);
    expect(typeof result.pulledValues).toBe("number");

    const syncIndex = log.indexOf("audio.sync");
    expect(syncIndex).toBeGreaterThanOrEqual(0);
    expect(log.slice(syncIndex + 1)).toContain("audio.snapshot");

    const audio = store.getSnapshot().audioSnapshot;
    expect(audio?.consoleStateConfidence).toBe("aligned");
    expect(audio?.lastConsoleSyncReason).toBe("console-pull");
    expect(audio?.lastActionMessage?.startsWith("Pulled ")).toBe(true);
    expect(audio?.consoleLink.lastPullValues).toBe(result.pulledValues);
  });
});

// 2026-09 production readiness, Slice 3 (finding F02): an engine that refuses
// its database reports `engine.startupFailed` while `engine_start` is still
// returning — before the ready gate exists. The store keeps that failure as
// the answer instead of waiting ten seconds and replacing it with
// ENGINE_READY_TIMEOUT.
describe("createShellStore startup failure before the ready gate", () => {
  it("keeps the engine-reported failure instead of a ready timeout", async () => {
    const listeners = new Set<Parameters<EngineTransport["subscribe"]>[0]>();
    const startupFailed: EventEnvelope<EventName> = {
      type: "event",
      event: "engine.startupFailed",
      payload: {
        stage: "bootstrap",
        code: "STORAGE_CORRUPT",
        message: "The saved data file failed its integrity check. Restore a backup from Setup / Support.",
      },
    };
    const transport: EngineTransport = {
      initialize: async () => {
        for (const listener of listeners) {
          listener(startupFailed);
        }
      },
      request: () => Promise.reject(new Error("Engine is not running")),
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      dispose: () => Promise.resolve(),
    };

    const store = createShellStore(transport);
    const startedAt = Date.now();
    await store.initialize();

    const snapshot = store.getSnapshot();
    expect(snapshot.lifecycle).toBe("failed");
    expect(snapshot.startupFailure?.code).toBe("STORAGE_CORRUPT");
    expect(snapshot.startupFailure?.stage).toBe("bootstrap");
    expect(snapshot.errorSummary).toContain("Restore a backup");
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });
});
