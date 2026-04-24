import { createHash } from "node:crypto";
import { createReadStream, existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseIdentity = JSON.parse(readFileSync(path.join(rootDir, "scripts", "native-release-identity.json"), "utf8"));
const packageJson = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8"));
const args = process.argv.slice(2);

function readFlag(name) {
  const prefix = `${name}=`;
  const entry = args.find((value) => value.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : null;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseTarget(value) {
  if (value === "macos" || value === "windows") {
    return value;
  }

  throw new Error(`Unsupported Tauri candidate artifact target '${value}'. Use --target=macos or --target=windows.`);
}

function parseMode(value) {
  if (value === "staged" || value === "full") {
    return value;
  }

  throw new Error(`Unsupported Tauri candidate artifact mode '${value}'. Use --mode=staged or --mode=full.`);
}

function assertExists(targetPath, label) {
  assert(existsSync(targetPath), `${label} not found at ${targetPath}.`);
}

function assertNonEmptyFile(targetPath, label) {
  assertExists(targetPath, label);
  assert(statSync(targetPath).size > 0, `${label} is empty at ${targetPath}.`);
}

function fileText(targetPath) {
  return readFileSync(targetPath, "utf8");
}

function expectIncludes(text, expected, label) {
  assert(text.includes(expected), `${label} is missing '${expected}'.`);
}

function normalizeRelativePath(targetPath) {
  return targetPath.split(path.sep).join("/");
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

async function collectPayloadEntries(rootPath) {
  const entries = new Map();

  async function visit(currentPath, relativePath) {
    const stats = lstatSync(currentPath);

    if (stats.isSymbolicLink()) {
      entries.set(relativePath, {
        target: readlinkSync(currentPath),
        type: "symlink",
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
        await visit(
          path.join(currentPath, entry),
          relativePath ? normalizeRelativePath(path.join(relativePath, entry)) : normalizeRelativePath(entry)
        );
      }
      return;
    }

    if (stats.isFile()) {
      entries.set(relativePath, {
        digest: await sha256File(currentPath),
        type: "file",
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

function packagedPayloadPath(target) {
  return path.join(rootDir, "release", "tauri-candidate", target, releaseIdentity.payloadNames[target]);
}

function installerPayloadPath(target) {
  return path.join(
    rootDir,
    "release",
    "tauri-candidate-installer",
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
    "tauri-candidate-updates",
    target,
    "ifw",
    "packages",
    releaseIdentity.packageId,
    "data",
    releaseIdentity.payloadNames[target]
  );
}

function shellExecutablePath(target, payloadPath) {
  return target === "macos"
    ? path.join(payloadPath, "Contents", "MacOS", "sse-exed-tauri-shell")
    : path.join(payloadPath, "sse-exed-tauri-shell.exe");
}

function engineExecutablePath(target, payloadPath) {
  return target === "macos"
    ? path.join(payloadPath, "Contents", "MacOS", "studio-control-engine")
    : path.join(payloadPath, "studio-control-engine.exe");
}

function verifyCandidatePayload(target, payloadPath, label) {
  assertExists(payloadPath, `${label} payload (${target})`);
  assertExists(shellExecutablePath(target, payloadPath), `${label} Tauri shell executable (${target})`);
  assertExists(engineExecutablePath(target, payloadPath), `${label} engine executable (${target})`);
}

function verifyPackageXml(packageXmlPath, expectedDescription) {
  const packageXml = fileText(packageXmlPath);
  expectIncludes(packageXml, `<DisplayName>${releaseIdentity.displayName}</DisplayName>`, packageXmlPath);
  expectIncludes(packageXml, `<Description>${expectedDescription}</Description>`, packageXmlPath);
  expectIncludes(packageXml, `<Version>${packageJson.version}</Version>`, packageXmlPath);
  expectIncludes(packageXml, `<Name>${releaseIdentity.packageId}</Name>`, packageXmlPath);
}

function verifyInstallerStaging(target, mode) {
  const installerRoot = path.join(rootDir, "release", "tauri-candidate-installer", target);
  const configXmlPath = path.join(installerRoot, "ifw", "config", "config.xml");
  const packageXmlPath = path.join(installerRoot, "ifw", "packages", releaseIdentity.packageId, "meta", "package.xml");
  const installScriptPath = path.join(
    installerRoot,
    "ifw",
    "packages",
    releaseIdentity.packageId,
    "meta",
    "installscript.qs"
  );
  const configXml = fileText(configXmlPath);

  expectIncludes(configXml, `<Name>${releaseIdentity.displayName}</Name>`, configXmlPath);
  expectIncludes(configXml, `<Version>${packageJson.version}</Version>`, configXmlPath);
  expectIncludes(configXml, `<TargetDir>${releaseIdentity.targetDir}</TargetDir>`, configXmlPath);
  verifyPackageXml(
    packageXmlPath,
    "Offline native installer staging for the Tauri candidate shell and bundled Rust engine."
  );
  expectIncludes(fileText(installScriptPath), "sse-exed-tauri-shell", installScriptPath);
  verifyCandidatePayload(target, installerPayloadPath(target), "Installer staged");

  if (mode === "full") {
    const installerPath =
      target === "macos"
        ? path.join(installerRoot, "SSE-ExEd-Studio-Control-Tauri-Candidate-macOS-Installer.app")
        : path.join(installerRoot, "SSE-ExEd-Studio-Control-Tauri-Candidate-windows-Installer.exe");
    assertExists(installerPath, `Tauri candidate installer artifact (${target})`);
    if (target === "macos") {
      assertNonEmptyFile(
        path.join(installerRoot, "SSE-ExEd-Studio-Control-Tauri-Candidate-macOS-Installer.zip"),
        `Tauri candidate installer archive (${target})`
      );
    }
  }
}

function verifyUpdateStaging(target, mode) {
  const updateRoot = path.join(rootDir, "release", "tauri-candidate-updates", target);
  const packageXmlPath = path.join(updateRoot, "ifw", "packages", releaseIdentity.packageId, "meta", "package.xml");
  verifyPackageXml(
    packageXmlPath,
    "Tauri candidate runtime distributed through the Qt Installer Framework maintenance-tool repository."
  );
  verifyCandidatePayload(target, updatePayloadPath(target), "Update staged");

  if (mode === "full") {
    assertExists(path.join(updateRoot, "repository"), `Tauri candidate update repository (${target})`);
    assertNonEmptyFile(
      target === "macos"
        ? path.join(updateRoot, "SSE-ExEd-Studio-Control-Tauri-Candidate-macOS-UpdateRepository.zip")
        : path.join(updateRoot, "SSE-ExEd-Studio-Control-Tauri-Candidate-windows-UpdateRepository.zip"),
      `Tauri candidate update repository archive (${target})`
    );
  }
}

const target = parseTarget(readFlag("--target"));
const mode = parseMode(readFlag("--mode") ?? "staged");
const packagedPath = packagedPayloadPath(target);
const manifestPath = path.join(rootDir, "release", "tauri-candidate", target, "candidate-manifest.json");

verifyCandidatePayload(target, packagedPath, "Packaged");
assertNonEmptyFile(manifestPath, `Tauri candidate manifest (${target})`);
verifyInstallerStaging(target, mode);
verifyUpdateStaging(target, mode);
await verifyPayloadParity(
  packagedPath,
  installerPayloadPath(target),
  `Packaged Tauri candidate (${target})`,
  `Installer staged Tauri candidate (${target})`
);
await verifyPayloadParity(
  packagedPath,
  updatePayloadPath(target),
  `Packaged Tauri candidate (${target})`,
  `Update staged Tauri candidate (${target})`
);

console.log(`Verified Tauri candidate artifacts for ${target} (${mode}).`);
