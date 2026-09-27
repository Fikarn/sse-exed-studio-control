// Part of the fixture double (`../fixtureTransport.ts`): the in-memory stand-in for the
// hardware link that Playwright and the browser fixture mode run against. Test-only.
import type { EventName, JsonObject } from "../../generated/protocol";
import type { PrompterAnchor } from "../../generated/snapshots/PrompterAnchor";
import type { PrompterLook } from "../../generated/snapshots/PrompterLook";
import type { PrompterParagraph } from "../../generated/snapshots/PrompterParagraph";
import type { PrompterPlace } from "../../generated/snapshots/PrompterPlace";
import { GlassClock, SPEED_DEFAULT_WPM, speedIsValid } from "./prompterClock";
import {
  MAX_SCRIPT_NAME_CHARS,
  cleanedParagraphs,
  clampedPlace,
  cloneParagraphs,
  counted,
  mapPlace,
  paragraphsKey,
  readWordCount,
  samePlace,
  sanitizeText,
} from "./prompterModel";
import { connectedScreen, type PrompterScreen } from "./prompterScreen";
import type { MutableFixtureState } from "./state";

// The prompter's saved data as the hardware link keeps it (`native/rust-engine/src/
// prompter/store.rs`, `runtime.rs` and `archive.rs`, new pages program, Slice 4): the
// scripts, their last 20 versions, the look, the take's size, what the glass shows, and
// the place saved about once a second while the text scrolls. The double never
// restarts, so what the glass shows lives only in its clock. Every scenario starts the
// same: no scripts, the standard look at 88 px, nothing on the glass, revisions 0 — and,
// from Slice 5a, the Prompter XL connected at its own size unless the scenario says
// otherwise (`prompterScreen.ts` says why the double starts there).

export const SIZE_MIN_PX = 48;
export const SIZE_MAX_PX = 160;
export const SIZE_STEP_PX = 4;
export const STANDARD_SIZE_PX = 88;
/** Each script keeps its last 20 versions. */
export const VERSIONS_KEPT = 20;
/** While the text scrolls, the place is saved at most this often. */
const SAVE_EVERY_MS = 1000;

/** Why a version was kept. */
export const VERSION_REASON = {
  imported: "imported",
  pasted: "pasted",
  putOn: "put-on",
  replaced: "replaced",
  updated: "updated",
  beforeFileUpdate: "before-file-update",
  beforeBringingBack: "before-bringing-back",
  fromBackup: "from-backup",
} as const;

export function standardLook(): PrompterLook {
  return {
    standardSizePx: STANDARD_SIZE_PX,
    lineSpacingPercent: 140,
    marginPercent: 12,
    textColour: "white",
    readingLinePercent: 35,
    readingLineAcross: false,
    dimReadText: true,
    paragraphNumbers: false,
  };
}

/** 48–160 px in 4 px steps. */
export function sizeIsValid(size: number): boolean {
  return (
    Number.isInteger(size) && size >= SIZE_MIN_PX && size <= SIZE_MAX_PX && (size - SIZE_MIN_PX) % SIZE_STEP_PX === 0
  );
}

/** Whether going from one look to the other moves the line breaks or heights, so the text is laid out again. */
export function laysOutDifferently(from: PrompterLook, to: PrompterLook): boolean {
  return (
    from.lineSpacingPercent !== to.lineSpacingPercent ||
    from.marginPercent !== to.marginPercent ||
    from.paragraphNumbers !== to.paragraphNumbers
  );
}

function sameLook(left: PrompterLook, right: PrompterLook): boolean {
  return (Object.keys(left) as Array<keyof PrompterLook>).every((key) => left[key] === right[key]);
}

/** A stored look, each out-of-range field back to the standard (`PrompterLook::from_stored`). */
function lookFromStored(look: Partial<PrompterLook>): PrompterLook {
  const standard = standardLook();
  const merged = { ...standard, ...look };
  const whole = (value: unknown) => typeof value === "number" && Number.isInteger(value);
  return {
    standardSizePx: sizeIsValid(merged.standardSizePx) ? merged.standardSizePx : standard.standardSizePx,
    lineSpacingPercent:
      whole(merged.lineSpacingPercent) &&
      merged.lineSpacingPercent >= 110 &&
      merged.lineSpacingPercent <= 200 &&
      merged.lineSpacingPercent % 10 === 0
        ? merged.lineSpacingPercent
        : standard.lineSpacingPercent,
    marginPercent:
      whole(merged.marginPercent) && merged.marginPercent >= 0 && merged.marginPercent <= 30
        ? merged.marginPercent
        : standard.marginPercent,
    textColour: merged.textColour === "yellow" ? "yellow" : "white",
    readingLinePercent:
      whole(merged.readingLinePercent) && merged.readingLinePercent >= 20 && merged.readingLinePercent <= 60
        ? merged.readingLinePercent
        : standard.readingLinePercent,
    readingLineAcross: merged.readingLineAcross === true,
    dimReadText: merged.dimReadText !== false,
    paragraphNumbers: merged.paragraphNumbers === true,
  };
}

/** A script as saved, its text included. */
export interface StoredScript {
  id: string;
  name: string;
  sourceFileName: string | null;
  paragraphs: PrompterParagraph[];
  paragraphCount: number;
  readWords: number;
  createdAt: string;
  changedAt: string;
  speedWpm: number;
  place: PrompterPlace;
  removedAt: string | null;
}

interface StoredVersion {
  id: number;
  scriptId: string;
  paragraphs: PrompterParagraph[];
  text: string;
  readWords: number;
  keptAt: string;
  reason: string;
}

export interface FixturePrompter {
  look: PrompterLook;
  sizePx: number;
  glassRevision: number;
  lookRevision: number;
  glass: GlassClock | null;
  /** The Prompter XL as the shell last reported it (Slice 5a, `runtime.rs`): kept in memory only. */
  screen: PrompterScreen;
  scripts: StoredScript[];
  /** Every script's kept versions, oldest first; the ids only grow. */
  versions: StoredVersion[];
  nextVersionId: number;
  nextScriptNumber: number;
  /** The glass script's place as last saved, and when. */
  savedPlace: PrompterPlace | null;
  savedAt: number;
  /** The clock's timer: it stops the text at `END` and says so. */
  timer: ReturnType<typeof setTimeout> | null;
  emit: ((event: EventName, payload?: JsonObject) => void) | null;
}

const prompters = new WeakMap<MutableFixtureState, FixturePrompter>();

/** The double's prompter, made the first time a scenario's double asks for it. */
export function fixturePrompter(state: MutableFixtureState): FixturePrompter {
  let prompter = prompters.get(state);
  if (!prompter) {
    prompter = {
      look: standardLook(),
      sizePx: STANDARD_SIZE_PX,
      glassRevision: 0,
      lookRevision: 0,
      glass: null,
      screen: connectedScreen(),
      scripts: [],
      versions: [],
      nextVersionId: 1,
      nextScriptNumber: 1,
      savedPlace: null,
      savedAt: Date.now(),
      timer: null,
      emit: null,
    };
    prompters.set(state, prompter);
  }
  return prompter;
}

/** Stops the double's clock timer (the transport's `dispose`). */
export function disposeFixturePrompter(state: MutableFixtureState) {
  const prompter = prompters.get(state);
  if (prompter?.timer) {
    clearTimeout(prompter.timer);
    prompter.timer = null;
  }
}

/** The saved data's clock, as the hardware link writes it: `2026-09-27T14:02:11.123Z`. */
export function nowText(now: number): string {
  return new Date(now).toISOString();
}

/** The key of the layout the view must report for the glass as it is: `g{glassRevision}-l{lookRevision}`. */
export function layoutKey(prompter: FixturePrompter): string {
  return `g${prompter.glassRevision}-l${prompter.lookRevision}`;
}

/** A new script's id: `script-` and sixteen hex digits (a counter in the double, so fixture runs repeat). */
export function newScriptId(prompter: FixturePrompter): string {
  const number = prompter.nextScriptNumber;
  prompter.nextScriptNumber += 1;
  return `script-${number.toString(16).padStart(16, "0")}`;
}

/** Every script, the removed ones included, in the order they were made. */
export function listScripts(prompter: FixturePrompter): StoredScript[] {
  return [...prompter.scripts].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  );
}

export function findScript(prompter: FixturePrompter, id: string): StoredScript | null {
  return prompter.scripts.find((script) => script.id === id) ?? null;
}

export function insertScript(
  prompter: FixturePrompter,
  script: Omit<StoredScript, "paragraphCount" | "readWords" | "createdAt" | "changedAt"> & {
    createdAt?: string;
    changedAt?: string;
  },
  now: number
): StoredScript {
  const stored: StoredScript = {
    ...script,
    paragraphs: cloneParagraphs(script.paragraphs),
    paragraphCount: script.paragraphs.length,
    readWords: readWordCount(script.paragraphs),
    createdAt: script.createdAt ?? nowText(now),
    changedAt: script.changedAt ?? nowText(now),
    place: { ...script.place },
  };
  prompter.scripts.push(stored);
  return stored;
}

/** A script's new text and the place moved with it; `changedAt` moves on. */
export function writeScriptText(
  script: StoredScript,
  paragraphs: readonly PrompterParagraph[],
  place: PrompterPlace,
  now: number
) {
  script.paragraphs = cloneParagraphs(paragraphs);
  script.paragraphCount = paragraphs.length;
  script.readWords = readWordCount(paragraphs);
  script.place = { ...place };
  script.changedAt = nowText(now);
}

export function deleteScript(prompter: FixturePrompter, id: string) {
  prompter.versions = prompter.versions.filter((version) => version.scriptId !== id);
  prompter.scripts = prompter.scripts.filter((script) => script.id !== id);
}

function insertVersion(
  prompter: FixturePrompter,
  scriptId: string,
  paragraphs: readonly PrompterParagraph[],
  keptAt: string,
  reason: string
) {
  prompter.versions.push({
    id: prompter.nextVersionId,
    scriptId,
    paragraphs: cloneParagraphs(paragraphs),
    text: paragraphsKey(paragraphs),
    readWords: readWordCount(paragraphs),
    keptAt,
    reason,
  });
  prompter.nextVersionId += 1;
}

/** Keeps `paragraphs` as the script's newest version unless the newest holds that text; the oldest past 20 go. */
export function keepVersion(
  prompter: FixturePrompter,
  scriptId: string,
  paragraphs: readonly PrompterParagraph[],
  reason: string,
  now: number
) {
  const own = prompter.versions.filter((version) => version.scriptId === scriptId);
  if (own[own.length - 1]?.text === paragraphsKey(paragraphs)) return;
  insertVersion(prompter, scriptId, paragraphs, nowText(now), reason);
  const kept = new Set([...own.map((version) => version.id), prompter.nextVersionId - 1].slice(-VERSIONS_KEPT));
  prompter.versions = prompter.versions.filter((version) => version.scriptId !== scriptId || kept.has(version.id));
}

/** Whether any kept version of the script holds exactly this text. */
export function hasVersionWith(prompter: FixturePrompter, scriptId: string, paragraphs: readonly PrompterParagraph[]) {
  const text = paragraphsKey(paragraphs);
  return prompter.versions.some((version) => version.scriptId === scriptId && version.text === text);
}

/** The script's kept versions, newest first. */
export function listVersions(prompter: FixturePrompter, scriptId: string): StoredVersion[] {
  return prompter.versions.filter((version) => version.scriptId === scriptId).reverse();
}

export function readVersion(
  prompter: FixturePrompter,
  scriptId: string,
  versionId: number
): PrompterParagraph[] | null {
  const version = prompter.versions.find((entry) => entry.scriptId === scriptId && entry.id === versionId);
  return version ? cloneParagraphs(version.paragraphs) : null;
}

// ---------------------------------------------------------------------------
// The place, the stop at END and the clock's timer (`runtime.rs`)
// ---------------------------------------------------------------------------

/** Saves the glass script's place at `now` when it moved since the last save. */
export function savePlace(prompter: FixturePrompter, now: number) {
  if (prompter.glass) saveThisPlace(prompter, prompter.glass.placeAt(now));
  prompter.savedAt = now;
}

/** Saves `place` as the glass script's place (`save_this_place`), when it is not the one saved last. */
export function saveThisPlace(prompter: FixturePrompter, place: PrompterPlace) {
  const glass = prompter.glass;
  if (!glass || samePlace(prompter.savedPlace, place)) return;
  const script = findScript(prompter, glass.scriptId);
  if (script) script.place = { ...place };
  prompter.savedPlace = { ...place };
}

/** The glass has another script, or none: its place counts as saved. */
export function placeSavedAs(prompter: FixturePrompter, place: PrompterPlace | null, now: number) {
  prompter.savedPlace = place ? { ...place } : null;
  prompter.savedAt = now;
}

export function glassAnchor(prompter: FixturePrompter, now: number): PrompterAnchor | null {
  return prompter.glass ? prompter.glass.anchor(now) : null;
}

/**
 * Stops the text at `END` if it got there — and says so with `prompter.changed { reason:
 * "at-end" }`, whoever noticed first, the clock's timer or a request (review of
 * 2026-09-27: a request that noticed first kept it to itself) — and saves the place when
 * a second has passed.
 */
export function settlePrompter(prompter: FixturePrompter, now: number) {
  const glass = prompter.glass;
  if (!glass) return;
  const stopped = glass.settle(now);
  if (stopped) prompter.emit?.("prompter.changed", { reason: "at-end", anchor: glass.anchor(now) });
  if (stopped || (glass.playing && now - prompter.savedAt >= SAVE_EVERY_MS)) savePlace(prompter, now);
}

/**
 * The live app's clock thread, as a timer: while the text scrolls it wakes at `END` or
 * after a second, whichever is sooner (`next_wake`), so the text stops at `END` and says
 * so, and the place is saved about once a second — laid out or not. Every request
 * settles the clock first, as the hardware link does, and schedules this again.
 */
export function schedulePrompterClock(prompter: FixturePrompter) {
  if (prompter.timer !== null) {
    clearTimeout(prompter.timer);
    prompter.timer = null;
  }
  const glass = prompter.glass;
  if (!glass || !glass.playing) return;
  const untilEnd = glass.timeToEndMs(Date.now());
  const wait = Math.min(untilEnd === null ? SAVE_EVERY_MS : Math.ceil(untilEnd) + 1, SAVE_EVERY_MS);
  prompter.timer = setTimeout(() => {
    prompter.timer = null;
    settlePrompter(prompter, Date.now());
    schedulePrompterClock(prompter);
  }, wait);
}

// ---------------------------------------------------------------------------
// The backup archive's part (format 6, `archive.rs`)
// ---------------------------------------------------------------------------

export interface ArchivedScript {
  id: string;
  name: string;
  sourceFileName: string | null;
  paragraphs: PrompterParagraph[];
  createdAt: string;
  changedAt: string;
  speedWpm: number;
  place: PrompterPlace;
  removedAt: string | null;
  /** Oldest first. */
  versions: Array<{ paragraphs: PrompterParagraph[]; keptAt: string; reason: string }>;
}

export interface PrompterArchive {
  look: PrompterLook;
  sizePx: number;
  scripts: ArchivedScript[];
}

/**
 * The scripts with their versions, places and speeds, the removed ones, the look and the
 * size. The script on the glass keeps its place in the glass's text; when it was edited
 * since it went on, the archive carries the place in its own text (review of 2026-09-27).
 */
export function buildPrompterArchive(prompter: FixturePrompter): PrompterArchive {
  const glass = prompter.glass;
  const placeOf = (script: StoredScript): PrompterPlace =>
    glass !== null &&
    glass.scriptId === script.id &&
    paragraphsKey(glass.paragraphs) !== paragraphsKey(script.paragraphs)
      ? mapPlace(glass.paragraphs, script.paragraphs, script.place)[0]
      : { ...script.place };
  return {
    look: { ...prompter.look },
    sizePx: prompter.sizePx,
    scripts: listScripts(prompter).map((script) => ({
      id: script.id,
      name: script.name,
      sourceFileName: script.sourceFileName,
      paragraphs: cloneParagraphs(script.paragraphs),
      createdAt: script.createdAt,
      changedAt: script.changedAt,
      speedWpm: script.speedWpm,
      place: placeOf(script),
      removedAt: script.removedAt,
      versions: prompter.versions
        .filter((version) => version.scriptId === script.id)
        .map((version) => ({
          paragraphs: cloneParagraphs(version.paragraphs),
          keptAt: version.keptAt,
          reason: version.reason,
        })),
    })),
  };
}

function atLeastOneParagraph(paragraphs: readonly PrompterParagraph[]): PrompterParagraph[] {
  const cleaned = cleanedParagraphs(paragraphs);
  return cleaned.length > 0 ? cleaned : [{ runs: [] }];
}

function restoredName(name: string): string {
  const collapsed = sanitizeText(name)
    .split(/\s+/u)
    .filter((word) => word !== "")
    .join(" ");
  const kept = Array.from(collapsed).slice(0, MAX_SCRIPT_NAME_CHARS).join("").trim();
  return kept === "" ? "Restored script" : kept;
}

export interface PrompterRestoreOutcome {
  /** Scripts the saved data did not have. */
  added: number;
  /** Scripts it had whose archived text came back as an earlier version. */
  earlierVersions: number;
}

/**
 * An archive restore's part for the prompter: the archive's scripts and look when it
 * has a prompter part (format 6), then the prompter paused at once where it is,
 * keeping its place — a restore never scrolls, and never changes what the glass shows
 * — with the look it brought back (`restore_prompter_archive`, then
 * `after_archive_restore`). The outcome is `null` for an archive without the part.
 */
export function restoreFromArchive(
  prompter: FixturePrompter,
  archive: PrompterArchive | null,
  now: number
): PrompterRestoreOutcome | null {
  settlePrompter(prompter, now);
  let stored = { look: prompter.look, sizePx: prompter.sizePx, lookRevision: prompter.lookRevision };
  let outcome: PrompterRestoreOutcome | null = null;
  if (archive) {
    const look = lookFromStored(archive.look);
    const size = sizeIsValid(archive.sizePx) ? archive.sizePx : STANDARD_SIZE_PX;
    if (!sameLook(look, prompter.look) || size !== prompter.sizePx) {
      const relayout = laysOutDifferently(prompter.look, look) || prompter.sizePx !== size;
      stored = { look, sizePx: size, lookRevision: prompter.lookRevision + (relayout ? 1 : 0) };
    }
    outcome = restoreScripts(prompter, archive, now);
  }
  const glass = prompter.glass;
  glass?.hold(now);
  savePlace(prompter, now);
  const relayout = laysOutDifferently(stored.look, prompter.look) || stored.sizePx !== prompter.sizePx;
  prompter.look = stored.look;
  prompter.sizePx = stored.sizePx;
  prompter.lookRevision = stored.lookRevision;
  if (relayout && glass) glass.relayout(now, layoutKey(prompter));
  schedulePrompterClock(prompter);
  return outcome;
}

/** A script the double lacks comes back whole; one it has keeps its text, and a differing archived text is kept as an earlier version. */
function restoreScripts(prompter: FixturePrompter, archive: PrompterArchive, now: number): PrompterRestoreOutcome {
  const outcome: PrompterRestoreOutcome = { added: 0, earlierVersions: 0 };
  for (const archived of archive.scripts) {
    if (archived.id.trim() === "") continue;
    const paragraphs = atLeastOneParagraph(archived.paragraphs);
    const existing = findScript(prompter, archived.id);
    if (existing) {
      const differs = paragraphsKey(existing.paragraphs) !== paragraphsKey(paragraphs);
      if (differs && !hasVersionWith(prompter, archived.id, paragraphs)) {
        keepVersion(prompter, archived.id, paragraphs, VERSION_REASON.fromBackup, now);
        outcome.earlierVersions += 1;
      }
      continue;
    }
    insertScript(
      prompter,
      {
        id: archived.id,
        name: restoredName(archived.name),
        sourceFileName: archived.sourceFileName,
        paragraphs,
        speedWpm: speedIsValid(archived.speedWpm) ? archived.speedWpm : SPEED_DEFAULT_WPM,
        place: clampedPlace(archived.place, paragraphs),
        createdAt: archived.createdAt,
        changedAt: archived.changedAt,
        removedAt: archived.removedAt,
      },
      now
    );
    for (const version of archived.versions.slice(-VERSIONS_KEPT)) {
      insertVersion(prompter, archived.id, atLeastOneParagraph(version.paragraphs), version.keptAt, version.reason);
    }
    outcome.added += 1;
  }
  return outcome;
}

/** The restore's sentence on the scripts, when it did anything with them. */
export function prompterRestoreSentence(outcome: PrompterRestoreOutcome): string | null {
  const parts: string[] = [];
  if (outcome.added > 0) parts.push(`${counted(outcome.added, "script", "scripts")} added to the Teleprompter`);
  if (outcome.earlierVersions > 0) {
    parts.push(
      `${counted(outcome.earlierVersions, "script", "scripts")} came back as an earlier version of a script already here`
    );
  }
  if (parts.length === 0) return null;
  const sentence = parts.join("; ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}
