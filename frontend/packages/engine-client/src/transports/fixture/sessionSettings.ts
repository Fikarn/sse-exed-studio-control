// Part of the fixture double (`../fixtureTransport.ts`): the in-memory stand-in for the
// hardware link that Playwright and the browser fixture mode run against. Test-only.
import type { JsonObject } from "../../generated/protocol";
import type { SessionKind } from "../../generated/snapshots/SessionKind";
import type { SessionSettings } from "../../generated/snapshots/SessionSettings";
import type { SessionSubfolders } from "../../generated/snapshots/SessionSubfolders";
import { EngineRequestError } from "../engineRequestError";
import { nameProblem, readDrivePath } from "./sessionFolder";
import { SESSION_KINDS, SESSION_KIND_NAMES, nameCharacters, trimmedName } from "./sessionState";

// The session's settings (D52; `native/rust-engine/src/session/settings.rs`): the checks of
// the sessions' folder, of each kind's subfolders and of the disk's levels, with the hardware
// link's codes and sentences, and `session.settings.update`, which checks what it gives in the
// hardware link's order and changes nothing when one part is refused.

export const ROOT_MAX_CHARACTERS = 120;
export const SUBFOLDERS_MAX = 8;
export const SUBFOLDER_NAME_MAX_CHARACTERS = 40;
export const THRESHOLD_MAX_GB = 100_000;

/** The sessions' folder as kept, or why it is refused (`checked_root`). */
export function checkedRoot(text: string): { root: string } | { refusal: string } {
  const reading = readDrivePath(text);
  if ("share" in reading) {
    return {
      refusal: "The sessions' folder is on a drive with a letter, such as Public (Z:), not a share's path.",
    };
  }
  if ("shape" in reading) return { refusal: reading.shape };
  if (reading.path.length > ROOT_MAX_CHARACTERS) {
    return {
      refusal: `The sessions' folder's path has at most ${ROOT_MAX_CHARACTERS} characters; this one has ${reading.path.length}.`,
    };
  }
  return { root: reading.path };
}

/** One kind's list as kept, or why it is refused (`checked_list`). */
export function checkedList(kind: SessionKind, names: readonly string[]): { list: string[] } | { refusal: string } {
  const what = SESSION_KIND_NAMES[kind];
  if (names.length > SUBFOLDERS_MAX) {
    return { refusal: `${what} has at most ${SUBFOLDERS_MAX} subfolders; this list has ${names.length}.` };
  }
  const kept: string[] = [];
  for (const given of names) {
    const name = trimmedName(given);
    if (name === "") return { refusal: `A subfolder of ${what} has no name.` };
    const characters = nameCharacters(name);
    if (characters > SUBFOLDER_NAME_MAX_CHARACTERS) {
      return {
        refusal: `"${name}" has ${characters} characters: a subfolder's name has at most ${SUBFOLDER_NAME_MAX_CHARACTERS}.`,
      };
    }
    const problem = nameProblem(name);
    if (problem) return { refusal: problem };
    const earlier = kept.find((other) => other.toLowerCase() === name.toLowerCase());
    if (earlier !== undefined) {
      return {
        refusal:
          earlier === name
            ? `${what} has "${name}" twice.`
            : `${what} has "${earlier}" and "${name}", which Windows takes for one name.`,
      };
    }
    kept.push(name);
  }
  return { list: kept };
}

/** Why the two levels are refused, or `null` (`checked_thresholds`). */
export function thresholdsRefusal(low: number, nearlyFull: number): string | null {
  if (nearlyFull < 1) return "Nearly full is at least 1 GB.";
  if (low <= nearlyFull) {
    return `Low must be above Nearly full: Low under ${low} GB, Nearly full under ${nearlyFull} GB.`;
  }
  if (low > THRESHOLD_MAX_GB) return "Low is at most 100,000 GB.";
  return null;
}

const invalid = (message: string) => new EngineRequestError("INVALID_PARAMS", message);
const UPDATE_KEYS = ["root", "subfolders", "lowBelowGb", "nearlyFullBelowGb"];

function wholeGb(value: number, label: string): number {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new EngineRequestError("SESSION_THRESHOLDS_INVALID", `${label} is a whole number of GB; ${value} is not.`);
  }
  return value;
}

/**
 * `session.settings.update { root?, subfolders?, lowBelowGb?, nearlyFullBelowGb? }` on the
 * double's settings: the settings after it. The request's shape first (`INVALID_PARAMS`), then
 * the folder, the lists and the levels; a refusal changes nothing.
 */
export function updatedSettings(saved: SessionSettings, params: JsonObject): SessionSettings {
  const unknown = Object.keys(params).filter((key) => !UPDATE_KEYS.includes(key));
  if (unknown.length > 0) throw invalid(`session.settings.update: unknown field \`${unknown[0]}\``);
  const { root, subfolders, lowBelowGb, nearlyFullBelowGb } = params;
  if (root !== undefined && root !== null && typeof root !== "string") {
    throw invalid("session.settings.update: root must be a string");
  }
  let lists: Partial<Record<SessionKind, string[]>> = {};
  if (subfolders !== undefined && subfolders !== null) {
    if (typeof subfolders !== "object" || Array.isArray(subfolders)) {
      throw invalid("session.settings.update: subfolders must be an object");
    }
    for (const [kind, names] of Object.entries(subfolders)) {
      if (!SESSION_KINDS.includes(kind as SessionKind)) {
        throw invalid(`session.settings.update: unknown field \`${kind}\` in subfolders`);
      }
      if (names === null) continue;
      if (!Array.isArray(names) || names.some((name) => typeof name !== "string")) {
        throw invalid(`session.settings.update: subfolders.${kind} must be a list of names`);
      }
      lists = { ...lists, [kind]: names as string[] };
    }
  }
  for (const [label, level] of [
    ["lowBelowGb", lowBelowGb],
    ["nearlyFullBelowGb", nearlyFullBelowGb],
  ] as const) {
    if (level !== undefined && level !== null && typeof level !== "number") {
      throw invalid(`session.settings.update: ${label} must be a number`);
    }
  }
  const givesRoot = typeof root === "string";
  const givesLow = typeof lowBelowGb === "number";
  const givesNearlyFull = typeof nearlyFullBelowGb === "number";
  if (!givesRoot && Object.keys(lists).length === 0 && !givesLow && !givesNearlyFull) {
    throw invalid("session.settings.update gives none of root, subfolders, lowBelowGb and nearlyFullBelowGb");
  }

  const settings: SessionSettings = { ...saved, subfolders: { ...saved.subfolders } };
  if (givesRoot) {
    const checked = checkedRoot(root);
    if ("refusal" in checked) throw new EngineRequestError("SESSION_ROOT_INVALID", checked.refusal);
    settings.root = checked.root;
  }
  for (const kind of SESSION_KINDS) {
    const names = lists[kind];
    if (names === undefined) continue;
    const checked = checkedList(kind, names);
    if ("refusal" in checked) throw new EngineRequestError("SESSION_SUBFOLDERS_INVALID", checked.refusal);
    settings.subfolders = { ...settings.subfolders, [kind]: checked.list } as SessionSubfolders;
  }
  if (givesLow || givesNearlyFull) {
    const low = givesLow ? wholeGb(lowBelowGb, "Low") : settings.lowBelowGb;
    const nearlyFull = givesNearlyFull ? wholeGb(nearlyFullBelowGb, "Nearly full") : settings.nearlyFullBelowGb;
    const refusal = thresholdsRefusal(low, nearlyFull);
    if (refusal) throw new EngineRequestError("SESSION_THRESHOLDS_INVALID", refusal);
    settings.lowBelowGb = low;
    settings.nearlyFullBelowGb = nearlyFull;
  }
  return settings;
}
