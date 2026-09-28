import type {
  CameraChoice,
  CameraLevel,
  CameraNumber,
  CameraPressSetting,
  CameraRecentAction,
  CameraSnapshot,
  CameraState,
  CamerasSnapshot,
} from "@sse/engine-client";

// What the Cameras page shows, worked out from what the hardware link reports
// (`cameras.snapshot`; `native/protocol/v1.md`, "Cameras"). Everything here is
// a reading of that: the page holds no state of a camera's and never shows a
// value that was merely sent (D10). What it adds are the page's own words
// around the hardware link's: the counts, the keys' hints and the reasons a
// key is locked.

export type CameraTone = "ok" | "attention" | "error";

/** `CameraState`'s order, worst last, as the hardware link's check reads it. */
const STATE_RANK: Record<CameraState, number> = { held: 0, released: 1, "not-set-up": 2, unreachable: 3 };

/** A camera's number as the requests take it. */
export function cameraNumber(camera: Pick<CameraSnapshot, "camera">): CameraNumber {
  return camera.camera === 2 ? 2 : camera.camera === 3 ? 3 : 1;
}

/** The selected camera; CAM 1 when the selection names none the snapshot holds. */
export function selectedCamera(snapshot: CamerasSnapshot): CameraSnapshot | null {
  return snapshot.cameras.find((camera) => camera.camera === snapshot.selected) ?? snapshot.cameras[0] ?? null;
}

export function cameraOf(snapshot: CamerasSnapshot, camera: number): CameraSnapshot | null {
  return snapshot.cameras.find((entry) => entry.camera === camera) ?? null;
}

/** `14:02`, the studio's local time of a time the hardware link gave; empty when it is none. */
export function clockTime(isoTime: string | null | undefined): string {
  if (!isoTime) return "";
  const date = new Date(isoTime);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

/** `0:37`, `12:41`, `1:02:05`: whole seconds, minutes unpadded below the hour. */
export function formatTakeLength(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** Who a camera is handed to on Release: the iPad, or LUMIX Tether. */
export function releasedTo(camera: Pick<CameraSnapshot, "link">): string {
  return camera.link === "bluetooth" ? "the iPad" : "LUMIX Tether";
}

/** How the camera is reached: `Bluetooth`, or `network · 172.16.16.85`. */
export function linkLabel(camera: Pick<CameraSnapshot, "link" | "setup">): string {
  if (camera.link === "bluetooth") return "Bluetooth";
  return camera.setup.address ? `network · ${camera.setup.address}` : "network";
}

// ---------------------------------------------------------------------------
// The state display
// ---------------------------------------------------------------------------

/**
 * The camera the state display speaks of: the worst one; among cameras in
 * the same state the selected one, then the lowest number. So the display
 * says what the operator's own camera is doing unless another needs a look.
 */
export function worstCamera(snapshot: CamerasSnapshot): CameraSnapshot | null {
  let worst: CameraSnapshot | null = null;
  for (const camera of snapshot.cameras) {
    if (worst === null) {
      worst = camera;
      continue;
    }
    const rank = STATE_RANK[camera.state] - STATE_RANK[worst.state];
    if (rank > 0 || (rank === 0 && camera.camera === snapshot.selected)) {
      worst = camera;
    }
  }
  return worst;
}

export type CamerasWayOut =
  | { kind: "connect"; camera: CameraNumber; label: string }
  | { kind: "read-again"; camera: CameraNumber; label: string }
  | { kind: "setup"; label: string };

export interface CamerasStateView {
  camera: CameraNumber;
  tone: CameraTone;
  word: string;
  sentence: string;
  meta: string;
  wayOut: CamerasWayOut | null;
}

/** How many of the cameras are held, and what CAM 1's take is known to do. */
function metaLine(snapshot: CamerasSnapshot, spoken: CameraSnapshot): string {
  const held = snapshot.cameras.filter((camera) => camera.state === "held").length;
  const parts = [`${held} of ${snapshot.cameras.length} held`];
  if (spoken.state === "unreachable") {
    const last = clockTime(spoken.readAt);
    parts.unshift(last ? `Last answer ${last}` : "No answer since the start");
  }
  const main = cameraOf(snapshot, 1);
  if (main?.state === "held") {
    parts.push(main.recording.recording === true ? "CAM 1 recording" : "CAM 1 not recording");
  } else if (main?.state === "unreachable" && main.recording.recording === true) {
    parts.push("CAM 1 last known recording");
  } else if (main?.state === "released") {
    parts.push("CAM 1 not read");
  }
  return parts.join(" · ");
}

/** The state display: the worst camera's word and sentence, as the hardware link gives them, and the way out. */
export function camerasStateView(snapshot: CamerasSnapshot): CamerasStateView | null {
  const spoken = worstCamera(snapshot);
  if (!spoken) return null;
  const camera = cameraNumber(spoken);
  const wayOut: CamerasWayOut | null =
    spoken.state === "released"
      ? { kind: "connect", camera, label: `Connect ${spoken.tag}` }
      : spoken.state === "unreachable"
        ? { kind: "read-again", camera, label: `Try ${spoken.tag} again` }
        : spoken.state === "not-set-up"
          ? { kind: "setup", label: "Camera setup" }
          : null;
  return {
    camera,
    tone: spoken.tone,
    word: spoken.word,
    sentence: spoken.sentence,
    meta: metaLine(snapshot, spoken),
    wayOut,
  };
}

// ---------------------------------------------------------------------------
// Recording (CAM 1, whichever camera is selected; D14)
// ---------------------------------------------------------------------------

export type RecKeyView =
  /** One press starts. */
  | { kind: "start"; hint: string }
  /** CAM 1 reports recording: a red lamp and the word; press twice to stop. */
  | { kind: "recording"; hint: string }
  /** CAM 1 does not answer and last reported recording: doubt, and STOP locked. */
  | { kind: "last-known"; hint: string; reason: string }
  /** CAM 1 is not held: locked, with the reason. */
  | { kind: "locked"; hint: string; reason: string };

export function recKeyView(main: CameraSnapshot | null): RecKeyView {
  if (!main) {
    return { kind: "locked", hint: "locked · CAM 1 is not read yet", reason: "CAM 1 has not been read yet." };
  }
  switch (main.state) {
    case "held":
      return main.recording.recording === true
        ? { kind: "recording", hint: "CAM 1 reports recording · press twice to stop" }
        : { kind: "start", hint: "CAM 1 · one press starts" };
    case "unreachable": {
      if (main.recording.recording === true) {
        const last = clockTime(main.readAt);
        return {
          kind: "last-known",
          hint: `last known: recording${last ? ` · ${last}` : ""}`,
          reason: "STOP is locked until CAM 1 answers. The take is left as it was.",
        };
      }
      return { kind: "locked", hint: "locked · CAM 1 does not answer", reason: main.sentence };
    }
    case "released":
      return {
        kind: "locked",
        hint: `locked · CAM 1 is released to ${releasedTo(main)}`,
        reason: main.sentence,
      };
    case "not-set-up":
      return { kind: "locked", hint: "locked · CAM 1 is not set up", reason: main.sentence };
  }
}

export interface TakeReadout {
  id: "length" | "timecode" | "card";
  label: string;
  /** The value, mono; `null` when there is none to print. */
  value: string | null;
  /** What the value is, or why there is none. */
  note: string;
  /** The last thing CAM 1 reported, not a fact now. */
  doubt: boolean;
}

/**
 * What is known about the take. Its length is Studio Control's own count from
 * the start it saw, and says so; the timecode is CAM 1's; the card's time is
 * what CAM 1 reports, or why it does not.
 */
export function takeReadouts(main: CameraSnapshot | null, nowMs: number): TakeReadout[] {
  const notRead =
    !main || main.state === "not-set-up"
      ? "CAM 1 is not set up"
      : main.state === "released"
        ? "not read while released"
        : null;
  const recording = main?.recording ?? null;
  const unreachable = main?.state === "unreachable";

  let length: Pick<TakeReadout, "value" | "note">;
  if (notRead !== null) {
    length = { value: null, note: notRead };
  } else if (unreachable) {
    length = {
      value: null,
      note: recording?.recording === true ? "not counted · CAM 1 does not answer" : "CAM 1 does not answer",
    };
  } else if (recording?.recording !== true) {
    length = { value: null, note: "not recording" };
  } else if (recording.startedAt && !Number.isNaN(Date.parse(recording.startedAt))) {
    const started = Date.parse(recording.startedAt);
    length = {
      value: formatTakeLength((nowMs - started) / 1000),
      note: `counted here since ${clockTime(recording.startedAt)}`,
    };
  } else {
    length = { value: null, note: "not known · the take started before Studio Control looked" };
  }

  let timecode: Pick<TakeReadout, "value" | "note" | "doubt">;
  if (notRead !== null) {
    timecode = { value: null, note: notRead, doubt: false };
  } else if (recording?.timecodeReported !== true) {
    timecode = { value: null, note: "CAM 1 does not report it", doubt: false };
  } else if (!recording.timecode) {
    timecode = { value: null, note: unreachable ? "CAM 1 does not answer" : "not read yet", doubt: false };
  } else {
    timecode = { value: recording.timecode, note: unreachable ? "last read" : "", doubt: unreachable };
  }

  const card: Pick<TakeReadout, "value" | "note"> = recording?.cardTimeLeft
    ? { value: recording.cardTimeLeft, note: "" }
    : { value: null, note: recording?.cardTimeNotReported ?? notRead ?? "not reported" };

  return [
    { id: "length", label: "Take length", doubt: false, ...length },
    { id: "timecode", label: "Timecode", ...timecode },
    { id: "card", label: "Card time left", doubt: false, ...card },
  ];
}

/** The footer's words for the take. */
export function recordingWord(main: CameraSnapshot | null, stopArmed: boolean, nowMs: number): string {
  const key = recKeyView(main);
  if (!main || main.state === "not-set-up") return "CAM 1 · not set up";
  if (main.state === "released") return "CAM 1 · not read while released";
  if (key.kind === "last-known") {
    const last = clockTime(main.readAt);
    return `CAM 1 · last known recording${last ? ` at ${last}` : ""}`;
  }
  if (main.state === "unreachable") return "CAM 1 · does not answer";
  if (key.kind !== "recording") return "CAM 1 · stopped";
  if (stopArmed) return "CAM 1 · recording · stop armed";
  const length = takeReadouts(main, nowMs)[0];
  return length?.value ? `CAM 1 · recording · ${length.value} counted here` : "CAM 1 · recording · length not known";
}

// ---------------------------------------------------------------------------
// The three cameras' keys
// ---------------------------------------------------------------------------

export interface CameraKeyView {
  camera: CameraNumber;
  tag: string;
  /** The make and how it is reached: `Panasonic LUMIX BGH1 · network · 172.16.16.85`. */
  meta: string;
  state: CameraState;
  /** The state's word in the key's lower case (`held`, `not set up`). */
  word: string;
  tone: CameraTone;
  /** What the camera reports, as one line. */
  values: string;
  /** How the line is printed: as values, as doubt (last read), or as a plain sentence. */
  valuesKind: "values" | "doubt" | "plain";
  /** `REC` while CAM 1 reports recording; `last known REC` when it does not answer. */
  rec: "recording" | "last-known" | null;
  selected: boolean;
}

/** The values a camera reports, in its own words: `ISO 400 · 180° · f/2.8 · 5600 K`. */
export function valuesLine(camera: CameraSnapshot): string {
  const { iso, shutter, iris, whiteBalance } = camera.values;
  const parts: string[] = [];
  if (iso.reported && iso.value !== null) parts.push(`ISO ${iso.value}`);
  if (shutter.reported && shutter.value !== null) parts.push(shutter.value);
  if (iris.reported && iris.value !== null) parts.push(iris.value);
  if (whiteBalance.reported && whiteBalance.value !== null) {
    parts.push(`${whiteBalance.value}${whiteBalance.unit ? ` ${whiteBalance.unit}` : ""}`);
  }
  return parts.join(" · ");
}

export function cameraKeyView(camera: CameraSnapshot, selected: number): CameraKeyView {
  let values: string;
  let valuesKind: CameraKeyView["valuesKind"];
  if (camera.state === "held") {
    values = valuesLine(camera) || "nothing read yet";
    valuesKind = values === "nothing read yet" ? "plain" : "values";
  } else if (camera.state === "unreachable") {
    const last = clockTime(camera.readAt);
    const line = valuesLine(camera);
    values = line ? `last read${last ? ` ${last}` : ""} · ${line}` : "never read since the start";
    valuesKind = line ? "doubt" : "plain";
  } else if (camera.state === "released") {
    values = "not read while released";
    valuesKind = "plain";
  } else {
    values = camera.link === "bluetooth" ? "not paired" : "no address";
    valuesKind = "plain";
  }
  const recording = camera.recording.records && camera.recording.recording === true;
  return {
    camera: cameraNumber(camera),
    tag: camera.tag,
    meta: `${camera.model} · ${linkLabel(camera)}`,
    state: camera.state,
    word: camera.word.toLowerCase(),
    tone: camera.tone,
    values,
    valuesKind,
    rec: !recording ? null : camera.state === "unreachable" ? "last-known" : "recording",
    selected: camera.camera === selected,
  };
}

// ---------------------------------------------------------------------------
// The plate: the selected camera
// ---------------------------------------------------------------------------

/** Why the selected camera's controls are locked; `null` while it is held. */
export function controlsLock(camera: CameraSnapshot): string | null {
  return camera.state === "held" ? null : camera.sentence;
}

/** What a section's head says beside its title. */
export function sectionDetail(camera: CameraSnapshot, held: string): string {
  switch (camera.state) {
    case "held":
      return held;
    case "released":
      return "not read while released";
    case "unreachable": {
      const last = clockTime(camera.readAt);
      return last ? `locked · last read ${last}` : "locked · never read";
    }
    case "not-set-up":
      return "not set up";
  }
}

export interface ChoiceRowView {
  setting: Extract<CameraPressSetting, "iso" | "shutter" | "iris" | "nd">;
  label: string;
  choice: CameraChoice;
}

export interface LevelRowView {
  setting: Extract<CameraPressSetting, "whiteBalance" | "tint">;
  label: string;
  level: CameraLevel;
}

export function exposureRows(camera: CameraSnapshot): ChoiceRowView[] {
  return [
    { setting: "iso", label: "ISO", choice: camera.values.iso },
    { setting: "shutter", label: "Shutter", choice: camera.values.shutter },
    { setting: "iris", label: "Iris", choice: camera.values.iris },
    { setting: "nd", label: "ND", choice: camera.values.nd },
  ];
}

export function colourRows(camera: CameraSnapshot): LevelRowView[] {
  return [
    { setting: "whiteBalance", label: "White balance", level: camera.values.whiteBalance },
    { setting: "tint", label: "Tint", level: camera.values.tint },
  ];
}

/** A level's value with its sign and unit: `5600 K`, `+2`, `0`. */
export function levelText(level: CameraLevel, signed: boolean): string {
  if (level.value === null) return "—";
  const number = signed && level.value > 0 ? `+${level.value}` : String(level.value);
  return level.unit ? `${number} ${level.unit}` : number;
}

/** A shutter's unit, from how the camera writes it: an angle (`180°`) or a speed (`1/50`). */
export function shutterUnit(value: string | null): string | null {
  if (value === null) return null;
  if (value.endsWith("°")) return "angle";
  return value.includes("/") ? "speed" : null;
}

/** Why a step key is locked at an end of the camera's own values; `null` when it can step. */
export function choiceStepLock(choice: CameraChoice, tag: string, label: string, step: 1 | -1): string | null {
  if (!choice.reported || choice.value === null) return null;
  const index = choice.options.indexOf(choice.value);
  if (index < 0) return null;
  if (step < 0 && index === 0) return `${label} is at the lowest value ${tag} allows.`;
  if (step > 0 && index === choice.options.length - 1) return `${label} is at the highest value ${tag} allows.`;
  return null;
}

export function levelStepLock(level: CameraLevel, tag: string, label: string, step: 1 | -1): string | null {
  if (!level.reported || level.value === null) return null;
  if (step < 0 && level.value <= level.min) return `${label} is at the lowest value ${tag} allows.`;
  if (step > 0 && level.value >= level.max) return `${label} is at the highest value ${tag} allows.`;
  return null;
}

/** Why a frame rate cannot be chosen now (`not at 6K`); `null` when it can. */
export function unavailableReason(choice: CameraChoice, value: string): string | null {
  return choice.unavailable.find((entry) => entry.value === value)?.reason ?? null;
}

// ---------------------------------------------------------------------------
// The Recent list and the footer
// ---------------------------------------------------------------------------

/** Who did it, in the operator's words; a source without a word is printed as it was saved. */
const SOURCE_WORDS: Record<string, string> = {
  console: "Console",
  deck: "Stream Deck",
  launch: "Start-up",
  ui: "Screen",
};

export interface RecentRowView {
  id: number;
  time: string;
  text: string;
  source: string;
}

export function recentRows(recent: readonly CameraRecentAction[]): RecentRowView[] {
  return recent.map((row) => ({
    id: row.id,
    time: clockTime(row.at),
    text: row.detail,
    source: SOURCE_WORDS[row.source] ?? row.source,
  }));
}

/**
 * What a read of the cameras says, leaving out what moves with every read
 * (when each camera last answered, CAM 1's timecode): two reads with the same
 * print say that nothing has changed.
 */
export function camerasFingerprint(snapshot: CamerasSnapshot | null | undefined): string {
  if (!snapshot) return "";
  return JSON.stringify(
    snapshot.cameras.map((camera) => ({
      camera: camera.camera,
      state: camera.state,
      sentence: camera.sentence,
      setup: camera.setup,
      values: Object.entries(camera.values).map(([setting, entry]) => [setting, entry.value]),
      recording: camera.recording.recording,
      startedAt: camera.recording.startedAt,
    }))
  );
}

/** `3 / 3 held`, or the first camera that is not: `2 / 3 held · CAM 3 unreachable`. */
export function heldWord(snapshot: CamerasSnapshot): string {
  const held = snapshot.cameras.filter((camera) => camera.state === "held").length;
  const spoken = worstCamera(snapshot);
  const total = snapshot.cameras.length;
  return spoken && spoken.state !== "held"
    ? `${held} / ${total} held · ${spoken.tag} ${spoken.word.toLowerCase()}`
    : `${held} / ${total} held`;
}
