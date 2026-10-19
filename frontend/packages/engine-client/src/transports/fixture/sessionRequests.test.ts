import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getFixtureScenario } from "@sse/test-fixtures";

import type { JsonObject, JsonValue, RequestMethod } from "../../generated/protocol";
import type { Session } from "../../generated/snapshots/Session";
import type { SessionDrive } from "../../generated/snapshots/SessionDrive";
import type { FixtureSessionSeed } from "../../types";
import { EngineRequestError } from "../engineRequestError";
import { createFixtureTransport, simulatedSession } from "../fixtureTransport";
import { folderLeaf, localDay } from "./sessionFolder";
import { FIXTURE_DRIVES, GIB, defaultSessionSettings, trimmedName } from "./sessionState";
import { inFolder, levelOf, onRoot } from "./sessionWatch";

// The fixture double's `session.*` requests (the Session page, 2026-10-15; D52), held to what
// the hardware link answers (`native/rust-engine/src/session/tests.rs`, `tests_folder.rs`;
// `v1.md`'s "Session"): a begin, which makes or chooses its folder on the double's disk, an
// end, the settings' update, what they answer and raise, every refusal's code and sentence in
// the hardware link's order of checks, the name's trimming and length, the last of each kind,
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

/** The folder a begin of `kind` named `name` at `at` makes on the studio's sessions' folder. */
const folderOf = (kind: Session["kind"], name: string, at: string) =>
  `D:\\Sessions\\${folderLeaf(name, kind, localDay(new Date(at)))}`;

const session = (kind: Session["kind"], name: string, begunAt: string, endedAt: string | null = null): Session => ({
  kind,
  name,
  begunAt,
  endedAt,
  folder: folderOf(kind, name, begunAt),
  folderBytes: null,
});

/** The studio PC's four drives as the double's watch reads them, each well above Low. */
const studioDrives = (): SessionDrive[] =>
  Object.entries(FIXTURE_DRIVES).map(([letter, drive]) => ({
    letter,
    name: drive.name,
    mapped: drive.mapped,
    answering: true,
    freeBytes: drive.freeBytes,
    totalBytes: drive.totalBytes,
    level: "ok",
  }));

/** What the double's watch reads with no seed of it: the studio's drives, no folder on the
 *  sessions' folder, vMix answering with nothing named, read at the double's start. */
const unseededWatch = (readAt: string) => ({
  recent: [],
  drives: studioDrives(),
  sessionDrive: "D",
  vmix: {
    state: "answering",
    recording: false,
    file: null,
    inFolder: null,
    bytesPerSecond: null,
    recordingFolder: null,
  },
  readAt,
});

/** A double on `setup-ready` with the session `seed` says, and what a test does with it. */
function openSessionDouble(seed?: FixtureSessionSeed) {
  const scenario = getFixtureScenario("setup-ready");
  const transport = createFixtureTransport(seed === undefined ? scenario : { ...scenario, session: seed });
  const events: Array<[string, JsonObject]> = [];
  transport.subscribe((envelope) => events.push([envelope.event, envelope.payload]));

  const call = (method: RequestMethod, params: JsonObject = {}) => transport.request(method, params);
  const at = (time: string) => vi.setSystemTime(Date.parse(time));

  /** The running session and the last of each kind, as the snapshot says. */
  const sessions = async () => {
    const snapshot = (await call("session.snapshot")) as JsonObject;
    return { current: snapshot.current, last: snapshot.last };
  };

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

  return { call, at, sessions, refused, rows, events, hooks: simulatedSession(transport) };
}

describe("the fixture double's session", () => {
  it("starts with no session and no last, the settings' defaults and the studio's places, and a read raises nothing", async () => {
    const { call, events } = openSessionDouble();
    events.length = 0;
    expect(await call("session.snapshot")).toEqual({
      current: null,
      last: [],
      settings: defaultSessionSettings(),
      places: { root: "D:\\Sessions", simulated: false, rootExists: false },
      ...unseededWatch(MORNING),
    });
    expect(events).toEqual([]);
  });

  it("begins a session in the folder it makes, answers it and raises session.changed { begun }", async () => {
    const { call, events, rows, sessions } = openSessionDouble();
    events.length = 0;
    const running = session("podcast", "Morning take", MORNING);
    expect(await call("session.begin", { kind: "podcast", name: "Morning take" })).toEqual({
      session: running,
      ended: null,
      folder: { path: running.folder, made: true },
    });
    expect(events).toEqual([["session.changed", { reason: "begun" }]]);
    expect(await sessions()).toEqual({ current: running, last: [] });
    expect(await rows()).toEqual([
      ["ui", "begun", "podcast", `Session begun: Podcast Recording · Morning take, in a new folder ${running.folder}`],
    ]);
  });

  it("ends a running session at the moment another begins, keeping it as its kind's last", async () => {
    const { call, at, events, rows, sessions } = openSessionDouble();
    await call("session.begin", { kind: "podcast", name: "Morning take" });
    at(NOON);
    events.length = 0;
    const ended = session("podcast", "Morning take", MORNING, NOON);
    const running = session("webinar", "Spring launch", NOON);
    expect(await call("session.begin", { kind: "webinar", name: "Spring launch" })).toEqual({
      session: running,
      ended,
      folder: { path: running.folder, made: true },
    });
    expect(events, "one event for the end and the begin").toEqual([["session.changed", { reason: "begun" }]]);
    expect(await sessions()).toEqual({ current: running, last: [ended] });
    expect(await rows()).toEqual([
      ["ui", "begun", "podcast", `Session begun: Podcast Recording · Morning take, in a new folder ${ended.folder}`],
      ["ui", "ended", "podcast", "Session ended: Podcast Recording · Morning take"],
      ["ui", "begun", "webinar", `Session begun: Webinar · Spring launch, in a new folder ${running.folder}`],
    ]);
  });

  it("ends the running session, raises session.changed { ended }, and refuses a second end", async () => {
    const { call, at, refused, events, rows, sessions } = openSessionDouble();
    await call("session.begin", { kind: "green-screen" });
    at(EVENING);
    events.length = 0;
    const ended = session("green-screen", "", MORNING, EVENING);
    expect(await call("session.end")).toEqual({ ended });
    expect(events).toEqual([["session.changed", { reason: "ended" }]]);
    expect(await sessions()).toEqual({ current: null, last: [ended] });

    events.length = 0;
    expect(await refused("session.end")).toEqual({
      code: "SESSION_NOT_RUNNING",
      sentence: "No session is running, so there is none to end.",
    });
    expect(events, "a refusal raises nothing").toEqual([]);
    expect(await rows(), "and leaves no row").toEqual([
      ["ui", "begun", "green-screen", `Session begun: Green Screen Recording, in a new folder ${ended.folder}`],
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
    expect(trimmedName("\u0085　Take ")).toBe("Take");
    expect(trimmedName("﻿Take")).toBe("﻿Take");
  });

  it("refuses a kind it does not know, after the request's shape", async () => {
    const { refused, events, sessions } = openSessionDouble();
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
    // The kind and the name come before the folder's shape.
    expect((await refused("session.begin", { kind: "interview", folder: 3 })).code).toBe("SESSION_KIND_UNKNOWN");
    expect((await refused("session.begin", { kind: "podcast", name: "a".repeat(81), folder: 3 })).code).toBe(
      "SESSION_NAME_TOO_LONG"
    );
    expect(events).toEqual([]);
    expect(await sessions()).toEqual({ current: null, last: [] });
  });
});

describe("the fixture double's session folder (D52)", () => {
  it("uses the folder a second begin of one name on one day finds there, and says so in its row", async () => {
    const { call, at, rows } = openSessionDouble();
    await call("session.begin", { kind: "podcast", name: "Morning take" });
    at(NOON);
    const folder = folderOf("podcast", "Morning take", MORNING);
    expect(await call("session.begin", { kind: "podcast", name: "Morning take" })).toMatchObject({
      folder: { path: folder, made: false },
    });
    expect((await rows()).at(-1)).toEqual([
      "ui",
      "begun",
      "podcast",
      `Session begun: Podcast Recording · Morning take, in ${folder}`,
    ]);
  });

  it("uses a folder that is there, and makes a new one in a parent that is there", async () => {
    const { call, at } = openSessionDouble({
      folders: ["D:\\All\\Series (2026-10-01)", "Z:\\Studio\\Leadership series"],
    });
    expect(
      await call("session.begin", {
        kind: "podcast",
        name: "Episode 4",
        folder: { mode: "existing", path: "d:/All/Series (2026-10-01)/" },
      })
    ).toMatchObject({ session: { folder: "D:\\All\\Series (2026-10-01)" }, folder: { made: false } });
    at(NOON);
    const day = localDay(new Date(NOON));
    expect(
      await call("session.begin", {
        kind: "podcast",
        name: "Episode 5",
        folder: { mode: "new", parent: "Z:\\Studio\\Leadership series" },
      })
    ).toMatchObject({ folder: { path: `Z:\\Studio\\Leadership series\\Episode 5 (${day})`, made: true } });
    // A drive's own top is there while its drive is.
    expect(
      await call("session.begin", { kind: "webinar", name: "On top", folder: { mode: "new", parent: "E:\\" } })
    ).toMatchObject({ folder: { path: `E:\\On top (${day})`, made: true } });
    // The folder it made, and the sessions' folder it did not need, are as the hardware
    // link's would be: a begin of a folder made then is used as it is.
    expect(
      await call("session.begin", {
        kind: "webinar",
        folder: { mode: "existing", path: `Z:\\Studio\\Leadership series\\Episode 5 (${day})\\vMix Recording` },
      })
    ).toMatchObject({ folder: { made: false } });
  });

  it("refuses with the hardware link's codes and sentences, in its order", async () => {
    const { refused, sessions } = openSessionDouble({ folders: ["D:\\All"] });
    const begin = (folder: JsonValue) => refused("session.begin", { kind: "podcast", name: "Take", folder });

    for (const folder of [
      3,
      "new",
      {},
      { mode: "old" },
      { mode: "existing" },
      { mode: "new", parent: "D:\\All", name: "x" },
      { mode: "new", parent: "Sessions" },
      { mode: "new", parent: "D:\\All\\..\\Other" },
      { mode: "new", parent: "\\\\?\\D:\\All" },
      { mode: "existing", path: "D:\\All\\a*b" },
    ] as JsonValue[]) {
      expect((await begin(folder)).code, JSON.stringify(folder)).toBe("INVALID_PARAMS");
    }
    expect(await begin({ mode: "new", parent: "\\\\172.16.18.28\\Public\\Sessions" })).toEqual({
      code: "SESSION_FOLDER_NOT_ON_A_DRIVE",
      sentence: "Choose a folder on a drive with a letter, such as Public (Z:).",
    });
    expect(await begin({ mode: "new", parent: "Q:\\Series" })).toEqual({
      code: "SESSION_DRIVE_MISSING",
      sentence:
        "Q: is not there, so the session's folder cannot be made there. Choose a folder that exists, or set another sessions' folder in Setup / Support.",
    });
    expect(await begin({ mode: "existing", path: "Q:\\All\\Old take (2026-10-01)" })).toEqual({
      code: "SESSION_DRIVE_MISSING",
      sentence: "Q: is not there, so Q:\\All\\Old take (2026-10-01) cannot be used. Choose another folder.",
    });
    // The length, before the parent's being there.
    const deep = `D:\\All\\${"y".repeat(170)}`;
    const length =
      `${deep}\\${folderLeaf("Take", "podcast", localDay(new Date(MORNING)))}`.length + "\\vMix Recording".length;
    expect(length).toBeGreaterThan(200);
    expect(await begin({ mode: "new", parent: deep })).toEqual({
      code: "SESSION_FOLDER_PATH_TOO_LONG",
      sentence: `That folder's path would be ${length} characters, over 200: choose a shorter name, or a folder nearer the drive's top.`,
    });
    expect(await begin({ mode: "new", parent: "D:\\All\\Gone series" })).toEqual({
      code: "SESSION_FOLDER_MISSING",
      sentence: "D:\\All\\Gone series is not there any more. Choose another folder.",
    });
    expect(await begin({ mode: "existing", path: "D:\\All\\Old take (2026-10-01)" })).toEqual({
      code: "SESSION_FOLDER_MISSING",
      sentence: "D:\\All\\Old take (2026-10-01) is not there any more. Choose another folder.",
    });
    expect(await sessions()).toEqual({ current: null, last: [] });
  });

  it("makes a simulated run's folders in its scratch folder alone", async () => {
    const scratch = "C:\\Users\\operator\\AppData\\Roaming\\Dev\\Sessions";
    const { call, refused } = openSessionDouble({ places: { root: scratch, simulated: true }, folders: ["D:\\All"] });
    expect(((await call("session.snapshot")) as JsonObject).places).toEqual({
      root: scratch,
      simulated: true,
      rootExists: false,
    });
    expect(await call("session.begin", { kind: "webinar" })).toMatchObject({
      folder: { path: `${scratch}\\${folderLeaf("", "webinar", localDay(new Date(MORNING)))}`, made: true },
    });
    expect(await refused("session.begin", { kind: "webinar", folder: { mode: "new", parent: "D:\\All" } })).toEqual({
      code: "SESSION_FOLDER_OUTSIDE_SCRATCH",
      sentence: `This run makes its folders only in ${scratch}, beside its own saved data.`,
    });
  });

  it("makes the kind's subfolders as the settings name them, and none for a kind with none", async () => {
    const { call, refused } = openSessionDouble();
    await call("session.settings.update", { subfolders: { webinar: [] } });
    await call("session.begin", { kind: "webinar", name: "Bare" });
    const bare = folderOf("webinar", "Bare", MORNING);
    expect(
      (
        await refused("session.begin", {
          kind: "podcast",
          folder: { mode: "existing", path: `${bare}\\vMix Recording` },
        })
      ).code
    ).toBe("SESSION_FOLDER_MISSING");
    await call("session.begin", { kind: "podcast", name: "Full" });
    const full = folderOf("podcast", "Full", MORNING);
    expect(
      await call("session.begin", { kind: "webinar", folder: { mode: "existing", path: `${full}\\Exports` } })
    ).toMatchObject({ folder: { made: false } });
  });
});

describe("the fixture double's session settings (D52)", () => {
  it("writes what an update gives, answers the settings, raises session.changed { settings } and leaves its rows", async () => {
    const { call, events, rows } = openSessionDouble();
    events.length = 0;
    const reply = (await call("session.settings.update", { root: "e:/Studio/Sessions 2026/" })) as JsonObject;
    expect((reply.settings as JsonObject).root).toBe("E:\\Studio\\Sessions 2026");
    expect(events).toEqual([["session.changed", { reason: "settings" }]]);
    expect(((await call("session.snapshot")) as JsonObject).places).toEqual({
      root: "E:\\Studio\\Sessions 2026",
      simulated: false,
      rootExists: false,
    });
    await call("session.settings.update", { subfolders: { webinar: [" Slides ", "Q&A"], podcast: null } });
    await call("session.settings.update", { lowBelowGb: 120, nearlyFullBelowGb: 20 });
    expect(((await call("session.snapshot")) as JsonObject).settings).toEqual({
      ...defaultSessionSettings(),
      root: "E:\\Studio\\Sessions 2026",
      subfolders: { ...defaultSessionSettings().subfolders, webinar: ["Slides", "Q&A"] },
      lowBelowGb: 120,
      nearlyFullBelowGb: 20,
    });
    expect(await rows()).toEqual([
      ["ui", "settings", "root", "Sessions' folder set to E:\\Studio\\Sessions 2026."],
      ["ui", "settings", "subfolders", "Webinar's subfolders: Slides, Q&A."],
      ["ui", "settings", "thresholds", "The disk reads Low under 120 GB and Nearly full under 20 GB."],
    ]);
  });

  it("refuses with the hardware link's codes and sentences, and a refused update changes nothing", async () => {
    const { call, refused, events } = openSessionDouble();
    events.length = 0;
    const update = (params: JsonObject) => refused("session.settings.update", params);
    for (const params of [
      {},
      { root: null },
      { subfolders: {} },
      { rot: "E:\\Sessions" },
      { root: 3 },
      { subfolders: { interview: [] } },
      { subfolders: { podcast: "Audio" } },
      { lowBelowGb: "200" },
    ] as JsonObject[]) {
      expect((await update(params)).code, JSON.stringify(params)).toBe("INVALID_PARAMS");
    }
    for (const [root, sentence] of [
      ["Sessions", "\"Sessions\" is not a folder's full path: it begins with a drive's letter, as D:\\Sessions does."],
      [
        "\\\\172.16.18.28\\Public",
        "The sessions' folder is on a drive with a letter, such as Public (Z:), not a share's path.",
      ],
      ["E:\\Sessions.", '"Sessions." ends with a dot or a space, which Windows leaves out of a folder\'s name.'],
      ["E:\\CON", '"CON" is a name Windows keeps for itself.'],
      [`E:\\${"s".repeat(118)}`, "The sessions' folder's path has at most 120 characters; this one has 121."],
    ]) {
      expect(await update({ root })).toEqual({ code: "SESSION_ROOT_INVALID", sentence });
    }
    const long = "x".repeat(41);
    for (const [names, sentence] of [
      [["a", "b", "c", "d", "e", "f", "g", "h", "i"], "Podcast Recording has at most 8 subfolders; this list has 9."],
      [["Audio", "  "], "A subfolder of Podcast Recording has no name."],
      [[long], `"${long}" has 41 characters: a subfolder's name has at most 40.`],
      [["Exports."], '"Exports." ends with a dot or a space, which Windows leaves out of a folder\'s name.'],
      [[".."], '".." is not a folder\'s name.'],
      [["NUL"], '"NUL" is a name Windows keeps for itself.'],
      [["Audio", "Audio"], 'Podcast Recording has "Audio" twice.'],
      [["Audio", " audio"], 'Podcast Recording has "Audio" and "audio", which Windows takes for one name.'],
    ] as Array<[string[], string]>) {
      expect(await update({ subfolders: { podcast: names } })).toEqual({
        code: "SESSION_SUBFOLDERS_INVALID",
        sentence,
      });
    }
    for (const [params, sentence] of [
      [{ nearlyFullBelowGb: 0 }, "Nearly full is at least 1 GB."],
      [{ lowBelowGb: 40 }, "Low must be above Nearly full: Low under 40 GB, Nearly full under 50 GB."],
      [
        { lowBelowGb: 50, nearlyFullBelowGb: 50 },
        "Low must be above Nearly full: Low under 50 GB, Nearly full under 50 GB.",
      ],
      [{ lowBelowGb: 100_001 }, "Low is at most 100,000 GB."],
      [{ lowBelowGb: 200.5 }, "Low is a whole number of GB; 200.5 is not."],
      [{ nearlyFullBelowGb: -5 }, "Nearly full is at least 1 GB."],
    ] as Array<[JsonObject, string]>) {
      expect(await update(params)).toEqual({ code: "SESSION_THRESHOLDS_INVALID", sentence });
    }
    // The folder first; one part refused writes none of them.
    expect((await update({ root: "Sessions", lowBelowGb: 40 })).code).toBe("SESSION_ROOT_INVALID");
    expect((await update({ root: "E:\\Sessions", subfolders: { podcast: ["NUL"] } })).code).toBe(
      "SESSION_SUBFOLDERS_INVALID"
    );
    expect((await update({ root: "E:\\Sessions", lowBelowGb: 40 })).code).toBe("SESSION_THRESHOLDS_INVALID");
    expect(((await call("session.snapshot")) as JsonObject).settings).toEqual(defaultSessionSettings());
    expect(events, "a refusal raises nothing").toEqual([]);
  });
});

describe("the fixture double's session seed", () => {
  it("starts with the session, the settings, the places and the folders a scenario seeds", async () => {
    const running = session("podcast", "Morning take", MORNING);
    const last = [session("webinar", "Spring launch", "2026-10-14T09:00:00.000Z", "2026-10-14T10:00:00.000Z")];
    const { call } = openSessionDouble({
      current: running,
      last,
      settings: { lowBelowGb: 300 },
      folders: ["D:\\All\\Series (2026-10-01)"],
    });
    expect(await call("session.snapshot")).toEqual({
      current: running,
      last,
      settings: { ...defaultSessionSettings(), lowBelowGb: 300 },
      places: { root: "D:\\Sessions", simulated: false, rootExists: false },
      ...unseededWatch(MORNING),
    });
    expect(
      await call("session.begin", {
        kind: "podcast",
        folder: { mode: "existing", path: "D:\\All\\Series (2026-10-01)" },
      })
    ).toMatchObject({ folder: { made: false } });
    // A session saved before sessions had folders reads with none.
    const { call: older } = openSessionDouble({ current: { ...running, folder: undefined } as unknown as Session });
    expect(((await older("session.snapshot")) as { current: Session }).current.folder).toBeNull();
  });

  it("refuses a seed the hardware link would not read", () => {
    const running = session("podcast", "Morning take", MORNING);
    const last = [session("webinar", "Spring launch", "2026-10-14T09:00:00.000Z", "2026-10-14T10:00:00.000Z")];
    const mistakes: Array<[unknown, string]> = [
      [{ running }, "session: the seed has running, which a seed does not have."],
      [{ current: { ...running, kind: "interview" } }, "session: current's kind must be one of"],
      [{ current: { ...running, name: " Morning take" } }, "session: current's name must be trimmed text."],
      [{ current: { ...running, name: "a".repeat(81) } }, "session: current's name has more than 80 characters."],
      [{ current: { ...running, begunAt: "today" } }, "session: current's begunAt must be a UTC time"],
      [{ current: { ...running, endedAt: NOON } }, "session: current runs: its endedAt is null."],
      [{ current: { ...running, folder: "d:/Sessions/x" } }, "session: current's folder must be a folder's path"],
      [{ last: [running] }, "session: last[0]'s endedAt must be a UTC time."],
      [{ last: [last[0], last[0]] }, "session: last holds one session of each kind at most."],
      [{ settings: { root: "Sessions" } }, "session: settings.root is refused"],
      [{ settings: { subfolders: { podcast: [] } } }, "session: settings.subfolders.green-screen must be a list"],
      [{ settings: { lowBelowGb: 40 } }, "session: settings' levels: Low must be above Nearly full"],
      [{ places: { root: "E:\\Sessions", simulated: false } }, "session: places.root is the settings' root"],
      [{ places: { root: "E:\\Sessions" } }, "session: places.simulated must be true or false."],
      [{ folders: ["D:/All"] }, "session: folders[0] must be a folder's path"],
      [{ current: { ...running, folderBytes: -1 } }, "session: current's folderBytes must be a whole number"],
      [
        { current: { ...running, folder: null, folderBytes: 5 } },
        "session: current has a folder's size and no folder.",
      ],
      [{ recent: "D:\\Sessions" }, "session: recent must be a list."],
      [
        { recent: [{ name: "Other", path: "D:\\Sessions\\Take", createdAt: MORNING, bytes: 0 }] },
        "session: recent[0]'s name is its path's last part.",
      ],
      [
        { recent: [{ name: "Take", path: "D:\\Sessions\\Take", createdAt: "now", bytes: 0 }] },
        "session: recent[0]'s createdAt must be a UTC time.",
      ],
      [{ drives: [{ letter: "A", name: "Floppy", freeBytes: 0, totalBytes: 1 }] }, "session: drives[0]'s letter"],
      [
        { drives: [{ letter: "D", name: "Storage 1", freeBytes: 2, totalBytes: 1 }] },
        "session: drives[0]'s space is whole bytes",
      ],
      [
        {
          drives: [
            { letter: "D", name: "Storage 1", freeBytes: 1, totalBytes: 2 },
            { letter: "D", name: "Again", freeBytes: 1, totalBytes: 2 },
          ],
        },
        "session: drives[1]: D: is there twice.",
      ],
      [{ vmix: { state: "simulated" } }, "session: vmix.state is not-read, answering or not-answering"],
      [{ vmix: { recordnig: true } }, "session: vmix has recordnig, which a seed does not have."],
    ];
    for (const [seed, message] of mistakes) {
      expect(() => openSessionDouble(seed as FixtureSessionSeed), message).toThrow(message);
    }
  });
});

describe("the fixture double's sessions' watch (D52)", () => {
  const ROOT = "D:\\Sessions";
  const LAST_FOLDER = `${ROOT}\\Spring launch (2026-10-14)`;
  const seeded = (): FixtureSessionSeed => ({
    current: { ...session("podcast", "Morning take", MORNING), folderBytes: 18 * GIB },
    last: [
      {
        ...session("webinar", "Spring launch", "2026-10-14T09:00:00.000Z", "2026-10-14T10:00:00.000Z"),
        folder: LAST_FOLDER,
        folderBytes: 22 * GIB,
      },
    ],
    folders: [
      folderOf("podcast", "Morning take", MORNING),
      `${folderOf("podcast", "Morning take", MORNING)}\\Audio`,
      `${folderOf("podcast", "Morning take", MORNING)}\\vMix Recording`,
    ],
    recent: [
      {
        name: folderOf("podcast", "Morning take", MORNING).slice(ROOT.length + 1),
        path: folderOf("podcast", "Morning take", MORNING),
        createdAt: MORNING,
        bytes: 18 * GIB,
      },
      { name: "Spring launch (2026-10-14)", path: LAST_FOLDER, createdAt: "2026-10-14T09:00:00.000Z", bytes: 23 * GIB },
    ],
    drives: [
      { letter: "C", name: "Local Disk", freeBytes: 1_600 * GIB, totalBytes: 3_900 * GIB },
      { letter: "D", name: "Storage 1", freeBytes: 140 * GIB, totalBytes: 3_815 * GIB },
      { letter: "Z", name: "Public", mapped: true, answering: false, freeBytes: 0, totalBytes: 0 },
    ],
    vmix: {
      recording: true,
      file: `${folderOf("podcast", "Morning take", MORNING)}\\vMix Recording\\capture.avi`,
      bytesPerSecond: 13 * 1024 * 1024,
    },
  });

  it("answers the seeded drives with their levels, the newest folders, vMix and where it should record", async () => {
    const { call } = openSessionDouble(seeded());
    const snapshot = (await call("session.snapshot")) as JsonObject;
    const folder = folderOf("podcast", "Morning take", MORNING);
    expect((snapshot.current as JsonObject).folderBytes).toBe(18 * GIB);
    expect((snapshot.last as JsonObject[])[0]?.folderBytes).toBe(22 * GIB);
    expect(snapshot.places).toEqual({ root: ROOT, simulated: false, rootExists: true });
    expect((snapshot.recent as JsonObject[]).map((entry) => entry.path)).toEqual([folder, LAST_FOLDER]);
    expect(snapshot.drives).toEqual([
      {
        letter: "C",
        name: "Local Disk",
        mapped: false,
        answering: true,
        freeBytes: 1_600 * GIB,
        totalBytes: 3_900 * GIB,
        level: "ok",
      },
      {
        letter: "D",
        name: "Storage 1",
        mapped: false,
        answering: true,
        freeBytes: 140 * GIB,
        totalBytes: 3_815 * GIB,
        level: "low",
      },
      { letter: "Z", name: "Public", mapped: true, answering: false, freeBytes: null, totalBytes: null, level: null },
    ]);
    expect(snapshot.sessionDrive).toBe("D");
    expect(snapshot.vmix).toEqual({
      state: "answering",
      recording: true,
      file: `${folder}\\vMix Recording\\capture.avi`,
      inFolder: true,
      bytesPerSecond: 13 * 1024 * 1024,
      recordingFolder: `${folder}\\vMix Recording`,
    });
    expect(snapshot.readAt).toBe(MORNING);
  });

  it("changes vMix and a drive through its hooks, each a read that raises session.changed { read }", async () => {
    const { call, at, events, hooks } = openSessionDouble(seeded());
    const read = async () => (await call("session.snapshot")) as JsonObject;
    events.length = 0;
    at(NOON);
    hooks.setVmix({ recording: false, file: "D:\\All\\Old take (2026-10-01)\\capture.avi" });
    expect(events).toEqual([["session.changed", { reason: "read" }]]);
    expect((await read()).vmix).toMatchObject({ recording: false, inFolder: false, bytesPerSecond: null });
    expect((await read()).readAt).toBe(NOON);
    hooks.setVmix({ state: "not-answering" });
    expect((await read()).vmix).toMatchObject({ state: "not-answering", file: null, inFolder: null });
    hooks.setDrive("D", 28 * GIB);
    expect(((await read()).drives as JsonObject[])[1]).toMatchObject({ freeBytes: 28 * GIB, level: "nearly-full" });
    hooks.setDrive("D", "not-answering");
    expect(((await read()).drives as JsonObject[])[1]).toMatchObject({ answering: false, level: null });
    hooks.setDrive("Z", 3_000 * GIB);
    expect(((await read()).drives as JsonObject[])[2]).toMatchObject({ answering: true, level: "ok" });
    hooks.setDrive("E", "not-there");
    hooks.setDrive("Z", "not-there");
    expect(((await read()).drives as JsonObject[]).map((drive) => drive.letter)).toEqual(["C", "D"]);
    expect(events).toHaveLength(7);
    expect(() => hooks.setDrive("Q", 5)).toThrow("The double has no drive Q:.");
    expect(() => hooks.setVmix({ state: "simulated" as "answering" })).toThrow("vMix's state is one of");
  });

  it("refuses at once a begin on a drive that did not answer, as the hardware link does", async () => {
    const { refused, sessions } = openSessionDouble({
      drives: [{ letter: "D", name: "Storage 1", answering: false, freeBytes: 0, totalBytes: 0 }],
      folders: ["D:\\All\\Series (2026-10-01)"],
    });
    expect(await refused("session.begin", { kind: "podcast", name: "Take" })).toEqual({
      code: "SESSION_DRIVE_MISSING",
      sentence:
        "D: does not answer, so the session's folder cannot be made there. Choose a folder on another drive, or set another sessions' folder in Setup / Support.",
    });
    expect(
      await refused("session.begin", {
        kind: "podcast",
        folder: { mode: "existing", path: "D:\\All\\Series (2026-10-01)" },
      })
    ).toEqual({
      code: "SESSION_DRIVE_MISSING",
      sentence: "D: does not answer, so D:\\All\\Series (2026-10-01) cannot be used. Choose another folder.",
    });
    expect(await sessions()).toEqual({ current: null, last: [] });
  });

  it("puts a begin's new folder first among the newest, and an end keeps the running session's measure", async () => {
    const { call, at } = openSessionDouble(seeded());
    const kept = ((await call("session.snapshot")) as { recent: JsonObject[] }).recent;
    at(NOON);
    const reply = (await call("session.begin", { kind: "webinar", name: "Launch" })) as {
      ended: Session;
      session: Session;
    };
    expect(reply.ended.folderBytes, "the measure the running session had").toBe(18 * GIB);
    expect(reply.session.folderBytes).toBeNull();
    const recent = ((await call("session.snapshot")) as { recent: JsonObject[] }).recent;
    expect(recent[0]).toEqual({
      name: folderLeaf("Launch", "webinar", localDay(new Date(NOON))),
      path: folderOf("webinar", "Launch", NOON),
      createdAt: new Date(NOON).toISOString(),
      bytes: 0,
    });
    expect(recent.slice(1)).toEqual(kept);
    // A folder made elsewhere, or one that was there, is not the sessions' folder's newest.
    await call("session.begin", { kind: "podcast", folder: { mode: "existing", path: LAST_FOLDER } });
    expect(((await call("session.snapshot")) as { recent: JsonObject[] }).recent).toEqual(recent);
    expect(((await call("session.end")) as { ended: Session }).ended.folderBytes).toBeNull();
  });

  it("never says what vMix said in a simulated run", async () => {
    const scratch = "C:\\Users\\operator\\AppData\\Roaming\\Dev\\Sessions";
    const { call, hooks } = openSessionDouble({ places: { root: scratch, simulated: true } });
    hooks.setVmix({ recording: true, file: "D:\\a.avi" });
    expect(((await call("session.snapshot")) as JsonObject).vmix).toEqual({
      state: "simulated",
      recording: false,
      file: null,
      inFolder: null,
      bytesPerSecond: null,
      recordingFolder: null,
    });
    expect(((await call("session.snapshot")) as JsonObject).sessionDrive).toBe("C");
  });

  it("holds its levels, its folders and its paths to the hardware link's rules", () => {
    expect(levelOf(200 * GIB, 200, 50)).toBe("ok");
    expect(levelOf(200 * GIB - 1, 200, 50)).toBe("low");
    expect(levelOf(50 * GIB - 1, 200, 50)).toBe("nearly-full");
    expect(inFolder("d:/sessions/TAKE/a.avi", "D:\\Sessions\\Take")).toBe(true);
    expect(inFolder("D:\\Sessions\\Take", "D:\\Sessions\\Take")).toBe(false);
    expect(inFolder("D:\\Sessions\\Take 2\\a.avi", "D:\\Sessions\\Take")).toBe(false);
    expect(onRoot("D:\\Sessions\\Take", "D:\\Sessions")).toBe(true);
    expect(onRoot("d:\\sessions\\Take", "D:\\Sessions\\")).toBe(true);
    expect(onRoot("D:\\Sessions\\Series\\Take", "D:\\Sessions")).toBe(false);
    expect(onRoot("E:\\Take", "E:\\")).toBe(true);
  });
});
