// Part of the fixture double (`../fixtureTransport.ts`): the in-memory stand-in for the
// hardware link that Playwright and the browser fixture mode run against. Test-only.
import type { CameraState } from "../../generated/snapshots/CameraState";
import type { CameraTone } from "../../generated/snapshots/CameraTone";
import { EngineRequestError } from "../engineRequestError";
import {
  SETTING_LABELS,
  type AutoWhat,
  type CameraModel,
  type CameraNumber,
  type ChoiceSetting,
  type LevelSetting,
} from "./camerasModel";

// The operator's words for the cameras (new pages program, Slice 8): each state's word,
// tone and sentence, the refusals with their codes, and the Recent actions' sentences, word
// for word as the hardware link says them (`native/rust-engine/src/cameras/`).
// `camerasWords.test.ts` holds each one to a string literal of the Rust source, filled from
// the source's own tables, so a sentence reworded on one side only fails.

/** Each state's word (`HELD`, `RELEASED`, `NOT SET UP`, `UNREACHABLE`). */
export const STATE_WORDS: Record<CameraState, string> = {
  held: "HELD",
  released: "RELEASED",
  "not-set-up": "NOT SET UP",
  unreachable: "UNREACHABLE",
};

/** Each state's tone: the lamp's colour (D19). */
export const STATE_TONES: Record<CameraState, CameraTone> = {
  held: "ok",
  released: "attention",
  "not-set-up": "attention",
  unreachable: "error",
};

/** `CameraState`'s declared order, worst last: the check reads the worst camera. */
export const STATE_RANK: Record<CameraState, number> = { held: 0, released: 1, "not-set-up": 2, unreachable: 3 };

export function heldSentence(model: CameraModel): string {
  return `${model.tag} is held: Studio Control reads it and sends only what you press.`;
}

export function releasedSentence(model: CameraModel): string {
  return `${model.tag} is released to ${model.app}. Connect it to control it here.`;
}

/** A camera that is not set up; in a build with no link to it, that there is none yet, not what to enter. */
export function notSetUpSentence(model: CameraModel, hasLink = true): string {
  if (!hasLink) return noLinkSentence(model);
  return model.camera === 1
    ? "CAM 1 is not paired. Pair it in Setup, with the camera beside you."
    : `${model.tag} has no address. Enter it in Setup.`;
}

/** A held camera that does not answer: over Bluetooth (CAM 1), or at its address. */
export function unreachableSentence(model: CameraModel, address: string | null): string {
  return model.camera === 1
    ? "CAM 1 does not answer over Bluetooth. Check it is on and within reach."
    : `${model.tag} does not answer at ${address ?? "its address"}. Check that it is on and on the network.`;
}

/** A camera in a build with no link to it: CAM 2 and CAM 3 before Slice 13 brings theirs. */
export function noLinkSentence(model: CameraModel): string {
  return `Studio Control has no link to ${model.tag} yet: it comes with a later version.`;
}

// ---------------------------------------------------------------------------
// Refusals: the code and the sentence, as the Tauri transport throws them
// ---------------------------------------------------------------------------

export function invalidParams(message: string): EngineRequestError {
  return new EngineRequestError("INVALID_PARAMS", message);
}

export function notSetUpRefusal(model: CameraModel, hasLink = true): EngineRequestError {
  return new EngineRequestError("CAMERA_NOT_SET_UP", notSetUpSentence(model, hasLink));
}

export function releasedRefusal(model: CameraModel): EngineRequestError {
  return new EngineRequestError("CAMERA_RELEASED", `${model.tag} is released. Connect it to set it from here.`);
}

/** The camera's own unreachable sentence: `sentence` is what its state says. */
export function unreachableRefusal(sentence: string): EngineRequestError {
  return new EngineRequestError("CAMERA_UNREACHABLE", sentence);
}

export function alreadyHeldRefusal(model: CameraModel): EngineRequestError {
  return new EngineRequestError("CAMERA_ALREADY_HELD", `${model.tag} is already held.`);
}

export const NO_LINK_SENTENCE = "Studio Control cannot pair CAM 1 yet: its Bluetooth link comes with a later version.";

/** Why Setup cannot pair the camera (CAM 1) or take its address (CAM 2, CAM 3) in a build with no link to it. */
export function noLinkRefusalSentence(model: CameraModel): string {
  return model.camera === 1
    ? NO_LINK_SENTENCE
    : `Studio Control cannot take ${model.tag}'s address yet: its network link comes with a later version.`;
}

export function noLinkRefusal(model: CameraModel): EngineRequestError {
  return new EngineRequestError("CAMERA_NO_LINK", noLinkRefusalSentence(model));
}

// CAM 1's pairing (the Pocket's link, part 5, 2026-10-06; `pocket/pairing.rs`): `Pair CAM 1`
// begins it, the camera shows a 6-digit PIN, and the PIN it shows pairs it.

/** The PIN the simulated CAM 1 shows (`SIMULATED_PIN`). */
export const SIMULATED_PIN = "123456";

/** Each running step's sentence, as Setup shows it. */
export const PAIRING_SENTENCES = {
  finding: "Looking for CAM 1. Switch its Bluetooth on, with the iPad's app closed.",
  pin: "CAM 1 shows a 6-digit PIN. Enter it here.",
  pairing: "Pairing with CAM 1…",
} as const;

/** A PIN that is not the camera's: the pairing fails, and nothing is saved. */
export const PIN_REFUSED_SENTENCE = "CAM 1 did not accept the PIN. Press Pair CAM 1 to try again.";

export const PIN_INVALID_MESSAGE = "pin must be the 6 digits CAM 1 shows.";

/** `CAMERA_PAIRING_NOT_WANTED`: a PIN with no pairing waiting for one. */
export function pairingNotWantedRefusal(): EngineRequestError {
  return new EngineRequestError(
    "CAMERA_PAIRING_NOT_WANTED",
    "CAM 1's pairing does not wait for a PIN now. Press Pair CAM 1 first."
  );
}

/** A setting the camera does not report: its not-reported sentence. */
export function unsupportedRefusal(sentence: string): EngineRequestError {
  return new EngineRequestError("CAMERA_SETTING_UNSUPPORTED", sentence);
}

const AUTO_WORDS: Record<AutoWhat, string> = {
  focus: "autofocus",
  whiteBalance: "auto white balance",
  iris: "auto iris",
};

/** A one-shot auto the camera does not offer. */
export function autoNotOfferedRefusal(model: CameraModel, what: AutoWhat): EngineRequestError {
  return unsupportedRefusal(`${model.tag} does not offer ${AUTO_WORDS[what]} once.`);
}

/** A value the camera does not allow; a level's as it was sent. */
export function notAllowedRefusal(
  model: CameraModel,
  setting: ChoiceSetting | LevelSetting,
  value: string | number
): EngineRequestError {
  return new EngineRequestError(
    "CAMERA_VALUE_NOT_ALLOWED",
    `${model.tag} does not allow ${SETTING_LABELS[setting]} ${String(value)}.`
  );
}

export function formatNotAllowedRefusal(model: CameraModel, frameRate: string, resolution: string): EngineRequestError {
  return new EngineRequestError(
    "CAMERA_FORMAT_NOT_ALLOWED",
    `${model.tag} does not allow ${frameRate}p at ${resolution}.`
  );
}

export const NOT_CONFIRMED_SENTENCE = "This change needs a second press to confirm.";

export function notConfirmedRefusal(): EngineRequestError {
  return new EngineRequestError("CAMERA_CHANGE_NOT_CONFIRMED", NOT_CONFIRMED_SENTENCE);
}

export function alreadyRecordingRefusal(): EngineRequestError {
  return new EngineRequestError("CAMERA_ALREADY_RECORDING", "CAM 1 is already recording.");
}

export function notRecordingRefusal(): EngineRequestError {
  return new EngineRequestError("CAMERA_NOT_RECORDING", "CAM 1 is not recording.");
}

export function addressInvalidRefusal(value: string): EngineRequestError {
  return new EngineRequestError(
    "CAMERA_ADDRESS_INVALID",
    `${value} is not the address of one machine. Enter the camera's IPv4 address: four numbers from 0 to 255, such as 172.16.16.85.`
  );
}

// ---------------------------------------------------------------------------
// What happened: the answers' sentences and the Recent actions rows
// ---------------------------------------------------------------------------

export function startedRecordingSentence(model: CameraModel): string {
  return `${model.tag} started recording.`;
}

export function stoppedRecordingSentence(model: CameraModel): string {
  return `${model.tag} stopped recording.`;
}

/** `CAM 1: 6K → UHD.`, `CAM 1: 25p → 50p.`, both `CAM 1: 6K 25p → UHD 50p.` */
export function formatSentence(
  model: CameraModel,
  resolution: { from: string; to: string } | null,
  frameRate: { from: string; to: string } | null
): string {
  const from = [resolution?.from, frameRate ? `${frameRate.from}p` : undefined].filter(Boolean).join(" ");
  const to = [resolution?.to, frameRate ? `${frameRate.to}p` : undefined].filter(Boolean).join(" ");
  return `${model.tag}: ${from} → ${to}.`;
}

/** One part of a look change: `dynamic range Film → Video`, `display LUT … → …`, `display LUT off`. */
export function lookPart(
  change:
    { setting: "dynamicRange" | "displayLut"; from: string; to: string } | { setting: "displayLutOn"; on: boolean }
): string {
  if (change.setting === "displayLutOn") return `display LUT ${change.on ? "on" : "off"}`;
  return `${SETTING_LABELS[change.setting]} ${change.from} → ${change.to}`;
}

/** Several parts of one request joined with `; `: `CAM 1: dynamic range Film → Video; display LUT off.` */
export function lookSentence(model: CameraModel, parts: readonly string[]): string {
  return `${model.tag}: ${parts.join("; ")}.`;
}

/** The release's sentence: its answer and its Recent actions row. */
export function releasedToSentence(model: CameraModel): string {
  return `${model.tag} released to ${model.app}.`;
}

/** Connect's sentence when the camera is held again: its answer and its Recent actions row. */
export function heldAgainSentence(model: CameraModel): string {
  return `${model.tag} held again.`;
}

/**
 * What an archive restore says of the addresses it left out, in a build with no link to
 * those cameras; `null` when it left none out.
 */
export function addressesNotRestoredSentence(models: readonly CameraModel[]): string | null {
  if (models.length === 0) return null;
  const whose = models.map((model) => `${model.tag}'s`).join(" and ");
  const [what, which] = models.length === 1 ? ["address was", "it"] : ["addresses were", "them"];
  return `${whose} ${what} not restored: Studio Control has no link to ${which} yet.`;
}

// ---------------------------------------------------------------------------
// The pictures (`pictures.rs`; D17, D28)
// ---------------------------------------------------------------------------

/** The vMix inputs the simulated cameras' test pictures stand in for (`SIMULATED_VMIX_INPUTS`). */
export const SIMULATED_VMIX_INPUTS = { first: 1, last: 4 } as const;

/** The vMix output each camera's picture comes from, fixed (`VMIX_OUTPUTS`, D31): CAM 1's first. */
export const VMIX_OUTPUTS = [2, 3, 4] as const;

/** A picture that arrives, one that does not, and the three together when not every one does. */
export const PICTURE_WORDS = {
  live: "LIVE",
  noPicture: "NO PICTURE",
  missing: "PICTURE MISSING",
  noPictures: "NO PICTURES",
} as const;

/** What arrives of a test picture, as the page prints it: alone, with no output before it. */
export const PICTURE_SHOWING_DETAIL = "test picture";
export const PICTURE_MISSING_DETAIL = "nothing received";

/**
 * Where the pictures come from (`PictureSource::words`): the simulated cameras' test
 * pictures, or vMix's outputs (the studio's build, which the double shows with vMix sending
 * none of them: it has no vMix).
 */
export function pictureSourceWords(simulated: boolean): string {
  return simulated ? "test pictures" : "vMix Outputs 2 to 4";
}

/** The Pictures section's fine print (`PictureSource::note`). */
export function picturesNote(simulated: boolean): string {
  return simulated
    ? `Test pictures stand in for vMix inputs ${SIMULATED_VMIX_INPUTS.first} to ${SIMULATED_VMIX_INPUTS.last}. A studio build shows vMix's Outputs 2, 3 and 4 over NDI.`
    : `Over NDI from vMix on this PC: CAM 1 from Output ${VMIX_OUTPUTS[0]}, CAM 2 from Output ${VMIX_OUTPUTS[1]}, CAM 3 from Output ${VMIX_OUTPUTS[2]}.`;
}

/** A camera's place while vMix sends none of the three outputs (`PictureSource::detail`). */
export function vmixNothingDetail(camera: CameraNumber): string {
  return `vMix Output ${VMIX_OUTPUTS[camera - 1]} · nothing received`;
}

/** What to check while vMix sends none of the three outputs (`Nothing::NotSending`). */
export const VMIX_NOT_SENDING_ADVICE =
  "Either vMix is closed, or its Outputs 2, 3 and 4 are not sent over NDI (Settings › Outputs).";

/** A camera whose input the source does not send, in the picture's place. */
export function pictureMissingSentence(model: CameraModel): string {
  return `vMix is not sending ${model.tag} over NDI.`;
}

/** What to check under it. */
export function pictureMissingAdvice(vmixInput: number): string {
  return `vMix sends other inputs: check that vMix input ${vmixInput} is still there and live.`;
}

/** The state display while vMix sends none of the three outputs. */
export const NO_PICTURES_SENTENCE = "No pictures from vMix. Open vMix and send Outputs 2, 3 and 4 over NDI.";

/** The state display when a camera's picture is missing. */
export function picturesMissingSentence(model: CameraModel, vmixInput: number): string {
  return `vMix sends no picture for ${model.tag}. Check that vMix input ${vmixInput} is still there and live.`;
}
