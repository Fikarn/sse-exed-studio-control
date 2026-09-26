import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function main() {
  // Faster checks, 2026-09-25: on the studio workstation the suite runs with
  // more workers (playwright.config.ts), below the normal priority, so the
  // live app keeps the CPU it needs; the browsers and servers Playwright
  // starts inherit it. CI runs at the normal priority.
  if (!process.env.CI) {
    try {
      os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
    } catch {
      // Not allowed here: run at the normal priority.
    }
  }

  const env = { ...process.env };
  delete env.NO_COLOR;

  const command = process.platform === "win32" ? "playwright.cmd" : "playwright";
  const child = spawn(command, process.argv.slice(2), {
    env,
    shell: process.platform === "win32",
    stdio: "inherit",
  });

  child.on("error", (error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });

  child.on("close", (exitCode) => {
    process.exitCode = exitCode ?? 1;
  });
}

// Runs only as `node scripts/frontend/run-playwright.mjs …`: an import does
// nothing (2026-09-26; the run lowers the process's priority and starts
// Playwright). The two paths are compared as real paths — through a directory
// junction or a short 8.3 name, `process.argv[1]` and `import.meta.url` spell
// the same file differently, and a plain comparison would skip the run without
// a word (scripts/dev-check-cli.mjs).
function isMainModule() {
  const started = process.argv[1];
  if (!started) {
    return false;
  }
  const self = fileURLToPath(import.meta.url);
  let same = false;
  try {
    same = realpathSync.native(started) === realpathSync.native(self);
  } catch {
    // Not a file the file system resolves: not this one.
  }
  if (!same && path.basename(started) === path.basename(self)) {
    throw new Error(`${started} was started, but it could not be matched to ${self}; nothing was done.`);
  }
  return same;
}

if (isMainModule()) {
  main();
}
