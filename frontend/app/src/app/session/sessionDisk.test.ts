import { describe, expect, it } from "vitest";

import type { SessionDrive, SessionSnapshot } from "@sse/engine-client";

import {
  bytesWord,
  driveLabel,
  footerDiskWord,
  letterOf,
  levelTone,
  levelWord,
  sessionDriveOf,
  spaceWords,
  usedShare,
} from "./sessionDisk";

// The session's disk (D52): sizes in Explorer's units and to its three
// figures, the drives as the watch last read them, and what the footer's Disk
// says of the session's drive.

const GIB = 1024 ** 3;

/** Storage 1 (D:) on the studio PC, read on 2026-10-19: 2.00 TB free of 3.73 TB, as Explorer writes it. */
const STORAGE_1: SessionDrive = {
  letter: "D",
  name: "Storage 1",
  mapped: false,
  answering: true,
  freeBytes: 2_200_414_797_824,
  totalBytes: 4_096_787_476_480,
  level: "ok",
};

const snapshot = (over: Partial<SessionSnapshot> = {}): SessionSnapshot => ({
  current: null,
  last: [],
  settings: {
    root: "D:\\Sessions",
    subfolders: { "green-screen": [], podcast: [], webinar: [] },
    lowBelowGb: 200,
    nearlyFullBelowGb: 50,
  },
  places: { root: "D:\\Sessions", simulated: false, rootExists: true },
  recent: [],
  drives: [STORAGE_1],
  sessionDrive: "D",
  vmix: {
    state: "answering",
    recording: false,
    file: null,
    inFolder: null,
    bytesPerSecond: null,
    recordingFolder: null,
  },
  readAt: "2026-04-23T07:11:00.000Z",
  ...over,
});

describe("a size, as Explorer writes it", () => {
  it("is three figures in Explorer's units, and one decimal under 10 GB", () => {
    expect(bytesWord(STORAGE_1.freeBytes!)).toBe("2.00 TB");
    expect(bytesWord(STORAGE_1.totalBytes!)).toBe("3.73 TB");
    expect(bytesWord(17_818 * GIB)).toBe("17.4 TB");
    expect(bytesWord(140 * GIB)).toBe("140 GB");
    expect(bytesWord(61 * GIB)).toBe("61 GB");
    expect(bytesWord(9.5 * GIB)).toBe("9.5 GB");
    expect(bytesWord(512 * 1024 ** 2)).toBe("512 MB");
    expect(bytesWord(0)).toBe("0 MB");
  });

  it("goes up a unit at a thousand, as Explorer does", () => {
    expect(bytesWord(999 * GIB)).toBe("999 GB");
    expect(bytesWord(1000 * GIB)).toBe("0.98 TB");
    expect(bytesWord(1000 * 1024 ** 2)).toBe("1.0 GB");
  });
});

describe("a drive", () => {
  it("is named as Explorer names it, and its letter read off a path", () => {
    expect(driveLabel(STORAGE_1)).toBe("Storage 1 (D:)");
    expect(driveLabel({ letter: "E", name: "" })).toBe("E:");
    expect(letterOf("d:\\Sessions")).toBe("D");
    expect(letterOf("\\\\server\\share")).toBeNull();
    expect(letterOf(null)).toBeNull();
  });

  it("says its space, its share used, its level's word and its bar's tone", () => {
    expect(spaceWords(STORAGE_1)).toEqual({ free: "2.00 TB", total: "3.73 TB" });
    expect(usedShare(STORAGE_1)).toBeCloseTo(0.4629, 3);
    expect(spaceWords({ ...STORAGE_1, answering: false, freeBytes: null, totalBytes: null })).toBeNull();
    expect(levelWord("ok")).toBeNull();
    expect(levelWord("low")).toEqual({ word: "Low", tone: "attention" });
    expect(levelWord("nearly-full")).toEqual({ word: "Nearly full", tone: "error" });
    expect([levelTone("ok"), levelTone("low"), levelTone("nearly-full"), levelTone(null)]).toEqual([
      "quiet",
      "attention",
      "error",
      "quiet",
    ]);
  });

  it("is the session's when its letter is the session drive's", () => {
    expect(sessionDriveOf(snapshot())).toBe(STORAGE_1);
    expect(sessionDriveOf(snapshot({ sessionDrive: "Z" }))).toBeNull();
    expect(sessionDriveOf(null)).toBeNull();
  });
});

describe("the footer's Disk", () => {
  it("says the session's drive's free space, in its level's tone", () => {
    expect(footerDiskWord(snapshot())).toEqual({ word: "2.00 TB free on Storage 1" });
    expect(footerDiskWord(snapshot({ drives: [{ ...STORAGE_1, freeBytes: 140 * GIB, level: "low" }] }))).toEqual({
      word: "140 GB free on Storage 1",
      tone: "attention",
    });
    expect(footerDiskWord(snapshot({ drives: [{ ...STORAGE_1, freeBytes: 28 * GIB, level: "nearly-full" }] }))).toEqual(
      { word: "28 GB free on Storage 1", tone: "error" }
    );
  });

  it("says when the drives were not read, and a drive that does not answer or is not there", () => {
    expect(footerDiskWord(null)).toEqual({ word: "not read" });
    expect(footerDiskWord(snapshot({ readAt: null }))).toEqual({ word: "not read" });
    expect(
      footerDiskWord(snapshot({ drives: [{ ...STORAGE_1, answering: false, freeBytes: null, level: null }] }))
    ).toEqual({ word: "D: does not answer", tone: "attention" });
    expect(footerDiskWord(snapshot({ drives: [] }))).toEqual({ word: "D: not there", tone: "error" });
  });
});
