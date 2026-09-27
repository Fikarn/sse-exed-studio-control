// Part of the fixture double (`../fixtureTransport.ts`): the in-memory stand-in for the
// hardware link that Playwright and the browser fixture mode run against. Test-only.
import type { JsonObject, JsonValue, RequestMethod } from "../../generated/protocol";
import type { PrompterLook } from "../../generated/snapshots/PrompterLook";
import type { PrompterParagraph } from "../../generated/snapshots/PrompterParagraph";
import { EngineRequestError } from "../engineRequestError";
import {
  GlassClock,
  SPEED_DEFAULT_WPM,
  SPEED_MAX_WPM,
  SPEED_MIN_WPM,
  SPEED_STEP_WPM,
  cueAfter,
  cueBefore,
  lineStep,
  newLayout,
  speedIsValid,
  wordsAtPosition,
} from "./prompterClock";
import { ImportRefused, importFile, importPaste, importSentence, refusalSentence } from "./prompterImport";
import {
  MAX_IMPORT_BYTES,
  TOP,
  cleanName,
  comparePlaces,
  cueTargets,
  endOf,
  clampedPlace,
  cloneParagraphs,
  mapPlace,
  paragraphText,
  paragraphsKey,
} from "./prompterModel";
import {
  editedParagraphs,
  existingScript,
  flagParam,
  invalid,
  layoutLines,
  optionalText,
  prompterCheck,
  prompterStatusPart,
  readGlassSnapshot,
  readScriptSnapshot,
  readSnapshot,
  stepParam,
  textParam,
  wholeParam,
} from "./prompterReads";
import { playRefusal, sameScreen, screenDraws, screenFromReport, screenState, screenSummary } from "./prompterScreen";
import {
  SIZE_MAX_PX,
  SIZE_MIN_PX,
  SIZE_STEP_PX,
  VERSION_REASON,
  buildPrompterArchive,
  deleteScript,
  fixturePrompter,
  glassAnchor,
  hasVersionWith,
  insertScript,
  keepVersion,
  laysOutDifferently,
  layoutKey,
  listScripts,
  newScriptId,
  placeSavedAs,
  prompterRestoreSentence,
  readVersion,
  restoreFromArchive,
  savePlace,
  saveThisPlace,
  schedulePrompterClock,
  settlePrompter,
  sizeIsValid,
  writeScriptText,
  nowText,
  type FixturePrompter,
  type PrompterArchive,
  type StoredScript,
} from "./prompterState";
import { NOT_HANDLED, type FixtureRequestContext, type FixtureRequestResult } from "./requestContext";
import { applyPrompterHealth } from "./state";

// The Teleprompter's `prompter.*` methods as the hardware link answers them
// (`native/rust-engine/src/prompter/commands.rs`, new pages program, Slice 4): the same
// parameters, results, refusal codes and sentences, and a `prompter.changed { reason,
// anchor }` for every request that changed something. The rules (D11, D12, D19, D20):
// nothing but the operator's controls moves the place; only `TOP` pauses a scroll; at a
// script's end `PLAY` is refused until a jump moves the place back; replacing what the
// prompter shows needs `replace: true`; an edit never reaches the glass before Update;
// the script on the prompter cannot be removed; only a removed script is deleted for good.
// Slice 5a adds the Prompter XL as the shell reports it (`prompterScreen.ts`): `PLAY` is
// refused while nothing is drawn on the glass, a scroll pauses when the glass goes, and a
// request after which `checks.prompter` says something else also raises `app.changed {
// reason: "health" }`, so the header's lamp follows.

interface Answer {
  result: JsonValue;
  /** The event's reason; `null` for a read or a change that moves nothing. */
  reason: string | null;
}

const answer = (result: JsonValue, reason: string | null = null): Answer => ({ result, reason });

function keptScript(prompter: FixturePrompter, id: string): StoredScript {
  const script = existingScript(prompter, id);
  if (script.removedAt !== null) {
    throw new EngineRequestError("PROMPTER_SCRIPT_REMOVED", `${script.name} is in Removed. Restore it first.`);
  }
  return script;
}

const onGlass = (prompter: FixturePrompter, id: string) => prompter.glass?.scriptId === id;

/** A file's name without its folder or its ending: `Interview intro.docx` is `Interview intro`. */
function fileStem(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? fileName;
  const dot = base.lastIndexOf(".");
  return cleanName(dot < 0 ? base : base.slice(0, dot)) ?? "Imported script";
}

/** A pasted script's name: the first words of its first line. */
function firstWords(paragraphs: PrompterParagraph[]): string {
  const firstLine = (paragraphs[0] ? paragraphText(paragraphs[0]) : "").split("\n")[0] ?? "";
  let name = "";
  for (const word of firstLine.split(/\s+/u).filter(Boolean).slice(0, 6)) {
    if (name !== "" && Array.from(name).length + 1 + Array.from(word).length > 40) break;
    name = name === "" ? word : `${name} ${word}`;
  }
  return cleanName(name) ?? "Pasted script";
}

/** `New script`, or `New script 2`, `3`… when the name is taken. */
function newScriptName(prompter: FixturePrompter): string {
  const names = new Set(listScripts(prompter).map((script) => script.name));
  if (!names.has("New script")) return "New script";
  for (let number = 2; ; number += 1) {
    if (!names.has(`New script ${number}`)) return `New script ${number}`;
  }
}

export function newScript(
  prompter: FixturePrompter,
  name: string,
  sourceFileName: string | null,
  paragraphs: PrompterParagraph[],
  now: number
): StoredScript {
  return insertScript(
    prompter,
    {
      id: newScriptId(prompter),
      name,
      sourceFileName,
      paragraphs,
      speedWpm: SPEED_DEFAULT_WPM,
      place: TOP,
      removedAt: null,
    },
    now
  );
}

/** Where an edited script's place goes: the glass's place stays with the glass's text until Update. */
function placeAfterEdit(prompter: FixturePrompter, script: StoredScript, paragraphs: PrompterParagraph[]) {
  return onGlass(prompter, script.id) ? script.place : mapPlace(script.paragraphs, paragraphs, script.place)[0];
}

function decodeBase64(content: string): Uint8Array {
  const trimmed = content.trim();
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(trimmed)) {
    throw invalid("contentBase64 must be the file's bytes in base64.");
  }
  const binary = atob(trimmed);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

// ---------------------------------------------------------------------------
// Scripts
// ---------------------------------------------------------------------------

/** `prompter.script.import { fileName, contentBase64, updateScriptId? }`. */
function importRequest(prompter: FixturePrompter, params: JsonObject, now: number): Answer {
  const given = textParam(params, "fileName");
  const fileName = given.split(/[/\\]/).pop() ?? given;
  const content = textParam(params, "contentBase64");
  let imported;
  try {
    // The largest file in base64, refused before it is decoded (`MAX_IMPORT_BYTES / 3 * 4 + 8`).
    if (content.length > Math.floor(MAX_IMPORT_BYTES / 3) * 4 + 8) {
      throw new ImportRefused({ kind: "too-large", bytes: Math.floor(content.length / 4) * 3 });
    }
    imported = importFile(fileName, decodeBase64(content));
  } catch (error) {
    if (error instanceof ImportRefused) {
      throw new EngineRequestError("PROMPTER_IMPORT_REFUSED", refusalSentence(error.refusal, fileName));
    }
    throw error;
  }
  let sentence = importSentence(fileName, imported);
  const updateId = optionalText(params, "updateScriptId");
  if (updateId !== null) {
    const script = keptScript(prompter, updateId);
    const place = placeAfterEdit(prompter, script, imported.paragraphs);
    keepVersion(prompter, script.id, script.paragraphs, VERSION_REASON.beforeFileUpdate, now);
    writeScriptText(script, imported.paragraphs, place, now);
    keepVersion(prompter, script.id, imported.paragraphs, VERSION_REASON.imported, now);
    sentence += ` It is now the text of ${script.name}; the earlier text is kept among its versions.`;
    return answer({ scriptId: script.id, name: script.name, sentence }, "script-updated-from-file");
  }
  const script = newScript(prompter, fileStem(fileName), fileName, imported.paragraphs, now);
  keepVersion(prompter, script.id, imported.paragraphs, VERSION_REASON.imported, now);
  return answer({ scriptId: script.id, name: script.name, sentence }, "script-imported");
}

/** `prompter.script.paste { html?, text }`: what the page read from the clipboard, named after its first words. */
function pasteRequest(prompter: FixturePrompter, params: JsonObject, now: number): Answer {
  const html = optionalText(params, "html");
  const text = optionalText(params, "text") ?? "";
  let imported;
  try {
    imported = importPaste(html, text);
  } catch (error) {
    if (error instanceof ImportRefused) {
      throw new EngineRequestError("PROMPTER_IMPORT_REFUSED", refusalSentence(error.refusal, "The pasted text"));
    }
    throw error;
  }
  const script = newScript(prompter, firstWords(imported.paragraphs), null, imported.paragraphs, now);
  keepVersion(prompter, script.id, imported.paragraphs, VERSION_REASON.pasted, now);
  return answer(
    { scriptId: script.id, name: script.name, sentence: importSentence("the pasted text", imported) },
    "script-pasted"
  );
}

function scriptRequest(prompter: FixturePrompter, method: RequestMethod, params: JsonObject, now: number): Answer {
  switch (method) {
    case "prompter.script.create": {
      const raw = optionalText(params, "name");
      const name = raw === null ? newScriptName(prompter) : cleanName(raw);
      if (name === null) throw invalid("name must hold a word.");
      const script = newScript(prompter, name, null, [{ runs: [] }], now);
      return answer({ scriptId: script.id, name }, "script-created");
    }
    case "prompter.script.rename": {
      const id = textParam(params, "scriptId");
      const name = cleanName(textParam(params, "name"));
      if (name === null) throw invalid("name must hold a word.");
      const script = existingScript(prompter, id);
      script.name = name;
      script.changedAt = nowText(now);
      return answer({ scriptId: id, name }, "script-renamed");
    }
    case "prompter.script.edit": {
      const id = textParam(params, "scriptId");
      const script = keptScript(prompter, id);
      const paragraphs = editedParagraphs(params);
      writeScriptText(script, paragraphs, placeAfterEdit(prompter, script, paragraphs), now);
      return answer({ scriptId: id, changedAt: script.changedAt }, "script-edited");
    }
    case "prompter.script.remove":
    case "prompter.script.restore": {
      const remove = method === "prompter.script.remove";
      const id = textParam(params, "scriptId");
      const script = existingScript(prompter, id);
      if (remove && onGlass(prompter, id)) {
        throw new EngineRequestError(
          "PROMPTER_SCRIPT_ON_PROMPTER",
          `${script.name} is on the prompter. Clear the prompter first.`
        );
      }
      script.removedAt = remove ? nowText(now) : null;
      return answer({ scriptId: id }, remove ? "script-removed" : "script-restored");
    }
    case "prompter.script.delete": {
      const id = textParam(params, "scriptId");
      const script = existingScript(prompter, id);
      if (script.removedAt === null) {
        throw new EngineRequestError(
          "PROMPTER_SCRIPT_NOT_REMOVED",
          `${script.name} is not in Removed. Remove it first; only a removed script can be deleted for good.`
        );
      }
      deleteScript(prompter, id);
      return answer({ scriptId: id }, "script-deleted");
    }
    case "prompter.script.version.bringBack": {
      const id = textParam(params, "scriptId");
      const versionId = wholeParam(params, "versionId");
      if (versionId === null) throw invalid("versionId must be a whole number.");
      const script = keptScript(prompter, id);
      const paragraphs = readVersion(prompter, id, versionId);
      if (!paragraphs) {
        throw new EngineRequestError(
          "PROMPTER_VERSION_UNKNOWN",
          `${script.name} has no such version; it may have been let go.`
        );
      }
      const place = placeAfterEdit(prompter, script, paragraphs);
      if (!hasVersionWith(prompter, id, script.paragraphs)) {
        keepVersion(prompter, id, script.paragraphs, VERSION_REASON.beforeBringingBack, now);
      }
      writeScriptText(script, paragraphs, place, now);
      return answer({ scriptId: id }, "version-brought-back");
    }
    default:
      throw invalid(`Unsupported method: ${method}`);
  }
}

// ---------------------------------------------------------------------------
// What the glass shows (D11: replacing, updating and clearing are armed)
// ---------------------------------------------------------------------------

const nothingOn = () =>
  new EngineRequestError("PROMPTER_NOTHING_ON", "Nothing is on the prompter. Put a script on first.");

function glassOf(prompter: FixturePrompter): GlassClock {
  if (!prompter.glass) throw nothingOn();
  return prompter.glass;
}

const glassName = (prompter: FixturePrompter, glass: GlassClock) =>
  prompter.scripts.find((script) => script.id === glass.scriptId)?.name ?? "";

/**
 * The glass lets go of its script (a replace, a clear; `release_glass`): the script keeps
 * the place it was read to — where a pause's ease will stop — carried into its own text
 * when it was edited since it went on (review of 2026-09-27: the place, counted in the
 * glass's text, was saved against the edited text).
 */
function releaseGlass(prompter: FixturePrompter, now: number) {
  const glass = prompter.glass;
  if (!glass) return;
  const readTo = glass.restingPlace(now);
  const script = prompter.scripts.find((entry) => entry.id === glass.scriptId);
  if (!script) return;
  const edited = paragraphsKey(script.paragraphs) !== paragraphsKey(glass.paragraphs);
  script.place = edited ? mapPlace(glass.paragraphs, script.paragraphs, readTo)[0] : { ...readTo };
}

/** `prompter.putOn { scriptId, replace? }`: on the glass, paused at its own place — the top when left at its end. */
export function putOnRequest(prompter: FixturePrompter, params: JsonObject, now: number): Answer {
  const id = textParam(params, "scriptId");
  const replace = flagParam(params, "replace");
  const script = keptScript(prompter, id);
  let replaced: string | null = null;
  if (prompter.glass) {
    if (prompter.glass.scriptId === id) {
      throw new EngineRequestError("PROMPTER_ALREADY_ON", `${script.name} is already on the prompter.`);
    }
    const shown = glassName(prompter, prompter.glass);
    if (!replace) {
      throw new EngineRequestError(
        "PROMPTER_REPLACE_NOT_CONFIRMED",
        `The prompter shows ${shown}. Replacing it with ${script.name} needs the second press.`
      );
    }
    releaseGlass(prompter, now);
    replaced = shown;
  }
  const place =
    comparePlaces(script.place, endOf(script.paragraphs)) >= 0 ? TOP : clampedPlace(script.place, script.paragraphs);
  keepVersion(prompter, id, script.paragraphs, replaced !== null ? VERSION_REASON.replaced : VERSION_REASON.putOn, now);
  prompter.glassRevision += 1;
  script.place = { ...place };
  // The glass keeps the text as it went on; an edit reaches it only by Update.
  const glassText = cloneParagraphs(script.paragraphs);
  prompter.glass = GlassClock.paused(now, id, glassText, layoutKey(prompter), place, script.speedWpm);
  placeSavedAs(prompter, place, now);
  const sentence =
    replaced !== null
      ? `Replaced ${replaced} with ${script.name} on the prompter.`
      : `Put ${script.name} on the prompter.`;
  return answer(
    { action: replaced !== null ? "replaced" : "put-on", name: script.name, replacedName: replaced, sentence },
    replaced !== null ? "replaced" : "put-on"
  );
}

/** `prompter.update`: the edited text goes on, the same words at the reading line; the scroll goes on as it was. */
function updateRequest(prompter: FixturePrompter, now: number): Answer {
  const glass = glassOf(prompter);
  const script = existingScript(prompter, glass.scriptId);
  if (paragraphsKey(script.paragraphs) === paragraphsKey(glass.paragraphs)) {
    throw new EngineRequestError(
      "PROMPTER_UP_TO_DATE",
      `The prompter already shows the latest text of ${script.name}.`
    );
  }
  const [place, moved] = mapPlace(glass.paragraphs, script.paragraphs, glass.placeAt(now));
  keepVersion(prompter, script.id, script.paragraphs, VERSION_REASON.updated, now);
  prompter.glassRevision += 1;
  glass.replaceText(now, cloneParagraphs(script.paragraphs), layoutKey(prompter), place, !moved);
  savePlace(prompter, now);
  let sentence = `Updated ${script.name} on the prompter.`;
  if (moved) {
    sentence +=
      place.paragraph >= script.paragraphs.length
        ? " The paragraph at the reading line was deleted, so the prompter now stands at the end."
        : ` The paragraph at the reading line was deleted, so the prompter now starts at paragraph ${place.paragraph + 1}.`;
  }
  return answer({ action: "updated", name: script.name, sentence }, "updated");
}

/** `prompter.clear`: the glass goes black; the script keeps its place. */
function clearRequest(prompter: FixturePrompter, now: number): Answer {
  const name = glassName(prompter, glassOf(prompter));
  releaseGlass(prompter, now);
  prompter.glassRevision += 1;
  prompter.glass = null;
  placeSavedAs(prompter, null, now);
  return answer({ action: "cleared", name, sentence: "Cleared the prompter." }, "cleared");
}

// ---------------------------------------------------------------------------
// Running a take (all one press, D11; none starts the scroll but PLAY)
// ---------------------------------------------------------------------------

const notLaidOut = () =>
  new EngineRequestError(
    "PROMPTER_NOT_LAID_OUT",
    "The prompter's text is not drawn yet, so it cannot scroll or step a line. Try again in a moment."
  );

function playRequest(prompter: FixturePrompter, now: number): Answer {
  const glass = glassOf(prompter);
  // Slice 5a: nothing scrolls where nobody can read it (the proposal §7).
  const refusal = playRefusal(prompter.screen);
  if (refusal) throw refusal;
  if (glass.atEnd(now)) {
    throw new EngineRequestError(
      "PROMPTER_AT_END",
      `The prompter is at the end of ${glassName(prompter, glass)}. Go back with BACK, TOP or a jump first.`
    );
  }
  if (!glass.layout) throw notLaidOut();
  if (!glass.playing) glass.play(now);
  return answer({}, "played");
}

/** `prompter.speed { wpm? | step? }`: 40–300 words a minute in steps of 5; `step` stops at the ends. */
function speedRequest(prompter: FixturePrompter, params: JsonObject, now: number): Answer {
  const wpm = wholeParam(params, "wpm");
  const step = stepParam(params);
  const glass = glassOf(prompter);
  let speed: number;
  if (wpm !== null && step === null) {
    if (!speedIsValid(wpm)) {
      throw invalid(`wpm must be ${SPEED_MIN_WPM}–${SPEED_MAX_WPM} in steps of ${SPEED_STEP_WPM}.`);
    }
    speed = wpm;
  } else if (wpm === null && step !== null) {
    speed = Math.min(Math.max(glass.speedWpm + step * SPEED_STEP_WPM, SPEED_MIN_WPM), SPEED_MAX_WPM);
  } else {
    throw invalid("Give the pace as wpm or as step, not both.");
  }
  glass.setSpeed(now, speed);
  existingScript(prompter, glass.scriptId).speedWpm = speed;
  return answer({ speedWpm: speed }, "speed");
}

const JUMP_TARGETS =
  "top, back, nextLine, previousLine, nextParagraph, previousParagraph, nextCue, previousCue, paragraph or place";

/** `prompter.jump { to, paragraph?, word? }`: a jump keeps the scroll as it was; only `top` pauses. */
function jumpRequest(prompter: FixturePrompter, params: JsonObject, now: number): Answer {
  const to = textParam(params, "to");
  const paragraph = wholeParam(params, "paragraph");
  const word = wholeParam(params, "word");
  const glass = glassOf(prompter);
  const count = glass.paragraphCount;
  const [paragraphNow, offsetNow] = glass.wordsAt(now);
  let target: [number, number];
  switch (to) {
    case "top":
      glass.jump(now, 0, 0, true);
      savePlace(prompter, now);
      return answer({}, "jumped");
    // §5 (answered in §14): the start of the paragraph at the reading line; from that
    // paragraph's first line, the start of the one before.
    case "back":
      if (paragraphNow >= count) target = [Math.max(count - 1, 0), 0];
      else if (glass.lineStartAt(now) === 0) target = [Math.max(paragraphNow - 1, 0), 0];
      else target = [paragraphNow, 0];
      break;
    case "nextLine":
    case "previousLine": {
      const layout = glass.layout;
      const position = glass.positionAt(now);
      if (!layout || position === null) throw notLaidOut();
      target = wordsAtPosition(layout, lineStep(layout, position, to === "nextLine"), count);
      break;
    }
    case "nextParagraph":
      // From the last paragraph there is no next one: the text does not move (review of
      // 2026-09-27: it went back to the paragraph's start).
      if (paragraphNow + 1 >= count) {
        throw new EngineRequestError("PROMPTER_NO_PARAGRAPH", "There is no paragraph after the reading line.");
      }
      target = [paragraphNow + 1, 0];
      break;
    case "previousParagraph":
      target = [Math.min(Math.max(paragraphNow - 1, 0), Math.max(count - 1, 0)), 0];
      break;
    case "nextCue":
    case "previousCue": {
      const cues = cueTargets(glass.paragraphs);
      const here = [paragraphNow, offsetNow] as const;
      const found =
        to === "nextCue"
          ? cues.find((cue) => cueAfter([cue.paragraph, cue.word], here))
          : [...cues].reverse().find((cue) => cueBefore([cue.paragraph, cue.word], here));
      if (!found) {
        throw new EngineRequestError(
          "PROMPTER_NO_CUE",
          to === "nextCue" ? "There is no cue after the reading line." : "There is no cue before the reading line."
        );
      }
      target = [found.paragraph, found.word];
      break;
    }
    case "paragraph":
    case "place":
      if (paragraph === null) throw invalid("paragraph must be a whole number.");
      if (paragraph >= count) {
        throw invalid(
          `The script on the prompter has ${count} paragraphs; paragraph must be 0–${Math.max(count - 1, 0)}.`
        );
      }
      target = [paragraph, to === "place" ? (word ?? 0) : 0];
      break;
    default:
      throw invalid(`to must be ${JUMP_TARGETS}, not ${to}.`);
  }
  glass.jump(now, target[0], target[1], false);
  savePlace(prompter, now);
  return answer({}, "jumped");
}

// ---------------------------------------------------------------------------
// The size and the look (one press each)
// ---------------------------------------------------------------------------

function setLook(prompter: FixturePrompter, look: PrompterLook, sizePx: number, relayout: boolean, now: number) {
  savePlace(prompter, now);
  prompter.look = look;
  prompter.sizePx = sizePx;
  if (relayout) {
    prompter.lookRevision += 1;
    prompter.glass?.relayout(now, layoutKey(prompter));
  }
}

/** `prompter.textSize { sizePx? | step? | standard? }`: 48–160 px in steps of 4; `standard` returns to the look's. */
function textSizeRequest(prompter: FixturePrompter, params: JsonObject, now: number): Answer {
  const standard = flagParam(params, "standard");
  const sizePx = wholeParam(params, "sizePx");
  const step = stepParam(params);
  let size: number;
  if (sizePx !== null && step === null && !standard) {
    if (!sizeIsValid(sizePx))
      throw invalid(`sizePx must be ${SIZE_MIN_PX}–${SIZE_MAX_PX} in steps of ${SIZE_STEP_PX}.`);
    size = sizePx;
  } else if (sizePx === null && step !== null && !standard) {
    size = Math.min(Math.max(prompter.sizePx + step * SIZE_STEP_PX, SIZE_MIN_PX), SIZE_MAX_PX);
  } else if (sizePx === null && step === null && standard) {
    size = prompter.look.standardSizePx;
  } else {
    throw invalid("Give the size as sizePx, step or standard, one of them.");
  }
  setLook(prompter, prompter.look, size, size !== prompter.sizePx, now);
  return answer({ sizePx: size }, "size");
}

/** `PrompterLook::updated`: each named field in range, or the whole update is refused and nothing changes. */
export function updatedLook(look: PrompterLook, params: JsonObject): PrompterLook {
  const next = { ...look };
  const keys = Object.keys(params)
    .filter((key) => params[key] !== undefined)
    .sort();
  if (keys.length === 0) throw invalid("The look's update names no setting.");
  for (const key of keys) {
    const value = params[key];
    const whole = () => {
      if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff) return value;
      throw invalid(`${key} must be a whole number.`);
    };
    const onOff = () => {
      if (typeof value === "boolean") return value;
      throw invalid(`${key} must be true or false.`);
    };
    switch (key) {
      case "standardSizePx": {
        const size = whole();
        if (!sizeIsValid(size)) {
          throw invalid(`The standard text size must be ${SIZE_MIN_PX}–${SIZE_MAX_PX} px in steps of ${SIZE_STEP_PX}.`);
        }
        next.standardSizePx = size;
        break;
      }
      case "lineSpacingPercent": {
        const spacing = whole();
        if (spacing < 110 || spacing > 200 || spacing % 10 !== 0) {
          throw invalid(
            "The line spacing must be 1.1–2.0 in steps of 0.1 (lineSpacingPercent 110–200 in steps of 10)."
          );
        }
        next.lineSpacingPercent = spacing;
        break;
      }
      case "marginPercent": {
        const margin = whole();
        if (margin > 30) throw invalid("The margins must be 0–30 % each side.");
        next.marginPercent = margin;
        break;
      }
      case "textColour":
        if (value !== "white" && value !== "yellow") throw invalid("The text colour must be white or yellow.");
        next.textColour = value;
        break;
      case "readingLinePercent": {
        const height = whole();
        if (height < 20 || height > 60) throw invalid("The reading line must be 20–60 % from the top.");
        next.readingLinePercent = height;
        break;
      }
      case "readingLineAcross":
        next.readingLineAcross = onOff();
        break;
      case "dimReadText":
        next.dimReadText = onOff();
        break;
      case "paragraphNumbers":
        next.paragraphNumbers = onOff();
        break;
      default:
        throw invalid(`The look has no setting called ${key}.`);
    }
  }
  return next;
}

/** `prompter.look.update`: when the standard size changes and the take was at the standard, the take follows. */
function lookRequest(prompter: FixturePrompter, params: JsonObject, now: number): Answer {
  const look = updatedLook(prompter.look, params);
  const size = prompter.sizePx === prompter.look.standardSizePx ? look.standardSizePx : prompter.sizePx;
  const relayout = laysOutDifferently(prompter.look, look) || size !== prompter.sizePx;
  setLook(prompter, look, size, relayout, now);
  return answer({}, "look");
}

/** `prompter.layout.report { layoutKey, lines, endTop }`: an older key is not accepted; a wrong layout is refused. */
function layoutRequest(prompter: FixturePrompter, params: JsonObject, now: number): Answer {
  const key = textParam(params, "layoutKey");
  const lines = layoutLines(params);
  const endTop = params.endTop;
  if (typeof endTop !== "number") throw invalid("endTop must be a number.");
  const glass = prompter.glass;
  if (!glass || glass.layoutKey !== key) return answer({ accepted: false });
  // The first report for a key is the one the clock runs on; another view's for the same
  // key changes nothing (review of 2026-09-27: the glass and the page's copy may break a
  // line differently, and each report moved a paused place).
  if (glass.layout) return answer({ accepted: true });
  const layout = newLayout(key, lines, endTop, glass.paragraphs);
  if (typeof layout === "string") throw invalid(layout);
  glass.acceptLayout(now, layout);
  return answer({ accepted: true }, "laid-out");
}

/**
 * `prompter.screen.report { found, duplicated?, width?, height?, refreshHz?, windowError? }`:
 * the Prompter XL as the shell found it in Windows' display configuration (Slice 5a). When
 * the glass is no longer drawn, a scroll pauses where it is — its place kept, the next
 * `PLAY` refused until the glass is back — and plugging back in leaves it paused (D12:
 * nothing scrolls by itself). A report that changes nothing raises nothing.
 */
function screenRequest(prompter: FixturePrompter, params: JsonObject, now: number): Answer {
  const screen = screenFromReport(params);
  if (sameScreen(screen, prompter.screen)) return answer({ screen: screenSummary(screen), paused: false });
  prompter.screen = screen;
  let paused = false;
  const glass = prompter.glass;
  if (!screenDraws(screenState(screen)) && glass?.playing) {
    // As `prompter.pause` does: saved where the 0.3 s ease stops the text.
    glass.pause(now);
    saveThisPlace(prompter, glass.restingPlace(now));
    paused = true;
  }
  return answer({ screen: screenSummary(screen), paused }, "screen");
}

function answerRequest(prompter: FixturePrompter, method: RequestMethod, params: JsonObject, now: number): Answer {
  switch (method) {
    case "prompter.snapshot":
      return answer(readSnapshot(prompter, now));
    case "prompter.glass.snapshot":
      return answer(readGlassSnapshot(prompter, now));
    case "prompter.script.snapshot":
      return answer(readScriptSnapshot(prompter, textParam(params, "scriptId")));
    case "prompter.script.import":
      return importRequest(prompter, params, now);
    case "prompter.script.paste":
      return pasteRequest(prompter, params, now);
    case "prompter.putOn":
      return putOnRequest(prompter, params, now);
    case "prompter.update":
      return updateRequest(prompter, now);
    case "prompter.clear":
      return clearRequest(prompter, now);
    case "prompter.play":
      return playRequest(prompter, now);
    case "prompter.pause": {
      const glass = glassOf(prompter);
      glass.pause(now);
      // Where the 0.3 s ease will stop the text, not where it was at the press (review of
      // 2026-09-27).
      saveThisPlace(prompter, glass.restingPlace(now));
      return answer({}, "paused");
    }
    case "prompter.speed":
      return speedRequest(prompter, params, now);
    case "prompter.jump":
      return jumpRequest(prompter, params, now);
    case "prompter.textSize":
      return textSizeRequest(prompter, params, now);
    case "prompter.look.update":
      return lookRequest(prompter, params, now);
    case "prompter.layout.report":
      return layoutRequest(prompter, params, now);
    case "prompter.screen.report":
      return screenRequest(prompter, params, now);
    default:
      return scriptRequest(prompter, method, params, now);
  }
}

/**
 * The requests that can change `checks.prompter` or the whole status's part of it
 * (`changes_the_check`): the Prompter XL, or what the glass shows against the script's text
 * and name. The check is compared around these only, as the hardware link does.
 */
const CHANGES_THE_CHECK: ReadonlySet<RequestMethod> = new Set([
  "prompter.screen.report",
  "prompter.putOn",
  "prompter.update",
  "prompter.clear",
  "prompter.script.edit",
  "prompter.script.rename",
  "prompter.script.import",
  "prompter.script.version.bringBack",
]);

/** The check and the whole status's part of it, compared whole (`PrompterHealthCheck` with its `counted`). */
const healthState = (prompter: FixturePrompter) =>
  JSON.stringify({ check: prompterCheck(prompter), part: prompterStatusPart(prompter) });

/**
 * The Teleprompter's requests: every `prompter.*` method, settling the clock first as the
 * hardware link does. `checks.prompter` is worked out before and after every request but a
 * read (`handle_prompter_request`); when it says something else after it, the health
 * snapshot takes it and `app.changed { reason: "health" }` follows the request's own
 * `prompter.changed` (`dispatch_prompter`).
 */
export function handleFixturePrompterRequest(
  context: FixtureRequestContext,
  method: RequestMethod,
  params: JsonObject
): FixtureRequestResult {
  if (!method.startsWith("prompter.")) return NOT_HANDLED;
  const prompter = fixturePrompter(context.state);
  prompter.emit = context.emit;
  const now = Date.now();
  settlePrompter(prompter, now);
  try {
    const before = CHANGES_THE_CHECK.has(method) ? healthState(prompter) : null;
    const { result, reason } = answerRequest(prompter, method, params, now);
    const healthChanged = before !== null && before !== healthState(prompter);
    if (reason !== null) {
      context.emit("prompter.changed", { reason, anchor: glassAnchor(prompter, now) });
    }
    if (healthChanged) {
      applyPrompterHealth(context.state);
      context.emit("app.changed", { reason: "health" });
    }
    return result;
  } finally {
    schedulePrompterClock(prompter);
  }
}

/** The prompter's part of a backup archive the double exports (format 6). */
export function exportFixturePrompterArchive(context: FixtureRequestContext): PrompterArchive {
  return buildPrompterArchive(fixturePrompter(context.state));
}

/**
 * An archive restore's part for the prompter: the archive's scripts and look when it
 * has a prompter part, the prompter paused where it is, and `prompter.changed`
 * (`backup-restored`). The answer is the restore's sentence on the scripts, if any.
 */
export function restoreFixturePrompterArchive(
  context: FixtureRequestContext,
  archive: PrompterArchive | null
): string | null {
  const prompter = fixturePrompter(context.state);
  prompter.emit = context.emit;
  const now = Date.now();
  const outcome = restoreFromArchive(prompter, archive, now);
  context.emit("prompter.changed", { reason: "backup-restored", anchor: glassAnchor(prompter, now) });
  return outcome ? prompterRestoreSentence(outcome) : null;
}
