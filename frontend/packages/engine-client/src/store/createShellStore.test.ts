import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

// 2026-09 production readiness, Slice 5 (finding F09): the shell reports an
// engine process that is gone as `engine.exited`. The store shows the
// recovery surface with ENGINE_EXITED and restarts the engine on its own —
// one, two and four seconds after the first three stops within five
// minutes — then leaves the fourth stop to the operator. A report about a
// process this bootstrap already replaced, a stop the shell asked for, and
// the exit that follows a start-up failure the engine reported are ignored.
function supervisedTransport() {
  const listeners = new Set<Parameters<EngineTransport["subscribe"]>[0]>();
  const refusing = new Set<string>();
  const calls: string[] = [];
  let launches = 0;
  const transport: EngineTransport = {
    initialize: async () => {
      launches += 1;
      calls.push(`initialize:${launches}`);
      return { generation: launches, pid: 1000 + launches };
    },
    request: async (method) => {
      if (refusing.has(method)) {
        throw new Error(`${method} refused`);
      }
      // No console in this double: the audio snapshot is absent, every other
      // answer is the smallest object the store accepts (the ping's protocol).
      return method === "audio.snapshot" ? null : { protocol: "1" };
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: async () => {
      calls.push("dispose");
    },
  };
  return {
    calls,
    emit: (event: EventEnvelope<EventName>) => {
      for (const listener of [...listeners]) {
        listener(event);
      }
    },
    launches: () => launches,
    refuse: (method: string) => refusing.add(method),
    transport,
  };
}

function exited(generation: number, extra: Record<string, boolean | number> = {}): EventEnvelope<EventName> {
  return {
    type: "event",
    event: "engine.exited",
    payload: { generation, graceful: false, pid: 1000 + generation, status: 1, ...extra },
  };
}

async function settle(until: () => boolean) {
  for (let turn = 0; turn < 50 && !until(); turn += 1) {
    await vi.advanceTimersByTimeAsync(0);
  }
}

describe("createShellStore engine supervision", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("engine.exited → recovery + bounded restart", async () => {
    const { calls, emit, launches, transport } = supervisedTransport();
    const store = createShellStore(transport);
    await store.initialize();
    expect(store.getSnapshot().startupFailure).toBeNull();
    expect(store.getSnapshot().errorSummary).toBeNull();
    expect(store.getSnapshot().lifecycle).toBe("ready");
    expect(launches()).toBe(1);

    emit(exited(1));
    let snapshot = store.getSnapshot();
    expect(snapshot.lifecycle).toBe("failed");
    expect(snapshot.recovery).toBe("recovery");
    expect(snapshot.startupFailure).toMatchObject({ code: "ENGINE_EXITED", stage: "runtime" });
    expect(snapshot.startupFailure?.message).toContain("exit status 1");
    expect(snapshot.startupFailure?.message).toContain("restarts it on its own in 1 s (attempt 1 of 3)");
    expect(snapshot.errorSummary).toBe(snapshot.startupFailure?.message);

    await vi.advanceTimersByTimeAsync(999);
    expect(launches()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await settle(() => store.getSnapshot().lifecycle === "ready");
    expect(launches()).toBe(2);
    expect(calls.filter((call) => call === "dispose")).toHaveLength(1);
    expect(store.getSnapshot().startupFailure).toBeNull();

    emit(exited(2));
    expect(store.getSnapshot().startupFailure?.message).toContain("in 2 s (attempt 2 of 3)");
    await vi.advanceTimersByTimeAsync(2_000);
    await settle(() => store.getSnapshot().lifecycle === "ready");
    expect(launches()).toBe(3);

    emit(exited(3));
    expect(store.getSnapshot().startupFailure?.message).toContain("in 4 s (attempt 3 of 3)");
    await vi.advanceTimersByTimeAsync(4_000);
    await settle(() => store.getSnapshot().lifecycle === "ready");
    expect(launches()).toBe(4);

    // The fourth stop inside five minutes stays with the operator.
    emit(exited(4));
    snapshot = store.getSnapshot();
    expect(snapshot.lifecycle).toBe("failed");
    expect(snapshot.startupFailure?.message).toContain("not restarted again on its own");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(launches()).toBe(4);
    expect(store.getSnapshot().lifecycle).toBe("failed");

    // Retry startup still works by hand.
    await store.restart();
    expect(launches()).toBe(5);
    expect(store.getSnapshot().lifecycle).toBe("ready");
    await store.dispose();
  });

  it("stale generation ignored", async () => {
    const { emit, launches, transport } = supervisedTransport();
    const store = createShellStore(transport);
    await store.initialize();

    // A report about the process this shell already replaced.
    emit(exited(0));
    expect(store.getSnapshot().lifecycle).toBe("ready");
    // A stop the shell asked for.
    emit(exited(1, { graceful: true }));
    expect(store.getSnapshot().lifecycle).toBe("ready");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(launches()).toBe(1);
    expect(store.getSnapshot().startupFailure).toBeNull();

    // The exit that follows a start-up failure the engine reported says
    // nothing new, and an engine that would only refuse again is not
    // restarted on its own.
    emit({
      type: "event",
      event: "engine.startupFailed",
      payload: {
        code: "ENGINE_ALREADY_RUNNING",
        message: "Studio Control is already open on this workstation.",
        stage: "bootstrap",
      },
    });
    emit(exited(1));
    expect(store.getSnapshot().startupFailure?.code).toBe("ENGINE_ALREADY_RUNNING");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(launches()).toBe(1);
    await store.dispose();
  });

  it("keeps the last twenty background failures without leaving ready", async () => {
    const { emit, refuse, transport } = supervisedTransport();
    const store = createShellStore(transport);
    await store.initialize();

    refuse("lighting.snapshot");
    emit({ type: "event", event: "lighting.changed", payload: {} });
    await settle(() => store.getSnapshot().backgroundFailures.length > 0);
    const [failure] = store.getSnapshot().backgroundFailures;
    expect(failure).toMatchObject({ context: "refresh after lighting.changed", message: "lighting.snapshot refused" });
    expect(typeof failure?.at).toBe("string");
    expect(store.getSnapshot().lifecycle).toBe("ready");

    for (let index = 0; index < 25; index += 1) {
      store.reportBackgroundFailure(new Error(`failure ${index}`), "test");
    }
    const kept = store.getSnapshot().backgroundFailures;
    expect(kept).toHaveLength(20);
    expect(kept[0]?.message).toBe("failure 5");
    expect(kept[kept.length - 1]?.message).toBe("failure 24");
    await store.dispose();
  });
});
