import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { resolveQtIfwTools } from "../qt-ifw-tools.mjs";
import { isValidReleaseTag, readPackageJson, resolveReleaseTag } from "./helpers.mjs";

// plan PR 3 / workstream C3.
//
// Writes `release/manifests/<tag>.json` — a single chain-of-custody file
// covering everything a future auditor would need to reproduce or contest
// a release: per-artifact SHA-256s, code-signing identity, notarization
// ticket (when available), QtIFW versions, build host fingerprint (no
// user/hostname), git SHA, build timestamps, and a pointer to the visual
// review evidence. Defensive — anything not present on this host is
// recorded as `null` rather than aborting the script.

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const SCHEMA_VERSION = 1;

/** Parsed `<sha256>  <filename>` line. */
function parseChecksumLine(line) {
  const match = line.match(/^([0-9a-fA-F]{64})\s+(\S.*)$/);
  if (!match) return null;
  return { sha256: match[1].toLowerCase(), name: match[2].trim() };
}

/** All artifact rows from `release/checksums/{macos,windows}/*.txt`. */
export function readChecksumEntries({ rootDir: rootDirOverride = rootDir } = {}) {
  const targets = ["macos", "windows"];
  const fileNames = {
    macos: "SSE-ExEd-Studio-Control-Native-macOS-SHA256.txt",
    windows: "SSE-ExEd-Studio-Control-Native-windows-SHA256.txt",
  };
  const entries = [];
  for (const target of targets) {
    const checksumPath = path.join(rootDirOverride, "release", "checksums", target, fileNames[target]);
    if (!existsSync(checksumPath)) continue;
    const lines = readFileSync(checksumPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const parsed = parseChecksumLine(line);
      if (!parsed) continue;
      entries.push({
        name: parsed.name,
        sha256: parsed.sha256,
        target,
        source: path.relative(rootDirOverride, checksumPath),
      });
    }
  }
  return entries;
}

/** Try to find the on-disk size of an artifact referenced from a checksum. */
function resolveArtifactSize(name, target, rootDirOverride) {
  const candidates = [
    path.join(rootDirOverride, "release", "native-installer", target, name),
    path.join(rootDirOverride, "release", "native-updates", target, name),
    path.join(rootDirOverride, "release", "native", target, name),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        return statSync(candidate).size;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function safeRun(command, args, { run = spawnSync } = {}) {
  const result = run(command, args, { encoding: "utf8" });
  if (result.error || (result.status ?? 1) !== 0) {
    return null;
  }
  return String(result.stdout ?? "").trim() || null;
}

/** Probe `binarycreator --version` / `repogen --version`. */
export function readQtIfwVersions({ rootDir: rootDirOverride = rootDir, run = spawnSync } = {}) {
  const tools = resolveQtIfwTools({ rootDir: rootDirOverride });
  const probe = (entry) => {
    if (!entry) return null;
    const version = safeRun(entry.value, ["--version"], { run });
    return { path: entry.value, source: entry.source, version: version ?? null };
  };
  return {
    binaryCreator: probe(tools.binaryCreator),
    repoGen: probe(tools.repoGen),
  };
}

/** macOS Developer ID identity, or null on other platforms / when missing. */
export function readMacosSigningIdentity({ platform = process.platform, run = spawnSync } = {}) {
  if (platform !== "darwin") return null;
  const result = run("security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8" });
  if (result.error || (result.status ?? 1) !== 0) return null;
  const stdout = String(result.stdout ?? "");
  const match = stdout.match(/^\s+\d+\)\s+([A-F0-9]{40})\s+"(.+)"\s*$/m);
  if (!match) return null;
  return { sha1: match[1], commonName: match[2] };
}

/** Build-host fingerprint. No username/hostname — only kernel/runtime versions. */
export function readHostFingerprint({ run = spawnSync } = {}) {
  return {
    platform: process.platform,
    arch: process.arch,
    kernel: `${os.type()} ${os.release()}`,
    node: process.version,
    rustc: safeRun("rustc", ["--version"], { run }),
  };
}

/** Find the visual review summary file if it exists. */
export function findVisualReviewSummary({ rootDir: rootDirOverride = rootDir } = {}) {
  const candidate = path.join(rootDirOverride, "artifacts", "visual", "tauri-cutover", "fixture-viewport-summary.json");
  return existsSync(candidate) ? path.relative(rootDirOverride, candidate) : null;
}

function gitSha({ rootDir: rootDirOverride = rootDir, run = spawnSync } = {}) {
  const result = run("git", ["rev-parse", "HEAD"], { cwd: rootDirOverride, encoding: "utf8" });
  if (result.error || (result.status ?? 1) !== 0) return null;
  return String(result.stdout ?? "").trim() || null;
}

/**
 * Compose the manifest object. Pure given its inputs — easy to test.
 */
export function buildManifest({
  tag,
  rootDir: rootDirOverride = rootDir,
  platform = process.platform,
  buildStartedAt = new Date().toISOString(),
  buildFinishedAt = new Date().toISOString(),
  notarizationTicketUuid = null,
  run = spawnSync,
} = {}) {
  if (!tag || !isValidReleaseTag(tag)) {
    throw new Error(`Release manifest writer: invalid tag '${tag}'. Expected vX.Y.Z or vX.Y.Z-prerelease.`);
  }

  const artifacts = readChecksumEntries({ rootDir: rootDirOverride }).map((entry) => ({
    ...entry,
    sizeBytes: resolveArtifactSize(entry.name, entry.target, rootDirOverride),
  }));

  return {
    schemaVersion: SCHEMA_VERSION,
    tag,
    gitSha: gitSha({ rootDir: rootDirOverride, run }),
    build: {
      startedAt: buildStartedAt,
      finishedAt: buildFinishedAt,
      host: readHostFingerprint({ run }),
    },
    artifacts,
    qtIfw: readQtIfwVersions({ rootDir: rootDirOverride, run }),
    signing: {
      macos: readMacosSigningIdentity({ platform, run }),
      windows: null,
    },
    notarization: {
      macos: { ticketUuid: notarizationTicketUuid },
    },
    visualReview: {
      summaryPath: findVisualReviewSummary({ rootDir: rootDirOverride }),
    },
  };
}

export function manifestPathFor(tag, { rootDir: rootDirOverride = rootDir } = {}) {
  return path.join(rootDirOverride, "release", "manifests", `${tag}.json`);
}

export function writeManifest({ tag, manifest, rootDir: rootDirOverride = rootDir } = {}) {
  const outputPath = manifestPathFor(tag, { rootDir: rootDirOverride });
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return outputPath;
}

function isMain() {
  return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

if (isMain()) {
  const args = process.argv.slice(2);
  const tag = resolveReleaseTag(args);
  if (!isValidReleaseTag(tag)) {
    console.error(`Invalid release tag '${tag}'. Expected vX.Y.Z or vX.Y.Z-prerelease.`);
    process.exit(1);
  }
  // Optional explicit timestamps + ticket UUID for callers that already
  // know them (publish-release.mjs passes them through).
  const startedAt = args.find((value) => value.startsWith("--started-at="))?.slice("--started-at=".length);
  const finishedAt = args.find((value) => value.startsWith("--finished-at="))?.slice("--finished-at=".length);
  const ticketUuid = args.find((value) => value.startsWith("--notary-ticket="))?.slice("--notary-ticket=".length);

  const manifest = buildManifest({
    tag,
    buildStartedAt: startedAt ?? new Date().toISOString(),
    buildFinishedAt: finishedAt ?? new Date().toISOString(),
    notarizationTicketUuid: ticketUuid ?? null,
  });
  const written = writeManifest({ tag, manifest });
  console.log(`Wrote release manifest: ${written}`);
}

// Re-export package json reader so tests can stub the tag default if they need.
export { readPackageJson };
