import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const MAX_SOURCE_LINES = 2_000;
const MAX_TRACKED_FILE_BYTES = 1_500_000;

const oversizedSourceAllowlist = new Map(
  [
    [
      "frontend/packages/engine-client/src/transports/fixtureTransport.ts",
      "fixture transport keeps all browser-side protocol simulation in one test-only boundary; split when the next transport feature touches it",
    ],
    [
      "frontend/app/src/app/audio/AudioWorkspace.module.css",
      "audio desk styling landed as one parity pass; split by rail/mixer/inspector during the next audio UI change",
    ],
    [
      "native/rust-engine/src/lighting/tests.rs",
      "lighting integration tests deliberately cover engine-owned fixture, scene, preview, and DMX behavior together",
    ],
    [
      "frontend/app/src/app/lighting/LightingWorkspace.tsx",
      "lighting orchestrator remains the selected workspace assembly point; keep extracting components as features touch it",
    ],
  ].map(([path, reason]) => [path, reason])
);

const largeFileAllowlist = new Map([
  [
    "docs/redesign/assets/dashboard-header/directions-composite.png",
    "historical dashboard design comparison image retained as a design-reference artifact",
  ],
]);

const sourceExtensions = new Set([".css", ".mjs", ".rs", ".ts", ".tsx"]);

function gitTrackedFiles() {
  return execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function extensionFor(filePath) {
  const dotIndex = filePath.lastIndexOf(".");
  return dotIndex === -1 ? "" : filePath.slice(dotIndex);
}

function lineCount(filePath) {
  const content = readFileSync(filePath, "utf8");
  return content.length === 0 ? 0 : content.split("\n").length;
}

const sourceViolations = [];
const largeFileViolations = [];
const allowedLargeSources = [];
const allowedLargeFiles = [];

for (const filePath of gitTrackedFiles()) {
  const size = statSync(filePath).size;

  if (size > MAX_TRACKED_FILE_BYTES) {
    const reason = largeFileAllowlist.get(filePath);
    if (reason) {
      allowedLargeFiles.push({ filePath, size, reason });
    } else {
      largeFileViolations.push({ filePath, size });
    }
  }

  if (!sourceExtensions.has(extensionFor(filePath))) {
    continue;
  }

  const lines = lineCount(filePath);
  if (lines <= MAX_SOURCE_LINES) {
    continue;
  }

  const reason = oversizedSourceAllowlist.get(filePath);
  if (reason) {
    allowedLargeSources.push({ filePath, lines, reason });
  } else {
    sourceViolations.push({ filePath, lines });
  }
}

if (allowedLargeSources.length > 0) {
  console.log("Allowed oversized source files:");
  for (const entry of allowedLargeSources) {
    console.log(`- ${entry.filePath}: ${entry.lines} lines (${entry.reason})`);
  }
}

if (allowedLargeFiles.length > 0) {
  console.log("Allowed large tracked artifacts:");
  for (const entry of allowedLargeFiles) {
    const mib = (entry.size / 1024 / 1024).toFixed(1);
    console.log(`- ${entry.filePath}: ${mib} MiB (${entry.reason})`);
  }
}

if (sourceViolations.length > 0 || largeFileViolations.length > 0) {
  for (const violation of sourceViolations) {
    console.error(
      `Source file exceeds ${MAX_SOURCE_LINES} lines and is not allowlisted: ${violation.filePath} (${violation.lines} lines)`
    );
  }
  for (const violation of largeFileViolations) {
    const mib = (violation.size / 1024 / 1024).toFixed(1);
    console.error(
      `Tracked file exceeds ${MAX_TRACKED_FILE_BYTES} bytes and is not allowlisted: ${violation.filePath} (${mib} MiB)`
    );
  }
  process.exit(1);
}

console.log("File health guard passed.");
