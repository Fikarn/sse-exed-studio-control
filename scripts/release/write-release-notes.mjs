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
// release notes body when the per-platform SHA-256 manifests exist on
// disk. Empty array → table is omitted gracefully.
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
