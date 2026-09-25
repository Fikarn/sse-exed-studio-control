import { spawn } from "node:child_process";
import os from "node:os";

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
