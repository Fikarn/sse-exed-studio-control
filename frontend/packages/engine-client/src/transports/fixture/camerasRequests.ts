// Part of the fixture double (`../fixtureTransport.ts`): the in-memory stand-in for the
// hardware link that Playwright and the browser fixture mode run against. Test-only.
import type { JsonObject, JsonValue, RequestMethod } from "../../generated/protocol";
import type { EngineTransport, FixtureCameraValuesSeed } from "../../types";
import {
  AUTO_WHATS,
  CAMERA_NUMBERS,
  DIAL_BANKS,
  LEVEL_SETTINGS,
  PRESS_SETTINGS,
  cameraAddress,
  cameraModel,
  choiceStepped,
  frameRateUnavailable,
  isReported,
  levelAllows,
  levelStepped,
  levelValue,
  type AutoWhat,
  type CameraModel,
  type CameraNumber,
  type ChoiceSetting,
  type LevelSetting,
  type PressSetting,
} from "./camerasModel";
import { applyBodyValues } from "./camerasSeed";
import {
  buildCamerasArchive,
  cameraDials,
  cameraSentence,
  cameraState,
  camerasHealthCheck,
  camerasSnapshot,
  camerasStatusPart,
  fixtureCameras,
  forgetRead,
  hasLink,
  isSetUp,
  lastReport,
  readCamera,
  readHeldCameras,
  recentCameraActions,
  setupSummary,
  type ArchivedCamera,
  type CameraReport,
  type FixtureCameras,
  type Transition,
} from "./camerasState";
import {
  addressInvalidRefusal,
  addressesNotRestoredSentence,
  alreadyHeldRefusal,
  alreadyRecordingRefusal,
  autoNotOfferedRefusal,
  formatNotAllowedRefusal,
  formatSentence,
  heldAgainSentence,
  invalidParams,
  lookPart,
  lookSentence,
  noLinkRefusal,
  notAllowedRefusal,
  notConfirmedRefusal,
  notRecordingRefusal,
  notSetUpRefusal,
  releasedRefusal,
  releasedToSentence,
  startedRecordingSentence,
  stoppedRecordingSentence,
  unreachableRefusal,
  unsupportedRefusal,
} from "./camerasWords";
import { NOT_HANDLED, type FixtureRequestContext, type FixtureRequestResult } from "./requestContext";
import { applyCamerasHealth } from "./state";

// The cameras' `cameras.*` methods as the hardware link answers them (`native/rust-engine/
// src/cameras/`, new pages program, Slice 8; `v1.md`'s "Cameras"): the same parameters,
// answers, refusal codes and sentences, and a `cameras.changed { reason, camera }` for
// every request that changed something; a refused one changes nothing and raises nothing. The checks run in the hardware link's order: the
// parameters' shape (`INVALID_PARAMS`), then not set up, released, unreachable, a setting
// the camera does not report or offer, a value it does not allow, and last a change that
// needs a second press. Only a press sends anything to a camera (D12): starting, reading,
// selecting, connecting, Setup and a restore send nothing, and release only stops reading.
// Every request first reads every held camera again (`with_cameras`, which sends nothing):
// a value a camera changed itself comes back as `cameras.changed { reason: "reported" }`, a
// held camera that stops answering as `unreachable` and one that answers again as
// `reachable`, whoever noticed first. When `checks.cameras` or its part of the whole status
// says something else after a request or a change on the link, `app.changed { reason:
// "health" }` follows.

/** `cameras.changed`'s reasons. */
export type CamerasChangedReason =
  | "select"
  | "bank"
  | "setting"
  | "format"
  | "look"
  | "record"
  | "release"
  | "connect"
  | "setup"
  | "reported"
  | "unreachable"
  | "reachable"
  | "restore"
  /** The pictures helper says something else (a development run; the double has none). */
  | "pictures";

interface Answer {
  result: JsonValue;
  /** The event's reason; `null` for a read. */
  reason: CamerasChangedReason | null;
  /** The camera it is about; `null` when it is about all three. */
  camera: CameraNumber | null;
}

const answer = (result: JsonValue, reason: CamerasChangedReason | null = null, camera: CameraNumber | null = null) => ({
  result,
  reason,
  camera,
});

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

function cameraParam(params: JsonObject): CameraNumber {
  const value = params.camera;
  if (value === 1 || value === 2 || value === 3) return value;
  throw invalidParams("camera must be 1, 2 or 3.");
}

/** Absent or `false` is not confirmed; anything but true or false is the wrong type. */
function confirmParam(params: JsonObject): boolean {
  const value = params.confirm;
  if (value === undefined || value === null) return false;
  if (typeof value === "boolean") return value;
  throw invalidParams("confirm must be true or false.");
}

function optionalText(params: JsonObject, key: string): string | null {
  const value = params[key];
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  throw invalidParams(`${key} must be one of the camera's values, as text.`);
}

function optionalFlag(params: JsonObject, key: string): boolean | null {
  const value = params[key];
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value;
  throw invalidParams(`${key} must be true or false.`);
}

function pressSettingParam(params: JsonObject): PressSetting {
  const value = params.setting;
  if (typeof value === "string" && (PRESS_SETTINGS as readonly string[]).includes(value)) return value as PressSetting;
  throw invalidParams("setting must be iso, shutter, iris, nd, whiteBalance, tint or focus.");
}

const isLevel = (setting: PressSetting): setting is PressSetting & LevelSetting =>
  (LEVEL_SETTINGS as readonly string[]).includes(setting);

/** A choice's value is text from its list; a level's a number. */
function valueParam(params: JsonObject, setting: PressSetting): string | number {
  const value = params.value;
  if (isLevel(setting)) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    throw invalidParams(`value must be a number for ${setting}.`);
  }
  if (typeof value === "string") return value;
  throw invalidParams(`value must be one of the camera's values, as text, for ${setting}.`);
}

function stepParam(params: JsonObject): number {
  const value = params.step;
  if (typeof value === "number" && Number.isInteger(value) && value !== 0 && Math.abs(value) <= 1000) return value;
  throw invalidParams("step must be a whole number of steps, not 0.");
}

function autoParam(params: JsonObject): AutoWhat {
  const value = params.what;
  if (typeof value === "string" && (AUTO_WHATS as readonly string[]).includes(value)) return value as AutoWhat;
  throw invalidParams("what must be focus, whiteBalance or iris.");
}

// ---------------------------------------------------------------------------
// The checks after the shape: who holds the camera, and what it reports
// ---------------------------------------------------------------------------

/** A control on a camera: not set up, then released, then unreachable, each with its sentence. */
function heldCamera(cameras: FixtureCameras, camera: CameraNumber): { model: CameraModel; report: CameraReport } {
  const model = cameraModel(camera);
  switch (cameraState(cameras, camera)) {
    case "not-set-up":
      throw notSetUpRefusal(model, hasLink(cameras, camera));
    case "released":
      throw releasedRefusal(model);
    case "unreachable":
      throw unreachableRefusal(cameraSentence(cameras, camera));
    case "held":
      // Read before the request, so what it reports now.
      return { model, report: lastReport(cameras, camera)! };
  }
}

/** The choice's model, or its not-reported sentence as `CAMERA_SETTING_UNSUPPORTED`. */
function reportedChoice(model: CameraModel, setting: ChoiceSetting) {
  const choice = model.choices[setting];
  if (!isReported(choice)) throw unsupportedRefusal(choice.notReported);
  return choice;
}

/** A choice's value, from its list, or `CAMERA_VALUE_NOT_ALLOWED`. */
function allowedChoice(model: CameraModel, setting: ChoiceSetting, value: string): string {
  if (!reportedChoice(model, setting).options.includes(value)) throw notAllowedRefusal(model, setting, value);
  return value;
}

/**
 * Sends the operator's press to a held camera — the one thing that sends — and reads it
 * back: the answer is what the camera then reports. (A held camera answered the read that
 * began the request, and nothing but a test hook, which reads again, stops it answering.)
 */
function send(cameras: FixtureCameras, camera: CameraNumber, now: number, change: (report: CameraReport) => void) {
  const body = cameras.bodies[camera];
  body.sent += 1;
  change(body.report);
  readCamera(cameras, camera, now);
  return lastReport(cameras, camera)!;
}

// ---------------------------------------------------------------------------
// One press (D11): set, step, auto
// ---------------------------------------------------------------------------

/** `cameras.set { camera, setting, value }`: a value from its options, or a number in its range on its step. */
function setRequest(cameras: FixtureCameras, params: JsonObject, now: number): Answer {
  const camera = cameraParam(params);
  const setting = pressSettingParam(params);
  const value = valueParam(params, setting);
  const { model } = heldCamera(cameras, camera);
  let reported: string | number | null;
  if (isLevel(setting)) {
    const level = model.levels[setting];
    if (!isReported(level)) throw unsupportedRefusal(level.notReported);
    if (!levelAllows(level, value as number)) throw notAllowedRefusal(model, setting, value);
    reported = send(cameras, camera, now, (report) => {
      report.levels[setting] = levelValue(level, value as number);
    }).levels[setting];
  } else {
    const chosen = allowedChoice(model, setting, value as string);
    reported = send(cameras, camera, now, (report) => {
      report.choices[setting] = chosen;
    }).choices[setting];
  }
  return answer({ camera, setting, value: reported }, "setting", camera);
}

/**
 * `cameras.step { camera, setting, step }`: a number of the camera's own steps, stopping at
 * the ends (the deck's dials, the page's steppers). Focus on a camera with `focusSteps`
 * moves nearer (`-`) or farther (`+`) without a position, so its value is `null`.
 */
function stepRequest(cameras: FixtureCameras, params: JsonObject, now: number): Answer {
  const camera = cameraParam(params);
  const setting = pressSettingParam(params);
  const steps = stepParam(params);
  const { model, report } = heldCamera(cameras, camera);
  let reported: string | number | null;
  if (isLevel(setting)) {
    const level = model.levels[setting];
    if (!isReported(level)) {
      if (setting !== "focus" || !model.focusSteps) throw unsupportedRefusal(level.notReported);
      send(cameras, camera, now, () => {});
      return answer({ camera, setting, value: null }, "setting", camera);
    }
    const next = levelStepped(level, report.levels[setting] ?? level.start, steps);
    reported = send(cameras, camera, now, (body) => {
      body.levels[setting] = next;
    }).levels[setting];
  } else {
    const choice = reportedChoice(model, setting);
    const next = choiceStepped(choice, report.choices[setting] ?? choice.start, steps);
    reported = send(cameras, camera, now, (body) => {
      body.choices[setting] = next;
    }).choices[setting];
  }
  return answer({ camera, setting, value: reported }, "setting", camera);
}

/**
 * Where a simulated one-shot auto settles (`simulated.rs`): autofocus at half the focus
 * range (a camera without a focus position, the BGH1, reports none), auto white balance at
 * 5600 K, auto iris at f/4.0.
 */
export const SIMULATED_AUTO = { focus: 0.5, whiteBalance: 5600, iris: "f/4.0" } as const;

/** `cameras.auto { camera, what }`: a one-shot focus, white balance or iris the camera offers. */
function autoRequest(cameras: FixtureCameras, params: JsonObject, now: number): Answer {
  const camera = cameraParam(params);
  const what = autoParam(params);
  const { model } = heldCamera(cameras, camera);
  if (!model.auto[what]) throw autoNotOfferedRefusal(model, what);
  const report = send(cameras, camera, now, (body) => {
    if (what === "iris") body.choices.iris = SIMULATED_AUTO.iris;
    else if (what === "whiteBalance") body.levels.whiteBalance = SIMULATED_AUTO.whiteBalance;
    else if (body.levels.focus !== null) body.levels.focus = SIMULATED_AUTO.focus;
  });
  const value = what === "iris" ? report.choices.iris : report.levels[what];
  return answer({ camera, setting: what, value }, "setting", camera);
}

// ---------------------------------------------------------------------------
// Armed on the page (press twice): format, look, record, release
// ---------------------------------------------------------------------------

/** `cameras.format.set { camera, resolution?, frameRate?, confirm }`. */
function formatRequest(cameras: FixtureCameras, params: JsonObject, now: number): Answer {
  const camera = cameraParam(params);
  const resolution = optionalText(params, "resolution");
  const frameRate = optionalText(params, "frameRate");
  const confirm = confirmParam(params);
  if (resolution === null && frameRate === null) throw invalidParams("Send resolution, frameRate or both.");
  const { model, report } = heldCamera(cameras, camera);
  if (resolution !== null) allowedChoice(model, "resolution", resolution);
  if (frameRate !== null) allowedChoice(model, "frameRate", frameRate);
  const was = { resolution: report.choices.resolution!, frameRate: report.choices.frameRate! };
  const next = { resolution: resolution ?? was.resolution, frameRate: frameRate ?? was.frameRate };
  if (frameRateUnavailable(model, next.resolution, next.frameRate) !== null) {
    throw formatNotAllowedRefusal(model, next.frameRate, next.resolution);
  }
  if (!confirm) throw notConfirmedRefusal();
  const after = send(cameras, camera, now, (body) => {
    body.choices.resolution = next.resolution;
    body.choices.frameRate = next.frameRate;
  });
  const sentence = formatSentence(
    model,
    resolution === null ? null : { from: was.resolution, to: after.choices.resolution! },
    frameRate === null ? null : { from: was.frameRate, to: after.choices.frameRate! }
  );
  return answer({ camera, sentence }, "format", camera);
}

/** `cameras.look.set { camera, dynamicRange?, displayLut?, displayLutOn?, confirm }`: the picture profile and the display LUT. */
function lookRequest(cameras: FixtureCameras, params: JsonObject, now: number): Answer {
  const camera = cameraParam(params);
  const dynamicRange = optionalText(params, "dynamicRange");
  const displayLut = optionalText(params, "displayLut");
  const displayLutOn = optionalFlag(params, "displayLutOn");
  const confirm = confirmParam(params);
  if (dynamicRange === null && displayLut === null && displayLutOn === null) {
    throw invalidParams("Send dynamicRange, displayLut, displayLutOn or several.");
  }
  const { model, report } = heldCamera(cameras, camera);
  if (dynamicRange !== null) reportedChoice(model, "dynamicRange");
  if (displayLut !== null) reportedChoice(model, "displayLut");
  if (displayLutOn !== null && !isReported(model.displayLutOn)) {
    throw unsupportedRefusal(model.displayLutOn.notReported);
  }
  if (dynamicRange !== null) allowedChoice(model, "dynamicRange", dynamicRange);
  if (displayLut !== null) allowedChoice(model, "displayLut", displayLut);
  if (!confirm) throw notConfirmedRefusal();
  const was = { dynamicRange: report.choices.dynamicRange!, displayLut: report.choices.displayLut! };
  const after = send(cameras, camera, now, (body) => {
    if (dynamicRange !== null) body.choices.dynamicRange = dynamicRange;
    if (displayLut !== null) body.choices.displayLut = displayLut;
    if (displayLutOn !== null) body.displayLutOn = displayLutOn;
  });
  const parts: string[] = [];
  if (dynamicRange !== null) {
    parts.push(lookPart({ setting: "dynamicRange", from: was.dynamicRange, to: after.choices.dynamicRange! }));
  }
  if (displayLut !== null) {
    parts.push(lookPart({ setting: "displayLut", from: was.displayLut, to: after.choices.displayLut! }));
  }
  if (displayLutOn !== null) parts.push(lookPart({ setting: "displayLutOn", on: after.displayLutOn === true }));
  return answer({ camera, sentence: lookSentence(model, parts) }, "look", camera);
}

/** `cameras.record.start`, one press, on CAM 1 whichever camera is selected (D14). */
function recordStartRequest(cameras: FixtureCameras, now: number): Answer {
  const { model, report } = heldCamera(cameras, 1);
  if (report.recording === true) throw alreadyRecordingRefusal();
  const after = send(cameras, 1, now, (body) => {
    body.recording = true;
  });
  return answer(
    { camera: 1, recording: after.recording === true, sentence: startedRecordingSentence(model) },
    "record",
    1
  );
}

/** `cameras.record.stop { confirm }`, armed, on CAM 1 (D14). */
function recordStopRequest(cameras: FixtureCameras, params: JsonObject, now: number): Answer {
  const confirm = confirmParam(params);
  const { model, report } = heldCamera(cameras, 1);
  if (report.recording !== true) throw notRecordingRefusal();
  if (!confirm) throw notConfirmedRefusal();
  const after = send(cameras, 1, now, (body) => {
    body.recording = false;
  });
  return answer(
    { camera: 1, recording: after.recording === true, sentence: stoppedRecordingSentence(model) },
    "record",
    1
  );
}

/**
 * `cameras.release { camera, confirm }`: hands the camera back to the iPad or LUMIX Tether.
 * The hardware link stops reading it and sends it nothing; its values are no longer shown.
 * A recording CAM 1 goes on recording. Kept in memory only (D13).
 */
function releaseRequest(cameras: FixtureCameras, params: JsonObject): Answer {
  const camera = cameraParam(params);
  const confirm = confirmParam(params);
  const model = cameraModel(camera);
  if (!isSetUp(cameras, camera)) throw notSetUpRefusal(model, hasLink(cameras, camera));
  if (cameras.held[camera].released) throw releasedRefusal(model);
  if (!confirm) throw notConfirmedRefusal();
  cameras.held[camera].released = true;
  forgetRead(cameras, camera);
  return answer(
    { camera, state: cameraState(cameras, camera), sentence: releasedToSentence(model) },
    "release",
    camera
  );
}

/**
 * `cameras.connect { camera }`: takes a released camera back and reads it again, sending
 * nothing; on an unreachable one it tries to read it again and answers its state. A held
 * camera is `CAMERA_ALREADY_HELD`.
 */
function connectRequest(cameras: FixtureCameras, params: JsonObject, now: number): Answer {
  const camera = cameraParam(params);
  const model = cameraModel(camera);
  if (!isSetUp(cameras, camera)) throw notSetUpRefusal(model, hasLink(cameras, camera));
  if (cameraState(cameras, camera) === "held") throw alreadyHeldRefusal(model);
  const held = cameras.held[camera];
  held.released = false;
  // An unreachable camera keeps what it last reported until it answers; a released one has none.
  if (held.failure === null) forgetRead(cameras, camera);
  readCamera(cameras, camera, now);
  const state = cameraState(cameras, camera);
  const sentence = state === "held" ? heldAgainSentence(model) : cameraSentence(cameras, camera);
  return answer({ camera, state, sentence }, "connect", camera);
}

// ---------------------------------------------------------------------------
// Setup (not Recent actions)
// ---------------------------------------------------------------------------

/** A camera whose address or pairing was saved: held, and read at once — nothing is sent. */
function holdAfresh(cameras: FixtureCameras, camera: CameraNumber, now: number) {
  cameras.held[camera].released = false;
  forgetRead(cameras, camera);
  readCamera(cameras, camera, now);
}

/**
 * `cameras.setup.update { camera, address?, vmixInput? }`: CAM 2's or CAM 3's address (`null`
 * takes it away), and any camera's vMix input. Saving an address holds the camera and reads
 * it at once; nothing is sent. In a build with no link to the camera an address is refused
 * (`CAMERA_NO_LINK`), after its shape and its form were checked; taking one away and the
 * vMix input stay.
 */
function setupUpdateRequest(cameras: FixtureCameras, params: JsonObject, now: number): Answer {
  const camera = cameraParam(params);
  const given = params.address;
  let text: string | null | undefined;
  if (given !== undefined) {
    if (camera === 1) throw invalidParams("CAM 1 has no address: it is paired over Bluetooth.");
    if (given !== null && (typeof given !== "string" || given.trim() === "")) {
      throw invalidParams("address must be the camera's IPv4 address, or null to take it away.");
    }
    text = given === null ? null : given.trim();
  }
  const input = params.vmixInput;
  if (input !== undefined && !(typeof input === "number" && Number.isInteger(input) && input >= 1 && input <= 1000)) {
    throw invalidParams("vmixInput must be a whole number from 1 to 1000.");
  }
  if (text === undefined && input === undefined) throw invalidParams("Send address, vmixInput or both.");
  let address: string | null | undefined = text;
  if (text !== undefined && text !== null) {
    address = cameraAddress(text);
    if (address === null) throw addressInvalidRefusal(text);
    if (!hasLink(cameras, camera)) throw noLinkRefusal(cameraModel(camera));
  }
  const held = cameras.held[camera];
  if (input !== undefined) held.vmixInput = input as number;
  if (address !== undefined) {
    held.address = address;
    holdAfresh(cameras, camera, now);
  }
  return answer({ camera, setup: setupSummary(cameras, camera) }, "setup", camera);
}

/** `cameras.setup.pair { camera: 1 }`: the simulated link pairs at once; without it, no link yet. */
function setupPairRequest(cameras: FixtureCameras, params: JsonObject, now: number): Answer {
  const camera = cameraParam(params);
  if (camera !== 1) throw invalidParams("Only CAM 1 is paired; CAM 2 and CAM 3 take an address.");
  if (!hasLink(cameras, camera)) throw noLinkRefusal(cameraModel(camera));
  cameras.held[1].paired = true;
  holdAfresh(cameras, 1, now);
  return answer({ camera, setup: setupSummary(cameras, camera) }, "setup", camera);
}

/** `cameras.setup.forget { camera }`: the address or the pairing goes (the vMix input stays); not set up again. */
function setupForgetRequest(cameras: FixtureCameras, params: JsonObject): Answer {
  const camera = cameraParam(params);
  const held = cameras.held[camera];
  if (camera === 1) held.paired = false;
  else held.address = null;
  held.released = false;
  forgetRead(cameras, camera);
  return answer({ camera, setup: setupSummary(cameras, camera) }, "setup", camera);
}

function answerRequest(
  context: FixtureRequestContext,
  cameras: FixtureCameras,
  method: RequestMethod,
  params: JsonObject,
  now: number
): Answer {
  switch (method) {
    case "cameras.snapshot":
      return answer(camerasSnapshot(cameras, recentCameraActions(context.state)) as unknown as JsonValue);
    case "cameras.select": {
      // In memory; a camera not set up can be selected (D19). Not a Recent action.
      const camera = cameraParam(params);
      cameras.selected = camera;
      return answer({ selected: camera }, "select", camera);
    }
    case "cameras.bank.set": {
      // In memory, as the selection; nothing reaches a camera. Not a Recent action.
      const bank = DIAL_BANKS.find((known) => known === params.bank);
      if (!bank) throw invalidParams("bank must be exposure, colour or focus.");
      cameras.bank = bank;
      return answer({ bank, dials: cameraDials(cameras) as unknown as JsonValue }, "bank", null);
    }
    case "cameras.set":
      return setRequest(cameras, params, now);
    case "cameras.step":
      return stepRequest(cameras, params, now);
    case "cameras.auto":
      return autoRequest(cameras, params, now);
    case "cameras.format.set":
      return formatRequest(cameras, params, now);
    case "cameras.look.set":
      return lookRequest(cameras, params, now);
    case "cameras.record.start":
      return recordStartRequest(cameras, now);
    case "cameras.record.stop":
      return recordStopRequest(cameras, params, now);
    case "cameras.release":
      return releaseRequest(cameras, params);
    case "cameras.connect":
      return connectRequest(cameras, params, now);
    case "cameras.setup.update":
      return setupUpdateRequest(cameras, params, now);
    case "cameras.setup.pair":
      return setupPairRequest(cameras, params, now);
    case "cameras.setup.forget":
      return setupForgetRequest(cameras, params);
    case "cameras.pictures.showing":
      // The page shows the pictures: the double has no helper to tell, and counts it.
      cameras.showingSaid += 1;
      return answer({});
    default:
      throw new Error(`${method} is not a cameras request`);
  }
}

/** The sixteen methods (`v1.md`'s "Cameras"). */
export const CAMERAS_METHODS: ReadonlySet<RequestMethod> = new Set<RequestMethod>([
  "cameras.snapshot",
  "cameras.select",
  "cameras.bank.set",
  "cameras.set",
  "cameras.step",
  "cameras.auto",
  "cameras.format.set",
  "cameras.look.set",
  "cameras.record.start",
  "cameras.record.stop",
  "cameras.release",
  "cameras.connect",
  "cameras.setup.update",
  "cameras.setup.pair",
  "cameras.setup.forget",
  "cameras.pictures.showing",
]);

/** The check and the whole status's part of it, compared whole. */
const healthState = (cameras: FixtureCameras) =>
  JSON.stringify({ check: camerasHealthCheck(cameras), part: camerasStatusPart(cameras) });

/** When the check says something else than `before`: the health snapshot takes it, and `app.changed` says so. */
function announceHealth(context: FixtureRequestContext, cameras: FixtureCameras, before: string) {
  if (before === healthState(cameras)) return;
  applyCamerasHealth(context.state);
  context.emit("app.changed", { reason: "health" });
}

/**
 * Reads every held (and every unreachable) camera again and announces what changed, camera
 * by camera, then the health (`Cameras::settle`): before every request, and after a test
 * hook has done something to a simulated camera, as the link would notice it.
 */
function settle(context: FixtureRequestContext, now: number) {
  const cameras = fixtureCameras(context.state);
  const before = healthState(cameras);
  const transitions: Array<[CameraNumber, Transition]> = readHeldCameras(cameras, now);
  for (const [camera, reason] of transitions) context.emit("cameras.changed", { reason, camera });
  if (transitions.length > 0) announceHealth(context, cameras, before);
}

/**
 * A change to the cameras, then its event and, when the check says something else after
 * it, the health snapshot taking it and `app.changed { reason: "health" }` after
 * `cameras.changed`. A refused request changes nothing and raises nothing.
 */
function changeCameras(context: FixtureRequestContext, change: (cameras: FixtureCameras) => Answer): Answer {
  const cameras = fixtureCameras(context.state);
  const before = healthState(cameras);
  const done = change(cameras);
  if (done.reason !== null) context.emit("cameras.changed", { reason: done.reason, camera: done.camera });
  announceHealth(context, cameras, before);
  return done;
}

/**
 * The cameras' requests: every `cameras.*` method, under the cameras' own lock, after every
 * held camera has been read again.
 */
export function handleFixtureCamerasRequest(
  context: FixtureRequestContext,
  method: RequestMethod,
  params: JsonObject
): FixtureRequestResult {
  if (!CAMERAS_METHODS.has(method)) return NOT_HANDLED;
  const now = Date.now();
  settle(context, now);
  return changeCameras(context, (cameras) => answerRequest(context, cameras, method, params, now)).result;
}

// ---------------------------------------------------------------------------
// The simulated cameras, as a test holds them (the hardware link's test hooks)
// ---------------------------------------------------------------------------

/** What a test does to a simulated camera, and what it asks of it. */
export interface SimulatedCameraHooks {
  /** How many commands the camera has been sent (D12: only a press sends). */
  sent(camera: CameraNumber): number;
  /**
   * A value the camera changed itself — on its body, or from the iPad: the camera wins
   * (D12), and a held camera's change comes back as `cameras.changed { reason: "reported" }`.
   * `recording` starts or stops CAM 1's take.
   */
  changeOnBody(camera: CameraNumber, values: FixtureCameraValuesSeed & { recording?: boolean }): void;
  /** The camera stops answering: a held one reads UNREACHABLE and keeps what it last reported. */
  stopAnswering(camera: CameraNumber): void;
  /** It answers again: a held one is read at once. */
  answerAgain(camera: CameraNumber): void;
  /**
   * The action log cannot be read, or can again: while it cannot, `cameras.snapshot`
   * answers `recent: null` and everything else as ever.
   */
  actionLogUnreadable(unreadable: boolean): void;
  /** How many times the page said it shows the pictures (`cameras.pictures.showing`). */
  picturesShowingSaid(): number;
  /** How many takes the page made, each for the three cameras. */
  picturesPulled(): number;
}

const bound = new WeakMap<EngineTransport, FixtureRequestContext>();

/** Lets a test reach the double's simulated cameras through its transport (`fixtureTransport.ts`). */
export function bindFixtureCameras(transport: EngineTransport, context: FixtureRequestContext) {
  bound.set(transport, context);
}

/** A double's own context, for the double's tests of what a restore does to it. */
export function fixtureContextOf(transport: EngineTransport): FixtureRequestContext {
  const context = bound.get(transport);
  if (!context) throw new Error("fixtureContextOf needs a transport made by createFixtureTransport");
  return context;
}

/** The simulated cameras of a fixture double made by `createFixtureTransport`. */
export function simulatedCameras(transport: EngineTransport): SimulatedCameraHooks {
  const context = bound.get(transport);
  if (!context) throw new Error("simulatedCameras needs a transport made by createFixtureTransport");
  const bodies = () => fixtureCameras(context.state).bodies;
  /** Does something to a camera itself, then lets the link notice it as it would (`with_bodies`). */
  const onBody = (action: () => void) => {
    action();
    settle(context, Date.now());
  };
  return {
    sent: (camera) => bodies()[camera].sent,
    changeOnBody: (camera, values) =>
      onBody(() => {
        const { recording, ...settings } = values;
        const report = bodies()[camera].report;
        applyBodyValues(camera, report, settings, (message) => new Error(`CAM ${camera}'s values: ${message}`));
        if (recording !== undefined) {
          if (!cameraModel(camera).records) throw new Error(`CAM ${camera} does not record here.`);
          report.recording = recording;
        }
      }),
    stopAnswering: (camera) =>
      onBody(() => {
        bodies()[camera].answering = false;
      }),
    answerAgain: (camera) =>
      onBody(() => {
        bodies()[camera].answering = true;
      }),
    actionLogUnreadable: (unreadable) => {
      fixtureCameras(context.state).recentUnreadable = unreadable;
    },
    picturesShowingSaid() {
      return fixtureCameras(context.state).showingSaid;
    },
    picturesPulled() {
      return fixtureCameras(context.state).picturesPulled;
    },
  };
}

// ---------------------------------------------------------------------------
// The backup archive's part (format 7)
// ---------------------------------------------------------------------------

/** The cameras' part of a backup archive the double exports: each camera's address and vMix input. */
export function exportFixtureCamerasArchive(context: FixtureRequestContext): ArchivedCamera[] {
  return buildCamerasArchive(fixtureCameras(context.state));
}

/**
 * An applied archive restore's part for the cameras (`after_archive_restore`): a format-7
 * archive's addresses and vMix inputs written — this PC's pairing kept, an address or a vMix
 * input Setup would refuse left as it was — and nothing sent to a camera; a camera whose
 * address changed starts again, held and read. An archive of format 6 or older (`null`)
 * leaves the cameras' setup as it is. Either way `cameras.changed { reason: "restore",
 * camera: null }` says the cameras took their setup again. In a build with no link to a
 * camera its address is left out, as Setup would refuse it; the answer is the sentence that
 * names those cameras for the restore's `detail`, or `null`.
 */
export function restoreFixtureCamerasArchive(
  context: FixtureRequestContext,
  archive: ArchivedCamera[] | null
): string | null {
  const now = Date.now();
  // The address the archive gives each camera, were it written; an archive that names a
  // camera more than once is read to its last word on it.
  const given = new Map<CameraNumber, string | null>();
  let leftOut: CameraNumber[] = [];
  changeCameras(context, (cameras) => {
    const before = new Map(CAMERA_NUMBERS.map((camera) => [camera, cameras.held[camera].address]));
    for (const entry of archive ?? []) {
      const held = cameras.held[entry.camera];
      if (Number.isInteger(entry.vmixInput) && entry.vmixInput >= 1 && entry.vmixInput <= 1000) {
        held.vmixInput = entry.vmixInput;
      }
      if (entry.camera === 1) continue;
      const address = entry.address === null ? null : cameraAddress(entry.address);
      if (entry.address !== null && address === null) continue;
      given.set(entry.camera, address);
      if (address === null || hasLink(cameras, entry.camera)) held.address = address;
    }
    // A camera whose address changed starts again, held and read.
    for (const camera of CAMERA_NUMBERS) {
      if (cameras.held[camera].address !== before.get(camera)) holdAfresh(cameras, camera, now);
    }
    leftOut = CAMERA_NUMBERS.filter((camera) => {
      const address = given.get(camera);
      return typeof address === "string" && cameras.held[camera].address !== address;
    });
    return answer(null, "restore", null);
  });
  return addressesNotRestoredSentence(leftOut.map((camera) => cameraModel(camera)));
}
