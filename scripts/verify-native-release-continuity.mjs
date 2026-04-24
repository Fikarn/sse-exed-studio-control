import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const relocatedProductUrls = new Map([
  ["https://github.com/Fikarn/project-management-dashboard", "https://github.com/Fikarn/sse-exed-studio-control"],
]);

const legacyIdentity = {
  displayName: "SSE ExEd Studio Control Native",
  installerTitle: "SSE ExEd Studio Control Native Installer",
  publisher: "SSE",
  productUrl: "https://github.com/Fikarn/project-management-dashboard",
  startMenuDir: "SSE ExEd Studio Control Native",
  packageId: "com.sse.exedstudiocontrol.native",
  targetDir: "@ApplicationsDir@",
  installerDescription: "Offline native installer for the Qt shell and bundled Rust engine.",
  updateDescription:
    "Native workstation runtime distributed through the Qt Installer Framework maintenance-tool repository.",
  payloadNames: {
    macos: "SSE ExEd Studio Control Native.app",
    windows: "SSE ExEd Studio Control Native",
  },
};

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

function parseTarget(value) {
  if (value === "macos" || value === "windows") {
    return value;
  }

  throw new Error(`Unsupported target '${value}'. Use --target=macos or --target=windows.`);
}

function fileText(targetPath) {
  return readFileSync(targetPath, "utf8");
}

function loadJson(targetPath) {
  return JSON.parse(fileText(targetPath));
}

function expectIncludes(text, expected, label) {
  assert(text.includes(expected), `${label} is missing '${expected}'.`);
}

function parseVersion(value) {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  assert(match, `Unsupported semver value '${value}'.`);
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    prerelease: match[4] ?? null,
  };
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);

  if (a.major !== b.major) {
    return a.major - b.major;
  }
  if (a.minor !== b.minor) {
    return a.minor - b.minor;
  }
  if (a.patch !== b.patch) {
    return a.patch - b.patch;
  }
  if (a.prerelease === b.prerelease) {
    return 0;
  }
  if (a.prerelease === null) {
    return 1;
  }
  if (b.prerelease === null) {
    return -1;
  }
  return a.prerelease.localeCompare(b.prerelease);
}

function runGit(args) {
  const result = spawnSync("git", args, {
    cwd: rootDir,
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    return null;
  }

  return result.stdout;
}

function readJsonAtRef(ref, repoPath) {
  const output = runGit(["show", `${ref}:${repoPath}`]);
  if (output === null) {
    return null;
  }

  return JSON.parse(output);
}

function normalizeRelocatedMetadata(identity) {
  return {
    ...identity,
    productUrl: relocatedProductUrls.get(identity.productUrl) ?? identity.productUrl,
  };
}

function findPreviousReleaseRef(currentVersion) {
  const output = runGit(["tag", "--sort=-v:refname"]);
  if (!output) {
    return null;
  }

  const tags = output
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);

  for (const tag of tags) {
    const tagVersion = tag.startsWith("v") ? tag.slice(1) : tag;
    if (compareVersions(tagVersion, currentVersion) < 0) {
      return tag;
    }
  }

  return null;
}

function verifyInstallerContinuity(target, packageJson, identity) {
  const installerRoot = path.join(rootDir, "release", "native-installer", target);
  const configXmlPath = path.join(installerRoot, "ifw", "config", "config.xml");
  const packageXmlPath = path.join(installerRoot, "ifw", "packages", identity.packageId, "meta", "package.xml");

  assert(existsSync(configXmlPath), `Installer continuity check missing ${configXmlPath}.`);
  assert(existsSync(packageXmlPath), `Installer continuity check missing ${packageXmlPath}.`);

  const configXml = fileText(configXmlPath);
  expectIncludes(configXml, `<Name>${identity.displayName}</Name>`, configXmlPath);
  expectIncludes(configXml, `<Title>${identity.installerTitle}</Title>`, configXmlPath);
  expectIncludes(configXml, `<Publisher>${identity.publisher}</Publisher>`, configXmlPath);
  expectIncludes(configXml, `<ProductUrl>${identity.productUrl}</ProductUrl>`, configXmlPath);
  expectIncludes(configXml, `<StartMenuDir>${identity.startMenuDir}</StartMenuDir>`, configXmlPath);
  expectIncludes(configXml, `<TargetDir>${identity.targetDir}</TargetDir>`, configXmlPath);
  expectIncludes(configXml, `<Version>${packageJson.version}</Version>`, configXmlPath);

  const packageXml = fileText(packageXmlPath);
  expectIncludes(packageXml, `<DisplayName>${identity.displayName}</DisplayName>`, packageXmlPath);
  expectIncludes(packageXml, `<Description>${identity.installerDescription}</Description>`, packageXmlPath);
  expectIncludes(packageXml, `<Name>${identity.packageId}</Name>`, packageXmlPath);
  expectIncludes(packageXml, `<Version>${packageJson.version}</Version>`, packageXmlPath);
}

function verifyUpdateContinuity(target, packageJson, identity) {
  const updateRoot = path.join(rootDir, "release", "native-updates", target);
  const packageXmlPath = path.join(updateRoot, "ifw", "packages", identity.packageId, "meta", "package.xml");

  assert(existsSync(packageXmlPath), `Update continuity check missing ${packageXmlPath}.`);

  const packageXml = fileText(packageXmlPath);
  expectIncludes(packageXml, `<DisplayName>${identity.displayName}</DisplayName>`, packageXmlPath);
  expectIncludes(packageXml, `<Description>${identity.updateDescription}</Description>`, packageXmlPath);
  expectIncludes(packageXml, `<Name>${identity.packageId}</Name>`, packageXmlPath);
  expectIncludes(packageXml, `<Version>${packageJson.version}</Version>`, packageXmlPath);
}

const target = parseTarget(readFlag("--target"));
const packageJson = loadJson(path.join(rootDir, "package.json"));
const identity = loadJson(path.join(rootDir, "scripts", "native-release-identity.json"));
const previousRef = readFlag("--previous-ref") ?? findPreviousReleaseRef(packageJson.version);

if (!previousRef) {
  console.log(
    `No previous tagged release lower than ${packageJson.version} was found. Skipping continuity verification.`
  );
  process.exit(0);
}

const previousPackageJson = readJsonAtRef(previousRef, "package.json");
assert(previousPackageJson?.version, `Previous release ref '${previousRef}' is missing package.json version metadata.`);
assert(
  compareVersions(previousPackageJson.version, packageJson.version) < 0,
  `Previous release version ${previousPackageJson.version} must be lower than current version ${packageJson.version}.`
);

const previousIdentity = readJsonAtRef(previousRef, "scripts/native-release-identity.json") ?? legacyIdentity;
assert(
  JSON.stringify(normalizeRelocatedMetadata(previousIdentity)) === JSON.stringify(identity),
  `Native release identity changed between ${previousRef} and ${packageJson.version}. Installer/update identity must remain stable for continuity.`
);

verifyInstallerContinuity(target, packageJson, identity);
verifyUpdateContinuity(target, packageJson, identity);

console.log(
  `Verified native release continuity for ${target} from ${previousRef} (${previousPackageJson.version}) to ${packageJson.version}.`
);
