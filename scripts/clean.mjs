// clean.mjs — remove generated build and release output.
//
//   node scripts/clean.mjs [--local] [--include-release] [--dry-run]
//
// `release/` is not only build output. On a workstation that runs Studio
// Control from the repository, `release/native/<platform>/` IS the installed
// app — nothing else on the machine can recreate that exact build — and until
// 2026-09-18 this script deleted it with everything else. Now:
//
// - When a packaged shell or engine executable exists anywhere under
//   `release/native` (the platform folders, and a `windows.production-keep`
//   folder a packaging lane may have left behind), that subtree is KEPT and the
//   command says so, loudly. Everything else is removed as before, the other
//   children of `release/` included.
// - `--include-release` removes it as well — unless a process is running from
//   that folder, or that cannot be checked: then the command refuses before it
//   has removed anything, so it is never half done.
// - `--dry-run` prints what would happen and removes nothing.
import { spawnSync } from "node:child_process";
import { readdirSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const TARGETS = [
  "native/build",
  "native/target",
  "frontend/app/dist",
  "frontend/app/storybook-static",
  "frontend/app/playwright-report",
  "frontend/app/test-results",
  "release",
];

export const LOCAL_TARGETS = [".swift-module-cache", "artifacts", "test-results", "aqtinstall.log"];

const RELEASE_DIR = "release";
const PACKAGED_APP_DIR = "release/native";
const PACKAGED_EXECUTABLE = /^(sse-exed-tauri-shell|studio-control-engine)(\.exe)?$/;
// release/native/<platform>/<payload>.app/Contents/MacOS/<executable> is the deepest layout.
const PACKAGED_APP_SEARCH_DEPTH = 5;

const dsStoreSkipDirs = new Set([".git", ".tools", "node_modules", "release", "artifacts", "target"]);

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

/** The packaged shell and engine executables under `release/native`, if any. */
export function findPackagedExecutables(rootDir) {
  const found = [];
  const walk = (directory, depth) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (depth < PACKAGED_APP_SEARCH_DEPTH) walk(entryPath, depth + 1);
      } else if (PACKAGED_EXECUTABLE.test(entry.name)) {
        const stats = statSync(entryPath);
        found.push({
          relativePath: toPosix(path.relative(rootDir, entryPath)),
          size: stats.size,
          modified: stats.mtime,
        });
      }
    }
  };
  walk(path.join(rootDir, PACKAGED_APP_DIR), 1);
  return found.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function canonical(targetPath) {
  let resolved = path.resolve(targetPath);
  try {
    resolved = realpathSync.native(resolved);
  } catch {
    // Gone, or not readable: compare the path as written.
  }
  return process.platform === "linux" ? resolved : resolved.toLowerCase();
}

/** Whether `candidate` is `directory` or lies inside it (case-insensitive where the file system is). */
export function isInside(candidate, directory) {
  const relative = path.relative(canonical(directory), canonical(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** The executable paths of the running processes, or null when they cannot be listed. */
export function listProcessPaths() {
  if (process.platform === "linux") {
    try {
      return readdirSync("/proc")
        .filter((name) => /^\d+$/.test(name))
        .flatMap((pid) => {
          try {
            return [readlinkSync(`/proc/${pid}/exe`)];
          } catch {
            return []; // Another user's process, a kernel thread, or one that just ended.
          }
        });
    } catch {
      return null;
    }
  }

  const result =
    process.platform === "win32"
      ? spawnSync(
          "powershell",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Get-CimInstance Win32_Process | ForEach-Object { $_.ExecutablePath }",
          ],
          { encoding: "utf8" }
        )
      : spawnSync("ps", ["-axo", "comm="], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    return null;
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

// Size and local time: how the operator, and every record of this build, knows the file.
function describe(executable) {
  const at = executable.modified;
  const two = (value) => String(value).padStart(2, "0");
  const when = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}:${two(at.getMinutes())}`;
  return `  ${executable.relativePath}  (${executable.size.toLocaleString("en-US")} bytes, ${when})`;
}

/**
 * Decide what a run removes and what it keeps, and why it may refuse. Pure
 * apart from reading the tree and (only with `includeRelease`) the process
 * list; removes nothing.
 */
export function planClean({ rootDir, local = false, includeRelease = false, processPaths = listProcessPaths }) {
  if (!rootDir) {
    throw new Error("planClean needs an explicit rootDir");
  }
  const targets = local ? [...TARGETS, ...LOCAL_TARGETS] : [...TARGETS];
  const packaged = findPackagedExecutables(rootDir);
  if (packaged.length === 0) {
    return { remove: targets, keep: [], packaged, refusal: null };
  }

  if (includeRelease) {
    const appDir = path.join(rootDir, PACKAGED_APP_DIR);
    const running = processPaths();
    if (running === null) {
      return {
        remove: [],
        keep: [],
        packaged,
        refusal: `--include-release: the running processes could not be listed, so it is not known whether the app under ${PACKAGED_APP_DIR} is running. Nothing was removed. Close Studio Control and delete ${PACKAGED_APP_DIR} by hand if that is what you want.`,
      };
    }
    const fromAppDir = running.filter((processPath) => isInside(processPath, appDir));
    if (fromAppDir.length > 0) {
      return {
        remove: [],
        keep: [],
        packaged,
        refusal: `--include-release: a process is running from ${PACKAGED_APP_DIR} (${fromAppDir.join(", ")}). Nothing was removed. Close Studio Control first.`,
      };
    }
    return { remove: targets, keep: [], packaged, refusal: null };
  }

  // Keep release/native whole; the other children of release/ go as before.
  let releaseChildren = [];
  try {
    releaseChildren = readdirSync(path.join(rootDir, RELEASE_DIR)).map((name) => `${RELEASE_DIR}/${name}`);
  } catch {
    // No release directory after all.
  }
  const remove = targets.flatMap((target) =>
    target === RELEASE_DIR ? releaseChildren.filter((child) => child !== PACKAGED_APP_DIR) : [target]
  );
  return { remove, keep: [PACKAGED_APP_DIR], packaged, refusal: null };
}

async function removeDsStoreFiles(rootDir, directory, { dryRun, log }) {
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
          await removeDsStoreFiles(rootDir, entryPath, { dryRun, log });
        }
        return;
      }

      if (entry.isFile() && entry.name === ".DS_Store") {
        if (!dryRun) await rm(entryPath, { force: true });
        log(`${dryRun ? "would remove" : "removed"} ${path.relative(rootDir, entryPath)}`);
      }
    })
  );
}

/** Run the clean. Returns the process exit code. */
export async function clean({
  rootDir,
  local = false,
  includeRelease = false,
  dryRun = false,
  processPaths = listProcessPaths,
  log = console.log,
  warn = console.error,
}) {
  const plan = planClean({ rootDir, local, includeRelease, processPaths });
  if (plan.refusal) {
    warn(`REFUSED. ${plan.refusal}`);
    return 1;
  }

  await Promise.all(
    plan.remove.map(async (relativePath) => {
      if (!dryRun) await rm(path.join(rootDir, relativePath), { force: true, recursive: true });
      log(`${dryRun ? "would remove" : "removed"} ${relativePath}`);
    })
  );
  if (local) {
    await removeDsStoreFiles(rootDir, rootDir, { dryRun, log });
  }

  if (plan.keep.length > 0) {
    warn(
      [
        "",
        `KEPT ${plan.keep.join(", ")} — a packaged app is in there:`,
        ...plan.packaged.map(describe),
        "On a workstation that runs Studio Control from this folder, that is the installed app, and nothing in the repository can rebuild that exact build.",
        `To delete it as well, close the app and run: npm run ${local ? "clean:local" : "clean"} -- --include-release`,
      ].join("\n")
    );
  } else if (plan.packaged.length > 0) {
    warn(
      [
        `${dryRun ? "Would remove" : "Removed"} the packaged app (--include-release):`,
        ...plan.packaged.map(describe),
      ].join("\n")
    );
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flags = new Set(process.argv.slice(2));
  const known = new Set(["--local", "--include-release", "--dry-run"]);
  const unknown = [...flags].filter((flag) => !known.has(flag));
  if (unknown.length > 0) {
    // A mistyped --include-release must not fall back to a plain clean, nor a mistyped --dry-run to a real one.
    console.error(`Unknown option ${unknown.join(", ")}. Use --local, --include-release, --dry-run.`);
    process.exit(2);
  }
  process.exit(
    await clean({
      rootDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
      local: flags.has("--local"),
      includeRelease: flags.has("--include-release"),
      dryRun: flags.has("--dry-run"),
    })
  );
}
