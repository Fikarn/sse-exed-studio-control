import type { LevelBarTone } from "@sse/design-system";
import type { SessionDiskLevel, SessionDrive, SessionSnapshot } from "@sse/engine-client";

// The session's disk (D52; board 3, `docs/design/session-3.md`): the drives as
// the hardware link's sessions' watch last read them, and the words the
// window's disk row, the footer's `Disk`, the header's `Disk` chip and Setup /
// Support's Sessions screen say of them. Sizes are written in Explorer's units
// (1 GB = 1024³ bytes) and to its three figures (`2.00 TB`, `140 GB`), as the
// hardware link reads the levels; under 10 GB with one decimal (`9.5 GB`).
// Kept apart from the window's model, so the header and the footer read it
// without the page.

const MIB = 1024 ** 2;
const GIB = 1024 ** 3;
const TIB = 1024 ** 4;

/** Three figures: `2.00`, `17.4`, `140`. */
function threeFigures(value: number): string {
  if (value < 9.995) return value.toFixed(2);
  if (value < 99.95) return value.toFixed(1);
  return String(Math.round(value));
}

/** A size as Explorer writes it: `2.00 TB`, `17.4 TB`, `140 GB`, `9.5 GB`, `512 MB`. */
export function bytesWord(bytes: number): string {
  const size = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  if (size >= 999.5 * GIB) return `${threeFigures(size / TIB)} TB`;
  if (size >= 999.5 * MIB) {
    const gib = size / GIB;
    return gib < 9.95 ? `${gib.toFixed(1)} GB` : `${Math.round(gib)} GB`;
  }
  return `${Math.round(size / MIB)} MB`;
}

/** The drive's letter of a path as Windows writes it, `D` of `D:\Sessions`; `null` for another shape. */
export function letterOf(path: string | null | undefined): string | null {
  return path && /^[A-Za-z]:/u.test(path) ? path.charAt(0).toUpperCase() : null;
}

/** A drive as Explorer names it: `Storage 1 (D:)`, or `D:` while it has no name yet. */
export function driveLabel(drive: Pick<SessionDrive, "letter" | "name">): string {
  return drive.name ? `${drive.name} (${drive.letter}:)` : `${drive.letter}:`;
}

/** The drive of a letter as the watch last read it; `null` when the read did not find it. */
export function driveOf(snapshot: SessionSnapshot | null, letter: string | null): SessionDrive | null {
  if (!snapshot || letter === null) return null;
  return snapshot.drives.find((drive) => drive.letter === letter) ?? null;
}

/** The session's drive (the running session's folder's, else the sessions' folder's), as last read. */
export function sessionDriveOf(snapshot: SessionSnapshot | null): SessionDrive | null {
  return driveOf(snapshot, snapshot?.sessionDrive ?? null);
}

/** The share of the drive used, 0 to 1, for its level bar. */
export function usedShare(drive: SessionDrive): number {
  if (drive.freeBytes === null || drive.totalBytes === null || drive.totalBytes <= 0) return 0;
  return 1 - drive.freeBytes / drive.totalBytes;
}

/** The level bar's tone: quiet while there is room, attention when low, error when nearly full. */
export function levelTone(level: SessionDiskLevel | null): LevelBarTone {
  return level === "nearly-full" ? "error" : level === "low" ? "attention" : "quiet";
}

/** The word a level says in its row, with its lamp; `null` while there is room. */
export function levelWord(level: SessionDiskLevel | null): { word: string; tone: "attention" | "error" } | null {
  if (level === "nearly-full") return { word: "Nearly full", tone: "error" };
  if (level === "low") return { word: "Low", tone: "attention" };
  return null;
}

/** `2.00 TB free of 3.73 TB`, the free space in its own words for the row to set in bold. */
export function spaceWords(drive: SessionDrive): { free: string; total: string } | null {
  if (drive.freeBytes === null || drive.totalBytes === null) return null;
  return { free: bytesWord(drive.freeBytes), total: bytesWord(drive.totalBytes) };
}

/** What the footer's `Disk` says, and in which tone. */
export interface DiskWord {
  word: string;
  tone?: "attention" | "error";
}

/**
 * The footer's `Disk` (D52), on the Session page and the Overview: the
 * session's drive's free space, `2.00 TB free on Storage 1`, yellow while low
 * and coral while nearly full; `not read` before the watch's first read; and
 * what it says of a drive that does not answer or is not there.
 */
export function footerDiskWord(snapshot: SessionSnapshot | null): DiskWord {
  const letter = snapshot?.sessionDrive ?? null;
  if (!snapshot || snapshot.readAt === null || letter === null) return { word: "not read" };
  const drive = driveOf(snapshot, letter);
  if (!drive) return { word: `${letter}: not there`, tone: "error" };
  if (!drive.answering || drive.freeBytes === null) return { word: `${letter}: does not answer`, tone: "attention" };
  const tone = levelWord(drive.level)?.tone;
  return { word: `${bytesWord(drive.freeBytes)} free on ${drive.name || `${letter}:`}`, ...(tone ? { tone } : {}) };
}
