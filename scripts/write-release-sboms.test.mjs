import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { TARGETS, parseTarget, sbomPlan, sbomProblem } from "./write-release-sboms.mjs";

// Production readiness 2026-09, Slice 12 (finding F17) — what the SBOM step
// refuses. Running the two generators is the release-evidence workflow's part
// (and needs them installed); what is pinned here is the plan and the rule
// that an SBOM which is empty, or is of something else, is never evidence.

const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "write-release-sboms.mjs");

const bom = (overrides = {}) => ({
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  metadata: { component: { type: "application", name: "studio-control-engine", version: "2.2.1" } },
  components: [
    { name: "serde", version: "1.0.228" },
    { name: "rusqlite", version: "0.40.1" },
  ],
  ...overrides,
});
const engine = { component: "studio-control-engine", version: "2.2.1", mustList: "rusqlite" };

test("a target names its triple and three SBOMs, one per thing inside the bundle", () => {
  assert.equal(TARGETS.windows.triple, "x86_64-pc-windows-msvc");

  const plan = sbomPlan("/repo", "windows", "2.2.1");
  assert.deepEqual(
    plan.map((item) => [item.part, path.basename(item.path), item.component, item.mustList]),
    [
      ["frontend", "SSE-ExEd-Studio-Control-Native-windows-frontend.cdx.json", "sse-exed-studio-control", "react"],
      ["engine", "SSE-ExEd-Studio-Control-Native-windows-engine.cdx.json", "studio-control-engine", "rusqlite"],
      ["shell", "SSE-ExEd-Studio-Control-Native-windows-shell.cdx.json", "sse-exed-tauri-shell", "tauri"],
    ]
  );
  // Beside the checksum manifests, never inside the packaged bundle's folder.
  for (const item of plan) {
    assert.equal(path.dirname(item.path), path.join("/repo", "release", "sbom", "windows"));
    assert.equal(item.version, "2.2.1");
  }
});

test("an SBOM is accepted only for the right component, version and contents", () => {
  assert.equal(sbomProblem(bom(), engine), null);
  // Nested components count: cyclonedx-npm nests a package's own dependencies.
  assert.equal(sbomProblem(bom({ components: [{ name: "serde", components: [{ name: "rusqlite" }] }] }), engine), null);

  assert.match(sbomProblem(bom({ components: [] }), engine), /lists 0 component\(s\) and 'rusqlite' is not among them/);
  assert.match(sbomProblem(bom({ components: undefined }), engine), /lists 0 component/);
  assert.match(sbomProblem(bom({ components: [{ name: "serde" }] }), engine), /'rusqlite' is not among them/);
  assert.match(
    sbomProblem(bom(), { ...engine, version: "2.3.0" }),
    /describes studio-control-engine@2\.2\.1, expected studio-control-engine@2\.3\.0/
  );
  assert.match(
    sbomProblem(bom(), { ...engine, component: "sse-exed-tauri-shell", mustList: "tauri" }),
    /expected sse-exed-tauri-shell@/
  );
  assert.match(sbomProblem(bom({ metadata: {} }), engine), /describes undefined@undefined/);
  assert.match(sbomProblem(bom({ specVersion: "1.3" }), engine), /CycloneDX 1\.3, expected 1\.5/);
  for (const notABom of [null, {}, { bomFormat: "SPDX" }, []]) {
    assert.equal(sbomProblem(notABom, engine), "not a CycloneDX document");
  }
});

test("an unknown target is refused before anything is written", () => {
  assert.equal(parseTarget("windows"), "windows");
  for (const bad of ["macos", "linux", "", undefined, "constructor", "__proto__"]) {
    assert.throws(() => parseTarget(bad), /Unsupported target/, String(bad));
  }
  const result = spawnSync(process.execPath, [scriptPath, "--target=linux"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unsupported target 'linux'/);
  assert.equal(spawnSync(process.execPath, [scriptPath], { encoding: "utf8" }).status, 1);
});
