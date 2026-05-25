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

  throw new Error(`Unsupported installer target '${value}'. Use --target=macos or --target=windows.`);
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

function archiveMacInstaller(sourceAppPath, archivePath) {
  run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", sourceAppPath, archivePath]);
}

function resolvePackagedPayload(target) {
  if (target === "macos") {
    return {
      packagedPath: path.join(rootDir, "release", "native", "macos", "SSE ExEd Studio Control Native.app"),
      installerPath: path.join(
        rootDir,
        "release",
        "native-installer",
        "macos",
        "SSE-ExEd-Studio-Control-Native-macOS-Installer.app"
      ),
      archivePath: path.join(
        rootDir,
        "release",
        "native-installer",
        "macos",
        "SSE-ExEd-Studio-Control-Native-macOS-Installer.zip"
      ),
    };
  }

  return {
    packagedPath: path.join(rootDir, "release", "native", "windows", "SSE ExEd Studio Control Native"),
    installerPath: path.join(
      rootDir,
      "release",
      "native-installer",
      "windows",
      "SSE-ExEd-Studio-Control-Native-windows-Installer.exe"
    ),
    archivePath: null,
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

function renderConfigXml({ version, targetDir }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Installer>
  <Name>${releaseIdentity.displayName}</Name>
  <Version>${version}</Version>
  <Title>${releaseIdentity.installerTitle}</Title>
  <Publisher>${releaseIdentity.publisher}</Publisher>
  <ProductUrl>${releaseIdentity.productUrl}</ProductUrl>
  <StartMenuDir>${releaseIdentity.startMenuDir}</StartMenuDir>
  <TargetDir>${targetDir}</TargetDir>
</Installer>
`;
}

function renderPackageXml({ version, releaseDate }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Package>
  <DisplayName>${releaseIdentity.displayName}</DisplayName>
  <Description>${releaseIdentity.installerDescription}</Description>
  <Version>${version}</Version>
  <ReleaseDate>${releaseDate}</ReleaseDate>
  <Name>${releaseIdentity.packageId}</Name>
  <Default>true</Default>
  <ForcedInstallation>true</ForcedInstallation>
  <Essential>true</Essential>
  <Script>installscript.qs</Script>
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
  // produces a staged build root without an installer binary; that's only
  // ever useful in the staged-verification lane and must be opted into.
  throw new Error(
    "native-installer.mjs --prepare-only produces a staged (incomplete) installer payload. Pass --allow-staged to confirm you want staged output, or drop --prepare-only to build the full installer (requires QtIFW binarycreator)."
  );
}

const packageJson = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8"));
const releaseDate = new Date().toISOString().slice(0, 10);
const { packagedPath, installerPath, archivePath } = resolvePackagedPayload(target);

ensurePackagedPayload(target, packagedPath);

const installerRoot = path.join(rootDir, "release", "native-installer", target);
const buildRoot = path.join(installerRoot, "ifw");
const configDir = path.join(buildRoot, "config");
const packageRoot = path.join(buildRoot, "packages", releaseIdentity.packageId);
const metaDir = path.join(packageRoot, "meta");
const dataDir = path.join(packageRoot, "data");

rmSync(buildRoot, { force: true, recursive: true });
mkdirSync(configDir, { recursive: true });
mkdirSync(metaDir, { recursive: true });
mkdirSync(dataDir, { recursive: true });

writeFileSync(
  path.join(configDir, "config.xml"),
  renderConfigXml({ version: packageJson.version, targetDir: releaseIdentity.targetDir }),
  "utf8"
);
writeFileSync(
  path.join(metaDir, "package.xml"),
  renderPackageXml({ version: packageJson.version, releaseDate }),
  "utf8"
);
copyFileSync(path.join(rootDir, "LICENSE"), path.join(metaDir, "LICENSE.txt"));
copyFileSync(
  path.join(rootDir, "native", "installer-templates", "tauri-installscript.qs"),
  path.join(metaDir, "installscript.qs")
);

const stagedPayloadPath = path.join(dataDir, releaseIdentity.payloadNames[target]);
cpSync(packagedPath, stagedPayloadPath, { recursive: true, verbatimSymlinks: true });

console.log(`Prepared native installer staging for ${target}: ${buildRoot}`);
console.log(`Staged payload: ${stagedPayloadPath}`);

if (prepareOnly) {
  console.log("Skipping binarycreator build because --prepare-only was requested.");
  process.exit(0);
}

const binaryCreator = resolveQtIfwTools({ rootDir }).binaryCreator;
if (!binaryCreator) {
  throw new Error(
    "Qt Installer Framework binarycreator was not found. Set SSE_QT_IFW_BINARYCREATOR, put binarycreator on PATH, or install QtIFW into .tools/qt-ifw."
  );
}

console.log(`Using QtIFW binarycreator via ${binaryCreator.source}: ${binaryCreator.value}`);
mkdirSync(path.dirname(installerPath), { recursive: true });
rmSync(installerPath, { force: true, recursive: true });
if (archivePath) {
  rmSync(archivePath, { force: true, recursive: true });
}
run(binaryCreator.value, [
  "--offline-only",
  "-c",
  path.join(configDir, "config.xml"),
  "-p",
  path.join(buildRoot, "packages"),
  installerPath,
]);

if (archivePath) {
  archiveMacInstaller(installerPath, archivePath);
  console.log(`Built native installer artifact: ${installerPath}`);
  console.log(`Archived native installer artifact: ${archivePath}`);
} else {
  console.log(`Built native installer artifact: ${installerPath}`);
}
