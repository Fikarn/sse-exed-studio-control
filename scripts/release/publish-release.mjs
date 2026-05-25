import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  extractReleaseSection,
  formatReleaseNotes,
  isValidReleaseTag,
  readChangelog,
  readPackageJson,
  resolveReleaseTag,
  resolveRepositoryHttpUrl,
} from "./helpers.mjs";
import { buildManifest, manifestPathFor, readChecksumEntries, writeManifest } from "./write-release-manifest.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
process.chdir(rootDir);

const REQUIRED_ASSETS = [
  path.join("release", "native-installer", "macos", "SSE-ExEd-Studio-Control-Native-macOS-Installer.zip"),
  path.join("release", "native-installer", "windows", "SSE-ExEd-Studio-Control-Native-windows-Installer.exe"),
  path.join("release", "native-updates", "macos", "SSE-ExEd-Studio-Control-Native-macOS-UpdateRepository.zip"),
  path.join("release", "native-updates", "windows", "SSE-ExEd-Studio-Control-Native-windows-UpdateRepository.zip"),
  path.join("release", "checksums", "macos", "SSE-ExEd-Studio-Control-Native-macOS-SHA256.txt"),
  path.join("release", "checksums", "windows", "SSE-ExEd-Studio-Control-Native-windows-SHA256.txt"),
];

const OPTIONAL_ASSETS = [
  path.join("release", "native", "macos", "SSE-ExEd-Studio-Control-Native-macOS.zip"),
  path.join("release", "native", "windows", "SSE-ExEd-Studio-Control-Native-windows.zip"),
];

function hasFlag(name) {
  return process.argv.slice(2).includes(name);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function resolveRepoSlug(packageJson) {
  const repoUrl = resolveRepositoryHttpUrl(packageJson);
  assert(repoUrl, "Could not resolve the GitHub repository URL from package.json.");

  const match = repoUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/#]+?)(?:#.*)?$/);
  assert(match, `Unsupported repository URL '${repoUrl}'. Expected an https://github.com/<owner>/<repo> URL.`);

  return `${match[1]}/${match[2]}`;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  const exitCode = result.status ?? 1;
  if (!options.allowFailure && exitCode !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${exitCode}.`);
  }

  return {
    exitCode,
    stderr: result.stderr ?? "",
    stdout: result.stdout ?? "",
  };
}

function resolveReleaseNotes(tag, packageJson) {
  const version = tag.slice(1);
  const releaseSection = extractReleaseSection(readChangelog(), version);
  return formatReleaseNotes({
    body: releaseSection.body,
    repoUrl: resolveRepositoryHttpUrl(packageJson),
    // C4: ship authoritative hashes in the GitHub Release body itself,
    // not just in the sidecar SHA256 files.
    artifactHashes: readChecksumEntries({ rootDir }),
  });
}

function resolveAssets() {
  const required = REQUIRED_ASSETS.map((relativePath) => path.join(rootDir, relativePath));
  const optional = OPTIONAL_ASSETS.map((relativePath) => path.join(rootDir, relativePath)).filter((assetPath) =>
    existsSync(assetPath)
  );

  for (const assetPath of required) {
    assert(existsSync(assetPath), `Required release asset is missing: ${assetPath}`);
  }

  return [...required, ...optional];
}

const args = process.argv.slice(2);
const tag = resolveReleaseTag(args);
const dryRun = hasFlag("--dry-run");
const clobber = hasFlag("--clobber");
const draft = hasFlag("--draft");
const packageJson = readPackageJson();

assert(isValidReleaseTag(tag), `Invalid release tag '${tag}'. Expected vX.Y.Z or vX.Y.Z-prerelease.`);

const repoSlug = resolveRepoSlug(packageJson);
const notes = resolveReleaseNotes(tag, packageJson);
const assets = resolveAssets();

// plan PR 3 / workstream C3 — write the chain-of-custody manifest before
// the gh release upload so it ships as a release asset alongside the
// installers + checksums.
const manifestPath = manifestPathFor(tag, { rootDir });
const manifest = buildManifest({
  tag,
  rootDir,
  buildStartedAt: process.env.SSE_RELEASE_BUILD_STARTED_AT ?? new Date().toISOString(),
  buildFinishedAt: new Date().toISOString(),
  notarizationTicketUuid: process.env.SSE_MACOS_NOTARY_TICKET_UUID ?? null,
});
writeManifest({ tag, manifest, rootDir });
console.log(`Wrote release manifest: ${manifestPath}`);
assets.push(manifestPath);

const notesDir = mkdtempSync(path.join(os.tmpdir(), "sse-release-notes-"));
const notesPath = path.join(notesDir, `${tag}.md`);
const prerelease = tag.includes("-");

writeFileSync(notesPath, notes, "utf8");

console.log(`Release tag: ${tag}`);
console.log(`Repository: ${repoSlug}`);
console.log(`Release notes: ${notesPath}`);
console.log("Assets:");
for (const asset of assets) {
  console.log(`- ${asset}`);
}

if (dryRun) {
  console.log("Dry run complete. No GitHub release was created or modified.");
  process.exit(0);
}

run("gh", ["--version"], { capture: true });

const releaseView = run("gh", ["release", "view", tag, "--repo", repoSlug], {
  allowFailure: true,
  capture: true,
});

if (releaseView.exitCode === 0) {
  console.log(`Updating existing GitHub release ${tag}.`);
  run("gh", ["release", "edit", tag, "--repo", repoSlug, "--title", tag, "--notes-file", notesPath]);
  run("gh", ["release", "upload", tag, "--repo", repoSlug, ...(clobber ? ["--clobber"] : []), ...assets]);
} else {
  console.log(`Creating GitHub release ${tag}.`);
  run("gh", [
    "release",
    "create",
    tag,
    "--repo",
    repoSlug,
    "--verify-tag",
    "--title",
    tag,
    "--notes-file",
    notesPath,
    ...(draft ? ["--draft"] : []),
    ...(prerelease ? ["--prerelease"] : []),
    ...assets,
  ]);
}

console.log(`Published ${tag} to GitHub Releases.`);
