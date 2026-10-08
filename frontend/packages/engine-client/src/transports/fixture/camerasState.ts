// Part of the fixture double (`../fixtureTransport.ts`): the in-memory stand-in for the
// hardware link that Playwright and the browser fixture mode run against. Test-only.
import type { CameraChoice } from "../../generated/snapshots/CameraChoice";
import type { CameraDialBank } from "../../generated/snapshots/CameraDialBank";
import type { CameraDials } from "../../generated/snapshots/CameraDials";
import type { CameraHealthEntry } from "../../generated/snapshots/CameraHealthEntry";
import type { CameraLevel } from "../../generated/snapshots/CameraLevel";
import type { CameraPairing } from "../../generated/snapshots/CameraPairing";
import type { CameraPicture } from "../../generated/snapshots/CameraPicture";
import type { CameraRecentAction } from "../../generated/snapshots/CameraRecentAction";
import type { CameraSetupSummary } from "../../generated/snapshots/CameraSetupSummary";
import type { CameraSnapshot } from "../../generated/snapshots/CameraSnapshot";
import type { CameraState } from "../../generated/snapshots/CameraState";
import type { CameraValues } from "../../generated/snapshots/CameraValues";
import type { CamerasHealthCheck } from "../../generated/snapshots/CamerasHealthCheck";
import type { CamerasPictures } from "../../generated/snapshots/CamerasPictures";
import type { CamerasSnapshot } from "../../generated/snapshots/CamerasSnapshot";
import type { PicturePlaces } from "../picturesLink";
import {
  CAMERA_NUMBERS,
  CHOICE_SETTINGS,
  DIAL_BANK_SETS,
  LEVEL_SETTINGS,
  cameraModel,
  isReported,
  type CameraNumber,
  type ChoiceSetting,
  type LevelSetting,
} from "./camerasModel";
import {
  NO_PICTURES_SENTENCE,
  PICTURE_MISSING_DETAIL,
  PICTURE_SHOWING_DETAIL,
  PICTURE_WORDS,
  SIMULATED_VMIX_INPUTS,
  STATE_RANK,
  STATE_TONES,
  STATE_WORDS,
  VMIX_NOT_SENDING_ADVICE,
  VMIX_OUTPUTS,
  heldSentence,
  lastReadSentence,
  noLinkRefusalSentence,
  noLinkSentence,
  notSetUpSentence,
  pictureMissingAdvice,
  pictureMissingSentence,
  pictureSourceWords,
  picturesMissingSentence,
  picturesNote,
  releasedSentence,
  unreachableSentence,
  vmixNothingDetail,
} from "./camerasWords";
import type { MutableFixtureState } from "./state";

// The cameras as the hardware link holds them (`native/rust-engine/src/cameras/`, new pages
// program, Slice 8): Setup's part in the saved data (an address or a pairing, and the vMix
// input), who holds each camera (D13: held, or released in memory until it is connected
// again), the selection (D19: CAM 1 after a start), and what each camera last reported.
//
// Each camera's link is the simulated one — the double stands for every test, lane and
// scratch run (`SSE_CAMERAS_SIMULATED=1`) — unless a scenario says `simulated: false`, as
// the studio's build is: CAM 1's link is built there (the Pocket's pairing, 2026-10-06), and
// CAM 2's and CAM 3's are not until Slice 13, so Setup takes no address for them
// (`CAMERA_NO_LINK`) and each reads NOT SET UP and says there is no link to it yet; one the
// saved data holds all the same reads UNREACHABLE with that sentence. The double has no
// Pocket: there a pairing looks for CAM 1 and finds nothing, and a paired CAM 1 does not
// answer. The simulated camera ("the body") holds its own values, answers or not,
// and counts what it is sent (D12: nothing is sent by itself); the hardware link reads it
// and keeps what it read. A held camera that answers is read before every request; one
// that stops answering keeps what it last reported and when (`readAt`), as doubt; a
// released or never-read camera has no values.

/** What a camera reports, or `null` where it does not (or does not record here). */
export interface CameraReport {
  choices: Record<ChoiceSetting, string | null>;
  levels: Record<LevelSetting, number | null>;
  displayLutOn: boolean | null;
  recording: boolean | null;
}

/** The simulated camera inside the hardware link: no network, no radio. */
export interface SimulatedCamera {
  report: CameraReport;
  answering: boolean;
  /** Reports its settings when read; `false` reads as a link that has brought no setting since it connected (finding 19). */
  reporting: boolean;
  /** How many commands it has been sent (D12: only a press sends). */
  sent: number;
}

/** What the hardware link read from a camera, and when. */
export interface CameraRead {
  report: CameraReport;
  /** Its timecode when it was read, if it reports one. */
  timecode: string | null;
  at: number;
}

/** Why a camera did not answer the last time it was read: it did not, or there is no link to it yet. */
export type LinkFailure = "no-answer" | "no-link";

/** The hardware link's side of one camera (`CameraRuntime`). */
export interface HeldCamera {
  /** CAM 2's or CAM 3's address; `null` for CAM 1 and until it is entered. */
  address: string | null;
  /** CAM 1 is paired. */
  paired: boolean;
  vmixInput: number;
  /** Handed back to the iPad or LUMIX Tether, in memory only. */
  released: boolean;
  /** What it last reported, and when; `null` when never read since the start, or released. */
  read: CameraRead | null;
  /** Its values are the last read, not what it reports now: its link has brought no setting since it connected (finding 19). */
  lastRead: boolean;
  /** Why it did not answer the last time it was read; `null` while it answers. */
  failure: LinkFailure | null;
  /** When the hardware link saw the take start; `null` when it started before it looked. */
  startedAt: number | null;
  /** CAM 1's pairing while it runs, or why the last one failed; `null` otherwise. */
  pairing: CameraPairing | null;
}

/** What reading a camera again found (`Transition`): each is a `cameras.changed` reason. */
export type Transition = "reported" | "unreachable" | "reachable";

export interface FixtureCameras {
  /** The simulated link (`SSE_CAMERAS_SIMULATED=1`); without it no camera has a link yet. */
  simulated: boolean;
  selected: CameraNumber;
  /** What the deck's dials set on the selected camera (D14); `exposure` after a start. */
  bank: CameraDialBank;
  /** The action log cannot be read (a test hook): `cameras.snapshot` answers `recent: null`. */
  recentUnreadable: boolean;
  /** How many times the page said it shows the pictures (`cameras.pictures.showing`), for the tests. */
  showingSaid: number;
  /** How many takes the page made, each for the three cameras (`picturesDouble.ts`), for the tests. */
  picturesPulled: number;
  /** How many times the page said where its pictures stand, and what it said last, for the tests. */
  placesSaid: number;
  places: PicturePlaces | null;
  held: Record<CameraNumber, HeldCamera>;
  bodies: Record<CameraNumber, SimulatedCamera>;
}

/** What the simulated camera starts with (board 2). */
export function startingReport(camera: CameraNumber): CameraReport {
  const model = cameraModel(camera);
  const choices = {} as Record<ChoiceSetting, string | null>;
  for (const setting of CHOICE_SETTINGS) {
    const choice = model.choices[setting];
    choices[setting] = isReported(choice) ? choice.start : null;
  }
  const levels = {} as Record<LevelSetting, number | null>;
  for (const setting of LEVEL_SETTINGS) {
    const level = model.levels[setting];
    levels[setting] = isReported(level) ? level.start : null;
  }
  return {
    choices,
    levels,
    displayLutOn: isReported(model.displayLutOn) ? model.displayLutOn.start : null,
    recording: model.records ? false : null,
  };
}

function cloneReport(report: CameraReport): CameraReport {
  return {
    choices: { ...report.choices },
    levels: { ...report.levels },
    displayLutOn: report.displayLutOn,
    recording: report.recording,
  };
}

/** New saved data holds none (D15 rule 1): every camera not set up, its vMix input its number. */
function notSetUp(camera: CameraNumber): HeldCamera {
  return {
    address: null,
    paired: false,
    vmixInput: camera,
    released: false,
    read: null,
    lastRead: false,
    failure: null,
    startedAt: null,
    pairing: null,
  };
}

const doubles = new WeakMap<MutableFixtureState, FixtureCameras>();

/** The double's cameras, made the first time a scenario's double asks for them. */
export function fixtureCameras(state: MutableFixtureState): FixtureCameras {
  let cameras = doubles.get(state);
  if (!cameras) {
    cameras = {
      simulated: true,
      selected: 1,
      bank: "exposure",
      recentUnreadable: false,
      showingSaid: 0,
      picturesPulled: 0,
      placesSaid: 0,
      places: null,
      held: { 1: notSetUp(1), 2: notSetUp(2), 3: notSetUp(3) },
      bodies: {
        1: { report: startingReport(1), answering: true, reporting: true, sent: 0 },
        2: { report: startingReport(2), answering: true, reporting: true, sent: 0 },
        3: { report: startingReport(3), answering: true, reporting: true, sent: 0 },
      },
    };
    doubles.set(state, cameras);
  }
  return cameras;
}

/**
 * Whether this build can reach the camera at all (`real_link::has_link`): through the simulated
 * link, or CAM 1 through its own on Windows, as the studio's build is.
 */
export function hasLink(cameras: FixtureCameras, camera: CameraNumber): boolean {
  return cameras.simulated || camera === 1;
}

/** CAM 1 once it is paired, CAM 2 and CAM 3 once their address is entered. */
export function isSetUp(cameras: FixtureCameras, camera: CameraNumber): boolean {
  const held = cameras.held[camera];
  return camera === 1 ? held.paired : held.address !== null;
}

export function cameraState(cameras: FixtureCameras, camera: CameraNumber): CameraState {
  if (!isSetUp(cameras, camera)) return "not-set-up";
  if (cameras.held[camera].released) return "released";
  return cameras.held[camera].failure !== null ? "unreachable" : "held";
}

/** An unreachable camera's sentence: it does not answer, or there is no link to it yet. */
export function unreachableSentenceOf(cameras: FixtureCameras, camera: CameraNumber): string {
  const model = cameraModel(camera);
  return cameras.held[camera].failure === "no-link"
    ? noLinkSentence(model)
    : unreachableSentence(model, cameras.held[camera].address);
}

export function cameraSentence(cameras: FixtureCameras, camera: CameraNumber): string {
  const model = cameraModel(camera);
  switch (cameraState(cameras, camera)) {
    case "held":
      return cameras.held[camera].lastRead && cameras.held[camera].read !== null
        ? lastReadSentence(model)
        : heldSentence(model);
    case "released":
      return releasedSentence(model);
    case "not-set-up":
      return notSetUpSentence(model, hasLink(cameras, camera));
    case "unreachable":
      return unreachableSentenceOf(cameras, camera);
  }
}

/** A time-of-day timecode at 25 frames a second, `HH:MM:SS:FF`, from the double's clock (UTC). */
export function timecodeAt(now: number): string {
  const date = new Date(now);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${two(date.getUTCHours())}:${two(date.getUTCMinutes())}:${two(date.getUTCSeconds())}:${two(
    Math.floor(date.getUTCMilliseconds() / 40)
  )}`;
}

/** The same values, whatever the timecode says: a timecode that moved is not a change the camera made. */
function sameValues(left: CameraReport, right: CameraReport): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** What a camera's link answers (`LinkReading`): what it reports, and whether that is the last read (finding 19). */
interface LinkRead {
  report: CameraReport;
  lastRead: boolean;
}

/** What the camera's link answers: what it reports, or why it does not. */
function linkRead(cameras: FixtureCameras, camera: CameraNumber): LinkRead | LinkFailure {
  // The studio's build: CAM 1's link has no Pocket to reach here; the others have no link.
  if (!cameras.simulated) return camera === 1 ? "no-answer" : "no-link";
  const body = cameras.bodies[camera];
  return body.answering ? { report: cloneReport(body.report), lastRead: !body.reporting } : "no-answer";
}

/**
 * Reads a set-up camera that is not released (`Cameras::read`), and says what changed: a
 * value it changed itself, a held camera that stopped answering — it keeps what it last
 * reported, and when (D19) — or one that answers again. A take it reports that it did not
 * report at the last answer started while the hardware link looked (`startedAt`); one
 * running at the first answer after a start, a connect or an unreachable spell started
 * before it looked.
 */
export function readCamera(cameras: FixtureCameras, camera: CameraNumber, now: number): Transition | null {
  const held = cameras.held[camera];
  if (!isSetUp(cameras, camera) || held.released) return null;
  const wasUnreachable = held.failure !== null;
  const link = linkRead(cameras, camera);
  if (typeof link === "string") {
    held.failure = link;
    return wasUnreachable ? null : "unreachable";
  }
  const last = held.read;
  // A link that has brought no setting since it connected: what the camera last reported,
  // and when, stays as the last read, the timecode alone following (finding 19).
  const lastRead = link.lastRead && last !== null;
  const read = link.lastRead && last !== null ? last.report : link.report;
  const changed = last !== null && !sameValues(last.report, read);
  const answeredBefore = last !== null && !wasUnreachable;
  const was = last?.report.recording ?? null;
  held.startedAt =
    read.recording === true && answeredBefore && was === true
      ? held.startedAt
      : read.recording === true && answeredBefore && was === false
        ? now
        : null;
  held.read = {
    report: read,
    timecode: cameraModel(camera).timecodeReported ? timecodeAt(now) : null,
    at: link.lastRead && last !== null ? last.at : now,
  };
  held.lastRead = lastRead;
  held.failure = null;
  return wasUnreachable ? "reachable" : changed ? "reported" : null;
}

/** Reads every held (and every unreachable) camera again; what changed, camera by camera. */
export function readHeldCameras(cameras: FixtureCameras, now: number): Array<[CameraNumber, Transition]> {
  return CAMERA_NUMBERS.flatMap((camera) => {
    const transition = readCamera(cameras, camera, now);
    return transition === null ? [] : [[camera, transition] as [CameraNumber, Transition]];
  });
}

/** Stops reading it: what it reported is no longer shown (a release, or a camera whose setup changed). */
export function forgetRead(cameras: FixtureCameras, camera: CameraNumber) {
  const held = cameras.held[camera];
  held.read = null;
  held.lastRead = false;
  held.failure = null;
  held.startedAt = null;
}

/** What the camera last reported; `null` when it has not been read since the start, or it is released. */
export function lastReport(cameras: FixtureCameras, camera: CameraNumber): CameraReport | null {
  return cameras.held[camera].read?.report ?? null;
}

export function setupSummary(cameras: FixtureCameras, camera: CameraNumber): CameraSetupSummary {
  const held = cameras.held[camera];
  return {
    setUp: isSetUp(cameras, camera),
    address: camera === 1 ? null : held.address,
    paired: camera === 1 ? held.paired : false,
    vmixInput: held.vmixInput,
    vmixOutput: VMIX_OUTPUTS[camera - 1]!,
    noLink: hasLink(cameras, camera) ? null : noLinkRefusalSentence(cameraModel(camera)),
    pairing: held.pairing === null ? null : { ...held.pairing },
  };
}

function cameraValues(camera: CameraNumber, report: CameraReport | null): CameraValues {
  const model = cameraModel(camera);
  const choice = (setting: ChoiceSetting): CameraChoice => {
    const entry = model.choices[setting];
    if (!isReported(entry)) {
      return { reported: false, value: null, options: [], unavailable: [], notReported: entry.notReported };
    }
    const resolution = report?.choices.resolution ?? null;
    return {
      reported: true,
      value: report?.choices[setting] ?? null,
      options: [...entry.options],
      unavailable:
        setting === "frameRate" && resolution !== null
          ? (model.unavailableFrameRates[resolution] ?? []).map((unavailable) => ({ ...unavailable }))
          : [],
      notReported: null,
    };
  };
  const level = (setting: LevelSetting): CameraLevel => {
    const entry = model.levels[setting];
    if (!isReported(entry)) {
      return { reported: false, value: null, min: 0, max: 0, step: 0, unit: "", notReported: entry.notReported };
    }
    return {
      reported: true,
      value: report?.levels[setting] ?? null,
      min: entry.min,
      max: entry.max,
      step: entry.step,
      unit: entry.unit,
      notReported: null,
    };
  };
  const lutOn = model.displayLutOn;
  return {
    iso: choice("iso"),
    shutter: choice("shutter"),
    iris: choice("iris"),
    nd: choice("nd"),
    whiteBalance: level("whiteBalance"),
    tint: level("tint"),
    focus: level("focus"),
    resolution: choice("resolution"),
    frameRate: choice("frameRate"),
    dynamicRange: choice("dynamicRange"),
    displayLut: choice("displayLut"),
    displayLutOn: isReported(lutOn)
      ? { reported: true, value: report?.displayLutOn ?? null, notReported: null }
      : { reported: false, value: null, notReported: lutOn.notReported },
  };
}

const iso = (at: number | null) => (at === null ? null : new Date(at).toISOString());

/** One camera as `cameras.snapshot` carries it: only what it reported, never what was merely sent (D10). */
export function cameraSnapshot(cameras: FixtureCameras, camera: CameraNumber): CameraSnapshot {
  const model = cameraModel(camera);
  const state = cameraState(cameras, camera);
  const held = cameras.held[camera];
  // A released or not-set-up camera shows no value (`report.rs`): its reading waits for Connect.
  const read = state === "held" || state === "unreachable" ? held.read : null;
  const recording = model.records ? (read?.report.recording ?? null) : null;
  return {
    camera,
    tag: model.tag,
    model: model.model,
    link: model.link,
    setup: setupSummary(cameras, camera),
    state,
    word: STATE_WORDS[state],
    tone: STATE_TONES[state],
    sentence: cameraSentence(cameras, camera),
    readAt: iso(read?.at ?? null),
    valuesLastRead: state === "held" && held.lastRead && read !== null,
    values: cameraValues(camera, read?.report ?? null),
    auto: { ...model.auto },
    focusSteps: model.focusSteps,
    recording: {
      records: model.records,
      recording,
      timecode: read?.timecode ?? null,
      timecodeReported: model.timecodeReported,
      startedAt: recording === true ? iso(held.startedAt) : null,
      cardTimeLeft: null,
      cardTimeNotReported: model.cardTimeNotReported,
    },
    picture: cameraPicture(cameras, camera),
  };
}

// ---------------------------------------------------------------------------
// The pictures (`pictures.rs`; D17, D28)
// ---------------------------------------------------------------------------

/**
 * A camera's picture, which is vMix's and not the camera's link's: whatever state the camera
 * is in. The double has no vMix: without the simulated cameras (the studio's build) it is a
 * studio build with vMix sending none of its outputs; the simulated cameras' test pictures
 * stand in for vMix inputs 1 to 4, so a camera whose saved input is another (a seed's) reads
 * NO PICTURE while the others show.
 */
export function cameraPicture(cameras: FixtureCameras, camera: CameraNumber): CameraPicture {
  const vmixInput = cameras.held[camera].vmixInput;
  if (!cameras.simulated) {
    return {
      state: "no-pictures",
      word: PICTURE_WORDS.noPicture,
      tone: "attention",
      detail: vmixNothingDetail(camera),
      sentence: pictureMissingSentence(cameraModel(camera)),
      advice: VMIX_NOT_SENDING_ADVICE,
    };
  }
  if (vmixInput >= SIMULATED_VMIX_INPUTS.first && vmixInput <= SIMULATED_VMIX_INPUTS.last) {
    return {
      state: "showing",
      word: PICTURE_WORDS.live,
      tone: "ok",
      detail: PICTURE_SHOWING_DETAIL,
      sentence: null,
      advice: null,
    };
  }
  return {
    state: "missing",
    word: PICTURE_WORDS.noPicture,
    tone: "attention",
    detail: PICTURE_MISSING_DETAIL,
    sentence: pictureMissingSentence(cameraModel(camera)),
    advice: pictureMissingAdvice(vmixInput),
  };
}

/**
 * The three pictures together. When not every one arrives, the state display speaks of one
 * camera: the selected one when its picture is missing, otherwise the first whose picture is.
 */
export function camerasPictures(cameras: FixtureCameras): CamerasPictures {
  const common = { source: pictureSourceWords(cameras.simulated), note: picturesNote(cameras.simulated) };
  if (!cameras.simulated) {
    return {
      state: "no-pictures",
      word: PICTURE_WORDS.noPictures,
      tone: "attention",
      sentence: NO_PICTURES_SENTENCE,
      ...common,
    };
  }
  const missing = CAMERA_NUMBERS.filter((camera) => cameraPicture(cameras, camera).state !== "showing");
  const spoken = missing.includes(cameras.selected) ? cameras.selected : missing[0];
  if (spoken === undefined) return { state: "showing", word: null, tone: "ok", sentence: null, ...common };
  return {
    state: "missing",
    word: PICTURE_WORDS.missing,
    tone: "attention",
    sentence: picturesMissingSentence(cameraModel(spoken), cameras.held[spoken].vmixInput),
    ...common,
  };
}

/** How many of the cameras' Recent actions `cameras.snapshot` carries (`CAMERAS_RECENT_LIMIT`). */
export const CAMERAS_RECENT_LIMIT = 5;

/**
 * The cameras' newest Recent actions, newest first, from the double's action log
 * (`support.snapshot`'s `recentEvents`). The double's log keeps fifty rows where the
 * hardware link's keeps five thousand, so here a camera's row leaves the list after fifty
 * newer rows of any page. `null` while a test holds the log unreadable
 * (`simulatedCameras(…).actionLogUnreadable`), as the hardware link answers when it cannot
 * read its own.
 */
export function recentCameraActions(state: MutableFixtureState): CameraRecentAction[] | null {
  if (fixtureCameras(state).recentUnreadable) return null;
  const rows = Array.isArray(state.supportSnapshot.recentEvents) ? state.supportSnapshot.recentEvents : [];
  const recent: CameraRecentAction[] = [];
  for (const row of rows) {
    if (recent.length === CAMERAS_RECENT_LIMIT) break;
    if (row === null || typeof row !== "object" || Array.isArray(row) || row.domain !== "cameras") continue;
    recent.push({
      id: Number(row.id),
      at: String(row.at),
      source: String(row.source),
      action: String(row.action),
      target: String(row.target),
      detail: String(row.detail),
    });
  }
  return recent;
}

/** What the deck's dials set, as `cameras.snapshot` and `cameras.bank.set` say it (`Cameras::dials`). */
export function cameraDials(cameras: FixtureCameras): CameraDials {
  return { bank: cameras.bank, sets: [...DIAL_BANK_SETS[cameras.bank]] };
}

/** `cameras.snapshot`: the selection, the dials, the three cameras and their newest Recent actions. */
export function camerasSnapshot(cameras: FixtureCameras, recent: CameraRecentAction[] | null): CamerasSnapshot {
  return {
    selected: cameras.selected,
    dials: cameraDials(cameras),
    cameras: CAMERA_NUMBERS.map((camera) => cameraSnapshot(cameras, camera)),
    pictures: camerasPictures(cameras),
    recent,
  };
}

/** CAM 1 reports recording: a held one now, an unreachable one as it last did (doubt). */
export function cam1Recording(cameras: FixtureCameras): boolean {
  // A released camera's kept reading is not shown (`report.rs`), so it does not count.
  const state = cameraState(cameras, 1);
  return (state === "held" || state === "unreachable") && lastReport(cameras, 1)?.recording === true;
}

function healthEntry(cameras: FixtureCameras, camera: CameraNumber): CameraHealthEntry {
  const state = cameraState(cameras, camera);
  return {
    camera,
    tag: cameraModel(camera).tag,
    state,
    word: STATE_WORDS[state],
    tone: STATE_TONES[state],
    sentence: cameraSentence(cameras, camera),
  };
}

/**
 * `checks.cameras` in `health.snapshot`: the worst camera's tone, word and sentence — the
 * highest state in `CameraState`'s order, the lowest camera number among equals — and
 * whether CAM 1 records. While every camera is held, the pictures speak instead when not
 * every one arrives: the Cameras lamp reads `no pictures` or `picture missing`.
 */
export function camerasHealthCheck(cameras: FixtureCameras): CamerasHealthCheck {
  const entries = CAMERA_NUMBERS.map((camera) => healthEntry(cameras, camera));
  const worst = entries.reduce((worse, entry) => (STATE_RANK[entry.state] > STATE_RANK[worse.state] ? entry : worse));
  const pictures = camerasPictures(cameras);
  const spoken =
    worst.tone === "ok" && pictures.word !== null && pictures.sentence !== null
      ? { tone: pictures.tone, word: pictures.word, sentence: pictures.sentence }
      : worst;
  return {
    ok: spoken.tone === "ok",
    status: spoken.tone,
    word: spoken.word,
    summary: spoken.sentence,
    recording: cam1Recording(cameras),
    cameras: entries,
  };
}

/**
 * What the whole status takes from the cameras, and the sentence that says why: a set-up,
 * unreleased camera that does not answer raises it to attention at most (the slice's first
 * step 3); a camera not set up or released lights the Cameras lamp only. The first such
 * camera's sentence; `null` when none counts.
 */
export function camerasStatusPart(cameras: FixtureCameras): { tone: "attention"; sentence: string } | null {
  const camera = CAMERA_NUMBERS.find((number) => cameraState(cameras, number) === "unreachable");
  return camera === undefined ? null : { tone: "attention", sentence: cameraSentence(cameras, camera) };
}

// ---------------------------------------------------------------------------
// The backup archive's part (format 7)
// ---------------------------------------------------------------------------

/** Each camera's address and vMix input; the pairing is Windows' own and stays with this PC. */
export interface ArchivedCamera {
  camera: CameraNumber;
  address: string | null;
  vmixInput: number;
}

export function buildCamerasArchive(cameras: FixtureCameras): ArchivedCamera[] {
  return CAMERA_NUMBERS.map((camera) => ({
    camera,
    address: camera === 1 ? null : cameras.held[camera].address,
    vmixInput: cameras.held[camera].vmixInput,
  }));
}
