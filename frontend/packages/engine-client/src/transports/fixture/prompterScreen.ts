// Part of the fixture double (`../fixtureTransport.ts`): the in-memory stand-in for the
// hardware link that Playwright and the browser fixture mode run against. Test-only.
import type { JsonObject } from "../../generated/protocol";
import type { PrompterCheckTone } from "../../generated/snapshots/PrompterCheckTone";
import type { PrompterHealthCheck } from "../../generated/snapshots/PrompterHealthCheck";
import type { PrompterScreenState } from "../../generated/snapshots/PrompterScreenState";
import type { PrompterScreenSummary } from "../../generated/snapshots/PrompterScreenSummary";
import { EngineRequestError } from "../engineRequestError";
import { asRecord } from "./json";

// The Prompter XL as Windows reports it (`native/rust-engine/src/prompter/screen.rs`, new
// pages program, Slice 5a; the proposal §7–8, the ledger's D20). Only the shell reads
// Windows' display configuration, so it reports what it found with
// `prompter.screen.report`; the hardware link keeps the report in memory, works out the
// screen's state from it, and owns what follows: `PLAY` is refused while nothing is drawn
// on the glass, a scroll pauses when the glass goes, and `checks.prompter` carries the
// state to the header's lamp. The words, the sentences and the refusals are screen.rs's
// own; `prompterScreen.test.ts` reads them from it.
//
// One difference, by design: the hardware link reads `NOT CONNECTED` after every start
// until the shell's first report (first step 2). The double stands for the hardware link
// after that report, so every scenario starts with the Prompter XL connected at
// 1920×1080, 60 Hz — it stays plugged in (D20) — unless the scenario's `prompterScreen`,
// a report's params, says otherwise.

/** The Prompter XL's own size: below it, the text is drawn soft. */
export const FULL_WIDTH_PX = 1920;
export const FULL_HEIGHT_PX = 1080;
/** The longest reason a report may carry for a window that did not open. */
const MAX_REASON_CHARS = 300;

/** What the shell last reported (`PrompterScreen`), kept in memory only. */
export interface PrompterScreen {
  /** The shell has reported since the start. */
  reported: boolean;
  /** Windows sees a screen named `Prompter XL`. */
  found: boolean;
  duplicated: boolean;
  width: number | null;
  height: number | null;
  refreshHz: number | null;
  /** Why the window on it could not open, in the shell's words. */
  windowError: string | null;
}

/** Before the shell has reported (`PrompterScreen::default()`): where the hardware link starts, never the double. */
export function unreportedScreen(): PrompterScreen {
  return {
    reported: false,
    found: false,
    duplicated: false,
    width: null,
    height: null,
    refreshHz: null,
    windowError: null,
  };
}

/** The report the shell sends when Windows sees the Prompter XL at its own size (`connect_screen`): where the double starts. */
export function connectedScreen(): PrompterScreen {
  return {
    reported: true,
    found: true,
    duplicated: false,
    width: FULL_WIDTH_PX,
    height: FULL_HEIGHT_PX,
    refreshHz: 60,
    windowError: null,
  };
}

export function sameScreen(left: PrompterScreen, right: PrompterScreen): boolean {
  return (Object.keys(left) as Array<keyof PrompterScreen>).every((key) => left[key] === right[key]);
}

/** Not found, then a copy of another screen, then a window that did not open, then below 1920×1080. */
export function screenState(screen: PrompterScreen): PrompterScreenState {
  if (!screen.found) return "not-connected";
  if (screen.duplicated) return "duplicated";
  if (screen.windowError !== null) return "not-showing";
  if ((screen.width ?? 0) < FULL_WIDTH_PX || (screen.height ?? 0) < FULL_HEIGHT_PX) return "low-resolution";
  return "connected";
}

/** The state word (system §8: the word the state display and the lamp show). */
const STATE_WORDS: Record<PrompterScreenState, string> = {
  connected: "CONNECTED",
  "not-connected": "NOT CONNECTED",
  duplicated: "DUPLICATED",
  "low-resolution": "LOW RESOLUTION",
  "not-showing": "NOT SHOWING",
};

/** Whether the glass is drawn on the Prompter XL, so the text may scroll. */
export function screenDraws(state: PrompterScreenState): boolean {
  return state === "connected" || state === "low-resolution";
}

/** The lamp's tone: red while nothing reaches the glass (D20: the Prompter XL stays plugged in), amber while it is drawn soft. */
function screenTone(state: PrompterScreenState): PrompterCheckTone {
  return state === "connected" ? "ok" : state === "low-resolution" ? "attention" : "error";
}

// A report's wrong parameters, answered as `prompterReads.ts`'s `invalid` answers them
// (kept here so that the prompter's state can read this module without a loop).
const invalid = (message: string) => new EngineRequestError("INVALID_PARAMS", message);

/** A found screen's size or refresh rate (`positive`): a whole number above 0, at most 100 000. */
function positive(params: JsonObject, key: string): number {
  const value = params[key];
  if (typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 100_000) return value;
  throw invalid(`${key} must be a whole number above 0 when the screen was found.`);
}

/**
 * `prompter.screen.report { found, duplicated?, width?, height?, refreshHz?, windowError? }`
 * (`from_report`). A screen that was found carries its size and refresh rate; one that was
 * not has none, whatever else the report says.
 */
export function screenFromReport(params: JsonObject): PrompterScreen {
  const found = params.found;
  if (typeof found !== "boolean") throw invalid("found must be true or false.");
  if (!found) return { ...unreportedScreen(), reported: true };
  const duplicated = params.duplicated ?? null;
  if (duplicated !== null && typeof duplicated !== "boolean") throw invalid("duplicated must be true or false.");
  const reason = params.windowError ?? null;
  if (reason !== null && (typeof reason !== "string" || reason.trim() === "")) {
    throw invalid("windowError must be a sentence.");
  }
  return {
    reported: true,
    found,
    duplicated: duplicated === true,
    width: positive(params, "width"),
    height: positive(params, "height"),
    refreshHz: positive(params, "refreshHz"),
    windowError: reason === null ? null : Array.from(reason.trim()).slice(0, MAX_REASON_CHARS).join(""),
  };
}

/** `1920×1080 at 60 Hz`, once a screen was found. */
function screenMode(screen: PrompterScreen): string | null {
  return screen.width !== null && screen.height !== null && screen.refreshHz !== null
    ? `${screen.width}×${screen.height} at ${screen.refreshHz} Hz`
    : null;
}

/** The state's sentence (the proposal §8): what happened and what to do. */
export function screenSentence(screen: PrompterScreen): string {
  switch (screenState(screen)) {
    case "connected":
      return `The Prompter XL is connected: ${screenMode(screen) ?? ""}.`;
    case "low-resolution":
      return `Windows runs the Prompter XL at ${screen.width ?? 0}×${screen.height ?? 0}. Set it to ${FULL_WIDTH_PX}×${FULL_HEIGHT_PX} in Windows' display settings for the sharpest text.`;
    case "not-connected":
      return screen.reported
        ? "Windows does not see the Prompter XL. Check its USB-C cable; it needs 15 W. The script and the place are kept, and nothing is shown on any other screen."
        : "Windows has not reported the Prompter XL since Studio Control started. The script and the place are kept, and nothing is shown on any other screen.";
    case "duplicated":
      return "Windows shows a copy of another screen on the Prompter XL, so the script is not drawn there. In Windows' display settings, choose Extend these displays.";
    case "not-showing":
      return "Studio Control could not open its window on the Prompter XL.";
  }
}

/** Why `PLAY` is refused while nothing is drawn on the glass (`play_refusal`); `null` while it is drawn. */
export function playRefusal(screen: PrompterScreen): EngineRequestError | null {
  let sentence: string;
  switch (screenState(screen)) {
    case "connected":
    case "low-resolution":
      return null;
    case "not-connected":
      sentence =
        "The Prompter XL is not connected, so the text cannot scroll. Jumps, speed and size still work, and the place they set is where it comes back.";
      break;
    case "duplicated":
      sentence =
        "Windows shows a copy of another screen on the Prompter XL, so the text is not drawn there and cannot scroll.";
      break;
    case "not-showing":
      sentence = "Studio Control's window on the Prompter XL is not open, so the text cannot scroll.";
      break;
  }
  return new EngineRequestError("PROMPTER_NOT_ON_GLASS", sentence);
}

/** The Prompter XL as `prompter.snapshot` and `checks.prompter` carry it (`summary`). */
export function screenSummary(screen: PrompterScreen): PrompterScreenSummary {
  const state = screenState(screen);
  return {
    state,
    word: STATE_WORDS[state],
    tone: screenTone(state),
    reported: screen.reported,
    draws: screenDraws(state),
    width: screen.width,
    height: screen.height,
    refreshHz: screen.refreshHz,
    windowError: screen.windowError,
    sentence: screenSentence(screen),
  };
}

/** A check's tone, worst last (`PrompterCheckTone`'s order). */
const TONE_RANK: Record<PrompterCheckTone, number> = { ok: 0, attention: 1, error: 2 };

/**
 * `checks.prompter` in `health.snapshot` (`PrompterHealthCheck::new`): the worse of the
 * screen's state and `NOT UPDATED` (first step 3). `edited` names the script on the glass
 * when it was edited after it went on. At the same tone `NOT UPDATED` wins over
 * `LOW RESOLUTION`: it asks the operator for Update, on this page.
 */
export function prompterHealthCheck(screen: PrompterScreen, edited: string | null): PrompterHealthCheck {
  const summary = screenSummary(screen);
  const [status, word, sentence]: [PrompterCheckTone, string, string] =
    edited !== null && TONE_RANK[summary.tone] <= TONE_RANK.attention
      ? [
          "attention",
          "NOT UPDATED",
          `${edited} was edited after it went on the prompter. The prompter still shows the earlier text.`,
        ]
      : [summary.tone, summary.word, summary.sentence];
  return { ok: status === "ok", status, word, summary: sentence, notUpdated: edited !== null, screen: summary };
}

/** What the whole status takes from the check (`whole_status`): no worse than attention (first step 1), since the sound and the light are unaffected. */
export function wholeStatus(check: PrompterHealthCheck): PrompterCheckTone {
  return TONE_RANK[check.status] > TONE_RANK.attention ? "attention" : check.status;
}

/** Whether two checks say the same (the hardware link compares them whole): every field is built in the same order. */
export function sameCheck(left: PrompterHealthCheck, right: PrompterHealthCheck): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * The Prompter XL a scenario starts with: connected at its own size, or what the
 * scenario's `prompterScreen` — a `prompter.screen.report`'s params — says. A
 * `prompterScreen` the shell could not send is the scenario's mistake, and says so.
 */
export function scenarioScreen(value: unknown): PrompterScreen {
  if (value === undefined) return connectedScreen();
  const params = asRecord(value);
  if (!params) throw new Error("prompterScreen must be an object: a prompter.screen.report's params");
  try {
    return screenFromReport(params);
  } catch (error) {
    throw new Error(`prompterScreen is not a report the shell could send: ${(error as Error).message}`, {
      cause: error,
    });
  }
}
