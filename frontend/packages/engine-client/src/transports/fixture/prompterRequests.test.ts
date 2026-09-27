import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { JsonObject } from "../../generated/protocol";
import { openPrompterDouble } from "./prompterTestSupport";

// The fixture double's Teleprompter glass and take, end to end through the transport
// (new pages program, Slice 4), held to what the hardware link's own tests hold it to
// (`native/rust-engine/src/prompter/tests_glass.rs` and `app/tests_prompter.rs`): putting
// a script on, replacing, updating and clearing it (D11), the clock's rules (D12, D19,
// §14), the look, the `prompter.changed` events and the Recent actions rows. Time is
// Vitest's clock, so the stop at END is driven as a page clock would drive it.

const NOW = Date.parse("2026-09-27T12:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the fixture double's prompter: what the glass shows", () => {
  it("starts every scenario with no scripts, the standard look and nothing on the glass", async () => {
    const { call } = openPrompterDouble();
    expect(await call("prompter.snapshot")).toEqual({
      look: {
        standardSizePx: 88,
        lineSpacingPercent: 140,
        marginPercent: 12,
        textColour: "white",
        readingLinePercent: 35,
        readingLineAcross: false,
        dimReadText: true,
        paragraphNumbers: false,
      },
      sizePx: 88,
      glass: null,
      scripts: [],
      removed: [],
    });
    const shown = await call("prompter.glass.snapshot");
    expect(shown).toMatchObject({
      scriptId: null,
      name: null,
      layoutKey: null,
      paragraphs: [],
      anchor: null,
      sizePx: 88,
    });
  });

  // §5.5: one press on a blank prompter, paused at the script's own place; replacing
  // another script needs the page's second press, and the replaced script keeps its place.
  it("puts a script on with one press, and replacing another needs the second", async () => {
    const { call, refused, script, snapshot, glass } = openPrompterDouble();
    const intro = await script("Intro", ["One two three four.", "Five six seven."]);
    const outro = await script("Outro", ["Goodbye now."]);

    const result = await call("prompter.putOn", { scriptId: intro });
    expect(result).toEqual({
      action: "put-on",
      name: "Intro",
      replacedName: null,
      sentence: "Put Intro on the prompter.",
    });
    expect(await glass()).toMatchObject({
      name: "Intro",
      playing: false,
      place: { paragraph: 0, word: 0 },
      notUpdated: false,
      layoutKey: "g1-l0",
      laidOut: false,
      estimated: true,
    });

    await call("prompter.jump", { to: "paragraph", paragraph: 1 });
    expect(await refused("prompter.putOn", { scriptId: outro })).toEqual({
      code: "PROMPTER_REPLACE_NOT_CONFIRMED",
      sentence: "The prompter shows Intro. Replacing it with Outro needs the second press.",
    });
    expect((await glass()).name).toBe("Intro");

    expect(await call("prompter.putOn", { scriptId: outro, replace: true })).toEqual({
      action: "replaced",
      name: "Outro",
      replacedName: "Intro",
      sentence: "Replaced Intro with Outro on the prompter.",
    });
    const rows = (await snapshot()).scripts as JsonObject[];
    expect(rows.map((row) => [row.name, row.place, row.onPrompter])).toEqual([
      ["Intro", { paragraph: 1, word: 0 }, false],
      ["Outro", { paragraph: 0, word: 0 }, true],
    ]);
    expect((await refused("prompter.putOn", { scriptId: outro, replace: true })).code).toBe("PROMPTER_ALREADY_ON");
  });

  // §6.3: an edit changes the double's copy, not the presenter's; Update keeps the words
  // at the reading line, and a deleted paragraph there moves the place on, which it says.
  it("keeps an edit off the glass until Update, which keeps the words at the reading line", async () => {
    const { call, refused, script, edit, glass } = openPrompterDouble();
    const talk = await script("Talk", ["Alpha one.", "Beta two.", "Gamma three.", "Delta four."]);
    await call("prompter.putOn", { scriptId: talk });
    await call("prompter.jump", { to: "paragraph", paragraph: 2 });

    await edit(talk, ["New opening.", "Alpha one.", "Beta two.", "Gamma three.", "Delta four."]);
    expect(((await call("prompter.glass.snapshot")).paragraphs as JsonObject[]).length).toBe(4);
    expect((await glass()).notUpdated).toBe(true);

    expect((await call("prompter.update")).sentence).toBe("Updated Talk on the prompter.");
    expect(await glass()).toMatchObject({ place: { paragraph: 3, word: 0 }, notUpdated: false, layoutKey: "g2-l0" });
    expect((await refused("prompter.update")).code).toBe("PROMPTER_UP_TO_DATE");

    await edit(talk, ["New opening.", "Alpha one.", "Beta two.", "Delta four."]);
    expect(await call("prompter.update")).toEqual({
      action: "updated",
      name: "Talk",
      sentence:
        "Updated Talk on the prompter. The paragraph at the reading line was deleted, so the prompter now starts at paragraph 4.",
    });
    expect((await glass()).place).toEqual({ paragraph: 3, word: 0 });
  });

  it("clears the glass, and the script keeps its place", async () => {
    const { call, refused, script, snapshot } = openPrompterDouble();
    const talk = await script("Talk", ["One.", "Two.", "Three."]);
    expect(await refused("prompter.clear")).toEqual({
      code: "PROMPTER_NOTHING_ON",
      sentence: "Nothing is on the prompter. Put a script on first.",
    });
    await call("prompter.putOn", { scriptId: talk });
    await call("prompter.jump", { to: "paragraph", paragraph: 2 });
    expect(await call("prompter.clear")).toEqual({
      action: "cleared",
      name: "Talk",
      sentence: "Cleared the prompter.",
    });
    const cleared = await snapshot();
    expect(cleared.glass).toBeNull();
    expect((cleared.scripts as JsonObject[])[0]?.place).toEqual({ paragraph: 2, word: 0 });
    expect((await call("prompter.glass.snapshot")).paragraphs).toEqual([]);
    for (const method of ["prompter.play", "prompter.pause", "prompter.update", "prompter.speed"] as const) {
      expect((await refused(method, method === "prompter.speed" ? { step: 1 } : {})).code, method).toBe(
        "PROMPTER_NOTHING_ON"
      );
    }
  });

  // First step 1a: a change answers with `prompter.changed` carrying the glass's anchor;
  // a read raises nothing, and a refusal changes nothing.
  it("raises prompter.changed with the anchor for a change, and nothing for a read or a refusal", async () => {
    const { call, refused, events, script } = openPrompterDouble();
    const talk = await script("Talk", ["One two."]);
    events.length = 0;
    await call("prompter.putOn", { scriptId: talk });
    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe("prompter.changed");
    expect(events[0]?.payload).toMatchObject({
      reason: "put-on",
      anchor: { playing: false, place: { paragraph: 0, word: 0 }, position: null, layoutKey: "g1-l0", ageMs: 0 },
    });

    await call("prompter.snapshot");
    await call("prompter.glass.snapshot");
    await refused("prompter.putOn", { scriptId: talk });
    expect(events).toHaveLength(1);

    await call("prompter.clear");
    expect(events[1]?.payload).toEqual({ reason: "cleared", anchor: null });
  });
});

describe("the fixture double's prompter: the take", () => {
  // First step 1a: the clock runs in the layout the view reports. Without one the
  // prompter cannot scroll or step a line; a stale report changes nothing, and one that
  // does not fit the text is refused.
  it("runs on the reported layout", async () => {
    const { call, refused, script, glass, layOut, reasons } = openPrompterDouble();
    const talk = await script("Talk", ["one two three four five six", "seven eight nine"]);
    await call("prompter.putOn", { scriptId: talk });
    expect(await refused("prompter.play")).toEqual({
      code: "PROMPTER_NOT_LAID_OUT",
      sentence: "The prompter's text is not drawn yet, so it cannot scroll or step a line. Try again in a moment.",
    });
    expect((await refused("prompter.jump", { to: "nextLine" })).code).toBe("PROMPTER_NOT_LAID_OUT");

    expect(await call("prompter.layout.report", { layoutKey: "g0-l0", lines: [], endTop: 0 })).toEqual({
      accepted: false,
    });
    expect(
      await refused("prompter.layout.report", {
        layoutKey: "g1-l0",
        lines: [{ paragraph: 0, word: 0, top: 0, height: 100 }],
        endTop: 500,
      })
    ).toEqual({
      code: "INVALID_PARAMS",
      sentence: "The layout lays out 1 paragraphs, and the text on the glass has 2.",
    });
    expect((await refused("prompter.layout.report", { layoutKey: "g1-l0", lines: [], endTop: 0 })).sentence).toBe(
      "The layout has no lines."
    );
    expect((await refused("prompter.layout.report", { layoutKey: "g1-l0", lines: [{}], endTop: 0 })).code).toBe(
      "INVALID_PARAMS"
    );

    expect(await layOut(3, 100)).toEqual({ accepted: true });
    expect(await layOut(3, 100)).toEqual({ accepted: true });
    expect(reasons().filter((reason) => reason === "laid-out")).toHaveLength(1);
    expect(await glass()).toMatchObject({ laidOut: true, estimated: false });

    await call("prompter.play");
    const anchor = (await glass()).anchor as JsonObject;
    expect(anchor).toMatchObject({ playing: true, toWpm: 140, rampMs: 300, position: 0, fromWpm: 0 });

    await call("prompter.jump", { to: "nextLine" });
    expect((await glass()).playing).toBe(true);
    await call("prompter.jump", { to: "top" });
    expect(await glass()).toMatchObject({ playing: false, place: { paragraph: 0, word: 0 } });
  });

  // §5.4 and D19: the scroll stops at END and stays stopped; PLAY is refused until a jump
  // moves the place back. The double's clock says so when it gets there (`at-end`).
  it("stops at END, says so, and refuses PLAY until a jump back", async () => {
    const { call, refused, script, glass, layOut, snapshot, events } = openPrompterDouble();
    const short = await script("Short", ["Go."]);
    await call("prompter.putOn", { scriptId: short });
    await layOut(5, 10);
    expect((await call("prompter.speed", { wpm: 300 })).speedWpm).toBe(300);
    await call("prompter.play");
    // One read word is 10 px and END 5 px under it: 1.5 words, 0.3 s of ease and 0.15 s more.
    await vi.advanceTimersByTimeAsync(400);
    expect((await glass()).atEnd).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    const atEnd = events.filter((seen) => seen.payload.reason === "at-end");
    expect(atEnd).toHaveLength(1);
    expect(atEnd[0]?.payload.anchor).toMatchObject({ playing: false, atEnd: true, place: { paragraph: 1, word: 0 } });
    expect(await glass()).toMatchObject({ atEnd: true, playing: false, timeLeftSeconds: 0 });

    expect(await refused("prompter.play")).toEqual({
      code: "PROMPTER_AT_END",
      sentence: "The prompter is at the end of Short. Go back with BACK, TOP or a jump first.",
    });
    await call("prompter.jump", { to: "back" });
    expect((await glass()).atEnd).toBe(false);
    await call("prompter.play");
    await vi.advanceTimersByTimeAsync(700);
    expect((await glass()).atEnd).toBe(true);

    // Put on again from its end, a script comes on at the top (§5.5).
    await call("prompter.clear");
    expect(((await snapshot()).scripts as JsonObject[])[0]?.atEnd).toBe(true);
    await call("prompter.putOn", { scriptId: short });
    expect((await glass()).place).toEqual({ paragraph: 0, word: 0 });
  });

  it("finds the text at END on the next request too, and stops its timer with the double", async () => {
    const { call, script, glass, layOut, transport, reasons } = openPrompterDouble();
    await call("prompter.putOn", { scriptId: await script("Short", ["Go."]) });
    await layOut(5, 10);
    await call("prompter.speed", { wpm: 300 });
    await call("prompter.play");
    expect(vi.getTimerCount()).toBe(1);
    // A page clock moved on before the timer ran: the request settles the clock itself,
    // and says so (review of 2026-09-27: it used to keep it to itself).
    vi.setSystemTime(NOW + 5_000);
    expect(await glass()).toMatchObject({ atEnd: true, playing: false, place: { paragraph: 1, word: 0 } });
    expect(vi.getTimerCount()).toBe(0);
    expect(reasons().filter((reason) => reason === "at-end")).toHaveLength(1);

    await call("prompter.jump", { to: "top" });
    await call("prompter.play");
    expect(vi.getTimerCount()).toBe(1);
    await transport.dispose?.();
    expect(vi.getTimerCount()).toBe(0);
    expect(reasons().filter((reason) => reason === "at-end")).toHaveLength(1);
  });

  // The hardware link's `whoever_finds_the_text_at_the_end_announces_it` (review of
  // 2026-09-27, L1): when a request is the first to find the text at END, it says so with
  // `at-end` as the clock would, before the request's own event.
  it("announces the text at END whoever finds it first", async () => {
    const { call, script, layOut, events, reasons } = openPrompterDouble();
    await call("prompter.putOn", { scriptId: await script("Short", ["Go."]) });
    await layOut(5, 10);
    await call("prompter.speed", { wpm: 300 });
    await call("prompter.play");
    events.length = 0;
    // The timer has not run: the read is the first to find END.
    vi.setSystemTime(NOW + 700);
    await call("prompter.snapshot");
    const announced = events.filter((seen) => seen.payload.reason === "at-end");
    expect(announced).toHaveLength(1);
    expect(announced[0]?.payload.anchor).toMatchObject({ atEnd: true, playing: false });

    await call("prompter.jump", { to: "top" });
    await call("prompter.play");
    events.length = 0;
    vi.setSystemTime(NOW + 1_400);
    await call("prompter.jump", { to: "back" });
    expect(reasons()).toEqual(["at-end", "jumped"]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(reasons()).toEqual(["at-end", "jumped"]);
  });

  // Review of 2026-09-27: the clock's timer wakes at END or after a second, whichever is
  // sooner (`next_wake`), laid out or not, and saves the place about once a second.
  it("saves the place about once a second while the text scrolls, laid out or not", async () => {
    const { call, script, glass, layOut, snapshot } = openPrompterDouble();
    const words = Array.from({ length: 10 }, (_, paragraph) =>
      Array.from({ length: 12 }, (_, word) => `p${paragraph}w${word}`).join(" ")
    );
    await call("prompter.putOn", { scriptId: await script("Long", words) });
    await layOut(5, 100);
    await call("prompter.play");
    const saved = async () => ((await snapshot()).scripts as JsonObject[])[0]!.place;

    // The timer saved the place at 1 s; half a second on, a read (which saves only once
    // a second has passed) shows the glass further on than the saved place.
    await vi.advanceTimersByTimeAsync(1_000);
    vi.setSystemTime(NOW + 1_500);
    expect(await saved()).toEqual({ paragraph: 0, word: 2 });
    expect((await glass()).place).toEqual({ paragraph: 0, word: 4 });

    // A new size: no layout until the view reports one, and the timer still wakes.
    await call("prompter.textSize", { step: 1 });
    expect(await glass()).toMatchObject({ laidOut: false, playing: true });
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    vi.setSystemTime(NOW + 3_000);
    expect(await saved()).toEqual({ paragraph: 0, word: 6 });
    expect((await glass()).place).toEqual({ paragraph: 0, word: 8 });
  });

  // Review of 2026-09-27 (L2): a pause saves where its 0.3 s ease stops the text, not
  // where it was at the press.
  it("saves where a pause's ease stops the text", async () => {
    const { call, script, glass, layOut, snapshot } = openPrompterDouble();
    const words = Array.from({ length: 10 }, (_, paragraph) =>
      Array.from({ length: 12 }, (_, word) => `p${paragraph}w${word}`).join(" ")
    );
    await call("prompter.putOn", { scriptId: await script("Long", words) });
    await layOut(5, 100);
    await call("prompter.speed", { wpm: 300 });
    await call("prompter.play");
    await vi.advanceTimersByTimeAsync(1_000);
    await call("prompter.pause");
    expect((await glass()).place).toEqual({ paragraph: 0, word: 6 });
    expect(((await snapshot()).scripts as JsonObject[])[0]!.place).toEqual({ paragraph: 0, word: 7 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await glass()).place).toEqual({ paragraph: 0, word: 7 });
  });

  // The hardware link's `the_first_layout_for_a_key_is_the_one_the_clock_runs_on` (review
  // of 2026-09-27, L4): another view's report for the same key moves nothing.
  it("runs on the first layout reported for a key", async () => {
    const { call, script, layOut, glass, reasons, events } = openPrompterDouble();
    await call("prompter.putOn", { scriptId: await script("Talk", ["one two three four five six seven eight"]) });
    await layOut(4, 100);
    await call("prompter.jump", { to: "place", paragraph: 0, word: 5 });
    const before = (await glass()).anchor as JsonObject;
    events.length = 0;
    const reply = await call("prompter.layout.report", {
      layoutKey: before.layoutKey as string,
      lines: [
        { paragraph: 0, word: 0, top: 0, height: 90 },
        { paragraph: 0, word: 3, top: 90, height: 90 },
        { paragraph: 0, word: 6, top: 180, height: 90 },
      ],
      endTop: 400,
    });
    expect(reply).toEqual({ accepted: true });
    expect(reasons()).toEqual([]);
    const after = (await glass()).anchor as JsonObject;
    expect(after.position).toBe(before.position);
    expect(after.wordOffset).toBe(before.wordOffset);
  });

  // §5 (answered in §14): a jump keeps the scroll as it was; only TOP pauses.
  it("keeps playing through a jump, and TOP pauses", async () => {
    const { call, script, glass, layOut } = openPrompterDouble();
    const words = Array.from({ length: 10 }, (_, paragraph) =>
      Array.from({ length: 12 }, (_, word) => `p${paragraph}w${word}`).join(" ")
    );
    await call("prompter.putOn", { scriptId: await script("Long", words) });
    await layOut(5, 100);
    await call("prompter.play");
    await vi.advanceTimersByTimeAsync(2_000);
    await call("prompter.jump", { to: "paragraph", paragraph: 4 });
    const jumped = await glass();
    expect(jumped).toMatchObject({ playing: true, place: { paragraph: 4, word: 0 } });
    expect(jumped.anchor).toMatchObject({ moveMs: 200, fromWpm: 140, toWpm: 140, rampMs: 0 });
    expect((jumped.anchor as JsonObject).moveFromPosition).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(((await glass()).anchor as JsonObject).ageMs).toBe(1_000);

    await call("prompter.jump", { to: "top" });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await glass()).toMatchObject({ playing: false, place: { paragraph: 0, word: 0 } });
    await call("prompter.play");
    await call("prompter.pause");
    const paused = (await glass()).anchor as JsonObject;
    expect(paused).toMatchObject({ playing: false, toWpm: 0, rampMs: 300 });
  });

  // §5 (answered in §14): BACK goes to the start of the paragraph at the reading line, and
  // from its first line to the one before; the paragraph and cue steps go on or back.
  it("goes where BACK, the paragraph steps and the cue steps say", async () => {
    const { call, refused, script, glass } = openPrompterDouble();
    await call("prompter.putOn", {
      scriptId: await script("Talk", ["[INTRO]", "one two three four", "[GUEST]", "five six seven eight", "nine ten"]),
    });
    const at = async () => (await glass()).place;

    await call("prompter.jump", { to: "place", paragraph: 3, word: 2 });
    expect(await at()).toEqual({ paragraph: 3, word: 2 });
    await call("prompter.jump", { to: "back" });
    expect(await at()).toEqual({ paragraph: 3, word: 0 });
    await call("prompter.jump", { to: "back" });
    expect(await at()).toEqual({ paragraph: 2, word: 0 });
    await call("prompter.jump", { to: "nextParagraph" });
    expect(await at()).toEqual({ paragraph: 3, word: 0 });
    await call("prompter.jump", { to: "previousCue" });
    expect(await at()).toEqual({ paragraph: 2, word: 0 });
    await call("prompter.jump", { to: "previousCue" });
    expect(await at()).toEqual({ paragraph: 0, word: 0 });
    expect(await refused("prompter.jump", { to: "previousCue" })).toEqual({
      code: "PROMPTER_NO_CUE",
      sentence: "There is no cue before the reading line.",
    });
    await call("prompter.jump", { to: "nextCue" });
    expect(await at()).toEqual({ paragraph: 2, word: 0 });
    await call("prompter.jump", { to: "previousParagraph" });
    expect(await at()).toEqual({ paragraph: 1, word: 0 });
    await call("prompter.jump", { to: "paragraph", paragraph: 4 });
    expect(await refused("prompter.jump", { to: "nextCue" })).toEqual({
      code: "PROMPTER_NO_CUE",
      sentence: "There is no cue after the reading line.",
    });
    // From the last paragraph there is no next one (review of 2026-09-27).
    expect((await refused("prompter.jump", { to: "nextParagraph" })).code).toBe("PROMPTER_NO_PARAGRAPH");
    expect(await at()).toEqual({ paragraph: 4, word: 0 });
    expect((await glass()).cues).toEqual([
      { paragraph: 0, word: 0, text: "INTRO" },
      { paragraph: 2, word: 0, text: "GUEST" },
    ]);
    expect(await refused("prompter.jump", { to: "paragraph", paragraph: 5 })).toEqual({
      code: "INVALID_PARAMS",
      sentence: "The script on the prompter has 5 paragraphs; paragraph must be 0–4.",
    });
    expect((await refused("prompter.jump", { to: "sideways" })).sentence).toBe(
      "to must be top, back, nextLine, previousLine, nextParagraph, previousParagraph, nextCue, previousCue, paragraph or place, not sideways."
    );
    expect((await refused("prompter.jump", { to: "paragraph" })).sentence).toBe("paragraph must be a whole number.");
  });

  // The hardware link's `there_is_no_paragraph_after_the_last` (review of 2026-09-27, L3):
  // from the last paragraph, or the end, there is no next one, and the text does not move
  // (it went back to the paragraph's start); from the end the one before is the last.
  it("has no paragraph after the last", async () => {
    const { call, refused, script, glass, layOut } = openPrompterDouble();
    await call("prompter.putOn", { scriptId: await script("Talk", ["one two three", "four five six"]) });
    await call("prompter.jump", { to: "place", paragraph: 1, word: 2 });
    expect(await refused("prompter.jump", { to: "nextParagraph" })).toEqual({
      code: "PROMPTER_NO_PARAGRAPH",
      sentence: "There is no paragraph after the reading line.",
    });
    expect((await glass()).place).toEqual({ paragraph: 1, word: 2 });

    await layOut(5, 10);
    await call("prompter.speed", { wpm: 300 });
    await call("prompter.play");
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await glass()).atEnd).toBe(true);
    expect((await refused("prompter.jump", { to: "nextParagraph" })).code).toBe("PROMPTER_NO_PARAGRAPH");
    await call("prompter.jump", { to: "previousParagraph" });
    expect((await glass()).place).toEqual({ paragraph: 1, word: 0 });
  });

  // §5 (answered in §14) with a layout: BACK reads the line the reading line is on, so
  // from the paragraph's first line it goes to the one before, and from a later line to
  // its paragraph's start; a line step keeps the words at the reading line's share.
  it("takes BACK from the line the reading line is on", async () => {
    const { call, script, glass, layOut } = openPrompterDouble();
    await call("prompter.putOn", {
      scriptId: await script("Talk", ["one two three four", "five six seven eight nine ten eleven twelve"]),
    });
    await layOut(4, 100);
    await call("prompter.jump", { to: "place", paragraph: 1, word: 2 });
    await call("prompter.jump", { to: "back" });
    expect((await glass()).place).toEqual({ paragraph: 0, word: 0 });
    await call("prompter.jump", { to: "place", paragraph: 1, word: 5 });
    await call("prompter.jump", { to: "back" });
    expect((await glass()).place).toEqual({ paragraph: 1, word: 0 });
    await call("prompter.jump", { to: "nextLine" });
    expect(await glass()).toMatchObject({ place: { paragraph: 1, word: 4 }, anchor: { wordOffset: 4 } });
  });

  // The hardware link's `letting_go_of_an_edited_script_carries_its_place_into_its_text`
  // (review of 2026-09-27, M1): the script on the glass keeps its place in the glass's
  // text; when it was edited and never Updated, Clear and Replace carry the place into the
  // edited text (it was saved as it stood: paragraphs cut above the reading line put the
  // next put-on paragraphs late).
  it("carries an edited script's place into its own text when the glass lets go of it", async () => {
    const { call, script, edit, snapshot, glass } = openPrompterDouble();
    const texts = Array.from({ length: 10 }, (_, index) => `Paragraph number ${index} here.`);
    const talk = await script("Talk", texts);
    const other = await script("Other", ["Something else."]);
    await call("prompter.putOn", { scriptId: talk });
    await call("prompter.jump", { to: "place", paragraph: 7, word: 2 });
    // Paragraphs 2 to 4 cut, with no Update.
    await edit(talk, [...texts.slice(0, 2), ...texts.slice(5)]);
    await call("prompter.clear");
    const row = async () => ((await snapshot()).scripts as JsonObject[]).find((entry) => entry.id === talk)!.place;
    expect(await row()).toEqual({ paragraph: 4, word: 2 });
    await call("prompter.putOn", { scriptId: talk });
    expect((await glass()).place).toEqual({ paragraph: 4, word: 2 });

    // Replacing it does the same: its first paragraph cut, with no Update.
    await edit(talk, [...texts.slice(1, 2), ...texts.slice(5)]);
    await call("prompter.putOn", { scriptId: other, replace: true });
    expect(await row()).toEqual({ paragraph: 3, word: 2 });
  });

  // §5.1 and §4.1: the pace is 40–300 in steps of 5 and the script's own; the size moves in
  // 4 px steps inside 48–160, Standard goes back, a new standard carries the take along
  // when it was at the standard, and only what moves the lines is laid out again.
  it("keeps the speed, the size and the look in their ranges", async () => {
    const { call, refused, script, snapshot, glass } = openPrompterDouble();
    await call("prompter.putOn", { scriptId: await script("Talk", ["one two three"]) });
    expect((await call("prompter.speed", { step: 2 })).speedWpm).toBe(150);
    expect((await call("prompter.speed", { step: -100 })).speedWpm).toBe(40);
    expect(await refused("prompter.speed", { wpm: 142 })).toEqual({
      code: "INVALID_PARAMS",
      sentence: "wpm must be 40–300 in steps of 5.",
    });
    expect((await refused("prompter.speed", { wpm: 140, step: 1 })).sentence).toBe(
      "Give the pace as wpm or as step, not both."
    );
    expect((await refused("prompter.speed", { step: 0 })).sentence).toBe(
      "step must be a whole number of steps, not 0."
    );
    expect(((await snapshot()).scripts as JsonObject[])[0]?.speedWpm).toBe(40);

    expect((await call("prompter.textSize", { step: 3 })).sizePx).toBe(100);
    expect(await snapshot()).toMatchObject({ sizePx: 100, glass: { layoutKey: "g1-l1" } });
    expect((await call("prompter.textSize", { standard: true })).sizePx).toBe(88);
    expect((await call("prompter.textSize", { step: -20 })).sizePx).toBe(48);
    expect((await refused("prompter.textSize", { sizePx: 90 })).sentence).toBe("sizePx must be 48–160 in steps of 4.");
    expect((await refused("prompter.textSize", { sizePx: 92, standard: true })).sentence).toBe(
      "Give the size as sizePx, step or standard, one of them."
    );

    await call("prompter.textSize", { standard: true });
    await call("prompter.look.update", { standardSizePx: 96, textColour: "yellow" });
    const looked = await snapshot();
    expect(looked).toMatchObject({ sizePx: 96, look: { standardSizePx: 96, textColour: "yellow" } });
    const key = (await glass()).layoutKey;
    await call("prompter.look.update", { dimReadText: false });
    expect((await glass()).layoutKey).toBe(key);
    await call("prompter.look.update", { marginPercent: 20 });
    expect((await glass()).layoutKey).not.toBe(key);

    for (const [params, sentence] of [
      [{ standardSizePx: 90 }, "The standard text size must be 48–160 px in steps of 4."],
      [
        { lineSpacingPercent: 145 },
        "The line spacing must be 1.1–2.0 in steps of 0.1 (lineSpacingPercent 110–200 in steps of 10).",
      ],
      [{ marginPercent: 31 }, "The margins must be 0–30 % each side."],
      [{ textColour: "green" }, "The text colour must be white or yellow."],
      [{ readingLinePercent: 70 }, "The reading line must be 20–60 % from the top."],
      [{ readingLineAcross: "yes" }, "readingLineAcross must be true or false."],
      [{ paragraphNumbers: true, marginPercent: 2.5 }, "marginPercent must be a whole number."],
      [{ blinking: true }, "The look has no setting called blinking."],
      [{}, "The look's update names no setting."],
    ] as const) {
      expect(await refused("prompter.look.update", params as JsonObject), JSON.stringify(params)).toEqual({
        code: "INVALID_PARAMS",
        sentence,
      });
    }
    expect((await snapshot()).look).toMatchObject({ paragraphNumbers: false, marginPercent: 20 });
  });

  // The proposal §5.5 and the ledger's Slice 4: putting on, replacing, updating and
  // clearing are Recent actions rows from the screen; a take's controls, the scripts'
  // bookkeeping and a refusal leave none.
  it("leaves a Recent actions row for what the glass shows, and none for the take", async () => {
    const { call, refused, script, edit } = openPrompterDouble();
    const before = ((await call("support.snapshot")).recentEvents as JsonObject[]).length;
    const intro = await script("Intro", ["Hello."]);
    const outro = await script("Outro", ["Bye."]);
    await call("prompter.putOn", { scriptId: intro });
    await refused("prompter.putOn", { scriptId: outro });
    await call("prompter.putOn", { scriptId: outro, replace: true });
    await edit(outro, ["Goodbye."]);
    await call("prompter.update");
    await call("prompter.speed", { step: 1 });
    await call("prompter.jump", { to: "top" });
    await call("prompter.clear");

    const rows = ((await call("support.snapshot")).recentEvents as JsonObject[]).slice(0, -before || undefined);
    expect(rows.reverse().map((row) => [row.source, row.domain, row.action, row.target, row.detail])).toEqual([
      ["ui", "prompter", "put-on", "Intro", "Put Intro on the prompter"],
      ["ui", "prompter", "replaced", "Outro", "Replaced Intro with Outro on the prompter"],
      ["ui", "prompter", "updated", "Outro", "Updated Outro on the prompter"],
      ["ui", "prompter", "cleared", "Outro", "Cleared the prompter"],
    ]);
  });
});
