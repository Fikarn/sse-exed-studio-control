import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  extractReleaseSection,
  formatReleaseNotes,
  isValidReleaseTag,
  readChangelog,
  readPackageJson,
  resolveRepositoryHttpUrl,
  resolveOutputPath,
  resolveReleaseTag,
  writeOutputFile,
} from "./helpers.mjs";
import { readChecksumEntries } from "./write-release-manifest.mjs";

function main() {
  const args = process.argv.slice(2);
  const tag = resolveReleaseTag(args);
  const outputPath = resolveOutputPath(args);

  if (!isValidReleaseTag(tag)) {
    console.error(`Invalid release tag "${tag}". Expected format vX.Y.Z or vX.Y.Z-prerelease.`);
    process.exit(1);
  }

  const version = tag.slice(1);
  const changelog = readChangelog();
  const packageJson = readPackageJson();

  let releaseSection;

  try {
    releaseSection = extractReleaseSection(changelog, version);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  // plan PR 3 / workstream C4: embed authoritative artifact hashes in the
  // release notes body when the Windows SHA-256 manifest exists on disk.
  // Empty array → table is omitted gracefully.
  const artifactHashes = readChecksumEntries();

  const output = formatReleaseNotes({
    body: releaseSection.body,
    repoUrl: resolveRepositoryHttpUrl(packageJson),
    artifactHashes,
  });

  if (outputPath) {
    writeOutputFile(outputPath, output);
    console.log(`Wrote release notes for ${tag} to ${outputPath}`);
    process.exit(0);
  }

  process.stdout.write(output);
}

// Runs only as `node scripts/release/write-release-notes.mjs …`: an import does
// nothing (2026-09-26; the run writes the release notes to a file or to stdout
// and ends the process). The two paths are compared as real paths — through a
// directory junction or a short 8.3 name, `process.argv[1]` and
// `import.meta.url` spell the same file differently, and a plain comparison
// would skip the run without a word (scripts/dev-check-cli.mjs).
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
  main();
}
