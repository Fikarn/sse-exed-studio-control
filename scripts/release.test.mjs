import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { hardenedLaneEnv } from "./native-runtime-harness.mjs";
import {
  BUILD_RECORD_FILE,
  buildEnv,
  buildName,
  buildsRoot,
  changedFilesOf,
  ENGINE_FILE,
  isBuildName,
  laneEnv,
  launcherText,
  readBuildRecord,
  releaseRefusal,
  schemaVersionOf,
  SHELL_FILE,
  trialEnv,
  trialProblem,
  writeBuildRecord,
} from "./release.mjs";

const repositoryRoot = path.resolve("/work/studio/sse-exed-studio-control");
const COMMIT = "55efa2990123456789abcdef0123456789abcdef";

test("studio builds are kept beside the repository, never inside it", () => {
  assert.equal(buildsRoot({}, repositoryRoot), path.resolve("/work/studio/builds"));
  assert.equal(buildsRoot({ STUDIO_BUILDS_DIR: "  " }, repositoryRoot), path.resolve("/work/studio/builds"));
  const elsewhere = path.resolve("/somewhere/else");
  assert.equal(buildsRoot({ STUDIO_BUILDS_DIR: elsewhere }, repositoryRoot), elsewhere);

  // Inside the repository a `git clean` or a build's own cleaning removes it.
  // A linked worktree sits inside the main repository, which is the root
  // given here, so the folder beside a worktree is refused too.
  for (const inside of [
    repositoryRoot,
    path.join(repositoryRoot, "release"),
    path.join(repositoryRoot, ".claude", "worktrees", "builds"),
  ]) {
    assert.throws(() => buildsRoot({ STUDIO_BUILDS_DIR: inside }, repositoryRoot), /is inside the repository/, inside);
  }
});

test("a build is named by its day and its commit", () => {
  const name = buildName(new Date(2026, 8, 28, 23, 59), COMMIT);
  assert.equal(name, "2026-09-28_55efa29");
  assert.equal(buildName(new Date(2027, 0, 5), "0123456789abcdef"), "2027-01-05_0123456");
  assert.ok(isBuildName(name));

  for (const other of [
    "",
    "windows",
    "2026-09-28",
    "2026-09-28_55efa2",
    "2026-09-28_55EFA29",
    "..\\2026-09-28_55efa29",
    "2026-09-28_55efa29.unfinished-031500",
  ]) {
    assert.equal(isBuildName(other), false, other);
  }
  assert.equal(isBuildName(undefined), false);
});

test("the launcher starts the build named, from the folder it sits in", () => {
  const text = launcherText("2026-09-28_55efa29");
  assert.match(text, /^@echo off\r\n/);
  assert.ok(text.includes(`start "" "%~dp02026-09-28_55efa29\\${SHELL_FILE}"\r\n`), text);
  // Only a build's name goes into a command file.
  for (const other of ['x" & del /q *', "2026-09-28_55efa29\\..", ""]) {
    assert.throws(() => launcherText(other), /is not the name of a build/, other);
  }
});

test("git's status is read as git wrote it", () => {
  assert.deepEqual(changedFilesOf(""), []);
  assert.deepEqual(changedFilesOf(" M scripts/release.mjs\n?? new file.txt\nA  staged.rs\r\n"), [
    "scripts/release.mjs",
    "new file.txt",
    "staged.rs",
  ]);
});

test("a build is made on Windows, from a clean tree, from a commit on main", () => {
  const ready = { platform: "win32", changedFiles: [], onMain: true, markerInEnvironment: false };
  assert.equal(releaseRefusal(ready), null);
  assert.match(releaseRefusal({ ...ready, platform: "linux" }), /made on Windows/);
  assert.match(releaseRefusal({ ...ready, onMain: false }), /not on origin\/main/);
  assert.match(releaseRefusal({ ...ready, markerInEnvironment: true }), /SSE_STUDIO_BUILD is set/);
  const changed = releaseRefusal({ ...ready, changedFiles: ["a.rs", "b.ts", "c.md", "d.json", "e.css"] });
  assert.match(changed, /a\.rs, b\.ts, c\.md and 2 more/);
  assert.match(releaseRefusal({ ...ready, changedFiles: ["a.rs"] }), /\(a\.rs\)/);
});

test("the saved data's schema is read from the engine's source", () => {
  assert.equal(schemaVersionOf("pub(crate) const STORAGE_SCHEMA_VERSION: i64 = 10;\n"), 10);
  assert.equal(schemaVersionOf("pub const STORAGE_SCHEMA_VERSION: i64 = 7;"), 7);
  assert.equal(schemaVersionOf("const OTHER: i64 = 3;"), null);
  const source = readFileSync(new URL("../native/rust-engine/src/storage.rs", import.meta.url), "utf8");
  assert.ok(Number.isInteger(schemaVersionOf(source)), "the engine's own source names its schema");
});

test("the build compiles with the commit as its marker, where cargo writes by default", () => {
  const env = buildEnv(
    {
      PATH: "/bin",
      sse_studio_build: "1",
      CARGO_TARGET_DIR: "D:/elsewhere",
      Cargo_Build_Target: "x86_64-pc-windows-gnu",
      CARGO_HOME: "C:/cargo",
    },
    COMMIT
  );
  assert.deepEqual(env, { PATH: "/bin", CARGO_HOME: "C:/cargo", SSE_STUDIO_BUILD: COMMIT });
  for (const other of ["1", "55efa29", COMMIT.toUpperCase(), `${COMMIT}0`]) {
    assert.throws(() => buildEnv({}, other), /is not a commit's forty characters/, other);
  }
});

test("the trial start names no data folder and moves the platform's base", async () => {
  const base = path.resolve("/scratch/app-data-base");
  const hardened = await hardenedLaneEnv();
  const env = trialEnv(
    {
      PATH: "/bin",
      APPDATA: "C:/Users/operator/AppData/Roaming",
      LocalAppData: "C:/Users/operator/AppData/Local",
      SSE_APP_DATA_DIR: "C:/somewhere",
      sse_log_dir: "C:/somewhere/logs",
      SSE_SAFE_START: "0",
      SSE_STUDIO_BUILD: "1",
    },
    base,
    hardened
  );
  assert.deepEqual(env, { PATH: "/bin", ...hardened, APPDATA: base, LOCALAPPDATA: base });
  // The lanes' own hardening names no folder either.
  assert.deepEqual(
    Object.keys(env).filter((name) => /^SSE_(APP_DATA|LOG)_DIR$/i.test(name)),
    []
  );
  assert.equal(env.SSE_SAFE_START, "1");
  assert.equal(env.SSE_LIGHTS_SIMULATED, "1");
});

test("a lane starts with no variable of the app's left in its environment", () => {
  assert.deepEqual(
    laneEnv({
      PATH: "/bin",
      SSE_NATIVE_ACCEPTANCE_LIVE_CONSOLE: "1",
      SSE_COMPANION_URL: "http://elsewhere",
      sse_control_surface_token: "x",
      SSE_APP_DATA_DIR: "C:/somewhere",
      SSEX: "kept",
    }),
    { PATH: "/bin", SSEX: "kept" }
  );
});

test("the trial start is read: the default folder, the engine beside the shell, the commit", () => {
  const base = path.resolve("/scratch/app-data-base");
  const enginePath = path.resolve("/builds/2026-09-28_55efa29", ENGINE_FILE);
  const expected = { base, enginePath, commit: COMMIT };
  const good = {
    finished: true,
    exitCode: 0,
    appDataPath: path.join(base, "ExEd Studio Control Native"),
    startedEnginePath: enginePath,
    studioBuild: COMMIT,
  };
  assert.equal(trialProblem(good, expected), null);

  // A development build refuses its default folder: the shell's sentence.
  assert.match(
    trialProblem({ finished: true, exitCode: 1, error: "This is a development build" }, expected),
    /did not start: This is a development build/
  );
  assert.match(trialProblem({ exitCode: 1 }, expected), /did not start/);
  assert.match(
    trialProblem({ ...good, appDataPath: path.resolve("/elsewhere/ExEd Studio Control Native") }, expected),
    /not its default folder under the scratch base/
  );
  assert.match(
    trialProblem({ ...good, startedEnginePath: path.resolve("/repo/native/target/debug", ENGINE_FILE) }, expected),
    /not the engine beside it/
  );
  assert.match(
    trialProblem({ ...good, startedEnginePath: path.dirname(enginePath) }, expected),
    /not the engine beside it/
  );
  // Files an older build left where cargo writes name their own commit.
  assert.match(
    trialProblem({ ...good, studioBuild: "0123456789abcdef0123456789abcdef01234567" }, expected),
    /built from 0123456789abcdef0123456789abcdef01234567, not from 55efa299/
  );
  assert.match(trialProblem({ ...good, studioBuild: null }, expected), /built from no commit/);
});

test("a build's record describes its folder, and a changed file is found", () => {
  const builds = mkdtempSync(path.join(os.tmpdir(), "sse-release-test-"));
  try {
    const name = "2026-09-28_55efa29";
    const folder = path.join(builds, name);
    mkdirSync(folder);
    writeFileSync(path.join(folder, SHELL_FILE), "the shell");
    writeFileSync(path.join(folder, ENGINE_FILE), "the engine");

    // A run that failed leaves the two files and no record.
    assert.throws(() => readBuildRecord(folder), /build\.json is missing/);
    const written = writeBuildRecord(
      folder,
      name,
      { commit: COMMIT, committedAt: "2026-09-28T01:34:00+02:00", version: "2.2.1", savedDataSchema: 10 },
      new Date("2026-09-28T02:00:00Z")
    );
    assert.equal(written.name, name);
    assert.equal(written.builtAt, "2026-09-28T02:00:00.000Z");
    assert.deepEqual(Object.keys(written.files), [SHELL_FILE, ENGINE_FILE]);
    assert.match(written.files[ENGINE_FILE], /^[0-9a-f]{64}$/);
    assert.deepEqual(readBuildRecord(folder), written);
    assert.deepEqual(JSON.parse(readFileSync(path.join(folder, BUILD_RECORD_FILE), "utf8")), written);
    // A record is written once.
    assert.throws(() => writeBuildRecord(folder, name, { commit: COMMIT }), /EEXIST/);

    // A record that names other files does not vouch for the two the launcher starts.
    const recordPath = path.join(folder, BUILD_RECORD_FILE);
    writeFileSync(recordPath, JSON.stringify({ ...written, files: { "other.exe": written.files[SHELL_FILE] } }));
    assert.throws(() => readBuildRecord(folder), /sse-exed-tauri-shell\.exe is not the file build\.json describes/);
    writeFileSync(recordPath, JSON.stringify({ ...written, commit: "55efa29" }));
    assert.throws(() => readBuildRecord(folder), /does not describe the folder it is in/);
    writeFileSync(recordPath, JSON.stringify(written));

    writeFileSync(path.join(folder, ENGINE_FILE), "another engine");
    assert.throws(() => readBuildRecord(folder), /studio-control-engine\.exe is not the file build\.json describes/);
    rmSync(path.join(folder, ENGINE_FILE));
    assert.throws(() => readBuildRecord(folder), /studio-control-engine\.exe is missing/);

    // A record copied into another folder does not describe it.
    const copy = path.join(builds, "2026-09-29_0000000");
    mkdirSync(copy);
    writeFileSync(path.join(copy, BUILD_RECORD_FILE), JSON.stringify(written));
    assert.throws(() => readBuildRecord(copy), /does not describe the folder it is in/);
  } finally {
    rmSync(builds, { force: true, recursive: true });
  }
});
