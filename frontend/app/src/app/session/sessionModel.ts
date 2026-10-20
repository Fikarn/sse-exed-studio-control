import type { Session, SessionFolderChoice, SessionKind, SessionSnapshot, SessionVmix } from "@sse/engine-client";

import type { OverviewState, OverviewWayOut } from "../overview/overviewModel";
import { kindOf } from "./kinds";
import { bytesWord } from "./sessionDisk";

// The Session page's model (D51; docs/design/session.md, board 2): the words
// the page and its window say, in pure functions so they are tested without
// a browser. The hardware link keeps the session (`session.snapshot`); the
// page says when it began, the last one of each kind, and what Begin will do.
// The window's note mirrors the Overview's state display (`overviewState`):
// the worst page's word, sentence and way out, and only when it needs the
// operator.

const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "short" });
const shortDay = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const longDay = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" });

const DAY_MS = 86_400_000;

/** A time the hardware link wrote (UTC text, `2026-10-15T07:16:00.000Z`); `null` when it cannot be read. */
function timeOf(text: string | null | undefined): Date | null {
  if (!text) return null;
  const at = new Date(text);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** How many local days `at` is before `now`: 0 on the day, 1 the day before. */
function daysBefore(at: Date, now: Date): number {
  const midnight = (day: Date) => new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  // A day with a clock change is 23 or 25 hours long.
  return Math.round((midnight(now) - midnight(at)) / DAY_MS);
}

/** `Thursday 15 October`: the day, as the question and the window say it. */
export function dayWord(now: Date | number): string {
  return longDay.format(new Date(now));
}

/** The moment, by its day: `09:16` on the day, `Wed 14:02` in the week before, `7 Oct 14:02` before that. */
function momentWord(at: Date, now: Date): string {
  const days = daysBefore(at, now);
  if (days === 0) return clock.format(at);
  const day = days > 0 && days < 7 ? weekday.format(at) : shortDay.format(at);
  return `${day} ${clock.format(at)}`;
}

/**
 * When the running session began, as its Room and the platter say it:
 * `since 09:16` on the day, `since Wed 14:02` in the week before, `since 7
 * Oct 14:02` before that. No clock ends a session (session.md section 4), so
 * one from an earlier day says its day. `null` when the time cannot be read.
 */
export function sinceWord(begunAt: string | null | undefined, now: Date | number): string | null {
  const at = timeOf(begunAt);
  return at ? `since ${momentWord(at, new Date(now))}` : null;
}

/** As the running session's own window says it: `since 09:16 today`, or `since Wed 14:02`. */
export function sinceTodayWord(begunAt: string | null | undefined, now: Date | number): string | null {
  const at = timeOf(begunAt);
  if (!at) return null;
  const today = daysBefore(at, new Date(now)) === 0;
  return `since ${momentWord(at, new Date(now))}${today ? " today" : ""}`;
}

/** `Begun at 09:16`, or `Begun on Wednesday 14 October at 14:02`; `null` when the time cannot be read. */
export function begunWord(begunAt: string | null | undefined, now: Date | number): string | null {
  const at = timeOf(begunAt);
  if (!at) return null;
  return daysBefore(at, new Date(now)) === 0
    ? `Begun at ${clock.format(at)}`
    : `Begun on ${longDay.format(at)} at ${clock.format(at)}`;
}

/** `Last time · Wednesday 14 October`, the day the kind's last session began, `Last time · today`; `Last time` when it cannot be read. */
export function lastTimeWord(session: Session, now: Date | number): string {
  const at = timeOf(session.begunAt);
  if (!at) return "Last time";
  return `Last time · ${daysBefore(at, new Date(now)) === 0 ? "today" : longDay.format(at)}`;
}

/** The running session; `null` while none runs, or before the session is read. */
export function runningOf(snapshot: SessionSnapshot | null): Session | null {
  return snapshot?.current ?? null;
}

/** The last session of a kind: the newest that ended; `null` for a kind never used. */
export function lastOf(snapshot: SessionSnapshot | null, kind: SessionKind): Session | null {
  return snapshot?.last.find((session) => session.kind === kind) ?? null;
}

/** The kind's name in the operator's words; the hardware link's id when the page does not know it. */
export function kindName(kind: SessionKind): string {
  return kindOf(kind)?.name ?? kind;
}

/** What Begin does with the session's folder (D52): makes a new one, or uses one that exists. */
export type FolderVerb = "makes" | "uses";

/**
 * Begin's hint: `makes the folder · opens the Overview`, or `uses the folder ·
 * opens the Overview` for a folder that exists, with `ends the podcast
 * recording · ` before it while another kind runs.
 */
export function beginHint(other: Session | null, folder: FolderVerb = "makes"): string {
  const verb = `${folder === "uses" ? "uses" : "makes"} the folder · opens the Overview`;
  if (!other) return verb;
  return `ends the ${kindOf(other.kind)?.inSentence ?? "running session"} · ${verb}`;
}

/** The note a window shows while another kind runs: `Podcast Recording, since 09:16. Beginning this ends it.` */
export function runningNote(other: Session, now: Date | number): string {
  const since = sinceWord(other.begunAt, now);
  return `${kindName(other.kind)}${since ? `, ${since}` : ""}. Beginning this ends it.`;
}

/** What a window says needs the operator before a session begins: the worst page's word, sentence and way out. */
export interface SessionNote {
  tone: "attention" | "error";
  word: string;
  sentence: string;
  wayOut: OverviewWayOut | null;
}

/** The Overview's state as the window's note: none while every page is ready. */
export function noteOf(state: OverviewState): SessionNote | null {
  if (state.tone === "ok") return null;
  return { tone: state.tone, word: state.word, sentence: state.sentence, wayOut: state.wayOut };
}

// Rust's `str::trim`, as the hardware link trims a name: the characters with
// Unicode's White_Space property (JavaScript's own `trim` takes U+FEFF and
// leaves U+0085).
const WHITE_SPACE = "[\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";
const EDGES = new RegExp(`^${WHITE_SPACE}+|${WHITE_SPACE}+$`, "g");

/** A name as the hardware link keeps it: trimmed at both ends; empty for none. */
export function trimmedName(name: string): string {
  return name.replace(EDGES, "");
}

/** The most characters a session's name has (the hardware link refuses more). */
export const NAME_MAX_CHARACTERS = 80;

// ---------------------------------------------------------------------------
// Step 2 (D52; board 3, `docs/design/session-3.md`): the session's folder, how
// long the disk lasts, and vMix's recording. The folder's name is the hardware
// link's (`folder_leaf`), held to it by the case table both read,
// `native/protocol/session-folder-names.json`.
// ---------------------------------------------------------------------------

/** The local day `now` falls on, `2026-10-18`: the day a new folder's name ends with. */
export function localDay(now: Date | number): string {
  const at = new Date(now);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`;
}

// The characters Windows does not take in a folder's name: \ / : * ? " < > |
// and every control character.
const FORBIDDEN = /[\\/:*?"<>|\p{Cc}]/gu;

/**
 * The name a new session's folder takes: the session's name as the hardware
 * link keeps it (`trimmedName`), each character Windows refuses written as a
 * dash and the dots and spaces at its end left out, or the kind's name when
 * that leaves none; then the day, `Morning take (2026-10-18)`.
 */
export function folderLeaf(name: string, kind: SessionKind, day: string): string {
  const kept = name.replace(FORBIDDEN, "-").replace(/[. ]+$/u, "");
  return `${kept === "" ? kindName(kind) : kept} (${day})`;
}

/** A path as Windows writes it, read for comparing: `\` for `/`, no `\` at its end, capitals aside. */
function pathKey(path: string): string {
  return path.replaceAll("/", "\\").replace(/\\+$/u, "").toLowerCase();
}

/** Two paths name one folder, as Windows reads them (capitals aside, a `\` at the end aside). */
export function samePath(one: string | null | undefined, other: string | null | undefined): boolean {
  return one != null && other != null && pathKey(one) === pathKey(other);
}

/** `name` in the folder `parent`, as Windows joins them. */
export function pathIn(parent: string, name: string): string {
  return parent.endsWith("\\") ? `${parent}${name}` : `${parent}\\${name}`;
}

/** A path's last part, the folder's own name: `Morning take (2026-10-18)`. */
export function leafOf(path: string): string {
  const trimmed = path.replace(/\\+$/u, "");
  return trimmed.slice(trimmed.lastIndexOf("\\") + 1);
}

/** The folder a path stands in: `D:\Sessions` of `D:\Sessions\Morning take`, `D:\` of `D:\Sessions`. */
export function parentPath(path: string): string {
  const trimmed = path.replace(/\\+$/u, "");
  const cut = trimmed.lastIndexOf("\\");
  if (cut < 0) return trimmed;
  return cut <= 2 ? trimmed.slice(0, cut + 1) : trimmed.slice(0, cut);
}

/** A folder as the window's well writes the folder it stands in: `D:\Sessions\`, `D:\`. */
export function parentLine(parent: string): string {
  return parent.endsWith("\\") ? parent : `${parent}\\`;
}

/** `path` lies inside `folder`: the part after it, `vMix Recording`; `null` when it is not inside. */
function insideOf(path: string, folder: string): string | null {
  const [inner, outer] = [pathKey(path), pathKey(folder)];
  if (!inner.startsWith(`${outer}\\`)) return null;
  return path
    .replaceAll("/", "\\")
    .replace(/\\+$/u, "")
    .slice(outer.length + 1);
}

/** How long a session lasted: `1 h 20 min`, `55 min`. */
export function durationWord(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

/** How long the free space lasts: `about 45 h`, `about 3 h 05 min`, `about 35 min`, `under 5 min`. */
export function lastsWord(hours: number): string {
  const minutes = Math.round(Math.max(0, hours) * 12) * 5;
  if (minutes >= 600) return `about ${Math.round(hours)} h`;
  if (minutes < 5) return "under 5 min";
  if (minutes < 60) return `about ${minutes} min`;
  return `about ${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

/** A session shorter than this gives no rate: its folder says too little about the next one. */
const RATE_MIN_MS = 10 * 60_000;

/**
 * How fast a session's folder filled: its size over its length, from the
 * hardware link's last measure of it; `null` for a session without one, one
 * still running, or one shorter than 10 minutes.
 */
export function sessionRate(session: Session | null): { bytesPerHour: number; bytes: number; ms: number } | null {
  if (!session?.endedAt || session.folderBytes === null || session.folderBytes <= 0) return null;
  const ms = Date.parse(session.endedAt) - Date.parse(session.begunAt);
  if (!Number.isFinite(ms) || ms < RATE_MIN_MS) return null;
  return { bytesPerHour: session.folderBytes / (ms / 3_600_000), bytes: session.folderBytes, ms };
}

/**
 * How long a drive's free space lasts at the rate of the last session of its
 * kind: `about 45 h at the rate of the last podcast recording (61 GB in 1 h 20
 * min)`; `null` when that session gives no rate.
 */
export function lastRateLine(last: Session | null, freeBytes: number): string | null {
  const rate = sessionRate(last);
  if (!last || !rate) return null;
  const kind = kindOf(last.kind)?.inSentence ?? "session";
  return `${lastsWord(freeBytes / rate.bytesPerHour)} at the rate of the last ${kind} (${bytesWord(rate.bytes)} in ${durationWord(rate.ms)})`;
}

/** While vMix records onto the drive: `vMix writes 13 MB/s to it now: about 3 h 05 min at this rate`. */
export function vmixRateLine(bytesPerSecond: number, freeBytes: number): string {
  const perSecond = bytesPerSecond / 1024 ** 2;
  const rate = perSecond < 9.95 ? perSecond.toFixed(1) : String(Math.round(perSecond));
  return `vMix writes ${rate} MB/s to it now: ${lastsWord(freeBytes / bytesPerSecond / 3600)} at this rate`;
}

/** What the running session's window says of vMix's recording, in which tone, and whether it offers the path. */
export interface VmixLine {
  tone: "ok" | "attention" | "off";
  sentence: string;
  /** `Copy the path`: vMix does not record into the folder, and the folder it should is known. */
  copy: boolean;
}

/**
 * The running session's vMix line (D52): vMix's API cannot set where vMix
 * records, so the window says whether the file vMix names is in the
 * session's folder, and offers the path for vMix's Recording settings when it
 * is not.
 */
export function vmixLine(vmix: SessionVmix, folder: string): VmixLine {
  const copy = vmix.recordingFolder !== null;
  if (vmix.state === "simulated") return { tone: "off", sentence: "vMix is not read in this run.", copy };
  if (vmix.state === "not-read") return { tone: "off", sentence: "vMix has not been read yet.", copy };
  if (vmix.state === "not-answering") {
    return { tone: "off", sentence: "vMix does not answer: where it records is not known.", copy };
  }
  if (vmix.file === null) {
    return {
      tone: "off",
      sentence: "vMix has not recorded since it started: set its Recording folder to this one.",
      copy,
    };
  }
  const where = parentPath(vmix.file);
  const inside = vmix.inFolder === true ? insideOf(where, folder) : null;
  if (vmix.recording) {
    if (vmix.inFolder === true) {
      return {
        tone: "ok",
        sentence: inside ? `vMix records into this folder's ${inside}.` : "vMix records into this folder.",
        copy: false,
      };
    }
    return { tone: "attention", sentence: `vMix records to ${where}, not here.`, copy };
  }
  if (vmix.inFolder === true) return { tone: "ok", sentence: "vMix's last recording is in this folder.", copy: false };
  return {
    tone: "attention",
    sentence: `vMix's last recording went to ${where}. Set its Recording folder to this one before you record.`,
    copy,
  };
}

/** A folder an existing session's folder may be: its path, and its size as last measured. */
export interface FolderRow {
  path: string;
  bytes: number | null;
}

/**
 * The folders `An existing one` offers (D52): the kind's last session's
 * folder first, then the newest other one on the sessions' folder; the folder
 * Windows' dialog chose takes the second row's place.
 */
export function existingRows(snapshot: SessionSnapshot | null, kind: SessionKind, chosen: string | null): FolderRow[] {
  const recent = snapshot?.recent ?? [];
  const sizeOf = (path: string) => recent.find((entry) => samePath(entry.path, path))?.bytes ?? null;
  const rows: FolderRow[] = [];
  const last = lastOf(snapshot, kind);
  if (last?.folder) rows.push({ path: last.folder, bytes: last.folderBytes ?? sizeOf(last.folder) });
  for (const entry of recent) {
    if (rows.length >= 2) break;
    if (!rows.some((row) => samePath(row.path, entry.path))) rows.push({ path: entry.path, bytes: entry.bytes });
  }
  if (chosen === null) return rows;
  const first = rows[0];
  if (!first) return [{ path: chosen, bytes: sizeOf(chosen) }];
  if (samePath(first.path, chosen)) return rows;
  return [first, { path: chosen, bytes: sizeOf(chosen) }];
}

/** A new session's folder, as the window holds it for a kind while the page is open. */
export interface FolderChoice {
  mode: "new" | "existing";
  /** The folder a new folder is made in; `null` for the sessions' folder. */
  parent: string | null;
  /** The existing folder chosen; `null` for the first row. */
  picked: string | null;
  /** The folder Windows' dialog chose, which takes the second row's place. */
  other: string | null;
}

/** A window's folder before the operator chose: a new folder on the sessions' folder. */
export const NEW_FOLDER: FolderChoice = { mode: "new", parent: null, picked: null, other: null };

/** The row of the existing folder chosen: the one picked, else the first. */
export function chosenRow(rows: readonly FolderRow[], picked: string | null): number {
  const index = picked === null ? -1 : rows.findIndex((row) => samePath(row.path, picked));
  return index < 0 ? 0 : index;
}

/**
 * Begin's `folder` (D52): `{ mode: "new" }` on the sessions' folder, with the
 * folder `Change…` chose as its `parent`, or `{ mode: "existing", path }`;
 * `null` when `An existing one` has no folder to offer yet.
 */
export function folderRequest(choice: FolderChoice, rows: readonly FolderRow[]): SessionFolderChoice | null {
  if (choice.mode === "new") return choice.parent === null ? { mode: "new" } : { mode: "new", parent: choice.parent };
  const row = rows[chosenRow(rows, choice.picked)];
  return row ? { mode: "existing", path: row.path } : null;
}

/** A shell's refusal in the operator's words: its sentence, its code left out (`NO_SESSION_FOLDER: …`). */
export function refusalWords(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const sentence = message.replace(/^[A-Z][A-Z0-9_]+: /u, "").trim();
  return sentence === "" ? fallback : sentence;
}
