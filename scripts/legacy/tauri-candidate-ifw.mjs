import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const releaseIdentity = JSON.parse(readFileSync(path.join(rootDir, "scripts", "native-release-identity.json"), "utf8"));
const packageJson = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8"));
const args = process.argv.slice(2);

function readFlag(name) {
  const prefix = `${name}=`;
  const entry = args.find((value) => value.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : null;
}

function hasFlag(name) {
  return args.includes(name);
}

function parseTarget(value) {
  if (value === "macos" || value === "windows") {
    return value;
  }

  throw new Error(`Unsupported Tauri candidate IFW target '${value}'. Use --target=macos or --target=windows.`);
}

function parseKind(value) {
  if (value === "installer" || value === "update") {
    return value;
  }

  throw new Error(`Unsupported Tauri candidate IFW kind '${value}'. Use --kind=installer or --kind=update.`);
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: rootDir,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    throw new Error(`${command} ${commandArgs.join(" ")} failed with exit code ${result.status ?? 1}.`);
  }
}

function resolveExecutableOnPath(name) {
  const lookupCommand = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(lookupCommand, [name], {
    cwd: rootDir,
    encoding: "utf8",
  });
  if ((result.status ?? 1) !== 0) {
    return null;
  }

  return (
    result.stdout
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .find(Boolean) ?? null
  );
}

function resolveIfwTool(kind) {
  const envCandidates =
    kind === "installer"
      ? [process.env.SSE_QT_IFW_BINARYCREATOR, process.env.QT_IFW_BINARYCREATOR]
      : [process.env.SSE_QT_IFW_REPOGEN, process.env.QT_IFW_REPOGEN];

  for (const candidate of envCandidates.filter(Boolean)) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return resolveExecutableOnPath(kind === "installer" ? "binarycreator" : "repogen");
}

function packagedPayloadPath(target) {
  return path.join(rootDir, "release", "tauri-candidate", target, releaseIdentity.payloadNames[target]);
}

function ensurePackagedPayload(target) {
  const payloadPath = packagedPayloadPath(target);
  if (existsSync(payloadPath)) {
    return payloadPath;
  }

  if ((target === "macos" && process.platform === "darwin") || (target === "windows" && process.platform === "win32")) {
    run(process.execPath, [
      path.join(rootDir, "scripts", "legacy", "tauri-package-candidate.mjs"),
      `--target=${target}`,
    ]);
    return payloadPath;
  }

  throw new Error(`Packaged Tauri candidate payload not found at ${payloadPath}. Build it on a matching host first.`);
}

function renderConfigXml({ version, targetDir }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Installer>
  <Name>${releaseIdentity.displayName}</Name>
  <Version>${version}</Version>
  <Title>${releaseIdentity.installerTitle} - Tauri Candidate</Title>
  <Publisher>${releaseIdentity.publisher}</Publisher>
  <ProductUrl>${releaseIdentity.productUrl}</ProductUrl>
  <StartMenuDir>${releaseIdentity.startMenuDir}</StartMenuDir>
  <TargetDir>${targetDir}</TargetDir>
</Installer>
`;
}

function renderPackageXml({ description, includeScript, releaseDate, version }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Package>
  <DisplayName>${releaseIdentity.displayName}</DisplayName>
  <Description>${description}</Description>
  <Version>${version}</Version>
  <ReleaseDate>${releaseDate}</ReleaseDate>
  <Name>${releaseIdentity.packageId}</Name>
  <Default>true</Default>
  <ForcedInstallation>true</ForcedInstallation>
  <Essential>true</Essential>
${includeScript ? "  <Script>installscript.qs</Script>\n" : ""}  <Licenses>
    <License name="MIT" file="LICENSE.txt"/>
  </Licenses>
</Package>
`;
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

const target = parseTarget(readFlag("--target"));
const kind = parseKind(readFlag("--kind"));
const prepareOnly = hasFlag("--prepare-only");
const releaseDate = new Date().toISOString().slice(0, 10);
const payloadPath = ensurePackagedPayload(target);
const rootName = kind === "installer" ? "tauri-candidate-installer" : "tauri-candidate-updates";
const candidateRoot = path.join(rootDir, "release", rootName, target);
const buildRoot = path.join(candidateRoot, "ifw");
const packageRoot = path.join(buildRoot, "packages", releaseIdentity.packageId);
const metaDir = path.join(packageRoot, "meta");
const dataDir = path.join(packageRoot, "data");
const stagedPayloadPath = path.join(dataDir, releaseIdentity.payloadNames[target]);

rmSync(buildRoot, { force: true, recursive: true });
mkdirSync(metaDir, { recursive: true });
mkdirSync(dataDir, { recursive: true });

if (kind === "installer") {
  const configDir = path.join(buildRoot, "config");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    path.join(configDir, "config.xml"),
    renderConfigXml({ targetDir: releaseIdentity.targetDir, version: packageJson.version }),
    "utf8"
  );
}

writeFileSync(
  path.join(metaDir, "package.xml"),
  renderPackageXml({
    description:
      kind === "installer"
        ? "Offline native installer staging for the Tauri candidate shell and bundled Rust engine."
        : "Tauri candidate runtime distributed through the Qt Installer Framework maintenance-tool repository.",
    includeScript: kind === "installer",
    releaseDate,
    version: packageJson.version,
  }),
  "utf8"
);
copyFileSync(path.join(rootDir, "LICENSE"), path.join(metaDir, "LICENSE.txt"));
if (kind === "installer") {
  copyFileSync(
    path.join(rootDir, "native", "installer-templates", "tauri-installscript.qs"),
    path.join(metaDir, "installscript.qs")
  );
}
cpSync(payloadPath, stagedPayloadPath, { recursive: true, verbatimSymlinks: true });

console.log(`Prepared Tauri candidate ${kind} staging for ${target}: ${buildRoot}`);
console.log(`Staged Tauri candidate payload: ${stagedPayloadPath}`);

if (prepareOnly) {
  console.log(`Skipping QtIFW ${kind} build because --prepare-only was requested.`);
  process.exit(0);
}

const ifwTool = resolveIfwTool(kind);
if (!ifwTool) {
  const toolName = kind === "installer" ? "binarycreator" : "repogen";
  throw new Error(
    `Qt Installer Framework ${toolName} was not found. Set the matching SSE_QT_IFW_* path or install QtIFW.`
  );
}

if (kind === "installer") {
  const installerPath =
    target === "macos"
      ? path.join(candidateRoot, "SSE-ExEd-Studio-Control-Tauri-Candidate-macOS-Installer.app")
      : path.join(candidateRoot, "SSE-ExEd-Studio-Control-Tauri-Candidate-windows-Installer.exe");
  const archivePath =
    target === "macos" ? path.join(candidateRoot, "SSE-ExEd-Studio-Control-Tauri-Candidate-macOS-Installer.zip") : null;

  rmSync(installerPath, { force: true, recursive: true });
  if (archivePath) {
    rmSync(archivePath, { force: true, recursive: true });
  }
  run(ifwTool, [
    "--offline-only",
    "-c",
    path.join(buildRoot, "config", "config.xml"),
    "-p",
    path.join(buildRoot, "packages"),
    installerPath,
  ]);
  if (archivePath) {
    archiveMacPath(installerPath, archivePath);
  }
  console.log(`Built Tauri candidate installer artifact: ${installerPath}`);
  if (archivePath) {
    console.log(`Archived Tauri candidate installer artifact: ${archivePath}`);
  }
} else {
  const repositoryPath = path.join(candidateRoot, "repository");
  const archivePath =
    target === "macos"
      ? path.join(candidateRoot, "SSE-ExEd-Studio-Control-Tauri-Candidate-macOS-UpdateRepository.zip")
      : path.join(candidateRoot, "SSE-ExEd-Studio-Control-Tauri-Candidate-windows-UpdateRepository.zip");

  rmSync(repositoryPath, { force: true, recursive: true });
  rmSync(archivePath, { force: true, recursive: true });
  mkdirSync(path.dirname(repositoryPath), { recursive: true });
  run(ifwTool, ["-p", path.join(buildRoot, "packages"), repositoryPath]);
  if (target === "macos") {
    archiveMacPath(repositoryPath, archivePath);
  } else {
    archiveWindowsPath(repositoryPath, archivePath);
  }
  console.log(`Built Tauri candidate update repository: ${repositoryPath}`);
  console.log(`Archived Tauri candidate update repository: ${archivePath}`);
}
