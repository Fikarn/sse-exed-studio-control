// Part of the fixture double (`../fixtureTransport.ts`): the in-memory stand-in for the
// hardware link that Playwright and the browser fixture mode run against. Test-only.
import type { Session } from "../../generated/snapshots/Session";
import type { SessionFolderEntry } from "../../generated/snapshots/SessionFolderEntry";
import type { SessionKind } from "../../generated/snapshots/SessionKind";
import type { SessionSettings } from "../../generated/snapshots/SessionSettings";
import type { SessionVmixState } from "../../generated/snapshots/SessionVmixState";
import type { MutableFixtureState } from "./state";

// The session as the hardware link keeps it (the Session page, 2026-10-15;
// `native/rust-engine/src/session.rs`): the running session, the last of each kind, newest
// first, and since step 2 (D52) the settings for the sessions' folders, the places, and the
// double's own disk, which is data: the folders it knows are there, and the drives. What the
// hardware link's sessions' watch reads (`watch.rs`) is data here too: the drives' space, the
// sessions' folder's newest folders, vMix's word, and when they were read. The hardware link
// keeps the session in settings outside the archive; the double keeps it beside its state, so
// an archive's restore leaves it alone here too. The other session modules import this one,
// and it imports none of them.

/** A drive of the double's disk, as the watch's last read found it (`SessionDrive`). */
export interface FixtureDrive {
  name: string;
  mapped: boolean;
  /** It answered the last read: a begin on one that did not is refused at once. */
  answering: boolean;
  freeBytes: number;
  totalBytes: number;
}

/** The double's disk: the folders it knows are there, by their paths in lower case (Windows
 *  does not tell capitals apart), and the drives by their letters. */
export interface FixtureDisk {
  folders: Map<string, string>;
  drives: Map<string, FixtureDrive>;
}

/** vMix as its API last answered the studio's build (`SessionVmix`, less what the snapshot
 *  works out: whether its file is in the session's folder, and where vMix should record). */
export interface FixtureVmix {
  state: Exclude<SessionVmixState, "simulated">;
  recording: boolean;
  file: string | null;
  bytesPerSecond: number | null;
}

export interface FixtureSession {
  current: Session | null;
  last: Session[];
  settings: SessionSettings;
  /** The run keeps its sessions' folders in `scratchRoot` (`places.simulated`), and never
   *  reads vMix. */
  simulated: boolean;
  scratchRoot: string;
  disk: FixtureDisk;
  /** The sessions' folder's newest folders, newest first, as the watch lists them. */
  recent: SessionFolderEntry[];
  vmix: FixtureVmix;
  /** When the double's disks were read: its start, and each change a test made. */
  readAt: string;
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

/** Explorer's GB, and the thresholds': 1024³ bytes (`drives.rs`' `GIB`). */
export const GIB = 1024 ** 3;

/** How many of the sessions' folder's newest folders the watch reads (`RECENT_FOLDERS`). */
export const RECENT_FOLDERS = 6;

/** The drives of the double's disk, by their letters: the studio PC's, with D: well above
 *  Low (2.00 TB free of 3.73 TB, as Explorer writes it). */
export const FIXTURE_DRIVES: Readonly<Record<string, FixtureDrive>> = {
  C: { name: "Local Disk", mapped: false, answering: true, freeBytes: 1_628 * GIB, totalBytes: 3_901 * GIB },
  D: { name: "Storage 1", mapped: false, answering: true, freeBytes: 2_200_414_797_824, totalBytes: 4_096_787_476_480 },
  E: { name: "A015", mapped: false, answering: true, freeBytes: 308 * GIB, totalBytes: 931 * GIB },
  Z: { name: "Public", mapped: true, answering: true, freeBytes: 3_789 * GIB, totalBytes: 17_818 * GIB },
};

/** vMix as the studio's build reads it a moment after its start: answering, not recording,
 *  and no file named yet. */
export function defaultFixtureVmix(): FixtureVmix {
  return { state: "answering", recording: false, file: null, bytesPerSecond: null };
}

/** The settings as new saved data reads them (`settings.rs`' defaults, D52). */
export function defaultSessionSettings(): SessionSettings {
  return {
    root: "D:\\Sessions",
    subfolders: {
      "green-screen": ["Video", "vMix Recording", "Script", "Exports"],
      podcast: ["Audio", "Video", "vMix Recording", "Exports"],
      webinar: ["Slides", "vMix Recording", "Exports"],
    },
    lowBelowGb: 200,
    nearlyFullBelowGb: 50,
  };
}

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

/**
 * The double's session, made the first time a scenario's double asks for it: none running,
 * no last, the default settings, the studio's places (`places.simulated` false: the pages
 * show what the studio's build shows), a disk with the studio PC's drives and no folder, and
 * vMix answering, read at once.
 */
export function fixtureSession(state: MutableFixtureState): FixtureSession {
  let session = sessions.get(state);
  if (!session) {
    session = {
      current: null,
      last: [],
      settings: defaultSessionSettings(),
      simulated: false,
      scratchRoot: "",
      disk: {
        folders: new Map(),
        drives: new Map(Object.entries(FIXTURE_DRIVES).map(([letter, drive]) => [letter, { ...drive }])),
      },
      recent: [],
      vmix: defaultFixtureVmix(),
      readAt: new Date().toISOString(),
    };
    sessions.set(state, session);
  }
  return session;
}
