// Part of the fixture double (`../fixtureTransport.ts`): the in-memory stand-in for the
// hardware link that Playwright and the browser fixture mode run against. Test-only.
import type { Session } from "../../generated/snapshots/Session";
import type { SessionFolderEntry } from "../../generated/snapshots/SessionFolderEntry";
import type { SessionSettings } from "../../generated/snapshots/SessionSettings";
import type { FixtureSessionSeed } from "../../types";
import { putFolder, readDrivePath } from "./sessionFolder";
import { checkedList, checkedRoot, thresholdsRefusal } from "./sessionSettings";
import {
  RECENT_FOLDERS,
  SESSION_KINDS,
  SESSION_NAME_MAX_CHARACTERS,
  fixtureSession,
  isSessionKind,
  nameCharacters,
  oneOfEachKind,
  trimmedName,
  type FixtureDrive,
  type FixtureSession,
} from "./sessionState";
import type { MutableFixtureState } from "./state";

// The session a scenario starts with (`FixtureScenario.session`): the running session and
// the last of each kind; since step 2 (D52) the settings, the places, the folders that are on
// the double's disk, and what the hardware link's watch reads: the sessions' folder's newest
// folders (which join the folders), the drives (in place of the studio PC's), vMix. The seed
// is checked as the hardware link would read its settings, and a seed it would not read, or
// would refuse, is the scenario's mistake, and says so.

const mistake = (message: string) => new Error(`session: ${message}`);

const SEED_KEYS = ["current", "last", "settings", "places", "folders", "recent", "drives", "vmix"] as const;
const SESSION_KEYS = ["kind", "name", "begunAt", "endedAt", "folder", "folderBytes"] as const;
const SETTINGS_KEYS = ["root", "subfolders", "lowBelowGb", "nearlyFullBelowGb"] as const;
const RECENT_KEYS = ["name", "path", "createdAt", "bytes"] as const;
const DRIVE_KEYS = ["letter", "name", "mapped", "answering", "freeBytes", "totalBytes"] as const;
const VMIX_KEYS = ["state", "recording", "file", "bytesPerSecond"] as const;

/** A count of bytes: a whole number, none below nothing. */
function isBytes(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

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
  const { kind, name, begunAt, endedAt, folder, folderBytes } = value;
  if (!isSessionKind(kind)) throw mistake(`${where}'s kind must be one of ${SESSION_KINDS.join(", ")}.`);
  if (typeof name !== "string" || trimmedName(name) !== name) throw mistake(`${where}'s name must be trimmed text.`);
  if (nameCharacters(name) > SESSION_NAME_MAX_CHARACTERS) {
    throw mistake(`${where}'s name has more than ${SESSION_NAME_MAX_CHARACTERS} characters.`);
  }
  if (!isUtcText(begunAt)) throw mistake(`${where}'s begunAt must be a UTC time as the hardware link writes it.`);
  if (ended ? !isUtcText(endedAt) : endedAt !== null && endedAt !== undefined) {
    throw mistake(ended ? `${where}'s endedAt must be a UTC time.` : `${where} runs: its endedAt is null.`);
  }
  // A session saved before sessions had folders has none; one the watch never measured, no
  // measure.
  const kept = folder === undefined || folder === null ? null : checkedPath(folder, `${where}'s folder`);
  if (folderBytes !== undefined && folderBytes !== null && !isBytes(folderBytes)) {
    throw mistake(`${where}'s folderBytes must be a whole number of bytes, or null.`);
  }
  if (folderBytes !== undefined && folderBytes !== null && kept === null) {
    throw mistake(`${where} has a folder's size and no folder.`);
  }
  return {
    kind,
    name,
    begunAt,
    endedAt: ended ? (endedAt as string) : null,
    folder: kept,
    folderBytes: isBytes(folderBytes) ? folderBytes : null,
  };
}

/** The sessions' folder's newest folders, as the watch would list them. */
function checkedRecent(value: unknown): SessionFolderEntry[] {
  if (!Array.isArray(value)) throw mistake("recent must be a list.");
  if (value.length > RECENT_FOLDERS) throw mistake(`recent has at most ${RECENT_FOLDERS} folders, as the watch reads.`);
  return value.map((entry: unknown, index) => {
    const where = `recent[${index}]`;
    if (!isObject(entry)) throw mistake(`${where} must be an object.`);
    onlyKeys(entry, RECENT_KEYS, where);
    const { name, createdAt, bytes } = entry;
    const path = checkedPath(entry.path, `${where}'s path`);
    if (typeof name !== "string" || name !== path.slice(path.lastIndexOf("\\") + 1)) {
      throw mistake(`${where}'s name is its path's last part.`);
    }
    if (!isUtcText(createdAt)) throw mistake(`${where}'s createdAt must be a UTC time.`);
    if (bytes !== null && !isBytes(bytes)) throw mistake(`${where}'s bytes must be a whole number, or null.`);
    return { name, path, createdAt, bytes: isBytes(bytes) ? bytes : null };
  });
}

/** The drives, in place of the studio PC's. */
function checkedDrives(value: unknown): Map<string, FixtureDrive> {
  if (!Array.isArray(value)) throw mistake("drives must be a list.");
  const drives = new Map<string, FixtureDrive>();
  value.forEach((entry: unknown, index) => {
    const where = `drives[${index}]`;
    if (!isObject(entry)) throw mistake(`${where} must be an object.`);
    onlyKeys(entry, DRIVE_KEYS, where);
    const { letter, name, mapped = false, answering = true, freeBytes, totalBytes } = entry;
    if (typeof letter !== "string" || !/^[C-Z]$/u.test(letter)) throw mistake(`${where}'s letter is one of C to Z.`);
    if (drives.has(letter)) throw mistake(`${where}: ${letter}: is there twice.`);
    if (typeof name !== "string") throw mistake(`${where}'s name must be text.`);
    if (typeof mapped !== "boolean" || typeof answering !== "boolean") {
      throw mistake(`${where}'s mapped and answering are true or false.`);
    }
    if (!isBytes(freeBytes) || !isBytes(totalBytes) || freeBytes > totalBytes) {
      throw mistake(`${where}'s space is whole bytes, free no more than its size.`);
    }
    drives.set(letter, { name, mapped, answering, freeBytes, totalBytes });
  });
  return drives;
}

/** vMix's word, over the double's own. */
function checkedVmix(value: unknown, session: FixtureSession) {
  if (!isObject(value)) throw mistake("vmix must be an object.");
  onlyKeys(value, VMIX_KEYS, "vmix");
  const vmix = { ...session.vmix };
  const { state, recording, file, bytesPerSecond } = value;
  if (state !== undefined) {
    if (state !== "not-read" && state !== "answering" && state !== "not-answering") {
      throw mistake("vmix.state is not-read, answering or not-answering: a simulated run's is the places'.");
    }
    vmix.state = state;
  }
  if (recording !== undefined) {
    if (typeof recording !== "boolean") throw mistake("vmix.recording is true or false.");
    vmix.recording = recording;
  }
  if (file !== undefined) {
    if (file !== null && typeof file !== "string") throw mistake("vmix.file is a path, or null.");
    vmix.file = file;
  }
  if (bytesPerSecond !== undefined) {
    if (bytesPerSecond !== null && !isBytes(bytesPerSecond))
      throw mistake("vmix.bytesPerSecond is whole bytes, or null.");
    vmix.bytesPerSecond = bytesPerSecond;
  }
  session.vmix = vmix;
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
  if (seed.recent !== undefined) {
    session.recent = checkedRecent(seed.recent);
    for (const entry of session.recent) putFolder(session.disk, entry.path);
  }
  if (seed.drives !== undefined) session.disk.drives = checkedDrives(seed.drives);
  if (seed.vmix !== undefined) checkedVmix(seed.vmix, session);
}
