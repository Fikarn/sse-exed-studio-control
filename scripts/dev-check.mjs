// `npm run dev:check`: the local gate before every commit, its steps run side
// by side (new pages program, faster checks, 2026-09-25). One after another
// they took about a minute on the studio workstation and kept 4 of its 32
// threads busy; side by side they take about 20 s. `npm run dev:check:serial`
// runs the same steps one after another at the normal priority, the reference
// when a result here looks odd — a timing failure here is re-run there before
// it is believed.
//
// A step starts once the steps it names in `after` have finished, passed or
// failed: every step runs, so one run shows every failure. The cargo steps
// share `native/target`, so they form one chain (started together they only
// wait on cargo's lock). `protocol:check` runs cargo too and, while it runs,
// writes a staging folder under the engine client's sources, which prettier
// and the typecheck would read, so those two start after it. Each step writes
// to its own log (a file, not a pipe, so a leftover grandchild cannot hold a
// step open); a failed step's log is printed at the end, whole when it is
// short, else its failure lines and its tail. The runner lowers its own
// priority first, and every step inherits it, so the live app on this machine
// keeps the CPU it needs (`DEV_CHECK_PRIORITY=normal` keeps the normal one).
// The command line is `scripts/dev-check-cli.mjs`.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheRoot = "node_modules/.cache/dev-check";

/**
 * The key of the local prettier and ESLint caches: the lockfile and the
 * tools' configuration. Both tools already key each file on its content and
 * their own version; a plugin upgraded within its range or an ignore file
 * changed would not show there.
 */
export function toolCacheKey(
  readFile = (name) => (existsSync(path.join(root, name)) ? readFileSync(path.join(root, name)) : null)
) {
  const hash = createHash("sha256");
  for (const name of ["package-lock.json", "eslint.config.mjs", ".prettierrc", ".prettierrc.json", ".prettierignore"]) {
    const content = readFile(name);
    hash.update(`${name}\0`);
    hash.update(content ?? "(none)");
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}

/** The gate's steps; `args` go to the npm script after `--`. */
export function devCheckSteps(cacheKey = toolCacheKey()) {
  return [
    { id: "protocol:check" },
    { id: "rust:clippy", after: ["protocol:check"] },
    { id: "native:test", after: ["rust:clippy"] },
    { id: "rust:fmt:check" },
    // Local caches under node_modules/.cache/dev-check, keyed as above; CI
    // runs the same scripts without them. Prettier deletes its default cache
    // file whenever it runs without --cache, so this one has its own place.
    {
      id: "format:check",
      after: ["protocol:check"],
      args: ["--cache", "--cache-strategy", "content", "--cache-location", `${cacheRoot}/prettier-${cacheKey}`],
    },
    { id: "frontend:typecheck", after: ["protocol:check"] },
    {
      id: "lint",
      args: ["--cache", "--cache-strategy", "content", "--cache-location", `${cacheRoot}/eslint-${cacheKey}/`],
    },
    { id: "scripts:test" },
    { id: "file:health" },
    { id: "frontend:test:coverage" },
  ];
}

export const DEV_CHECK_STEPS = devCheckSteps("key");

/**
 * Runs `steps`, each once the steps in its `after` list have finished.
 * `runStep(step)` resolves to true when the step passed. Resolves to a Map of
 * id -> "passed" | "failed".
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
  const finished = (id) => status.get(id) === "passed" || status.get(id) === "failed";

  return new Promise((resolve, reject) => {
    const advance = () => {
      for (const step of steps) {
        if (status.get(step.id) !== "pending" || !(step.after ?? []).every(finished)) {
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
      if ([...status.keys()].every(finished)) {
        resolve(status);
      }
    };
    advance();
  });
}

const FAILURE_LINE = /\bFAIL\b|✖|×|\berror\b|ERR!|failed|threshold|panicked|not ok\b/i;

/** What to print of a failed step's log: all of it when short, else its failure lines and its end. */
export function failureReport(text, { wholeUpTo = 250, matchesUpTo = 120, tailLines = 40 } = {}) {
  const lines = text.split(/\r?\n/);
  if (lines.length <= wholeUpTo) {
    return text;
  }
  const matches = lines.filter((line) => FAILURE_LINE.test(line)).slice(0, matchesUpTo);
  return [
    `(${lines.length} lines; the lines that read as failures, then the last ${tailLines})`,
    ...matches,
    "...",
    ...lines.slice(-tailLines),
  ].join("\n");
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

function readLog(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "(no log)";
  }
}

export async function main(argv = []) {
  const steps = devCheckSteps();
  if (argv.includes("--list")) {
    for (const step of steps) {
      console.log(`${step.id}${step.after ? ` (after ${step.after.join(", ")})` : ""}`);
    }
    return 0;
  }
  if (process.env.DEV_CHECK_PRIORITY !== "normal") {
    try {
      os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
    } catch {
      // Not allowed here: run at the normal priority.
    }
  }
  const logDir = path.join(root, cacheRoot);
  mkdirSync(logDir, { recursive: true });
  const started = Date.now();
  const seconds = (from, to = Date.now()) => ((to - from) / 1000).toFixed(1);
  const logs = new Map();

  const status = await runSteps(steps, (step) => {
    const log = path.join(logDir, `${step.id.replace(/[^\w.-]/g, "_")}.log`);
    logs.set(step.id, log);
    const fd = openSync(log, "w");
    const stepStarted = Date.now();
    const { command, args, shell } = npmInvocation(step.id, step.args ?? []);
    return new Promise((resolve) => {
      let done = false;
      const finish = (passed) => {
        // `error` and `exit` can both arrive for one failed spawn.
        if (done) {
          return;
        }
        done = true;
        closeSync(fd);
        console.log(
          `${seconds(started).padStart(6)} s  ${passed ? "ok  " : "FAIL"}  ${step.id} (${seconds(stepStarted)} s)`
        );
        resolve(passed);
      };
      const child = spawn(command, args, { cwd: root, shell, stdio: ["ignore", fd, fd] });
      child.on("error", (error) => {
        if (!done) {
          writeSync(fd, `\ndev-check: could not start ${command} ${args.join(" ")}: ${error.message}\n`);
        }
        finish(false);
      });
      child.on("exit", (code) => finish(code === 0));
    });
  });

  const failed = [...status].filter(([, value]) => value === "failed").map(([id]) => id);
  for (const id of failed) {
    const log = logs.get(id);
    console.log(`\n--- ${id} failed; ${path.relative(root, log)}:\n${failureReport(readLog(log))}`);
  }
  console.log(
    `\ndev:check ${failed.length === 0 ? "passed" : `FAILED (${failed.join(", ")})`}: ${status.size} steps in ${seconds(started)} s (logs in ${cacheRoot})`
  );
  return failed.length === 0 ? 0 : 1;
}
