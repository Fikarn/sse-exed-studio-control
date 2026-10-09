import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fixtureIds, getFixtureScenario } from "@sse/test-fixtures";

import type { JsonObject, RequestMethod } from "../../generated/protocol";
import type { EngineTransport } from "../../types";
import { createFixtureTransport } from "../fixtureTransport";

// The Overview's three fixtures (D47; `@sse/test-fixtures`, `buildOverviewFixture`): what the
// page and its captures rely on, read from the double as the page reads it. The page's own
// words (READY, VERIFIED, ASSUMED, the gate) are the app's to work out; here are the
// hardware link's facts they are worked out from: `describeAudioStatus` reads VERIFIED from a
// ready, verified console whose meters are TotalMix's and live, read in agreement with the desk
// (`aligned`) and with no failed action; `audioMeterSimulationState` gates the meters of a desk
// that is only assumed.

/** The captures' moment (`visual-review.spec.ts`'s `FIXTURE_NOW`). */
const FIXTURE_NOW = Date.parse("2026-04-23T09:11:00+02:00");

beforeEach(() => {
  vi.useFakeTimers({ now: FIXTURE_NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

const OVERVIEW_FIXTURES = ["overview-take", "overview-landing", "overview-fault"] as const;

const doubles: EngineTransport[] = [];
afterEach(async () => {
  for (const transport of doubles.splice(0)) await transport.dispose?.();
});

/** The double of `id`, started as the page starts it, and the reads the page makes. */
async function openOverview(id: (typeof OVERVIEW_FIXTURES)[number]) {
  const transport = createFixtureTransport(getFixtureScenario(id));
  doubles.push(transport);
  const meters: unknown[] = [];
  transport.subscribe((envelope) => {
    if (envelope.event === "audio.meters") meters.push(envelope.payload);
  });
  await transport.initialize?.();
  await vi.advanceTimersByTimeAsync(0);
  const read = (method: RequestMethod) => transport.request(method, {}) as Promise<JsonObject>;
  const checks = async () => ((await read("health.snapshot")).checks ?? {}) as Record<string, JsonObject>;
  const channels = async () => (await read("audio.snapshot")).channels as JsonObject[];
  const camera = async (number: number) => ((await read("cameras.snapshot")).cameras as JsonObject[])[number - 1]!;
  const glass = async () => (await read("prompter.snapshot")).glass as JsonObject;
  /** Whether the meters tick: `audio.meters` events over 200 ms. */
  const ticks = async () => {
    meters.length = 0;
    await vi.advanceTimersByTimeAsync(200);
    return meters.length > 0;
  };
  return { read, checks, channels, camera, glass, ticks };
}

describe("the Overview's fixtures", () => {
  it.each(OVERVIEW_FIXTURES)(
    "%s: opens on the Overview, CAM 1 selected, the four preamps shown and no solo",
    async (id) => {
      expect(fixtureIds).toContain(id);
      const { read, channels } = await openOverview(id);
      expect(((await read("app.snapshot")).shell as JsonObject).workspace).toBe("overview");
      expect((await read("cameras.snapshot")).selected, "the full-size test card is the selected camera's").toBe(1);
      const shown = (await channels()).filter((channel) => channel.role !== "playback-pair" && channel.hidden !== true);
      expect(shown.map((channel) => [channel.id, channel.name])).toEqual([
        ["audio-input-9", "Host"],
        ["audio-input-10", "Co-host"],
        ["audio-input-11", "Guest 1"],
        ["audio-input-12", "Guest 2"],
      ]);
      expect((await channels()).filter((channel) => channel.solo === true)).toEqual([]);
      expect((await read("prompter.snapshot")).screen).toMatchObject({ word: "CONNECTED", draws: true });
    }
  );

  it("overview-take: every check the double derives is ok, the console VERIFIED and ticking, CAM 1 counted, the script playing at 140", async () => {
    const { read, checks, camera, glass, ticks } = await openOverview("overview-take");
    const health = await read("health.snapshot");
    expect(health.status).toBe("ok");
    const all = await checks();
    expect(Object.fromEntries(Object.entries(all).map(([id, check]) => [id, [check.ok, check.status]]))).toEqual({
      lighting: [true, "ready"],
      audio: [true, "ready"],
      controlSurface: [true, "ready"],
      prompter: [true, "ok"],
      cameras: [true, "ok"],
    });
    expect(all.engine, "no backup warning").toBeUndefined();

    // The rig: reachable, armed, answering, and Warm wash on it (no lamp at attention).
    expect(await read("lighting.snapshot")).toMatchObject({
      reachable: true,
      outputArmed: true,
      sceneState: "live",
      highlightFixtureIds: [],
      soloFixtureIds: [],
    });
    expect((await read("lighting.snapshot")).bridgeAnswering).not.toBe(false);

    expect(await read("audio.snapshot")).toMatchObject({
      status: "ready",
      verified: true,
      oscEnabled: true,
      meteringSource: "rme-totalmix-osc",
      meteringState: "live",
      consoleStateConfidence: "aligned",
      lastActionStatus: "succeeded",
      adapterMode: "simulated",
      lastConsoleSyncAt: "2026-04-23T08:38:12+02:00",
    });
    expect(await ticks(), "the meters tick").toBe(true);

    // CAM 1 records, counted from its start row (07:09:30Z), and the day holds two takes.
    expect(await camera(1)).toMatchObject({
      state: "held",
      recording: { recording: true, startedAt: "2026-04-23T07:09:30.000Z" },
    });
    expect([(await camera(2)).state, (await camera(3)).state]).toEqual(["held", "held"]);
    expect((await read("cameras.snapshot")).takesToday).toEqual({ count: 2, recordedSeconds: 850 });

    expect(await glass()).toMatchObject({
      name: "02 Interview intro",
      playing: true,
      speedWpm: 140,
      place: { paragraph: 7, word: 8 },
      atEnd: false,
    });
  });

  it("overview-landing: the console assumed and unread since the start, nothing records, the script paused at ¶ 1", async () => {
    const { read, checks, camera, glass, ticks } = await openOverview("overview-landing");
    const all = await checks();
    expect(Object.values(all).every((check) => check.ok === true)).toBe(true);
    // ASSUMED, so the meters wait (gated), and they do not tick.
    expect(await read("audio.snapshot")).toMatchObject({
      status: "ready",
      verified: true,
      meteringSource: "rme-totalmix-osc",
      consoleStateConfidence: "assumed",
      lastActionStatus: "succeeded",
      lastConsoleSyncAt: null,
    });
    expect(await ticks(), "no ticks").toBe(false);

    expect(await camera(1)).toMatchObject({ state: "held", recording: { recording: false } });
    expect((await read("cameras.snapshot")).takesToday).toEqual({ count: 0, recordedSeconds: 0 });
    expect(await glass()).toMatchObject({
      name: "02 Interview intro",
      playing: false,
      speedWpm: 140,
      place: { paragraph: 0, word: 0 },
    });
  });

  it("overview-fault: CAM 1 lost while it records, Guest 1 clipped with the meters ticking, the script playing at 145", async () => {
    const { read, checks, camera, glass, ticks, channels } = await openOverview("overview-fault");
    expect(await camera(1)).toMatchObject({ state: "unreachable", recording: { recording: true } });
    expect([(await camera(2)).state, (await camera(3)).state]).toEqual(["held", "held"]);
    expect((await checks()).cameras).toMatchObject({ ok: false, word: "UNREACHABLE", recording: true });
    expect((await read("cameras.snapshot")).takesToday).toMatchObject({ count: 2 });

    expect(await read("audio.snapshot")).toMatchObject({
      status: "ready",
      verified: true,
      meteringSource: "rme-totalmix-osc",
      meteringState: "live",
      consoleStateConfidence: "aligned",
      lastActionStatus: "succeeded",
    });
    expect(await ticks(), "the meters tick").toBe(true);
    const clipped = (await channels()).filter((channel) => channel.clip === true).map((channel) => channel.name);
    expect(clipped, "the clip holds through the ticks").toEqual(["Guest 1"]);

    expect(await glass()).toMatchObject({
      name: "02 Interview intro",
      playing: true,
      speedWpm: 145,
      place: { paragraph: 10, word: 0 },
    });
    // At ¶ 11 two cues lie ahead: ¶ 12's and ¶ 14's.
    expect(((await glass()).cues as JsonObject[]).filter((cue) => (cue.paragraph as number) >= 10)).toHaveLength(2);
  });
});
