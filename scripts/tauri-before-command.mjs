import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function findWorkspaceRoot(startDirectory) {
  let directory = startDirectory;

  while (true) {
    const packageJsonPath = path.join(directory, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      if (packageJson.workspaces) {
        return directory;
      }
    }

    const parentDirectory = path.dirname(directory);
    if (parentDirectory === directory) {
      throw new Error("Workspace root not found");
    }
    directory = parentDirectory;
  }
}

const command = process.argv[2];
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const rootDirectory = findWorkspaceRoot(process.cwd());

const args =
  command === "dev"
    ? ["--workspace", "frontend/app", "run", "dev", "--", "--host", "127.0.0.1", "--port", "4173", "--strictPort"]
    : command === "build"
      ? ["--workspace", "frontend/app", "run", "build"]
      : null;

if (!args) {
  console.error(`Unsupported Tauri before-command "${command ?? ""}".`);
  process.exit(1);
}

const result = spawnSync(npm, args, {
  cwd: rootDirectory,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
