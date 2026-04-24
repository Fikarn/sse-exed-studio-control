import { createHash } from "node:crypto";
import { createReadStream, existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { nativeReleaseShellExecutableName, resolveNativeReleaseRuntime } from "./native-release-runtime.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseIdentity = JSON.parse(readFileSync(path.join(rootDir, "scripts", "native-release-identity.json"), "utf8"));
const releaseRuntime = resolveNativeReleaseRuntime(rootDir);

function readFlag(name) {
  const prefix = `${name}=`;
  const entry = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : null;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function fileText(targetPath) {
  return readFileSync(targetPath, "utf8");
}

function expectIncludes(text, expected, label) {
  assert(text.includes(expected), `${label} is missing '${expected}'.`);
}

function assertExists(targetPath, label) {
  assert(existsSync(targetPath), `${label} not found at ${targetPath}.`);
}

function assertNonEmptyFile(targetPath, label) {
  assertExists(targetPath, label);
  assert(statSync(targetPath).size > 0, `${label} is empty at ${targetPath}.`);
}

function assertDirectoryHasEntries(targetPath, label) {
  assertExists(targetPath, label);
  const entries = readdirSync(targetPath).filter((entry) => entry !== ".DS_Store");
  assert(entries.length > 0, `${label} is empty at ${targetPath}.`);
}

function checksumManifestPath(target) {
  const fileName =
    target === "macos"
      ? "SSE-ExEd-Studio-Control-Native-macOS-SHA256.txt"
      : "SSE-ExEd-Studio-Control-Native-windows-SHA256.txt";
  return path.join(rootDir, "release", "checksums", target, fileName);
}

function checksumArtifactPaths(target, mode) {
  const artifacts = [
    target === "macos"
      ? path.join(rootDir, "release", "native", target, "SSE-ExEd-Studio-Control-Native-macOS.zip")
      : path.join(rootDir, "release", "native", target, "SSE-ExEd-Studio-Control-Native-windows.zip"),
  ];

  if (mode === "full") {
    artifacts.push(
      target === "macos"
        ? path.join(
            rootDir,
            "release",
            "native-installer",
            target,
            "SSE-ExEd-Studio-Control-Native-macOS-Installer.zip"
          )
        : path.join(
            rootDir,
            "release",
            "native-installer",
            target,
            "SSE-ExEd-Studio-Control-Native-windows-Installer.exe"
          ),
      target === "macos"
        ? path.join(
            rootDir,
            "release",
            "native-updates",
            target,
            "SSE-ExEd-Studio-Control-Native-macOS-UpdateRepository.zip"
          )
        : path.join(
            rootDir,
            "release",
            "native-updates",
            target,
            "SSE-ExEd-Studio-Control-Native-windows-UpdateRepository.zip"
          )
    );
  }

  return artifacts;
}

function sha256File(targetPath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(targetPath);

    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function normalizeRelativePath(targetPath) {
  return targetPath.split(path.sep).join("/");
}

async function collectPayloadEntries(rootPath) {
  const entries = new Map();

  async function visit(currentPath, relativePath) {
    const stats = lstatSync(currentPath);

    if (stats.isSymbolicLink()) {
      entries.set(relativePath, {
        type: "symlink",
        target: readlinkSync(currentPath),
      });
      return;
    }

    if (stats.isDirectory()) {
      if (relativePath) {
        entries.set(`${relativePath}/`, {
          type: "directory",
        });
      }

      for (const entry of readdirSync(currentPath)
        .filter((value) => value !== ".DS_Store")
        .sort()) {
        const childPath = path.join(currentPath, entry);
        const childRelativePath = relativePath
          ? normalizeRelativePath(path.join(relativePath, entry))
          : normalizeRelativePath(entry);
        await visit(childPath, childRelativePath);
      }
      return;
    }

    if (stats.isFile()) {
      entries.set(relativePath, {
        type: "file",
        digest: await sha256File(currentPath),
      });
      return;
    }

    entries.set(relativePath, {
      type: "other",
    });
  }

  await visit(rootPath, "");
  return entries;
}

async function verifyPayloadParity(expectedPath, actualPath, expectedLabel, actualLabel) {
  const expectedEntries = await collectPayloadEntries(expectedPath);
  const actualEntries = await collectPayloadEntries(actualPath);

  assert(
    actualEntries.size === expectedEntries.size,
    `${actualLabel} contains ${actualEntries.size} entries, expected ${expectedEntries.size} from ${expectedLabel}.`
  );

  for (const [relativePath, expectedEntry] of expectedEntries.entries()) {
    assert(actualEntries.has(relativePath), `${actualLabel} is missing '${relativePath}' from ${expectedLabel}.`);

    const actualEntry = actualEntries.get(relativePath);
    assert(
      actualEntry.type === expectedEntry.type,
      `${actualLabel} recorded '${relativePath}' as ${actualEntry.type}, expected ${expectedEntry.type}.`
    );

    if (expectedEntry.type === "file") {
      assert(
        actualEntry.digest === expectedEntry.digest,
        `${actualLabel} recorded ${actualEntry.digest} for '${relativePath}', expected ${expectedEntry.digest}.`
      );
    }

    if (expectedEntry.type === "symlink") {
      assert(
        actualEntry.target === expectedEntry.target,
        `${actualLabel} recorded symlink '${relativePath}' -> '${actualEntry.target}', expected '${expectedEntry.target}'.`
      );
    }
  }
}

function parseChecksumManifest(targetPath) {
  const lines = fileText(targetPath)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const entries = new Map();

  for (const line of lines) {
    const match = line.match(/^([0-9a-f]{64})\s+(.+)$/i);
    assert(match, `${targetPath} contains an invalid checksum line: '${line}'.`);
    const fileName = match[2];
    assert(!entries.has(fileName), `${targetPath} contains duplicate checksum entries for '${fileName}'.`);
    entries.set(fileName, match[1].toLowerCase());
  }

  return entries;
}

function packagedPayloadPath(target) {
  return path.join(rootDir, "release", "native", target, releaseIdentity.payloadNames[target]);
}

function installerPayloadPath(target) {
  return path.join(
    rootDir,
    "release",
    "native-installer",
    target,
    "ifw",
    "packages",
    releaseIdentity.packageId,
    "data",
    releaseIdentity.payloadNames[target]
  );
}

function updatePayloadPath(target) {
  return path.join(
    rootDir,
    "release",
    "native-updates",
    target,
    "ifw",
    "packages",
    releaseIdentity.packageId,
    "data",
    releaseIdentity.payloadNames[target]
  );
}

async function verifyChecksumManifest(target, mode) {
  const manifestPath = checksumManifestPath(target);
  assertNonEmptyFile(manifestPath, `Checksum manifest (${target})`);

  const expectedArtifacts = checksumArtifactPaths(target, mode);
  const manifestEntries = parseChecksumManifest(manifestPath);
  assert(
    manifestEntries.size === expectedArtifacts.length,
    `${manifestPath} should contain ${expectedArtifacts.length} checksum entries, found ${manifestEntries.size}.`
  );

  for (const artifactPath of expectedArtifacts) {
    const fileName = path.basename(artifactPath);
    assertNonEmptyFile(artifactPath, `Checksummed artifact (${target})`);
    assert(manifestEntries.has(fileName), `${manifestPath} is missing checksum for '${fileName}'.`);
    const expectedDigest = await sha256File(artifactPath);
    const manifestDigest = manifestEntries.get(fileName);
    assert(
      manifestDigest === expectedDigest,
      `${manifestPath} recorded ${manifestDigest} for '${fileName}', expected ${expectedDigest}.`
    );
  }
}

async function verifyPayloadParityForRelease(target) {
  const packagedPath = packagedPayloadPath(target);
  const installerPath = installerPayloadPath(target);
  const updatePath = updatePayloadPath(target);

  await verifyPayloadParity(
    packagedPath,
    installerPath,
    `Packaged payload (${target})`,
    `Installer staged payload (${target})`
  );
  await verifyPayloadParity(
    packagedPath,
    updatePath,
    `Packaged payload (${target})`,
    `Update staged payload (${target})`
  );
}

function parseTarget(value) {
  if (value === "macos" || value === "windows") {
    return value;
  }

  throw new Error(`Unsupported target '${value}'. Use --target=macos or --target=windows.`);
}

function parseMode(value) {
  if (value === "staged" || value === "full") {
    return value;
  }

  throw new Error(`Unsupported mode '${value}'. Use --mode=staged or --mode=full.`);
}

function verifyCommonMetadata({ packageJson, configXmlPath, packageXmlPath, expectedTargetDir, description }) {
  const configXml = fileText(configXmlPath);
  expectIncludes(configXml, `<Name>${releaseIdentity.displayName}</Name>`, configXmlPath);
  expectIncludes(configXml, `<Version>${packageJson.version}</Version>`, configXmlPath);
  expectIncludes(configXml, `<TargetDir>${expectedTargetDir}</TargetDir>`, configXmlPath);

  const packageXml = fileText(packageXmlPath);
  expectIncludes(packageXml, `<DisplayName>${releaseIdentity.displayName}</DisplayName>`, packageXmlPath);
  expectIncludes(packageXml, `<Description>${description}</Description>`, packageXmlPath);
  expectIncludes(packageXml, `<Version>${packageJson.version}</Version>`, packageXmlPath);
  expectIncludes(packageXml, `<Name>${releaseIdentity.packageId}</Name>`, packageXmlPath);
}

function verifyInstallerArtifacts(target, packageJson, mode) {
  const installerRoot = path.join(rootDir, "release", "native-installer", target);
  const configXmlPath = path.join(installerRoot, "ifw", "config", "config.xml");
  const packageXmlPath = path.join(installerRoot, "ifw", "packages", releaseIdentity.packageId, "meta", "package.xml");
  const payloadDir = installerPayloadPath(target);
  const shellName = nativeReleaseShellExecutableName(target, releaseRuntime);
  const shellPath =
    target === "macos" ? path.join(payloadDir, "Contents", "MacOS", shellName) : path.join(payloadDir, shellName);
  const enginePath =
    target === "macos"
      ? path.join(payloadDir, "Contents", "MacOS", "studio-control-engine")
      : path.join(payloadDir, "studio-control-engine.exe");

  verifyCommonMetadata({
    packageJson,
    configXmlPath,
    packageXmlPath,
    expectedTargetDir: releaseIdentity.targetDir,
    description: releaseIdentity.installerDescription,
  });

  assertExists(payloadDir, `Installer staged payload (${target})`);
  assertExists(shellPath, `Installer staged shell executable (${target})`);
  assertExists(enginePath, `Installer staged engine executable (${target})`);

  if (mode === "full") {
    const finalArtifactPath =
      target === "macos"
        ? path.join(installerRoot, "SSE-ExEd-Studio-Control-Native-macOS-Installer.app")
        : path.join(installerRoot, "SSE-ExEd-Studio-Control-Native-windows-Installer.exe");
    const archivePath =
      target === "macos" ? path.join(installerRoot, "SSE-ExEd-Studio-Control-Native-macOS-Installer.zip") : null;

    assertExists(finalArtifactPath, `Installer artifact (${target})`);
    if (archivePath) {
      assertNonEmptyFile(archivePath, `Installer archive (${target})`);
    }
  }
}

function verifyUpdateArtifacts(target, packageJson, mode) {
  const updateRoot = path.join(rootDir, "release", "native-updates", target);
  const packageXmlPath = path.join(updateRoot, "ifw", "packages", releaseIdentity.packageId, "meta", "package.xml");
  const payloadDir = updatePayloadPath(target);
  const shellName = nativeReleaseShellExecutableName(target, releaseRuntime);
  const shellPath =
    target === "macos" ? path.join(payloadDir, "Contents", "MacOS", shellName) : path.join(payloadDir, shellName);
  const enginePath =
    target === "macos"
      ? path.join(payloadDir, "Contents", "MacOS", "studio-control-engine")
      : path.join(payloadDir, "studio-control-engine.exe");

  const packageXml = fileText(packageXmlPath);
  expectIncludes(packageXml, `<DisplayName>${releaseIdentity.displayName}</DisplayName>`, packageXmlPath);
  expectIncludes(packageXml, `<Description>${releaseIdentity.updateDescription}</Description>`, packageXmlPath);
  expectIncludes(packageXml, `<Version>${packageJson.version}</Version>`, packageXmlPath);
  expectIncludes(packageXml, `<Name>${releaseIdentity.packageId}</Name>`, packageXmlPath);

  assertExists(payloadDir, `Update staged payload (${target})`);
  assertExists(shellPath, `Update staged shell executable (${target})`);
  assertExists(enginePath, `Update staged engine executable (${target})`);

  if (mode === "full") {
    const repositoryPath = path.join(updateRoot, "repository");
    const archivePath =
      target === "macos"
        ? path.join(updateRoot, "SSE-ExEd-Studio-Control-Native-macOS-UpdateRepository.zip")
        : path.join(updateRoot, "SSE-ExEd-Studio-Control-Native-windows-UpdateRepository.zip");

    assertDirectoryHasEntries(repositoryPath, `Update repository (${target})`);
    assertNonEmptyFile(archivePath, `Update repository archive (${target})`);
  }
}

function verifyPackagedArtifacts(target, mode) {
  const packagedRoot = path.join(rootDir, "release", "native", target);
  const payloadPath = packagedPayloadPath(target);
  const shellName = nativeReleaseShellExecutableName(target, releaseRuntime);
  const shellPath =
    target === "macos" ? path.join(payloadPath, "Contents", "MacOS", shellName) : path.join(payloadPath, shellName);
  const enginePath =
    target === "macos"
      ? path.join(payloadPath, "Contents", "MacOS", "studio-control-engine")
      : path.join(payloadPath, "studio-control-engine.exe");
  const archivePath =
    target === "macos"
      ? path.join(packagedRoot, "SSE-ExEd-Studio-Control-Native-macOS.zip")
      : path.join(packagedRoot, "SSE-ExEd-Studio-Control-Native-windows.zip");

  assertExists(payloadPath, `Packaged payload (${target})`);
  assertExists(shellPath, `Packaged shell executable (${target})`);
  assertExists(enginePath, `Packaged engine executable (${target})`);

  if (mode === "full") {
    assertNonEmptyFile(archivePath, `Packaged archive (${target})`);
  }
}

const target = parseTarget(readFlag("--target"));
const mode = parseMode(readFlag("--mode") ?? "full");
const packageJson = JSON.parse(fileText(path.join(rootDir, "package.json")));

verifyPackagedArtifacts(target, mode);
verifyInstallerArtifacts(target, packageJson, mode);
verifyUpdateArtifacts(target, packageJson, mode);
await verifyChecksumManifest(target, mode);
await verifyPayloadParityForRelease(target);

console.log(`Verified native release artifacts for ${target} (${mode}).`);
