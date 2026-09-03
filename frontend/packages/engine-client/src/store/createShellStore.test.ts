import { describe, expect, it } from "vitest";

import { getFixtureScenario } from "@sse/test-fixtures";

import { createFixtureTransport } from "../transports/fixtureTransport";
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
