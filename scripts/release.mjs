// `npm run release`: a studio build, made from `main` and kept outside the
// repository. `npm run release:verified -- <name>` makes a build the one the
// studio starts, once the owner has walked docs/CHECKLIST.md with it.
//
// A studio build is a folder that holds the shell and the engine, both
// release builds marked as the studio's (`SSE_STUDIO_BUILD=1` while they
// compile: native/protocol/rust/src/development.rs), and `build.json`, which
// names the commit and the hash of each file. The folders live in the builds
// folder beside the repository (`STUDIO_BUILDS_DIR` names another place), so
// nothing git or a build does can remove one. A build is never overwritten
// and never deleted here.
//
// Making a build:
//   1. the working tree is clean and the commit is on `origin/main`;
//   2. `tauri build` builds the pages, the engine and the shell;
//   3. the two files are copied into `<builds>/<day>_<commit>/`;
//   4. the copied shell starts the copied engine and reads a snapshot (the
//      shell's own `--smoke-test`), with the platform's app-data folder moved
//      to a scratch folder and no data folder named: the build opens its
//      default folder there as it will open the studio's, which a
//      development build refuses, so the start also proves the build is the
//      studio's kind;
//   5. the acceptance lane and the bridge lane run against the copied engine,
//      on scratch data with simulated devices: every other test runs a
//      development build.
//
// Nothing here opens the studio's saved data or reaches a device.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { hardenedLaneEnv, isSameOrInside } from "./native-runtime-harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const SHELL_FILE = "sse-exed-tauri-shell.exe";
export const ENGINE_FILE = "studio-control-engine.exe";
export const BUILD_RECORD_FILE = "build.json";
export const LAUNCHER_FILE = "Studio Control.cmd";
export const VERIFIED_LOG_FILE = "verified.txt";
const BUILD_NAME = /^\d{4}-\d{2}-\d{2}_[0-9a-f]{7}$/;

/** Where the studio builds are kept: beside the repository unless `STUDIO_BUILDS_DIR` names a place. */
export function buildsRoot(env, repositoryRoot = root) {
  const named = (env.STUDIO_BUILDS_DIR ?? "").trim();
  const folder = named === "" ? path.join(repositoryRoot, "..", "builds") : path.resolve(named);
  if (isSameOrInside(folder, repositoryRoot)) {
    throw new Error(
      `${folder} is inside the repository. Studio builds are kept outside it, where no build and no git command removes them.`
    );
  }
  return folder;
}

/** A build's folder name: the day it was made and the commit it was made from. */
export function buildName(date, commit) {
  const day = [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join("-");
  return `${day}_${commit.slice(0, 7)}`;
}

/** Whether `name` is a build's folder name, and so safe to put in the launcher. */
export function isBuildName(name) {
  return typeof name === "string" && BUILD_NAME.test(name);
}

/** The launcher's text: it starts the build named, from the builds folder it sits in. */
export function launcherText(name) {
  if (!isBuildName(name)) {
    throw new Error(`'${name}' is not the name of a build: a day, an underscore and seven characters of a commit.`);
  }
  return [
    "@echo off",
    "rem The studio's verified build. `npm run release:verified` writes this file.",
    `start "" "%~dp0${name}\\${SHELL_FILE}"`,
    "",
  ].join("\r\n");
}

/** Why no build is made from this state of the repository, or null. */
export function releaseRefusal({ platform, changedFiles, onMain }) {
  if (platform !== "win32") {
    return "A studio build is made on Windows, where the studio runs it.";
  }
  if (changedFiles.length > 0) {
    const named = changedFiles.slice(0, 3).join(", ");
    const more = changedFiles.length > 3 ? ` and ${changedFiles.length - 3} more` : "";
    return `The working tree has changes (${named}${more}). A studio build is made from a commit, so that build.json says what is in it.`;
  }
  if (!onMain) {
    return "This commit is not on origin/main. A studio build is made from main, which CI has checked.";
  }
  return null;
}

/** The newest saved-data schema the engine's source names, or null. */
export function schemaVersionOf(storageSource) {
  const found = /\bconst STORAGE_SCHEMA_VERSION: \w+ = (\d+);/.exec(storageSource);
  return found ? Number(found[1]) : null;
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** Writes the build's record: what it was made from, and the hash of each file. */
export function writeBuildRecord(folder, facts, now = new Date()) {
  const record = {
    name: path.basename(folder),
    ...facts,
    builtAt: now.toISOString(),
    files: Object.fromEntries([SHELL_FILE, ENGINE_FILE].map((file) => [file, sha256(path.join(folder, file))])),
  };
  writeFileSync(path.join(folder, BUILD_RECORD_FILE), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

/** The build's record when the folder is the build it describes; throws with the reason when not. */
export function readBuildRecord(folder) {
  const recordPath = path.join(folder, BUILD_RECORD_FILE);
  if (!existsSync(recordPath)) {
    throw new Error(`${recordPath} is missing: that folder is not a build \`npm run release\` made.`);
  }
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  const files = Object.entries(record.files ?? {});
  if (record.name !== path.basename(folder) || files.length !== 2) {
    throw new Error(`${recordPath} does not describe the folder it is in.`);
  }
  for (const [file, hash] of files) {
    const filePath = path.join(folder, path.basename(file));
    if (!existsSync(filePath)) {
      throw new Error(`${filePath} is missing.`);
    }
    if (sha256(filePath) !== hash) {
      throw new Error(`${filePath} is not the file build.json describes: it changed after the build was made.`);
    }
  }
  return record;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", ...options });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} ${args.join(" ")} ended with ${result.status ?? result.signal}.`);
  }
}

function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.error) {
    throw result.error;
  }
  return { ok: result.status === 0, text: (result.stdout ?? "").trim(), error: (result.stderr ?? "").trim() };
}

function say(line = "") {
  process.stdout.write(`${line}\n`);
}

/**
 * The environment of the build's trial start: `env` without any `SSE_`
 * variable, the lanes' hardening, and the platform's app-data folder moved to
 * `base`. No data folder is named, so the build opens its default folder
 * under `base`.
 */
export function trialEnv(env, base, hardened) {
  const kept = Object.entries(env).filter(([name]) => !/^(SSE_.*|APPDATA|LOCALAPPDATA)$/i.test(name));
  return { ...Object.fromEntries(kept), ...hardened, APPDATA: base, LOCALAPPDATA: base };
}

/** Why the trial start's status is not the one a studio build writes, or null. */
export function trialProblem(status, { base, enginePath }) {
  if (status.exitCode !== 0 || status.finished !== true) {
    return `it did not start: ${status.error ?? JSON.stringify(status)}`;
  }
  if (typeof status.appDataPath !== "string" || !isSameOrInside(status.appDataPath, base)) {
    return `it opened ${status.appDataPath}, not its default folder under the scratch base`;
  }
  if (typeof status.startedEnginePath !== "string" || !samePath(status.startedEnginePath, enginePath)) {
    return `its shell started ${status.startedEnginePath}, not the engine beside it`;
  }
  return null;
}

function samePath(left, right) {
  return isSameOrInside(left, right) && isSameOrInside(right, left);
}

export async function trialStart(folder) {
  const scratch = mkdtempSync(path.join(os.tmpdir(), "sse-release-trial-"));
  const base = path.join(scratch, "app-data-base");
  mkdirSync(base);
  const statusPath = path.join(scratch, "status.json");
  const result = spawnSync(path.join(folder, SHELL_FILE), ["--smoke-test", `--smoke-status-path=${statusPath}`], {
    env: trialEnv(process.env, base, await hardenedLaneEnv()),
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  const status = existsSync(statusPath) ? JSON.parse(readFileSync(statusPath, "utf8")) : { exitCode: result.status };
  const problem = trialProblem(status, { base, enginePath: path.join(folder, ENGINE_FILE) });
  if (problem) {
    throw new Error(`The build in ${folder} is not a studio build that works: ${problem.replace(/\.$/, "")}.`);
  }
}

async function makeBuild() {
  const head = git(["rev-parse", "HEAD"]);
  const status = git(["status", "--porcelain"]);
  if (!head.ok || !status.ok) {
    throw new Error(`git did not answer: ${head.error || status.error}`);
  }
  // The newest origin/main, so that a commit merged a minute ago counts.
  const fetched = git(["fetch", "origin", "main", "--quiet"]);
  if (!fetched.ok) {
    say(`origin could not be reached (${fetched.error}); the commit is checked against the main fetched last.`);
  }
  const refusal = releaseRefusal({
    platform: process.platform,
    changedFiles: status.text === "" ? [] : status.text.split("\n").map((line) => line.slice(3)),
    onMain: git(["merge-base", "--is-ancestor", "HEAD", "origin/main"]).ok,
  });
  if (refusal) {
    throw new Error(refusal);
  }

  const builds = buildsRoot(process.env);
  const folder = path.join(builds, buildName(new Date(), head.text));
  if (existsSync(folder)) {
    throw new Error(`${folder} is there already: this commit was built today, and a build is never overwritten.`);
  }

  try {
    os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {
    // Not allowed here: build at the normal priority.
  }

  say(`Building ${head.text.slice(0, 7)} as a studio build.`);
  const tauri = path.join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
  run(process.execPath, [tauri, "build"], {
    cwd: path.join(root, "native", "tauri-shell"),
    env: { ...process.env, SSE_STUDIO_BUILD: "1" },
  });

  mkdirSync(folder, { recursive: true });
  for (const file of [SHELL_FILE, ENGINE_FILE]) {
    copyFileSync(path.join(root, "native", "target", "release", file), path.join(folder, file));
  }
  const record = writeBuildRecord(folder, {
    commit: head.text,
    committedAt: git(["show", "-s", "--format=%cI", "HEAD"]).text,
    version: JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version,
    savedDataSchema: schemaVersionOf(
      readFileSync(path.join(root, "native", "rust-engine", "src", "storage.rs"), "utf8")
    ),
  });

  say();
  say("The build's shell starts the engine beside it, on its default folder under a scratch base:");
  await trialStart(folder);
  say("  passed");
  // Each lane is started as a script of its own: importing one runs nothing.
  for (const [lane, script] of [
    ["The acceptance lane", "native-acceptance.mjs"],
    ["The bridge lane", "native-control-surface-qualification.mjs"],
  ]) {
    say();
    say(`${lane}, against the build's engine:`);
    run(process.execPath, [path.join(root, "scripts", script), `--engine=${path.join(folder, ENGINE_FILE)}`], {
      // The lanes print every line the engine answers.
      stdio: ["ignore", "ignore", "inherit"],
    });
    say("  passed");
  }

  say();
  say(`Studio build ${record.name}`);
  say(`  Folder   ${folder}`);
  say(`  Commit   ${record.commit}`);
  say(`  Schema   ${record.savedDataSchema ?? "not read"} (saved data)`);
  say();
  say("It is not the studio's build yet. To make it that:");
  say(`  1. Close the studio app and start ${path.join(folder, SHELL_FILE)}`);
  say("     Its first start upgrades the studio's saved data if its schema is newer, after a backup.");
  say("     An older build then refuses that data: going back means restoring the backup.");
  say("  2. Walk docs/CHECKLIST.md with it.");
  say(`  3. npm run release:verified -- ${record.name}`);
}

function markVerified(name) {
  if (!isBuildName(name)) {
    throw new Error(
      `Name the build: npm run release:verified -- <name>, where <name> is its folder in ${buildsRoot(process.env)}.`
    );
  }
  const builds = buildsRoot(process.env);
  const folder = path.join(builds, name);
  const record = readBuildRecord(folder);

  writeFileSync(path.join(builds, LAUNCHER_FILE), launcherText(name));
  appendFileSync(path.join(builds, VERIFIED_LOG_FILE), `${new Date().toISOString()}  ${name}  ${record.commit}\r\n`);

  // The commit the studio runs, in git: `git tag -l "verified/*"`.
  const tag = `verified/${name}`;
  const tagged = git(["tag", tag, record.commit]);
  const pushed = tagged.ok ? git(["push", "origin", tag]) : tagged;
  say(`The studio's build is now ${name}.`);
  say(`  Start it with ${path.join(builds, LAUNCHER_FILE)}`);
  say(
    pushed.ok
      ? `  Tagged ${tag}.`
      : `  The tag ${tag} was not made or not pushed (${pushed.error}); the launcher is written all the same.`
  );
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  try {
    if (command === undefined) {
      await makeBuild();
    } else if (command === "verified" && rest.length === 1) {
      markVerified(rest[0]);
    } else {
      throw new Error("`npm run release` makes a build; `npm run release:verified -- <name>` makes it the studio's.");
    }
  } catch (error) {
    process.stderr.write(`npm run release: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

// Runs only as `node scripts/release.mjs`: an import does nothing (the run
// builds, copies files into the builds folder and starts the build on scratch
// data). The two paths are compared as real paths — through a directory
// junction or a short 8.3 name, `process.argv[1]` and `import.meta.url` spell
// the same file differently, and a plain comparison would skip the run
// without a word (scripts/dev-check-cli.mjs).
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
  await main();
}
