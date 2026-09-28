import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  BUILD_RECORD_FILE,
  buildName,
  buildsRoot,
  ENGINE_FILE,
  isBuildName,
  launcherText,
  readBuildRecord,
  releaseRefusal,
  schemaVersionOf,
  SHELL_FILE,
  writeBuildRecord,
} from "./release.mjs";

const repositoryRoot = path.resolve("/work/studio/sse-exed-studio-control");

test("studio builds are kept beside the repository, never inside it", () => {
  assert.equal(buildsRoot({}, repositoryRoot), path.resolve("/work/studio/builds"));
  assert.equal(buildsRoot({ STUDIO_BUILDS_DIR: "  " }, repositoryRoot), path.resolve("/work/studio/builds"));
  const elsewhere = path.resolve("/somewhere/else");
  assert.equal(buildsRoot({ STUDIO_BUILDS_DIR: elsewhere }, repositoryRoot), elsewhere);

  // Inside the repository a `git clean` or a build's own cleaning removes it.
  for (const inside of [repositoryRoot, path.join(repositoryRoot, "release"), path.join(repositoryRoot, "a", "b")]) {
    assert.throws(() => buildsRoot({ STUDIO_BUILDS_DIR: inside }, repositoryRoot), /is inside the repository/, inside);
  }
});

test("a build is named by its day and its commit", () => {
  const name = buildName(new Date(2026, 8, 28, 23, 59), "d65b3a13c0ffee0123456789abcdef0123456789");
  assert.equal(name, "2026-09-28_d65b3a1");
  assert.equal(buildName(new Date(2027, 0, 5), "0123456789abcdef"), "2027-01-05_0123456");
  assert.ok(isBuildName(name));

  for (const other of [
    "",
    "windows",
    "2026-09-28",
    "2026-09-28_d65b3a",
    "2026-09-28_D65B3A1",
    "..\\2026-09-28_d65b3a1",
  ]) {
    assert.equal(isBuildName(other), false, other);
  }
  assert.equal(isBuildName(undefined), false);
});

test("the launcher starts the build named, from the folder it sits in", () => {
  const text = launcherText("2026-09-28_d65b3a1");
  assert.match(text, /^@echo off\r\n/);
  assert.ok(text.includes(`start "" "%~dp02026-09-28_d65b3a1\\${SHELL_FILE}"\r\n`), text);
  // Only a build's name goes into a command file.
  for (const other of ['x" & del /q *', "2026-09-28_d65b3a1\\..", ""]) {
    assert.throws(() => launcherText(other), /is not the name of a build/, other);
  }
});

test("a build is made on Windows, from a clean tree, from a commit on main", () => {
  const ready = { platform: "win32", changedFiles: [], onMain: true };
  assert.equal(releaseRefusal(ready), null);
  assert.match(releaseRefusal({ ...ready, platform: "linux" }), /made on Windows/);
  assert.match(releaseRefusal({ ...ready, onMain: false }), /not on origin\/main/);
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

test("a build's record describes its folder, and a changed file is found", () => {
  const builds = mkdtempSync(path.join(os.tmpdir(), "sse-release-test-"));
  try {
    const folder = path.join(builds, "2026-09-28_d65b3a1");
    mkdirSync(folder);
    writeFileSync(path.join(folder, SHELL_FILE), "the shell");
    writeFileSync(path.join(folder, ENGINE_FILE), "the engine");

    assert.throws(() => readBuildRecord(folder), /build\.json is missing/);
    const written = writeBuildRecord(
      folder,
      { commit: "d65b3a13", committedAt: "2026-09-28T01:34:00+02:00", version: "2.2.1", savedDataSchema: 10 },
      new Date("2026-09-28T02:00:00Z")
    );
    assert.equal(written.name, "2026-09-28_d65b3a1");
    assert.equal(written.builtAt, "2026-09-28T02:00:00.000Z");
    assert.deepEqual(Object.keys(written.files), [SHELL_FILE, ENGINE_FILE]);
    assert.match(written.files[ENGINE_FILE], /^[0-9a-f]{64}$/);
    assert.deepEqual(readBuildRecord(folder), written);
    assert.deepEqual(JSON.parse(readFileSync(path.join(folder, BUILD_RECORD_FILE), "utf8")), written);

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
