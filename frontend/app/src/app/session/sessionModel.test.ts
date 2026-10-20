import { describe, expect, it } from "vitest";

import type { Session, SessionKind, SessionSnapshot, SessionVmix } from "@sse/engine-client";

import table from "../../../../../native/protocol/session-folder-names.json" with { type: "json" };
import type { OverviewState } from "../overview/overviewModel";
import { SESSION_KINDS, kindOf } from "./kinds";
import {
  NAME_MAX_CHARACTERS,
  NEW_FOLDER,
  begunWord,
  beginHint,
  chosenRow,
  dayWord,
  durationWord,
  existingRows,
  folderLeaf,
  folderRequest,
  kindName,
  lastOf,
  lastRateLine,
  lastsWord,
  lastTimeWord,
  leafOf,
  localDay,
  noteOf,
  parentLine,
  parentPath,
  pathIn,
  refusalWords,
  runningNote,
  runningOf,
  samePath,
  sessionRate,
  sinceTodayWord,
  sinceWord,
  trimmedName,
  vmixLine,
  vmixRateLine,
} from "./sessionModel";

// The Session page's model (D51): the day, when a session began, the last of
// each kind, Begin's hint and the window's note. The times are built in local
// time and handed over as the hardware link writes them, UTC text, so the
// words hold in any time zone.

/** Thursday 15 October 2026, 09:41 local time: the boards' morning. */
const NOW = new Date(2026, 9, 15, 9, 41);
const at = (day: number, hours: number, minutes: number) => new Date(2026, 9, day, hours, minutes).toISOString();

const session = (over: Partial<Session> = {}): Session => ({
  kind: "podcast",
  name: "Leading Through Change — episode 3",
  begunAt: at(15, 9, 16),
  endedAt: null,
  folder: "D:\\Sessions\\Leading Through Change — episode 3 (2026-10-15)",
  folderBytes: null,
  ...over,
});

/** What the session's read holds beside the sessions (D52): the settings' defaults, the
 *  studio's places, and the watch's parts before its first read. */
const READ: Omit<SessionSnapshot, "current" | "last"> = {
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
  places: { root: "D:\\Sessions", simulated: false, rootExists: false },
  recent: [],
  drives: [],
  sessionDrive: "D",
  vmix: {
    state: "not-read",
    recording: false,
    file: null,
    inFolder: null,
    bytesPerSecond: null,
    recordingFolder: null,
  },
  readAt: null,
};

describe("the kinds", () => {
  it("are the owner's three, in the page's order, each with its tone and line", () => {
    expect(SESSION_KINDS.map((kind) => [kind.id, kind.name, kind.tone])).toEqual([
      ["green-screen", "Green Screen Recording", "green"],
      ["podcast", "Podcast Recording", "umber"],
      ["webinar", "Webinar", "slate"],
    ]);
    expect(SESSION_KINDS.map((kind) => kind.line)).toEqual([
      "A presenter at the screen, with the prompter.",
      "Voices around the table, a camera on each.",
      "Live, to an audience online.",
    ]);
    expect(kindOf("webinar")?.inSentence).toBe("webinar");
    expect(kindOf("unknown" as never)).toBeUndefined();
    expect(kindName("unknown" as never)).toBe("unknown");
  });
});

describe("the day and the times", () => {
  it("says the day as the question does", () => {
    expect(dayWord(NOW)).toBe("Thursday 15 October");
    expect(dayWord(NOW.getTime())).toBe("Thursday 15 October");
  });

  it("says since when on the day, in the week before, and before that", () => {
    expect(sinceWord(at(15, 9, 16), NOW)).toBe("since 09:16");
    expect(sinceWord(at(14, 14, 2), NOW)).toBe("since Wed 14:02");
    expect(sinceWord(at(9, 8, 0), NOW)).toBe("since Fri 08:00");
    expect(sinceWord(at(7, 14, 2), NOW)).toBe("since 7 Oct 14:02");
    expect(sinceTodayWord(at(15, 9, 16), NOW)).toBe("since 09:16 today");
    expect(sinceTodayWord(at(14, 14, 2), NOW)).toBe("since Wed 14:02");
  });

  it("says when the running session began", () => {
    expect(begunWord(at(15, 9, 16), NOW)).toBe("Begun at 09:16");
    expect(begunWord(at(14, 14, 2), NOW)).toBe("Begun on Wednesday 14 October at 14:02");
  });

  it("says nothing of a time it cannot read", () => {
    for (const begunAt of ["", "not a time", null, undefined]) {
      expect(sinceWord(begunAt, NOW)).toBeNull();
      expect(sinceTodayWord(begunAt, NOW)).toBeNull();
      expect(begunWord(begunAt, NOW)).toBeNull();
    }
    expect(lastTimeWord(session({ begunAt: "not a time" }), NOW)).toBe("Last time");
  });

  it("says the last session's day", () => {
    expect(lastTimeWord(session({ begunAt: at(14, 14, 2) }), NOW)).toBe("Last time · Wednesday 14 October");
    expect(lastTimeWord(session({ begunAt: at(15, 8, 30) }), NOW)).toBe("Last time · today");
  });
});

describe("the session read", () => {
  const snapshot: SessionSnapshot = {
    current: session(),
    last: [
      session({ kind: "podcast", name: "Episode 2", begunAt: at(14, 14, 2), endedAt: at(14, 15, 30) }),
      session({ kind: "green-screen", name: "Lecture 3", begunAt: at(13, 10, 0), endedAt: at(13, 11, 0) }),
    ],
    ...READ,
  };

  it("reads the running session and the last of each kind", () => {
    expect(runningOf(snapshot)?.name).toBe("Leading Through Change — episode 3");
    expect(runningOf({ current: null, last: [], ...READ })).toBeNull();
    expect(lastOf(snapshot, "podcast")?.name).toBe("Episode 2");
    expect(lastOf(snapshot, "green-screen")?.name).toBe("Lecture 3");
    expect(lastOf(snapshot, "webinar")).toBeNull();
  });

  it("reads nothing before the session is read", () => {
    expect(runningOf(null)).toBeNull();
    expect(lastOf(null, "podcast")).toBeNull();
  });
});

describe("what Begin does", () => {
  it("says it makes or uses the folder and opens the Overview, and which session it ends", () => {
    expect(beginHint(null)).toBe("makes the folder · opens the Overview");
    expect(beginHint(null, "uses")).toBe("uses the folder · opens the Overview");
    expect(beginHint(session())).toBe("ends the podcast recording · makes the folder · opens the Overview");
    expect(beginHint(session({ kind: "green-screen" }))).toBe(
      "ends the green screen recording · makes the folder · opens the Overview"
    );
    expect(beginHint(session({ kind: "webinar" }), "uses")).toBe(
      "ends the webinar · uses the folder · opens the Overview"
    );
  });

  it("names the session another Room's Begin ends", () => {
    expect(runningNote(session(), NOW)).toBe("Podcast Recording, since 09:16. Beginning this ends it.");
    expect(runningNote(session({ begunAt: "?" }), NOW)).toBe("Podcast Recording. Beginning this ends it.");
  });

  it("trims a name as the hardware link does, and keeps a byte-order mark it keeps", () => {
    expect(trimmedName("  Morning take \n")).toBe("Morning take");
    expect(trimmedName("　\u0085Take ")).toBe("Take");
    expect(trimmedName("   ")).toBe("");
    expect(trimmedName("﻿Take")).toBe("﻿Take");
    expect(NAME_MAX_CHARACTERS).toBe(80);
  });
});

describe("the window's note", () => {
  const state = (over: Partial<OverviewState>): OverviewState => ({
    tone: "ok",
    word: "READY",
    sentence: "Every link answers. Nothing on any page needs you.",
    meta: null,
    wayOut: null,
    lamp: null,
    room: null,
    ...over,
  });

  it("is none while every page is ready", () => {
    expect(noteOf(state({}))).toBeNull();
  });

  it("mirrors the worst page's word, sentence and way out", () => {
    expect(
      noteOf(
        state({
          tone: "attention",
          word: "ASSUMED",
          sentence: "Console: the strips may not match TotalMix since the start.",
          wayOut: { kind: "sync", label: "Sync from TotalMix" },
          lamp: "audio",
        })
      )
    ).toEqual({
      tone: "attention",
      word: "ASSUMED",
      sentence: "Console: the strips may not match TotalMix since the start.",
      wayOut: { kind: "sync", label: "Sync from TotalMix" },
    });
    expect(
      noteOf(
        state({ tone: "error", word: "UNREACHABLE", wayOut: { kind: "open", page: "cameras", label: "Open Cameras" } })
      )?.wayOut
    ).toEqual({ kind: "open", page: "cameras", label: "Open Cameras" });
  });
});

// Step 2 (D52): the session's folder, how long the disk lasts, and vMix.

describe("the new folder's name", () => {
  // The case table the hardware link and the double read too.
  it.each(table.cases)("$name ($kind) is $leaf", ({ name, kind, day, leaf }) => {
    expect(folderLeaf(trimmedName(name), kind as SessionKind, day)).toBe(leaf);
  });

  it("ends with the local day", () => {
    expect(localDay(new Date(2026, 9, 18, 0, 5))).toBe("2026-10-18");
    expect(localDay(new Date(2026, 0, 3, 23, 55).getTime())).toBe("2026-01-03");
  });
});

describe("a folder's path", () => {
  it("is joined, split and compared as Windows writes it", () => {
    expect(pathIn("D:\\Sessions", "Take (2026-10-18)")).toBe("D:\\Sessions\\Take (2026-10-18)");
    expect(pathIn("D:\\", "Sessions")).toBe("D:\\Sessions");
    expect(leafOf("D:\\Sessions\\Take (2026-10-18)\\")).toBe("Take (2026-10-18)");
    expect(parentPath("D:\\Sessions\\Take (2026-10-18)")).toBe("D:\\Sessions");
    expect(parentPath("D:\\Sessions")).toBe("D:\\");
    expect(parentLine("D:\\Sessions")).toBe("D:\\Sessions\\");
    expect(parentLine("D:\\")).toBe("D:\\");
    expect(samePath("d:/sessions/", "D:\\Sessions")).toBe(true);
    expect(samePath("D:\\Sessions", "D:\\Sessions 2")).toBe(false);
    expect(samePath(null, "D:\\Sessions")).toBe(false);
  });
});

describe("how long the disk lasts", () => {
  it("says a session's length and the time left as the board does", () => {
    expect(durationWord(80 * 60_000)).toBe("1 h 20 min");
    expect(durationWord(65 * 60_000)).toBe("1 h 05 min");
    expect(durationWord(55 * 60_000)).toBe("55 min");
    expect(lastsWord(45.3)).toBe("about 45 h");
    expect(lastsWord(9.99)).toBe("about 10 h");
    expect(lastsWord(3.06)).toBe("about 3 h 05 min");
    expect(lastsWord(0.6)).toBe("about 35 min");
    expect(lastsWord(0.03)).toBe("under 5 min");
  });

  it("reads the rate of the kind's last session: its folder's size over its length", () => {
    const last = session({
      begunAt: at(14, 12, 0),
      endedAt: at(14, 13, 20),
      folderBytes: 61 * 1024 ** 3,
    });
    expect(sessionRate(last)?.bytesPerHour).toBeCloseTo((61 * 1024 ** 3) / (80 / 60));
    expect(lastRateLine(last, 2050 * 1024 ** 3)).toBe(
      "about 45 h at the rate of the last podcast recording (61 GB in 1 h 20 min)"
    );
    expect(lastRateLine({ ...last, kind: "green-screen" }, 140 * 1024 ** 3)).toBe(
      "about 3 h 05 min at the rate of the last green screen recording (61 GB in 1 h 20 min)"
    );
    // None from a session still running, one without a measure, or one under 10 minutes.
    expect(lastRateLine(session(), 2050 * 1024 ** 3)).toBeNull();
    expect(lastRateLine({ ...last, folderBytes: null }, 2050 * 1024 ** 3)).toBeNull();
    expect(lastRateLine({ ...last, folderBytes: 0 }, 2050 * 1024 ** 3)).toBeNull();
    expect(lastRateLine({ ...last, endedAt: at(14, 12, 9) }, 2050 * 1024 ** 3)).toBeNull();
    expect(lastRateLine(null, 2050 * 1024 ** 3)).toBeNull();
  });

  it("reads vMix's write rate while it records onto the drive", () => {
    expect(vmixRateLine(13 * 1024 ** 2, 140 * 1024 ** 3)).toBe(
      "vMix writes 13 MB/s to it now: about 3 h 05 min at this rate"
    );
    expect(vmixRateLine(9.5 * 1024 ** 2, 140 * 1024 ** 3)).toMatch(/^vMix writes 9\.5 MB\/s to it now: /);
  });
});

describe("vMix's line in the running session's window", () => {
  const FOLDER = "D:\\Sessions\\Leading Through Change — episode 3 (2026-04-23)";
  const HERE = `${FOLDER}\\vMix Recording`;
  const ELSEWHERE = "D:\\All\\Episode 1 (2026-04-15)\\vMix Recording";
  const vmix = (over: Partial<SessionVmix>): SessionVmix => ({
    state: "answering",
    recording: false,
    file: null,
    inFolder: null,
    bytesPerSecond: null,
    recordingFolder: HERE,
    ...over,
  });

  it("says where vMix records, or recorded last, and offers the path when it is not here", () => {
    expect(vmixLine(vmix({ recording: true, file: `${HERE}\\capture.avi`, inFolder: true }), FOLDER)).toEqual({
      tone: "ok",
      sentence: "vMix records into this folder's vMix Recording.",
      copy: false,
    });
    expect(vmixLine(vmix({ recording: true, file: `${FOLDER}\\capture.avi`, inFolder: true }), FOLDER).sentence).toBe(
      "vMix records into this folder."
    );
    expect(vmixLine(vmix({ recording: true, file: `${ELSEWHERE}\\capture.avi`, inFolder: false }), FOLDER)).toEqual({
      tone: "attention",
      sentence: `vMix records to ${ELSEWHERE}, not here.`,
      copy: true,
    });
    expect(vmixLine(vmix({ file: `${HERE}\\capture.avi`, inFolder: true }), FOLDER)).toEqual({
      tone: "ok",
      sentence: "vMix's last recording is in this folder.",
      copy: false,
    });
    expect(vmixLine(vmix({ file: `${ELSEWHERE}\\capture.avi`, inFolder: false }), FOLDER)).toEqual({
      tone: "attention",
      sentence: `vMix's last recording went to ${ELSEWHERE}. Set its Recording folder to this one before you record.`,
      copy: true,
    });
  });

  it("says when vMix names no file, does not answer, is not read yet or not read in this run", () => {
    expect(vmixLine(vmix({}), FOLDER)).toEqual({
      tone: "off",
      sentence: "vMix has not recorded since it started: set its Recording folder to this one.",
      copy: true,
    });
    expect(vmixLine(vmix({ state: "not-answering" }), FOLDER).sentence).toBe(
      "vMix does not answer: where it records is not known."
    );
    expect(vmixLine(vmix({ state: "not-read" }), FOLDER).sentence).toBe("vMix has not been read yet.");
    expect(vmixLine(vmix({ state: "simulated" }), FOLDER)).toEqual({
      tone: "off",
      sentence: "vMix is not read in this run.",
      copy: true,
    });
    expect(vmixLine(vmix({ recordingFolder: null }), FOLDER).copy).toBe(false);
  });
});

describe("the folder a session begins in", () => {
  const LAST = "D:\\Sessions\\Leading Through Change — episode 2 (2026-04-22)";
  const NEWEST = "D:\\Sessions\\Strategy in Practice — lecture 3 (2026-04-21)";
  const OLDER = "D:\\Sessions\\Markets Outlook, spring (2026-04-17)";
  const entry = (path: string, bytes: number | null) => ({
    name: leafOf(path),
    path,
    createdAt: "2026-04-21T08:30:00.000Z",
    bytes,
  });
  const read: SessionSnapshot = {
    current: null,
    last: [
      session({ name: "Episode 2", begunAt: at(14, 14, 2), endedAt: at(14, 15, 30), folder: LAST, folderBytes: 61 }),
    ],
    ...READ,
    recent: [entry(LAST, 60), entry(NEWEST, 66), entry(OLDER, 21)],
  };

  it("offers the kind's last folder first, then the newest other one; the dialog's folder takes the second place", () => {
    expect(existingRows(read, "podcast", null)).toEqual([
      { path: LAST, bytes: 61 },
      { path: NEWEST, bytes: 66 },
    ]);
    expect(existingRows(read, "webinar", null)).toEqual([
      { path: LAST, bytes: 60 },
      { path: NEWEST, bytes: 66 },
    ]);
    expect(existingRows(read, "podcast", "D:\\All\\Series (2026-04-01)")).toEqual([
      { path: LAST, bytes: 61 },
      { path: "D:\\All\\Series (2026-04-01)", bytes: null },
    ]);
    expect(existingRows(read, "podcast", LAST.toLowerCase())).toHaveLength(2);
    expect(existingRows({ ...read, last: [], recent: [] }, "podcast", null)).toEqual([]);
    expect(existingRows(null, "podcast", "D:\\All\\Series")).toEqual([{ path: "D:\\All\\Series", bytes: null }]);
  });

  it("is sent with Begin: a new one, in a folder chosen, or one that exists", () => {
    const rows = existingRows(read, "podcast", null);
    expect(folderRequest(NEW_FOLDER, rows)).toEqual({ mode: "new" });
    expect(folderRequest({ ...NEW_FOLDER, parent: "D:\\All\\Series" }, rows)).toEqual({
      mode: "new",
      parent: "D:\\All\\Series",
    });
    expect(folderRequest({ ...NEW_FOLDER, mode: "existing" }, rows)).toEqual({ mode: "existing", path: LAST });
    expect(folderRequest({ ...NEW_FOLDER, mode: "existing", picked: NEWEST }, rows)).toEqual({
      mode: "existing",
      path: NEWEST,
    });
    expect(folderRequest({ ...NEW_FOLDER, mode: "existing" }, [])).toBeNull();
    expect(chosenRow(rows, "d:\\sessions\\strategy in practice — lecture 3 (2026-04-21)")).toBe(1);
    expect(chosenRow(rows, "D:\\Gone")).toBe(0);
  });
});

describe("a shell's refusal", () => {
  it("is said in the operator's words, its code left out", () => {
    expect(refusalWords(new Error("NO_SESSION_FOLDER: No session runs, so it has no folder to open."), "x")).toBe(
      "No session runs, so it has no folder to open."
    );
    expect(refusalWords(new Error("Windows' folder dialog did not open."), "x")).toBe(
      "Windows' folder dialog did not open."
    );
    expect(refusalWords(null, "The folder was not opened.")).toBe("The folder was not opened.");
  });
});
