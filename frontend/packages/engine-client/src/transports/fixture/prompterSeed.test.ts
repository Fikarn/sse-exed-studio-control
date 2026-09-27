import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { INTERVIEW_INTRO, expandPrompterRecord, getFixtureScenario } from "@sse/test-fixtures";

import type { JsonObject } from "../../generated/protocol";
import type { FixturePrompterScriptSeed, FixturePrompterSeed, FixtureScenario } from "../../types";
import { createFixtureTransport } from "../fixtureTransport";
import { NOT_UPDATED_SENTENCE } from "./prompterSeed";
import { openPrompterDouble } from "./prompterTestSupport";

// The prompter a scenario starts with (new pages program, Slice 6a): scripts, Removed and
// a script on the glass, built by the double's own requests, so a seeded double answers
// as one the page had filled request by request would; and the Teleprompter's four
// fixtures, board 1's scripts on it.

const NOW = Date.parse("2026-09-27T12:00:00.000Z");
const HOUR_MS = 3_600_000;
const WEEK_MS = 7 * 24 * HOUR_MS;

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

const text = (...paragraphs: string[]) =>
  paragraphs.map((words) => ({ runs: [{ text: words, bold: false, italic: false, underline: false }] }));

const BETA: FixturePrompterScriptSeed = { name: "Beta", paragraphs: text("one two three", "four five") };
const ALPHA: FixturePrompterScriptSeed = {
  name: "alpha",
  paragraphs: text("a b c", "d e f g", "[cue]\nh i"),
  speedWpm: 150,
  place: { paragraph: 1, word: 2 },
  sourceFileName: "alpha.docx",
  versions: 3,
};
const GONE: FixturePrompterScriptSeed = { name: "Gone", paragraphs: text("gone"), removed: true };
const OLD: FixturePrompterScriptSeed = { name: "Old", paragraphs: text("old words"), removed: true };

/** `setup-ready` with the prompter `seed` says. */
function seeded(seed: FixturePrompterSeed): FixtureScenario {
  return { ...getFixtureScenario("setup-ready"), prompter: seed };
}

const scriptId = (number: number) => `script-${number.toString(16).padStart(16, "0")}`;
const at = (ms: number) => new Date(ms).toISOString();
const names = (rows: unknown) => (rows as JsonObject[]).map((row) => row.name);

async function prompterCheck(call: (method: "health.snapshot") => Promise<JsonObject>) {
  const health = await call("health.snapshot");
  return { status: health.status, check: (health.checks as JsonObject).prompter as JsonObject };
}

describe("the fixture double's prompter seed", () => {
  it("starts with the scripts by name, Removed newest first, and the glass paused at the script's place", async () => {
    const { call, events } = openPrompterDouble(seeded({ scripts: [BETA, ALPHA, GONE, OLD], onGlass: "alpha" }));
    const snapshot = await call("prompter.snapshot");
    expect(names(snapshot.scripts)).toEqual(["alpha", "Beta"]);
    expect(names(snapshot.removed)).toEqual(["Gone", "Old"]);
    const [alpha, beta] = snapshot.scripts as JsonObject[];
    expect(beta).toMatchObject({
      id: scriptId(1),
      sourceFileName: null,
      paragraphCount: 2,
      readWords: 5,
      speedWpm: 140,
      place: { paragraph: 0, word: 0 },
      createdAt: at(NOW - WEEK_MS),
      changedAt: at(NOW - WEEK_MS),
      removedAt: null,
      onPrompter: false,
    });
    // Three versions, an hour apart: its text now was kept last.
    expect(alpha).toMatchObject({
      id: scriptId(2),
      sourceFileName: "alpha.docx",
      paragraphCount: 3,
      readWords: 9,
      speedWpm: 150,
      place: { paragraph: 1, word: 2 },
      createdAt: at(NOW - WEEK_MS + 60_000),
      changedAt: at(NOW - WEEK_MS + 60_000 + 2 * HOUR_MS),
      onPrompter: true,
    });
    // The first listed of Removed went last.
    expect((snapshot.removed as JsonObject[]).map((row) => row.removedAt)).toEqual([
      at(NOW - HOUR_MS),
      at(NOW - 2 * HOUR_MS),
    ]);
    expect(snapshot.glass).toMatchObject({
      scriptId: scriptId(2),
      name: "alpha",
      layoutKey: "g1-l0",
      laidOut: false,
      notUpdated: false,
      speedWpm: 150,
      place: { paragraph: 1, word: 2 },
      paragraphCount: 3,
      playing: false,
      atEnd: false,
      cues: [{ paragraph: 2, word: 0, text: "cue" }],
    });

    // Each earlier version a paragraph shorter; putting it on kept nothing new, as its
    // text was the newest version's.
    const versions = (await call("prompter.script.snapshot", { scriptId: scriptId(2) })).versions as JsonObject[];
    expect(versions.map(({ readWords, reason, keptAt }) => [readWords, reason, keptAt])).toEqual([
      [9, "updated", at(NOW - WEEK_MS + 60_000 + 2 * HOUR_MS)],
      [7, "put-on", at(NOW - WEEK_MS + 60_000 + HOUR_MS)],
      [3, "imported", at(NOW - WEEK_MS + 60_000)],
    ]);
    const betaVersions = (await call("prompter.script.snapshot", { scriptId: scriptId(1) })).versions as JsonObject[];
    expect(betaVersions.map((version) => version.reason)).toEqual(["pasted"]);

    expect(await prompterCheck(call)).toMatchObject({ status: "ok", check: { word: "CONNECTED", notUpdated: false } });
    expect(events).toEqual([]);
  });

  it("leaves a glass the page's requests take on from there", async () => {
    const double = openPrompterDouble(seeded({ scripts: [BETA, ALPHA], onGlass: "alpha" }));
    expect((await double.refused("prompter.putOn", { scriptId: scriptId(1) })).code).toBe(
      "PROMPTER_REPLACE_NOT_CONFIRMED"
    );
    expect((await double.refused("prompter.update")).code).toBe("PROMPTER_UP_TO_DATE");
    expect(await double.layOut(2, 100)).toEqual({ accepted: true });
    await double.call("prompter.play");
    expect((await double.glass()).playing).toBe(true);
    expect(double.reasons()).toEqual(["laid-out", "played"]);
  });

  it("puts a script left at its end on at the top, as prompter.putOn does", async () => {
    const { glass } = openPrompterDouble(
      seeded({ scripts: [{ ...BETA, place: { paragraph: 2, word: 0 } }], onGlass: "Beta" })
    );
    expect((await glass()).place).toEqual({ paragraph: 0, word: 0 });
  });

  it("edits the glass script after it went on for NOT UPDATED, and Update takes the edit", async () => {
    const { call, glass } = openPrompterDouble(seeded({ scripts: [BETA, ALPHA], onGlass: "alpha", notUpdated: true }));
    expect(await glass()).toMatchObject({ notUpdated: true, place: { paragraph: 1, word: 2 }, paragraphCount: 3 });
    const script = await call("prompter.script.snapshot", { scriptId: scriptId(2) });
    const shown = await call("prompter.glass.snapshot");
    // The sentence goes to the paragraph after the place; the glass keeps the earlier text.
    expect(script.paragraphs).toEqual([
      ...text("a b c", "d e f g"),
      { runs: [{ text: `[cue]\nh i ${NOT_UPDATED_SENTENCE}`, bold: false, italic: false, underline: false }] },
    ]);
    expect(shown.paragraphs).toEqual(text("a b c", "d e f g", "[cue]\nh i"));
    // An edit keeps no version, and the place stays with the glass's text until Update.
    expect(script.script).toMatchObject({ place: { paragraph: 1, word: 2 }, changedAt: at(NOW) });
    expect((script.versions as JsonObject[]).length).toBe(3);
    expect(await prompterCheck(call)).toMatchObject({
      status: "ok",
      check: { status: "attention", word: "NOT UPDATED", notUpdated: true },
    });

    await call("prompter.update");
    expect(await glass()).toMatchObject({ notUpdated: false, place: { paragraph: 1, word: 2 } });
    expect(await prompterCheck(call)).toMatchObject({ check: { word: "CONNECTED", notUpdated: false } });
  });

  it("edits the last paragraph when the place is in it", async () => {
    const { call } = openPrompterDouble(
      seeded({ scripts: [{ ...BETA, place: { paragraph: 1, word: 1 } }], onGlass: "Beta", notUpdated: true })
    );
    const script = await call("prompter.script.snapshot", { scriptId: scriptId(1) });
    expect(script.paragraphs).toEqual(text("one two three", `four five ${NOT_UPDATED_SENTENCE}`));
  });

  it("takes the look and the take's size in the requests' ranges", async () => {
    const { snapshot } = openPrompterDouble(
      seeded({ look: { textColour: "yellow", lineSpacingPercent: 160, standardSizePx: 96 }, sizePx: 120 })
    );
    expect(await snapshot()).toMatchObject({
      look: { textColour: "yellow", lineSpacingPercent: 160, standardSizePx: 96, marginPercent: 12 },
      sizePx: 120,
      glass: null,
      scripts: [],
    });
    // Without a size, the take is at the look's standard.
    const standard = openPrompterDouble(seeded({ look: { standardSizePx: 100 } }));
    expect((await standard.snapshot()).sizePx).toBe(100);
  });

  it("refuses a seed the prompter could not hold, naming the scenario's mistake", () => {
    const refusal = (seed: FixturePrompterSeed) => () => createFixtureTransport(seeded(seed));
    expect(refusal({ scripts: [BETA], onGlass: "Nobody" })).toThrow(
      "prompter: onGlass names Nobody, which is not among its scripts."
    );
    expect(refusal({ scripts: [BETA, GONE], onGlass: "Gone" })).toThrow(
      "prompter: onGlass names Gone, which is in Removed."
    );
    expect(refusal({ scripts: [BETA], notUpdated: true })).toThrow(
      "prompter: notUpdated needs a script on the glass (onGlass)."
    );
    expect(refusal({ scripts: [{ ...BETA, place: { paragraph: 3, word: 0 } }] })).toThrow(
      "prompter: Beta's place (paragraph 3, word 0) is outside its text of 2 paragraphs."
    );
    expect(refusal({ scripts: [{ ...BETA, place: { paragraph: 1, word: 2 } }] })).toThrow(
      "prompter: Beta's place (paragraph 1, word 2) is outside its text of 2 paragraphs."
    );
    expect(refusal({ scripts: [{ ...BETA, place: { paragraph: 2, word: 1 } }] })).toThrow("is outside its text");
    expect(refusal({ look: { lineSpacingPercent: 105 } })).toThrow(
      "prompter: look is not a look the prompter could keep: The line spacing must be 1.1–2.0 in steps of 0.1 (lineSpacingPercent 110–200 in steps of 10)."
    );
    expect(refusal({ look: { brightness: 3 } as JsonObject })).toThrow(
      "prompter: look is not a look the prompter could keep: The look has no setting called brightness."
    );
    expect(refusal({ sizePx: 50 })).toThrow("prompter: sizePx must be 48–160 in steps of 4.");
    expect(refusal({ scripts: [{ ...BETA, speedWpm: 142 }] })).toThrow(
      "prompter: Beta's speedWpm must be 40–300 in steps of 5."
    );
    expect(refusal({ scripts: [{ ...BETA, versions: 3 }] })).toThrow(
      "prompter: Beta's versions must be 1–20 and no more than its 2 paragraphs (each earlier version is a paragraph shorter)."
    );
    expect(refusal({ scripts: [BETA, { ...ALPHA, name: "Beta" }] })).toThrow("prompter: two scripts are named Beta.");
    expect(refusal({ scripts: [{ ...BETA, name: "  Beta  two" }] })).toThrow(
      "prompter: scripts[0]'s name must be one line of words, as the prompter keeps a name."
    );
  });
});

describe("the Teleprompter's fixtures", () => {
  const BOARD_SCRIPTS = [
    ["01 Welcome", 152, 150, 5, "Welcome.docx"],
    ["02 Interview intro", 581, 140, 18, "Interview intro.docx"],
    ["03 Panel questions", 671, 140, 36, "Panel questions.docx"],
    ["04 Outro", 171, 140, 5, "Outro.docx"],
    ["Retake lines", 108, 130, 5, null],
    ["Sound check", 64, 140, 3, null],
  ];

  async function fixture(id: string) {
    const transport = createFixtureTransport(getFixtureScenario(id));
    const call = (method: "prompter.snapshot" | "prompter.glass.snapshot" | "health.snapshot") =>
      transport.request(method, {}) as Promise<JsonObject>;
    const script = (id: unknown) => transport.request("prompter.script.snapshot", { scriptId: id as string });
    return { call, script, snapshot: await call("prompter.snapshot") };
  }

  it('teleprompter-ready: board 1\'s six scripts, two in Removed, 02 Interview intro paused at ¶ 8, word 9 ("with", as board 1)', async () => {
    const { call, script, snapshot } = await fixture("teleprompter-ready");
    expect(
      (snapshot.scripts as JsonObject[]).map((row) => [
        row.name,
        row.readWords,
        row.speedWpm,
        row.paragraphCount,
        row.sourceFileName,
      ])
    ).toEqual(BOARD_SCRIPTS);
    expect(names(snapshot.removed)).toEqual(["Draft intro", "Old outro"]);
    expect(snapshot.glass).toMatchObject({
      name: "02 Interview intro",
      place: { paragraph: 7, word: 8 },
      paragraphCount: 18,
      speedWpm: 140,
      notUpdated: false,
      playing: false,
    });
    expect(((snapshot.glass as JsonObject).cues as JsonObject[]).map((cue) => cue.text)).toEqual([
      "turn to the guest",
      "Part 2 · The pilot",
      "slide 3",
    ]);
    expect((await call("prompter.glass.snapshot")).paragraphs).toEqual(INTERVIEW_INTRO);
    const versionCounts = await Promise.all(
      (snapshot.scripts as JsonObject[]).map(
        async (row) => ((await script(row.id)) as { versions: unknown[] }).versions.length
      )
    );
    expect(versionCounts).toEqual([1, 4, 3, 2, 1, 1]);
    expect(await prompterCheck(call)).toMatchObject({ status: "ok", check: { word: "CONNECTED" } });
  });

  it("teleprompter-empty: the first run, no scripts and nothing on the glass", async () => {
    const { snapshot } = await fixture("teleprompter-empty");
    expect(snapshot).toMatchObject({ scripts: [], removed: [], glass: null, screen: { word: "CONNECTED" } });
  });

  it("teleprompter-not-connected: as ready, with the Prompter XL reported and not found", async () => {
    const { call, snapshot } = await fixture("teleprompter-not-connected");
    expect(snapshot.screen).toMatchObject({ word: "NOT CONNECTED", reported: true, draws: false });
    expect(snapshot.glass).toMatchObject({ name: "02 Interview intro", place: { paragraph: 7, word: 8 } });
    expect(snapshot.scripts as JsonObject[]).toHaveLength(6);
    expect(await prompterCheck(call)).toMatchObject({ status: "attention", check: { word: "NOT CONNECTED" } });
  });

  it("teleprompter-not-updated: as ready, with 02 Interview intro edited after it went on", async () => {
    const { call, snapshot } = await fixture("teleprompter-not-updated");
    expect(snapshot.glass).toMatchObject({ name: "02 Interview intro", notUpdated: true });
    expect((await call("prompter.glass.snapshot")).paragraphs).toEqual(INTERVIEW_INTRO);
    expect(await prompterCheck(call)).toMatchObject({ status: "ok", check: { word: "NOT UPDATED" } });
  });

  it("names a script fixtures.json asks for and prompterScripts.ts lacks", () => {
    expect(() => expandPrompterRecord("broken", { scripts: ["01 Welcome", "05 Credits"] })).toThrow(
      `Fixture 'broken': prompter names the script "05 Credits", which prompterScripts.ts does not have`
    );
    expect(() => expandPrompterRecord("broken", { scripts: ["01 Welcome"], place: { paragraph: 0, word: 0 } })).toThrow(
      "Fixture 'broken': prompter.place is the glass script's place, and nothing is on the glass."
    );
  });
});
