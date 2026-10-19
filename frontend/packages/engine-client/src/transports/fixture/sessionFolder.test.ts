import { describe, expect, it } from "vitest";

import table from "../../../../../../native/protocol/session-folder-names.json" with { type: "json" };
import type { SessionKind } from "../../generated/snapshots/SessionKind";
import { folderLeaf, localDay, nameProblem, readDrivePath } from "./sessionFolder";

// The double's folder names and paths (D52), held to the hardware link's: the shared case
// table, which `native/rust-engine/src/session/tests_folder.rs` reads too, and the paths and
// names Windows takes, as `folder.rs` reads them.

describe("the session folder's name", () => {
  it.each(table.cases)("$name ($kind) is $leaf", ({ name, kind, day, leaf }) => {
    expect(folderLeaf(name, kind as SessionKind, day)).toBe(leaf);
  });

  it("has the table's cases", () => {
    expect(table.cases.length).toBeGreaterThanOrEqual(15);
  });

  it("takes the local day", () => {
    expect(localDay(new Date(2026, 9, 18, 0, 5))).toBe("2026-10-18");
    expect(localDay(new Date(2026, 0, 3, 23, 55))).toBe("2026-01-03");
  });
});

describe("a path as Windows writes it", () => {
  it("is read with / as \\, no \\ at its end and the drive's letter in capitals", () => {
    expect(readDrivePath("D:\\Sessions")).toEqual({ path: "D:\\Sessions" });
    expect(readDrivePath("d:/Sessions/")).toEqual({ path: "D:\\Sessions" });
    expect(readDrivePath("Z:\\Studio\\Series 2\\\\")).toEqual({ path: "Z:\\Studio\\Series 2" });
    expect(readDrivePath("E:\\")).toEqual({ path: "E:\\" });
    expect(readDrivePath("\\\\server\\share")).toEqual({ share: true });
    expect(readDrivePath("E:")).toEqual({
      shape: "\"E:\" is not a folder's full path: it begins with a drive's letter, as D:\\Sessions does.",
    });
  });

  it.each([
    "",
    "Sessions",
    "1:\\Sessions",
    "D:Sessions",
    "D:\\a\\..\\b",
    "D:\\a\\.",
    "D:\\a\\\\b",
    "\\\\?\\D:\\Sessions",
    "\\\\.\\D:\\Sessions",
    "D:\\a|b",
    "D:\\a\u0001b",
    "D:\\Sessions.",
    "D:\\Sessions ",
    "D:\\NUL",
    "D:\\com1.txt",
  ])("refuses %j", (text) => {
    expect(readDrivePath(text)).toHaveProperty("shape");
  });

  it("says why Windows would not take a name", () => {
    for (const good of ["Audio", "vMix Recording", ".hidden", "CONSOLE", "COM10", "Q&A"]) {
      expect(nameProblem(good), good).toBeNull();
    }
    expect(nameProblem("Exports.")).toBe(
      '"Exports." ends with a dot or a space, which Windows leaves out of a folder\'s name.'
    );
    expect(nameProblem("aux")).toBe('"aux" is a name Windows keeps for itself.');
    expect(nameProblem("Lpt3 .wav")).toBe('"Lpt3 .wav" is a name Windows keeps for itself.');
    expect(nameProblem("..")).toBe('".." is not a folder\'s name.');
    expect(nameProblem("Audio/Video")).toContain("a control character");
  });
});
