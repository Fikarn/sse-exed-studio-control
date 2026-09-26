import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseIdentity = JSON.parse(readFileSync(path.join(rootDir, "scripts", "native-release-identity.json"), "utf8"));

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

function parseMode(value) {
  if (value === "staged" || value === "full") {
    return value;
  }

  throw new Error(`Unsupported mode '${value}'. Use --mode=staged or --mode=full.`);
}

function checksumOutputPath(target) {
  const fileName =
    target === "macos"
      ? "SSE-ExEd-Studio-Control-Native-macOS-SHA256.txt"
      : "SSE-ExEd-Studio-Control-Native-windows-SHA256.txt";
  return path.join(rootDir, "release", "checksums", target, fileName);
}

function checksumEntriesFor(target, mode) {
  const packagedRoot = path.join(rootDir, "release", "native", target);
  const entries = [
    {
      label: "packaged native bundle archive",
      path:
        target === "macos"
          ? path.join(packagedRoot, "SSE-ExEd-Studio-Control-Native-macOS.zip")
          : path.join(packagedRoot, "SSE-ExEd-Studio-Control-Native-windows.zip"),
    },
  ];

  if (mode === "full") {
    entries.push(
      {
        label: "native installer artifact",
        path:
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
      },
      {
        label: "native update repository archive",
        path:
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
              ),
      }
    );
  }

  return entries;
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

async function main() {
  const target = parseTarget(readFlag("--target"));
  const mode = parseMode(readFlag("--mode") ?? "full");
  const outputPath = checksumOutputPath(target);
  const entries = checksumEntriesFor(target, mode);

  for (const entry of entries) {
    assert(existsSync(entry.path), `${entry.label} not found at ${entry.path}.`);
  }

  mkdirSync(path.dirname(outputPath), { recursive: true });

  const lines = [];
  for (const entry of entries) {
    const digest = await sha256File(entry.path);
    lines.push(`${digest}  ${path.basename(entry.path)}`);
  }

  await import("node:fs/promises").then(({ writeFile }) => writeFile(outputPath, `${lines.join("\n")}\n`, "utf8"));

  console.log(`Wrote native ${target} ${mode} checksum manifest: ${outputPath}`);
  console.log(`Checksummed ${entries.length} artifact(s) for ${releaseIdentity.displayName}.`);
}

// Runs only as `node scripts/write-native-release-checksums.mjs …`: an import
// does nothing (2026-09-26; the run writes the checksum manifest under
// release/checksums). The two paths are compared as real paths — through a
// directory junction or a short 8.3 name, `process.argv[1]` and
// `import.meta.url` spell the same file differently, and a plain comparison
// would skip the run without a word (scripts/dev-check-cli.mjs).
function isMainModule() {
  const started = process.argv[1];
  if (!started) {
    return false;
  }
  const self = fileURLToPath(import.meta.url);
  let same = false;
  try {
    same = realpathSync.native(started) === realpathSync.native(self);
  } catch {
    // Not a file the file system resolves: not this one.
  }
  if (!same && path.basename(started) === path.basename(self)) {
    throw new Error(`${started} was started, but it could not be matched to ${self}; nothing was done.`);
  }
  return same;
}

if (isMainModule()) {
  await main();
}
