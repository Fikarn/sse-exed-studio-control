// Part of the fixture double (`../fixtureTransport.ts`): the in-memory stand-in for the
// hardware link that Playwright and the browser fixture mode run against. Test-only.
import type { SessionFolderMade } from "../../generated/snapshots/SessionFolderMade";
import type { SessionKind } from "../../generated/snapshots/SessionKind";
import { EngineRequestError } from "../engineRequestError";
import { SESSION_KIND_NAMES, type FixtureDisk } from "./sessionState";

// The session's folder (D52; `native/rust-engine/src/session/folder.rs`): the name a new one
// takes, the paths the operator chooses, a begin's checks in the hardware link's order with
// its codes and sentences, and what a begin makes, on the double's own disk, which is data:
// the folders it knows are there, and the drives. It touches no disk. The folder's name is
// held to the hardware link's by the case table `native/protocol/session-folder-names.json`.

/** The most characters the longest path a begin makes has, in UTF-16 units as Windows counts them. */
export const FOLDER_PATH_MAX_CHARACTERS = 200;

// The characters Windows does not take in a name, beside the control characters, and the
// names it keeps for its devices.
const FORBIDDEN = new Set(["\\", "/", ":", "*", "?", '"', "<", ">", "|"]);
const CONTROL = /\p{Cc}/u;
const RESERVED = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  ...["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "¹", "²", "³"].flatMap((digit) => [
    `COM${digit}`,
    `LPT${digit}`,
  ]),
  "CONIN$",
  "CONOUT$",
]);

function forbidden(character: string): boolean {
  return FORBIDDEN.has(character) || CONTROL.test(character);
}

/** The name of a new session's folder (`folder_leaf`): `Morning take (2026-10-18)`. */
export function folderLeaf(name: string, kind: SessionKind, day: string): string {
  const replaced = [...name].map((character) => (forbidden(character) ? "-" : character)).join("");
  const kept = replaced.replace(/[. ]+$/u, "");
  return `${kept === "" ? SESSION_KIND_NAMES[kind] : kept} (${day})`;
}

/** The local day of `at`, `2026-10-18` (`local_day`). */
export function localDay(at: Date): string {
  const two = (value: number) => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`;
}

/** Why Windows would not take `name` as a folder's name as it is written (`name_problem`). */
export function nameProblem(name: string): string | null {
  if (name === "." || name === "..") return `"${name}" is not a folder's name.`;
  if ([...name].some(forbidden)) {
    return `"${name}" has a character Windows does not take in a folder's name: \\ / : * ? " < > | or a control character.`;
  }
  if (/[. ]$/u.test(name)) {
    return `"${name}" ends with a dot or a space, which Windows leaves out of a folder's name.`;
  }
  const stem = (name.split(".")[0] ?? name).replace(/ +$/u, "").replace(/[a-z]/gu, (letter) => letter.toUpperCase());
  if (RESERVED.has(stem)) return `"${name}" is a name Windows keeps for itself.`;
  return null;
}

/** A path read as a folder's on a lettered drive (`read_drive_path`). */
export type DrivePathReading = { path: string } | { share: true } | { shape: string };

export function readDrivePath(text: string): DrivePathReading {
  const written = text.replaceAll("/", "\\");
  if (written.startsWith("\\\\?\\") || written.startsWith("\\\\.\\")) {
    return {
      shape: `"${text}" is written for Windows' own use: write the folder's path as Explorer shows it, such as D:\\Sessions.`,
    };
  }
  if (written.startsWith("\\\\")) return { share: true };
  const drive = /^([A-Za-z]):\\([\s\S]*)$/u.exec(written);
  if (!drive) {
    return { shape: `"${text}" is not a folder's full path: it begins with a drive's letter, as D:\\Sessions does.` };
  }
  const [, letter = "", after = ""] = drive;
  const rest = after.replace(/\\+$/u, "");
  const parts: string[] = [];
  if (rest !== "") {
    for (const part of rest.split("\\")) {
      if (part === "") return { shape: `"${text}" has two \\ together.` };
      if (part === "." || part === "..")
        return { shape: `"${text}" has a . or a .. in it: write the folder's own path.` };
      const problem = nameProblem(part);
      if (problem) return { shape: problem };
      parts.push(part);
    }
  }
  return { path: `${letter.toUpperCase()}:\\${parts.join("\\")}` };
}

/** `folder` in `parent`, as Windows joins them. */
export function joinPath(parent: string, name: string): string {
  return parent.endsWith("\\") ? `${parent}${name}` : `${parent}\\${name}`;
}

/** A drive's own top, `D:\`: there when its drive is. */
const DRIVE_TOP = /^[A-Z]:\\$/u;

/** The path and the folders above it, the drive's top left out: what making it makes. */
function withAncestors(path: string): string[] {
  const parts = path.split("\\");
  return parts
    .slice(1)
    .map((_, index) => parts.slice(0, index + 2).join("\\"))
    .filter((folder) => folder !== "" && !DRIVE_TOP.test(folder));
}

/** Puts a folder, and the folders above it, on the double's disk. */
export function putFolder(disk: FixtureDisk, path: string) {
  for (const folder of withAncestors(path)) disk.folders.set(folder.toLowerCase(), folder);
}

export function folderThere(disk: FixtureDisk, path: string): boolean {
  if (DRIVE_TOP.test(path)) return disk.drives.has(path.charAt(0));
  return disk.folders.has(path.toLowerCase());
}

/** Whether `path` is `folder` or inside it, capitals aside. */
function sameOrInside(path: string, folder: string): boolean {
  const [candidate, base] = [path.toLowerCase(), folder.toLowerCase().replace(/\\+$/u, "")];
  return candidate === base || candidate.startsWith(`${base}\\`);
}

/** `session.begin`'s `folder`, read (`SessionFolderChoice`). */
export type FolderChoice = { mode: "new"; parent: string | null } | { mode: "existing"; path: string };

const invalid = (message: string) => new EngineRequestError("INVALID_PARAMS", message);

/** The begin's `folder`: a new folder on the sessions' folder when it is absent or `null`. */
export function folderChoice(value: unknown): FolderChoice {
  if (value === undefined || value === null) return { mode: "new", parent: null };
  if (typeof value !== "object" || Array.isArray(value)) throw invalid("folder: must be an object with a mode");
  const fields = value as Record<string, unknown>;
  const allowed = fields.mode === "existing" ? ["mode", "path"] : ["mode", "parent"];
  const unknown = Object.keys(fields).filter((key) => !allowed.includes(key));
  if (fields.mode === "new") {
    if (unknown.length > 0) throw invalid(`folder: unknown field \`${unknown[0]}\`, expected \`parent\``);
    const { parent } = fields;
    if (parent !== undefined && parent !== null && typeof parent !== "string") {
      throw invalid("folder: parent must be a string or null");
    }
    return { mode: "new", parent: typeof parent === "string" ? parent : null };
  }
  if (fields.mode === "existing") {
    if (unknown.length > 0) throw invalid(`folder: unknown field \`${unknown[0]}\`, expected \`path\``);
    if (typeof fields.path !== "string") throw invalid("folder: missing field `path`");
    return { mode: "existing", path: fields.path };
  }
  throw invalid("folder: mode must be one of: new, existing");
}

/** A begin's folder, once its checks have passed (`FolderPlan`). */
export type FolderPlan =
  | { mode: "existing"; path: string }
  | { mode: "new"; root: string | null; folder: string; subfolders: readonly string[] };

/** Where this double makes the sessions' folders (`Places`): a simulated run's scratch
 *  folder, or the settings' root. */
export interface FolderPlaces {
  simulated: boolean;
  scratchRoot: string;
}

const refused = (code: string, sentence: string) => new EngineRequestError(code, sentence);

/** A begin's checks for its folder, in the hardware link's order (`plan_folder`). */
export function planFolder(
  disk: FixtureDisk,
  places: FolderPlaces,
  choice: FolderChoice,
  leaf: string,
  rootSetting: string,
  subfolders: readonly string[]
): FolderPlan {
  // The folder's shape.
  const written = choice.mode === "existing" ? choice.path : choice.parent;
  let chosen: string | null = null;
  if (written !== null) {
    const reading = readDrivePath(written);
    if ("share" in reading) {
      throw refused("SESSION_FOLDER_NOT_ON_A_DRIVE", "Choose a folder on a drive with a letter, such as Public (Z:).");
    }
    if ("shape" in reading) throw invalid(reading.shape);
    chosen = reading.path;
  }

  // Its drive there, one that did not answer the last read refused at once; a folder that
  // exists is used as it is, and nothing is made in it.
  if (choice.mode === "existing" && chosen !== null) {
    const letter = chosen.charAt(0);
    if (disk.drives.get(letter)?.answering === false) {
      throw refused(
        "SESSION_DRIVE_MISSING",
        `${letter}: does not answer, so ${chosen} cannot be used. Choose another folder.`
      );
    }
    if (!disk.drives.has(letter)) {
      throw refused(
        "SESSION_DRIVE_MISSING",
        `${letter}: is not there, so ${chosen} cannot be used. Choose another folder.`
      );
    }
    if (!folderThere(disk, chosen)) {
      throw refused("SESSION_FOLDER_MISSING", `${chosen} is not there any more. Choose another folder.`);
    }
    return { mode: "existing", path: chosen };
  }
  const root = chosen === null ? (places.simulated ? places.scratchRoot : rootSetting) : null;
  const parent = chosen ?? root ?? rootSetting;
  const letter = /^[A-Z]:/u.test(parent) ? parent.charAt(0) : null;
  if (letter !== null && disk.drives.get(letter)?.answering === false) {
    throw refused(
      "SESSION_DRIVE_MISSING",
      `${letter}: does not answer, so the session's folder cannot be made there. Choose a folder on another drive, or set another sessions' folder in Setup / Support.`
    );
  }
  if (letter !== null && !disk.drives.has(letter)) {
    throw refused(
      "SESSION_DRIVE_MISSING",
      `${letter}: is not there, so the session's folder cannot be made there. Choose a folder that exists, or set another sessions' folder in Setup / Support.`
    );
  }

  // In a simulated run, a new folder inside its scratch folder.
  const folder = joinPath(parent, leaf);
  if (places.simulated && !sameOrInside(folder, places.scratchRoot)) {
    throw refused(
      "SESSION_FOLDER_OUTSIDE_SCRATCH",
      `This run makes its folders only in ${places.scratchRoot}, beside its own saved data.`
    );
  }

  // The length of the longest path it would make.
  const longest = folder.length + Math.max(0, ...subfolders.map((subfolder) => 1 + subfolder.length));
  if (longest > FOLDER_PATH_MAX_CHARACTERS) {
    throw refused(
      "SESSION_FOLDER_PATH_TOO_LONG",
      `That folder's path would be ${longest} characters, over ${FOLDER_PATH_MAX_CHARACTERS}: choose a shorter name, or a folder nearer the drive's top.`
    );
  }

  // The parent a new folder goes in; the sessions' folder is made when it is not there.
  if (root === null && !folderThere(disk, parent)) {
    throw refused("SESSION_FOLDER_MISSING", `${parent} is not there any more. Choose another folder.`);
  }
  return { mode: "new", root, folder, subfolders };
}

/** A begin's acts for its folder (`make_folder`), on the double's disk. */
export function makeFolder(disk: FixtureDisk, plan: FolderPlan): SessionFolderMade {
  if (plan.mode === "existing") return { path: plan.path, made: false };
  if (plan.root !== null) putFolder(disk, plan.root);
  if (folderThere(disk, plan.folder)) return { path: plan.folder, made: false };
  putFolder(disk, plan.folder);
  for (const subfolder of plan.subfolders) putFolder(disk, joinPath(plan.folder, subfolder));
  return { path: plan.folder, made: true };
}
