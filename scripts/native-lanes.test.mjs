import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  acceptanceEngineEnv,
  LIVE_CONSOLE,
  MOVED_WORKSPACE,
  NEW_DATA_WORKSPACE,
  SEEDED_WORKSPACE,
} from "./native-parity-acceptance.mjs";
import {
  DEFAULT_APP_DATA_DIR_NAME,
  defaultAppDataDirs,
  EngineHarness,
  hardenedLaneEnv,
  isSameOrInside,
  LIVE_APP_CONTROL_SURFACE_PORT,
  laneEnvRefusal,
  laneProcessEnv,
} from "./native-runtime-harness.mjs";

// New pages program, Slice 2: Planning left the hardware link. Every lane that
// still asked for it (a `planning.*` request, the PROJECTS and TASKS pages'
// route `/api/deck/action`, the `project_nav` LCD) failed only when it ran,
// and the packaged, installer, delivery and bridge lanes run only at a release.
// These tests read the lanes and hold them to what the hardware link answers:
// the contract's methods, the bridge's routes and its LCD keys.
//
// Slice 2b (2026-09-25): the db.json import is retired, and the lanes seed
// their saved data through the app's own requests. These tests also hold
// them to that — no lane names the import's variables or fixtures, and every
// publish carries the probe override a fresh hardware link needs — and to
// the program's hardware-safety rule: every engine and shell a lane starts
// has a bridge port of its own, holds the light outputs and (outside the live
// console lane) runs the simulated console.
//
// The review of Slice 2b (2026-09-25) found three gaps, closed here: nothing
// checked that a lane's app gets scratch app data at all (the installer's
// first-launch check once opened the real one, and no test held its fix);
// any lane could leave the simulated console unnoticed; and importing
// native-package.mjs deleted the folder the live app runs from. These tests
// read the lane scripts as text and never import the destructive ones.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The scripts that send requests to a test hardware link. */
const LANES = [
  "scripts/native-acceptance.mjs",
  "scripts/native-parity-acceptance.mjs",
  "scripts/native-control-surface-qualification.mjs",
  "scripts/native-packaged-acceptance.mjs",
  "scripts/native-installer-acceptance.mjs",
  "scripts/native-delivery-acceptance.mjs",
  "scripts/native-release-safety.mjs",
];
const BRIDGE_LANE = "scripts/native-control-surface-qualification.mjs";
/** The scripts that start the app — an engine or a shell — for a lane, and the harness that starts their engines. */
const PROCESS_LANES = [
  "scripts/native-runtime-harness.mjs",
  "scripts/native-acceptance.mjs",
  "scripts/native-control-surface-qualification.mjs",
  "scripts/native-package.mjs",
  "scripts/native-packaged-acceptance.mjs",
  "scripts/native-installer-acceptance.mjs",
  "scripts/native-delivery-acceptance.mjs",
  "scripts/legacy/tauri-package-candidate.mjs",
  "scripts/tauri-setup-support-qualification.mjs",
  "scripts/tauri-workspace-qualification.mjs",
  "scripts/tauri-smoke.mjs",
];
const ALL_LANES = [...new Set([...LANES, ...PROCESS_LANES])];
const HARNESS = "scripts/native-runtime-harness.mjs";
/** The one launch that leaves the safe start out (its step 8 proves a hold outlives the launch that made it). */
const SAFE_START_WAIVER_LANE = "scripts/tauri-setup-support-qualification.mjs";
/** The one place a lane may leave the simulated console: the live console lane's engines (`SSE_NATIVE_ACCEPTANCE_LIVE_CONSOLE=1`). */
const CONSOLE_WAIVER = "scripts/native-parity-acceptance.mjs acceptanceEngineEnv: simulatedAudio";
/**
 * The scripts that do work when started — delete or rewrite folders under
 * release/ (on the studio workstation `release/native/windows` is the
 * installed app), write other files, start processes, open a server or end
 * the process — and so must do nothing when imported. Since 2026-09-26 that
 * is every script under scripts/ that did any of it at load, except
 * scripts/dev-check-cli.mjs, the command line that always runs (its own
 * comment) and that nothing imports, and the scripts whose run was already
 * behind a main-module check.
 */
const DESTRUCTIVE_SCRIPTS = [
  "scripts/native-package.mjs",
  "scripts/native-installer.mjs",
  "scripts/native-update-repo.mjs",
  "scripts/native-installer-acceptance.mjs",
  "scripts/native-sign-windows.mjs",
  "scripts/write-native-release-checksums.mjs",
  "scripts/native-windows-release-evidence.mjs",
  "scripts/native-release-build.mjs",
  "scripts/verify-native-release-artifacts.mjs",
  "scripts/verify-native-release-continuity.mjs",
  "scripts/native-acceptance.mjs",
  "scripts/native-control-surface-qualification.mjs",
  "scripts/native-packaged-acceptance.mjs",
  "scripts/native-delivery-acceptance.mjs",
  "scripts/tauri-smoke.mjs",
  "scripts/tauri-setup-support-qualification.mjs",
  "scripts/tauri-workspace-qualification.mjs",
  "scripts/tauri-visual-review.mjs",
  "scripts/tauri-before-command.mjs",
  "scripts/protocol/generate-protocol-artifacts.mjs",
  "scripts/legacy/tauri-package-candidate.mjs",
  "scripts/legacy/tauri-candidate-ifw.mjs",
  "scripts/legacy/tauri-windows-target-evidence.mjs",
  "scripts/legacy/verify-tauri-candidate-artifacts.mjs",
  "scripts/release/publish-release.mjs",
  "scripts/release/verify-native-release.mjs",
  "scripts/release/verify-release-anchor.mjs",
  "scripts/release/validate-release.mjs",
  "scripts/release/write-release-notes.mjs",
  "scripts/frontend/run-playwright.mjs",
  "scripts/frontend/storybook-static-server.mjs",
  "scripts/dev-doctor.mjs",
  "scripts/file-health.mjs",
  "scripts/check-slice-rescope.mjs",
];

function read(relative) {
  return readFileSync(path.join(repoRoot, relative), "utf8");
}

/**
 * Drops `//` comments and `/* … *\/` blocks, which may name what is gone,
 * read around strings and regular expressions (a `//` comment that names
 * `docs/plans/**.md` opens no block); a block leaves its line breaks.
 */
function withoutComments(source) {
  let text = "";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const regexEnd = char === "/" ? regexLiteralEnd(source, index) : -1;
    if (char === '"' || char === "'" || char === "`") {
      const end = closingQuote(source, index);
      text += source.slice(index, end === -1 ? source.length : end + 1);
      index = end === -1 ? source.length : end;
    } else if (char === "/" && source[index + 1] === "/") {
      const end = source.indexOf("\n", index);
      index = (end === -1 ? source.length : end) - 1;
    } else if (char === "/" && source[index + 1] === "*") {
      const close = source.indexOf("*/", index + 2);
      const end = close === -1 ? source.length : close + 2;
      text += source.slice(index, end).replace(/[^\n]/g, "");
      index = end - 1;
    } else if (regexEnd !== -1) {
      text += source.slice(index, regexEnd + 1);
      index = regexEnd;
    } else {
      text += char;
    }
  }
  return text;
}

/**
 * The index of the `/` that closes the regular-expression literal opening at
 * `open`, or -1 when the `/` there opens none: a literal follows an operator,
 * an opening bracket, a comma or a keyword, and ends on its own line; a `/`
 * after a name, a number or a closing bracket divides.
 */
function regexLiteralEnd(source, open) {
  if (source[open] !== "/" || source[open + 1] === "/" || source[open + 1] === "*") {
    return -1;
  }
  let before = open - 1;
  while (before >= 0 && /\s/.test(source[before])) {
    before -= 1;
  }
  const afterKeyword = /\b(?:return|typeof|case|in|of|void|delete|throw|await|yield)$/.test(
    source.slice(Math.max(0, before - 9), before + 1)
  );
  if (before >= 0 && !"(,=:[!&|?{};+-*%<>~^".includes(source[before]) && !afterKeyword) {
    return -1;
  }
  let inClass = false;
  for (let index = open + 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\\") {
      index += 1;
    } else if (char === "\n") {
      return -1;
    } else if (inClass) {
      inClass = char !== "]";
    } else if (char === "[") {
      inClass = true;
    } else if (char === "/") {
      return index;
    }
  }
  return -1;
}

/** The index of the bracket that closes the one at `open`, skipping quoted text and regular expressions; -1 when it never closes. */
function closingIndex(source, open) {
  const pairs = { "(": ")", "[": "]", "{": "}" };
  const stack = [];
  let quote = null;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === "\\") {
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    const regexEnd = char === "/" ? regexLiteralEnd(source, index) : -1;
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
    } else if (regexEnd !== -1) {
      index = regexEnd;
    } else if (pairs[char]) {
      stack.push(pairs[char]);
    } else if (char === stack.at(-1)) {
      stack.pop();
      if (stack.length === 0) {
        return index;
      }
    }
  }
  return -1;
}

/** The params of every `.request(<id>, "commissioning.update", …)` call; null for params that are not an object literal. */
function commissioningUpdateParams(source) {
  const text = withoutComments(source);
  const pattern = /\.request\(\s*(?:`[^`]*`|"[^"]*"|'[^']*')\s*,\s*"commissioning\.update"\s*(,\s*\{)?/g;
  return [...text.matchAll(pattern)].map((match) => {
    if (!match[1]) {
      return null;
    }
    const open = match.index + match[0].length - 1;
    return text.slice(open, closingIndex(text, open) + 1);
  });
}

/** Every `laneProcessEnv(…)` call of a source, as [open, close] indexes. */
function laneProcessEnvCalls(text) {
  return [...text.matchAll(/\blaneProcessEnv\(/g)].map((match) => {
    const open = match.index + match[0].length - 1;
    return [open, closingIndex(text, open)];
  });
}

/** The index of the quote that closes the one at `open`. */
function closingQuote(source, open) {
  for (let index = open + 1; index < source.length; index += 1) {
    if (source[index] === "\\") {
      index += 1;
    } else if (source[index] === source[open]) {
      return index;
    }
  }
  return -1;
}

/** The text between the brackets at `open` and its closing one, split at its top-level commas. */
function bracketItems(text, open) {
  const close = closingIndex(text, open);
  assert.notEqual(close, -1, `a bracket the scan cannot close: …${text.slice(open, open + 60)}`);
  const items = [];
  let start = open + 1;
  for (let index = open + 1; index < close; index += 1) {
    const char = text[index];
    const regexEnd = char === "/" ? regexLiteralEnd(text, index) : -1;
    if (char === '"' || char === "'" || char === "`") {
      index = closingQuote(text, index);
    } else if (regexEnd !== -1) {
      index = regexEnd;
    } else if ("([{".includes(char)) {
      index = closingIndex(text, index);
    } else if (char === ",") {
      items.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  const last = text.slice(start, close).trim();
  return last ? [...items, last] : items;
}

/** Every `function <name>(…) {…}` of a source: its name, parameters (the first one apart) and body range. */
function functionsOf(text) {
  return [...text.matchAll(/\bfunction\s+(\w+)\s*\(/g)].map((match) => {
    const paramsOpen = match.index + match[0].length - 1;
    const bodyOpen = text.indexOf("{", closingIndex(text, paramsOpen));
    const params = bracketItems(text, paramsOpen);
    return {
      name: match[1],
      firstParam: /^\w+/.exec(params[0] ?? "")?.[0] ?? null,
      params: params.map((param) => /^(?:\.\.\.)?(\w+)/.exec(param)?.[1]).filter(Boolean),
      body: [bodyOpen, closingIndex(text, bodyOpen)],
    };
  });
}

/**
 * Whether a `const` declared at `binding` is still in scope at `at`: the
 * innermost `{…}` around it (scanning from `from`, a `{` or the source's
 * start) closes after `at`, or there is none.
 */
function inScopeAt(text, from, binding, at) {
  const opens = [];
  for (let index = from; index < binding; index += 1) {
    const char = text[index];
    const regexEnd = char === "/" ? regexLiteralEnd(text, index) : -1;
    if (char === '"' || char === "'" || char === "`") {
      const end = closingQuote(text, index);
      index = end === -1 ? binding : end;
    } else if (regexEnd !== -1) {
      index = regexEnd;
    } else if (char === "{") {
      opens.push(index);
    } else if (char === "}") {
      opens.pop();
    }
  }
  const block = opens.at(-1);
  return block === undefined || closingIndex(text, block) > at;
}

/** The body of the function `name` in a source, or null. */
function functionBody(text, name) {
  const found = functionsOf(text).find((candidate) => candidate.name === name);
  return found ? text.slice(found.body[0], found.body[1] + 1) : null;
}

const isStringLiteral = (expression) => /^(["'])[^"'\\]*\1$|^`[^`$]*`$/.test(expression);

/**
 * Every process a source starts (`spawn`, `spawnSync`, or a function of its
 * own that passes its first parameter to one) whose environment laneProcessEnv
 * did not build, as `<callee>(<command>…)`. A start whose command is written
 * out ("reg.exe", "powershell") is a tool, not the app, and passes. An
 * environment passes when it is a `laneProcessEnv(…)` call, a call to a
 * function of the source that returns one, or a `const` bound to either in
 * scope at the start — declared in the innermost function around it (or, for
 * a start at the top level, there) and not in a block closed before it; a
 * parameter of that function is its caller's value and does not pass. A
 * runner that hands its caller's `options.env` on is judged at its calls.
 */
function processStartsOutsideLaneEnv(source) {
  const text = withoutComments(source);
  const functions = functionsOf(text);
  const builders = new Set(
    functions
      .filter(({ body }) => /\breturn\s+laneProcessEnv\(/.test(text.slice(body[0], body[1])))
      .map(({ name }) => name)
  );
  const builtByLaneEnv = (expression) => {
    const call = /^(?:await\s+)?(\w+)\(/.exec(expression);
    return call !== null && (call[1] === "laneProcessEnv" || builders.has(call[1]));
  };
  // The innermost function around `at`, or undefined at the top level.
  const functionAround = (at) =>
    functions.filter(({ body }) => body[0] < at && at < body[1]).sort((a, b) => b.body[0] - a.body[0])[0];
  // "lane", "delegated" (options.env), or "unhardened".
  const envOf = (items, at) => {
    const options = items.length > 1 && items.at(-1).startsWith("{") ? items.at(-1) : null;
    const entry = options ? bracketItems(options, 0).find((item) => /^env\b/.test(item)) : undefined;
    if (entry === undefined) {
      return "unhardened";
    }
    const value = entry === "env" ? "env" : entry.replace(/^env\s*:\s*/, "");
    if (/^options\.env\b/.test(value)) {
      return "delegated";
    }
    if (/^\w+$/.test(value)) {
      const scope = functionAround(at);
      if (scope?.params.includes(value)) {
        return "unhardened";
      }
      const from = scope ? scope.body[0] : 0;
      const binding = [...text.slice(from, at).matchAll(new RegExp(`\\bconst\\s+${value}\\s*=\\s*`, "g"))]
        .filter((match) => inScopeAt(text, from, from + match.index, at))
        .at(-1);
      return binding && builtByLaneEnv(text.slice(from + binding.index + binding[0].length)) ? "lane" : "unhardened";
    }
    return builtByLaneEnv(value) ? "lane" : "unhardened";
  };
  const callsOf = (callee) =>
    [...text.matchAll(new RegExp(`(?<![\\w.])${callee}\\(`, "g"))]
      .filter((match) => !/\bfunction\s*$/.test(text.slice(Math.max(0, match.index - 12), match.index)))
      .map((match) => ({ at: match.index, items: bracketItems(text, match.index + match[0].length - 1) }));

  const strays = [];
  const judgeCalls = (callee, needsEnv) => {
    for (const { at, items } of callsOf(callee)) {
      if (!isStringLiteral(items[0] ?? "") && (!needsEnv || envOf(items, at) !== "lane")) {
        strays.push(`${callee}(${items[0] ?? ""}, …)`);
      }
    }
  };
  for (const starter of ["spawn", "spawnSync"]) {
    for (const { at, items } of callsOf(starter)) {
      const command = items[0] ?? "";
      const env = envOf(items, at);
      if (isStringLiteral(command) || env === "lane") {
        continue;
      }
      const runner = functionAround(at);
      if (runner && runner.firstParam === command) {
        // A runner: its callers name the process, and hand it the environment
        // when it passes theirs on.
        judgeCalls(runner.name, env === "delegated");
      } else {
        strays.push(`${starter}(${command}, …)`);
      }
    }
  }
  return strays;
}

/**
 * Every word of a source that can leave the simulated console: `where` is
 * "acceptanceEngineEnv" inside that function, else the text around it.
 */
function consoleWaivers(source) {
  const text = withoutComments(source);
  const waiver = functionsOf(text).find(({ name }) => name === "acceptanceEngineEnv");
  return [...text.matchAll(/\b(simulatedAudio|liveConsole|SSE_AUDIO_SIMULATED_INPUT_MODE)\b/g)].map((match) => ({
    word: match[1],
    where:
      waiver && waiver.body[0] < match.index && match.index < waiver.body[1]
        ? "acceptanceEngineEnv"
        : `…${text.slice(Math.max(0, match.index - 50), match.index + 30).replace(/\s+/g, " ")}…`,
  }));
}

/** The text of the class `name` in a source. */
function classText(source, name) {
  const text = withoutComments(source);
  const start = text.search(new RegExp(`\\bclass\\s+${name}\\b`));
  assert.notEqual(start, -1, `class ${name} not found`);
  const open = text.indexOf("{", start);
  return text.slice(start, closingIndex(text, open) + 1);
}

/**
 * The statements of a module's top level: `shape` with every bracket's and
 * regular expression's contents elided, `raw` as written.
 */
function topLevelStatements(source) {
  const text = withoutComments(source);
  const statements = [];
  let shape = "";
  let start = 0;
  const flush = (end) => {
    if (shape.trim()) {
      statements.push({ shape: shape.trim().replace(/\s+/g, " "), raw: text.slice(start, end).trim() });
    }
    shape = "";
    start = end;
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const regexEnd = char === "/" ? regexLiteralEnd(text, index) : -1;
    if (char === '"' || char === "'" || char === "`") {
      const end = closingQuote(text, index);
      shape += text.slice(index, end + 1);
      index = end;
    } else if (regexEnd !== -1) {
      shape += "/…/";
      index = regexEnd;
    } else if ("([{".includes(char)) {
      const close = closingIndex(text, index);
      assert.notEqual(close, -1, `a bracket the scan cannot close: …${text.slice(index, index + 60)}`);
      shape += `${char}…${text[close]}`;
      index = close;
      if (char === "{" && /^\s*(?:export\s+)?(?:async\s+)?(?:function|class|if)\b/.test(shape)) {
        flush(index + 1);
      }
    } else if (char === ";") {
      flush(index + 1);
    } else {
      shape += char;
    }
  }
  flush(text.length);
  return statements;
}

/**
 * A source with its string, regular-expression and template literals emptied;
 * a template keeps the code of its `${…}` parts, which run.
 */
function codeOnly(source) {
  let code = "";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const regexEnd = char === "/" ? regexLiteralEnd(source, index) : -1;
    if (char === "`") {
      const end = closingQuote(source, index);
      const parts = [];
      for (let at = index + 1; at < end; at += 1) {
        if (source[at] === "\\") {
          at += 1;
        } else if (source[at] === "$" && source[at + 1] === "{") {
          const close = closingIndex(source, at + 1);
          parts.push(`\${${codeOnly(source.slice(at + 2, close))}}`);
          at = close;
        }
      }
      code += `\`${parts.join("")}\``;
      index = end;
    } else if (char === '"' || char === "'") {
      code += `${char}${char}`;
      index = closingQuote(source, index);
    } else if (regexEnd !== -1) {
      code += "/…/";
      index = regexEnd;
    } else {
      code += char;
    }
  }
  return code;
}

/**
 * Every call in a piece of code, by the name it is called by (`new Set`,
 * `path.join`); a call on what another call returned is `….name` or `…()`.
 */
function callsIn(source) {
  const code = codeOnly(source);
  const calls = [];
  for (let index = 0; index < code.length; index += 1) {
    if (code[index] !== "(") {
      continue;
    }
    let end = index;
    while (end > 0 && /\s/.test(code[end - 1])) {
      end -= 1;
    }
    let start = end;
    while (start > 0 && /[\w$.?]/.test(code[start - 1])) {
      start -= 1;
    }
    const callee = code.slice(start, end);
    if (!callee || /^\.{3}$/.test(callee)) {
      // A group (spread or not) or an arrow function's parameters — or a
      // call of what a call returned.
      if (!callee && end > 0 && ")]".includes(code[end - 1])) {
        calls.push("…()");
      }
      continue;
    }
    if (callee.startsWith(".") || callee.startsWith("?.")) {
      calls.push(`…${callee}`);
    } else {
      calls.push(/\bnew\s+$/.test(code.slice(Math.max(0, start - 8), start)) ? `new ${callee}` : callee);
    }
  }
  return calls;
}

/** What a top-level constant may call: each of these only reads. */
const READ_ONLY_CALLS = new Set([
  "fileURLToPath",
  "JSON.parse",
  "JSON.stringify",
  "Number",
  "new Map",
  "new Set",
  "path.dirname",
  "path.join",
  "path.resolve",
  "process.argv.includes",
  "process.argv.slice",
  "readFileSync",
  "resolveNativeReleaseRuntime",
]);

/** The main-module check of a script in DESTRUCTIVE_SCRIPTS. */
const MAIN_MODULE_CHECK = /^if\s*\(\s*isMainModule\(\)\s*\)\s*\{/;

/**
 * A top-level statement that does no work when the module is imported: an
 * import or export list, a function or class declaration (an arrow function
 * in a constant too), the one `if (isMainModule()) {…}`, or a `const` or `let`
 * whose value calls nothing but READ_ONLY_CALLS — a literal, a regular
 * expression, a path, the command line, an environment variable, a file read.
 */
function isInertTopLevel({ shape, raw }) {
  if (
    /^import\b/.test(shape) ||
    /^export\s*\{…\}/.test(shape) ||
    /^(?:export\s+)?(?:async\s+)?function\s*\*?\s*\w+\s*\(…\)\s*\{…\}$/.test(shape) ||
    /^(?:export\s+)?class\s+\w+(?:\s+extends\s+[\w.]+)?\s*\{…\}$/.test(shape) ||
    /^(?:export\s+)?const\s+[\w$]+\s*=\s*(?:async\s+)?(?:\(…\)|[\w$]+)\s*=>/.test(shape)
  ) {
    return true;
  }
  if (shape === "if (…) {…}") {
    return MAIN_MODULE_CHECK.test(raw);
  }
  return (
    /^(?:export\s+)?(?:const|let)\s+[\w$]+\s*(?:=|;?$)/.test(shape) &&
    callsIn(raw).every((call) => READ_ONLY_CALLS.has(call))
  );
}

/**
 * The body of the function `name` declared at a source's top level, or null:
 * a name the source imports or binds to a constant, or a function nested in
 * another, is not one.
 */
function topLevelFunctionBody(source, name) {
  const declaration = new RegExp(`^(?:export\\s+)?function\\s+${name}\\s*\\(…\\)\\s*\\{…\\}$`);
  const declared = topLevelStatements(source).filter(({ shape }) => declaration.test(shape));
  return declared.length === 1 ? functionBody(declared[0].raw, name) : null;
}

/**
 * What keeps a script of DESTRUCTIVE_SCRIPTS from doing nothing when it is
 * imported: work at its top level, other than exactly one main-module check,
 * or an isMainModule that is not a function of the script itself comparing
 * the real paths of `process.argv[1]` and `import.meta.url` (through a
 * junction or a short 8.3 name the two spell the same file differently, and
 * the run would be skipped without a word).
 */
function mainModuleProblems(script, source) {
  const problems = [];
  const statements = topLevelStatements(source);
  for (const { shape } of statements.filter((statement) => !isInertTopLevel(statement))) {
    problems.push(`${script} does work when it is imported: ${shape}`);
  }
  const checks = statements.filter(({ shape }) => shape === "if (…) {…}").length;
  if (checks !== 1) {
    problems.push(`${script}: ${checks} main-module checks, not exactly one`);
  }
  const isMain = topLevelFunctionBody(source, "isMainModule");
  if (!isMain) {
    return [...problems, `${script}: isMainModule is not a function declared in the script`];
  }
  if (!/process\.argv\[1\]/.test(isMain)) {
    problems.push(`${script}: isMainModule does not read process.argv[1]`);
  }
  if (!/fileURLToPath\(import\.meta\.url\)/.test(isMain)) {
    problems.push(`${script}: isMainModule does not read import.meta.url`);
  }
  if ([...isMain.matchAll(/realpathSync\.native\(/g)].length !== 2) {
    problems.push(`${script}: isMainModule does not compare real paths`);
  }
  return problems;
}

/** The method of every `.request(<id>, "<method>"…)` call in a source. */
function requestedMethods(source) {
  const pattern = /\.request\(\s*(?:`[^`]*`|"[^"]*"|'[^']*')\s*,\s*"([^"]+)"/g;
  return [...withoutComments(source).matchAll(pattern)].map((match) => match[1]);
}

/** The body of a Rust function, from its signature to the next `fn`. */
function rustFunctionBody(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} not found`);
  const next = source.indexOf("\nfn ", start + signature.length);
  const nextPub = source.indexOf("\npub fn ", start + signature.length);
  const ends = [next, nextPub].filter((index) => index !== -1);
  return source.slice(start, ends.length > 0 ? Math.min(...ends) : undefined);
}

function contractMethods() {
  const contract = JSON.parse(read("native/protocol/v1.contract.json"));
  return new Set(contract.methods);
}

function bridgeRoutes() {
  const body = rustFunctionBody(
    read("native/rust-engine/src/control_surface_http.rs"),
    "fn route_control_surface_request("
  );
  return new Set([...body.matchAll(/\("(?:GET|POST)",\s*"(\/api\/deck\/[^"]+)"\)/g)].map((match) => match[1]));
}

function bridgeLcdKeys() {
  const body = rustFunctionBody(
    read("native/rust-engine/src/control_surface.rs"),
    "pub fn read_control_surface_lcd_text("
  );
  return new Set([...body.matchAll(/"([a-z0-9_]+)"\s*(?==>|\|)/g)].map((match) => match[1]));
}

test("the contract and the bridge sources parse into methods, routes and LCD keys", () => {
  const methods = contractMethods();
  assert.ok(methods.has("app.snapshot") && methods.has("support.backup.restore"), "contract methods");
  assert.deepEqual(
    [...bridgeRoutes()].sort(),
    ["/api/deck/audio-action", "/api/deck/context", "/api/deck/lcd", "/api/deck/light-action"],
    "bridge routes"
  );
  const lcdKeys = bridgeLcdKeys();
  for (const key of ["light_nav", "scene_nav", "audio_strip_1", "audio_key_8", "audio_state_gated", "workspace"]) {
    assert.ok(lcdKeys.has(key), `LCD key ${key}`);
  }
  assert.deepEqual(requestedMethods('await h.request(`${p}-x`, "a.b", {}); h.request("id", "c.d")'), ["a.b", "c.d"]);
});

test("every request a hardware-link lane sends is a method of the contract", () => {
  const methods = contractMethods();
  const strays = [];
  for (const lane of LANES) {
    const requested = requestedMethods(read(lane));
    assert.ok(requested.length > 0, `${lane} sends no request the scan can see`);
    for (const method of requested) {
      if (!methods.has(method)) {
        strays.push(`${lane}: ${method}`);
      }
    }
  }
  assert.deepEqual(strays, [], "requests the hardware link answers with UNKNOWN_METHOD");
});

test("the bridge lane calls only routes the bridge serves and reads only LCD keys it answers", () => {
  const source = withoutComments(read(BRIDGE_LANE));
  const routes = bridgeRoutes();
  const paths = new Set([...source.matchAll(/\/api\/deck\/[a-z-]+/g)].map((match) => match[0]));
  assert.ok(paths.size > 0, "the scan found no bridge path");
  assert.deepEqual(
    [...paths].filter((route) => !routes.has(route)),
    [],
    "bridge paths the lane uses that the bridge no longer routes"
  );

  // The LCDs the lane reads with fetchJson, which requires a 200; the keys it
  // sends to be refused go through fetchStatus.
  const lcdKeys = bridgeLcdKeys();
  const readKeys = [
    ...source.matchAll(/fetchJson\(`\$\{expectedBaseUrl\}\/api\/deck\/lcd\?key=([A-Za-z0-9_%]+)`\)/g),
  ].map((match) => decodeURIComponent(match[1]));
  assert.ok(readKeys.length > 0, "the scan found no LCD the lane reads");
  assert.deepEqual(
    readKeys.filter((key) => !lcdKeys.has(key)),
    [],
    "LCD keys the lane reads that the bridge refuses"
  );
});

test("every publish a lane sends carries the probe override a fresh hardware link needs", () => {
  assert.deepEqual(
    commissioningUpdateParams(
      'await h.request(`${p}-x`, "commissioning.update", { stage: "ready", a: { b: "}" } }); h.request("y", "commissioning.update", params)'
    ),
    ['{ stage: "ready", a: { b: "}" } }', null],
    "the scanner reads the params object whole and names params it cannot read"
  );

  const publishes = [];
  const refused = [];
  for (const lane of ALL_LANES) {
    for (const params of commissioningUpdateParams(read(lane))) {
      if (params === null) {
        refused.push(`${lane}: params the scan cannot read`);
      } else if (/\bstage:\s*"ready"/.test(params)) {
        publishes.push(lane);
        if (!/\boverrideProbes:\s*true\b/.test(params)) {
          refused.push(`${lane}: ${params.replace(/\s+/g, " ")}`);
        }
      }
    }
  }
  assert.ok(publishes.length > 0, "the scan found no publish");
  // Without the override the hardware link refuses the publish while any
  // probe has not passed (COMMISSIONING_PROBES_INCOMPLETE), and no lane host
  // has the studio's hardware.
  assert.deepEqual(refused, [], "publishes a fresh hardware link refuses");
});

test("no lane names the retired db.json import, its variables or its fixtures", () => {
  const retired = [
    /SSE_LEGACY_DB_PATH/,
    /SSE_DISABLE_AUTO_IMPORT/,
    /[\w-]+-db\.json/,
    /rust-engine["'`]\s*,\s*["'`]fixtures|rust-engine[\\/]fixtures/,
  ];
  const strays = [];
  for (const lane of ALL_LANES) {
    const text = withoutComments(read(lane));
    for (const pattern of retired) {
      const match = pattern.exec(text);
      if (match) {
        strays.push(`${lane}: ${match[0]}`);
      }
    }
  }
  assert.deepEqual(strays, [], "the lanes seed through the app's own requests now");
});

/** Scratch app-data and log folders under the system's temporary folder; nothing is made. */
function scratchFolders(name = "sse-native-lanes-scratch") {
  const root = path.join(os.tmpdir(), name);
  return { SSE_APP_DATA_DIR: path.join(root, "app-data"), SSE_LOG_DIR: path.join(root, "logs") };
}

test("the lanes' hardening: a bridge port of their own, the light outputs held, the simulated console", async () => {
  const folders = scratchFolders();
  const env = await hardenedLaneEnv();
  assert.match(env.SSE_CONTROL_SURFACE_PORT, /^\d{1,5}$/);
  assert.notEqual(Number(env.SSE_CONTROL_SURFACE_PORT), LIVE_APP_CONTROL_SURFACE_PORT);
  assert.equal(env.SSE_SAFE_START, "1");
  assert.equal(env.SSE_AUDIO_SIMULATED_INPUT_MODE, "1");
  assert.equal(laneEnvRefusal({ ...env, ...folders }, { liveConsole: false }), null);

  // The live console lane keeps the real console and nothing else.
  const live = { ...(await hardenedLaneEnv({ simulatedAudio: false })), ...folders };
  assert.equal(Object.hasOwn(live, "SSE_AUDIO_SIMULATED_INPUT_MODE"), false);
  assert.equal(laneEnvRefusal(live, { liveConsole: true }), null);
  assert.match(laneEnvRefusal(live, { liveConsole: false }), /SSE_AUDIO_SIMULATED_INPUT_MODE/);
  const acceptance = await acceptanceEngineEnv({ SSE_LANE_MARKER: "kept" });
  assert.equal(acceptance.SSE_LANE_MARKER, "kept");
  assert.equal(acceptance.SSE_SAFE_START, "1");
  assert.equal(acceptance.SSE_AUDIO_SIMULATED_INPUT_MODE, LIVE_CONSOLE ? undefined : "1");
  assert.equal(laneEnvRefusal({ ...acceptance, ...folders }), null);

  const hardened = {
    ...folders,
    SSE_CONTROL_SURFACE_PORT: "45123",
    SSE_SAFE_START: "1",
    SSE_AUDIO_SIMULATED_INPUT_MODE: "1",
  };
  assert.equal(laneEnvRefusal(hardened, { liveConsole: false }), null);
  const refused = {
    "no port": { ...hardened, SSE_CONTROL_SURFACE_PORT: undefined },
    "the live app's port": { ...hardened, SSE_CONTROL_SURFACE_PORT: String(LIVE_APP_CONTROL_SURFACE_PORT) },
    "a port the engine cannot read (it would fall back to the live app's)": {
      ...hardened,
      SSE_CONTROL_SURFACE_PORT: "0x10",
    },
    "a port out of range": { ...hardened, SSE_CONTROL_SURFACE_PORT: "70000" },
    "no safe start": { ...hardened, SSE_SAFE_START: undefined },
    "a safe start switched off": { ...hardened, SSE_SAFE_START: "off" },
    "the real console": { ...hardened, SSE_AUDIO_SIMULATED_INPUT_MODE: undefined },
    "a simulated console the engine does not read": { ...hardened, SSE_AUDIO_SIMULATED_INPUT_MODE: "on" },
  };
  for (const [label, candidate] of Object.entries(refused)) {
    assert.notEqual(laneEnvRefusal(candidate, { liveConsole: false }), null, label);
  }
  // The waiver leaves out the safe start and nothing else.
  const armedStart = { ...hardened, SSE_SAFE_START: "0" };
  assert.equal(laneEnvRefusal(armedStart, { safeStart: false, liveConsole: false }), null);
  assert.notEqual(
    laneEnvRefusal({ ...armedStart, SSE_CONTROL_SURFACE_PORT: "38201" }, { safeStart: false, liveConsole: false }),
    null
  );
});

test("the harness starts no engine without the lanes' hardening, and checks before it looks or makes anything", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "sse-native-lanes-"));
  try {
    const engineExecutable = path.join(root, "no-engine-here.exe");
    const unhardened = new EngineHarness({
      rootDir: repoRoot,
      appDataDir: path.join(root, "unhardened", "app-data"),
      logsDir: path.join(root, "unhardened", "logs"),
      engineExecutable,
      env: {
        SSE_CONTROL_SURFACE_PORT: String(LIVE_APP_CONTROL_SURFACE_PORT),
        SSE_SAFE_START: "1",
        SSE_AUDIO_SIMULATED_INPUT_MODE: "1",
      },
    });
    await assert.rejects(unhardened.start(), /was not started: SSE_CONTROL_SURFACE_PORT is 38201/);
    assert.equal(existsSync(path.join(root, "unhardened")), false, "the refused start made no folder");

    // A hardened environment passes the check and stops only at the missing
    // executable: no engine runs in this test.
    const hardened = new EngineHarness({
      rootDir: repoRoot,
      appDataDir: path.join(root, "hardened", "app-data"),
      logsDir: path.join(root, "hardened", "logs"),
      engineExecutable,
      env: await acceptanceEngineEnv(),
    });
    await assert.rejects(hardened.start(), /Native engine executable not found/);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("every app a lane starts gets its scratch folders and the hardening check in one place", () => {
  const strays = [];
  for (const lane of PROCESS_LANES) {
    const text = withoutComments(read(lane));
    const calls = laneProcessEnvCalls(text);
    assert.ok(
      calls.every(([, close]) => close !== -1),
      `${lane}: a laneProcessEnv( call the scan cannot close`
    );
    // An engine or a shell is handed its app data as `SSE_APP_DATA_DIR`; one
    // started without it would open the real app data.
    const handovers = [...text.matchAll(/\bSSE_APP_DATA_DIR\s*:/g)].map((match) => match.index);
    assert.ok(handovers.length > 0 || /\bnew EngineHarness\(/.test(text), `${lane} starts nothing the scan can see`);
    for (const at of handovers) {
      if (!calls.some(([open, close]) => open < at && at < close)) {
        strays.push(`${lane}: …${text.slice(Math.max(0, at - 60), at + 40).replace(/\s+/g, " ")}…`);
      }
    }
  }
  assert.deepEqual(strays, [], "app data handed to a process outside laneProcessEnv, which holds it to the hardening");

  const waivers = PROCESS_LANES.flatMap((lane) =>
    [...withoutComments(read(lane)).matchAll(/\bsafeStart:\s*false\b/g)].map(() => lane)
  );
  assert.deepEqual(waivers, [SAFE_START_WAIVER_LANE], "a launch without the safe start other than the one allowed");
});

test("a lane's app gets an absolute scratch app-data and log folder of its own, never the platform's app data", async () => {
  // The platform's app data, read as bootstrap.rs reads it: every candidate,
  // an empty variable counting as unset, Windows names without case.
  assert.deepEqual(
    defaultAppDataDirs(
      { AppData: "C:\\Users\\op\\AppData\\Roaming", LOCALAPPDATA: "C:\\Users\\op\\AppData\\Local" },
      "win32"
    ),
    [
      `C:\\Users\\op\\AppData\\Roaming\\${DEFAULT_APP_DATA_DIR_NAME}`,
      `C:\\Users\\op\\AppData\\Local\\${DEFAULT_APP_DATA_DIR_NAME}`,
    ]
  );
  assert.deepEqual(defaultAppDataDirs({ APPDATA: "", LOCALAPPDATA: "C:\\L" }, "win32"), [
    `C:\\L\\${DEFAULT_APP_DATA_DIR_NAME}`,
  ]);
  assert.deepEqual(defaultAppDataDirs({ XDG_DATA_HOME: "/x/data", HOME: "/home/op" }, "linux"), [
    `/x/data/${DEFAULT_APP_DATA_DIR_NAME}`,
    `/home/op/.local/share/${DEFAULT_APP_DATA_DIR_NAME}`,
  ]);

  const root = mkdtempSync(path.join(os.tmpdir(), "sse-native-lanes-appdata-"));
  try {
    // A stand-in for the platform's app-data folder, named by the variable
    // the platform reads; the real one is only ever compared with.
    const platformBase = path.join(root, "platform-app-data");
    const platformVariables =
      process.platform === "win32" ? { APPDATA: platformBase } : { XDG_DATA_HOME: platformBase };
    const [standInDefault] = defaultAppDataDirs(platformVariables);
    mkdirSync(standInDefault, { recursive: true });
    const junction = path.join(root, "junction");
    symlinkSync(standInDefault, junction, "junction");

    const hardened = {
      ...(await hardenedLaneEnv()),
      ...platformVariables,
      SSE_APP_DATA_DIR: path.join(root, "scratch", "app-data"),
      SSE_LOG_DIR: path.join(root, "scratch", "logs"),
    };
    assert.equal(laneEnvRefusal(hardened, { liveConsole: false }), null);
    // A sibling whose name starts like the app's folder is not inside it.
    assert.equal(
      laneEnvRefusal({ ...hardened, SSE_APP_DATA_DIR: `${standInDefault}-scratch` }, { liveConsole: false }),
      null
    );

    const refused = {
      "no app data": { ...hardened, SSE_APP_DATA_DIR: undefined },
      "an empty app data (the engine reads it as unset)": { ...hardened, SSE_APP_DATA_DIR: "" },
      "a relative app data": { ...hardened, SSE_APP_DATA_DIR: "app-data" },
      "no log folder": { ...hardened, SSE_LOG_DIR: undefined },
      "a relative log folder": { ...hardened, SSE_LOG_DIR: "logs" },
      "the platform's app data": { ...hardened, SSE_APP_DATA_DIR: standInDefault },
      "a folder inside it": { ...hardened, SSE_APP_DATA_DIR: path.join(standInDefault, "scratch") },
      "a log folder inside it": { ...hardened, SSE_LOG_DIR: path.join(standInDefault, "logs") },
      "the platform's app data through a junction": { ...hardened, SSE_APP_DATA_DIR: path.join(junction, "scratch") },
    };
    for (const [label, candidate] of Object.entries(refused)) {
      assert.match(
        laneEnvRefusal(candidate, { liveConsole: false }) ?? "",
        /^SSE_(APP_DATA|LOG)_DIR /,
        `${label} must be refused`
      );
    }
    // This process's own platform app data — on the studio workstation the
    // live data — is refused whatever the child's variables say.
    const [ownDefault] = defaultAppDataDirs(process.env);
    if (ownDefault) {
      assert.match(
        laneEnvRefusal({ ...hardened, SSE_APP_DATA_DIR: path.join(ownDefault, "scratch") }, { liveConsole: false }) ??
          "",
        /inside the real app data/
      );
    }
    // Every engine and shell a lane starts goes through laneProcessEnv, which
    // refuses before anything is spawned.
    assert.throws(
      () => laneProcessEnv(hardened, { SSE_APP_DATA_DIR: undefined }, { label: "A planted start" }),
      /A planted start was not started: SSE_APP_DATA_DIR must name an absolute scratch folder/
    );

    assert.equal(isSameOrInside(path.join(junction, "a"), standInDefault), true);
    assert.equal(isSameOrInside(root, standInDefault), false);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("every process a lane starts gets its environment from laneProcessEnv, the installer's QtIFW runs included", () => {
  // The scan's own cases. The first is the installer lane before the review
  // of 2026-09-25: QtIFW's install ran the installed app's first-launch check
  // with the lane's plain environment unless a caller remembered to pass one.
  const planted = [
    "function runCliStep(command, args, root, step, env = {}) {",
    "  return spawnSync(command, args, { cwd: root, env: { ...process.env, HOME: root, ...env } });",
    "}",
    'runCliStep(installerExecutable, ["install"], root, "installer-install");',
    'runCliStep(installerExecutable, ["install"], root, "installer-reinstall", await installerRunEnv(root));',
    'spawnSync("reg.exe", ["query", hive], { encoding: "utf8" });',
    "spawn(shellPath, [], { env: { ...process.env, SSE_SAFE_START: '1' } });",
    "spawn(enginePath);",
  ].join("\n");
  assert.deepEqual(processStartsOutsideLaneEnv(planted), [
    "spawn(shellPath, …)",
    "spawn(enginePath, …)",
    "runCliStep(installerExecutable, …)",
    "runCliStep(installerExecutable, …)",
  ]);
  const hardenedForms = [
    "async function installerRunEnv(root) {",
    "  return laneProcessEnv(await hardenedLaneEnv(), { SSE_APP_DATA_DIR: root }, {});",
    "}",
    "async function runCliStep(command, args, root) {",
    "  const env = await installerRunEnv(root);",
    "  return spawnSync(command, args, { cwd: root, env });",
    "}",
    "function run(command, args, options = {}) {",
    "  return spawnSync(command, args, { env: options.env ?? process.env });",
    "}",
    'run("powershell", ["-Command", "x"]);',
    "run(shellPath, args, { captureOutput: true, env: laneProcessEnv(base, {}) });",
    "spawn(enginePath, [], { env: laneProcessEnv(base, { SSE_APP_DATA_DIR: dir }) });",
  ].join("\n");
  assert.deepEqual(processStartsOutsideLaneEnv(hardenedForms), []);
  assert.deepEqual(processStartsOutsideLaneEnv(`${hardenedForms}\nrun(shellPath, args);`), ["run(shellPath, …)"]);
  // The review of 2026-09-26: a hardened `const env` counts only where it is
  // in scope. The installer lane's runInstalledSmoke takes an `env` parameter
  // of its own (its callers' plain environment, no app data) after
  // runCliStep's `const env`; passing it on shorthand once passed the scan.
  const scoped = [
    "async function installerRunEnv(root) {",
    "  return laneProcessEnv(await hardenedLaneEnv(), { SSE_APP_DATA_DIR: root }, {});",
    "}",
    "async function runCliStep(command, args, root, step) {",
    "  const env = await installerRunEnv(root);",
    '  return spawnSync(command, args, { cwd: root, encoding: "utf8", env });',
    "}",
    "function runInstalledSmoke(installed, root, runtime, step, target, env = {}) {",
    '  return spawnSync(installed.shellPath, installed.commandArgs(root), { cwd: root, encoding: "utf8", env });',
    "}",
    "function startEngine(enginePath, dir) {",
    "  if (dir) {",
    "    const env = laneProcessEnv(base, { SSE_APP_DATA_DIR: dir });",
    "    spawn(enginePath, [], { env });",
    "  }",
    "  return spawn(enginePath, [], { env });",
    "}",
    "startEngine(engineExecutable, scratch);",
  ].join("\n");
  assert.deepEqual(processStartsOutsideLaneEnv(scoped), [
    "startEngine(engineExecutable, …)",
    "spawnSync(installed.shellPath, …)",
  ]);

  const strays = PROCESS_LANES.flatMap((lane) =>
    processStartsOutsideLaneEnv(read(lane)).map((stray) => `${lane}: ${stray}`)
  );
  assert.deepEqual(strays, [], "a process started with an environment laneProcessEnv did not build");
});

test("only acceptanceEngineEnv may leave the simulated console, and no lane can ask laneProcessEnv for the real one", async () => {
  assert.deepEqual(
    consoleWaivers(
      [
        "export async function acceptanceEngineEnv(extra = {}) {",
        "  return { ...(await hardenedLaneEnv({ simulatedAudio: !LIVE_CONSOLE })), ...extra };",
        "}",
        "const env = laneProcessEnv(await hardenedLaneEnv({ simulatedAudio: false }), {}, { liveConsole: true });",
        'const overrides = { SSE_AUDIO_SIMULATED_INPUT_MODE: "0" };',
      ].join("\n")
    ).map(({ word, where }) => `${where === "acceptanceEngineEnv" ? where : "elsewhere"}: ${word}`),
    [
      "acceptanceEngineEnv: simulatedAudio",
      "elsewhere: simulatedAudio",
      "elsewhere: liveConsole",
      "elsewhere: SSE_AUDIO_SIMULATED_INPUT_MODE",
    ]
  );

  // Every lane script except the harness, whose helpers define the options,
  // and the harness's own engine start.
  const waivers = [
    ...ALL_LANES.filter((lane) => lane !== HARNESS).map((lane) => [lane, read(lane)]),
    [`${HARNESS} EngineHarness`, classText(read(HARNESS), "EngineHarness")],
  ].flatMap(([lane, source]) => consoleWaivers(source).map(({ word, where }) => `${lane} ${where}: ${word}`));
  assert.deepEqual(
    waivers,
    [CONSOLE_WAIVER],
    "a lane that leaves the simulated console other than the live console lane"
  );

  const env = { ...(await hardenedLaneEnv({ simulatedAudio: false })), ...scratchFolders() };
  for (const liveConsole of [true, false]) {
    assert.throws(
      () => laneProcessEnv(env, {}, { label: "A planted lane", liveConsole }),
      /A planted lane was not started: a lane cannot choose the real console/
    );
  }
});

test("the scripts that do work do nothing when imported, and packaging refuses to replace the folder a running app uses", () => {
  // The scan's own cases: what only reads passes, and a call to anything
  // else is work, however deep in a constant's value it sits.
  const planted = [
    'import path from "node:path";',
    'const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");',
    "const args = process.argv.slice(2);",
    'const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";',
    "const TIMEOUT_MS = Number(process.env.SSE_TIMEOUT_MS ?? 40_000);",
    "const HALF_SECOND_MS = 1_000 / 2;",
    'const VERSION_LINE = /^version\\s*=\\s*"(?<version>[^"]+)"/;',
    "// lint-staged passes the staged `docs/plans/**.md` files",
    "const RESCOPE = /\\*\\*Rescope:\\*\\*/;",
    "let evidence = null;",
    'const isText = (value, minLength) => typeof value === "string" && value.trim().length >= minLength;',
    'const schema = { required: [...(contract.shapes ? ["shapes"] : [])], ...(contract.shapes ? { shapes: 1 } : {}) };',
    "const header = `// protocol ${JSON.stringify(contract.version)} (generated)`;",
    'function versionOf(line) { return line.match(/"(?<version>[^"(]+)"/)?.groups.version; }',
    "function work() { rmSync(rootDir, { recursive: true }); }",
    "work(); // don't: a trailing comment",
    "const packaged = packageWindowsLocal();",
    'const outputRoot = path.join(findWorkspaceRoot(process.cwd()), "release");',
    'const laneEvidence = createQualificationEvidence({ lane: "x", rootDir });',
    "const stamp = `built at ${resolveGitSha()} (generated)`;",
    "process.chdir(rootDir);",
    "if (isMainModule()) {\n  await main();\n}",
    "main().catch(() => {});",
    "process.exitCode = await main(process.argv.slice(2));",
    "if (process.argv.includes('--go')) { work(); }",
  ].join("\n");
  assert.deepEqual(
    topLevelStatements(planted)
      .filter((statement) => !isInertTopLevel(statement))
      .map(({ shape }) => shape),
    [
      "work(…)",
      "const packaged = packageWindowsLocal(…)",
      "const outputRoot = path.join(…)",
      "const laneEvidence = createQualificationEvidence(…)",
      "const stamp = `built at ${resolveGitSha()} (generated)`",
      "process.chdir(…)",
      "main(…).catch(…)",
      "process.exitCode = await main(…)",
      "if (…) {…}",
    ]
  );

  // The check's own cases: isMainModule must be the script's own function
  // (the review of 2026-09-26), not a name it imports, not a constant, not a
  // function nested in another.
  const realCheck = [
    "function isMainModule() {",
    "  const started = process.argv[1];",
    "  const self = fileURLToPath(import.meta.url);",
    "  return realpathSync.native(started) === realpathSync.native(self);",
    "}",
  ].join("\n");
  const run = "if (isMainModule()) {\n  main();\n}";
  assert.deepEqual(mainModuleProblems("own.mjs", `${realCheck}\n${run}`), []);
  assert.deepEqual(
    [
      ["imported.mjs", `import { isMainModule } from "./helpers.mjs";\n${run}`],
      ["nested.mjs", `function helpers() {\n${realCheck}\n}\nconst isMainModule = () => true;\n${run}`],
      ["always.mjs", `function isMainModule() {\n  return true;\n}\n${run}`],
    ].flatMap(([script, source]) => mainModuleProblems(script, source)),
    [
      "imported.mjs: isMainModule is not a function declared in the script",
      "nested.mjs: isMainModule is not a function declared in the script",
      "always.mjs: isMainModule does not read process.argv[1]",
      "always.mjs: isMainModule does not read import.meta.url",
      "always.mjs: isMainModule does not compare real paths",
    ]
  );

  // Every script's problems at once, so one run names every script that
  // does work when imported.
  const problems = DESTRUCTIVE_SCRIPTS.flatMap((script) => mainModuleProblems(script, read(script)));
  assert.deepEqual(problems, [], "scripts that do work when they are imported");

  // Before it removes release/native/windows, the Windows packaging refuses
  // while Studio Control runs from it or answers on the live app's port.
  const packaging = withoutComments(read("scripts/native-package.mjs"));
  const windows = functionBody(packaging, "packageWindowsLocal");
  const refusalAt = windows.indexOf("await refuseToReplaceARunningApp(outputRoot);");
  assert.notEqual(refusalAt, -1, "packageWindowsLocal never checks for a running app");
  assert.ok(refusalAt < windows.indexOf("rmSync(outputRoot"), "the running-app check comes after the removal");
  const refusal = functionBody(packaging, "refuseToReplaceARunningApp");
  for (const part of [
    "listProcessPaths()",
    "isInside(processPath, outputRoot)",
    "acceptsLocalConnections(LIVE_APP_CONTROL_SURFACE_PORT)",
    "keep-and-restore",
  ]) {
    assert.ok(refusal.includes(part), `refuseToReplaceARunningApp lacks ${part}`);
  }
});

/** Every script under scripts/ as a `scripts/…` path; the tests are not scripts. */
function scriptFiles(dir = "scripts") {
  return readdirSync(path.join(repoRoot, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      return scriptFiles(relative);
    }
    return entry.name.endsWith(".mjs") && !entry.name.endsWith(".test.mjs") ? [relative] : [];
  });
}

/** The command line that runs as soon as it is loaded, on purpose (its own comment says why); nothing imports it. */
const RUNS_WHEN_LOADED = ["scripts/dev-check-cli.mjs"];

/** Top-level statements the scan cannot tell are inert, each read and found to run nothing. */
const READ_AND_FOUND_INERT = new Set([
  // Builds the gate's step list from literals: with a key given,
  // devCheckSteps reads no file.
  "scripts/dev-check.mjs: export const DEV_CHECK_STEPS = devCheckSteps(…)",
]);

/**
 * The older main-module check, a plain path comparison: an import of the
 * script does nothing (through a junction the check can skip a run, never
 * start one). It is written out in the `if`, or is the whole of a function
 * `isMain` of the script's own that the `if` calls.
 */
const PLAIN_COMPARISON = String.raw`process\.argv\[1\]\s*&&\s*(?:path\.resolve\(process\.argv\[1\]\)\s*===\s*fileURLToPath\(import\.meta\.url\)|fileURLToPath\(import\.meta\.url\)\s*===\s*path\.resolve\(process\.argv\[1\]\))`;
const PLAIN_MAIN_CHECK = new RegExp(String.raw`^if\s*\(\s*${PLAIN_COMPARISON}\s*\)\s*\{`);
const IS_MAIN_CHECK = /^if\s*\(\s*isMain\(\)\s*\)\s*\{/;
const PLAIN_IS_MAIN_BODY = new RegExp(String.raw`^\{\s*return\s+${PLAIN_COMPARISON}\s*;?\s*\}$`);

/**
 * What a script outside DESTRUCTIVE_SCRIPTS runs when it is imported. Its
 * main-module check must be the plain one; an `if (isMainModule())` belongs
 * to a listed script, since only a listed script's isMainModule is read (the
 * review of 2026-09-26: an unlisted one that always answered yes passed).
 */
function unlistedScriptStrays(script, source) {
  const strays = [];
  for (const statement of topLevelStatements(source)) {
    const named = `${script}: ${statement.shape}`;
    if (READ_AND_FOUND_INERT.has(named)) {
      continue;
    }
    if (statement.shape !== "if (…) {…}") {
      if (!isInertTopLevel(statement)) {
        strays.push(named);
      }
    } else if (MAIN_MODULE_CHECK.test(statement.raw)) {
      strays.push(`${named}: if (isMainModule()) in a script that is not in DESTRUCTIVE_SCRIPTS`);
    } else if (IS_MAIN_CHECK.test(statement.raw)) {
      if (!PLAIN_IS_MAIN_BODY.test(topLevelFunctionBody(source, "isMain") ?? "")) {
        strays.push(`${named}: isMain is not a function of the script that only compares the two paths`);
      }
    } else if (!PLAIN_MAIN_CHECK.test(statement.raw)) {
      strays.push(named);
    }
  }
  return strays;
}

test("every other script under scripts/ does nothing when imported", () => {
  // The sweep's own cases: the plain check written out or in an isMain of
  // the script's own passes; an isMain that is anything else, one the script
  // imports, an unlisted isMainModule and any other `if` do not.
  const work = '{\n  rmSync("release/native/windows", { recursive: true, force: true });\n}';
  const plainIsMain =
    "function isMain() {\n  return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);\n}";
  assert.deepEqual(
    [
      ["is-main.mjs", `${plainIsMain}\nif (isMain()) ${work}`],
      [
        "inline.mjs",
        `if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) ${work}`,
      ],
      ["always.mjs", `function isMain() {\n  return true;\n}\nif (isMain()) ${work}`],
      ["imported.mjs", `import { isMain } from "./helpers.mjs";\nif (isMain()) ${work}`],
      ["unlisted.mjs", `function isMainModule() {\n  return true;\n}\nif (isMainModule()) ${work}`],
      ["other.mjs", `if (process.env.SSE_GO) ${work}`],
    ].flatMap(([script, source]) => unlistedScriptStrays(script, source)),
    [
      "always.mjs: if (…) {…}: isMain is not a function of the script that only compares the two paths",
      "imported.mjs: if (…) {…}: isMain is not a function of the script that only compares the two paths",
      "unlisted.mjs: if (…) {…}: if (isMainModule()) in a script that is not in DESTRUCTIVE_SCRIPTS",
      "other.mjs: if (…) {…}",
    ]
  );

  const scripts = scriptFiles();
  assert.ok(
    scripts.includes("scripts/native-package.mjs") && scripts.includes("scripts/legacy/tauri-candidate-ifw.mjs")
  );
  assert.deepEqual(
    [...DESTRUCTIVE_SCRIPTS, ...RUNS_WHEN_LOADED].filter((script) => !scripts.includes(script)),
    [],
    "listed scripts that are not there"
  );
  const strays = scripts
    .filter((script) => !DESTRUCTIVE_SCRIPTS.includes(script) && !RUNS_WHEN_LOADED.includes(script))
    .flatMap((script) => unlistedScriptStrays(script, read(script)));
  assert.deepEqual(
    strays,
    [],
    "a script that does work when it is imported: move the work into main() behind isMainModule() and list the script in DESTRUCTIVE_SCRIPTS"
  );
});

/**
 * Every .mjs, .js and .cjs file of the repository as a repo-relative path,
 * outside what installs and builds write (node_modules, target, dist, the
 * packaged release/ at the root) and .git.
 */
function sourceFiles(dir = "") {
  return readdirSync(path.join(repoRoot, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      const skipped = ["node_modules", "target", "dist", ".git"].includes(entry.name) || relative === "release";
      return skipped ? [] : sourceFiles(relative);
    }
    return entry.isFile() && /\.[cm]?js$/.test(entry.name) ? [relative] : [];
  });
}

/**
 * What a source imports, in order: the specifier of every static import and
 * re-export, and the first argument of every `import(…)` and `require(…)` —
 * its string when it is one, else its text.
 */
function importsOf(source) {
  const text = withoutComments(source);
  const found = [];
  for (const match of text.matchAll(/\b(?:import|export)\b\s*(?:[\w$*{}\s,]*?\bfrom\s*)?(["'])([^"'\n]*)\1/g)) {
    found.push({ at: match.index, specifier: match[2] });
  }
  for (const match of text.matchAll(/(?<![\w$.])(?:import|require)\s*\(/g)) {
    const open = match.index + match[0].length - 1;
    const close = closingIndex(text, open);
    const argument = text.slice(open + 1, close === -1 ? open + 200 : close).trim();
    const literal = /^(["'`])([^"'`$\\]*)\1\s*(?:,|$)/.exec(argument);
    found.push({ at: match.index, specifier: literal ? literal[2] : argument });
  }
  return found.sort((a, b) => a.at - b.at).map(({ specifier }) => specifier);
}

/** The repo-relative file `importer` (repo-relative) imports as `specifier`, or null for a package or an expression. */
function importedFile(importer, specifier) {
  let target = null;
  if (/^\.\.?(?:[\\/]|$)/.test(specifier)) {
    target = path.resolve(repoRoot, path.dirname(importer), specifier);
  } else if (specifier.startsWith("file:")) {
    try {
      target = fileURLToPath(specifier);
    } catch {
      return null;
    }
  } else if (path.isAbsolute(specifier)) {
    target = path.resolve(specifier);
  }
  return target === null ? null : path.relative(repoRoot, target).split(path.sep).join("/");
}

/** The index of the `;` that ends the statement going on at `start`, outside brackets and literals. */
function statementEnd(text, start) {
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    const regexEnd = char === "/" ? regexLiteralEnd(text, index) : -1;
    if (char === '"' || char === "'" || char === "`") {
      index = closingQuote(text, index);
    } else if (regexEnd !== -1) {
      index = regexEnd;
    } else if ("([{".includes(char)) {
      index = closingIndex(text, index);
    } else if (char === ";") {
      return index;
    }
    if (index === -1) {
      break;
    }
  }
  return text.length;
}

/**
 * The files the isMainModule of a script in DESTRUCTIVE_SCRIPTS accepts as
 * its start, repo-relative: the items of its `const entryPoints = […]`, or
 * the script alone. Each is worked out as the script works it out, from
 * `fileURLToPath(import.meta.url)` and string literals through path.join,
 * path.resolve, path.dirname and the function's constants; an item the scan
 * cannot work out is given as `?<item>`, and entry points never compared as
 * `?entryPoints.some(…)`.
 */
function namedEntryPoints(script) {
  const body = topLevelFunctionBody(read(script), "isMainModule") ?? "";
  const values = new Map();
  const evaluate = (expression) => {
    if (expression === "fileURLToPath(import.meta.url)") {
      return path.join(repoRoot, script);
    }
    if (isStringLiteral(expression)) {
      return expression.slice(1, -1);
    }
    if (/^\w+$/.test(expression)) {
      return values.get(expression) ?? null;
    }
    const call = /^path\.(join|resolve|dirname)\(/.exec(expression);
    if (!call || closingIndex(expression, call[0].length - 1) !== expression.length - 1) {
      return null;
    }
    const parts = bracketItems(expression, call[0].length - 1).map(evaluate);
    return parts.includes(null) ? null : path[call[1]](...parts);
  };
  let entryPoints = null;
  for (const match of body.matchAll(/\bconst\s+(\w+)\s*=\s*/g)) {
    const start = match.index + match[0].length;
    const expression = body.slice(start, statementEnd(body, start)).trim();
    if (match[1] === "entryPoints") {
      entryPoints = expression.startsWith("[") ? bracketItems(expression, 0) : [`?${expression}`];
    } else {
      const value = evaluate(expression);
      if (value !== null) {
        values.set(match[1], value);
      }
    }
  }
  const named = (entryPoints ?? ["fileURLToPath(import.meta.url)"]).map((item) => {
    const value = evaluate(item);
    return value !== null && path.isAbsolute(value)
      ? path.relative(repoRoot, value).split(path.sep).join("/")
      : `?${item}`;
  });
  return entryPoints && !/\bentryPoints\.some\(/.test(body) ? [...named, "?entryPoints.some(…)"] : named;
}

/** The shims Tauri starts `node scripts/tauri-before-command.mjs` through, from native/ and native/tauri-shell/. */
const TAURI_BEFORE_COMMAND = "scripts/tauri-before-command.mjs";
const TAURI_BEFORE_COMMAND_SHIMS = [
  "native/scripts/tauri-before-command.mjs",
  "native/tauri-shell/scripts/tauri-before-command.mjs",
];

test("a script that does work is imported only by tests and by the entry points its isMainModule names", () => {
  // The scan's own cases.
  assert.deepEqual(
    importsOf(
      [
        'import "../../scripts/a.mjs";',
        'import x, { y as z } from "./b.mjs";',
        'import {\n  c,\n} from "./c.mjs";',
        'import * as d from "./d.mjs";',
        'export { e } from "./e.mjs";',
        'export * from "./f.mjs";',
        'const g = await import("./g.mjs");',
        'const h = require("./h.cjs");',
        'await import(pathToFileURL(path.join(root, "scripts", "i.mjs")).href);',
        '// import "./commented.mjs";',
        'const url = new URL("./j.mjs", import.meta.url);',
        'export const important = "from";',
      ].join("\n")
    ),
    [
      "../../scripts/a.mjs",
      "./b.mjs",
      "./c.mjs",
      "./d.mjs",
      "./e.mjs",
      "./f.mjs",
      "./g.mjs",
      "./h.cjs",
      'pathToFileURL(path.join(root, "scripts", "i.mjs")).href',
    ]
  );
  assert.equal(importedFile("native/tauri-shell/scripts/x.mjs", "../../../scripts/x.mjs"), "scripts/x.mjs");
  assert.equal(importedFile("scripts/x.mjs", "node:fs"), null);

  // Every file that imports a listed script, by the script it imports. A
  // file that names no listed script cannot import one by a path.
  const sameFile = (a, b) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);
  const namePattern = (script) =>
    new RegExp(`(?<![\\w-])${path.posix.basename(script, ".mjs").replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}(?![\\w-])`);
  const importers = new Map(DESTRUCTIVE_SCRIPTS.map((script) => [script, []]));
  for (const file of sourceFiles()) {
    const source = readFileSync(path.join(repoRoot, file), "utf8");
    const named = DESTRUCTIVE_SCRIPTS.filter((script) => namePattern(script).test(source));
    if (named.length === 0) {
      continue;
    }
    for (const specifier of importsOf(source)) {
      const target = importedFile(file, specifier);
      const script =
        target === null
          ? named.find((candidate) => namePattern(candidate).test(specifier))
          : DESTRUCTIVE_SCRIPTS.find((candidate) => sameFile(candidate, target));
      if (script) {
        importers.get(script).push({ file, resolved: target !== null });
      }
    }
  }

  const problems = [];
  for (const script of DESTRUCTIVE_SCRIPTS) {
    const entryPoints = namedEntryPoints(script);
    const found = importers.get(script);
    for (const entry of entryPoints.filter((candidate) => candidate !== script)) {
      if (entry.startsWith("?")) {
        problems.push(`${script}: an entry point of isMainModule the scan cannot work out: ${entry.slice(1)}`);
      } else if (!found.some(({ file, resolved }) => resolved && sameFile(file, entry))) {
        const why = existsSync(path.join(repoRoot, entry)) ? "does not import it" : "is not there";
        problems.push(`${script}: isMainModule names ${entry} as an entry point, which ${why}`);
      }
    }
    for (const { file, resolved } of found) {
      if (file.endsWith(".test.mjs")) {
        continue;
      }
      if (!resolved) {
        problems.push(`${file} imports ${script} by a path the scan cannot work out`);
      } else if (!entryPoints.some((entry) => sameFile(entry, file))) {
        problems.push(
          `${file} imports ${script}, which does nothing when imported: start the script itself, or name ${file} in its isMainModule's entryPoints`
        );
      }
    }
  }
  assert.deepEqual(
    problems,
    [],
    "imports of a script that does work, from files that are not its tests or entry points"
  );

  // Tauri runs `node scripts/tauri-before-command.mjs dev|build`
  // (tauri.conf.json) from native/ or native/tauri-shell/, where it starts a
  // shim that imports the real script: the review of 2026-09-26 found every
  // tauri dev and tauri build refused once the script ran only as itself.
  // Both shims stay (their own comments say why), and both are entry points.
  assert.deepEqual(
    namedEntryPoints(TAURI_BEFORE_COMMAND),
    [TAURI_BEFORE_COMMAND, ...TAURI_BEFORE_COMMAND_SHIMS],
    "tauri-before-command's isMainModule must accept both shims Tauri starts it through"
  );
  for (const shim of TAURI_BEFORE_COMMAND_SHIMS) {
    assert.ok(
      importers.get(TAURI_BEFORE_COMMAND).some(({ file }) => file === shim),
      `${shim} must be there and import ${TAURI_BEFORE_COMMAND}`
    );
  }
});

test("the page a lane seeds can be seen: new saved data opens on another, and the restore's marker differs from it", () => {
  const defaultWorkspace = /pub const DEFAULT_WORKSPACE: &str = "([a-z]+)";/.exec(
    read("native/rust-engine/src/shell_settings.rs")
  )?.[1];
  assert.ok(defaultWorkspace, "DEFAULT_WORKSPACE not found in shell_settings.rs");
  assert.equal(NEW_DATA_WORKSPACE, defaultWorkspace, "the lanes' new-data page is the hardware link's default");
  assert.notEqual(SEEDED_WORKSPACE, NEW_DATA_WORKSPACE, "the seeded page must differ from the default page");
  assert.notEqual(MOVED_WORKSPACE, SEEDED_WORKSPACE, "the page saved after the backup must differ from the seeded one");
});
