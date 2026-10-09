// Part of the fixture double (`../fixtureTransport.ts`): the in-memory stand-in for the
// hardware link that Playwright and the browser fixture mode run against. Test-only.
import type { JsonObject } from "../../generated/protocol";
import type { PrompterParagraph } from "../../generated/snapshots/PrompterParagraph";
import type { PrompterPlace } from "../../generated/snapshots/PrompterPlace";
import type { FixturePrompterScriptSeed, FixturePrompterSeed } from "../../types";
import { SPEED_DEFAULT_WPM, SPEED_MAX_WPM, SPEED_MIN_WPM, SPEED_STEP_WPM, speedIsValid } from "./prompterClock";
import {
  MAX_SCRIPT_WORDS,
  TOP,
  cleanName,
  cleanedParagraphs,
  cloneParagraphs,
  makeRun,
  paragraphWordCount,
  wordCount,
} from "./prompterModel";
import { newScript, putOnRequest, updatedLook } from "./prompterRequests";
import { playRefusal } from "./prompterScreen";
import {
  SIZE_MAX_PX,
  SIZE_MIN_PX,
  SIZE_STEP_PX,
  VERSIONS_KEPT,
  VERSION_REASON,
  fixturePrompter,
  keepVersion,
  nowText,
  sizeIsValid,
  writeScriptText,
  type FixturePrompter,
  type StoredScript,
} from "./prompterState";
import type { MutableFixtureState } from "./state";

// The prompter a scenario starts with (new pages program, Slice 6a): the Teleprompter's
// boards need scripts, Removed and a script on the glass, and the double starts every
// scenario with none. The seed builds them with the double's own requests and state
// functions, so everything the hardware link holds true holds here too: each script
// cleaned as an edit is and kept with its versions, the glass put on by `prompter.putOn`
// itself (paused at the script's place, its layout key, its saved place), and the
// NOT UPDATED edit made as `prompter.script.edit` makes it. It raises no event: the
// scenario starts that way. Times count back from the moment the double is made — a
// week ago for the scripts, an hour apart for their versions and for Removed — so a
// page clock fixed by the test fixes them too.
//
// The Overview's take (D47) needs a glass that already plays, which `prompter.play`
// cannot make here: it refuses before a layout, and no view has reported one when the
// double is made. So `playing` starts the clock itself, held to PLAY's other rules (a
// Prompter XL that draws the glass, a place before its end); before a layout the clock
// runs in words, as it does after a new size, until the page's view reports one. Its
// timer is left to the first `prompter.*` request, a read included, which settles the
// clock and schedules it (`handleFixturePrompterRequest`): the page reads the prompter at
// every start, and a double no request reaches leaves no timer behind.

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const WEEK_MS = 7 * 24 * HOUR_MS;

/** What the NOT UPDATED edit adds to the paragraph after the place. */
export const NOT_UPDATED_SENTENCE = "Take as long as you need.";

/** A seed the prompter could not hold is the scenario's mistake. */
const mistake = (message: string) => new Error(`prompter: ${message}`);

/** The text `stepsBack` versions ago: the script without its last `stepsBack` paragraphs. */
function earlierText(paragraphs: readonly PrompterParagraph[], stepsBack: number): PrompterParagraph[] {
  return cloneParagraphs(paragraphs.slice(0, paragraphs.length - stepsBack));
}

/** A place inside the text, or its end (`END` at the reading line). */
function placeIsInside(place: PrompterPlace, paragraphs: readonly PrompterParagraph[]): boolean {
  const whole = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 0;
  if (!whole(place.paragraph) || !whole(place.word)) return false;
  if (place.paragraph === paragraphs.length) return place.word === 0;
  const paragraph = paragraphs[place.paragraph];
  return paragraph !== undefined && place.word < Math.max(paragraphWordCount(paragraph), 1);
}

interface CheckedScript {
  name: string;
  paragraphs: PrompterParagraph[];
  speedWpm: number;
  place: PrompterPlace;
  sourceFileName: string | null;
  removed: boolean;
  versions: number;
}

/** A script's seed, held to what the prompter keeps; its text cleaned as an edit's is (`edited_paragraphs`). */
function checkedScript(seed: FixturePrompterScriptSeed, index: number): CheckedScript {
  const name = typeof seed.name === "string" ? cleanName(seed.name) : null;
  if (name === null || name !== seed.name) {
    throw mistake(`scripts[${index}]'s name must be one line of words, as the prompter keeps a name.`);
  }
  if (!Array.isArray(seed.paragraphs)) throw mistake(`${name} has no list of paragraphs.`);
  const paragraphs = cleanedParagraphs(seed.paragraphs);
  if (paragraphs.length === 0) paragraphs.push({ runs: [] });
  if (wordCount(paragraphs) > MAX_SCRIPT_WORDS) {
    throw mistake(`${name} has more than the ${MAX_SCRIPT_WORDS} words a script can have.`);
  }
  const speedWpm = seed.speedWpm ?? SPEED_DEFAULT_WPM;
  if (!speedIsValid(speedWpm)) {
    throw mistake(`${name}'s speedWpm must be ${SPEED_MIN_WPM}–${SPEED_MAX_WPM} in steps of ${SPEED_STEP_WPM}.`);
  }
  const place = seed.place ?? TOP;
  if (!placeIsInside(place, paragraphs)) {
    throw mistake(
      `${name}'s place (paragraph ${place.paragraph}, word ${place.word}) is outside its text of ${paragraphs.length} paragraphs.`
    );
  }
  const versions = seed.versions ?? 1;
  if (!Number.isInteger(versions) || versions < 1 || versions > Math.min(VERSIONS_KEPT, paragraphs.length)) {
    throw mistake(
      `${name}'s versions must be 1–${VERSIONS_KEPT} and no more than its ${paragraphs.length} paragraphs (each earlier version is a paragraph shorter).`
    );
  }
  return {
    name,
    paragraphs,
    speedWpm,
    place: { paragraph: place.paragraph, word: place.word },
    sourceFileName: seed.sourceFileName ?? null,
    removed: seed.removed === true,
    versions,
  };
}

/**
 * A script as it came to be: made when its first version came in, `imported` from its
 * file or `pasted`; each later version a paragraph longer, alternately the text as it
 * went on the prompter (`put-on`) and as an Update put it there (`updated`), an hour
 * apart; then its speed and its own place.
 */
function insertSeededScript(prompter: FixturePrompter, script: CheckedScript, createdAt: number): StoredScript {
  const first = earlierText(script.paragraphs, script.versions - 1);
  const stored = newScript(prompter, script.name, script.sourceFileName, first, createdAt);
  const cameIn = script.sourceFileName !== null ? VERSION_REASON.imported : VERSION_REASON.pasted;
  keepVersion(prompter, stored.id, first, cameIn, createdAt);
  for (let version = 2; version <= script.versions; version += 1) {
    const at = createdAt + (version - 1) * HOUR_MS;
    const text = earlierText(script.paragraphs, script.versions - version);
    writeScriptText(stored, text, TOP, at);
    keepVersion(prompter, stored.id, text, version % 2 === 0 ? VERSION_REASON.putOn : VERSION_REASON.updated, at);
  }
  stored.speedWpm = script.speedWpm;
  stored.place = { ...script.place };
  return stored;
}

/** The look and the take's size, held to `prompter.look.update`'s and `prompter.textSize`'s ranges. */
function seedLook(prompter: FixturePrompter, seed: FixturePrompterSeed) {
  if (seed.look !== undefined && Object.keys(seed.look).length > 0) {
    try {
      prompter.look = updatedLook(prompter.look, seed.look as JsonObject);
    } catch (error) {
      throw new Error(`prompter: look is not a look the prompter could keep: ${(error as Error).message}`, {
        cause: error,
      });
    }
  }
  const size = seed.sizePx ?? prompter.look.standardSizePx;
  if (!sizeIsValid(size)) throw mistake(`sizePx must be ${SIZE_MIN_PX}–${SIZE_MAX_PX} in steps of ${SIZE_STEP_PX}.`);
  prompter.sizePx = size;
}

/** The glass script's text with the NOT UPDATED sentence added to the paragraph after its place. */
function editedAfterPlace(paragraphs: readonly PrompterParagraph[], place: PrompterPlace): PrompterParagraph[] {
  const edited = cloneParagraphs(paragraphs);
  const target = edited[Math.min(place.paragraph + 1, edited.length - 1)]!;
  const empty = target.runs.every((run) => run.text.trim() === "");
  target.runs.push(makeRun(empty ? NOT_UPDATED_SENTENCE : ` ${NOT_UPDATED_SENTENCE}`));
  return cleanedParagraphs(edited);
}

/**
 * Builds the scenario's prompter on the double, before its first read: the look, the
 * scripts in the order given (their ids count up from there), Removed, the glass, the
 * NOT UPDATED edit and PLAY. Without a seed the prompter starts empty, as it always has.
 */
export function seedFixturePrompter(state: MutableFixtureState, seed: FixturePrompterSeed | undefined) {
  if (seed === undefined) return;
  if (seed === null || typeof seed !== "object") throw mistake("the seed must be an object.");
  const now = Date.now();
  const prompter = fixturePrompter(state);
  seedLook(prompter, seed);

  const scripts = (seed.scripts ?? []).map(checkedScript);
  const byName = new Map<string, StoredScript>();
  let removed = 0;
  scripts.forEach((script, index) => {
    if (byName.has(script.name)) throw mistake(`two scripts are named ${script.name}.`);
    const stored = insertSeededScript(prompter, script, now - WEEK_MS + index * MINUTE_MS);
    // The first listed of Removed went last, so Removed (newest first) lists them in order.
    if (script.removed) {
      removed += 1;
      stored.removedAt = nowText(now - removed * HOUR_MS);
    }
    byName.set(script.name, stored);
  });

  if (seed.onGlass === undefined) {
    if (seed.notUpdated === true) throw mistake("notUpdated needs a script on the glass (onGlass).");
    if (seed.playing === true) throw mistake("playing needs a script on the glass (onGlass).");
    return;
  }
  const onGlass = byName.get(seed.onGlass);
  if (!onGlass) throw mistake(`onGlass names ${seed.onGlass}, which is not among its scripts.`);
  if (onGlass.removedAt !== null) throw mistake(`onGlass names ${seed.onGlass}, which is in Removed.`);
  // `prompter.putOn`'s own path: the version it keeps, the glass revision, the paused
  // clock at the script's place (the top when that is its end) and the saved place.
  putOnRequest(prompter, { scriptId: onGlass.id }, now);
  if (seed.notUpdated === true) {
    // As `prompter.script.edit` makes it: the place stays with the glass's text until Update.
    writeScriptText(onGlass, editedAfterPlace(onGlass.paragraphs, onGlass.place), onGlass.place, now);
  }
  if (seed.playing === true) {
    // PLAY's refusals but the layout's (`playRequest`), in its own words. `putOn` never
    // leaves the glass at its end (a script left there goes on at the top); the check
    // keeps the seed to PLAY's rule all the same.
    const glass = prompter.glass!;
    const refusal = playRefusal(prompter.screen);
    if (refusal) throw mistake(`playing is refused as PLAY is: ${refusal.message}`);
    if (glass.atEnd(now)) throw mistake(`playing is refused as PLAY is: ${seed.onGlass} is at its end.`);
    glass.play(now);
  }
}
