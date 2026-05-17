import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localMode = process.argv.includes("--local");

const targets = [
  "native/build",
  "native/target",
  "frontend/app/dist",
  "frontend/app/storybook-static",
  "frontend/app/playwright-report",
  "frontend/app/test-results",
  "release",
];

const localTargets = [".swift-module-cache", "artifacts", "test-results", "aqtinstall.log"];

const dsStoreSkipDirs = new Set([".git", ".tools", "node_modules", "release", "artifacts", "target"]);

async function removeTarget(relativePath) {
  const targetPath = path.join(rootDir, relativePath);
  await rm(targetPath, { force: true, recursive: true });
  console.log(`removed ${relativePath}`);
}

async function removeDsStoreFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!dsStoreSkipDirs.has(entry.name)) {
          await removeDsStoreFiles(entryPath);
        }
        return;
      }

      if (entry.isFile() && entry.name === ".DS_Store") {
        await rm(entryPath, { force: true });
        console.log(`removed ${path.relative(rootDir, entryPath)}`);
      }
    })
  );
}

const selectedTargets = localMode ? [...targets, ...localTargets] : targets;
await Promise.all(selectedTargets.map(removeTarget));

if (localMode) {
  await removeDsStoreFiles(rootDir);
}
