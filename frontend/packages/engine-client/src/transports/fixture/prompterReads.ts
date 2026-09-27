// Part of the fixture double (`../fixtureTransport.ts`): the in-memory stand-in for the
// hardware link that Playwright and the browser fixture mode run against. Test-only.
import type { JsonObject, JsonValue } from "../../generated/protocol";
import type { PrompterGlassSnapshot } from "../../generated/snapshots/PrompterGlassSnapshot";
import type { PrompterGlassSummary } from "../../generated/snapshots/PrompterGlassSummary";
import type { PrompterHealthCheck } from "../../generated/snapshots/PrompterHealthCheck";
import type { PrompterLayoutLine } from "../../generated/snapshots/PrompterLayoutLine";
import type { PrompterParagraph } from "../../generated/snapshots/PrompterParagraph";
import type { PrompterScriptSnapshot } from "../../generated/snapshots/PrompterScriptSnapshot";
import type { PrompterScriptSummary } from "../../generated/snapshots/PrompterScriptSummary";
import type { PrompterSnapshot } from "../../generated/snapshots/PrompterSnapshot";
import { EngineRequestError } from "../engineRequestError";
import type { GlassClock } from "./prompterClock";
import {
  MAX_SCRIPT_WORDS,
  cleanedParagraphs,
  cloneParagraphs,
  cueTargets,
  naturalOrder,
  paragraphsKey,
  wordCount,
} from "./prompterModel";
import { prompterHealthCheck, screenSummary, wholeStatusPart } from "./prompterScreen";
import { findScript, listScripts, listVersions, type FixturePrompter, type StoredScript } from "./prompterState";

// What the double's prompter reads out (`native/rust-engine/src/prompter/snapshot.rs`):
// only what the hardware link holds, never what a view drew; and how it answers a
// request it refuses (`PrompterError`: `INVALID_PARAMS` for wrong parameters, a
// `PROMPTER_*` code with the operator's sentence for a sound request refused now). A
// refusal is the `EngineRequestError` the Tauri transport throws for the same answer:
// the sentence is its message, the code rides along as `code`.

export function invalid(message: string): EngineRequestError {
  return new EngineRequestError("INVALID_PARAMS", message);
}

export function unknownScript(): EngineRequestError {
  return new EngineRequestError(
    "PROMPTER_SCRIPT_UNKNOWN",
    "There is no such script; it may have been deleted for good."
  );
}

export function existingScript(prompter: FixturePrompter, id: string): StoredScript {
  const script = findScript(prompter, id);
  if (!script) throw unknownScript();
  return script;
}

// ---------------------------------------------------------------------------
// Parameters, as `commands.rs` reads them
// ---------------------------------------------------------------------------

export function textParam(params: JsonObject, key: string): string {
  const value = params[key];
  if (typeof value === "string" && value.trim() !== "") return value;
  throw invalid(`${key} must be a string that is not empty.`);
}

export function optionalText(params: JsonObject, key: string): string | null {
  const value = params[key];
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  throw invalid(`${key} must be a string.`);
}

const isWhole = (value: JsonValue | undefined): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff;

export function wholeParam(params: JsonObject, key: string): number | null {
  const value = params[key];
  if (value === undefined || value === null) return null;
  if (isWhole(value)) return value;
  throw invalid(`${key} must be a whole number.`);
}

export function stepParam(params: JsonObject): number | null {
  const value = params.step;
  if (value === undefined || value === null) return null;
  if (typeof value === "number" && Number.isInteger(value) && value >= -100 && value <= 100 && value !== 0)
    return value;
  throw invalid("step must be a whole number of steps, not 0.");
}

/** A flag the hardware link reads as `as_bool().unwrap_or(false)`. */
export function flagParam(params: JsonObject, key: string): boolean {
  return params[key] === true;
}

/** The editor's text, cleaned as an import is; an empty script is one empty paragraph (`edited_paragraphs`). */
export function editedParagraphs(params: JsonObject): PrompterParagraph[] {
  const raw = params.paragraphs;
  if (raw === undefined) throw invalid("paragraphs must be the script's text.");
  const wrong = (why: string) => invalid(`paragraphs must be a list of paragraphs: ${why}`);
  if (!Array.isArray(raw)) throw wrong("expected a list");
  const paragraphs = raw.map((entry, index) => {
    const runs = entry && typeof entry === "object" && !Array.isArray(entry) ? entry.runs : undefined;
    if (!Array.isArray(runs)) throw wrong(`paragraph ${index + 1} has no list of runs`);
    return {
      runs: runs.map((run) => {
        const record = run && typeof run === "object" && !Array.isArray(run) ? run : null;
        if (!record || typeof record.text !== "string") throw wrong(`a run of paragraph ${index + 1} has no text`);
        const mark = (key: "bold" | "italic" | "underline") => {
          const value = record[key];
          if (value === undefined) return false;
          if (typeof value !== "boolean") throw wrong(`${key} must be true or false`);
          return value;
        };
        return { text: record.text, bold: mark("bold"), italic: mark("italic"), underline: mark("underline") };
      }),
    };
  });
  const cleaned = cleanedParagraphs(paragraphs);
  if (cleaned.length === 0) cleaned.push({ runs: [] });
  const words = wordCount(cleaned);
  if (words > MAX_SCRIPT_WORDS) {
    throw new EngineRequestError(
      "PROMPTER_SCRIPT_TOO_LONG",
      `The script would have ${words} words; a script can have up to ${MAX_SCRIPT_WORDS}. Split it into shorter scripts.`
    );
  }
  return cleaned;
}

/** A view's layout of the glass, `lines` as the report sends them. */
export function layoutLines(params: JsonObject): PrompterLayoutLine[] {
  const raw = params.lines;
  if (raw === undefined) throw invalid("lines must be the layout's lines.");
  const wrong = (why: string) => invalid(`lines must be the layout's lines: ${why}`);
  if (!Array.isArray(raw)) throw wrong("expected a list");
  return raw.map((entry, index) => {
    const line = entry && typeof entry === "object" && !Array.isArray(entry) ? entry : null;
    const number = (value: JsonValue | undefined) => typeof value === "number" && Number.isFinite(value);
    if (!line || !isWhole(line.paragraph) || !isWhole(line.word) || !number(line.top) || !number(line.height)) {
      throw wrong(`line ${index + 1} needs a paragraph, a word, a top and a height`);
    }
    return { paragraph: line.paragraph, word: line.word, top: line.top as number, height: line.height as number };
  });
}

// ---------------------------------------------------------------------------
// The three reads
// ---------------------------------------------------------------------------

export function scriptSummary(script: StoredScript, onPrompter: boolean): PrompterScriptSummary {
  return {
    id: script.id,
    name: script.name,
    sourceFileName: script.sourceFileName,
    paragraphCount: script.paragraphCount,
    readWords: script.readWords,
    speedWpm: script.speedWpm,
    lengthSeconds: (script.readWords * 60) / Math.max(script.speedWpm, 1),
    place: { ...script.place },
    atEnd: script.place.paragraph >= script.paragraphCount,
    createdAt: script.createdAt,
    changedAt: script.changedAt,
    removedAt: script.removedAt,
    onPrompter,
  };
}

function glassSummary(prompter: FixturePrompter, glass: GlassClock, now: number): PrompterGlassSummary {
  const script = findScript(prompter, glass.scriptId);
  const [timeLeftSeconds, estimated] = glass.timeLeft(now);
  const [lengthSeconds] = glass.length();
  return {
    scriptId: glass.scriptId,
    name: script?.name ?? "",
    layoutKey: glass.layoutKey,
    laidOut: glass.layout !== null,
    notUpdated: script !== null && paragraphsKey(script.paragraphs) !== paragraphsKey(glass.paragraphs),
    speedWpm: glass.speedWpm,
    place: glass.placeAt(now),
    paragraphCount: glass.paragraphCount,
    playing: glass.playing,
    atEnd: glass.atEnd(now),
    timeLeftSeconds,
    lengthSeconds,
    estimated,
    cues: cueTargets(glass.paragraphs),
    anchor: glass.anchor(now),
  };
}

/** `prompter.snapshot`: the look, the size, the glass, the scripts by name, Removed newest first. */
export function readSnapshot(prompter: FixturePrompter, now: number): PrompterSnapshot {
  const glassId = prompter.glass?.scriptId ?? null;
  const rows = listScripts(prompter);
  const byId = (a: PrompterScriptSummary, b: PrompterScriptSummary) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const scripts = rows
    .filter((row) => row.removedAt === null)
    .map((row) => scriptSummary(row, row.id === glassId))
    .sort((a, b) => naturalOrder(a.name, b.name) || byId(a, b));
  const removed = rows
    .filter((row) => row.removedAt !== null)
    .map((row) => scriptSummary(row, false))
    .sort((a, b) => (a.removedAt! > b.removedAt! ? -1 : a.removedAt! < b.removedAt! ? 1 : byId(a, b)));
  return {
    look: { ...prompter.look },
    sizePx: prompter.sizePx,
    glass: prompter.glass ? glassSummary(prompter, prompter.glass, now) : null,
    scripts,
    removed,
    screen: screenSummary(prompter.screen),
  };
}

/**
 * The name of the script on the glass when it was edited after it went on (`NOT UPDATED`,
 * `glass_edited_name`); `null` when it was not, or when nothing is on the glass.
 */
export function glassEditedName(prompter: FixturePrompter): string | null {
  const glass = prompter.glass;
  const script = glass ? findScript(prompter, glass.scriptId) : null;
  return glass && script && paragraphsKey(script.paragraphs) !== paragraphsKey(glass.paragraphs) ? script.name : null;
}

/** `checks.prompter` (`health_check` in `commands.rs`): the worse of the Prompter XL's state and `NOT UPDATED`. */
export function prompterCheck(prompter: FixturePrompter): PrompterHealthCheck {
  return prompterHealthCheck(prompter.screen, glassEditedName(prompter));
}

/** What the whole status takes from the prompter, and why (`whole_status`, `whole_status_sentence`). */
export function prompterStatusPart(prompter: FixturePrompter) {
  return wholeStatusPart(prompter.screen, glassEditedName(prompter));
}

/** `prompter.glass.snapshot`: what the glass draws. */
export function readGlassSnapshot(prompter: FixturePrompter, now: number): PrompterGlassSnapshot {
  const glass = prompter.glass;
  return {
    scriptId: glass?.scriptId ?? null,
    name: glass ? (findScript(prompter, glass.scriptId)?.name ?? null) : null,
    layoutKey: glass?.layoutKey ?? null,
    paragraphs: glass ? cloneParagraphs(glass.paragraphs) : [],
    look: { ...prompter.look },
    sizePx: prompter.sizePx,
    anchor: glass ? glass.anchor(now) : null,
  };
}

/** `prompter.script.snapshot`: one script with its text, its cues and its versions, newest first. */
export function readScriptSnapshot(prompter: FixturePrompter, id: string): PrompterScriptSnapshot {
  const script = existingScript(prompter, id);
  return {
    script: scriptSummary(script, prompter.glass?.scriptId === id),
    paragraphs: cloneParagraphs(script.paragraphs),
    cues: cueTargets(script.paragraphs),
    versions: listVersions(prompter, id).map((version) => ({
      id: version.id,
      readWords: version.readWords,
      keptAt: version.keptAt,
      reason: version.reason,
    })),
  };
}
