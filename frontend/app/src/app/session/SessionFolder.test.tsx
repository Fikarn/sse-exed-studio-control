import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Session, SessionSnapshot } from "@sse/engine-client";

import { RunningFolderColumn } from "./SessionFolder";

// The running session's right column (D52) for a session begun before
// sessions had folders: a step-1 build's session still running when step 2's
// starts. It says so, offers no folder to open and no vMix line to compare,
// and shows the sessions' folder's drive.

const GIB = 1024 ** 3;

const running: Session = {
  kind: "podcast",
  name: "Leading Through Change — episode 3",
  begunAt: "2026-04-23T06:46:00.000Z",
  endedAt: null,
  folder: null,
  folderBytes: null,
};

const snapshot: SessionSnapshot = {
  current: running,
  last: [],
  settings: {
    root: "D:\\Sessions",
    subfolders: { "green-screen": [], podcast: [], webinar: [] },
    lowBelowGb: 200,
    nearlyFullBelowGb: 50,
  },
  places: { root: "D:\\Sessions", simulated: false, rootExists: false },
  recent: [],
  drives: [
    {
      letter: "D",
      name: "Storage 1",
      mapped: false,
      answering: true,
      freeBytes: 140 * GIB,
      totalBytes: 4_096_787_476_480,
      level: "low",
    },
  ],
  // The running session has no folder: the session's drive is the sessions' folder's.
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
};

describe("the running session's folder", () => {
  afterEach(cleanup);

  it("says a session from before folders has none, and shows the sessions' folder's drive", () => {
    render(
      <RunningFolderColumn snapshot={snapshot} running={running} last={null} onOpen={() => {}} onCopy={() => {}} />
    );
    expect(screen.getByTestId("session-folder-well").textContent).toBe(
      "This session began before sessions had folders."
    );
    expect(screen.queryByTestId("session-folder-open")).toBeNull();
    expect(screen.queryByTestId("session-vmix")).toBeNull();
    const disk = screen.getByTestId("session-disk");
    expect(disk.textContent).toContain("Storage 1 (D:)");
    expect(disk.textContent).toContain("140 GB free of 3.73 TB");
    expect(screen.getByTestId("session-disk-line").textContent).toBe("Low");
  });
});
