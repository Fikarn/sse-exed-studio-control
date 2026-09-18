import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";

const MAX_SOURCE_LINES = 2_000;
const MAX_TRACKED_FILE_BYTES = 1_500_000;

// 2026-09 production readiness, Slice 14 (finding F26): there is no allowlist for
// oversized source files. There used to be one, it only ever grew, and it was
// how a 3,170-line component stayed green. The last four entries were split in
// Slice 14; a source file over the limit is split, not excused.
// `scripts/file-health.test.mjs` holds the guard to that.

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
const allowedLargeFiles = [];

for (const filePath of gitTrackedFiles()) {
  if (!existsSync(filePath)) {
    continue;
  }

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

  sourceViolations.push({ filePath, lines });
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
      `Source file exceeds ${MAX_SOURCE_LINES} lines: ${violation.filePath} (${violation.lines} lines). Split it; there is no allowlist for source files.`
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
