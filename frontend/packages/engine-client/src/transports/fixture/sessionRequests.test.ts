import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getFixtureScenario } from "@sse/test-fixtures";

import type { JsonObject, JsonValue, RequestMethod } from "../../generated/protocol";
import type { Session } from "../../generated/snapshots/Session";
import type { FixtureSessionSeed } from "../../types";
import { EngineRequestError } from "../engineRequestError";
import { createFixtureTransport } from "../fixtureTransport";
import { trimmedName } from "./sessionState";

// The fixture double's `session.*` requests (the Session page, 2026-10-15), held to what the
// hardware link answers (`native/rust-engine/src/session/tests.rs`; `v1.md`'s "Session"):
// a begin and an end, what they answer and raise, every refusal's code and sentence in the
// hardware link's order of checks, the name's trimming and length, the last of each kind,
// the rows they leave, and the seed a scenario starts with.

const MORNING = "2026-10-15T07:16:00.000Z";
const NOON = "2026-10-15T10:02:30.250Z";
const EVENING = "2026-10-15T16:40:00.000Z";

beforeEach(() => {
  vi.useFakeTimers({ now: Date.parse(MORNING) });
});
afterEach(() => {
  vi.useRealTimers();
});

const session = (kind: Session["kind"], name: string, begunAt: string, endedAt: string | null = null): Session => ({
  kind,
  name,
  begunAt,
  endedAt,
});

/** A double on `setup-ready` with the session `seed` says, and what a test does with it. */
function openSessionDouble(seed?: FixtureSessionSeed) {
  const scenario = getFixtureScenario("setup-ready");
  const transport = createFixtureTransport(seed === undefined ? scenario : { ...scenario, session: seed });
  const events: Array<[string, JsonObject]> = [];
  transport.subscribe((envelope) => events.push([envelope.event, envelope.payload]));

  const call = (method: RequestMethod, params: JsonObject = {}) => transport.request(method, params);
  const at = (time: string) => vi.setSystemTime(Date.parse(time));

  /** A request that must be refused: its code and its sentence, as the Tauri transport throws them. */
  const refused = async (method: RequestMethod, params: JsonObject = {}) => {
    let answered: JsonValue;
    try {
      answered = await transport.request(method, params);
    } catch (error) {
      if (!(error instanceof EngineRequestError)) throw error;
      return { code: error.code, sentence: error.message };
    }
    throw new Error(`${method} should be refused, answered ${JSON.stringify(answered)}`);
  };

  /** The session's rows in Recent actions, oldest first, as (action, target, detail). */
  const rows = async () => {
    const support = (await call("support.snapshot")) as JsonObject;
    return ((support.recentEvents ?? []) as JsonObject[])
      .filter((row) => row.domain === "session")
      .map((row) => [row.source, row.action, row.target, row.detail])
      .reverse();
  };

  return { call, at, refused, rows, events };
}

describe("the fixture double's session", () => {
  it("starts with no session and no last, and a read raises nothing", async () => {
    const { call, events } = openSessionDouble();
    events.length = 0;
    expect(await call("session.snapshot")).toEqual({ current: null, last: [] });
    expect(events).toEqual([]);
  });

  it("begins a session, answers it and raises session.changed { begun }", async () => {
    const { call, events, rows } = openSessionDouble();
    events.length = 0;
    const running = session("podcast", "Morning take", MORNING);
    expect(await call("session.begin", { kind: "podcast", name: "Morning take" })).toEqual({
      session: running,
      ended: null,
    });
    expect(events).toEqual([["session.changed", { reason: "begun" }]]);
    expect(await call("session.snapshot")).toEqual({ current: running, last: [] });
    expect(await rows()).toEqual([["ui", "begun", "podcast", "Session begun: Podcast Recording · Morning take"]]);
  });

  it("ends a running session at the moment another begins, keeping it as its kind's last", async () => {
    const { call, at, events, rows } = openSessionDouble();
    await call("session.begin", { kind: "podcast", name: "Morning take" });
    at(NOON);
    events.length = 0;
    const ended = session("podcast", "Morning take", MORNING, NOON);
    const running = session("webinar", "Spring launch", NOON);
    expect(await call("session.begin", { kind: "webinar", name: "Spring launch" })).toEqual({
      session: running,
      ended,
    });
    expect(events, "one event for the end and the begin").toEqual([["session.changed", { reason: "begun" }]]);
    expect(await call("session.snapshot")).toEqual({ current: running, last: [ended] });
    expect(await rows()).toEqual([
      ["ui", "begun", "podcast", "Session begun: Podcast Recording · Morning take"],
      ["ui", "ended", "podcast", "Session ended: Podcast Recording · Morning take"],
      ["ui", "begun", "webinar", "Session begun: Webinar · Spring launch"],
    ]);
  });

  it("ends the running session, raises session.changed { ended }, and refuses a second end", async () => {
    const { call, at, refused, events, rows } = openSessionDouble();
    await call("session.begin", { kind: "green-screen" });
    at(EVENING);
    events.length = 0;
    const ended = session("green-screen", "", MORNING, EVENING);
    expect(await call("session.end")).toEqual({ ended });
    expect(events).toEqual([["session.changed", { reason: "ended" }]]);
    expect(await call("session.snapshot")).toEqual({ current: null, last: [ended] });

    events.length = 0;
    expect(await refused("session.end")).toEqual({
      code: "SESSION_NOT_RUNNING",
      sentence: "No session is running, so there is none to end.",
    });
    expect(events, "a refusal raises nothing").toEqual([]);
    expect(await rows(), "and leaves no row").toEqual([
      ["ui", "begun", "green-screen", "Session begun: Green Screen Recording"],
      ["ui", "ended", "green-screen", "Session ended: Green Screen Recording"],
    ]);
  });

  it("keeps one last session of each kind, newest first", async () => {
    const { call, at } = openSessionDouble();
    at("2026-10-13T08:00:00.000Z");
    await call("session.begin", { kind: "podcast", name: "First podcast" });
    at("2026-10-13T11:00:00.000Z");
    await call("session.begin", { kind: "green-screen", name: "Studio intro" });
    at("2026-10-14T09:00:00.000Z");
    await call("session.begin", { kind: "podcast", name: "Second podcast" });
    at("2026-10-14T12:30:00.000Z");
    await call("session.end");
    expect(((await call("session.snapshot")) as JsonObject).last).toEqual([
      session("podcast", "Second podcast", "2026-10-14T09:00:00.000Z", "2026-10-14T12:30:00.000Z"),
      session("green-screen", "Studio intro", "2026-10-13T11:00:00.000Z", "2026-10-14T09:00:00.000Z"),
    ]);
  });

  it("trims the name, takes none, and takes at most eighty characters", async () => {
    const { call, refused } = openSessionDouble();
    const name = async (params: JsonObject) =>
      ((await call("session.begin", params)) as { session: Session }).session.name;
    expect(await name({ kind: "webinar", name: "  Spring launch \n" })).toBe("Spring launch");
    expect(await name({ kind: "webinar", name: "   " })).toBe("");
    expect(await name({ kind: "podcast" })).toBe("");
    expect(await name({ kind: "podcast", name: null })).toBe("");
    // Characters are counted, not UTF-16 units: eighty of a character two units long.
    const eighty = "😀".repeat(80);
    expect(await name({ kind: "podcast", name: ` ${eighty} ` })).toBe(eighty);
    expect(await refused("session.begin", { kind: "podcast", name: "a".repeat(81) })).toEqual({
      code: "SESSION_NAME_TOO_LONG",
      sentence: "A session's name has at most 80 characters; this one has 81.",
    });
    expect(((await call("session.snapshot")) as { current: Session }).current.name, "a refusal changes nothing").toBe(
      eighty
    );
    expect(await refused("session.begin", { kind: "podcast", name: 7 })).toEqual({
      code: "INVALID_PARAMS",
      sentence: "name must be a string",
    });
  });

  it("trims what Rust's trim trims, and nothing else", () => {
    // U+0085 is White_Space and Rust trims it; U+FEFF is not, though JavaScript's own trim takes it.
    expect(trimmedName("\u0085　Take ")).toBe("Take");
    expect(trimmedName("﻿Take")).toBe("﻿Take");
  });

  it("refuses a kind it does not know, after the request's shape", async () => {
    const { call, refused, events } = openSessionDouble();
    events.length = 0;
    expect(await refused("session.begin", { kind: "interview", name: "A" })).toEqual({
      code: "SESSION_KIND_UNKNOWN",
      sentence: '"interview" is not a kind of session: the kinds are green-screen, podcast and webinar.',
    });
    for (const params of [{ name: "A" }, { kind: 2 }] as JsonObject[]) {
      expect(await refused("session.begin", params)).toEqual({
        code: "INVALID_PARAMS",
        sentence: "kind must be one of: green-screen, podcast, webinar",
      });
    }
    expect(await refused("session.begin", { kind: "interview", name: false })).toEqual({
      code: "INVALID_PARAMS",
      sentence: "name must be a string",
    });
    expect(events).toEqual([]);
    expect(await call("session.snapshot")).toEqual({ current: null, last: [] });
  });

  it("starts with the session a scenario seeds, and refuses a seed the hardware link would not read", async () => {
    const running = session("podcast", "Morning take", MORNING);
    const last = [session("webinar", "Spring launch", "2026-10-14T09:00:00.000Z", "2026-10-14T10:00:00.000Z")];
    const { call } = openSessionDouble({ current: running, last });
    expect(await call("session.snapshot")).toEqual({ current: running, last });

    const mistakes: Array<[unknown, string]> = [
      [{ running }, "session: the seed has running, which a seed does not have."],
      [{ current: { ...running, kind: "interview" } }, "session: current's kind must be one of"],
      [{ current: { ...running, name: " Morning take" } }, "session: current's name must be trimmed text."],
      [{ current: { ...running, name: "a".repeat(81) } }, "session: current's name has more than 80 characters."],
      [{ current: { ...running, begunAt: "today" } }, "session: current's begunAt must be a UTC time"],
      [{ current: { ...running, endedAt: NOON } }, "session: current runs: its endedAt is null."],
      [{ last: [running] }, "session: last[0]'s endedAt must be a UTC time."],
      [{ last: [last[0], last[0]] }, "session: last holds one session of each kind at most."],
    ];
    for (const [seed, message] of mistakes) {
      expect(() => openSessionDouble(seed as FixtureSessionSeed), message).toThrow(message);
    }
  });
});
