import { describe, expect, it } from "vitest";

import type {
  PrompterGlassSnapshot,
  PrompterGlassSummary,
  PrompterHealthCheck,
  PrompterScreenSummary,
  PrompterScriptSummary,
  PrompterSnapshot,
} from "@sse/engine-client";

import { glassParagraphs } from "./glass/glassText";
import { INTERVIEW_INTRO, paragraph, standardLook, storyAnchor } from "./glass/glassStoryScript";
import { formatDuration } from "./prompterTime";
import {
  glassTextOf,
  paragraphAt,
  paragraphRows,
  paragraphWindow,
  placeView,
  playLockReason,
  prompterStateView,
  readWordsOf,
  scriptBar,
  scriptDetail,
  screenMode,
} from "./teleprompterModel";

// The Teleprompter page's model (new pages program, Slice 6a): what the page
// shows, read from the hardware link's figures and words.

function screen(overrides: Partial<PrompterScreenSummary> = {}): PrompterScreenSummary {
  return {
    state: "connected",
    word: "CONNECTED",
    tone: "ok",
    reported: true,
    draws: true,
    width: 1920,
    height: 1080,
    refreshHz: 60,
    windowError: null,
    sentence: "The Prompter XL is connected: 1920×1080 at 60 Hz.",
    ...overrides,
  };
}

function glass(overrides: Partial<PrompterGlassSummary> = {}): PrompterGlassSummary {
  return {
    scriptId: "script-2",
    name: "02 Interview intro",
    layoutKey: "g1-l0",
    laidOut: true,
    notUpdated: false,
    speedWpm: 140,
    place: { paragraph: 7, word: 0 },
    paragraphCount: 18,
    playing: false,
    atEnd: false,
    timeLeftSeconds: 150,
    lengthSeconds: 259,
    estimated: false,
    cues: [],
    anchor: storyAnchor({ layoutKey: "g1-l0" }),
    ...overrides,
  };
}

function snapshot(overrides: Partial<PrompterSnapshot> = {}): PrompterSnapshot {
  return {
    look: standardLook(),
    sizePx: 88,
    glass: glass(),
    scripts: [],
    removed: [],
    screen: screen(),
    ...overrides,
  };
}

describe("the state display", () => {
  it("says what is on the glass and what it is doing, ON SCREEN", () => {
    expect(prompterStateView(snapshot(), null, true)).toEqual({
      tone: "ok",
      word: "ON SCREEN",
      sentence: "The Prompter XL shows 02 Interview intro. Paused at paragraph 8 of 18.",
      meta: "1920×1080 · 60 Hz",
      wayOut: null,
    });
    expect(prompterStateView(snapshot({ glass: glass({ playing: true }) }), null, true).sentence).toBe(
      "The Prompter XL shows 02 Interview intro. Playing at 140 words a minute."
    );
    expect(prompterStateView(snapshot({ glass: glass({ atEnd: true }) }), null, true).sentence).toBe(
      "The Prompter XL shows 02 Interview intro. At the end."
    );
  });

  it("is READY with the way out Put on while the glass is blank", () => {
    const blank = prompterStateView(snapshot({ glass: null }), null, true);
    expect(blank).toMatchObject({ tone: "ok", word: "READY", wayOut: "put-on" });
    expect(prompterStateView(snapshot({ glass: null }), null, false).wayOut).toBeNull();
  });

  it("puts the Prompter XL's fault first, in the hardware link's word and sentence", () => {
    const gone = screen({
      state: "not-connected",
      word: "NOT CONNECTED",
      tone: "error",
      draws: false,
      width: null,
      height: null,
      refreshHz: null,
      sentence: "Windows does not see the Prompter XL.",
    });
    expect(prompterStateView(snapshot({ screen: gone, glass: glass({ notUpdated: true }) }), null, true)).toEqual({
      tone: "error",
      word: "NOT CONNECTED",
      sentence: "Windows does not see the Prompter XL.",
      meta: null,
      wayOut: null,
    });
  });

  it("says NOT UPDATED with the check's sentence, and offers Update", () => {
    const check = {
      ok: false,
      status: "attention",
      word: "NOT UPDATED",
      summary:
        "02 Interview intro was edited after it went on the prompter. The prompter still shows the earlier text.",
      notUpdated: true,
      screen: screen(),
    } as PrompterHealthCheck;
    expect(prompterStateView(snapshot({ glass: glass({ notUpdated: true }) }), check, true)).toMatchObject({
      tone: "attention",
      word: "NOT UPDATED",
      sentence: check.summary,
      wayOut: "update",
    });
  });

  it("says LOW RESOLUTION in attention while the glass is drawn soft", () => {
    const low = screen({
      state: "low-resolution",
      word: "LOW RESOLUTION",
      tone: "attention",
      width: 1280,
      height: 720,
    });
    expect(prompterStateView(snapshot({ screen: low }), null, true)).toMatchObject({
      tone: "attention",
      word: "LOW RESOLUTION",
      meta: "1280×720 · 60 Hz",
    });
    expect(screenMode(snapshot({ screen: screen({ refreshHz: null }) }))).toBe("1920×1080");
  });
});

describe("the copy's text", () => {
  const glassSnapshot = (overrides: Partial<PrompterGlassSnapshot> = {}): PrompterGlassSnapshot => ({
    scriptId: "script-2",
    name: "02 Interview intro",
    layoutKey: "g1-l0",
    paragraphs: [paragraph("One two three.")],
    look: standardLook(),
    sizePx: 88,
    anchor: null,
    ...overrides,
  });

  it("draws the text in the key it arrived with, its geometry with it, and the take's colours now", () => {
    const now = snapshot({ look: standardLook({ textColour: "yellow", lineSpacingPercent: 160 }), sizePx: 96 });
    const text = glassTextOf(now, glassSnapshot());
    expect(text?.layoutKey).toBe("g1-l0");
    expect(text?.sizePx).toBe(88);
    expect(text?.look.lineSpacingPercent).toBe(140);
    expect(text?.look.textColour).toBe("yellow");
  });

  it("draws nothing while nothing is on the prompter", () => {
    expect(glassTextOf(snapshot({ glass: null }), glassSnapshot())).toBeNull();
    expect(glassTextOf(snapshot(), glassSnapshot({ layoutKey: null }))).toBeNull();
  });
});

describe("the place, the paragraph list and the script bar", () => {
  const cut = glassParagraphs(INTERVIEW_INTRO);

  it("prints the place as a paragraph and a share of the read words", () => {
    const words = readWordsOf(cut);
    const before = words.slice(0, 7).reduce((sum, count) => sum + count, 0);
    const total = words.reduce((sum, count) => sum + count, 0);
    expect(placeView(glass(), cut)).toEqual({
      text: `¶ 8 of 18 · ${Math.round((before / total) * 100)} %`,
      share: before / total,
    });
    expect(placeView(glass({ atEnd: true }), cut).text).toBe("END");
  });

  it("gives every paragraph a row, its opening cue apart, and its length at the pace", () => {
    const rows = paragraphRows(cut, 140);
    expect(rows).toHaveLength(INTERVIEW_INTRO.length);
    expect(rows[8].cue).toBe("[turn to the guest]");
    expect(rows[8].text.startsWith("Welcome to the studio.")).toBe(true);
    expect(rows[0].cue).toBeNull();
    const words = readWordsOf(cut)[0];
    expect(rows[0].length).toBe(formatDuration((words * 60) / 140));
  });

  it("shows every paragraph that fits, else a window that keeps the place in view", () => {
    expect(paragraphWindow(12, 5, 18)).toEqual({ from: 0, to: 12 });
    expect(paragraphWindow(60, 0, 18)).toEqual({ from: 0, to: 18 });
    expect(paragraphWindow(60, 30, 18)).toEqual({ from: 24, to: 42 });
    expect(paragraphWindow(60, 59, 18)).toEqual({ from: 42, to: 60 });
  });

  it("lays the whole script out at one width, and finds the paragraph under a press", () => {
    const segments = scriptBar(cut, 7);
    const last = INTERVIEW_INTRO.length - 1;
    expect(segments).toHaveLength(INTERVIEW_INTRO.length);
    expect(segments.reduce((sum, segment) => sum + segment.share, 0)).toBeCloseTo(1);
    expect(segments.filter((segment) => segment.read).map((segment) => segment.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(paragraphAt(segments, 0)).toBe(0);
    expect(paragraphAt(segments, 0.999)).toBe(last);
    const middle = segments.slice(0, 8).reduce((sum, segment) => sum + segment.share, 0) - segments[7].share / 2;
    expect(paragraphAt(segments, middle)).toBe(7);
  });
});

describe("what locks PLAY", () => {
  it("is nothing on the prompter, nothing drawn on the glass, the end, then no layout yet", () => {
    expect(playLockReason(snapshot({ glass: null }))).toMatch(/Nothing is on the prompter/);
    expect(
      playLockReason(snapshot({ screen: screen({ draws: false, sentence: "Windows does not see the Prompter XL." }) }))
    ).toBe("Windows does not see the Prompter XL.");
    expect(playLockReason(snapshot({ glass: glass({ atEnd: true }) }))).toMatch(/At the end/);
    expect(playLockReason(snapshot({ glass: glass({ laidOut: false }) }))).toMatch(/laid out/);
    expect(playLockReason(snapshot())).toBeNull();
    // Playing, PLAY is the pause: never locked.
    expect(playLockReason(snapshot({ glass: glass({ playing: true, laidOut: false }) }))).toBeNull();
  });
});

describe("the plate's lines", () => {
  it("says where a script came from, its size and length, and when it was saved", () => {
    const script: PrompterScriptSummary = {
      id: "script-2",
      name: "02 Interview intro",
      sourceFileName: "Interview intro.docx",
      paragraphCount: 18,
      readWords: 581,
      speedWpm: 140,
      lengthSeconds: 259,
      place: { paragraph: 7, word: 0 },
      atEnd: false,
      createdAt: "2026-09-27T12:00:00.000Z",
      changedAt: "not a time",
      removedAt: null,
      onPrompter: true,
    };
    expect(scriptDetail(script)).toBe("From Interview intro.docx · 18 paragraphs · 4:19 at 140 · 581 words");
    expect(formatDuration(3725)).toBe("1:02:05");
    expect(formatDuration(37)).toBe("0:37");
  });
});
