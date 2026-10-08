// Part of the fixture double (`../fixtureTransport.ts`): the in-memory stand-in for the
// hardware link that Playwright and the browser fixture mode run against. Test-only.
import type { CameraAutos } from "../../generated/snapshots/CameraAutos";
import type { CameraDialBank } from "../../generated/snapshots/CameraDialBank";
import type { CameraLink } from "../../generated/snapshots/CameraLink";
import type { CameraUnavailable } from "../../generated/snapshots/CameraUnavailable";

// The three cameras as the hardware link knows them (`native/rust-engine/src/cameras/`, new
// pages program, Slice 8; `v1.md`'s "Cameras"): which camera is which, and what each
// simulated camera reports — board 2's assumptions (the slice's first step 4, in the
// ledger): CAM 1, the Pocket 6K Pro, every value D10 lists; CAM 2 and CAM 3, the BGH1s, no
// tint, focus position, ND, dynamic range or display LUT, and no recording. Each camera's
// model says what it reports, so Slices 11 and 13 can narrow or widen it; the options are
// the camera's model and stay when it is not read, the values are what it reports.

export type CameraNumber = 1 | 2 | 3;
export const CAMERA_NUMBERS: readonly CameraNumber[] = [1, 2, 3];

/** A setting chosen from a list, in the camera's own words. */
export type ChoiceSetting =
  "iso" | "shutter" | "iris" | "nd" | "resolution" | "frameRate" | "dynamicRange" | "displayLut";
/** A setting on a scale. */
export type LevelSetting = "whiteBalance" | "tint" | "focus";
export type CameraSetting = ChoiceSetting | LevelSetting | "displayLutOn";

export const CHOICE_SETTINGS: readonly ChoiceSetting[] = [
  "iso",
  "shutter",
  "iris",
  "nd",
  "resolution",
  "frameRate",
  "dynamicRange",
  "displayLut",
];
export const LEVEL_SETTINGS: readonly LevelSetting[] = ["whiteBalance", "tint", "focus"];

/** What `cameras.set` and `cameras.step` take: one press on a held camera (D11). */
export type PressSetting = "iso" | "shutter" | "iris" | "nd" | "whiteBalance" | "tint" | "focus";
export const PRESS_SETTINGS: readonly PressSetting[] = [
  "iso",
  "shutter",
  "iris",
  "nd",
  "whiteBalance",
  "tint",
  "focus",
];

/** The one-shot autos (`cameras.auto`'s `what`). */
/** What the Stream Deck's four dials set on the selected camera (D14; `CameraDialBank`). */
export const DIAL_BANKS: readonly CameraDialBank[] = ["exposure", "colour", "focus"];

/** The setting each dial sets in a bank, left to right (`CameraDialBank::dials`). */
export const DIAL_BANK_SETS: Readonly<Record<CameraDialBank, ReadonlyArray<PressSetting | null>>> = {
  exposure: ["iso", "shutter", "iris", "nd"],
  colour: ["whiteBalance", "tint", null, null],
  focus: ["focus", null, null, null],
};

export type AutoWhat = keyof CameraAutos;
export const AUTO_WHATS: readonly AutoWhat[] = ["focus", "whiteBalance", "iris"];

/** Each setting's name in a sentence (`CAM 1 does not allow ISO 450.`). */
export const SETTING_LABELS: Record<ChoiceSetting | LevelSetting, string> = {
  iso: "ISO",
  shutter: "shutter",
  iris: "iris",
  nd: "ND",
  whiteBalance: "white balance",
  tint: "tint",
  focus: "focus",
  resolution: "resolution",
  frameRate: "frame rate",
  dynamicRange: "dynamic range",
  displayLut: "display LUT",
};

/** A setting the camera does not report, and why, in its own terms. */
export interface NotReported {
  notReported: string;
}
export interface ChoiceModel {
  options: readonly string[];
  /** What the simulated camera starts with. */
  start: string;
}
export interface LevelModel {
  min: number;
  max: number;
  step: number;
  /** `K` for white balance; empty otherwise. */
  unit: string;
  start: number;
}

export interface CameraModel {
  camera: CameraNumber;
  /** `CAM 1`, `CAM 2`, `CAM 3`. */
  tag: string;
  /** The camera's make and model. */
  model: string;
  link: CameraLink;
  /** Who a release hands it to: LUMIX Tether (CAM 2, CAM 3); `null` for CAM 1, which a release leaves alone. */
  app: string | null;
  /** CAM 1 alone records (D10, D14). */
  records: boolean;
  choices: Record<ChoiceSetting, ChoiceModel | NotReported>;
  levels: Record<LevelSetting, LevelModel | NotReported>;
  displayLutOn: { start: boolean } | NotReported;
  /** Why it takes no change to its display LUT though it reports it; `null` when it takes one (finding 16). */
  displayLutLock: string | null;
  /** The one-shot autos it offers. */
  auto: CameraAutos;
  /** Focus moves nearer and farther without a reported position (the BGH1s). */
  focusSteps: boolean;
  timecodeReported: boolean;
  /** The frame rates it does not allow at a resolution, with the reason. */
  unavailableFrameRates: Readonly<Record<string, readonly CameraUnavailable[]>>;
}

export function isReported<T extends object>(model: T | NotReported): model is T {
  return !("notReported" in model);
}

/** `100 125 160 … 25600`, the third-stop ISOs both cameras share. */
const SHARED_ISOS = [
  "100",
  "125",
  "160",
  "200",
  "250",
  "320",
  "400",
  "500",
  "640",
  "800",
  "1000",
  "1250",
  "1600",
  "2000",
  "2500",
  "3200",
  "4000",
  "5000",
  "6400",
  "8000",
  "10000",
  "12800",
  "16000",
  "20000",
  "25600",
];

/** `f/2.8` to `f/16` in third stops: CAM 1's lens and CAM 3's. */
const IRIS_F28_TO_F16 = [
  "f/2.8",
  "f/3.2",
  "f/3.5",
  "f/4.0",
  "f/4.5",
  "f/5.0",
  "f/5.6",
  "f/6.3",
  "f/7.1",
  "f/8.0",
  "f/9.0",
  "f/10",
  "f/11",
  "f/13",
  "f/14",
  "f/16",
];

/** `f/4.0` to `f/22`: CAM 2's lens. */
const IRIS_F4_TO_F22 = [...IRIS_F28_TO_F16.slice(3), "f/18", "f/20", "f/22"];

const POCKET_6K_PRO: CameraModel = {
  camera: 1,
  tag: "CAM 1",
  model: "Blackmagic Pocket Cinema Camera 6K Pro",
  link: "bluetooth",
  app: null,
  records: true,
  choices: {
    iso: { options: SHARED_ISOS, start: "400" },
    shutter: { options: ["45°", "90°", "120°", "144°", "172.8°", "180°", "216°", "270°", "360°"], start: "180°" },
    iris: { options: IRIS_F28_TO_F16, start: "f/2.8" },
    nd: { options: ["Clear", "2 stops", "4 stops", "6 stops"], start: "2 stops" },
    resolution: { options: ["HD", "UHD", "4K DCI", "6K"], start: "6K" },
    frameRate: { options: ["24", "25", "30", "50", "60"], start: "25" },
    dynamicRange: { options: ["Film", "Extended video", "Video"], start: "Film" },
    displayLut: { options: ["None", "Custom", "Film → Video", "Film → Ext. video"], start: "Film → Ext. video" },
  },
  levels: {
    whiteBalance: { min: 2500, max: 10000, step: 50, unit: "K", start: 5600 },
    tint: { min: -50, max: 50, step: 1, unit: "", start: 2 },
    // The Pocket's EF lens reports no position and takes none (finding 15).
    focus: {
      notReported:
        "CAM 1's EF lens reports no focus position and takes none: it moves focus by offsets. Autofocus once works.",
    },
  },
  displayLutOn: { start: true },
  displayLutLock: "CAM 1's display LUT is the camera's own menu's: it reports it and takes no change over Bluetooth.",
  auto: { focus: true, whiteBalance: true, iris: true },
  focusSteps: false,
  timecodeReported: true,
  unavailableFrameRates: { "6K": [{ value: "60", reason: "not at 6K" }] },
};

/** A BGH1: `tag`'s own words for what it does not report, its lens and where it starts. */
function bgh1(
  camera: 2 | 3,
  start: { iso: string; iris: readonly string[]; irisStart: string; whiteBalance: number }
): CameraModel {
  const tag = `CAM ${camera}`;
  const displayLut = { notReported: `${tag} does not report a display LUT.` };
  return {
    camera,
    tag,
    model: "Panasonic LUMIX BGH1",
    link: "network",
    app: "LUMIX Tether",
    records: false,
    choices: {
      iso: { options: [...SHARED_ISOS, "32000", "40000", "51200"], start: start.iso },
      shutter: {
        options: [
          "1/25",
          "1/30",
          "1/40",
          "1/50",
          "1/60",
          "1/80",
          "1/100",
          "1/120",
          "1/125",
          "1/160",
          "1/200",
          "1/250",
          "1/320",
          "1/400",
          "1/500",
          "1/640",
          "1/800",
          "1/1000",
        ],
        start: "1/50",
      },
      iris: { options: start.iris, start: start.irisStart },
      nd: { notReported: "The BGH1 has no ND filter." },
      resolution: { options: ["FHD", "UHD", "C4K"], start: "FHD" },
      frameRate: { options: ["25", "50"], start: "25" },
      dynamicRange: { notReported: `${tag} does not report its dynamic range.` },
      displayLut,
    },
    levels: {
      whiteBalance: { min: 2500, max: 10000, step: 100, unit: "K", start: start.whiteBalance },
      tint: { notReported: `${tag} does not report tint.` },
      focus: { notReported: `${tag} does not report a focus position.` },
    },
    displayLutOn: displayLut,
    displayLutLock: null,
    auto: { focus: true, whiteBalance: false, iris: false },
    focusSteps: true,
    timecodeReported: false,
    unavailableFrameRates: {},
  };
}

export const CAMERA_MODELS: Readonly<Record<CameraNumber, CameraModel>> = {
  1: POCKET_6K_PRO,
  2: bgh1(2, { iso: "800", iris: IRIS_F4_TO_F22, irisStart: "f/4.0", whiteBalance: 5600 }),
  3: bgh1(3, { iso: "1600", iris: IRIS_F28_TO_F16, irisStart: "f/2.8", whiteBalance: 4300 }),
};

export function cameraModel(camera: CameraNumber): CameraModel {
  return CAMERA_MODELS[camera];
}

/** Why a frame rate is not allowed at a resolution; `null` when it is. */
export function frameRateUnavailable(model: CameraModel, resolution: string, frameRate: string): string | null {
  return model.unavailableFrameRates[resolution]?.find((entry) => entry.value === frameRate)?.reason ?? null;
}

/** A level's value on its step: `min` plus a whole number of steps, within its range. */
export function levelAllows(level: LevelModel, value: number): boolean {
  if (!Number.isFinite(value) || value < level.min - 1e-9 || value > level.max + 1e-9) return false;
  const steps = (value - level.min) / level.step;
  return Math.abs(steps - Math.round(steps)) < 1e-6;
}

/** The level `steps` of its steps from `value`, stopping at the ends, kept on its step. */
export function levelStepped(level: LevelModel, value: number, steps: number): number {
  const last = Math.round((level.max - level.min) / level.step);
  const index = Math.min(Math.max(Math.round((value - level.min) / level.step) + steps, 0), last);
  return onStep(level, index);
}

/** The level at step `index` from its minimum, without the float's tail (`0.57`, not `0.5700000000000001`). */
function onStep(level: LevelModel, index: number): number {
  return Number((level.min + index * level.step).toFixed(10));
}

/** A value that is on its step, written as the step writes it. */
export function levelValue(level: LevelModel, value: number): number {
  return onStep(level, Math.round((value - level.min) / level.step));
}

/** The option `steps` from `value` in the camera's list, stopping at the ends. */
export function choiceStepped(choice: ChoiceModel, value: string, steps: number): string {
  const at = Math.max(choice.options.indexOf(value), 0);
  const index = Math.min(Math.max(at + steps, 0), choice.options.length - 1);
  return choice.options[index]!;
}

/**
 * CAM 2's or CAM 3's address as Setup keeps it (`parse_camera_address`, D15 rule 1): an IPv4
 * address of one machine — four decimal numbers from 0 to 255 (no sign), trimmed — not
 * `0.0.0.0`, not the broadcast `255.255.255.255` and not a multicast address
 * (`224.0.0.0/4`); written as the camera's link will use it (`010.0.0.1` is `10.0.0.1`).
 * `null` when it is not one.
 */
export function cameraAddress(value: string): string | null {
  const parts = value.trim().split(".");
  if (parts.length !== 4 || !parts.every((part) => /^[0-9]{1,3}$/.test(part) && Number(part) <= 255)) return null;
  const octets = parts.map(Number);
  if (octets.every((octet) => octet === 0)) return null;
  if (octets.every((octet) => octet === 255)) return null;
  if (octets[0]! >= 224 && octets[0]! <= 239) return null;
  return octets.join(".");
}

/** The battery as the simulated CAM 1 reports it (the Pocket's 9.0: millivolts, percent, flags). */
export interface CameraBattery {
  millivolts: number;
  percent: number;
  /** Bit 0 a battery is in, bit 1 mains power, bit 2 charging, bit 3 an estimate, bit 4 the camera shows the voltage. */
  flags: number;
}

/** `100 % · on mains`, `63 % · charging`, `11.3 V` when the camera shows the voltage (`CameraBattery::text`). */
export function batteryText(battery: CameraBattery): string {
  const level = battery.flags & 0b1_0000 ? `${(battery.millivolts / 1000).toFixed(1)} V` : `${battery.percent} %`;
  if (battery.flags & 0b100) return `${level} · charging`;
  if (battery.flags & 0b10) return `${level} · on mains`;
  return level;
}

/** `17 h 00 min`, `45 min`: the record time left as the page prints it (`record_time_text`). */
export function recordTimeText(minutes: number): string {
  if (minutes >= 60) return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
  return `${minutes} min`;
}

/** Why there is no record time though the camera was read: no medium it can record to. */
export function noRecordTimeSentence(model: CameraModel): string {
  return `${model.tag} reports no record time: no medium it can record to.`;
}
