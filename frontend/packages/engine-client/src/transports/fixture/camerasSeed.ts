// Part of the fixture double (`../fixtureTransport.ts`): the in-memory stand-in for the
// hardware link that Playwright and the browser fixture mode run against. Test-only.
import type { FixtureCameraSeed, FixtureCameraValuesSeed, FixtureCamerasSeed } from "../../types";
import {
  CHOICE_SETTINGS,
  DIAL_BANKS,
  LEVEL_SETTINGS,
  cameraAddress,
  cameraModel,
  frameRateUnavailable,
  isReported,
  levelAllows,
  levelValue,
  type CameraNumber,
  type ChoiceSetting,
  type LevelSetting,
} from "./camerasModel";
import { fixtureCameras, forgetRead, readCamera, readHeldCameras, type CameraReport } from "./camerasState";
import type { MutableFixtureState } from "./state";

// The cameras a scenario starts with (new pages program, Slice 8): which are set up — CAM
// 1 paired, CAM 2's and CAM 3's addresses — and their vMix inputs, which are released or do
// not answer, CAM 1 recording, values that differ from board 2's, and the selection.
// Without a seed every camera is NOT SET UP: new saved data holds none (D15 rule 1), so a
// fresh start contacts nothing. The seed is the start: every held camera is read at once
// and sent nothing; a camera that does not answer answered at the start and then stopped,
// so it keeps what it reported (doubt); a released one was handed back after the start;
// CAM 1 recording started before the hardware link looked (`startedAt` null). It raises no
// event: the scenario starts that way. A seed the hardware link could not hold is the
// scenario's mistake, and says so.

const mistake = (message: string) => new Error(`cameras: ${message}`);

const isChoice = (key: string): key is ChoiceSetting => (CHOICE_SETTINGS as readonly string[]).includes(key);
const isLevelSetting = (key: string): key is LevelSetting => (LEVEL_SETTINGS as readonly string[]).includes(key);

/**
 * Puts `values` on a simulated camera's own report — a value it reports and allows, and a
 * frame rate it allows at its resolution — or says what is wrong with `refuse`.
 */
export function applyBodyValues(
  camera: CameraNumber,
  report: CameraReport,
  values: FixtureCameraValuesSeed,
  refuse: (message: string) => Error
) {
  if (values === null || typeof values !== "object" || Array.isArray(values)) throw refuse("they must be an object.");
  const model = cameraModel(camera);
  const next: CameraReport = {
    choices: { ...report.choices },
    levels: { ...report.levels },
    displayLutOn: report.displayLutOn,
    recording: report.recording,
  };
  for (const [key, value] of Object.entries(values) as Array<[string, unknown]>) {
    if (isChoice(key)) {
      const choice = model.choices[key];
      if (!isReported(choice)) throw refuse(`${key} is not reported: ${choice.notReported}`);
      if (typeof value !== "string" || !choice.options.includes(value)) {
        throw refuse(`${key} must be one of ${choice.options.join(", ")}; got ${String(value)}.`);
      }
      next.choices[key] = value;
    } else if (isLevelSetting(key)) {
      const level = model.levels[key];
      if (!isReported(level)) throw refuse(`${key} is not reported: ${level.notReported}`);
      if (typeof value !== "number" || !levelAllows(level, value)) {
        throw refuse(`${key} must be ${level.min}–${level.max} in steps of ${level.step}; got ${String(value)}.`);
      }
      next.levels[key] = levelValue(level, value);
    } else if (key === "displayLutOn") {
      if (!isReported(model.displayLutOn))
        throw refuse(`displayLutOn is not reported: ${model.displayLutOn.notReported}`);
      if (typeof value !== "boolean") throw refuse("displayLutOn must be true or false.");
      next.displayLutOn = value;
    } else {
      throw refuse(`${key} is not a camera setting.`);
    }
  }
  const resolution = next.choices.resolution;
  const frameRate = next.choices.frameRate;
  const unavailable =
    resolution !== null && frameRate !== null ? frameRateUnavailable(model, resolution, frameRate) : null;
  if (unavailable !== null) throw refuse(`frameRate ${frameRate} is ${unavailable}.`);
  Object.assign(report, next);
}

/** A key the seed does not know is a mistake, not ignored: a misspelling would drop what it meant. */
function onlyKeys(object: object, known: readonly string[], where: string) {
  const unknown = Object.keys(object).filter((key) => !known.includes(key));
  if (unknown.length > 0) throw mistake(`${where} has ${unknown.join(", ")}, which a seed does not have.`);
}

const SEED_KEYS = ["cameras", "selected", "bank", "simulated"] as const;
const CAMERA_SEED_KEYS = [
  "camera",
  "address",
  "paired",
  "vmixInput",
  "released",
  "unreachable",
  "lastRead",
  "recording",
  "values",
] as const;

function flag(value: unknown, what: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw mistake(`${what} must be true or false.`);
  return value;
}

interface CheckedCamera {
  camera: CameraNumber;
  address: string | null;
  paired: boolean;
  vmixInput: number;
  released: boolean;
  unreachable: boolean;
  lastRead: boolean;
  recording: boolean | null;
  values: FixtureCameraValuesSeed;
}

/** One camera's seed, held to what Setup and the camera hold. */
function checkedCamera(seed: FixtureCameraSeed, index: number, seen: Set<number>): CheckedCamera {
  if (seed === null || typeof seed !== "object" || Array.isArray(seed))
    throw mistake(`cameras[${index}] must be an object.`);
  const camera = seed.camera;
  if (camera !== 1 && camera !== 2 && camera !== 3) throw mistake(`cameras[${index}].camera must be 1, 2 or 3.`);
  if (seen.has(camera)) throw mistake(`CAM ${camera} is seeded twice.`);
  seen.add(camera);
  const tag = `CAM ${camera}`;
  onlyKeys(seed, CAMERA_SEED_KEYS, `${tag}'s seed`);
  let address: string | null = null;
  if (seed.address !== undefined) {
    if (camera === 1) throw mistake("CAM 1 has no address: it is paired (paired: true).");
    address = typeof seed.address === "string" ? cameraAddress(seed.address) : null;
    if (address === null) throw mistake(`${tag}'s address ${String(seed.address)} is not the address of one machine.`);
  }
  const paired = flag(seed.paired, `${tag}'s paired`);
  if (paired && camera !== 1) throw mistake(`${tag} is not paired: it has an address.`);
  const vmixInput = seed.vmixInput ?? camera;
  if (!Number.isInteger(vmixInput) || vmixInput < 1 || vmixInput > 1000) {
    throw mistake(`${tag}'s vmixInput must be a whole number from 1 to 1000.`);
  }
  const released = flag(seed.released, `${tag}'s released`);
  const unreachable = flag(seed.unreachable, `${tag}'s unreachable`);
  const lastRead = flag(seed.lastRead, `${tag}'s lastRead`);
  const setUp = camera === 1 ? paired : address !== null;
  const setUpWith = camera === 1 ? "paired: true" : "an address";
  if (released && !setUp) throw mistake(`${tag} is released, so it must be set up: give it ${setUpWith}.`);
  if (unreachable && !setUp) throw mistake(`${tag} does not answer, so it must be set up: give it ${setUpWith}.`);
  if (lastRead && !setUp)
    throw mistake(`${tag}'s values are the last read, so it must be set up: give it ${setUpWith}.`);
  let recording: boolean | null = null;
  if (seed.recording !== undefined) {
    if (camera !== 1) throw mistake(`${tag} does not record here: only CAM 1 records.`);
    recording = flag(seed.recording, "CAM 1's recording");
  }
  return { camera, address, paired, vmixInput, released, unreachable, lastRead, recording, values: seed.values ?? {} };
}

/** Builds the scenario's cameras on the double, before its first read. */
export function seedFixtureCameras(state: MutableFixtureState, seed: FixtureCamerasSeed | undefined) {
  if (seed === undefined) return;
  if (seed === null || typeof seed !== "object" || Array.isArray(seed)) throw mistake("the seed must be an object.");
  onlyKeys(seed, SEED_KEYS, "the seed");
  const cameras = fixtureCameras(state);
  if (seed.simulated !== undefined) cameras.simulated = flag(seed.simulated, "simulated");
  if (seed.selected !== undefined) {
    if (seed.selected !== 1 && seed.selected !== 2 && seed.selected !== 3) throw mistake("selected must be 1, 2 or 3.");
    cameras.selected = seed.selected;
  }
  if (seed.bank !== undefined) {
    const bank = DIAL_BANKS.find((known) => known === seed.bank);
    if (!bank) throw mistake("bank must be exposure, colour or focus.");
    cameras.bank = bank;
  }
  if (seed.cameras !== undefined && !Array.isArray(seed.cameras)) throw mistake("cameras must be a list.");
  const seen = new Set<number>();
  const checked = (seed.cameras ?? []).map((entry, index) => checkedCamera(entry, index, seen));
  for (const entry of checked) {
    const held = cameras.held[entry.camera];
    held.address = entry.address;
    held.paired = entry.paired;
    held.vmixInput = entry.vmixInput;
    const body = cameras.bodies[entry.camera].report;
    applyBodyValues(entry.camera, body, entry.values, (message) => mistake(`CAM ${entry.camera}'s values: ${message}`));
    if (entry.recording !== null) body.recording = entry.recording;
  }
  // The start: every held camera read at once, and sent nothing. One that does not answer
  // stopped after that read, and the hardware link has noticed: it keeps what it reported.
  const now = Date.now();
  readHeldCameras(cameras, now);
  for (const entry of checked) {
    if (entry.unreachable) {
      cameras.bodies[entry.camera].answering = false;
      readCamera(cameras, entry.camera, now);
    }
    if (entry.lastRead) {
      // Read once, then its link brings nothing: the values stand as the last read.
      cameras.bodies[entry.camera].reporting = false;
      readCamera(cameras, entry.camera, now);
    }
    if (entry.released) {
      cameras.held[entry.camera].released = true;
      forgetRead(cameras, entry.camera);
    }
  }
}
