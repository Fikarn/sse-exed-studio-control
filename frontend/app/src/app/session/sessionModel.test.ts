import { describe, expect, it } from "vitest";

import type { Session, SessionSnapshot } from "@sse/engine-client";

import type { OverviewState } from "../overview/overviewModel";
import { SESSION_KINDS, kindOf } from "./kinds";
import {
  NAME_MAX_CHARACTERS,
  begunWord,
  beginHint,
  dayWord,
  kindName,
  lastOf,
  lastTimeWord,
  noteOf,
  runningNote,
  runningOf,
  sinceTodayWord,
  sinceWord,
  trimmedName,
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
  ...over,
});

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
  };

  it("reads the running session and the last of each kind", () => {
    expect(runningOf(snapshot)?.name).toBe("Leading Through Change — episode 3");
    expect(runningOf({ current: null, last: [] })).toBeNull();
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
  it("says it opens the Overview, and which session it ends", () => {
    expect(beginHint(null)).toBe("opens the Overview");
    expect(beginHint(session())).toBe("ends the podcast recording · opens the Overview");
    expect(beginHint(session({ kind: "green-screen" }))).toBe("ends the green screen recording · opens the Overview");
    expect(beginHint(session({ kind: "webinar" }))).toBe("ends the webinar · opens the Overview");
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
