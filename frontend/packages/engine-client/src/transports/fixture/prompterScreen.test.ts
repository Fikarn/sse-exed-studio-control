/// <reference types="node" />
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fixtureIds, getFixtureScenario } from "@sse/test-fixtures";

import type { JsonObject } from "../../generated/protocol";
import type { FixtureScenario } from "../../types";
import { EngineRequestError } from "../engineRequestError";
import { createFixtureTransport } from "../fixtureTransport";
import {
  connectedScreen,
  playRefusal,
  prompterHealthCheck,
  screenDraws,
  screenFromReport,
  screenSentence,
  screenState,
  screenSummary,
  unreportedScreen,
  wholeStatus,
  wholeStatusPart,
} from "./prompterScreen";
import { openPrompterDouble } from "./prompterTestSupport";
import { withPrompterStatus } from "./state";

// The fixture double's Prompter XL (new pages program, Slice 5a), held to what the
// hardware link's own tests hold it to (`native/rust-engine/src/prompter/screen.rs`'s
// tests, `prompter/tests_screen.rs`, the last test of `app/tests_prompter.rs` and
// `health.rs`'s): the state the shell reports, `PLAY`'s lock, the pause when the glass
// goes, and the check the header's lamp reads. One difference, by design: the double
// starts after the shell's first report, with the Prompter XL connected at its own size.

const NOW = Date.parse("2026-09-27T12:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

const FULL = { found: true, width: 1920, height: 1080, refreshHz: 60 };
const LOW = { found: true, width: 1280, height: 720, refreshHz: 60 };
const GONE = { found: false };

const REFUSALS = {
  notConnected:
    "The Prompter XL is not connected, so the text cannot scroll. Jumps, speed and size still work, and the place they set is where it comes back.",
  duplicated:
    "Windows shows a copy of another screen on the Prompter XL, so the text is not drawn there and cannot scroll.",
  notShowing: "Studio Control's window on the Prompter XL is not open, so the text cannot scroll.",
};

/** A double with a script called `Talk` on the glass, laid out two words a line (`on_the_glass`). */
async function onTheGlass(scenario?: FixtureScenario) {
  const double = openPrompterDouble(scenario);
  const talk = await double.script("Talk", ["one two three four", "five six seven eight"]);
  await double.call("prompter.putOn", { scriptId: talk });
  await double.layOut(2, 100);
  return { ...double, talk };
}

/** The events since the last look, as `[event, reason]`. */
const seen = (events: Array<{ event: string; payload: JsonObject }>) =>
  events.splice(0).map(({ event, payload }) => [event, payload.reason]);

/** `setup-ready`, or `id`, with the Prompter XL as `prompterScreen` says. */
function scenarioWith(prompterScreen: unknown, id = "setup-ready"): FixtureScenario {
  const scenario = JSON.parse(JSON.stringify(getFixtureScenario(id))) as JsonObject;
  scenario.prompterScreen = prompterScreen as JsonObject;
  return scenario as unknown as FixtureScenario;
}

async function healthOf(call: (method: "health.snapshot") => Promise<JsonObject>) {
  const health = await call("health.snapshot");
  return { status: health.status, check: (health.checks as JsonObject).prompter as JsonObject };
}

describe("the fixture double's Prompter XL: where it starts", () => {
  // The deliberate difference: the hardware link reads NOT CONNECTED until the shell's
  // first report (first step 2); the double stands for it after that report.
  it("starts every scenario with the Prompter XL connected, and moves no board's status", async () => {
    for (const id of fixtureIds) {
      const transport = createFixtureTransport(getFixtureScenario(id));
      const health = (await transport.request("health.snapshot", {})) as JsonObject;
      const check = (health.checks as JsonObject).prompter as JsonObject;
      expect(check, id).toMatchObject({ ok: true, status: "ok", word: "CONNECTED", notUpdated: false });
      expect((check.screen as JsonObject).reported, id).toBe(true);
    }
    const status = async (id: string) =>
      ((await createFixtureTransport(getFixtureScenario(id)).request("health.snapshot", {})) as JsonObject).status;
    expect(await status("setup-ready")).toBe("ok");
    expect(await status("setup-required")).toBe("attention");
    expect(await status("setup-degraded")).toBe("attention");

    const { snapshot, call } = openPrompterDouble();
    expect((await snapshot()).screen).toEqual(screenSummary(connectedScreen()));
    expect((await healthOf(call)).check).toEqual({
      ok: true,
      status: "ok",
      word: "CONNECTED",
      summary: "The Prompter XL is connected: 1920×1080 at 60 Hz.",
      notUpdated: false,
      screen: screenSummary(connectedScreen()),
    });
  });

  it("lets a scenario start the Prompter XL in another state, and refuses one the shell could not report", async () => {
    const gone = openPrompterDouble(scenarioWith(GONE));
    expect((await gone.snapshot()).screen).toMatchObject({ word: "NOT CONNECTED", reported: true, width: null });
    expect(await healthOf(gone.call)).toMatchObject({ status: "attention", check: { status: "error" } });
    const talk = await gone.script("Talk", ["one two"]);
    await gone.call("prompter.putOn", { scriptId: talk });
    await gone.layOut(2, 100);
    expect((await gone.refused("prompter.play")).code).toBe("PROMPTER_NOT_ON_GLASS");

    const low = openPrompterDouble(scenarioWith(LOW));
    expect((await low.snapshot()).screen).toMatchObject({ word: "LOW RESOLUTION", tone: "attention" });
    expect(await healthOf(low.call)).toMatchObject({ status: "attention", check: { word: "LOW RESOLUTION" } });

    expect(() => createFixtureTransport(scenarioWith({ found: true }))).toThrow(
      "prompterScreen is not a report the shell could send: width must be a number above 0 when the screen was found."
    );
    expect(() => createFixtureTransport(scenarioWith("connected"))).toThrow("prompterScreen must be an object");
  });
});

describe("the fixture double's Prompter XL: what the shell reports", () => {
  // screen.rs's `before_a_report_the_prompter_xl_is_not_connected`: where the hardware link
  // starts. The double never starts there, so it is held to it here, without a request.
  it("reads NOT CONNECTED, with a sentence of its own, before any report", () => {
    const screen = unreportedScreen();
    expect(screenState(screen)).toBe("not-connected");
    expect(screenDraws(screenState(screen))).toBe(false);
    expect(screenSentence(screen)).toBe(
      "Windows has not reported the Prompter XL since Studio Control started. The script and the place are kept, and nothing is shown on any other screen."
    );
    expect(playRefusal(screen)?.code).toBe("PROMPTER_NOT_ON_GLASS");
    expect(screenSummary(screen)).toMatchObject({ reported: false, word: "NOT CONNECTED", tone: "error" });
  });

  // screen.rs's `the_state_follows_what_windows_reports`, through the request path.
  it("follows what Windows reports, in its word and its sentence", async () => {
    const { reportScreen } = openPrompterDouble();
    const low = await reportScreen(LOW);
    expect(low).toEqual({
      screen: {
        state: "low-resolution",
        word: "LOW RESOLUTION",
        tone: "attention",
        reported: true,
        draws: true,
        width: 1280,
        height: 720,
        refreshHz: 60,
        windowError: null,
        sentence:
          "Windows runs the Prompter XL at 1280×720. Set it to 1920×1080 in Windows' display settings for the sharpest text.",
      },
      paused: false,
    });
    expect((await reportScreen(FULL)).screen).toMatchObject({
      state: "connected",
      word: "CONNECTED",
      tone: "ok",
      draws: true,
      sentence: "The Prompter XL is connected: 1920×1080 at 60 Hz.",
    });
    const duplicated = await reportScreen({ ...FULL, duplicated: true, windowError: "ignored while duplicated" });
    expect(duplicated.screen).toMatchObject({
      state: "duplicated",
      word: "DUPLICATED",
      tone: "error",
      draws: false,
      sentence:
        "Windows shows a copy of another screen on the Prompter XL, so the script is not drawn there. In Windows' display settings, choose Extend these displays.",
    });
    const failed = await reportScreen({ ...FULL, windowError: "  The window could not be created.  " });
    expect(failed.screen).toMatchObject({
      state: "not-showing",
      word: "NOT SHOWING",
      tone: "error",
      draws: false,
      windowError: "The window could not be created.",
      sentence: "Studio Control could not open its window on the Prompter XL.",
    });
    const gone = await reportScreen({ found: false, width: 1920 });
    expect(gone.screen).toMatchObject({
      state: "not-connected",
      word: "NOT CONNECTED",
      reported: true,
      width: null,
      height: null,
      refreshHz: null,
      sentence:
        "Windows does not see the Prompter XL. Check its USB-C cable; it needs 15 W. The script and the place are kept, and nothing is shown on any other screen.",
    });
    const long = await reportScreen({ ...FULL, windowError: "é".repeat(400) });
    expect((long.screen as JsonObject).windowError).toBe("é".repeat(300));
  });

  // screen.rs's `a_report_that_is_not_one_is_refused`: refused, and nothing changes.
  it("refuses a report that is not one, and changes nothing", async () => {
    const { refused, snapshot, events } = openPrompterDouble();
    const width = "width must be a number above 0 when the screen was found.";
    for (const [params, sentence] of [
      [{}, "found must be true or false."],
      [{ found: "yes" }, "found must be true or false."],
      [{ found: true }, width],
      [{ ...FULL, width: 0 }, width],
      [{ ...FULL, width: 0.4 }, width],
      [{ ...FULL, refreshHz: 100_001 }, "refreshHz must be a number above 0 when the screen was found."],
      [{ ...FULL, refreshHz: 0 }, "refreshHz must be a number above 0 when the screen was found."],
      [{ ...FULL, duplicated: 1 }, "duplicated must be true or false."],
      [{ ...FULL, windowError: " " }, "windowError must be a sentence."],
      [{ ...FULL, windowError: 3 }, "windowError must be a sentence."],
    ] as const) {
      expect(await refused("prompter.screen.report", params as JsonObject), JSON.stringify(params)).toEqual({
        code: "INVALID_PARAMS",
        sentence,
      });
    }
    expect((await snapshot()).screen).toEqual(screenSummary(connectedScreen()));
    expect(events).toEqual([]);
  });

  // `tests_screen.rs`'s `the_same_report_again_raises_nothing`: the shell may report the
  // same screen again, and the lamp does not flicker.
  it("raises nothing for the same report again", async () => {
    const { reportScreen, refused, events } = openPrompterDouble();
    expect(await reportScreen(FULL)).toEqual({ screen: screenSummary(connectedScreen()), paused: false });
    expect(events).toEqual([]);
    // Another refresh rate is another report: the check carries the rate the page shows.
    await reportScreen({ ...FULL, refreshHz: 50 });
    expect(seen(events)).toEqual([
      ["prompter.changed", "screen"],
      ["app.changed", "health"],
    ]);
    expect((await refused("prompter.screen.report", { found: true })).code).toBe("INVALID_PARAMS");
    expect(events).toEqual([]);
  });

  // screen.rs's `only_a_drawn_glass_lets_the_text_scroll`.
  it("lets the text scroll only on a drawn glass", () => {
    for (const [params, plays] of [
      [FULL, true],
      [LOW, true],
      [GONE, false],
      [{ ...FULL, duplicated: true }, false],
      [{ ...FULL, windowError: "no" }, false],
    ] as const) {
      const screen = screenFromReport(params);
      expect(playRefusal(screen) === null, JSON.stringify(params)).toBe(plays);
      expect(screenDraws(screenState(screen)), JSON.stringify(params)).toBe(plays);
    }
  });
});

describe("the fixture double's Prompter XL: the take", () => {
  // `tests_screen.rs`'s `play_waits_for_a_drawn_glass` (the proposal §7–8 and board 1):
  // PLAY is refused while nothing is drawn on the glass, with the reason; LOW RESOLUTION
  // still plays; nothing on the prompter is still the first reason.
  it("refuses PLAY while nothing is drawn on the glass, and plays at low resolution", async () => {
    const { call, refused, reportScreen, snapshot, glass } = await onTheGlass();
    for (const [params, sentence] of [
      [GONE, REFUSALS.notConnected],
      [{ ...FULL, duplicated: true }, REFUSALS.duplicated],
      [{ ...FULL, windowError: "The window could not be created." }, REFUSALS.notShowing],
    ] as const) {
      await reportScreen(params);
      expect(await refused("prompter.play"), JSON.stringify(params)).toEqual({
        code: "PROMPTER_NOT_ON_GLASS",
        sentence,
      });
    }
    await reportScreen(LOW);
    expect(((await snapshot()).screen as JsonObject).word).toBe("LOW RESOLUTION");
    await call("prompter.play");
    expect((await glass()).playing).toBe(true);

    await call("prompter.clear");
    await reportScreen(GONE);
    expect((await refused("prompter.play")).code).toBe("PROMPTER_NOTHING_ON");
  });

  // `play_request`'s order: nothing on, then the glass, then END, then the layout.
  it("gives the glass as the reason before END and before the layout", async () => {
    const { call, refused, reportScreen, script, layOut, glass } = openPrompterDouble();
    await call("prompter.putOn", { scriptId: await script("Short", ["Go."]) });
    await reportScreen(GONE);
    expect((await refused("prompter.play")).code).toBe("PROMPTER_NOT_ON_GLASS");
    await reportScreen(FULL);
    expect((await refused("prompter.play")).code).toBe("PROMPTER_NOT_LAID_OUT");

    await layOut(5, 10);
    await call("prompter.speed", { wpm: 300 });
    await call("prompter.play");
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await glass()).atEnd).toBe(true);
    await reportScreen(GONE);
    expect((await refused("prompter.play")).code).toBe("PROMPTER_NOT_ON_GLASS");
    await reportScreen(FULL);
    expect((await refused("prompter.play")).code).toBe("PROMPTER_AT_END");
  });

  // `tests_screen.rs`'s `until_the_shell_reports_the_prompter_xl_is_not_connected`, from a
  // report rather than a start: PLAY is refused, the rest of the take works, and a report
  // that brings the glass back lets PLAY through.
  it("keeps the rest of the take working while the Prompter XL is not connected", async () => {
    const { call, refused, reportScreen, connectScreen, layOut, glass } = await onTheGlass();
    await reportScreen(GONE);
    expect(await refused("prompter.play")).toEqual({ code: "PROMPTER_NOT_ON_GLASS", sentence: REFUSALS.notConnected });
    await call("prompter.jump", { to: "nextParagraph" });
    await call("prompter.speed", { step: 1 });
    await call("prompter.textSize", { step: 1 });
    await call("prompter.pause");
    expect(await glass()).toMatchObject({ place: { paragraph: 1, word: 0 }, speedWpm: 145, playing: false });

    await connectScreen();
    await layOut(2, 100);
    await call("prompter.play");
    expect((await glass()).playing).toBe(true);
  });

  // `tests_screen.rs`'s `a_glass_that_goes_pauses_the_scroll_and_its_return_leaves_it_paused`
  // (the proposal §7; D12: nothing scrolls by itself).
  it("pauses the scroll when the glass goes, and leaves it paused when it comes back", async () => {
    const { call, reportScreen, connectScreen, glass, snapshot, events } = await onTheGlass();
    await call("prompter.speed", { wpm: 300 });
    await call("prompter.play");
    await vi.advanceTimersByTimeAsync(400);
    events.length = 0;

    const reply = await reportScreen(GONE);
    expect(reply.paused).toBe(true);
    expect(reply.screen).toMatchObject({ word: "NOT CONNECTED", reported: true });
    expect(events.map(({ event, payload }) => [event, payload.reason])).toEqual([
      ["prompter.changed", "screen"],
      ["app.changed", "health"],
    ]);
    expect(events[0]?.payload.anchor).toMatchObject({ playing: false, toWpm: 0, rampMs: 300 });

    // Where the 0.3 s ease stops the text is where it stays, and what was saved.
    await vi.advanceTimersByTimeAsync(400);
    const place = (await glass()).place;
    await vi.advanceTimersByTimeAsync(200);
    expect((await glass()).place, "it stays put").toEqual(place);
    expect(((await snapshot()).scripts as JsonObject[])[0]?.place).toEqual(place);

    const back = await connectScreen();
    expect(back.paused).toBe(false);
    expect(await glass(), "plugging back in never plays").toMatchObject({ playing: false, place });
  });

  it("does not pause a glass that still draws, or one that was not scrolling", async () => {
    const { call, reportScreen, glass } = await onTheGlass();
    await call("prompter.play");
    expect((await reportScreen(LOW)).paused).toBe(false);
    expect((await glass()).playing).toBe(true);
    await call("prompter.pause");
    expect((await reportScreen(GONE)).paused).toBe(false);
  });
});

describe("the fixture double's Prompter XL: what Windows may report", () => {
  // screen.rs's `a_refresh_rate_may_be_a_fraction_or_missing` (review of the slice's push).
  it("keeps a refresh rate that is a fraction or missing, and a window error only when it is the state", () => {
    const fraction = screenFromReport({ found: true, width: 1920, height: 1080, refreshHz: 59.94 });
    expect(screenState(fraction)).toBe("connected");
    expect(fraction.refreshHz).toBe(60);
    const missing = screenFromReport({ found: true, width: 1920, height: 1080 });
    expect(missing.refreshHz).toBeNull();
    expect(screenSentence(missing)).toBe("The Prompter XL is connected: 1920×1080.");
    const duplicated = screenFromReport({
      found: true,
      duplicated: true,
      windowError: "no",
      width: 1920,
      height: 1080,
    });
    expect(duplicated.windowError).toBeNull();
    expect(() => screenFromReport({ found: true, width: 1920, height: 1080, refreshHz: 0 })).toThrow(
      "refreshHz must be a number above 0 when the screen was found."
    );
  });

  it("starts a scenario unreported when it says so, and leaves the whole status alone", async () => {
    const scenario: FixtureScenario = { ...getFixtureScenario("setup-ready"), prompterScreen: "unreported" };
    const { call } = openPrompterDouble(scenario);
    const health = await call("health.snapshot");
    const check = (health.checks as JsonObject).prompter as JsonObject;
    expect(check).toMatchObject({ word: "NOT CONNECTED", status: "error" });
    expect((check.screen as JsonObject).reported).toBe(false);
    expect(health.summary).not.toMatch(/Prompter:/);
  });
});

describe("the fixture double's Prompter XL: the lamp", () => {
  // screen.rs's `the_check_is_the_worse_of_the_screen_and_not_updated`.
  it("makes the check the worse of the screen and NOT UPDATED", () => {
    const full = screenFromReport(FULL);
    const check = prompterHealthCheck(full, null);
    expect(check.ok).toBe(true);
    expect(check.word).toBe("CONNECTED");
    expect(wholeStatus(full)).toBe("ok");

    const edited = prompterHealthCheck(full, "Intro");
    expect(edited).toMatchObject({ ok: false, status: "attention", word: "NOT UPDATED", notUpdated: true });
    expect(edited.summary).toBe(
      "Intro was edited after it went on the prompter. The prompter still shows the earlier text."
    );

    const low = screenFromReport(LOW);
    expect(prompterHealthCheck(low, "Intro").word).toBe("NOT UPDATED");
    expect(prompterHealthCheck(low, null).word).toBe("LOW RESOLUTION");

    const gone = prompterHealthCheck(screenFromReport(GONE), "Intro");
    expect(gone).toMatchObject({ status: "error", word: "NOT CONNECTED", notUpdated: true });
    expect(wholeStatus(screenFromReport(GONE)), "the whole status goes no worse than attention").toBe("attention");
    expect(wholeStatusPart(screenFromReport(GONE))?.sentence).toBe(screenSentence(screenFromReport(GONE)));
  });

  // screen.rs's `only_a_reported_state_counts_toward_the_whole_status` (answered after CI's
  // qualification lane found every lane's status raised by an unreported Prompter XL, and at
  // the review: NOT UPDATED lights the lamp only).
  it("counts only a reported Prompter XL state toward the whole status, never NOT UPDATED", () => {
    const unreported = unreportedScreen();
    expect(prompterHealthCheck(unreported, null)).toMatchObject({ word: "NOT CONNECTED", status: "error" });
    expect(wholeStatusPart(unreported)).toBeNull();
    expect(wholeStatus(unreported)).toBe("ok");
    const full = screenFromReport(FULL);
    expect(prompterHealthCheck(full, "Intro").word, "the lamp says so").toBe("NOT UPDATED");
    expect(wholeStatus(full), "an edit waiting for Update is work, not a fault").toBe("ok");
    expect(wholeStatusPart(screenFromReport(LOW))?.sentence).toMatch(/^Windows runs the Prompter XL at 1280×720\./);
  });

  // `health.rs`'s `the_prompter_raises_the_whole_status_no_further_than_attention`.
  it("raises the whole status no further than attention, and never lowers it", () => {
    expect(withPrompterStatus("ok", "ok")).toBe("ok");
    expect(withPrompterStatus("ok", "attention")).toBe("attention");
    expect(withPrompterStatus("ok", "error")).toBe("attention");
    expect(withPrompterStatus("warning", "error")).toBe("attention");
    expect(withPrompterStatus("attention", "ok")).toBe("attention");
    expect(withPrompterStatus("error", "ok")).toBe("error");
    expect(withPrompterStatus("error", "attention")).toBe("error");
  });

  // `tests_screen.rs`'s `the_check_follows_the_screen_and_not_updated` (first step 3): a
  // request after which the check says something else says so, and a take's controls do
  // not; the whole status follows, no further than attention.
  it("follows the screen and NOT UPDATED, and says so after the request's own event", async () => {
    const { call, edit, reportScreen, connectScreen, events, talk } = await onTheGlass();
    expect(await healthOf(call)).toMatchObject({ status: "ok", check: { ok: true, word: "CONNECTED" } });

    events.length = 0;
    await call("prompter.play");
    await call("prompter.jump", { to: "nextParagraph" });
    expect(seen(events), "a take's controls leave the lamp alone").toEqual([
      ["prompter.changed", "played"],
      ["prompter.changed", "jumped"],
    ]);

    await edit(talk, ["one two"]);
    expect(seen(events)).toEqual([
      ["prompter.changed", "script-edited"],
      ["app.changed", "health"],
    ]);
    const edited = await healthOf(call);
    expect(edited.status, "NOT UPDATED lights the lamp only").toBe("ok");
    expect(edited.check).toMatchObject({ ok: false, status: "attention", word: "NOT UPDATED", notUpdated: true });
    expect(edited.check.summary).toBe(
      "Talk was edited after it went on the prompter. The prompter still shows the earlier text."
    );

    await reportScreen(GONE);
    expect(seen(events)).toEqual([
      ["prompter.changed", "screen"],
      ["app.changed", "health"],
    ]);
    const gone = await healthOf(call);
    expect(gone.check).toMatchObject({ status: "error", word: "NOT CONNECTED", notUpdated: true });
    expect(gone.status, "no worse than attention").toBe("attention");

    await connectScreen();
    expect((await healthOf(call)).check.word).toBe("NOT UPDATED");
    events.length = 0;
    await call("prompter.update");
    expect(seen(events)).toEqual([
      ["prompter.changed", "updated"],
      ["app.changed", "health"],
    ]);
    expect(await healthOf(call)).toMatchObject({ status: "ok", check: { ok: true, word: "CONNECTED" } });
  });

  it("leaves a whole status that was already attention as it was", async () => {
    const { call, reportScreen } = openPrompterDouble(getFixtureScenario("setup-degraded"));
    expect((await healthOf(call)).status).toBe("attention");
    await reportScreen(GONE);
    expect(await healthOf(call)).toMatchObject({ status: "attention", check: { status: "error" } });
    await reportScreen(FULL);
    expect((await healthOf(call)).status).toBe("attention");
  });

  // `app/tests_prompter.rs`'s `the_prompter_xl_reaches_the_health_check_and_the_lamp_follows`:
  // the report goes through the request path like any request, the health snapshot carries
  // the check, and it is never a Recent actions row.
  it("reaches the health snapshot through the request path, and is never a Recent actions row", async () => {
    const { call, reportScreen, events } = openPrompterDouble();
    const rows = async () => ((await call("support.snapshot")).recentEvents as JsonObject[]).length;
    const before = await rows();

    await reportScreen(GONE);
    expect(seen(events)).toEqual([
      ["prompter.changed", "screen"],
      ["app.changed", "health"],
    ]);
    expect((await healthOf(call)).check).toMatchObject({ word: "NOT CONNECTED", status: "error" });
    // Reported gone, it counts: the summary Setup / Support shows says why.
    const gone = await call("health.snapshot");
    expect(gone.summary).toMatch(/ Prompter: Windows does not see the Prompter XL\. /);

    await reportScreen(FULL);
    expect(seen(events)).toEqual([
      ["prompter.changed", "screen"],
      ["app.changed", "health"],
    ]);
    const { check } = await healthOf(call);
    expect(check).toMatchObject({ word: "CONNECTED", ok: true });
    expect((await call("health.snapshot")).summary).not.toMatch(/Prompter:/);
    expect((check.screen as JsonObject).sentence).toBe("The Prompter XL is connected: 1920×1080 at 60 Hz.");

    await reportScreen(FULL);
    expect(events, "the same report raises nothing").toEqual([]);
    expect(await rows(), "never a Recent actions row").toBe(before);
  });
});

// The double's words for the Prompter XL are screen.rs's own. They are read from it here
// (as `setupRequests.test.ts` reads `support.rs`), so a sentence reworded on one side only
// fails: each of the double's sentences must be one of screen.rs's string literals with its
// `format!` placeholders filled — `{}` in turn with what the double put there, a named one
// with the value it names (screen.rs's own constants, `FULL_WIDTH_PX` and the like).

/** screen.rs above its tests: the sentences the hardware link says, not its tests' copies of them. */
const SCREEN_RS = (() => {
  const source = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../../native/rust-engine/src/prompter/screen.rs"),
    "utf-8"
  );
  const tests = source.indexOf("#[cfg(test)]");
  if (tests < 0) throw new Error("screen.rs has no #[cfg(test)] module any more; update this test");
  return source.slice(0, tests);
})();

/** Every string literal in screen.rs as written (its sentences hold no `"` and no escape). */
const SCREEN_RS_LITERALS = [...SCREEN_RS.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1]!);

/** A `u32` constant screen.rs names in a sentence; loud when it is gone. */
function screenRsConstant(name: string): string {
  const value = SCREEN_RS.match(new RegExp(`\\bconst ${name}: u32 = ([0-9_]+);`))?.[1];
  if (value === undefined) throw new Error(`${name} is not a u32 constant in screen.rs any more; update this test`);
  return value.replaceAll("_", "");
}

/** Whether `sentence` is one of screen.rs's literals, its placeholders filled. */
function inScreenRs(sentence: string, positional: Array<string | number> = [], named: JsonObject = {}): boolean {
  return SCREEN_RS_LITERALS.some((literal) => {
    let next = 0;
    const filled = literal.replace(/\{(\w*)\}/g, (placeholder, name: string) => {
      if (name === "") return next < positional.length ? String(positional[next++]) : placeholder;
      if (name in named) return String(named[name]);
      return /^[A-Z][A-Z0-9_]*$/.test(name) ? screenRsConstant(name) : placeholder;
    });
    return filled === sentence;
  });
}

function refusalOf(params: JsonObject): string {
  try {
    screenFromReport(params);
  } catch (error) {
    if (error instanceof EngineRequestError) return error.message;
    throw error;
  }
  throw new Error(`${JSON.stringify(params)} should be refused`);
}

describe("the fixture double's Prompter XL: the hardware link's words", () => {
  it("speaks screen.rs's sentences word for word", () => {
    const full = screenFromReport(FULL);
    const low = screenFromReport(LOW);
    const gone = screenFromReport(GONE);
    const duplicated = screenFromReport({ ...FULL, duplicated: true });
    const notShowing = screenFromReport({ ...FULL, windowError: "The window could not be created." });

    // The five states' words and sentences, and the one before any report.
    const mode = "1920×1080 at 60 Hz";
    expect(inScreenRs(mode, [], { width: 1920, height: 1080, refresh: 60 }), mode).toBe(true);
    expect(screenSentence(full)).toBe(`The Prompter XL is connected: ${mode}.`);
    expect(inScreenRs(screenSentence(full), [mode]), screenSentence(full)).toBe(true);
    expect(inScreenRs(screenSentence(low), [1280, 720]), screenSentence(low)).toBe(true);
    for (const screen of [unreportedScreen(), gone, duplicated, notShowing]) {
      expect(inScreenRs(screenSentence(screen)), screenSentence(screen)).toBe(true);
    }
    for (const screen of [full, low, gone, duplicated, notShowing]) {
      expect(inScreenRs(screenSummary(screen).word), screenSummary(screen).word).toBe(true);
    }

    // PLAY's three refusals, and their code.
    for (const screen of [gone, duplicated, notShowing]) {
      const refusal = playRefusal(screen)!;
      expect(inScreenRs(refusal.code), refusal.code).toBe(true);
      expect(inScreenRs(refusal.message), refusal.message).toBe(true);
    }
    expect(playRefusal(unreportedScreen())?.message).toBe(playRefusal(gone)?.message);

    // NOT UPDATED, its word and its sentence.
    const edited = prompterHealthCheck(full, "Intro");
    expect(inScreenRs(edited.word), edited.word).toBe(true);
    expect(inScreenRs(edited.summary, [], { name: "Intro" }), edited.summary).toBe(true);

    // The report's refusals.
    for (const [params, key] of [
      [{}, null],
      [{ found: true, width: 1920, height: 1080, refreshHz: 60, duplicated: 1 }, null],
      [{ found: true, width: 1920, height: 1080, refreshHz: 60, windowError: " " }, null],
      [{ found: true, height: 1080, refreshHz: 60 }, "width"],
      [{ found: true, width: 1920, refreshHz: 60 }, "height"],
      [{ found: true, width: 1920, height: 1080, refreshHz: 0 }, "refreshHz"],
    ] as const) {
      const sentence = refusalOf(params as JsonObject);
      expect(inScreenRs(sentence, [], key === null ? {} : { key }), sentence).toBe(true);
    }
  });

  it("finds a changed sentence", () => {
    // The guard itself: a word changed on one side only is not found.
    expect(inScreenRs("Studio Control could not open its window on the Prompter XL.")).toBe(true);
    expect(inScreenRs("Studio Control could not open a window on the Prompter XL.")).toBe(false);
    expect(inScreenRs("The Prompter XL is connected: 1920×1080 at 60 Hz.", ["1280×720 at 60 Hz"])).toBe(false);
  });
});
