import type { Session, SessionKind, SessionSnapshot } from "@sse/engine-client";

import type { OverviewState, OverviewWayOut } from "../overview/overviewModel";
import { kindOf } from "./kinds";

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

/** Begin's hint: `opens the Overview`, or `ends the podcast recording · opens the Overview` while another kind runs. */
export function beginHint(other: Session | null): string {
  if (!other) return "opens the Overview";
  return `ends the ${kindOf(other.kind)?.inSentence ?? "running session"} · opens the Overview`;
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
