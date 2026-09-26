import test from "node:test";
import assert from "node:assert/strict";

import { formatArtifactHashTable, formatReleaseNotes } from "./helpers.mjs";

const SAMPLE_ENTRIES = [
  {
    target: "windows",
    name: "SSE-ExEd-Studio-Control-Native-windows-Installer.exe",
    sha256: "cccc3333cccc3333cccc3333cccc3333cccc3333cccc3333cccc3333cccc3333",
  },
  {
    target: "windows",
    name: "SSE-ExEd-Studio-Control-Native-windows-UpdateRepository.zip",
    sha256: "dddd4444dddd4444dddd4444dddd4444dddd4444dddd4444dddd4444dddd4444",
  },
];

test("formatArtifactHashTable renders the Windows entries in one fenced block", () => {
  const table = formatArtifactHashTable(SAMPLE_ENTRIES);
  assert.ok(table);
  assert.match(table, /### windows/);
  assert.match(table, /cccc3333[0-9a-f]+\s+SSE-ExEd-Studio-Control-Native-windows-Installer\.exe/);
  assert.match(table, /dddd4444[0-9a-f]+\s+SSE-ExEd-Studio-Control-Native-windows-UpdateRepository\.zip/);
  assert.equal(table.split("```").length, 3, "one fenced block");
});

test("formatArtifactHashTable returns null for empty or missing input", () => {
  assert.equal(formatArtifactHashTable([]), null);
  assert.equal(formatArtifactHashTable(null), null);
  assert.equal(formatArtifactHashTable(undefined), null);
});

test("formatReleaseNotes embeds the artifact hash table when entries are present", () => {
  const output = formatReleaseNotes({
    body: "- Initial release.",
    repoUrl: "https://github.com/example/repo",
    artifactHashes: SAMPLE_ENTRIES,
  });
  assert.match(output, /## Artifact verification/);
  assert.match(output, /cccc3333[0-9a-f]+/);
  assert.match(output, /## Operator Guidance/);
  // New pages program, Slice SW (D22): Windows is the only platform.
  assert.doesNotMatch(output, /macOS/);
  // Verification block must appear above operator guidance.
  assert.ok(output.indexOf("## Artifact verification") < output.indexOf("## Operator Guidance"));
});

test("formatReleaseNotes omits the artifact-verification section when no hashes are supplied", () => {
  const output = formatReleaseNotes({
    body: "- Initial release.",
    repoUrl: "https://github.com/example/repo",
  });
  assert.doesNotMatch(output, /## Artifact verification/);
});
