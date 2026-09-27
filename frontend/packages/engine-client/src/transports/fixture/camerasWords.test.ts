/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { CameraState } from "../../generated/snapshots/CameraState";
import { CAMERA_ACTIONS } from "./actionLog";
import { CAMERA_MODELS, CHOICE_SETTINGS, isReported, type CameraNumber, type ChoiceSetting } from "./camerasModel";
import { SIMULATED_AUTO } from "./camerasRequests";
import { startingReport } from "./camerasState";
import {
  NOT_CONFIRMED_SENTENCE,
  NO_LINK_SENTENCE,
  STATE_TONES,
  STATE_WORDS,
  addressInvalidRefusal,
  alreadyHeldRefusal,
  alreadyRecordingRefusal,
  autoNotOfferedRefusal,
  formatNotAllowedRefusal,
  formatSentence,
  heldAgainSentence,
  heldSentence,
  lookPart,
  lookSentence,
  noLinkSentence,
  notAllowedRefusal,
  notRecordingRefusal,
  notSetUpSentence,
  releasedRefusal,
  releasedSentence,
  releasedToSentence,
  startedRecordingSentence,
  stoppedRecordingSentence,
  unreachableSentence,
} from "./camerasWords";
import { openCamerasDouble } from "./camerasTestSupport";

// The fixture double's words for the cameras (new pages program, Slice 8) are the hardware
// link's. They are held here twice: to the slice's build brief, sentence by sentence, and
// to the hardware link's own source (`native/rust-engine/src/cameras/`, above its tests),
// as `prompterScreen.test.ts` holds the Prompter XL's to `screen.rs` — so a sentence
// reworded on one side only fails. The Rust source is also read for what the simulated
// cameras hold: each choice's options, where each camera starts, where a one-shot auto
// settles, and the Recent actions' action names (`action_log.rs`).

const [CAM1, CAM2, CAM3] = [CAMERA_MODELS[1], CAMERA_MODELS[2], CAMERA_MODELS[3]];

describe("the fixture double's camera words: the brief's", () => {
  it("names each state with its word, tone and sentence", () => {
    expect(STATE_WORDS).toEqual({
      held: "HELD",
      released: "RELEASED",
      "not-set-up": "NOT SET UP",
      unreachable: "UNREACHABLE",
    });
    expect(STATE_TONES).toEqual({ held: "ok", released: "attention", "not-set-up": "attention", unreachable: "error" });
    expect(heldSentence(CAM2)).toBe("CAM 2 is held: Studio Control reads it and sends only what you press.");
    expect(releasedSentence(CAM1)).toBe(
      "CAM 1 is released to the iPad. Studio Control does not read it or send it anything until you connect it again."
    );
    expect(releasedSentence(CAM3)).toBe(
      "CAM 3 is released to LUMIX Tether. Studio Control does not read it or send it anything until you connect it again."
    );
    expect(notSetUpSentence(CAM1)).toBe("CAM 1 is not paired. Pair it in Setup, with the camera beside you.");
    expect(notSetUpSentence(CAM2)).toBe("CAM 2 has no address. Enter it in Setup.");
    expect(unreachableSentence(CAM1, null)).toBe(
      "CAM 1 does not answer over Bluetooth. Check that it is on and within reach of this PC."
    );
    expect(unreachableSentence(CAM3, "172.16.16.85")).toBe(
      "CAM 3 does not answer at 172.16.16.85. Check that it is on and on the network."
    );
    expect(noLinkSentence(CAM2)).toBe("Studio Control has no link to CAM 2 yet: it comes with a later version.");
  });

  it("refuses in the brief's words, with its codes", () => {
    const pair = (error: { code: string; message: string }) => [error.code, error.message];
    expect(pair(releasedRefusal(CAM2))).toEqual([
      "CAMERA_RELEASED",
      "CAM 2 is released. Connect it to set it from here.",
    ]);
    expect(pair(alreadyHeldRefusal(CAM3))).toEqual(["CAMERA_ALREADY_HELD", "CAM 3 is already held."]);
    expect(NO_LINK_SENTENCE).toBe(
      "Studio Control cannot pair CAM 1 yet: its Bluetooth link comes with a later version."
    );
    expect(pair(autoNotOfferedRefusal(CAM2, "whiteBalance"))).toEqual([
      "CAMERA_SETTING_UNSUPPORTED",
      "CAM 2 does not offer auto white balance once.",
    ]);
    expect(autoNotOfferedRefusal(CAM2, "iris").message).toBe("CAM 2 does not offer auto iris once.");
    expect(autoNotOfferedRefusal(CAM2, "focus").message).toBe("CAM 2 does not offer autofocus once.");
    expect(pair(notAllowedRefusal(CAM1, "frameRate", "48"))).toEqual([
      "CAMERA_VALUE_NOT_ALLOWED",
      "CAM 1 does not allow frame rate 48.",
    ]);
    expect(pair(formatNotAllowedRefusal(CAM1, "60", "6K"))).toEqual([
      "CAMERA_FORMAT_NOT_ALLOWED",
      "CAM 1 does not allow 60p at 6K.",
    ]);
    expect(NOT_CONFIRMED_SENTENCE).toBe("This change needs a second press to confirm.");
    expect(pair(alreadyRecordingRefusal())).toEqual(["CAMERA_ALREADY_RECORDING", "CAM 1 is already recording."]);
    expect(pair(notRecordingRefusal())).toEqual(["CAMERA_NOT_RECORDING", "CAM 1 is not recording."]);
    expect(pair(addressInvalidRefusal("10.0.0"))).toEqual([
      "CAMERA_ADDRESS_INVALID",
      "10.0.0 is not the address of one machine. Enter the camera's IPv4 address: four numbers from 0 to 255, such as 172.16.16.85.",
    ]);
  });

  it("says what changed in the brief's words", () => {
    expect(startedRecordingSentence(CAM1)).toBe("CAM 1 started recording.");
    expect(stoppedRecordingSentence(CAM1)).toBe("CAM 1 stopped recording.");
    expect(formatSentence(CAM1, { from: "6K", to: "UHD" }, null)).toBe("CAM 1: 6K → UHD.");
    expect(formatSentence(CAM1, null, { from: "25", to: "50" })).toBe("CAM 1: 25p → 50p.");
    expect(formatSentence(CAM1, { from: "6K", to: "UHD" }, { from: "25", to: "50" })).toBe("CAM 1: 6K 25p → UHD 50p.");
    const range = lookPart({ setting: "dynamicRange", from: "Film", to: "Video" });
    const lut = lookPart({ setting: "displayLut", from: "Film → Ext. video", to: "Custom" });
    expect(lookSentence(CAM1, [range])).toBe("CAM 1: dynamic range Film → Video.");
    expect(lookSentence(CAM1, [lut])).toBe("CAM 1: display LUT Film → Ext. video → Custom.");
    expect(lookSentence(CAM1, [lookPart({ setting: "displayLutOn", on: false })])).toBe("CAM 1: display LUT off.");
    expect(lookSentence(CAM1, [lookPart({ setting: "displayLutOn", on: true })])).toBe("CAM 1: display LUT on.");
    expect(lookSentence(CAM1, [range, lookPart({ setting: "displayLutOn", on: false })])).toBe(
      "CAM 1: dynamic range Film → Video; display LUT off."
    );
    expect(releasedToSentence(CAM1)).toBe("CAM 1 released to the iPad.");
    expect(releasedToSentence(CAM2)).toBe("CAM 2 released to LUMIX Tether.");
    expect(heldAgainSentence(CAM2)).toBe("CAM 2 held again.");
  });

  it("never says engine, backend, transport, IPC or snapshot to the operator", () => {
    const sentences = everyDoubleSentence();
    for (const sentence of sentences) {
      expect(sentence, sentence).not.toMatch(/\b(engine|backend|transport|IPC|snapshot)\b/i);
    }
  });
});

// ---------------------------------------------------------------------------
// The hardware link's own source
// ---------------------------------------------------------------------------

const RUST_SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../../native/rust-engine/src");

/** A file of the hardware link, above its test module. */
function rustSource(path: string): string {
  const source = readFileSync(resolve(RUST_SRC, path), "utf-8");
  const tests = source.search(/#\[cfg\(test\)\]\s*mod\s/);
  return tests < 0 ? source : source.slice(0, tests);
}

/**
 * The cameras module's files (`cameras.rs` and `cameras/`), its own tests left out. Loud
 * when the files this guard reads are gone: they were renamed, and this test needs to follow.
 */
const CAMERAS_RS = (() => {
  const files = readdirSync(resolve(RUST_SRC, "cameras")).filter(
    (name) => name.endsWith(".rs") && !name.startsWith("tests") && name !== "test_support.rs"
  );
  for (const needed of ["model.rs", "commands.rs", "simulated.rs", "runtime.rs"]) {
    if (!files.includes(needed))
      throw new Error(`cameras/${needed} is not in the hardware link any more; update this test`);
  }
  return [rustSource("cameras.rs"), ...files.map((name) => rustSource(`cameras/${name}`))]
    .map((source) => source.replace(/^\s*\/\/.*$/gm, ""))
    .join("\n");
})();

/** Every string literal the cameras' source holds, unescaped. */
const LITERALS = [...CAMERAS_RS.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1]!.replace(/\\(["\\])/g, "$1"));

interface Pattern {
  source: string;
  /** How many characters of it are written out, not filled in. */
  fixed: number;
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A literal as a pattern: each `format!` placeholder is anything, `{{` and `}}` are braces. */
function patternOf(literal: string, fill?: { index: number; with: Pattern }): Pattern {
  let source = "";
  let fixed = 0;
  let hole = 0;
  for (const part of literal.split(/(\{\{|\}\}|\{[^{}]*\})/)) {
    if (part === "{{" || part === "}}") {
      source += escapeRegex(part[0]!);
      fixed += 1;
    } else if (/^\{[^{}]*\}$/.test(part)) {
      if (fill && hole === fill.index) {
        source += fill.with.source;
        fixed += fill.with.fixed;
      } else {
        source += "(.+?)";
      }
      hole += 1;
    } else {
      source += escapeRegex(part);
      fixed += part.replace(/\s/g, "").length;
    }
  }
  return { source, fixed };
}

const PATTERNS = LITERALS.map((literal) => ({ literal, ...patternOf(literal) }));
const matches = (pattern: Pattern, sentence: string) => new RegExp(`^${pattern.source}$`, "su").test(sentence);

/**
 * Whether `sentence` is one of the hardware link's literals with its placeholders filled —
 * or, for a sentence it builds from two (`"{}: {change}."` around `"{old} → {new}"`), a short
 * literal with one placeholder filled by another literal.
 */
function inRust(sentence: string): boolean {
  if (PATTERNS.some((pattern) => pattern.fixed >= 8 && matches(pattern, sentence))) return true;
  const outers = PATTERNS.filter((pattern) => pattern.fixed < 8 && pattern.literal.includes("{"));
  const inners = PATTERNS.filter((pattern) => pattern.fixed >= 1 && pattern.literal.includes("{"));
  return outers.some((outer) => {
    const holes = outer.literal.match(/\{[^{}]*\}/g)?.length ?? 0;
    return Array.from({ length: holes }).some((_, index) =>
      inners.some((inner) => {
        const composed = patternOf(outer.literal, { index, with: inner });
        return composed.fixed >= 3 && matches(composed, sentence);
      })
    );
  });
}

/** Every sentence the double's cameras say, one of each kind, filled as the double fills them. */
function everyDoubleSentence(): string[] {
  const sentences: string[] = [];
  for (const model of [CAM1, CAM2, CAM3]) {
    sentences.push(
      heldSentence(model),
      releasedSentence(model),
      notSetUpSentence(model),
      unreachableSentence(model, "172.16.16.85"),
      noLinkSentence(model),
      releasedRefusal(model).message,
      alreadyHeldRefusal(model).message,
      releasedToSentence(model),
      heldAgainSentence(model),
      autoNotOfferedRefusal(model, "focus").message,
      autoNotOfferedRefusal(model, "whiteBalance").message,
      autoNotOfferedRefusal(model, "iris").message,
      formatNotAllowedRefusal(model, "60", "6K").message
    );
    for (const setting of [...CHOICE_SETTINGS, "whiteBalance", "tint", "focus"] as const) {
      sentences.push(notAllowedRefusal(model, setting, "7").message);
    }
    for (const entry of [...Object.values(model.choices), ...Object.values(model.levels), model.displayLutOn]) {
      if (!isReported(entry)) sentences.push(entry.notReported);
    }
    if (model.cardTimeNotReported !== null) sentences.push(model.cardTimeNotReported);
  }
  sentences.push(
    unreachableSentence(CAM2, null),
    NO_LINK_SENTENCE,
    NOT_CONFIRMED_SENTENCE,
    alreadyRecordingRefusal().message,
    notRecordingRefusal().message,
    addressInvalidRefusal("10.0.0").message,
    startedRecordingSentence(CAM1),
    stoppedRecordingSentence(CAM1),
    formatSentence(CAM1, { from: "6K", to: "UHD" }, null),
    formatSentence(CAM1, null, { from: "25", to: "50" }),
    formatSentence(CAM1, { from: "6K", to: "UHD" }, { from: "25", to: "50" }),
    lookSentence(CAM1, [lookPart({ setting: "dynamicRange", from: "Film", to: "Video" })]),
    lookSentence(CAM1, [lookPart({ setting: "displayLut", from: "None", to: "Custom" })]),
    lookSentence(CAM1, [lookPart({ setting: "displayLutOn", on: false })]),
    lookSentence(CAM1, [lookPart({ setting: "displayLutOn", on: true })])
  );
  return sentences;
}

/** A `const NAME: &[&str] = &[…];` list in `model.rs`, or the list it names. */
function rustList(name: string): string[] {
  const model = rustSource("cameras/model.rs");
  const alias = model.match(new RegExp(`const ${name}: &\\[&str\\] = (\\w+);`))?.[1];
  if (alias) return rustList(alias);
  const body = model.match(new RegExp(`const ${name}: &\\[&str\\] = &\\[([^\\]]*)\\];`))?.[1];
  if (body === undefined) throw new Error(`${name} is not a list in model.rs any more; update this test`);
  return [...body.matchAll(/"([^"]*)"/g)].map((match) => match[1]!);
}

const camel = (name: string) => name.replace(/_(\w)/g, (_, letter: string) => letter.toUpperCase());

/** Where each simulated camera starts (`SimulatedCamera::new`): its values, by the snapshot's names. */
function rustStart(camera: CameraNumber): Record<string, string | number | boolean> {
  const simulated = rustSource("cameras/simulated.rs");
  const arms = [...simulated.matchAll(/(\d|_) => CameraReading \{([^}]*)\}/g)];
  const arm = arms.find((entry) => entry[1] === String(camera) || (camera === 3 && entry[1] === "_"));
  if (!arm) throw new Error(`simulated.rs has no starting values for CAM ${camera} any more; update this test`);
  const values: Record<string, string | number | boolean> = {};
  for (const [, field, text] of arm[2]!.matchAll(/(\w+): text\("([^"]*)"\)/g)) values[camel(field!)] = text!;
  for (const [, field, raw] of arm[2]!.matchAll(/(\w+): Some\(([^)]*)\)/g)) {
    values[camel(field!)] = raw === "true" ? true : raw === "false" ? false : Number(raw);
  }
  return values;
}

describe("the fixture double's camera words: the hardware link's", () => {
  it("speaks the cameras' sentences word for word", () => {
    for (const sentence of everyDoubleSentence()) {
      expect(inRust(sentence), sentence).toBe(true);
    }
  });

  it("uses the hardware link's words and refusal codes", () => {
    for (const state of Object.keys(STATE_WORDS) as CameraState[]) {
      expect(LITERALS, state).toContain(STATE_WORDS[state]);
    }
    for (const code of [
      "CAMERA_NOT_SET_UP",
      "CAMERA_RELEASED",
      "CAMERA_UNREACHABLE",
      "CAMERA_ALREADY_HELD",
      "CAMERA_NO_LINK",
      "CAMERA_SETTING_UNSUPPORTED",
      "CAMERA_VALUE_NOT_ALLOWED",
      "CAMERA_FORMAT_NOT_ALLOWED",
      "CAMERA_CHANGE_NOT_CONFIRMED",
      "CAMERA_ALREADY_RECORDING",
      "CAMERA_NOT_RECORDING",
      "CAMERA_ADDRESS_INVALID",
    ]) {
      expect(LITERALS, code).toContain(code);
    }
  });

  it("refuses a request of the wrong shape in the hardware link's words", async () => {
    const { refused } = openCamerasDouble();
    const asked: Array<[Parameters<typeof refused>[0], Record<string, unknown>]> = [
      ["cameras.select", { camera: 9 }],
      ["cameras.set", { camera: 1, setting: "zoom", value: "1" }],
      ["cameras.set", { camera: 1, setting: "iso", value: 1 }],
      ["cameras.set", { camera: 1, setting: "tint", value: "1" }],
      ["cameras.step", { camera: 1, setting: "iso", step: 0 }],
      ["cameras.auto", { camera: 1, what: "zoom" }],
      ["cameras.format.set", { camera: 1 }],
      ["cameras.format.set", { camera: 1, resolution: 4 }],
      ["cameras.format.set", { camera: 1, resolution: "HD", confirm: "yes" }],
      ["cameras.look.set", { camera: 1 }],
      ["cameras.look.set", { camera: 1, displayLutOn: "on" }],
      ["cameras.setup.update", { camera: 1, address: "10.0.0.1" }],
      ["cameras.setup.update", { camera: 2, address: "" }],
      ["cameras.setup.update", { camera: 2, vmixInput: 0 }],
      ["cameras.setup.update", { camera: 2 }],
      ["cameras.setup.pair", { camera: 2 }],
    ];
    for (const [method, params] of asked) {
      const { code, sentence } = await refused(method, params as never);
      expect(code, sentence).toBe("INVALID_PARAMS");
      expect(inRust(sentence), sentence).toBe(true);
    }
  });

  it("holds each camera's options and starting values as the simulated cameras do", () => {
    const lists: Array<[CameraNumber, ChoiceSetting, string]> = [
      [1, "iso", "CAM1_ISO"],
      [1, "shutter", "CAM1_SHUTTER"],
      [1, "iris", "CAM1_IRIS"],
      [1, "nd", "CAM1_ND"],
      [1, "resolution", "CAM1_RESOLUTION"],
      [1, "frameRate", "CAM1_FRAME_RATE"],
      [1, "dynamicRange", "CAM1_DYNAMIC_RANGE"],
      [1, "displayLut", "CAM1_DISPLAY_LUT"],
      [2, "iso", "BGH1_ISO"],
      [3, "iso", "BGH1_ISO"],
      [2, "shutter", "BGH1_SHUTTER"],
      [3, "shutter", "BGH1_SHUTTER"],
      [2, "iris", "CAM2_IRIS"],
      [3, "iris", "CAM3_IRIS"],
      [2, "resolution", "BGH1_RESOLUTION"],
      [3, "resolution", "BGH1_RESOLUTION"],
      [2, "frameRate", "BGH1_FRAME_RATE"],
      [3, "frameRate", "BGH1_FRAME_RATE"],
    ];
    for (const [camera, setting, name] of lists) {
      const choice = CAMERA_MODELS[camera].choices[setting];
      expect(isReported(choice) ? choice.options : null, `CAM ${camera} ${setting}`).toEqual(rustList(name));
    }
    for (const camera of [1, 2, 3] as const) {
      const report = startingReport(camera);
      const double: Record<string, string | number | boolean> = {};
      for (const [key, value] of Object.entries({ ...report.choices, ...report.levels })) {
        if (value !== null) double[key] = value;
      }
      if (report.displayLutOn !== null) double.displayLutOn = report.displayLutOn;
      if (report.recording !== null) double.recording = report.recording;
      expect(double, `CAM ${camera}`).toEqual(rustStart(camera));
    }
  });

  it("settles a one-shot auto where the simulated cameras do", () => {
    const simulated = rustSource("cameras/simulated.rs");
    const constant = (name: string) => {
      const value = simulated.match(new RegExp(`const ${name}: [^=]+= ([^;]+);`))?.[1];
      if (value === undefined) throw new Error(`${name} is not in simulated.rs any more; update this test`);
      return value.startsWith('"') ? value.slice(1, -1) : Number(value);
    };
    expect(SIMULATED_AUTO).toEqual({
      focus: constant("AUTO_FOCUS"),
      whiteBalance: constant("AUTO_WHITE_BALANCE"),
      iris: constant("AUTO_IRIS"),
    });
  });

  it("names the Recent actions rows as the hardware link's action log does", () => {
    const actionLog = rustSource("action_log.rs");
    const named = Object.fromEntries(
      [...actionLog.matchAll(/"(cameras\.[\w.]+)" => "([\w-]+)"/g)].map((match) => [match[1]!, match[2]!])
    );
    const { "cameras.connect": connect, ...rest } = CAMERA_ACTIONS;
    expect(named).toEqual(rest);
    // Connect's row: only when the camera is held again.
    expect(actionLog).toMatch(new RegExp(`_ if text\\(result, "/state"\\) == Some\\("held"\\) => "${connect}"`));
  });

  it("finds a changed sentence", () => {
    // The guard itself: a word changed on one side only is not found.
    expect(inRust("CAM 2 is held: Studio Control reads it and sends only what you press.")).toBe(true);
    expect(inRust("CAM 2 is held: Studio Control reads it and sends what you press.")).toBe(false);
    expect(inRust("CAM 1: 6K → UHD.")).toBe(true);
    expect(inRust("CAM 1: 6K to UHD.")).toBe(false);
    expect(inRust("CAM 1: display LUT on.")).toBe(true);
    expect(inRust("CAM 1: the display LUT on.")).toBe(false);
    expect(inRust("CAM 1: 25p to 50p.")).toBe(false);
  });
});
