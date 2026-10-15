// Part of the fixture double (`../fixtureTransport.ts`): the in-memory stand-in for the
// hardware link that Playwright and the browser fixture mode run against. Test-only.
import type { Session } from "../../generated/snapshots/Session";
import type { SessionKind } from "../../generated/snapshots/SessionKind";
import type { FixtureSessionSeed } from "../../types";
import type { MutableFixtureState } from "./state";

// The session as the hardware link keeps it (the Session page, 2026-10-15;
// `native/rust-engine/src/session.rs`): the running session, and the last of each kind,
// newest first. The hardware link keeps them in two settings outside the archive; the
// double keeps them beside its state, so an archive's restore leaves them alone here too.

export interface FixtureSession {
  current: Session | null;
  last: Session[];
}

/** The kinds, in the page's order (`SessionKind::ALL`). */
export const SESSION_KINDS: readonly SessionKind[] = ["green-screen", "podcast", "webinar"];

/** The kinds in the operator's words, as the action log's sentence says them (`SessionKind::name`). */
export const SESSION_KIND_NAMES: Readonly<Record<SessionKind, string>> = {
  "green-screen": "Green Screen Recording",
  podcast: "Podcast Recording",
  webinar: "Webinar",
};

/** The most characters a session's name has, after trimming (`NAME_MAX_CHARACTERS`). */
export const SESSION_NAME_MAX_CHARACTERS = 80;

// Rust's `str::trim`: the characters with Unicode's White_Space property. JavaScript's own
// `trim` differs by two (it takes U+FEFF and leaves U+0085), so the double spells them out.
const WHITE_SPACE = "[\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";
const EDGES = new RegExp(`^${WHITE_SPACE}+|${WHITE_SPACE}+$`, "g");

/** A name as the hardware link keeps it: trimmed at both ends. */
export function trimmedName(name: string): string {
  return name.replace(EDGES, "");
}

/** How many characters a name has, counted as Rust's `chars().count()` counts them. */
export function nameCharacters(name: string): number {
  return [...name].length;
}

export function isSessionKind(value: unknown): value is SessionKind {
  return SESSION_KINDS.some((kind) => kind === value);
}

/** The first session of each kind, in the order given: the list is kept newest first. */
export function oneOfEachKind(sessions: readonly Session[]): Session[] {
  const kinds = new Set<SessionKind>();
  return sessions.filter((session) => {
    const first = !kinds.has(session.kind);
    kinds.add(session.kind);
    return first;
  });
}

const sessions = new WeakMap<MutableFixtureState, FixtureSession>();

/** The double's session, made the first time a scenario's double asks for it: none running, no last. */
export function fixtureSession(state: MutableFixtureState): FixtureSession {
  let session = sessions.get(state);
  if (!session) {
    session = { current: null, last: [] };
    sessions.set(state, session);
  }
  return session;
}

// The scenario's session is checked as the hardware link would read its settings, and a
// session it would not read is the scenario's mistake, and says so.
const mistake = (message: string) => new Error(`session: ${message}`);

const SEED_KEYS = ["current", "last"] as const;
const SESSION_KEYS = ["kind", "name", "begunAt", "endedAt"] as const;

function onlyKeys(object: object, known: readonly string[], where: string) {
  const unknown = Object.keys(object).filter((key) => !known.includes(key));
  if (unknown.length > 0) throw mistake(`${where} has ${unknown.join(", ")}, which a seed does not have.`);
}

/** A time as the hardware link writes it: UTC, `2026-10-15T07:16:00.000Z`. */
function isUtcText(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

function checkedSession(value: unknown, where: string, ended: boolean): Session {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw mistake(`${where} must be an object.`);
  onlyKeys(value, SESSION_KEYS, where);
  const { kind, name, begunAt, endedAt } = value as Record<string, unknown>;
  if (!isSessionKind(kind)) throw mistake(`${where}'s kind must be one of ${SESSION_KINDS.join(", ")}.`);
  if (typeof name !== "string" || trimmedName(name) !== name) throw mistake(`${where}'s name must be trimmed text.`);
  if (nameCharacters(name) > SESSION_NAME_MAX_CHARACTERS) {
    throw mistake(`${where}'s name has more than ${SESSION_NAME_MAX_CHARACTERS} characters.`);
  }
  if (!isUtcText(begunAt)) throw mistake(`${where}'s begunAt must be a UTC time as the hardware link writes it.`);
  if (ended ? !isUtcText(endedAt) : endedAt !== null && endedAt !== undefined) {
    throw mistake(ended ? `${where}'s endedAt must be a UTC time.` : `${where} runs: its endedAt is null.`);
  }
  return { kind, name, begunAt, endedAt: ended ? (endedAt as string) : null };
}

/** Builds the scenario's session on the double, before its first read. */
export function seedFixtureSession(state: MutableFixtureState, seed: FixtureSessionSeed | undefined) {
  if (seed === undefined) return;
  if (seed === null || typeof seed !== "object" || Array.isArray(seed)) throw mistake("the seed must be an object.");
  onlyKeys(seed, SEED_KEYS, "the seed");
  const session = fixtureSession(state);
  if (seed.current !== undefined) session.current = checkedSession(seed.current, "current", false);
  if (seed.last !== undefined) {
    if (!Array.isArray(seed.last)) throw mistake("last must be a list.");
    const last = seed.last.map((entry, index) => checkedSession(entry, `last[${index}]`, true));
    if (oneOfEachKind(last).length !== last.length) throw mistake("last holds one session of each kind at most.");
    session.last = last;
  }
}
