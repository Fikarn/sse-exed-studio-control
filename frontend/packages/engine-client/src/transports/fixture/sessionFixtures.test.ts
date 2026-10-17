import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fixtureIds, getFixtureScenario } from "@sse/test-fixtures";

import type { JsonObject, RequestMethod } from "../../generated/protocol";
import type { EngineTransport } from "../../types";
import { createFixtureTransport } from "../fixtureTransport";

// The Session page's four fixtures (D51; `@sse/test-fixtures`, `buildSessionFixture`): what
// the page, its windows and its captures rely on, read from the double as the page reads it.
// The windows' words (ASSUMED and its Sync, the session Begin would end) are the app's to
// work out; here are the hardware link's facts they come from.

/** The captures' moment (`visual-review.spec.ts`'s `FIXTURE_NOW`). */
const FIXTURE_NOW = Date.parse("2026-04-23T09:11:00+02:00");

beforeEach(() => {
  vi.useFakeTimers({ now: FIXTURE_NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

const SESSION_FIXTURES = ["session-choose", "session-window", "session-running", "session-running-window"] as const;

const doubles: EngineTransport[] = [];
afterEach(async () => {
  for (const transport of doubles.splice(0)) await transport.dispose?.();
});

async function openSession(id: (typeof SESSION_FIXTURES)[number]) {
  const transport = createFixtureTransport(getFixtureScenario(id));
  doubles.push(transport);
  await transport.initialize?.();
  await vi.advanceTimersByTimeAsync(0);
  const read = (method: RequestMethod) => transport.request(method, {}) as Promise<JsonObject>;
  const checks = async () => ((await read("health.snapshot")).checks ?? {}) as Record<string, JsonObject>;
  return { read, checks };
}

describe("the Session page's fixtures", () => {
  it.each(SESSION_FIXTURES)("%s: opens on the Session page, every check ok", async (id) => {
    expect(fixtureIds).toContain(id);
    const { read, checks } = await openSession(id);
    expect(((await read("app.snapshot")).shell as JsonObject).workspace).toBe("session");
    expect(Object.values(await checks()).every((check) => check.ok === true)).toBe(true);
    expect((await read("prompter.snapshot")).screen).toMatchObject({ word: "CONNECTED", draws: true });
    expect((await read("cameras.snapshot")).takesToday).toEqual({ count: 0, recordedSeconds: 0 });
  });

  it.each(["session-choose", "session-window"] as const)(
    "%s: no session runs, the console is only assumed, and two kinds have a last session",
    async (id) => {
      const { read } = await openSession(id);
      expect(await read("session.snapshot")).toEqual({
        current: null,
        last: [
          {
            kind: "podcast",
            name: "Leading Through Change — episode 2",
            begunAt: "2026-04-22T12:02:00.000Z",
            endedAt: "2026-04-22T13:16:00.000Z",
          },
          {
            kind: "green-screen",
            name: "Strategy in Practice — lecture 3",
            begunAt: "2026-04-21T08:30:00.000Z",
            endedAt: "2026-04-21T09:52:00.000Z",
          },
        ],
      });
      expect(await read("audio.snapshot")).toMatchObject({
        consoleStateConfidence: "assumed",
        lastConsoleSyncAt: null,
      });
    }
  );

  it.each(["session-running", "session-running-window"] as const)(
    "%s: the podcast recording runs since 06:46 UTC, each kind has a last session, and the desk is the take's",
    async (id) => {
      const { read } = await openSession(id);
      const session = await read("session.snapshot");
      expect(session.current).toEqual({
        kind: "podcast",
        name: "Leading Through Change — episode 3",
        begunAt: "2026-04-23T06:46:00.000Z",
        endedAt: null,
      });
      expect((session.last as JsonObject[]).map((last) => last.kind)).toEqual(["podcast", "green-screen", "webinar"]);
      expect(await read("audio.snapshot")).toMatchObject({
        verified: true,
        meteringState: "live",
        consoleStateConfidence: "aligned",
        lastConsoleSyncAt: "2026-04-23T08:38:12+02:00",
      });
    }
  );
});
