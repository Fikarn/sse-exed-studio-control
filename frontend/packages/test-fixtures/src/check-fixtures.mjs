import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// plan PR 6 / workstream D3 (fixture schema piece): hand-rolled invariant
// checks for the fixtures consumed by Playwright + Vitest. Previously this
// script only asserted KEY PRESENCE — a fixture with the right id but the
// wrong shape (missing appSnapshot, lighting with no fixtures array, etc.)
// would still pass. The audit called this out as a silent-drift risk.
// Adding a dedicated Zod dep felt heavy for one consumer, so we use simple
// hand-rolled invariants instead.

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(packageDir, "fixtures.json");
const fixtures = JSON.parse(readFileSync(fixturePath, "utf8"));

const required = ["setup-required", "setup-ready", "lighting-populated", "audio-populated"];

function fail(scenario, message) {
  throw new Error(`Fixture '${scenario}' invariant failed: ${message}`);
}

function requireObject(scenario, value, fieldPath) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(scenario, `${fieldPath} must be a non-array object`);
  }
}

function requireArray(scenario, value, fieldPath) {
  if (!Array.isArray(value)) {
    fail(scenario, `${fieldPath} must be an array`);
  }
}

function requireString(scenario, value, fieldPath) {
  if (typeof value !== "string" || value.length === 0) {
    fail(scenario, `${fieldPath} must be a non-empty string`);
  }
}

function requireBoolean(scenario, value, fieldPath) {
  if (typeof value !== "boolean") {
    fail(scenario, `${fieldPath} must be a boolean`);
  }
}

// Shared invariants every fixture either lacks (intentionally) or must
// satisfy. The check tolerates absent fields — only validates the shape
// when present, so fixtures that intentionally omit a workspace (e.g.
// `startup-loading` has no audioSnapshot) don't trip the gate.
// 2026-09-22: the fixtures say what the hardware link says. It reports the rig
// and the console in their own words (`native/rust-engine/src/lighting/snapshot.rs`,
// `audio/snapshot.rs`) and the Stream Deck bridge by whether it is serving
// (`control_surface.rs`); the browser double used to answer `ok` / `attention`
// for all three, and the screen only knew those. The lighting state may also say
// `loading`, the fixtures' own word for the board where the rig has not
// answered yet; a health check never does.
const RIG_WORDS = new Set(["unconfigured", "disabled", "ready", "attention", "not-verified"]);
const LIGHTING_STATE_WORDS = new Set([...RIG_WORDS, "loading"]);
const CONSOLE_WORDS = new Set(["ready", "attention", "not-verified"]);
const BRIDGE_WORDS = new Set(["ready", "unavailable"]);

function requireWord(scenario, value, allowed, fieldPath) {
  if (value === undefined) {
    return;
  }
  requireString(scenario, value, fieldPath);
  if (!allowed.has(value)) {
    fail(scenario, `${fieldPath} must be one of ${[...allowed].join(", ")}; got "${value}"`);
  }
}

function validateFixture(scenario, entry) {
  requireObject(scenario, entry, "scenario root");

  if (entry.appSnapshot !== undefined) {
    requireObject(scenario, entry.appSnapshot, "appSnapshot");
    if (entry.appSnapshot.runtime !== undefined) {
      requireObject(scenario, entry.appSnapshot.runtime, "appSnapshot.runtime");
      const bridge = entry.appSnapshot.runtime.controlSurface;
      if (bridge !== undefined) {
        requireObject(scenario, bridge, "appSnapshot.runtime.controlSurface");
        requireWord(scenario, bridge.status, BRIDGE_WORDS, "appSnapshot.runtime.controlSurface.status");
      }
    }
    if (entry.appSnapshot.startup !== undefined) {
      requireObject(scenario, entry.appSnapshot.startup, "appSnapshot.startup");
      if (entry.appSnapshot.startup.targetSurface !== undefined) {
        requireString(scenario, entry.appSnapshot.startup.targetSurface, "appSnapshot.startup.targetSurface");
      }
    }
  }

  if (entry.audioSnapshot !== undefined && entry.audioSnapshot !== null) {
    requireObject(scenario, entry.audioSnapshot, "audioSnapshot");
    if (entry.audioSnapshot.channels !== undefined) {
      requireArray(scenario, entry.audioSnapshot.channels, "audioSnapshot.channels");
      for (const [index, channel] of entry.audioSnapshot.channels.entries()) {
        requireObject(scenario, channel, `audioSnapshot.channels[${index}]`);
        requireString(scenario, channel.id, `audioSnapshot.channels[${index}].id`);
      }
    }
    if (entry.audioSnapshot.mixTargets !== undefined) {
      requireArray(scenario, entry.audioSnapshot.mixTargets, "audioSnapshot.mixTargets");
    }
    if (entry.audioSnapshot.snapshots !== undefined) {
      requireArray(scenario, entry.audioSnapshot.snapshots, "audioSnapshot.snapshots");
    }
    if (entry.audioSnapshot.verified !== undefined) {
      requireBoolean(scenario, entry.audioSnapshot.verified, "audioSnapshot.verified");
    }
    requireWord(scenario, entry.audioSnapshot.status, CONSOLE_WORDS, "audioSnapshot.status");
  }

  if (entry.lightingSnapshot !== undefined && entry.lightingSnapshot !== null) {
    requireObject(scenario, entry.lightingSnapshot, "lightingSnapshot");
    if (entry.lightingSnapshot.fixtures !== undefined) {
      requireArray(scenario, entry.lightingSnapshot.fixtures, "lightingSnapshot.fixtures");
    }
    if (entry.lightingSnapshot.groups !== undefined) {
      requireArray(scenario, entry.lightingSnapshot.groups, "lightingSnapshot.groups");
    }
    // 2026-09 production readiness, Slice 11: the hardware link always says
    // whether the light outputs are armed, so a fixture that carries the
    // bridge's state carries this beside it.
    if (entry.lightingSnapshot.reachable !== undefined) {
      requireBoolean(scenario, entry.lightingSnapshot.outputArmed, "lightingSnapshot.outputArmed");
    }
    requireWord(scenario, entry.lightingSnapshot.status, LIGHTING_STATE_WORDS, "lightingSnapshot.status");
  }

  // Slice 11: `recentEvents` is the action log's newest rows — a list of rows
  // with a number id and the five strings the Support plate prints.
  if (entry.supportSnapshot !== undefined && entry.supportSnapshot !== null) {
    requireObject(scenario, entry.supportSnapshot, "supportSnapshot");
    requireArray(scenario, entry.supportSnapshot.recentEvents, "supportSnapshot.recentEvents");
    entry.supportSnapshot.recentEvents.forEach((row, index) => {
      const at = `supportSnapshot.recentEvents[${index}]`;
      requireObject(scenario, row, at);
      if (typeof row.id !== "number") {
        fail(scenario, `${at}.id must be a number`);
      }
      for (const key of ["at", "source", "domain", "action", "target", "detail"]) {
        requireString(scenario, row[key], `${at}.${key}`);
      }
    });
  }

  if (entry.healthSnapshot !== undefined) {
    requireObject(scenario, entry.healthSnapshot, "healthSnapshot");
    // 2026-09 production readiness, Slice 9: the hardware link sends the log
    // excerpt as one string (`native/protocol/v1.md`). The fixtures carried a
    // list, which is what the recovery surface read and why it showed nothing
    // on the workstation.
    if (entry.healthSnapshot.recentLogExcerpt !== undefined) {
      requireString(scenario, entry.healthSnapshot.recentLogExcerpt, "healthSnapshot.recentLogExcerpt");
    }
    if (entry.healthSnapshot.checks !== undefined) {
      requireObject(scenario, entry.healthSnapshot.checks, "healthSnapshot.checks");
      const words = { lighting: RIG_WORDS, audio: CONSOLE_WORDS, controlSurface: BRIDGE_WORDS };
      for (const [key, allowed] of Object.entries(words)) {
        const check = entry.healthSnapshot.checks[key];
        if (check === undefined) continue;
        requireObject(scenario, check, `healthSnapshot.checks.${key}`);
        requireWord(scenario, check.status, allowed, `healthSnapshot.checks.${key}.status`);
      }
    }
  }

  if (entry.commissioningSnapshot !== undefined) {
    requireObject(scenario, entry.commissioningSnapshot, "commissioningSnapshot");
  }

  if (entry.prompter !== undefined) {
    validatePrompter(scenario, entry.prompter);
  }
}

// New pages program, Slice 6a: a scenario's `prompter` names its scripts
// (`index.ts` makes it the double's seed from `prompterScripts.ts`). This
// checker is plain Node and cannot read that TypeScript module, so it holds the
// shape only; a name `prompterScripts.ts` lacks is thrown by `index.ts` as the
// package loads, in every Vitest run and in the app. The double then throws
// for a place outside the script's text or a look out of range.
const PROMPTER_KEYS = new Set(["scripts", "removed", "onGlass", "place", "notUpdated", "look", "sizePx"]);

function requireWhole(scenario, value, fieldPath) {
  if (!Number.isInteger(value) || value < 0) {
    fail(scenario, `${fieldPath} must be a whole number`);
  }
}

function requireNames(scenario, value, fieldPath) {
  requireArray(scenario, value, fieldPath);
  value.forEach((name, index) => requireString(scenario, name, `${fieldPath}[${index}]`));
  if (new Set(value).size !== value.length) {
    fail(scenario, `${fieldPath} names a script twice`);
  }
}

function validatePrompter(scenario, prompter) {
  requireObject(scenario, prompter, "prompter");
  for (const key of Object.keys(prompter)) {
    if (!PROMPTER_KEYS.has(key)) {
      fail(scenario, `prompter.${key} is not one of ${[...PROMPTER_KEYS].join(", ")}`);
    }
  }
  const scripts = prompter.scripts ?? [];
  const removed = prompter.removed ?? [];
  requireNames(scenario, scripts, "prompter.scripts");
  requireNames(scenario, removed, "prompter.removed");
  for (const name of removed) {
    if (scripts.includes(name)) {
      fail(scenario, `prompter.removed names "${name}", which prompter.scripts names too`);
    }
  }
  if (prompter.onGlass !== undefined) {
    requireString(scenario, prompter.onGlass, "prompter.onGlass");
    if (!scripts.includes(prompter.onGlass)) {
      fail(scenario, `prompter.onGlass must be one of prompter.scripts; got "${prompter.onGlass}"`);
    }
  }
  if (prompter.place !== undefined) {
    requireObject(scenario, prompter.place, "prompter.place");
    requireWhole(scenario, prompter.place.paragraph, "prompter.place.paragraph");
    requireWhole(scenario, prompter.place.word, "prompter.place.word");
    if (prompter.onGlass === undefined) {
      fail(scenario, "prompter.place is the glass script's place, so it needs prompter.onGlass");
    }
  }
  if (prompter.notUpdated !== undefined) {
    requireBoolean(scenario, prompter.notUpdated, "prompter.notUpdated");
    if (prompter.notUpdated && prompter.onGlass === undefined) {
      fail(scenario, "prompter.notUpdated needs a script on the glass (prompter.onGlass)");
    }
  }
  if (prompter.look !== undefined) {
    requireObject(scenario, prompter.look, "prompter.look");
  }
  if (prompter.sizePx !== undefined) {
    requireWhole(scenario, prompter.sizePx, "prompter.sizePx");
  }
}

// First gate: every required scenario id must exist.
for (const key of required) {
  if (!(key in fixtures)) {
    throw new Error(`Missing required fixture scenario: ${key}`);
  }
}

// Second gate: every fixture's snapshots must conform to the invariants
// above. Surfacing the failing scenario id + field path makes the
// "fixture x looks wrong" debug loop tighter.
for (const [scenario, entry] of Object.entries(fixtures)) {
  validateFixture(scenario, entry);
}

console.log(`Validated ${Object.keys(fixtures).length} fixture scenarios.`);
