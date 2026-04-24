import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const targets = [
  "native/build",
  "native/tauri-shell/target",
  "frontend/app/dist",
  "frontend/app/storybook-static",
  "frontend/app/playwright-report",
  "frontend/app/test-results",
  "release",
];

async function removeTarget(relativePath) {
  const targetPath = path.join(rootDir, relativePath);
  await rm(targetPath, { force: true, recursive: true });
  console.log(`removed ${relativePath}`);
}

await Promise.all(targets.map(removeTarget));
