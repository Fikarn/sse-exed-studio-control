import { spawnSync } from "node:child_process";
import fs, { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

function main() {
  const command = process.argv[2];
  const cargo = process.platform === "win32" ? "cargo.exe" : "cargo";
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

  const engineBuild = spawnSync(cargo, ["build", "--package", "studio-control-engine"], {
    cwd: path.join(rootDirectory, "native"),
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (engineBuild.error) {
    console.error(`Tauri before-command failed to start cargo: ${engineBuild.error.message}`);
  }

  if (engineBuild.status !== 0) {
    process.exit(engineBuild.status ?? 1);
  }

  const result = spawnSync(npm, args, {
    cwd: rootDirectory,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.error) {
    console.error(`Tauri before-command failed to start npm: ${result.error.message}`);
  }

  process.exit(result.status ?? 1);
}

// Runs only as `node scripts/tauri-before-command.mjs dev|build`: an import
// does nothing (2026-09-26; the run builds the engine with cargo, starts the
// front end's dev server or build and ends the process with its exit code).
// Tauri runs that command line (tauri.conf.json) from native/ or
// native/tauri-shell/, where it starts one of the two shims, each a bare
// import of this file (their own comments say which runs when): both are
// entry points too, and scripts/native-lanes.test.mjs holds this list to the
// files that import this one. The paths are compared as real paths — through
// a directory junction or a short 8.3 name, `process.argv[1]` and
// `import.meta.url` spell the same file differently, and a plain comparison
// would skip the run without a word (scripts/dev-check-cli.mjs).
function isMainModule() {
  const started = process.argv[1];
  if (!started) {
    return false;
  }
  const self = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(self), "..");
  const entryPoints = [
    self,
    path.join(repoRoot, "native", "scripts", "tauri-before-command.mjs"),
    path.join(repoRoot, "native", "tauri-shell", "scripts", "tauri-before-command.mjs"),
  ];
  let startedPath = null;
  try {
    startedPath = realpathSync.native(started);
  } catch {
    // Not a file the file system resolves: not this one.
  }
  const same =
    startedPath !== null &&
    entryPoints.some((entry) => {
      try {
        return realpathSync.native(entry) === startedPath;
      } catch {
        // An entry point that is not there.
        return false;
      }
    });
  if (!same && path.basename(started) === path.basename(self)) {
    throw new Error(`${started} was started, but it could not be matched to ${self}; nothing was done.`);
  }
  return same;
}

if (isMainModule()) {
  main();
}
