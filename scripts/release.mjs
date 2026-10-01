// `npm run release`: a studio build, made from `main` and kept outside the
// repository. `npm run release:verified -- <name>` makes a build the one the
// studio starts, once the owner has walked docs/CHECKLIST.md with it.
//
// A studio build is a folder that holds the shell, the engine and the
// pictures helper, release builds marked as the studio's (`SSE_STUDIO_BUILD`
// holds the commit while they compile: native/protocol/rust/src/
// development.rs), NDI's library (the SDK's own file, copied only when its
// hash is the pin's: native/pictures-link/ndi-library.json; never in git),
// and `build.json`, which names the commit and the hash of each file. The folders
// live in the builds folder beside the repository (`STUDIO_BUILDS_DIR` names
// another place), so nothing git or a build does can remove one. A build is
// never overwritten and never deleted here.
//
// Making a build:
//   1. the working tree is clean, the commit is on `origin/main`, and the
//      SDK's NDI library is the pinned file;
//   2. `tauri build` builds the pages, the engine, the pictures helper and
//      the shell; the tree and the commit are read again afterwards, and the
//      three programs must be newer than the build's start;
//   3. the three programs and NDI's library are copied into
//      `<builds>/<name>.unfinished-<time>/`, where <name> is
//      `<day>_<commit>`, and the library's copy is held to the pin again;
//   4. the copied shell starts the copied engine and reads a snapshot (the
//      shell's own `--smoke-test`), with the platform's app-data folder moved
//      to a scratch folder and no data folder named: the build opens its
//      default folder there as it will open the studio's, which a
//      development build refuses, so the start also proves the build is the
//      studio's kind, and the status it writes names the commit;
//   5. the acceptance lane and the bridge lane run against the copied engine,
//      on scratch data with simulated devices: every other test runs a
//      development build. With the simulated cameras the engine starts no
//      pictures helper and no library is loaded: the helper first runs on
//      the owner's walk;
//   6. `build.json` is written and the folder gets its name. A run that
//      failed leaves an `.unfinished` folder without a record, which
//      `release:verified` refuses.
//
// Nothing here opens the studio's saved data or sends to a device. The
// bridge lane's profile export reads Companion's own export at
// 127.0.0.1:8000 when Companion runs.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { hardenedLaneEnv, isSameOrInside } from "./native-runtime-harness.mjs";
import { ndiLibraryRefusal, readNdiPin, sdkLibraryPath } from "./ndi-library.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const SHELL_FILE = "sse-exed-tauri-shell.exe";
export const ENGINE_FILE = "studio-control-engine.exe";
/** The pictures helper, which the engine starts from its own folder (`HELPER_PROGRAM`). */
export const PICTURES_FILE = "studio-control-pictures.exe";
/** NDI's library, which the helper loads from its own folder (the pin's `file`). */
export const NDI_LIBRARY_FILE = "Processing.NDI.Lib.x64.dll";
/** What a build holds besides its record, each with its hash in it. */
export const BUILD_FILES = [SHELL_FILE, ENGINE_FILE, PICTURES_FILE, NDI_LIBRARY_FILE];
export const BUILD_RECORD_FILE = "build.json";
export const LAUNCHER_FILE = "Studio Control.cmd";
export const VERIFIED_LOG_FILE = "verified.txt";
const BUILD_NAME = /^\d{4}-\d{2}-\d{2}_[0-9a-f]{7}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const GIT_TIMEOUT_MS = 60_000;

/**
 * Where the studio builds are kept: beside the repository unless
 * `STUDIO_BUILDS_DIR` names a place. `repositoryRoot` is the main
 * repository's folder, a linked worktree's too.
 */
export function buildsRoot(env, repositoryRoot) {
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

/** The files `git status --porcelain` names, from its text as git wrote it. */
export function changedFilesOf(porcelain) {
  return porcelain
    .split(/\r?\n/)
    .filter((line) => line.length > 3)
    .map((line) => line.slice(3));
}

/** Why no build is made from this state of the repository, or null. */
export function releaseRefusal({ platform, changedFiles, onMain, markerInEnvironment }) {
  if (platform !== "win32") {
    return "A studio build is made on Windows, where the studio runs it.";
  }
  if (markerInEnvironment) {
    return "SSE_STUDIO_BUILD is set in this environment. Only this command sets it, for the one build it makes: set for the account or the terminal, it makes a studio build of every release build. Remove it.";
  }
  if (changedFiles.length > 0) {
    const named = changedFiles.slice(0, 3).join(", ");
    const more = changedFiles.length > 3 ? ` and ${changedFiles.length - 3} more` : "";
    return `The working tree has changes (${named}${more}). A studio build is made from a commit, so that build.json says what is in it.`;
  }
  if (!onMain) {
    return "This commit is not on origin/main. A studio build is made from a commit on main.";
  }
  return null;
}

/** The newest saved-data schema the engine's source names, or null. */
export function schemaVersionOf(storageSource) {
  const found = /\bconst STORAGE_SCHEMA_VERSION: \w+ = (\d+);/.exec(storageSource);
  return found ? Number(found[1]) : null;
}

/** `env` without the variables named by `pattern`, in any case (Windows reads names without regard to it). */
export function envWithout(env, pattern) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !pattern.test(name)));
}

/**
 * The environment the build compiles in: no cargo variable that moves its
 * output, and the marker, which holds the commit.
 */
export function buildEnv(env, commit) {
  if (!COMMIT.test(commit)) {
    throw new Error(`'${commit}' is not a commit's forty characters.`);
  }
  return {
    ...envWithout(env, /^(SSE_STUDIO_BUILD|CARGO_TARGET_DIR|CARGO_BUILD_TARGET|CARGO_BUILD_TARGET_DIR)$/i),
    SSE_STUDIO_BUILD: commit,
  };
}

/**
 * The environment of the build's trial start: `env` without any `SSE_`
 * variable, the lanes' hardening, and the platform's app-data folder moved to
 * `base`. No data folder is named, so the build opens its default folder
 * under `base`.
 */
export function trialEnv(env, base, hardened) {
  return { ...envWithout(env, /^(SSE_.*|APPDATA|LOCALAPPDATA)$/i), ...hardened, APPDATA: base, LOCALAPPDATA: base };
}

/** The environment of a lane: `env` without any `SSE_` variable. The lane hardens its own engines. */
export function laneEnv(env) {
  return envWithout(env, /^SSE_/i);
}

/** Why the trial start's status is not the one this studio build writes, or null. */
export function trialProblem(status, { base, enginePath, commit }) {
  if (status.exitCode !== 0 || status.finished !== true) {
    return `it did not start: ${status.error ?? JSON.stringify(status)}`;
  }
  if (typeof status.appDataPath !== "string" || !isSameOrInside(status.appDataPath, base)) {
    return `it opened ${status.appDataPath}, not its default folder under the scratch base`;
  }
  if (typeof status.startedEnginePath !== "string" || !samePath(status.startedEnginePath, enginePath)) {
    return `its shell started ${status.startedEnginePath}, not the engine beside it`;
  }
  if (status.studioBuild !== commit) {
    return `it says it was built from ${status.studioBuild ?? "no commit"}, not from ${commit}: the files are an older build's`;
  }
  return null;
}

function samePath(left, right) {
  return isSameOrInside(left, right) && isSameOrInside(right, left);
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** Writes the build's record: what it was made from, and the hash of each file. `name` is the folder's name to be. */
export function writeBuildRecord(folder, name, facts, now = new Date()) {
  const record = {
    name,
    ...facts,
    builtAt: now.toISOString(),
    files: Object.fromEntries(BUILD_FILES.map((file) => [file, sha256(path.join(folder, file))])),
  };
  writeFileSync(path.join(folder, BUILD_RECORD_FILE), `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
  return record;
}

/**
 * The build mark the program at `file` carries, as the engine reads it before it starts the
 * pictures helper (`build_marked_in`, native/protocol/rust/src/development.rs): the one
 * well-formed mark, `null` when it carries none, `"conflicting"` when its marks differ.
 */
export function buildMarkOf(file) {
  const marks = new Set(
    readFileSync(file)
      .toString("latin1")
      .match(/studio-control-build:v1:(?:D:-{40}|S:[0-9a-f]{40})/g) ?? []
  );
  return marks.size > 1 ? "conflicting" : ([...marks][0] ?? null);
}

/** The mark of a studio build of `commit`. */
export function studioMarkOf(commit) {
  return `studio-control-build:v1:S:${commit}`;
}

/** The build's record when the folder is the build it describes; throws with the reason when not. */
export function readBuildRecord(folder) {
  const recordPath = path.join(folder, BUILD_RECORD_FILE);
  if (!existsSync(recordPath)) {
    throw new Error(
      `${recordPath} is missing: that folder is not a build \`npm run release\` finished. A run that failed leaves a folder without a record.`
    );
  }
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  if (record.name !== path.basename(folder) || !COMMIT.test(record.commit ?? "")) {
    throw new Error(`${recordPath} does not describe the folder it is in.`);
  }
  const named = record.files && typeof record.files === "object" && !Array.isArray(record.files) ? record.files : {};
  for (const file of Object.keys(named)) {
    if (file !== path.win32.basename(file) || file !== path.posix.basename(file) || file === "." || file === "..") {
      throw new Error(`${recordPath} names ${JSON.stringify(file)}, which is not a file of the folder.`);
    }
  }
  // The pictures helper and NDI's library go together: a build holds both or neither.
  const [helper, library] = [PICTURES_FILE, NDI_LIBRARY_FILE].map(
    (file) => file in named || existsSync(path.join(folder, file))
  );
  if (helper !== library) {
    throw new Error(
      `${folder} holds ${helper ? "the pictures helper without NDI's library" : "NDI's library without the pictures helper"}: a build holds both or neither.`
    );
  }
  // The shell and the engine always, whatever else the record names; the pictures helper and
  // NDI's library whenever they are in the folder, so that nothing the build runs goes
  // unchecked; and every other file the record names. A build made before the helper (two
  // files) still verifies.
  const present = [PICTURES_FILE, NDI_LIBRARY_FILE].filter((file) => existsSync(path.join(folder, file)));
  for (const file of new Set([SHELL_FILE, ENGINE_FILE, ...present, ...Object.keys(named)])) {
    const filePath = path.join(folder, file);
    if (!existsSync(filePath)) {
      throw new Error(`${filePath} is missing.`);
    }
    if (typeof record.files?.[file] !== "string" || sha256(filePath) !== record.files[file]) {
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
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    // A question for a name or a password would wait for ever.
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (result.error) {
    return { ok: false, raw: "", text: "", error: result.error.message };
  }
  const raw = result.stdout ?? "";
  return { ok: result.status === 0, raw, text: raw.trim(), error: (result.stderr ?? "").trim() };
}

function say(line = "") {
  process.stdout.write(`${line}\n`);
}

/** The commit and the changed files, as they are now. */
function treeState() {
  const head = git(["rev-parse", "HEAD"]);
  const status = git(["status", "--porcelain"]);
  if (!head.ok || !status.ok) {
    throw new Error(`git did not answer: ${head.error || status.error}`);
  }
  return { commit: head.text, changedFiles: changedFilesOf(status.raw) };
}

/** The main repository's folder: a linked worktree's is its common folder's. */
function mainRepositoryRoot() {
  const common = git(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!common.ok) {
    throw new Error(`git did not answer: ${common.error}`);
  }
  return path.dirname(path.resolve(common.text));
}

export async function trialStart(folder, commit) {
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
  const problem = trialProblem(status, { base, enginePath: path.join(folder, ENGINE_FILE), commit });
  if (problem) {
    throw new Error(`The build in ${folder} is not a studio build that works: ${problem.replace(/\.$/, "")}.`);
  }
}

/** Runs a lane as a script of its own, against the build's engine; its lines go to a log. */
function runLane(script, folder, scratch) {
  const logPath = path.join(scratch, `${path.basename(script, ".mjs")}.log`);
  const log = openSync(logPath, "w");
  try {
    const result = spawnSync(
      process.execPath,
      [path.join(root, "scripts", script), `--engine=${path.join(folder, ENGINE_FILE)}`],
      { cwd: root, env: laneEnv(process.env), stdio: ["ignore", log, log] }
    );
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(`${script} ended with ${result.status ?? result.signal}. What it printed is in ${logPath}.`);
    }
  } finally {
    closeSync(log);
  }
}

async function makeBuild() {
  const before = treeState();
  // The newest origin/main, so that a commit merged a minute ago counts.
  const fetched = git(["fetch", "origin", "main", "--quiet"]);
  if (!fetched.ok) {
    say(`origin could not be reached (${fetched.error}); the commit is checked against the main fetched last.`);
  }
  const refusal = releaseRefusal({
    platform: process.platform,
    changedFiles: before.changedFiles,
    onMain: git(["merge-base", "--is-ancestor", "HEAD", "origin/main"]).ok,
    markerInEnvironment: Object.keys(process.env).some((name) => /^SSE_STUDIO_BUILD$/i.test(name)),
  });
  if (refusal) {
    throw new Error(refusal);
  }
  const behind = git(["rev-list", "--count", "HEAD..origin/main"]);
  if (behind.ok && behind.text !== "0") {
    say(`This commit is ${behind.text} behind origin/main: the build is of an older main.`);
  }

  const builds = buildsRoot(process.env, mainRepositoryRoot());
  const name = buildName(new Date(), before.commit);
  const folder = path.join(builds, name);
  if (existsSync(folder)) {
    throw new Error(`${folder} is there already: this commit was built today, and a build is never overwritten.`);
  }

  // NDI's library goes into the build only as the pinned file: held to the pin before the
  // build, and its copy again before the trial start.
  const pin = readNdiPin(root);
  if (pin.file !== NDI_LIBRARY_FILE) {
    throw new Error(`The pin names ${pin.file}, not ${NDI_LIBRARY_FILE}. Nothing was built.`);
  }
  const library = sdkLibraryPath(process.env, pin);
  const libraryRefused = ndiLibraryRefusal(library, pin);
  if (libraryRefused) {
    throw new Error(`${libraryRefused} Nothing was built.`);
  }

  try {
    os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {
    // Not allowed here: build at the normal priority.
  }

  say(`Building ${before.commit.slice(0, 7)} as a studio build.`);
  const buildStarted = Date.now();
  const tauri = path.join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
  run(process.execPath, [tauri, "build"], {
    cwd: path.join(root, "native", "tauri-shell"),
    env: buildEnv(process.env, before.commit),
  });

  // What was built is the commit only if nothing moved while it built.
  const after = treeState();
  if (after.commit !== before.commit || after.changedFiles.length > 0) {
    throw new Error(
      `The repository changed while the build ran (${after.commit.slice(0, 7)}, ${after.changedFiles.length} changed files): what was built is not ${before.commit.slice(0, 7)}. Nothing was copied.`
    );
  }
  const built = [SHELL_FILE, ENGINE_FILE, PICTURES_FILE].map((file) =>
    path.join(root, "native", "target", "release", file)
  );
  for (const file of built) {
    if (!existsSync(file) || statSync(file).mtimeMs < buildStarted) {
      throw new Error(`${file} is not from this build: cargo wrote its files elsewhere. Nothing was copied.`);
    }
  }

  mkdirSync(builds, { recursive: true });
  const unfinished = path.join(
    builds,
    `${name}.unfinished-${new Date().toISOString().slice(11, 19).replaceAll(":", "")}`
  );
  mkdirSync(unfinished);
  for (const file of built) {
    copyFileSync(file, path.join(unfinished, path.basename(file)), constants.COPYFILE_EXCL);
  }
  copyFileSync(library, path.join(unfinished, NDI_LIBRARY_FILE), constants.COPYFILE_EXCL);
  const copyRefused = ndiLibraryRefusal(path.join(unfinished, NDI_LIBRARY_FILE), pin);
  if (copyRefused) {
    throw new Error(`The copy of NDI's library is not the pinned file: ${copyRefused}`);
  }
  // The trial start and the lanes run with the simulated cameras and start no helper, so its
  // mark is read here: the engine starts only a helper of its own build and commit.
  const helperMark = buildMarkOf(path.join(unfinished, PICTURES_FILE));
  if (helperMark !== studioMarkOf(before.commit)) {
    throw new Error(
      `The pictures helper is not this commit's studio build (its mark: ${helperMark ?? "none"}), so the engine would not start it.`
    );
  }
  say();
  say(`Copied to ${unfinished}, with NDI's library ${pin.version}. It gets its name once it has passed.`);

  say();
  say("The build's shell starts the engine beside it, on its default folder under a scratch base:");
  await trialStart(unfinished, before.commit);
  say("  passed");

  const scratch = mkdtempSync(path.join(os.tmpdir(), "sse-release-lanes-"));
  for (const [lane, script] of [
    ["The acceptance lane", "native-acceptance.mjs"],
    ["The bridge lane", "native-control-surface-qualification.mjs"],
  ]) {
    say();
    say(`${lane}, against the build's engine:`);
    runLane(script, unfinished, scratch);
    say("  passed");
  }

  const record = writeBuildRecord(unfinished, name, {
    commit: before.commit,
    committedAt: git(["show", "-s", "--format=%cI", before.commit]).text,
    version: JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version,
    savedDataSchema: schemaVersionOf(
      readFileSync(path.join(root, "native", "rust-engine", "src", "storage.rs"), "utf8")
    ),
    ndiLibrary: pin.version,
  });
  // The record vouches for the library only as the pinned file, whatever ran meanwhile.
  if (record.files[NDI_LIBRARY_FILE] !== pin.sha256) {
    throw new Error(`NDI's library in ${unfinished} is no longer the pinned file. The build was not named.`);
  }
  // A folder of that name made meanwhile is not replaced: the rename fails.
  renameSync(unfinished, folder);

  say();
  say(`Studio build ${record.name}`);
  say(`  Folder   ${folder}`);
  say(`  Commit   ${record.commit}`);
  say(`  Schema   ${record.savedDataSchema ?? "not read"} (saved data)`);
  say(
    `  NDI      ${record.ndiLibrary} (the pinned SDK library; NDI asks that a release use an SDK no older than 30 days when a newer one is out)`
  );
  say();
  say("It is not the studio's build yet. To make it that:");
  say(`  1. Close the studio app and start ${path.join(folder, SHELL_FILE)}`);
  say("     Its first start upgrades the studio's saved data if its schema is newer, after a backup.");
  say("     An older build then refuses that data: going back means restoring the backup.");
  say("  2. Walk docs/CHECKLIST.md with it.");
  say(`  3. npm run release:verified -- ${record.name}`);
}

function markVerified(name) {
  const builds = buildsRoot(process.env, mainRepositoryRoot());
  if (!isBuildName(name)) {
    throw new Error(`Name the build: npm run release:verified -- <name>, where <name> is its folder in ${builds}.`);
  }
  const record = readBuildRecord(path.join(builds, name));

  writeFileSync(path.join(builds, LAUNCHER_FILE), launcherText(name));
  appendFileSync(path.join(builds, VERIFIED_LOG_FILE), `${new Date().toISOString()}  ${name}  ${record.commit}\r\n`);
  say(`The studio's build is now ${name}.`);
  say(`  Start it with ${path.join(builds, LAUNCHER_FILE)}`);

  // The commit the studio runs, in git: `git tag -l "verified/*"`. A tag a
  // run made and could not push is pushed by the next.
  const tag = `verified/${name}`;
  const tagged =
    git(["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`]).ok || git(["tag", tag, record.commit]).ok;
  const pushed = tagged ? git(["push", "origin", `refs/tags/${tag}`]) : { ok: false, error: "the tag was not made" };
  say(
    pushed.ok
      ? `  Tagged ${tag}.`
      : `  The tag ${tag} is not on origin (${pushed.error}). Run the command again when it can be reached.`
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
