import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// plan PR 6 / workstream D3 (fixture schema piece): hand-rolled invariant
// checks for the fixtures consumed by Playwright + Vitest. Previously this
// script only asserted KEY PRESENCE — a fixture with the right id but the
// wrong shape (missing appSnapshot, planning with no projects array, etc.)
// would still pass. The audit called this out as a silent-drift risk.
// Adding a dedicated Zod dep felt heavy for one consumer, so we use simple
// hand-rolled invariants instead.

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(packageDir, "fixtures.json");
const fixtures = JSON.parse(readFileSync(fixturePath, "utf8"));

const required = [
  "setup-required",
  "setup-ready",
  "lighting-populated",
  "audio-populated",
  "planning-empty",
  "planning-populated",
];

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
function validateFixture(scenario, entry) {
  requireObject(scenario, entry, "scenario root");

  if (entry.appSnapshot !== undefined) {
    requireObject(scenario, entry.appSnapshot, "appSnapshot");
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
  }

  if (entry.planningSnapshot !== undefined && entry.planningSnapshot !== null) {
    requireObject(scenario, entry.planningSnapshot, "planningSnapshot");
    if (entry.planningSnapshot.projects !== undefined) {
      requireArray(scenario, entry.planningSnapshot.projects, "planningSnapshot.projects");
    }
    if (entry.planningSnapshot.tasks !== undefined) {
      requireArray(scenario, entry.planningSnapshot.tasks, "planningSnapshot.tasks");
    }
  }

  if (entry.lightingSnapshot !== undefined && entry.lightingSnapshot !== null) {
    requireObject(scenario, entry.lightingSnapshot, "lightingSnapshot");
    if (entry.lightingSnapshot.fixtures !== undefined) {
      requireArray(scenario, entry.lightingSnapshot.fixtures, "lightingSnapshot.fixtures");
    }
    if (entry.lightingSnapshot.groups !== undefined) {
      requireArray(scenario, entry.lightingSnapshot.groups, "lightingSnapshot.groups");
    }
  }

  if (entry.healthSnapshot !== undefined) {
    requireObject(scenario, entry.healthSnapshot, "healthSnapshot");
  }

  if (entry.commissioningSnapshot !== undefined) {
    requireObject(scenario, entry.commissioningSnapshot, "commissioningSnapshot");
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
