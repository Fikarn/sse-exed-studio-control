// The cameras a scenario of `fixtures.json` starts with, as the double's seed takes them
// (`FixtureCamerasSeed` in the engine client). A JSON file says `camera: 2` as a number;
// the seed takes one of the three cameras, so the scenario's cameras are read here, and a
// camera that is none of the three is the scenario's mistake.

export type FixtureCameraNumber = 1 | 2 | 3;

/** Values a simulated camera reports that differ from board 2's (`FixtureCameraValuesSeed`). */
export type FixtureCameraValuesSeedRecord = {
  iso?: string;
  shutter?: string;
  iris?: string;
  nd?: string;
  resolution?: string;
  frameRate?: string;
  dynamicRange?: string;
  displayLut?: string;
  whiteBalance?: number;
  tint?: number;
  focus?: number;
  displayLutOn?: boolean;
};

/** One camera a scenario starts with (`FixtureCameraSeed`). */
export type FixtureCameraSeedRecord = {
  camera: FixtureCameraNumber;
  address?: string;
  paired?: boolean;
  vmixInput?: number;
  released?: boolean;
  unreachable?: boolean;
  recording?: boolean;
  values?: FixtureCameraValuesSeedRecord;
};

/** The cameras a scenario starts with (`FixtureCamerasSeed`). */
export type FixtureCamerasSeedRecord = {
  cameras?: FixtureCameraSeedRecord[];
  selected?: FixtureCameraNumber;
  bank?: FixtureCameraDialBank;
  simulated?: boolean;
};

/** What the deck's dials set (`CameraDialBank`). */
export type FixtureCameraDialBank = "exposure" | "colour" | "focus";

/** A scenario's `cameras` as the JSON file holds it: a camera's number is any number. */
export type RawCamerasRecord = {
  cameras?: Array<Omit<FixtureCameraSeedRecord, "camera"> & { camera: number }>;
  selected?: number;
  bank?: string;
  simulated?: boolean;
};

function cameraNumber(scenario: string, value: number, what: string): FixtureCameraNumber {
  if (value === 1 || value === 2 || value === 3) return value;
  throw new Error(`Fixture '${scenario}': ${what} is ${String(value)}; the cameras are 1, 2 and 3.`);
}

/** A scenario's `cameras` made the double's seed. */
export function expandCamerasRecord(scenario: string, raw: RawCamerasRecord): FixtureCamerasSeedRecord {
  const seed: FixtureCamerasSeedRecord = {};
  if (raw.cameras !== undefined) {
    seed.cameras = raw.cameras.map((entry, index) => ({
      ...entry,
      camera: cameraNumber(scenario, entry.camera, `cameras[${index}].camera`),
    }));
  }
  if (raw.selected !== undefined) seed.selected = cameraNumber(scenario, raw.selected, "selected");
  if (raw.bank !== undefined) {
    if (raw.bank !== "exposure" && raw.bank !== "colour" && raw.bank !== "focus") {
      throw new Error(`Fixture '${scenario}': bank is ${raw.bank}; the banks are exposure, colour and focus.`);
    }
    seed.bank = raw.bank;
  }
  if (raw.simulated !== undefined) seed.simulated = raw.simulated;
  return seed;
}
