import { existsSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseIdentity = JSON.parse(readFileSync(path.join(rootDir, "scripts", "native-release-identity.json"), "utf8"));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

function archiveApp(sourceAppPath, archivePath) {
  rmSync(archivePath, { force: true, recursive: true });
  run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", sourceAppPath, archivePath]);
}

function signApp(appPath, signingIdentity) {
  run("codesign", ["--force", "--deep", "--options", "runtime", "--timestamp", "--sign", signingIdentity, appPath]);
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
}

function resolveNotaryCredentials() {
  if (process.env.SSE_MACOS_NOTARY_KEYCHAIN_PROFILE) {
    return ["--keychain-profile", process.env.SSE_MACOS_NOTARY_KEYCHAIN_PROFILE];
  }

  if (
    process.env.SSE_MACOS_NOTARY_APPLE_ID &&
    process.env.SSE_MACOS_NOTARY_PASSWORD &&
    process.env.SSE_MACOS_NOTARY_TEAM_ID
  ) {
    return [
      "--apple-id",
      process.env.SSE_MACOS_NOTARY_APPLE_ID,
      "--password",
      process.env.SSE_MACOS_NOTARY_PASSWORD,
      "--team-id",
      process.env.SSE_MACOS_NOTARY_TEAM_ID,
    ];
  }

  return null;
}

function notarizeArchive(artifactLabel, archivePath, appPath, notaryCredentials) {
  assert(existsSync(archivePath), `${artifactLabel} archive not found at ${archivePath}.`);
  run("xcrun", ["notarytool", "submit", archivePath, "--wait", ...notaryCredentials]);
  run("xcrun", ["stapler", "staple", appPath]);
  run("xcrun", ["stapler", "validate", appPath]);
}

// `--bundle-only` signs (and, with credentials, notarizes) the packaged app and
// stops: the release-evidence workflow runs where QtIFW is not installed, so
// there is no installer app there (production readiness 2026-09, Slice 12).
// Without the flag nothing changes.
const bundleOnly = process.argv.slice(2).includes("--bundle-only");

const signingIdentity = process.env.SSE_MACOS_CODESIGN_IDENTITY?.trim();
if (!signingIdentity) {
  console.log("Skipping native macOS signing because SSE_MACOS_CODESIGN_IDENTITY is not configured.");
  process.exit(0);
}

assert(process.platform === "darwin", "native-sign-macos.mjs can only run on macOS.");

const packagedAppPath = path.join(rootDir, "release", "native", "macos", releaseIdentity.payloadNames.macos);
const packagedArchivePath = path.join(
  rootDir,
  "release",
  "native",
  "macos",
  "SSE-ExEd-Studio-Control-Native-macOS.zip"
);
const installerAppPath = path.join(
  rootDir,
  "release",
  "native-installer",
  "macos",
  "SSE-ExEd-Studio-Control-Native-macOS-Installer.app"
);
const installerArchivePath = path.join(
  rootDir,
  "release",
  "native-installer",
  "macos",
  "SSE-ExEd-Studio-Control-Native-macOS-Installer.zip"
);

const artifacts = [
  {
    label: "packaged app",
    appPath: packagedAppPath,
    archivePath: packagedArchivePath,
  },
  ...(bundleOnly
    ? []
    : [
        {
          label: "installer app",
          appPath: installerAppPath,
          archivePath: installerArchivePath,
        },
      ]),
];

for (const artifact of artifacts) {
  assert(existsSync(artifact.appPath), `${artifact.label} not found at ${artifact.appPath}.`);
  console.log(`Signing ${artifact.label}: ${artifact.appPath}`);
  signApp(artifact.appPath, signingIdentity);
  archiveApp(artifact.appPath, artifact.archivePath);
}

const notaryCredentials = resolveNotaryCredentials();
if (!notaryCredentials) {
  console.log(
    "Skipping macOS notarization because SSE_MACOS_NOTARY_KEYCHAIN_PROFILE or Apple ID credentials are not configured."
  );
  process.exit(0);
}

for (const artifact of artifacts) {
  console.log(`Notarizing ${artifact.label}: ${artifact.archivePath}`);
  notarizeArchive(artifact.label, artifact.archivePath, artifact.appPath, notaryCredentials);
  archiveApp(artifact.appPath, artifact.archivePath);
}

console.log("Native macOS signing and notarization completed.");
