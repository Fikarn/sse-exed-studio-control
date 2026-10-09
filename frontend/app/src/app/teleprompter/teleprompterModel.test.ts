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
  backParagraph,
  barStart,
  glassTextOf,
  paragraphAt,
  paragraphRows,
  paragraphWindow,
  placeView,
  playLockReason,
  prompterCheckOf,
  prompterStateView,
  readWordsOf,
  scriptBar,
  scriptDetail,
  scriptDetailParts,
  scriptLine,
  screenMode,
  runStateWord,
  stepLocks,
  takeKeysView,
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
      sentence: "02 Interview intro is on the glass. Paused at paragraph 8 of 18.",
      meta: "1920×1080 · 60 Hz",
      wayOut: null,
    });
    expect(prompterStateView(snapshot({ glass: glass({ playing: true }) }), null, true).sentence).toBe(
      "02 Interview intro is on the glass. Playing at 140 words a minute."
    );
    expect(prompterStateView(snapshot({ glass: glass({ atEnd: true }) }), null, true).sentence).toBe(
      "02 Interview intro is on the glass. At the end."
    );
  });

  it("is READY while the glass is blank, with Open file… as the way out while no script is kept", () => {
    const blank = prompterStateView(snapshot({ glass: null }), null, true);
    // The visual overhaul (2026-10-05): Put on is the plate's key; the display
    // offers Open file… while no script is kept.
    expect(blank).toMatchObject({ tone: "ok", word: "READY", wayOut: null });
    expect(blank.sentence).toBe("The Prompter XL is connected and blank. Put a script on it.");
    expect(prompterStateView(snapshot({ glass: null }), null, false)).toMatchObject({
      sentence: "The Prompter XL is connected and blank. There is no script yet.",
      wayOut: "open-file",
    });
  });

  // The visual overhaul's polish (2026-10-05, the owner's rule): the display's
  // sentence keeps two lines, so every sentence the page builds for it holds
  // at most 70 characters, whatever the script's name and the place; the meta
  // beside a way-out key holds about 30.
  it("keeps every sentence it builds within two lines, and its meta beside a way-out key within one", () => {
    const longName = "A script with a name far too long for the state display's two lines";
    const long = glass({ name: longName, place: { paragraph: 998, word: 0 }, paragraphCount: 999, speedWpm: 300 });
    const sentences = [
      prompterStateView(snapshot({ glass: long }), null, true).sentence,
      prompterStateView(snapshot({ glass: { ...long, playing: true } }), null, true).sentence,
      prompterStateView(snapshot({ glass: { ...long, atEnd: true } }), null, true).sentence,
      prompterStateView(snapshot({ glass: { ...long, notUpdated: true } }), null, true).sentence,
      prompterStateView(snapshot({ glass: null }), null, true).sentence,
      prompterStateView(snapshot({ glass: null }), null, false).sentence,
    ];
    for (const sentence of sentences) expect(sentence.length, sentence).toBeLessThanOrEqual(70);
    expect(sentences[0]).toBe("A script with a nam… is on the glass. Paused at paragraph 999 of 999.");
    const besideOpenFile = prompterStateView(snapshot({ glass: null }), null, false);
    expect(besideOpenFile.meta?.length ?? 0).toBeLessThanOrEqual(30);
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
      summary: "Edited since it went on: the prompter still shows the earlier text.",
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
    const segments = scriptBar(cut);
    const last = INTERVIEW_INTRO.length - 1;
    expect(segments).toHaveLength(INTERVIEW_INTRO.length);
    expect(segments.reduce((sum, segment) => sum + segment.share, 0)).toBeCloseTo(1);
    expect(segments[0]!.start).toBe(0);
    expect(segments[last]!.start + segments[last]!.share).toBeCloseTo(1);
    expect(barStart(segments, 8)).toBeCloseTo(segments[7]!.start + segments[7]!.share);
    expect(barStart(segments, INTERVIEW_INTRO.length)).toBe(1);
    expect(paragraphAt(segments, 0)).toBe(0);
    expect(paragraphAt(segments, 0.999)).toBe(last);
    expect(paragraphAt(segments, segments[7]!.start + segments[7]!.share / 2)).toBe(7);
  });

  it("fits a script of any length: a press lands on the paragraph drawn there", () => {
    const long = glassParagraphs(
      Array.from({ length: 1150 }, (_, index) =>
        paragraph(index % 7 === 0 ? "One." : "A paragraph of eight words to read aloud.")
      )
    );
    const segments = scriptBar(long);
    expect(segments).toHaveLength(1150);
    expect(segments.at(-1)!.start + segments.at(-1)!.share).toBeCloseTo(1);
    for (const index of [0, 9, 575, 1149]) {
      const segment = segments[index]!;
      expect(paragraphAt(segments, segment.start + segment.share / 2)).toBe(index);
    }
  });
});

describe("the steps the hardware link would refuse", () => {
  const cues = [
    { paragraph: 2, word: 0, text: "Pause", secondsAhead: null },
    { paragraph: 9, word: 0, text: "Look up", secondsAhead: null },
  ];

  it("locks the steps with nothing that way, with the hardware link's sentences, while paused", () => {
    expect(stepLocks(glass({ cues, place: { paragraph: 5, word: 3 } }))).toEqual({
      nextParagraph: null,
      previousCue: null,
      nextCue: null,
    });
    expect(stepLocks(glass({ cues, place: { paragraph: 1, word: 0 } })).previousCue).toBe(
      "There is no cue before the reading line."
    );
    expect(stepLocks(glass({ cues, place: { paragraph: 9, word: 0 } })).nextCue).toBe(
      "There is no cue after the reading line."
    );
    expect(stepLocks(glass({ cues: [], place: { paragraph: 17, word: 0 } }))).toEqual({
      nextParagraph: "There is no paragraph after the reading line.",
      previousCue: "There is no cue before the reading line.",
      nextCue: "There is no cue after the reading line.",
    });
  });

  it("leaves every step open while the text scrolls: the page's place is behind the hardware link's", () => {
    expect(stepLocks(glass({ cues: [], playing: true, place: { paragraph: 17, word: 0 } }))).toEqual({
      nextParagraph: null,
      previousCue: null,
      nextCue: null,
    });
  });
});

describe("where BACK goes", () => {
  const reported = {
    layoutKey: "g1-l0",
    lines: [
      { paragraph: 4, word: 0 },
      { paragraph: 4, word: 6 },
      { paragraph: 5, word: 0 },
    ],
  };

  it("goes to the paragraph's start, or from its first line to the one before, as the copy laid it out", () => {
    expect(backParagraph(glass({ place: { paragraph: 4, word: 8 } }), reported)).toBe(4);
    expect(backParagraph(glass({ place: { paragraph: 4, word: 3 } }), reported)).toBe(3);
    // A paragraph of one line: every word is on its first line.
    expect(backParagraph(glass({ place: { paragraph: 5, word: 2 } }), reported)).toBe(4);
  });

  it("reads the first line from the word alone without a layout for this key, and goes to the last paragraph from END", () => {
    expect(backParagraph(glass({ place: { paragraph: 4, word: 0 } }), null)).toBe(3);
    expect(backParagraph(glass({ place: { paragraph: 4, word: 3 } }), { ...reported, layoutKey: "g0-l0" })).toBe(4);
    expect(backParagraph(glass({ place: { paragraph: 0, word: 0 } }), null)).toBe(0);
    expect(backParagraph(glass({ atEnd: true, place: { paragraph: 18, word: 0 } }), null)).toBe(17);
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
    // The visual overhaul's polish (2026-10-05): the pace carries its unit, and
    // the plate breaks the line only between its parts.
    expect(scriptDetail(script)).toBe("From Interview intro.docx · 18 paragraphs · 4:19 at 140 words/min · 581 words");
    expect(scriptDetailParts(script)).toEqual({
      from: "From Interview intro.docx",
      facts: ["18 paragraphs", "4:19 at 140 words/min", "581 words"],
    });
    expect(scriptLine(script)).toBe("4:19 at 140 words/min");
    expect(scriptDetailParts({ ...script, sourceFileName: null }).from).toBeNull();
    expect(formatDuration(3725)).toBe("1:02:05");
    expect(formatDuration(37)).toBe("0:37");
  });
});

// The take's keys, as the Teleprompter page and the Overview both draw them (D47).
describe("the take's keys", () => {
  it("says what PLAY, BACK and TOP do, and locks none while a script is laid out on the glass", () => {
    const keys = takeKeysView(snapshot(), 6);
    expect(keys.play).toEqual({ live: false, lock: null, hint: "from ¶ 8" });
    expect(keys.back).toEqual({ lock: null, hint: "to the start of ¶ 7" });
    expect(keys.top).toEqual({ lock: null, hint: "pauses · to ¶ 1" });
    expect(takeKeysView(snapshot({ glass: glass({ playing: true }) }), 7).play).toEqual({
      live: true,
      lock: null,
      hint: "press to pause",
    });
  });

  it("locks every key while nothing is on the prompter, and PLAY says nothing under its cap", () => {
    const keys = takeKeysView(snapshot({ glass: null }), 0);
    for (const key of [keys.play, keys.back, keys.top, keys.slower, keys.faster, keys.previousCue, keys.nextCue]) {
      expect(key.lock).toMatch(/Nothing is on the prompter/);
    }
    expect(keys.play.hint).toBeUndefined();
    expect(keys.back.hint).toBeUndefined();
  });

  it("locks − 5 and + 5 at the pace's ends, and the cue steps where there is no cue", () => {
    expect(takeKeysView(snapshot({ glass: glass({ speedWpm: 40 }) }), 0).slower.lock).toMatch(/slowest, 40/);
    expect(takeKeysView(snapshot({ glass: glass({ speedWpm: 300 }) }), 0).faster.lock).toMatch(/fastest, 300/);
    const keys = takeKeysView(snapshot({ glass: glass({ cues: [] }) }), 0);
    expect(keys.previousCue.lock).toBe("There is no cue before the reading line.");
    expect(keys.nextCue.lock).toBe("There is no cue after the reading line.");
  });

  it("names the scroll's state", () => {
    expect(runStateWord(glass({ playing: true }))).toBe("Playing");
    expect(runStateWord(glass({ atEnd: true }))).toBe("At the end");
    expect(runStateWord(glass())).toBe("Paused");
  });

  it("reads the Prompter XL's check from the health snapshot", () => {
    const check = { ok: true, status: "ready", word: "ON SCREEN" } as unknown as PrompterHealthCheck;
    expect(prompterCheckOf({ checks: { prompter: check } } as never)).toBe(check);
    expect(prompterCheckOf({ checks: {} })).toBeNull();
    expect(prompterCheckOf(null)).toBeNull();
  });
});
