import test from "node:test";
import assert from "node:assert/strict";

import { formatArtifactHashTable, formatReleaseNotes } from "./helpers.mjs";

const SAMPLE_ENTRIES = [
  {
    target: "macos",
    name: "SSE-ExEd-Studio-Control-Native-macOS-Installer.zip",
    sha256: "aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111",
  },
  {
    target: "macos",
    name: "SSE-ExEd-Studio-Control-Native-macOS-UpdateRepository.zip",
    sha256: "bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222",
  },
  {
    target: "windows",
    name: "SSE-ExEd-Studio-Control-Native-windows-Installer.exe",
    sha256: "cccc3333cccc3333cccc3333cccc3333cccc3333cccc3333cccc3333cccc3333",
  },
];

test("formatArtifactHashTable groups by target and renders fenced blocks", () => {
  const table = formatArtifactHashTable(SAMPLE_ENTRIES);
  assert.ok(table);
  assert.match(table, /### macos/);
  assert.match(table, /### windows/);
  assert.match(table, /aaaa1111[0-9a-f]+\s+SSE-ExEd-Studio-Control-Native-macOS-Installer\.zip/);
  assert.match(table, /cccc3333[0-9a-f]+\s+SSE-ExEd-Studio-Control-Native-windows-Installer\.exe/);
  // macOS section should appear before windows.
  assert.ok(table.indexOf("### macos") < table.indexOf("### windows"));
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
  assert.match(output, /aaaa1111[0-9a-f]+/);
  assert.match(output, /## Operator Guidance/);
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
