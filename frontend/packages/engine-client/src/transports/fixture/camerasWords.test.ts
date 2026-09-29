/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { CameraState } from "../../generated/snapshots/CameraState";
import { CAMERA_ACTIONS } from "./actionLog";
import {
  CAMERA_MODELS,
  CHOICE_SETTINGS,
  SETTING_LABELS,
  isReported,
  type CameraNumber,
  type ChoiceSetting,
} from "./camerasModel";
import { SIMULATED_AUTO } from "./camerasRequests";
import { startingReport } from "./camerasState";
import {
  NOT_CONFIRMED_SENTENCE,
  NO_LINK_SENTENCE,
  NO_PICTURES_SENTENCE,
  NO_PICTURE_YET_SENTENCE,
  PICTURE_MISSING_DETAIL,
  PICTURE_SHOWING_DETAIL,
  PICTURE_WORDS,
  SIMULATED_VMIX_INPUTS,
  STATE_TONES,
  STATE_WORDS,
  addressInvalidRefusal,
  addressesNotRestoredSentence,
  alreadyHeldRefusal,
  alreadyRecordingRefusal,
  autoNotOfferedRefusal,
  formatNotAllowedRefusal,
  formatSentence,
  heldAgainSentence,
  heldSentence,
  lookPart,
  lookSentence,
  noLinkRefusal,
  noLinkRefusalSentence,
  noLinkSentence,
  notAllowedRefusal,
  notRecordingRefusal,
  notSetUpSentence,
  pictureMissingAdvice,
  pictureMissingSentence,
  pictureSourceWords,
  picturesMissingSentence,
  picturesNote,
  releasedRefusal,
  releasedSentence,
  releasedToSentence,
  startedRecordingSentence,
  stoppedRecordingSentence,
  unreachableSentence,
} from "./camerasWords";
import { openCamerasDouble } from "./camerasTestSupport";

// The fixture double's words for the cameras (new pages program, Slice 8) are the hardware
// link's. They are held here twice: once as the operator reads them, sentence by sentence,
// and once to the hardware link's own source (`native/rust-engine/src/cameras/`, above its
// tests), as `prompterScreen.test.ts` holds the Prompter XL's to `screen.rs`. There each
// sentence must be one of the source's string literals, word for word, with its
// placeholders filled exactly from the source's own tables (the settings' labels, the
// autos' words, the states' words and tones, each camera's tag and app) — so a sentence,
// or a word filled into one, changed on one side only fails. The Rust source is also read
// for what the simulated cameras hold: each choice's options, where each camera starts,
// where a one-shot auto settles, and the Recent actions' action names (`action_log.rs`).

const [CAM1, CAM2, CAM3] = [CAMERA_MODELS[1], CAMERA_MODELS[2], CAMERA_MODELS[3]];

describe("the fixture double's camera words, as the operator reads them", () => {
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
    // Not set up in a build with no link to it: that there is none, not what to enter in Setup.
    expect(notSetUpSentence(CAM1, false)).toBe(
      "Studio Control has no link to CAM 1 yet: it comes with a later version."
    );
    expect(notSetUpSentence(CAM2, true)).toBe("CAM 2 has no address. Enter it in Setup.");
  });

  it("refuses in its own words, with the hardware link's codes", () => {
    const pair = (error: { code: string; message: string }) => [error.code, error.message];
    expect(pair(releasedRefusal(CAM2))).toEqual([
      "CAMERA_RELEASED",
      "CAM 2 is released. Connect it to set it from here.",
    ]);
    expect(pair(alreadyHeldRefusal(CAM3))).toEqual(["CAMERA_ALREADY_HELD", "CAM 3 is already held."]);
    expect(NO_LINK_SENTENCE).toBe(
      "Studio Control cannot pair CAM 1 yet: its Bluetooth link comes with a later version."
    );
    expect(pair(noLinkRefusal(CAM1))).toEqual(["CAMERA_NO_LINK", NO_LINK_SENTENCE]);
    expect(pair(noLinkRefusal(CAM3))).toEqual([
      "CAMERA_NO_LINK",
      "Studio Control cannot take CAM 3's address yet: its network link comes with a later version.",
    ]);
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

  it("says what changed, word for word", () => {
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
    expect(addressesNotRestoredSentence([])).toBeNull();
    expect(addressesNotRestoredSentence([CAM2])).toBe(
      "CAM 2's address was not restored: Studio Control has no link to it yet."
    );
    expect(addressesNotRestoredSentence([CAM2, CAM3])).toBe(
      "CAM 2's and CAM 3's addresses were not restored: Studio Control has no link to them yet."
    );
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

/** The model's fields for each camera (`MODELS` in `model.rs`): its tag, make, link, app and whether it is a BGH1. */
const RUST_MODELS = (() => {
  const model = rustSource("cameras/model.rs");
  const models = [
    ...model.matchAll(
      /camera: (\d),\s*tag: "([^"]+)",\s*model: "([^"]+)",\s*link: CameraLink::(\w+),\s*app: "([^"]+)",\s*bgh1: (true|false),/g
    ),
  ].map(([, camera, tag, make, link, app, bgh1]) => ({
    camera: Number(camera),
    tag: tag!,
    model: make!,
    link: link!.toLowerCase(),
    app: app!,
    bgh1: bgh1 === "true",
  }));
  if (models.length !== 3) throw new Error("model.rs's MODELS do not read as three cameras any more; update this test");
  return models;
})();

const variantKey = (variant: string) => variant[0]!.toLowerCase() + variant.slice(1);
const kebab = (variant: string) => variant.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();

/** A `fn name(self) -> …` table in `model.rs`: each `Self::Variant` (or `A | B`) and what its arm gives. */
function rustTable(fn: string, arm: RegExp): Record<string, string> {
  const model = rustSource("cameras/model.rs");
  const body = model.match(new RegExp(`fn ${fn}\\(self\\) -> [^{]+\\{\\s*match self \\{([^}]*)\\}`))?.[1];
  if (body === undefined) throw new Error(`model.rs has no fn ${fn} table any more; update this test`);
  const table: Record<string, string> = {};
  for (const [, variants, value] of body.matchAll(arm)) {
    for (const [, variant] of variants!.matchAll(/Self::(\w+)/g)) table[variant!] = value!;
  }
  if (Object.keys(table).length === 0) throw new Error(`model.rs's fn ${fn} has no arms this test reads; update it`);
  return table;
}
// One arm: `Self::A` or `Self::A | Self::B`, then what it gives. Each space is matched one
// way only, so a long arm cannot make the pattern backtrack.
const ARM_VARIANTS = String.raw`(Self::\w+(?:\s*\|\s*Self::\w+)*)\s*=>\s*`;
const WORDS_ARM = new RegExp(`${ARM_VARIANTS}"([^"]*)"`, "g");
const RUST_LABELS = rustTable("label", WORDS_ARM);
const RUST_AUTO_WORDS = rustTable("words", WORDS_ARM);
const RUST_STATE_WORDS = rustTable("word", WORDS_ARM);
const RUST_STATE_TONES = rustTable("tone", new RegExp(`${ARM_VARIANTS}CameraTone::(\\w+)`, "g"));

/**
 * The literal `template`, which must be in the cameras' source word for word, its
 * placeholders filled exactly: `{name}` from `named`, `{}` from `positional` in order —
 * as `prompterScreen.test.ts` fills `screen.rs`'s. Loud when the template is not there:
 * a sentence reworded on either side fails, the words filled into it included, for they
 * come from the hardware link's own tables (`RUST_LABELS`, `RUST_AUTO_WORDS`, the models).
 */
function rust(template: string, positional: Array<string | number> = [], named: Record<string, string | number> = {}) {
  if (!LITERALS.includes(template)) {
    throw new Error(`"${template}" is not a literal in the cameras' source any more: one side changed its words`);
  }
  let next = 0;
  return template.replace(/\{\{|\}\}|\{(\w*)(?::[^}]*)?\}/g, (whole: string, name: string) => {
    if (whole === "{{") return "{";
    if (whole === "}}") return "}";
    if (name === "") {
      if (next >= positional.length) throw new Error(`"${template}" has more {} than this test fills`);
      return String(positional[next++]);
    }
    if (!(name in named)) throw new Error(`"${template}" has {${name}}, which this test does not fill`);
    return String(named[name]);
  });
}

/** Whether a source text holds `snippet` as written, white space aside. */
const holds = (source: string, snippet: string) => source.replace(/\s+/g, " ").includes(snippet.replace(/\s+/g, " "));

/**
 * For a request of the wrong shape only (`INVALID_PARAMS`, never shown on the page): whether
 * the sentence is one of the source's literals with its placeholders filled by anything.
 */
function inRustLoosely(sentence: string): boolean {
  return LITERALS.some((literal) => {
    const parts = literal.split(/(\{\{|\}\}|\{[^{}]*\})/);
    const source = parts
      .map((part) =>
        part === "{{" || part === "}}" ? escapeRegex(part[0]!) : /^\{[^{}]*\}$/.test(part) ? "(.+?)" : escapeRegex(part)
      )
      .join("");
    return literal.replace(/\{[^{}]*\}/g, "").trim().length >= 8 && new RegExp(`^${source}$`, "su").test(sentence);
  });
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every sentence the double's cameras say, one of each kind, filled as the double fills them. */
function everyDoubleSentence(): string[] {
  const sentences: string[] = [];
  for (const model of [CAM1, CAM2, CAM3]) {
    sentences.push(
      heldSentence(model),
      releasedSentence(model),
      notSetUpSentence(model),
      notSetUpSentence(model, false),
      unreachableSentence(model, "172.16.16.85"),
      noLinkSentence(model),
      noLinkRefusalSentence(model),
      releasedRefusal(model).message,
      alreadyHeldRefusal(model).message,
      releasedToSentence(model),
      heldAgainSentence(model),
      autoNotOfferedRefusal(model, "focus").message,
      autoNotOfferedRefusal(model, "whiteBalance").message,
      autoNotOfferedRefusal(model, "iris").message,
      formatNotAllowedRefusal(model, "60", "6K").message,
      pictureMissingSentence(model),
      picturesMissingSentence(model, 7)
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
    pictureMissingAdvice(7),
    NO_PICTURE_YET_SENTENCE,
    NO_PICTURES_SENTENCE,
    picturesNote(true),
    picturesNote(false),
    addressesNotRestoredSentence([CAM2])!,
    addressesNotRestoredSentence([CAM2, CAM3])!,
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

describe("the fixture double's picture words: the hardware link's (`pictures.rs`)", () => {
  it("names the pictures' states, where they come from and what arrives as the hardware link does", () => {
    for (const word of Object.values(PICTURE_WORDS)) expect(LITERALS, word).toContain(word);
    expect(PICTURE_SHOWING_DETAIL).toBe(rust("test picture"));
    expect(PICTURE_MISSING_DETAIL).toBe(rust("nothing received"));
    expect(pictureSourceWords(true)).toBe(rust("test pictures"));
    expect(pictureSourceWords(false)).toBe(rust("not built yet"));
    // The simulated source's inputs are the helper's and the hardware link's alike: the
    // protocol crate holds them (`native/protocol/rust/src/pictures.rs`).
    const inputs = readFileSync(resolve(RUST_SRC, "../../protocol/rust/src/pictures.rs"), "utf-8").match(
      /const SIMULATED_VMIX_INPUTS: RangeInclusive<u32> = (\d+)\.\.=(\d+);/
    );
    if (!inputs) throw new Error("pictures.rs's SIMULATED_VMIX_INPUTS is not a range any more; update this test");
    expect(SIMULATED_VMIX_INPUTS).toEqual({ first: Number(inputs[1]), last: Number(inputs[2]) });
  });

  it("speaks the pictures' sentences word for word", () => {
    expect(picturesNote(true)).toBe(
      rust(
        "Test pictures stand in for vMix inputs {} to {}. The cameras' own come with a later version, over NDI from vMix on this PC.",
        [SIMULATED_VMIX_INPUTS.first, SIMULATED_VMIX_INPUTS.last]
      )
    );
    expect(picturesNote(false)).toBe(
      rust("The cameras' own pictures come with a later version, over NDI from vMix on this PC.")
    );
    expect(NO_PICTURE_YET_SENTENCE).toBe(rust("No picture yet: the cameras' pictures come with a later version."));
    expect(NO_PICTURES_SENTENCE).toBe(
      rust("Studio Control shows no pictures yet: they come with a later version, over NDI from vMix on this PC.")
    );
    expect(pictureMissingAdvice(7)).toBe(
      rust("vMix sends other inputs: check that vMix input {vmix_input} is still there and live.", [], {
        vmix_input: 7,
      })
    );
    for (const model of [CAM1, CAM2, CAM3]) {
      expect(pictureMissingSentence(model)).toBe(rust("vMix is not sending {tag} over NDI.", [], { tag: model.tag }));
      expect(picturesMissingSentence(model, 7)).toBe(
        rust("vMix sends no picture for {tag}. Check that vMix input {input} is still there and live.", [], {
          tag: model.tag,
          input: 7,
        })
      );
    }
  });
});

describe("the fixture double's camera words: the hardware link's", () => {
  it("names the states, the settings and the autos in the hardware link's words", () => {
    expect(STATE_WORDS).toEqual(
      Object.fromEntries(Object.entries(RUST_STATE_WORDS).map(([variant, word]) => [kebab(variant), word]))
    );
    expect(STATE_TONES).toEqual(
      Object.fromEntries(
        Object.entries(RUST_STATE_TONES).map(([variant, tone]) => [kebab(variant), tone.toLowerCase()])
      )
    );
    const labels = Object.fromEntries(
      Object.entries(RUST_LABELS)
        .map(([variant, label]) => [variantKey(variant), label] as const)
        .filter(([key]) => key in SETTING_LABELS)
    );
    expect(SETTING_LABELS).toEqual(labels);
    for (const model of [CAM1, CAM2, CAM3]) {
      for (const what of ["focus", "whiteBalance", "iris"] as const) {
        const words = RUST_AUTO_WORDS[what[0]!.toUpperCase() + what.slice(1)]!;
        expect(autoNotOfferedRefusal(model, what).message).toBe(rust("{} does not offer {} once.", [model.tag, words]));
      }
    }
  });

  it("speaks the cameras' sentences word for word", () => {
    for (const model of [CAM1, CAM2, CAM3]) {
      const rustModel = RUST_MODELS[model.camera - 1]!;
      const tag = { tag: model.tag };
      expect(model.tag).toBe(rustModel.tag);
      expect(model.app).toBe(rustModel.app);
      expect(heldSentence(model)).toBe(
        rust("{tag} is held: Studio Control reads it and sends only what you press.", [], tag)
      );
      expect(releasedSentence(model)).toBe(
        rust(
          "{tag} is released to {}. Studio Control does not read it or send it anything until you connect it again.",
          [rustModel.app],
          tag
        )
      );
      expect(notSetUpSentence(model)).toBe(
        rustModel.bgh1
          ? rust("{tag} has no address. Enter it in Setup.", [], tag)
          : rust("{tag} is not paired. Pair it in Setup, with the camera beside you.", [], tag)
      );
      expect(unreachableSentence(model, "172.16.16.85")).toBe(
        rustModel.bgh1
          ? rust("{tag} does not answer at {}. Check that it is on and on the network.", ["172.16.16.85"], tag)
          : rust("{tag} does not answer over Bluetooth. Check that it is on and within reach of this PC.", [], tag)
      );
      expect(noLinkSentence(model)).toBe(
        rust("Studio Control has no link to {} yet: it comes with a later version.", [model.tag])
      );
      expect(notSetUpSentence(model, false)).toBe(noLinkSentence(model));
      expect(noLinkRefusalSentence(model)).toBe(
        rustModel.bgh1
          ? rust("Studio Control cannot take {}'s address yet: its network link comes with a later version.", [
              model.tag,
            ])
          : rust(NO_LINK_SENTENCE)
      );
      expect(releasedRefusal(model).message).toBe(rust("{} is released. Connect it to set it from here.", [model.tag]));
      expect(alreadyHeldRefusal(model).message).toBe(rust("{} is already held.", [model.tag]));
      expect(releasedToSentence(model)).toBe(rust("{} released to {}.", [model.tag, rustModel.app]));
      expect(heldAgainSentence(model)).toBe(rust("{} held again.", [model.tag]));
      expect(formatNotAllowedRefusal(model, "60", "6K").message).toBe(
        rust("{} does not allow {frame_rate}p at {resolution}.", [model.tag], { frame_rate: "60", resolution: "6K" })
      );
      for (const setting of [...CHOICE_SETTINGS, "whiteBalance", "tint", "focus"] as const) {
        const label = RUST_LABELS[setting[0]!.toUpperCase() + setting.slice(1)]!;
        expect(notAllowedRefusal(model, setting, "7").message, setting).toBe(
          rust("{} does not allow {} {value}.", [model.tag, label], { value: "7" })
        );
      }
      const notReported: Record<string, string> = {
        nd: "The BGH1 has no ND filter.",
        tint: rust("{tag} does not report tint.", [], tag),
        focus: rust("{tag} does not report a focus position.", [], tag),
        dynamicRange: rust("{tag} does not report its dynamic range.", [], tag),
        displayLut: rust("{tag} does not report a display LUT.", [], tag),
      };
      for (const [key, entry] of Object.entries({
        ...model.choices,
        ...model.levels,
        displayLutOn: model.displayLutOn,
      })) {
        if (!isReported(entry)) {
          const expected = key === "displayLutOn" ? notReported.displayLut : notReported[key];
          expect(entry.notReported, `CAM ${model.camera} ${key}`).toBe(expected);
          if (key === "nd") expect(LITERALS).toContain(expected);
        }
      }
      expect(model.cardTimeNotReported).toBe(
        rustModel.bgh1 ? null : rust("{} does not report its card time over Bluetooth.", [model.tag])
      );
    }
    expect(NO_LINK_SENTENCE).toBe(rust(NO_LINK_SENTENCE));
    // The restore's sentence, its parts the hardware link's own: whose, how many, which.
    const model = rustSource("cameras/model.rs");
    expect(holds(model, 'format!("{}\'s", model(*camera).tag)')).toBe(true);
    expect(holds(model, 'whose.join(" and ")')).toBe(true);
    expect(holds(model, '("address was", "it")')).toBe(true);
    expect(holds(model, '("addresses were", "them")')).toBe(true);
    const notRestored = "{} {what} not restored: Studio Control has no link to {which} yet.";
    expect(addressesNotRestoredSentence([CAM2])).toBe(
      rust(notRestored, ["CAM 2's"], { what: "address was", which: "it" })
    );
    expect(addressesNotRestoredSentence([CAM2, CAM3])).toBe(
      rust(notRestored, ["CAM 2's and CAM 3's"], { what: "addresses were", which: "them" })
    );
    expect(NOT_CONFIRMED_SENTENCE).toBe(rust(NOT_CONFIRMED_SENTENCE));
    expect(alreadyRecordingRefusal().message).toBe(rust("CAM 1 is already recording."));
    expect(notRecordingRefusal().message).toBe(rust("CAM 1 is not recording."));
    expect(addressInvalidRefusal("10.0.0").message).toBe(
      rust(
        "{value} is not the address of one machine. Enter the camera's IPv4 address: four numbers from 0 to 255, such as 172.16.16.85.",
        [],
        { value: "10.0.0" }
      )
    );
  });

  it("says what changed in the hardware link's words", () => {
    const commands = rustSource("cameras/commands.rs");
    const tag = CAM1.tag;
    expect(startedRecordingSentence(CAM1)).toBe(rust("CAM 1 started recording."));
    expect(stoppedRecordingSentence(CAM1)).toBe(rust("CAM 1 stopped recording."));
    const change = (text: string) => rust("{}: {change}.", [tag], { change: text });
    expect(formatSentence(CAM1, { from: "6K", to: "UHD" }, null)).toBe(
      change(rust("{old_resolution} → {now_resolution}", [], { old_resolution: "6K", now_resolution: "UHD" }))
    );
    expect(formatSentence(CAM1, null, { from: "25", to: "50" })).toBe(
      change(rust("{old_frame_rate}p → {now_frame_rate}p", [], { old_frame_rate: "25", now_frame_rate: "50" }))
    );
    expect(formatSentence(CAM1, { from: "6K", to: "UHD" }, { from: "25", to: "50" })).toBe(
      change(
        rust("{old_resolution} {old_frame_rate}p → {now_resolution} {now_frame_rate}p", [], {
          old_resolution: "6K",
          old_frame_rate: "25",
          now_resolution: "UHD",
          now_frame_rate: "50",
        })
      )
    );
    // The look: its parts, joined as the hardware link joins them, inside its sentence.
    expect(holds(commands, 'parts.join("; ")')).toBe(true);
    expect(holds(commands, 'if after.display_lut_on == Some(true) { "on" } else { "off" }')).toBe(true);
    const look = (...parts: string[]) => rust("{}: {}.", [tag, parts.join("; ")]);
    const range = rust("dynamic range {} → {}", ["Film", "Video"]);
    const lut = rust("display LUT {} → {}", ["Film → Ext. video", "Custom"]);
    const off = rust("display LUT {}", ["off"]);
    const on = rust("display LUT {}", ["on"]);
    expect(lookSentence(CAM1, [lookPart({ setting: "dynamicRange", from: "Film", to: "Video" })])).toBe(look(range));
    expect(lookSentence(CAM1, [lookPart({ setting: "displayLut", from: "Film → Ext. video", to: "Custom" })])).toBe(
      look(lut)
    );
    expect(lookSentence(CAM1, [lookPart({ setting: "displayLutOn", on: false })])).toBe(look(off));
    expect(lookSentence(CAM1, [lookPart({ setting: "displayLutOn", on: true })])).toBe(look(on));
    expect(
      lookSentence(CAM1, [
        lookPart({ setting: "dynamicRange", from: "Film", to: "Video" }),
        lookPart({ setting: "displayLutOn", on: false }),
      ])
    ).toBe(look(range, off));
  });

  it("holds what each camera is, offers and reports as the hardware link's model does", () => {
    const model = rustSource("cameras/model.rs");
    // A flag that is `self.bgh1`, `!self.bgh1` or a constant, for each camera.
    const flag = (expression: string, bgh1: boolean) =>
      expression === "true" ? true : expression === "false" ? false : expression === "self.bgh1" ? bgh1 : !bgh1;
    const fnBody = (name: string) => {
      const body = model.match(new RegExp(`fn ${name}\\(&self\\) -> \\w+ \\{([^}]*)\\}`))?.[1];
      if (body === undefined) throw new Error(`model.rs has no fn ${name} any more; update this test`);
      return body.trim();
    };
    const autos = model.match(/CameraAutos \{\s*focus: ([!\w.]+),\s*white_balance: ([!\w.]+),\s*iris: ([!\w.]+),\s*\}/);
    if (!autos) throw new Error("model.rs's autos do not read as this test expects any more; update it");
    const scale = (arm: string) => {
      const found = model.match(
        new RegExp(
          `\\(Setting::${arm}\\) => Ok\\(LevelScale \\{\\s*min: ([-\\d.]+),\\s*max: ([-\\d.]+),\\s*step: ([^,]+),\\s*unit: "([^"]*)",`
        )
      );
      if (!found) throw new Error(`model.rs's scale for ${arm} does not read as this test expects any more; update it`);
      return found;
    };
    for (const camera of [CAM1, CAM2, CAM3]) {
      const rustModel = RUST_MODELS[camera.camera - 1]!;
      const bgh1 = rustModel.bgh1;
      expect(camera.model).toBe(rustModel.model);
      expect(camera.link).toBe(rustModel.link);
      expect(camera.auto).toEqual({
        focus: flag(autos[1]!, bgh1),
        whiteBalance: flag(autos[2]!, bgh1),
        iris: flag(autos[3]!, bgh1),
      });
      expect(camera.focusSteps).toBe(flag(fnBody("focus_steps"), bgh1));
      expect(camera.records).toBe(flag(fnBody("records"), bgh1));
      expect(camera.timecodeReported).toBe(flag(fnBody("timecode_reported"), bgh1));
      const whiteBalance = scale("WhiteBalance, bgh1");
      const step = whiteBalance[3]!.match(/if bgh1 \{ ([\d.]+) \} else \{ ([\d.]+) \}/);
      expect(camera.levels.whiteBalance).toMatchObject({
        min: Number(whiteBalance[1]),
        max: Number(whiteBalance[2]),
        step: Number(bgh1 ? step![1] : step![2]),
        unit: whiteBalance[4],
      });
      for (const [key, arm] of [
        ["tint", "Tint, false"],
        ["focus", "Focus, false"],
      ] as const) {
        const level = camera.levels[key];
        if (bgh1) {
          expect(isReported(level), `CAM ${camera.camera} ${key}`).toBe(false);
        } else {
          const found = scale(arm);
          expect(level).toMatchObject({
            min: Number(found[1]),
            max: Number(found[2]),
            step: Number(found[3]),
            unit: found[4],
          });
        }
      }
      // Frame rates the camera does not allow at a resolution: the Pocket's 60p at 6K.
      const unavailable = model.match(
        /if !self\.bgh1 && resolution == "([^"]+)" \{\s*vec!\[\("([^"]+)", String::from\("([^"]+)"\)\)\]/
      );
      if (!unavailable) throw new Error("model.rs's unavailable frame rates do not read as this test expects any more");
      expect(camera.unavailableFrameRates).toEqual(
        bgh1 ? {} : { [unavailable[1]!]: [{ value: unavailable[2], reason: unavailable[3] }] }
      );
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
      expect(inRustLoosely(sentence), sentence).toBe(true);
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

  it("fails on a template or a filled-in word changed on one side", () => {
    // The guard itself: a template that is not in the source word for word is loud, and a
    // sentence filled with other words is not the hardware link's.
    expect(() => rust("{} is already held.", ["CAM 2"])).not.toThrow();
    expect(() => rust("{} is held already.", ["CAM 2"])).toThrow(/not a literal/);
    expect(() => rust("{}: {change}.", ["CAM 1"])).toThrow(/does not fill/);
    expect(notAllowedRefusal(CAM1, "frameRate", "48").message).not.toBe(
      rust("{} does not allow {} {value}.", ["CAM 1", "frame-rate"], { value: "48" })
    );
    expect(lookSentence(CAM1, [lookPart({ setting: "displayLutOn", on: true })])).not.toBe(
      rust("{}: {}.", ["CAM 1", rust("display LUT {}", ["shown"])])
    );
  });
});
