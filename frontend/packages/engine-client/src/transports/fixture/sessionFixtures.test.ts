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

const GIB = 1024 ** 3;

/** The studio PC's four drives, as the double's watch reads them: D: 2.00 TB free of 3.73 TB. */
const STUDIO_DRIVES = [
  {
    letter: "C",
    name: "Local Disk",
    mapped: false,
    answering: true,
    freeBytes: 1_628 * GIB,
    totalBytes: 3_901 * GIB,
    level: "ok",
  },
  {
    letter: "D",
    name: "Storage 1",
    mapped: false,
    answering: true,
    freeBytes: 2_200_414_797_824,
    totalBytes: 4_096_787_476_480,
    level: "ok",
  },
  {
    letter: "E",
    name: "A015",
    mapped: false,
    answering: true,
    freeBytes: 308 * GIB,
    totalBytes: 931 * GIB,
    level: "ok",
  },
  {
    letter: "Z",
    name: "Public",
    mapped: true,
    answering: true,
    freeBytes: 3_789 * GIB,
    totalBytes: 17_818 * GIB,
    level: "ok",
  },
];

/** vMix's last recording, a week before, in the old sessions' folder. */
const VMIX_LAST_FILE =
  "D:\\All\\Leading Through Change — episode 1 (2026-04-15)\\vMix Recording\\capture - 15 April 2026 - 02-05-11 pm.avi";

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
      const podcast = "D:\\Sessions\\Leading Through Change — episode 2 (2026-04-22)";
      const lecture = "D:\\Sessions\\Strategy in Practice — lecture 3 (2026-04-21)";
      expect(await read("session.snapshot")).toEqual({
        current: null,
        last: [
          {
            kind: "podcast",
            name: "Leading Through Change — episode 2",
            begunAt: "2026-04-22T12:02:00.000Z",
            endedAt: "2026-04-22T13:16:00.000Z",
            folder: podcast,
            folderBytes: 61 * GIB,
          },
          {
            kind: "green-screen",
            name: "Strategy in Practice — lecture 3",
            begunAt: "2026-04-21T08:30:00.000Z",
            endedAt: "2026-04-21T09:52:00.000Z",
            folder: lecture,
            folderBytes: 66 * GIB,
          },
        ],
        // The settings' defaults (D52), and the studio's places.
        settings: {
          root: "D:\\Sessions",
          subfolders: {
            "green-screen": ["Video", "vMix Recording", "Script", "Exports"],
            podcast: ["Audio", "Video", "vMix Recording", "Exports"],
            webinar: ["Slides", "vMix Recording", "Exports"],
          },
          lowBelowGb: 200,
          nearlyFullBelowGb: 50,
        },
        places: { root: "D:\\Sessions", simulated: false, rootExists: true },
        // What the watch read (D52): the sessions' folders, newest first, the studio PC's
        // drives with D: well above Low, and vMix's last file, from the week before.
        recent: [
          {
            name: "Leading Through Change — episode 2 (2026-04-22)",
            path: podcast,
            createdAt: "2026-04-22T12:02:00.000Z",
            bytes: 61 * GIB,
          },
          {
            name: "Strategy in Practice — lecture 3 (2026-04-21)",
            path: lecture,
            createdAt: "2026-04-21T08:30:00.000Z",
            bytes: 66 * GIB,
          },
        ],
        drives: STUDIO_DRIVES,
        sessionDrive: "D",
        vmix: {
          state: "answering",
          recording: false,
          file: VMIX_LAST_FILE,
          inFolder: null,
          bytesPerSecond: null,
          recordingFolder: null,
        },
        readAt: new Date(FIXTURE_NOW).toISOString(),
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
      const running = "D:\\Sessions\\Leading Through Change — episode 3 (2026-04-23)";
      expect(session.current).toEqual({
        kind: "podcast",
        name: "Leading Through Change — episode 3",
        begunAt: "2026-04-23T06:46:00.000Z",
        endedAt: null,
        folder: running,
        folderBytes: 18 * GIB,
      });
      expect((session.last as JsonObject[]).map((last) => last.kind)).toEqual(["podcast", "green-screen", "webinar"]);
      expect((session.last as JsonObject[]).map((last) => last.folder)).toEqual([
        "D:\\Sessions\\Leading Through Change — episode 2 (2026-04-22)",
        "D:\\Sessions\\Strategy in Practice — lecture 3 (2026-04-21)",
        "D:\\Sessions\\Markets Outlook, spring (2026-04-17)",
      ]);
      expect((session.last as JsonObject[]).map((last) => last.folderBytes)).toEqual([61 * GIB, 66 * GIB, 21 * GIB]);
      expect(session.places).toEqual({ root: "D:\\Sessions", simulated: false, rootExists: true });
      expect((session.recent as JsonObject[]).map((entry) => entry.path)).toEqual([
        running,
        "D:\\Sessions\\Leading Through Change — episode 2 (2026-04-22)",
        "D:\\Sessions\\Strategy in Practice — lecture 3 (2026-04-21)",
        "D:\\Sessions\\Markets Outlook, spring (2026-04-17)",
      ]);
      expect(session.drives).toEqual(STUDIO_DRIVES);
      expect(session.sessionDrive).toBe("D");
      // vMix records nothing, and its last file is not in the running session's folder,
      // whose vMix Recording is where it should record.
      expect(session.vmix).toEqual({
        state: "answering",
        recording: false,
        file: VMIX_LAST_FILE,
        inFolder: false,
        bytesPerSecond: null,
        recordingFolder: `${running}\\vMix Recording`,
      });
      expect(await read("audio.snapshot")).toMatchObject({
        verified: true,
        meteringState: "live",
        consoleStateConfidence: "aligned",
        lastConsoleSyncAt: "2026-04-23T08:38:12+02:00",
      });
    }
  );
});
