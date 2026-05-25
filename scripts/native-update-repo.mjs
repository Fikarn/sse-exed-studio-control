import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveQtIfwTools } from "./qt-ifw-tools.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseIdentity = JSON.parse(readFileSync(path.join(rootDir, "scripts", "native-release-identity.json"), "utf8"));

function readFlag(name) {
  const prefix = `${name}=`;
  const entry = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : null;
}

function hasFlag(name) {
  return process.argv.slice(2).includes(name);
}

function parseTarget(value) {
  if (value === "macos") {
    return "macos";
  }

  if (value === "windows") {
    return "windows";
  }

  throw new Error(`Unsupported update repository target '${value}'. Use --target=macos or --target=windows.`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

function archiveMacPath(sourcePath, archivePath) {
  run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", sourcePath, archivePath]);
}

function archiveWindowsPath(sourcePath, archivePath) {
  run("powershell", [
    "-NoProfile",
    "-Command",
    `Compress-Archive -Path @('${sourcePath.replaceAll("'", "''")}') -DestinationPath '${archivePath.replaceAll(
      "'",
      "''"
    )}' -Force`,
  ]);
}

function resolvePackagedPayload(target) {
  if (target === "macos") {
    return {
      packagedPath: path.join(rootDir, "release", "native", "macos", "SSE ExEd Studio Control Native.app"),
      repositoryPath: path.join(rootDir, "release", "native-updates", "macos", "repository"),
      archivePath: path.join(
        rootDir,
        "release",
        "native-updates",
        "macos",
        "SSE-ExEd-Studio-Control-Native-macOS-UpdateRepository.zip"
      ),
    };
  }

  return {
    packagedPath: path.join(rootDir, "release", "native", "windows", "SSE ExEd Studio Control Native"),
    repositoryPath: path.join(rootDir, "release", "native-updates", "windows", "repository"),
    archivePath: path.join(
      rootDir,
      "release",
      "native-updates",
      "windows",
      "SSE-ExEd-Studio-Control-Native-windows-UpdateRepository.zip"
    ),
  };
}

function ensurePackagedPayload(target, packagedPath) {
  if (existsSync(packagedPath)) {
    return;
  }

  if (target === "macos" && process.platform === "darwin") {
    run(process.execPath, [path.join(rootDir, "scripts", "native-package.mjs"), "--target=macos"]);
    return;
  }

  if (target === "windows" && process.platform === "win32") {
    run(process.execPath, [path.join(rootDir, "scripts", "native-package.mjs"), "--target=windows"]);
    return;
  }

  throw new Error(
    `Packaged native payload not found at ${packagedPath}. Build the platform-native package on a matching host first.`
  );
}

function renderPackageXml({ version, releaseDate }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Package>
  <DisplayName>${releaseIdentity.displayName}</DisplayName>
  <Description>${releaseIdentity.updateDescription}</Description>
  <Version>${version}</Version>
  <ReleaseDate>${releaseDate}</ReleaseDate>
  <Name>${releaseIdentity.packageId}</Name>
  <Default>true</Default>
  <ForcedInstallation>true</ForcedInstallation>
  <Essential>true</Essential>
  <Licenses>
    <License name="MIT" file="LICENSE.txt"/>
  </Licenses>
</Package>
`;
}

const target = parseTarget(readFlag("--target"));
const prepareOnly = hasFlag("--prepare-only");
const allowStaged = hasFlag("--allow-staged");

if (prepareOnly && !allowStaged) {
  // plan PR 3 / workstream C2: stop silent staged fallbacks. `--prepare-only`
  // produces a staged build root without a built update repository; that's
  // only ever useful in the staged-verification lane and must be opted into.
  throw new Error(
    "native-update-repo.mjs --prepare-only produces a staged (incomplete) update repository payload. Pass --allow-staged to confirm you want staged output, or drop --prepare-only to build the full repository (requires QtIFW repogen)."
  );
}

const packageJson = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8"));
const releaseDate = new Date().toISOString().slice(0, 10);
const { packagedPath, repositoryPath, archivePath } = resolvePackagedPayload(target);

ensurePackagedPayload(target, packagedPath);

const updateRoot = path.join(rootDir, "release", "native-updates", target);
const buildRoot = path.join(updateRoot, "ifw");
const packageRoot = path.join(buildRoot, "packages", releaseIdentity.packageId);
const metaDir = path.join(packageRoot, "meta");
const dataDir = path.join(packageRoot, "data");

rmSync(buildRoot, { force: true, recursive: true });
mkdirSync(metaDir, { recursive: true });
mkdirSync(dataDir, { recursive: true });

writeFileSync(
  path.join(metaDir, "package.xml"),
  renderPackageXml({ version: packageJson.version, releaseDate }),
  "utf8"
);
copyFileSync(path.join(rootDir, "LICENSE"), path.join(metaDir, "LICENSE.txt"));

const stagedPayloadPath = path.join(dataDir, releaseIdentity.payloadNames[target]);
cpSync(packagedPath, stagedPayloadPath, { recursive: true, verbatimSymlinks: true });

console.log(`Prepared native update repository staging for ${target}: ${buildRoot}`);
console.log(`Staged payload: ${stagedPayloadPath}`);

if (prepareOnly) {
  console.log("Skipping repogen build because --prepare-only was requested.");
  process.exit(0);
}

const repoGen = resolveQtIfwTools({ rootDir }).repoGen;
if (!repoGen) {
  throw new Error(
    "Qt Installer Framework repogen was not found. Set SSE_QT_IFW_REPOGEN, put repogen on PATH, or install QtIFW into .tools/qt-ifw."
  );
}

console.log(`Using QtIFW repogen via ${repoGen.source}: ${repoGen.value}`);
rmSync(repositoryPath, { force: true, recursive: true });
mkdirSync(path.dirname(repositoryPath), { recursive: true });
rmSync(archivePath, { force: true, recursive: true });

run(repoGen.value, ["-p", path.join(buildRoot, "packages"), repositoryPath]);

if (target === "macos") {
  archiveMacPath(repositoryPath, archivePath);
} else {
  archiveWindowsPath(repositoryPath, archivePath);
}

console.log(`Built native update repository: ${repositoryPath}`);
console.log(`Archived native update repository: ${archivePath}`);
