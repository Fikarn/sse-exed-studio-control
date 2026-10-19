// Part of the fixture double (`../fixtureTransport.ts`): the in-memory stand-in for the
// hardware link that Playwright and the browser fixture mode run against. Test-only.
import type { EngineTransport } from "../../types";
import type { SessionDiskLevel } from "../../generated/snapshots/SessionDiskLevel";
import type { SessionDrive } from "../../generated/snapshots/SessionDrive";
import type { SessionSnapshot } from "../../generated/snapshots/SessionSnapshot";
import type { SessionVmix } from "../../generated/snapshots/SessionVmix";
import { fixtureContextOf } from "./camerasRequests";
import { folderThere, joinPath } from "./sessionFolder";
import {
  GIB,
  fixtureSession,
  oneOfEachKind,
  type FixtureDisk,
  type FixtureSession,
  type FixtureVmix,
} from "./sessionState";

// What the hardware link's sessions' watch reads (D52; `native/rust-engine/src/session/watch.rs`),
// as the double's data: the drives with their levels, the sessions' folder's newest folders,
// vMix's word, with whether its file is in the running session's folder and where vMix should
// record in it. A simulated run never reads vMix. The test hooks change a drive or vMix as the
// watch's next read would find them, and raise `session.changed { reason: "read" }`.

/** How a drive's free space reads (`level_of`): Nearly full, Low, or ok, in Explorer's GB. */
export function levelOf(freeBytes: number, lowBelowGb: number, nearlyFullBelowGb: number): SessionDiskLevel {
  if (freeBytes < nearlyFullBelowGb * GIB) return "nearly-full";
  if (freeBytes < lowBelowGb * GIB) return "low";
  return "ok";
}

/** Whether `file` is inside `folder`, capitals aside and `\` and `/` alike (`in_folder`). */
export function inFolder(file: string, folder: string): boolean {
  const read = (path: string) => path.replaceAll("/", "\\").toLowerCase();
  const inside = read(folder).replace(/\\+$/u, "");
  const path = read(file);
  return inside !== "" && path.startsWith(`${inside}\\`) && path.length > inside.length + 1;
}

/** The folder vMix should record to in a session's folder (`recording_folder_in`): its first
 *  subfolder by name whose name holds `vmix` in any case, as the disk writes it, else the
 *  folder itself; `null` for a folder that is not on the disk, which cannot be listed. */
function recordingFolderIn(disk: FixtureDisk, folder: string): string | null {
  if (!folderThere(disk, folder)) return null;
  const prefix = `${folder.toLowerCase()}\\`;
  const names = [...disk.folders.entries()]
    .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes("\\"))
    .map(([, written]) => written.slice(prefix.length))
    .filter((name) => name.toLowerCase().includes("vmix"))
    .sort((one, other) => one.toLowerCase().localeCompare(other.toLowerCase()));
  const first = names[0];
  return first === undefined ? folder : joinPath(folder, first);
}

/** The drive a path is on, by its letter. */
function letterOf(path: string): string | null {
  return /^[A-Za-z]:/u.test(path) ? path.charAt(0).toUpperCase() : null;
}

/** Whether `path` is a folder right on `root`, capitals aside: a folder of the sessions'
 *  folder the watch lists. */
export function onRoot(path: string, root: string): boolean {
  const name = path.slice(path.lastIndexOf("\\") + 1);
  return name !== "" && joinPath(root, name).toLowerCase() === path.toLowerCase();
}

function vmixOf(session: FixtureSession, folder: string | null): SessionVmix {
  const recordingFolder = folder === null ? null : recordingFolderIn(session.disk, folder);
  const quiet = { recording: false, file: null, inFolder: null, bytesPerSecond: null, recordingFolder };
  if (session.simulated) return { state: "simulated", ...quiet };
  const { state, recording, file, bytesPerSecond } = session.vmix;
  if (state !== "answering") return { state, ...quiet };
  return {
    state,
    recording,
    file,
    inFolder: file === null || folder === null ? null : inFolder(file, folder),
    bytesPerSecond: recording ? bytesPerSecond : null,
    recordingFolder,
  };
}

/** The watch's measure of a folder (`WatchReport::size_of`): its entry's among the newest. */
export function measuredSize(session: FixtureSession, path: string | null): number | null {
  if (path === null) return null;
  return session.recent.find((entry) => entry.path.toLowerCase() === path.toLowerCase())?.bytes ?? null;
}

/**
 * `session.snapshot`: the session as kept, and what the watch reads (`snapshot_of`). The
 * sessions' folder and its newest folders are read only while its drive answers; the running
 * session's folder takes the watch's measure of it, a last session the measure kept at its
 * end, else the watch's.
 */
export function sessionSnapshotOf(session: FixtureSession): SessionSnapshot {
  const { settings } = session;
  const root = session.simulated ? session.scratchRoot : settings.root;
  const folder = session.current?.folder ?? null;
  const rootLetter = letterOf(root);
  const rootRead = rootLetter !== null && session.disk.drives.get(rootLetter)?.answering === true;
  const current = session.current && {
    ...session.current,
    folderBytes: measuredSize(session, session.current.folder) ?? session.current.folderBytes,
  };
  const last = oneOfEachKind(session.last).map((ended) => ({
    ...ended,
    folderBytes: ended.folderBytes ?? measuredSize(session, ended.folder),
  }));
  const drives: SessionDrive[] = [...session.disk.drives.entries()]
    .sort(([one], [other]) => one.localeCompare(other))
    .map(([letter, drive]) => ({
      letter,
      name: drive.name,
      mapped: drive.mapped,
      answering: drive.answering,
      freeBytes: drive.answering ? drive.freeBytes : null,
      totalBytes: drive.answering ? drive.totalBytes : null,
      level: drive.answering ? levelOf(drive.freeBytes, settings.lowBelowGb, settings.nearlyFullBelowGb) : null,
    }));
  return {
    current,
    last,
    settings,
    places: { root, simulated: session.simulated, rootExists: rootRead && folderThere(session.disk, root) },
    recent: rootRead ? session.recent.filter((entry) => onRoot(entry.path, root)) : [],
    drives,
    sessionDrive: letterOf(folder ?? root),
    vmix: vmixOf(session, folder),
    readAt: session.readAt,
  };
}

/** The page tests' hold on what the double's watch reads (`window.__SSE_TEST_SESSION__`). */
export interface SimulatedSessionHooks {
  /** vMix answers otherwise at its next look: its state, whether it records, the file it
   *  names, the file's write rate. */
  setVmix(vmix: Partial<FixtureVmix>): void;
  /** A drive has this many bytes free at the next read (and answers), stops answering, or is
   *  not there any more. */
  setDrive(letter: string, change: number | "not-answering" | "not-there"): void;
}

const VMIX_STATES: readonly FixtureVmix["state"][] = ["not-read", "answering", "not-answering"];

/** The hooks of a fixture double made by `createFixtureTransport`. */
export function simulatedSession(transport: EngineTransport): SimulatedSessionHooks {
  const context = fixtureContextOf(transport);
  const read = (change: (session: FixtureSession) => void) => {
    const session = fixtureSession(context.state);
    change(session);
    session.readAt = new Date().toISOString();
    context.emit("session.changed", { reason: "read" });
  };
  return {
    setVmix: (vmix) =>
      read((session) => {
        if (vmix.state !== undefined && !VMIX_STATES.includes(vmix.state)) {
          throw new Error(`vMix's state is one of ${VMIX_STATES.join(", ")}.`);
        }
        session.vmix = { ...session.vmix, ...vmix };
      }),
    setDrive: (letter, change) =>
      read((session) => {
        if (change === "not-there") {
          session.disk.drives.delete(letter);
          return;
        }
        const drive = session.disk.drives.get(letter);
        if (!drive) throw new Error(`The double has no drive ${letter}:.`);
        if (change === "not-answering") {
          drive.answering = false;
        } else {
          drive.answering = true;
          drive.freeBytes = change;
        }
      }),
  };
}
