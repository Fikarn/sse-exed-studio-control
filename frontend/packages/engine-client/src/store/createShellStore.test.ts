import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getFixtureScenario } from "@sse/test-fixtures";

import { createFixtureTransport } from "../transports/fixtureTransport";
import type { EventEnvelope, EventName, JsonValue } from "../generated/protocol";
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
const TYPED_SNAPSHOT_REQUESTS = new Set([
  "audio.snapshot",
  "lighting.snapshot",
  "lighting.fixtureCatalog.snapshot",
  "lighting.dmxMonitor.snapshot",
  "planning.snapshot",
]);

function supervisedTransport() {
  const listeners = new Set<Parameters<EngineTransport["subscribe"]>[0]>();
  const refusing = new Set<string>();
  const answers = new Map<string, JsonValue>();
  const gates = new Map<string, Promise<void>>();
  const stalled = new Set<string>();
  const calls: string[] = [];
  let launches = 0;
  const transport: EngineTransport = {
    initialize: async () => {
      launches += 1;
      calls.push(`initialize:${launches}`);
      return { generation: launches, pid: 1000 + launches };
    },
    request: async (method) => {
      calls.push(`request:${method}`);
      await gates.get(method);
      if (stalled.delete(method)) {
        await new Promise<never>(() => {});
      }
      if (refusing.has(method)) {
        throw new Error(`${method} refused`);
      }
      if (answers.has(method)) {
        return answers.get(method) ?? null;
      }
      // No console, rig or plan in this double: the typed snapshots are absent
      // (`null`, which the Slice 9 guards accept as "nothing there yet" — an
      // object without its lists is refused), and every other answer is the
      // smallest object the store accepts (the ping's protocol).
      return TYPED_SNAPSHOT_REQUESTS.has(method) ? null : { protocol: "1" };
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
    answer: (method: string, value: JsonValue) => answers.set(method, value),
    /** Keeps every `method` request unanswered until the returned function is called. */
    hold: (method: string) => {
      let release = () => {};
      gates.set(
        method,
        new Promise<void>((resolve) => {
          release = resolve;
        })
      );
      return () => {
        gates.delete(method);
        release();
      };
    },
    /** The next `method` request never settles; the ones after it answer as usual. */
    stall: (method: string) => stalled.add(method),
    /** The snapshot requests sent since `calls` was last cleared, sorted. */
    snapshotRequests: () =>
      calls
        .filter((call) => call.startsWith("request:") && call.endsWith(".snapshot"))
        .map((call) => call.slice("request:".length))
        .sort(),
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

  // 2026-09 production readiness, Slice 7 (F20): a database backup answers
  // `requiresRestart`; the store restarts the link once, through the same
  // path as Retry startup, and the graceful stop that restart causes is not
  // a failure — the automatic-restart budget is untouched afterwards.
  it("restore with requiresRestart restarts the link once and spends no restart budget", async () => {
    const { answer, calls, emit, launches, transport } = supervisedTransport();
    const store = createShellStore(transport);
    await store.initialize();
    answer("support.backup.restore", { requiresRestart: true, sourceFormat: "database-backup" });

    const restore = store.restoreSupportBackup("C:/app-data/backups/db-2026-09-11T10-00-00-000Z-shutdown.sqlite3");
    await settle(() => launches() === 2);
    // The stop the restart asked for: the shell reports it as graceful.
    emit(exited(1, { graceful: true }));
    const result = await restore;
    expect(result).toMatchObject({ requiresRestart: true });
    expect(launches()).toBe(2);
    expect(calls.filter((call) => call === "dispose")).toHaveLength(1);
    expect(store.getSnapshot().lifecycle).toBe("ready");
    expect(store.getSnapshot().startupFailure).toBeNull();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(launches()).toBe(2);

    // An archive restore does not restart anything.
    answer("support.backup.restore", { requiresRestart: false, sourceFormat: "native-support-backup" });
    await store.restoreSupportBackup("C:/app-data/backups/native-backup-2026-09-11T10-00-00-000Z.json");
    expect(launches()).toBe(2);

    // The budget is untouched: the next real stop is attempt 1 of 3.
    emit(exited(2));
    expect(store.getSnapshot().startupFailure?.message).toContain("attempt 1 of 3");
    await store.dispose();
  });

  // Recovery mode (Slice 7 — F20): after a storage failure the engine stays
  // up for the backup requests, and the store fetches the backup list so the
  // recovery surface can offer a restore; any other failure fetches nothing.
  it("fetches the backup list after a storage failure at start", async () => {
    const listeners = new Set<Parameters<EngineTransport["subscribe"]>[0]>();
    const requests: string[] = [];
    let code = "STORAGE_CORRUPT";
    const transport: EngineTransport = {
      initialize: async () => {
        for (const listener of listeners) {
          listener({
            type: "event",
            event: "engine.startupFailed",
            payload: { stage: "bootstrap", code, message: "The saved data file failed its integrity check." },
          });
        }
      },
      request: async (method) => {
        requests.push(method);
        if (method === "support.snapshot") {
          return { backupCount: 1, backups: [{ kind: "database", name: "db-x-shutdown.sqlite3", path: "x" }] };
        }
        throw new Error("Engine is not running");
      },
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      dispose: () => Promise.resolve(),
    };

    const store = createShellStore(transport);
    await store.initialize();
    await settle(() => store.getSnapshot().supportSnapshot !== null);
    expect(store.getSnapshot().lifecycle).toBe("failed");
    expect(store.getSnapshot().supportSnapshot).toMatchObject({ backupCount: 1 });
    expect(requests.filter((method) => method === "support.snapshot")).toHaveLength(1);

    code = "ENGINE_ALREADY_RUNNING";
    requests.length = 0;
    await store.restart();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot().supportSnapshot).toBeNull();
    expect(requests).not.toContain("support.snapshot");
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

// 2026-09 production readiness, Slice 9 (finding F11, front-end half): every
// event, and every request the store sent, used to cost all ten snapshot
// requests. Each now fetches the snapshots it can change and nothing else;
// what is asked for while a batch is out goes out together as the next one;
// and a partial refresh writes only what it fetched.
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function changed(event: EventName, reason: string): EventEnvelope<EventName> {
  return { type: "event", event, payload: { reason } };
}

describe("createShellStore scoped refresh", () => {
  it("event refreshes only mapped domains", async () => {
    const { calls, emit, snapshotRequests, transport } = supervisedTransport();
    const store = createShellStore(transport);
    await store.initialize();

    // The slice's measure: one lighting.changed costs two requests (was ten).
    calls.length = 0;
    emit(changed("lighting.changed", "scene-recalled"));
    await tick();
    expect(snapshotRequests()).toEqual(["lighting.dmxMonitor.snapshot", "lighting.snapshot"]);
    expect(store.getSnapshot().lastEvent).toBe("lighting.changed");

    // Written out rather than read from the map, so the map is what is tested;
    // typed by EventName, so an event added to the protocol fails here too.
    const expected: Record<EventName, string[]> = {
      "app.changed": ["app.snapshot", "health.snapshot"],
      "audio.changed": ["audio.snapshot"],
      "audio.meters": [],
      "commissioning.changed": [
        "app.snapshot",
        "audio.snapshot",
        "commissioning.snapshot",
        "health.snapshot",
        "lighting.dmxMonitor.snapshot",
        "lighting.snapshot",
      ],
      "engine.exited": [],
      "engine.ready": [],
      "engine.startupFailed": [],
      "lighting.changed": ["lighting.dmxMonitor.snapshot", "lighting.snapshot"],
      // The commissioning snapshot carries the planning store's counts.
      "planning.changed": ["commissioning.snapshot", "planning.snapshot"],
      "settings.changed": ["app.snapshot"],
      "support.changed": ["support.snapshot"],
    };
    // The lifecycle events go last: a start-up failure leaves `ready`.
    const order = (Object.keys(expected) as EventName[]).sort(
      (left, right) => Number(left.startsWith("engine.")) - Number(right.startsWith("engine."))
    );
    for (const event of order) {
      calls.length = 0;
      emit(
        event === "engine.exited"
          ? exited(1, { graceful: true })
          : event === "engine.startupFailed"
            ? { type: "event", event, payload: { code: "BOOTSTRAP_FAILED", message: "x", stage: "bootstrap" } }
            : changed(event, "test")
      );
      await tick();
      expect(snapshotRequests(), event).toEqual(expected[event]);
    }
    await store.dispose();
  });

  // The hooks Slices 7 and 8 left: a staged database restore changes nothing
  // but the backup list, and a health transition costs the app and health
  // snapshots, not all ten.
  it("a staged restore refreshes support alone and a health transition app and health", async () => {
    const { answer, calls, emit, snapshotRequests, transport } = supervisedTransport();
    const store = createShellStore(transport);
    await store.initialize();
    expect(store.getSnapshot().recovery).toBe("healthy");

    calls.length = 0;
    emit(changed("support.changed", "backup-restore-staged"));
    await tick();
    expect(snapshotRequests()).toEqual(["support.snapshot"]);

    calls.length = 0;
    answer("health.snapshot", { status: "attention" });
    emit(changed("app.changed", "health"));
    await tick();
    expect(snapshotRequests()).toEqual(["app.snapshot", "health.snapshot"]);
    expect(store.getSnapshot().recovery).toBe("degraded");
    await store.dispose();
  });

  it("unknown event full refresh", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { calls, emit, snapshotRequests, transport } = supervisedTransport();
    const store = createShellStore(transport, { development: true });
    await store.initialize();

    calls.length = 0;
    emit(changed("rig.changed" as EventName, "from a newer hardware link"));
    await tick();
    // Everything an event can change: not the fixture catalog, which is
    // compiled in, nor the deck's page model, which is as fixed.
    expect(snapshotRequests()).toEqual([
      "app.snapshot",
      "audio.snapshot",
      "commissioning.snapshot",
      "health.snapshot",
      "lighting.dmxMonitor.snapshot",
      "lighting.snapshot",
      "planning.snapshot",
      "support.snapshot",
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("rig.changed"));
    warn.mockRestore();
    await store.dispose();
  });

  it("catalog once per session", async () => {
    const { answer, calls, emit, launches, transport } = supervisedTransport();
    const catalog = { definitions: [{ id: "astra-bicolor" }] };
    answer("lighting.fixtureCatalog.snapshot", catalog);
    const catalogRequests = () => calls.filter((call) => call === "request:lighting.fixtureCatalog.snapshot").length;
    const store = createShellStore(transport);
    await store.initialize();
    expect(catalogRequests()).toBe(1);
    expect(store.getSnapshot().lightingFixtureCatalogSnapshot).toEqual(catalog);

    emit(changed("lighting.changed", "fixture-updated"));
    await tick();
    await store.setLightingAllPower(true);
    expect(catalogRequests()).toBe(1);

    // A restart keeps it: the catalog is compiled into the hardware link.
    await store.restart();
    expect(launches()).toBe(2);
    expect(store.getSnapshot().lifecycle).toBe("ready");
    expect(catalogRequests()).toBe(1);
    expect(store.getSnapshot().lightingFixtureCatalogSnapshot).toEqual(catalog);

    // Only an explicit refresh asks again — and that one asks for everything.
    calls.length = 0;
    await store.refresh();
    expect(catalogRequests()).toBe(1);
    expect(calls.filter((call) => call.endsWith(".snapshot"))).toHaveLength(10);
    await store.dispose();
  });

  it("a request refreshes only what its method can change", async () => {
    const { answer, calls, snapshotRequests, transport } = supervisedTransport();
    const store = createShellStore(transport);
    await store.initialize();
    const after = async (request: () => Promise<unknown>) => {
      calls.length = 0;
      await request();
      return snapshotRequests();
    };
    const lighting = ["lighting.dmxMonitor.snapshot", "lighting.snapshot"];
    const commissioning = [
      "app.snapshot",
      "audio.snapshot",
      "commissioning.snapshot",
      "health.snapshot",
      "lighting.dmxMonitor.snapshot",
      "lighting.snapshot",
    ];

    // `settings.update` raises no event on the hardware link: this refresh is
    // the only thing that puts a workspace switch on the screen.
    answer("app.snapshot", { shell: { workspace: "audio" }, startup: { targetSurface: "dashboard" } });
    expect(await after(() => store.setLightingSection("patch"))).toEqual(["app.snapshot"]);
    // Opening a workspace also fetches what that workspace shows: the Stream
    // Deck changes lights and tasks without an event, and the backups folder
    // and the health sentences move without one too.
    expect(await after(() => store.setWorkspace("audio"))).toEqual(["app.snapshot", "audio.snapshot"]);
    expect(store.getSnapshot().activeWorkspace).toBe("audio");
    expect(await after(() => store.setWorkspace("lighting"))).toEqual(["app.snapshot", ...lighting]);
    expect(await after(() => store.setWorkspace("planning"))).toEqual([
      "app.snapshot",
      "commissioning.snapshot",
      "planning.snapshot",
    ]);
    expect(await after(() => store.setWorkspace("setup"))).toEqual([
      "app.snapshot",
      "commissioning.snapshot",
      "controlSurface.snapshot",
      "health.snapshot",
      "support.snapshot",
    ]);

    expect(await after(() => store.setLightingAllPower(true))).toEqual(lighting);
    // Slice 11: the armed switch is a row in the Recent actions list beside
    // it, so it — and no other lighting request — fetches the support snapshot.
    expect(await after(() => store.setLightingOutputArmed(false))).toEqual([...lighting, "support.snapshot"]);
    // Selecting a fixture is the hot path of the Lighting workspace.
    expect(await after(() => store.updateLightingSettings({ selectedFixtureId: "fixture-key" }))).toEqual(lighting);
    expect(await after(() => store.togglePlanningTaskComplete("task-1"))).toEqual([
      "commissioning.snapshot",
      "planning.snapshot",
    ]);
    expect(
      await after(() => store.runCommissioningCheck({ target: "lighting", bridgeIp: "10.0.0.9", universe: 1 }))
    ).toEqual(commissioning);
    expect(await after(() => store.seedPlanningDemo())).toEqual([...commissioning, "planning.snapshot"].sort());
    expect(await after(() => store.exportSupportBackup())).toEqual(["support.snapshot"]);
    // Writes the Stream Deck profile to a file; no snapshot reads it.
    expect(await after(() => store.exportCompanionConfig())).toEqual([]);
    // An applied archive rewrites lighting and audio settings too, and no
    // lighting or audio event says so.
    answer("support.backup.restore", { requiresRestart: false });
    expect(await after(() => store.restoreSupportBackup("C:/app-data/backups/native-backup.json"))).toHaveLength(8);
    await store.dispose();
  });

  // An applied archive restore raises five events in one reply. Asked for
  // together they go out as one batch — each snapshot once, where five full
  // refreshes used to cost fifty requests.
  it("events raised together are fetched as one batch", async () => {
    const { calls, emit, snapshotRequests, transport } = supervisedTransport();
    const store = createShellStore(transport);
    await store.initialize();

    calls.length = 0;
    for (const event of [
      "support.changed",
      "settings.changed",
      "app.changed",
      "commissioning.changed",
      "planning.changed",
    ] as const) {
      emit(changed(event, "backup-restored"));
    }
    await tick();
    expect(snapshotRequests()).toEqual([
      "app.snapshot",
      "audio.snapshot",
      "commissioning.snapshot",
      "health.snapshot",
      "lighting.dmxMonitor.snapshot",
      "lighting.snapshot",
      "planning.snapshot",
      "support.snapshot",
    ]);
    await store.dispose();
  });

  it("events that arrive while a batch is out share the next one", async () => {
    const { calls, emit, hold, transport } = supervisedTransport();
    const store = createShellStore(transport);
    await store.initialize();
    const lightingRequests = () => calls.filter((call) => call === "request:lighting.snapshot").length;

    calls.length = 0;
    const release = hold("lighting.snapshot");
    emit(changed("lighting.changed", "fixture-updated"));
    await tick();
    expect(lightingRequests()).toBe(1);
    for (let index = 0; index < 5; index += 1) {
      emit(changed("lighting.changed", "fixture-updated"));
    }
    await tick();
    expect(lightingRequests()).toBe(1);

    release();
    await tick();
    // One batch was out, one followed for the five that arrived meanwhile.
    expect(lightingRequests()).toBe(2);
    await store.dispose();
  });

  // Every request is bounded on the hardware link (the shell gives up after
  // ten seconds and fails what is pending when the link stops), so a batch
  // that never settles should not happen. If one ever does, it must not hold
  // the queue past a restart: restarting the hardware link is the operator's
  // remedy for a screen that stopped updating.
  it("a restart abandons a batch that never settles", async () => {
    const { calls, emit, launches, snapshotRequests, stall, transport } = supervisedTransport();
    const store = createShellStore(transport);
    await store.initialize();

    stall("lighting.snapshot");
    emit(changed("lighting.changed", "fixture-updated"));
    await tick();
    // A request whose refresh queues behind the batch that is out.
    const waiting = store.setLightingAllPower(true);
    await tick();
    calls.length = 0;
    emit(changed("planning.changed", "task-created"));
    await tick();
    expect(snapshotRequests()).toEqual([]);

    await store.restart();
    expect(launches()).toBe(2);
    expect(store.getSnapshot().lifecycle).toBe("ready");
    await expect(waiting).resolves.toBeDefined();

    calls.length = 0;
    emit(changed("planning.changed", "task-created"));
    await tick();
    expect(snapshotRequests()).toEqual(["commissioning.snapshot", "planning.snapshot"]);
    await store.dispose();
  });

  it("a partial refresh writes only what it fetched", async () => {
    const { answer, emit, hold, transport } = supervisedTransport();
    answer("app.snapshot", { shell: { workspace: "lighting" }, startup: { targetSurface: "dashboard" } });
    const store = createShellStore(transport);
    await store.initialize();
    expect(store.getSnapshot().activeWorkspace).toBe("lighting");
    const appSnapshot = store.getSnapshot().appSnapshot;

    // The app and health snapshots move on the hardware link, but an event
    // that names neither leaves the workspace and the recovery state alone.
    answer("app.snapshot", { shell: { workspace: "audio" }, startup: { targetSurface: "dashboard" } });
    answer("health.snapshot", { status: "attention" });
    emit(changed("planning.changed", "task-created"));
    await tick();
    expect(store.getSnapshot().activeWorkspace).toBe("lighting");
    expect(store.getSnapshot().appSnapshot).toBe(appSnapshot);
    expect(store.getSnapshot().recovery).toBe("healthy");

    emit(changed("settings.changed", "workspace-updated"));
    await tick();
    expect(store.getSnapshot().activeWorkspace).toBe("audio");
    expect(store.getSnapshot().recovery).toBe("healthy");

    emit(changed("app.changed", "health"));
    await tick();
    expect(store.getSnapshot().recovery).toBe("degraded");

    // A refresh that comes back after the hardware link stopped must not put
    // the shell back to `ready` or clear the failure.
    const release = hold("lighting.snapshot");
    emit(changed("lighting.changed", "fixture-updated"));
    await tick();
    emit(exited(1, { graceful: false }));
    expect(store.getSnapshot().lifecycle).toBe("failed");
    release();
    await tick();
    expect(store.getSnapshot().lifecycle).toBe("failed");
    expect(store.getSnapshot().startupFailure?.code).toBe("ENGINE_EXITED");
    await store.dispose();
  });

  it("a request that fails does not cost the others their answers", async () => {
    const { answer, emit, refuse, transport } = supervisedTransport();
    const store = createShellStore(transport);
    await store.initialize();

    refuse("health.snapshot");
    answer("app.snapshot", { shell: { workspace: "planning" }, startup: { targetSurface: "dashboard" } });
    emit(changed("app.changed", "commissioning-updated"));
    await tick();
    expect(store.getSnapshot().activeWorkspace).toBe("planning");
    expect(store.getSnapshot().backgroundFailures).toEqual([
      expect.objectContaining({ context: "refresh after app.changed", message: "health.snapshot refused" }),
    ]);
    expect(store.getSnapshot().lifecycle).toBe("ready");
    await store.dispose();
  });
});

// 2026-09 production readiness, Slice 9 (finding F32): a reply is looked at
// before it becomes a snapshot. A development build throws and leaves the
// fault for `useShellSnapshot` to rethrow into the error boundary; a
// production build keeps the last good snapshot and records the failure.
describe("createShellStore snapshot guards", () => {
  const goodLighting = { fixtures: [{ id: "fixture-key" }], groups: [], scenes: [] };

  it("malformed snapshot rejected in dev", async () => {
    const { answer, transport } = supervisedTransport();
    answer("lighting.snapshot", goodLighting);
    const store = createShellStore(transport, { development: true });
    await store.initialize();
    expect(store.getSnapshot().lightingSnapshot).toEqual(goodLighting);
    expect(store.getSnapshot().snapshotFault).toBeNull();

    answer("lighting.snapshot", { fixtures: "none", groups: [], scenes: [] });
    answer("planning.snapshot", { projects: [], tasks: [{ id: "task-1" }] });
    await expect(store.refresh()).rejects.toThrow("lighting.snapshot: fixtures is not a list");

    const state = store.getSnapshot();
    expect(state.lightingSnapshot).toEqual(goodLighting);
    expect(state.snapshotFault).toBe("lighting.snapshot: fixtures is not a list");
    // The rest of the batch arrived.
    expect(state.planningSnapshot?.tasks).toHaveLength(1);
    await store.dispose();
  });

  it("a row without an id is refused by name", async () => {
    const { answer, transport } = supervisedTransport();
    const store = createShellStore(transport, { development: true });
    await store.initialize();
    answer("planning.snapshot", { projects: [{ id: "project-1" }, { title: "no id" }], tasks: [] });
    await expect(store.refresh()).rejects.toThrow("planning.snapshot: projects[1] has no id");
    answer("app.snapshot", null);
    await expect(store.refresh()).rejects.toThrow("app.snapshot: the reply is empty");
    await store.dispose();
  });

  it("a malformed snapshot in production is a failed refresh, never a throw", async () => {
    const { answer, emit, transport } = supervisedTransport();
    answer("lighting.snapshot", goodLighting);
    const store = createShellStore(transport);
    await store.initialize();

    answer("lighting.snapshot", { fixtures: [{ name: "no id" }], groups: [], scenes: [] });
    await expect(store.refresh()).resolves.toBeUndefined();
    emit(changed("lighting.changed", "fixture-updated"));
    await tick();

    const state = store.getSnapshot();
    expect(state.lifecycle).toBe("ready");
    expect(state.snapshotFault).toBeNull();
    expect(state.lightingSnapshot).toEqual(goodLighting);
    expect(state.backgroundFailures).toHaveLength(2);
    expect(state.backgroundFailures[0]).toMatchObject({
      context: "reply refused",
      message: "lighting.snapshot: fixtures[0] has no id",
    });
    await store.dispose();
  });

  // The fixture double stands in for the hardware link in every Vitest and
  // Playwright run; a development store over each scenario proves its replies
  // pass the same guards the live replies do.
  it("every fixture scenario passes the guards", async () => {
    const { fixtureIds, fixtureScenarios } = await import("@sse/test-fixtures");
    for (const id of fixtureIds) {
      const scenario = fixtureScenarios[id] as { startupDelayMs?: number };
      if (typeof scenario.startupDelayMs === "number" && scenario.startupDelayMs > 0) {
        continue; // never reaches the snapshots: the start is held open
      }
      const store = createShellStore(createFixtureTransport(getFixtureScenario(id)), { development: true });
      await store.initialize();
      expect(store.getSnapshot().snapshotFault, id).toBeNull();
      if (store.getSnapshot().lifecycle === "ready") {
        await store.refresh();
        expect(store.getSnapshot().snapshotFault, id).toBeNull();
      }
      await store.dispose();
    }
  });
});

// 2026-09-23 (a finding recorded 2026-09-22 under `a598b11`): the hardware link
// works out at every read whether an Identify or Find flash is still lit and
// announces nothing when one starts or ends, so the store read the lighting
// state once, during the first flash, and the page went on showing it. The
// store now reads it again as each flash starts and ends (`identifyFlashes.ts`),
// a little after the moment; a clear-all drops what is still waiting.
describe("createShellStore identify flashes", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads the lighting state again as each Identify or Find flash starts and ends", async () => {
    const log: string[] = [];
    const store = createShellStore(
      recordingTransport(createFixtureTransport(getFixtureScenario("lighting-populated")), log)
    );
    await store.initialize();
    expect(store.getSnapshot().lifecycle).toBe("ready");
    vi.useFakeTimers({ now: Date.parse("2026-09-23T12:00:00.000Z") });

    const lightingReads = () => log.filter((method) => method === "lighting.snapshot").length;
    const back = () =>
      (store.getSnapshot().lightingSnapshot?.fixtures ?? []).find((fixture) => fixture.id === "fixture-back");
    expect(back()).toMatchObject({ on: false });

    // Identify: the reply's own read shows the flash; one more read 1.2 s on.
    await store.identifyLightingFixture("fixture-back");
    expect(back()).toMatchObject({ on: true, intensity: 100 });
    log.length = 0;
    await vi.advanceTimersByTimeAsync(1_200 + 59);
    expect(lightingReads()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    await settle(() => back()?.on === false);
    expect(lightingReads()).toBe(1);
    expect(log).toContain("lighting.dmxMonitor.snapshot");
    expect(back()).toMatchObject({ on: false });

    // Find over three lights 400 ms apart, 1.2 s each: reads at 400, 800, 1200,
    // 1600 and 2000 ms, each 60 ms late, and none after.
    await store.startLightingIdentifySequence(["fixture-key", "fixture-fill", "fixture-back"], 400, 1_200);
    log.length = 0;
    await vi.advanceTimersByTimeAsync(2_060);
    await settle(() => lightingReads() === 5);
    expect(lightingReads()).toBe(5);
    expect(back()).toMatchObject({ on: false });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(lightingReads()).toBe(5);

    // A clear-all ends the flashes and drops the reads still waiting.
    await store.startLightingIdentifySequence(["fixture-key", "fixture-fill", "fixture-back"], 400, 1_200);
    await store.clearLightingIdentifyBursts();
    log.length = 0;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(lightingReads()).toBe(0);

    await store.dispose();
  });
});
