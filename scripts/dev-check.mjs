// `npm run dev:check`: the local gate before every commit, its steps run side
// by side (new pages program, faster checks, 2026-09-25). One after another
// they took about a minute on the studio workstation and kept 4 of its 32
// threads busy; side by side they take about 20 s. `npm run dev:check:serial`
// runs the same steps one after another, the reference when a result here
// looks odd.
//
// A step starts once the steps it names in `after` have passed; a step whose
// prerequisite failed is skipped, and every other step still runs, so one
// run shows every failure. The cargo steps share `native/target`, so they
// form one chain (started together they only wait on cargo's lock).
// `protocol:check` runs cargo too and writes a staging folder under the engine
// client's generated sources, which prettier and the typecheck would read, so
// those two wait for it. Each step writes to its own log (a file, not a pipe,
// so a leftover grandchild cannot hold a step open); a failed step's log tail
// is printed at the end. The runner lowers its own priority first, and every
// step inherits it: the live app on this machine keeps the CPU it needs.

import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The gate's steps; `args` go to the npm script after `--`. */
export const DEV_CHECK_STEPS = [
  { id: "protocol:check" },
  { id: "rust:clippy", after: ["protocol:check"] },
  { id: "native:test", after: ["rust:clippy"] },
  { id: "rust:fmt:check" },
  // Local caches under node_modules/.cache, keyed on file content; CI runs
  // the same scripts without them.
  { id: "format:check", after: ["protocol:check"], args: ["--cache", "--cache-strategy", "content"] },
  { id: "frontend:typecheck", after: ["protocol:check"] },
  {
    id: "lint",
    args: ["--cache", "--cache-strategy", "content", "--cache-location", "node_modules/.cache/eslint/"],
  },
  { id: "scripts:test" },
  { id: "file:health" },
  { id: "frontend:test:coverage" },
];

/**
 * Runs `steps` by their `after` lists. `runStep(step)` resolves to true when
 * the step passed. Resolves to a Map of id -> "passed" | "failed" | "skipped".
 */
export async function runSteps(steps, runStep) {
  const ids = new Set(steps.map((step) => step.id));
  for (const step of steps) {
    for (const prerequisite of step.after ?? []) {
      if (!ids.has(prerequisite)) {
        throw new Error(`${step.id} waits for ${prerequisite}, which is not a step`);
      }
    }
  }
  const status = new Map(steps.map((step) => [step.id, "pending"]));
  const settled = () => [...status.values()].every((value) => value !== "pending" && value !== "running");

  return new Promise((resolve, reject) => {
    const advance = () => {
      let changed = true;
      while (changed) {
        changed = false;
        for (const step of steps) {
          if (status.get(step.id) !== "pending") {
            continue;
          }
          const after = step.after ?? [];
          if (after.some((id) => status.get(id) === "failed" || status.get(id) === "skipped")) {
            status.set(step.id, "skipped");
            changed = true;
            continue;
          }
          if (!after.every((id) => status.get(id) === "passed")) {
            continue;
          }
          status.set(step.id, "running");
          Promise.resolve()
            .then(() => runStep(step))
            .then(
              (passed) => {
                status.set(step.id, passed ? "passed" : "failed");
                advance();
              },
              (error) => reject(error)
            );
        }
      }
      if (settled()) {
        resolve(status);
      }
    };
    advance();
    if (steps.length === 0) {
      resolve(status);
    }
  });
}

function npmInvocation(script, args) {
  const npmArgs = ["run", script, ...(args.length > 0 ? ["--", ...args] : [])];
  // Under `npm run`, npm names its own entry point; spawning node on it needs
  // no shell on Windows.
  if (process.env.npm_execpath && process.env.npm_execpath.endsWith(".js")) {
    return { command: process.execPath, args: [process.env.npm_execpath, ...npmArgs], shell: false };
  }
  return { command: "npm", args: npmArgs, shell: process.platform === "win32" };
}

function tail(file, lines) {
  try {
    return readFileSync(file, "utf8").split(/\r?\n/).slice(-lines).join("\n");
  } catch {
    return "(no log)";
  }
}

async function main() {
  try {
    os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {
    // Not allowed here: run at the normal priority.
  }
  const logDir = path.join(root, "node_modules", ".cache", "dev-check");
  mkdirSync(logDir, { recursive: true });
  const started = Date.now();
  const seconds = (from, to = Date.now()) => ((to - from) / 1000).toFixed(1);
  const timing = new Map();

  const status = await runSteps(DEV_CHECK_STEPS, (step) => {
    const log = path.join(logDir, `${step.id.replace(/[^\w.-]/g, "_")}.log`);
    const fd = openSync(log, "w");
    const stepStarted = Date.now();
    const { command, args, shell } = npmInvocation(step.id, step.args ?? []);
    return new Promise((resolve) => {
      const child = spawn(command, args, { cwd: root, shell, stdio: ["ignore", fd, fd] });
      let finished = false;
      const finish = (passed) => {
        // `error` and `exit` can both arrive for one failed spawn.
        if (finished) {
          return;
        }
        finished = true;
        closeSync(fd);
        timing.set(step.id, { log, seconds: seconds(stepStarted) });
        console.log(
          `${seconds(started).padStart(6)} s  ${passed ? "ok  " : "FAIL"}  ${step.id} (${seconds(stepStarted)} s)`
        );
        resolve(passed);
      };
      child.on("error", () => finish(false));
      child.on("exit", (code) => finish(code === 0));
    });
  });

  const failed = [...status].filter(([, value]) => value === "failed").map(([id]) => id);
  const skipped = [...status].filter(([, value]) => value === "skipped").map(([id]) => id);
  for (const id of failed) {
    const { log } = timing.get(id);
    console.log(`\n--- ${id} failed; the end of ${path.relative(root, log)}:\n${tail(log, 60)}`);
  }
  if (skipped.length > 0) {
    console.log(`\nSkipped because a step before them failed: ${skipped.join(", ")}`);
  }
  console.log(
    `\ndev:check ${failed.length === 0 && skipped.length === 0 ? "passed" : "FAILED"}: ${status.size} steps in ${seconds(started)} s (logs in ${path.relative(root, logDir)})`
  );
  process.exitCode = failed.length === 0 && skipped.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
