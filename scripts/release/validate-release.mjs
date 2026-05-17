import {
  extractReleaseSection,
  isValidReleaseTag,
  readChangelog,
  readPackageJson,
  resolveReleaseTag,
} from "./helpers.mjs";
import fs from "fs";
import path from "path";

function readJsonAt(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), relativePath), "utf8"));
}

function readCargoPackageVersion(relativePath) {
  const contents = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
  let inPackageSection = false;
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "[package]") {
      inPackageSection = true;
      continue;
    }
    if (inPackageSection && trimmed.startsWith("[") && trimmed.endsWith("]")) {
      return null;
    }
    if (!inPackageSection) {
      continue;
    }
    const versionMatch = trimmed.match(/^version\s*=\s*"(?<version>[^"]+)"/);
    if (versionMatch?.groups?.version) {
      return versionMatch.groups.version;
    }
  }
  return null;
}

function productVersionSurfaces() {
  return [
    {
      label: "frontend/app/package.json",
      version: () => readJsonAt("frontend/app/package.json").version,
    },
    {
      label: "native/tauri-shell/tauri.conf.json",
      version: () => readJsonAt("native/tauri-shell/tauri.conf.json").version,
    },
    {
      label: "native/tauri-shell/Cargo.toml",
      version: () => readCargoPackageVersion("native/tauri-shell/Cargo.toml"),
    },
    {
      label: "native/rust-engine/Cargo.toml",
      version: () => readCargoPackageVersion("native/rust-engine/Cargo.toml"),
    },
  ];
}

const tag = resolveReleaseTag();

if (!isValidReleaseTag(tag)) {
  console.error(`Invalid release tag "${tag}". Expected format vX.Y.Z or vX.Y.Z-prerelease.`);
  process.exit(1);
}

const packageJson = readPackageJson();
const version = tag.slice(1);
const changelog = readChangelog();

if (packageJson.version !== version) {
  console.error(`package.json version mismatch: expected ${version}, found ${packageJson.version}.`);
  process.exit(1);
}

let releaseSection;

try {
  releaseSection = extractReleaseSection(changelog, version);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

if (releaseSection.latestReleasedVersion !== version) {
  console.error(
    `CHANGELOG.md latest released version is ${releaseSection.latestReleasedVersion ?? "missing"}, expected ${version}.`
  );
  process.exit(1);
}

const versionMismatches = [];

for (const surface of productVersionSurfaces()) {
  let surfaceVersion;
  try {
    surfaceVersion = surface.version();
  } catch (error) {
    versionMismatches.push(
      `${surface.label} version check failed: ${error instanceof Error ? error.message : String(error)}`
    );
    continue;
  }

  if (surfaceVersion !== version) {
    versionMismatches.push(`${surface.label} version mismatch: expected ${version}, found ${surfaceVersion}.`);
  }
}

if (versionMismatches.length > 0) {
  console.error(versionMismatches.join("\n"));
  process.exit(1);
}

console.log(`Release metadata validated for ${tag}`);
console.log(`- package.json version: ${packageJson.version}`);
console.log(`- changelog section: ${version}`);
console.log(`- changelog date: ${releaseSection.date ?? "not set"}`);
console.log(`- product version surfaces: ${productVersionSurfaces().length} checked`);
