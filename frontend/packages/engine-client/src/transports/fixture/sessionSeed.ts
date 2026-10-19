// Part of the fixture double (`../fixtureTransport.ts`): the in-memory stand-in for the
// hardware link that Playwright and the browser fixture mode run against. Test-only.
import type { Session } from "../../generated/snapshots/Session";
import type { SessionSettings } from "../../generated/snapshots/SessionSettings";
import type { FixtureSessionSeed } from "../../types";
import { putFolder, readDrivePath } from "./sessionFolder";
import { checkedList, checkedRoot, thresholdsRefusal } from "./sessionSettings";
import {
  SESSION_KINDS,
  SESSION_NAME_MAX_CHARACTERS,
  fixtureSession,
  isSessionKind,
  nameCharacters,
  oneOfEachKind,
  trimmedName,
} from "./sessionState";
import type { MutableFixtureState } from "./state";

// The session a scenario starts with (`FixtureScenario.session`): the running session and
// the last of each kind; since step 2 (D52) the settings, the places, and the folders that
// are on the double's disk. The seed is checked as the hardware link would read its
// settings, and a seed it would not read, or would refuse, is the scenario's mistake, and
// says so.

const mistake = (message: string) => new Error(`session: ${message}`);

const SEED_KEYS = ["current", "last", "settings", "places", "folders"] as const;
const SESSION_KEYS = ["kind", "name", "begunAt", "endedAt", "folder"] as const;
const SETTINGS_KEYS = ["root", "subfolders", "lowBelowGb", "nearlyFullBelowGb"] as const;

function onlyKeys(object: object, known: readonly string[], where: string) {
  const unknown = Object.keys(object).filter((key) => !known.includes(key));
  if (unknown.length > 0) throw mistake(`${where} has ${unknown.join(", ")}, which a seed does not have.`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** A time as the hardware link writes it: UTC, `2026-10-15T07:16:00.000Z`. */
function isUtcText(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

/** A folder's path as the hardware link writes it, or the seed's mistake. */
function checkedPath(value: unknown, where: string): string {
  const reading = typeof value === "string" ? readDrivePath(value) : null;
  if (reading === null || !("path" in reading) || reading.path !== value) {
    throw mistake(`${where} must be a folder's path as Windows writes it, such as D:\\Sessions.`);
  }
  return reading.path;
}

function checkedSession(value: unknown, where: string, ended: boolean): Session {
  if (!isObject(value)) throw mistake(`${where} must be an object.`);
  onlyKeys(value, SESSION_KEYS, where);
  const { kind, name, begunAt, endedAt, folder } = value;
  if (!isSessionKind(kind)) throw mistake(`${where}'s kind must be one of ${SESSION_KINDS.join(", ")}.`);
  if (typeof name !== "string" || trimmedName(name) !== name) throw mistake(`${where}'s name must be trimmed text.`);
  if (nameCharacters(name) > SESSION_NAME_MAX_CHARACTERS) {
    throw mistake(`${where}'s name has more than ${SESSION_NAME_MAX_CHARACTERS} characters.`);
  }
  if (!isUtcText(begunAt)) throw mistake(`${where}'s begunAt must be a UTC time as the hardware link writes it.`);
  if (ended ? !isUtcText(endedAt) : endedAt !== null && endedAt !== undefined) {
    throw mistake(ended ? `${where}'s endedAt must be a UTC time.` : `${where} runs: its endedAt is null.`);
  }
  // A session saved before sessions had folders has none.
  const kept = folder === undefined || folder === null ? null : checkedPath(folder, `${where}'s folder`);
  return { kind, name, begunAt, endedAt: ended ? (endedAt as string) : null, folder: kept };
}

function checkedSettings(value: unknown, saved: SessionSettings): SessionSettings {
  if (!isObject(value)) throw mistake("settings must be an object.");
  onlyKeys(value, SETTINGS_KEYS, "settings");
  const settings: SessionSettings = { ...saved, subfolders: { ...saved.subfolders } };
  if (value.root !== undefined) {
    const checked = typeof value.root === "string" ? checkedRoot(value.root) : { refusal: "it is not text" };
    if ("refusal" in checked || checked.root !== value.root) {
      throw mistake(`settings.root is refused or not as the hardware link keeps it: ${JSON.stringify(value.root)}.`);
    }
    settings.root = checked.root;
  }
  if (value.subfolders !== undefined) {
    if (!isObject(value.subfolders)) throw mistake("settings.subfolders must be an object.");
    onlyKeys(value.subfolders, SESSION_KINDS, "settings.subfolders");
    for (const kind of SESSION_KINDS) {
      const names = value.subfolders[kind];
      if (!Array.isArray(names) || names.some((name) => typeof name !== "string")) {
        throw mistake(`settings.subfolders.${kind} must be a list of names.`);
      }
      const checked = checkedList(kind, names as string[]);
      if ("refusal" in checked) throw mistake(`settings.subfolders.${kind}: ${checked.refusal}`);
      settings.subfolders[kind] = checked.list;
    }
  }
  const low = value.lowBelowGb ?? settings.lowBelowGb;
  const nearlyFull = value.nearlyFullBelowGb ?? settings.nearlyFullBelowGb;
  if (
    typeof low !== "number" ||
    typeof nearlyFull !== "number" ||
    !Number.isInteger(low) ||
    !Number.isInteger(nearlyFull)
  ) {
    throw mistake("settings' levels are whole GB.");
  }
  const refusal = thresholdsRefusal(low, nearlyFull);
  if (refusal) throw mistake(`settings' levels: ${refusal}`);
  settings.lowBelowGb = low;
  settings.nearlyFullBelowGb = nearlyFull;
  return settings;
}

/** Builds the scenario's session on the double, before its first read. */
export function seedFixtureSession(state: MutableFixtureState, seed: FixtureSessionSeed | undefined) {
  if (seed === undefined) return;
  if (!isObject(seed)) throw mistake("the seed must be an object.");
  onlyKeys(seed, SEED_KEYS, "the seed");
  const session = fixtureSession(state);
  if (seed.current !== undefined) session.current = checkedSession(seed.current, "current", false);
  if (seed.last !== undefined) {
    if (!Array.isArray(seed.last)) throw mistake("last must be a list.");
    const last = seed.last.map((entry, index) => checkedSession(entry, `last[${index}]`, true));
    if (oneOfEachKind(last).length !== last.length) throw mistake("last holds one session of each kind at most.");
    session.last = last;
  }
  if (seed.settings !== undefined) session.settings = checkedSettings(seed.settings, session.settings);
  if (seed.places !== undefined) {
    const places: unknown = seed.places;
    if (!isObject(places)) throw mistake("places must be an object.");
    onlyKeys(places, ["root", "simulated"], "places");
    if (typeof places.simulated !== "boolean") throw mistake("places.simulated must be true or false.");
    const root = checkedPath(places.root, "places.root");
    if (!places.simulated && root !== session.settings.root) {
      throw mistake("places.root is the settings' root in the studio's build: give simulated: true for another.");
    }
    session.simulated = places.simulated;
    session.scratchRoot = places.simulated ? root : "";
  }
  if (seed.folders !== undefined) {
    if (!Array.isArray(seed.folders)) throw mistake("folders must be a list of paths.");
    seed.folders.forEach((folder, index) => putFolder(session.disk, checkedPath(folder, `folders[${index}]`)));
  }
}
