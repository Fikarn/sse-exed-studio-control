import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  assertContinuitySentinel,
  assertSavedWorkspace,
  createContinuitySentinel,
  publishWithOverride,
  SAVED_DATA_MARKER_CHANGED,
  SEEDED_WORKSPACE,
  seedSavedWorkspace,
} from "./native-parity-acceptance.mjs";
import {
  assert,
  EngineHarness,
  hardenedLaneEnv,
  laneProcessEnv,
  resolvePathFromRoot,
} from "./native-runtime-harness.mjs";
import { assertSafeBundledSqlite } from "./native-release-safety.mjs";
import {
  nativeReleaseRequiresOperatorUiReady,
  nativeReleaseShellExecutableName,
  nativeReleaseSmokeArgs,
  resolveNativeReleaseRuntime,
} from "./native-release-runtime.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseIdentity = JSON.parse(readFileSync(path.join(rootDir, "scripts", "native-release-identity.json"), "utf8"));
const releaseRuntime = resolveNativeReleaseRuntime(rootDir);
// New pages program, Slice 2: the sentinel is a lighting group; until then it
// was a Planning project (see createContinuitySentinel).
const sentinelGroupName = "Installer Continuity Sentinel";
const qtFontAliasWarningPatterns = [
  /^qt\.qpa\.fonts: Populating font family aliases took .*missing font family "Sans Serif" with one that exists to avoid this cost\.\s*$/,
];

function readFlag(name) {
  const prefix = `${name}=`;
  const entry = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : null;
}

function parseTarget(value) {
  if (value === "windows") {
    return value;
  }

  throw new Error(`Unsupported installer acceptance target '${value}'. Use --target=windows.`);
}

function parseRuntime(value) {
  if (!value || value === "native" || value === "tauri") {
    return value ?? "native";
  }

  throw new Error(`Unsupported installer acceptance runtime '${value}'. Use --runtime=native or --runtime=tauri.`);
}

function effectiveInstalledRuntime(runtimeKind) {
  if (runtimeKind === "tauri") {
    return "tauri";
  }
  return releaseRuntime;
}

function countSuppressedLines(text, patterns, writer) {
  if (!text) {
    return 0;
  }

  let suppressed = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line) {
      continue;
    }

    if (patterns.some((pattern) => pattern.test(line))) {
      suppressed += 1;
      continue;
    }

    writer.write(`${line}\n`);
  }

  return suppressed;
}

function emitCapturedOutput(stdout, stderr, options = {}) {
  const patterns = options.patterns ?? [];
  const summaryLabel = options.summaryLabel ?? null;
  const suppressed =
    countSuppressedLines(stdout, patterns, process.stdout) + countSuppressedLines(stderr, patterns, process.stderr);

  if (suppressed > 0 && summaryLabel) {
    console.log(`Suppressed ${suppressed} known non-fatal ${summaryLabel} line${suppressed === 1 ? "" : "s"}.`);
  }
}

function readSmokeStatus(statusPath) {
  if (!existsSync(statusPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(statusPath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to parse smoke status file at ${statusPath}: ${error.message}`, { cause: error });
  }
}

function normalizeForOutputComparison(value) {
  return value.replaceAll("\\", "/");
}

function resolveInstallerExecutable(runtimeKind) {
  if (runtimeKind === "tauri") {
    return path.join(
      rootDir,
      "release",
      "tauri-candidate-installer",
      "windows",
      "SSE-ExEd-Studio-Control-Tauri-Candidate-windows-Installer.exe"
    );
  }

  return path.join(
    rootDir,
    "release",
    "native-installer",
    "windows",
    "SSE-ExEd-Studio-Control-Native-windows-Installer.exe"
  );
}

function resolveRepositoryPath(target, runtimeKind) {
  const rootName = runtimeKind === "tauri" ? "tauri-candidate-updates" : "native-updates";
  return path.join(rootDir, "release", rootName, target, "repository");
}

function resolveInstalledRuntime(target, installRoot, runtimeKind) {
  const installedRuntime = effectiveInstalledRuntime(runtimeKind);
  const shellName = nativeReleaseShellExecutableName(target, installedRuntime);
  const payloadPath = path.join(installRoot, releaseIdentity.payloadNames[target]);
  return {
    label: "Windows",
    payloadPath,
    shellPath: path.join(payloadPath, shellName),
    enginePath: path.join(payloadPath, "studio-control-engine.exe"),
    commandArgs: (statusPath) => nativeReleaseSmokeArgs(target, installedRuntime, statusPath),
    requiresOperatorUiReady: nativeReleaseRequiresOperatorUiReady(installedRuntime),
  };
}

function probeInstallRootAfterInstall(installRoot, phase) {
  if (!existsSync(installRoot)) {
    return;
  }
  const entries = readdirSync(installRoot, { withFileTypes: true })
    .map((entry) => `${entry.name} (${entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other"})`)
    .join(", ");
  console.log(`Installer acceptance: install-root state immediately after ${phase}: ${entries || "<empty>"}.`);
  const promoted = promoteWindowsMaintenanceToolNew(installRoot);
  if (!promoted) {
    const exeCandidates = ["maintenancetool.exe", "MaintenanceTool.exe"];
    const existingExe = exeCandidates.find((name) => existsSync(path.join(installRoot, name)));
    if (existingExe) {
      console.log(
        `Installer acceptance: maintenance tool already promoted to ${existingExe} after ${phase} (no rename needed).`
      );
    } else {
      console.warn(
        `Installer acceptance: no maintenancetool.exe or maintenancetool.exe.new in install-root after ${phase}. Maintenance-tool purge will be skipped at teardown; reg-delete fallback will run.`
      );
    }
  }
}

function promoteWindowsMaintenanceToolNew(installRoot) {
  if (!existsSync(installRoot)) {
    return null;
  }

  const candidates = [
    [path.join(installRoot, "maintenancetool.exe.new"), path.join(installRoot, "maintenancetool.exe")],
    [path.join(installRoot, "MaintenanceTool.exe.new"), path.join(installRoot, "MaintenanceTool.exe")],
  ];

  for (const [pendingPath, finalPath] of candidates) {
    if (!existsSync(pendingPath)) {
      continue;
    }
    if (existsSync(finalPath)) {
      continue;
    }
    try {
      renameSync(pendingPath, finalPath);
      console.log(
        `Installer acceptance: promoted ${path.basename(pendingPath)} -> ${path.basename(finalPath)} at ${installRoot}.`
      );
      return finalPath;
    } catch (error) {
      console.warn(
        `Installer acceptance: failed to promote ${path.basename(pendingPath)} -> ${path.basename(finalPath)} at ${installRoot}: ${
          error instanceof Error ? error.message : String(error)
        }.`
      );
      return null;
    }
  }

  return null;
}

function resolveMaintenanceToolPath(installRoot) {
  const candidates = [path.join(installRoot, "maintenancetool.exe"), path.join(installRoot, "MaintenanceTool.exe")];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  // QtIFW writes the maintenance tool as `<name>.exe.new` on Windows during install
  // and renames to `.exe` on the next maintenance-tool invocation or installer run.
  // If the script reaches this resolver right after a reinstall (no intermediate
  // invocation), the rename hasn't fired yet and `.exe` is absent. Promote it
  // ourselves so subsequent purge/teardown can spawn the binary.
  const promoted = promoteWindowsMaintenanceToolNew(installRoot);
  if (promoted) {
    return promoted;
  }

  if (existsSync(installRoot)) {
    const entries = readdirSync(installRoot, { withFileTypes: true });
    const matchingExe = entries.find(
      (entry) =>
        entry.isFile() &&
        entry.name.toLowerCase().includes("maintenancetool") &&
        entry.name.toLowerCase().endsWith(".exe")
    );
    if (matchingExe) {
      return path.join(installRoot, matchingExe.name);
    }
  }

  throw new Error(`Maintenance tool not found under ${installRoot}.`);
}

async function runCliStep(command, args, acceptanceRoot, stepName) {
  const stepRoot = path.join(acceptanceRoot, stepName);
  const stdoutPath = path.join(stepRoot, "stdout.log");
  const stderrPath = path.join(stepRoot, "stderr.log");
  const homeDir = path.join(acceptanceRoot, "home");
  const env = await installerRunEnv(acceptanceRoot, stepName);

  rmSync(stepRoot, { force: true, recursive: true });
  mkdirSync(stepRoot, { recursive: true });
  mkdirSync(path.join(homeDir, ".cache"), { recursive: true });

  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    env,
  });

  writeFileSync(stdoutPath, result.stdout ?? "", "utf8");
  writeFileSync(stderrPath, result.stderr ?? "", "utf8");

  emitCapturedOutput(result.stdout, result.stderr, {
    patterns: qtFontAliasWarningPatterns,
    summaryLabel: "Qt font alias warning",
  });

  if (result.error) {
    throw result.error;
  }

  const exitCode = result.status ?? 1;
  if (exitCode !== 0) {
    throw new Error(
      `Installer acceptance step '${stepName}' exited with code ${exitCode}. See ${stdoutPath} and ${stderrPath}.`
    );
  }

  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    stepRoot,
  };
}

async function safeRunCliStep(command, args, acceptanceRoot, stepName) {
  const stepRoot = path.join(acceptanceRoot, stepName);
  const stdoutPath = path.join(stepRoot, "stdout.log");
  const stderrPath = path.join(stepRoot, "stderr.log");
  const homeDir = path.join(acceptanceRoot, "home");

  rmSync(stepRoot, { force: true, recursive: true });
  mkdirSync(stepRoot, { recursive: true });
  mkdirSync(path.join(homeDir, ".cache"), { recursive: true });

  let result;
  try {
    const env = await installerRunEnv(acceptanceRoot, stepName);
    result = spawnSync(command, args, {
      cwd: rootDir,
      encoding: "utf8",
      env,
    });
  } catch (error) {
    return {
      ok: false,
      exitCode: 1,
      stdout: "",
      stderr: "",
      stepRoot,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  writeFileSync(stdoutPath, result.stdout ?? "", "utf8");
  writeFileSync(stderrPath, result.stderr ?? "", "utf8");

  emitCapturedOutput(result.stdout, result.stderr, {
    patterns: qtFontAliasWarningPatterns,
    summaryLabel: "Qt font alias warning",
  });

  const exitCode = result.error ? 1 : (result.status ?? 1);
  return {
    ok: !result.error && exitCode === 0,
    exitCode,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    stepRoot,
    error: result.error
      ? result.error.message
      : exitCode === 0
        ? null
        : `Step '${stepName}' exited with code ${exitCode}`,
  };
}

/**
 * The environment of every QtIFW run: the install, the reinstall and each
 * maintenance-tool step. QtIFW runs the installed app's first-launch check
 * (`native/installer-templates/tauri-installscript.qs`) as soon as the files
 * are in place, with the installer's own environment; the lane gave that no
 * app data of its own, so on Windows the check opened the real one
 * (%APPDATA%, which the lane's HOME does not move). It gets a scratch folder
 * and the lanes' hardening (new pages program, Slice 2b). Since 2026-09-25
 * runCliStep and safeRunCliStep build it themselves, so no step can leave it
 * out, and laneProcessEnv refuses it without a scratch app-data folder.
 */
async function installerRunEnv(acceptanceRoot, stepName) {
  const homeDir = path.join(acceptanceRoot, "home");
  const firstLaunchRoot = path.join(acceptanceRoot, "installer-first-launch");
  return laneProcessEnv(
    await hardenedLaneEnv(),
    {
      HOME: homeDir,
      XDG_CACHE_HOME: path.join(homeDir, ".cache"),
      SSE_APP_DATA_DIR: path.join(firstLaunchRoot, "app-data"),
      SSE_LOG_DIR: path.join(firstLaunchRoot, "logs"),
    },
    { label: `Installer acceptance step '${stepName}' (QtIFW runs the installed app's first-launch check)` }
  );
}

function runInstalledSmoke(installed, acceptanceRoot, runtime, stepName, expectedTarget, env = {}) {
  const stepRoot = path.join(acceptanceRoot, stepName);
  const smokeStatusPath = path.join(stepRoot, "smoke-status.json");
  const homeDir = path.join(acceptanceRoot, "home");

  rmSync(stepRoot, { force: true, recursive: true });
  mkdirSync(stepRoot, { recursive: true });
  mkdirSync(path.join(homeDir, ".cache"), { recursive: true });

  const result = spawnSync(installed.shellPath, installed.commandArgs(smokeStatusPath), {
    cwd: rootDir,
    encoding: "utf8",
    env: laneProcessEnv(
      {
        HOME: homeDir,
        XDG_CACHE_HOME: path.join(homeDir, ".cache"),
        ...env,
      },
      {
        SSE_APP_DATA_DIR: runtime.appDataDir,
        SSE_LOG_DIR: runtime.logsDir,
      },
      { label: `Installed ${installed.label} acceptance step '${stepName}'` }
    ),
  });

  writeFileSync(path.join(stepRoot, "stdout.log"), result.stdout ?? "", "utf8");
  writeFileSync(path.join(stepRoot, "stderr.log"), result.stderr ?? "", "utf8");

  emitCapturedOutput(result.stdout, result.stderr, {
    patterns: qtFontAliasWarningPatterns,
    summaryLabel: "Qt font alias warning",
  });

  if (result.error) {
    throw result.error;
  }

  const exitCode = result.status ?? 1;
  if (exitCode !== 0) {
    throw new Error(`Installed ${installed.label} acceptance step '${stepName}' exited with code ${exitCode}.`);
  }

  const smokeStatus = readSmokeStatus(smokeStatusPath);
  if (!smokeStatus) {
    throw new Error(`Installed ${installed.label} acceptance step '${stepName}' did not write ${smokeStatusPath}.`);
  }

  assert(smokeStatus.finished, `Installed ${installed.label} acceptance step '${stepName}' did not finish cleanly.`);
  assert(
    smokeStatus.exitCode === 0,
    `Installed ${installed.label} acceptance step '${stepName}' recorded exit code ${smokeStatus.exitCode}.`
  );
  assert(
    smokeStatus.targetSurface === expectedTarget,
    `Installed ${installed.label} acceptance step '${stepName}' reached '${smokeStatus.targetSurface}' instead of '${expectedTarget}'.`
  );
  if (installed.requiresOperatorUiReady) {
    assert(
      smokeStatus.operatorUiReady,
      `Installed ${installed.label} acceptance step '${stepName}' never reported the operator UI as ready.`
    );
  }
  assert(
    normalizeForOutputComparison(smokeStatus.startedEnginePath ?? "") ===
      normalizeForOutputComparison(installed.enginePath),
    `Installed ${installed.label} acceptance step '${stepName}' launched '${smokeStatus.startedEnginePath}' instead of '${installed.enginePath}'.`
  );
  assert(
    normalizeForOutputComparison(smokeStatus.appDataPath ?? "") === normalizeForOutputComparison(runtime.appDataDir),
    `Installed ${installed.label} acceptance step '${stepName}' used app data '${smokeStatus.appDataPath}' instead of '${runtime.appDataDir}'.`
  );
}

function assertInstallTimeSmokePassed(installRoot, runtimeKind, phase) {
  if (effectiveInstalledRuntime(runtimeKind) !== "tauri") {
    return;
  }

  const smokeStatusPath = path.join(installRoot, "install-tauri-smoke.json");
  const smokeStatus = readSmokeStatus(smokeStatusPath);
  assert(smokeStatus, `Tauri install-time smoke for '${phase}' did not write ${smokeStatusPath}.`);
  assert(smokeStatus.finished, `Tauri install-time smoke for '${phase}' did not finish cleanly.`);
  assert(
    smokeStatus.exitCode === 0,
    `Tauri install-time smoke for '${phase}' recorded exit code ${smokeStatus.exitCode}.`
  );
  assert(
    smokeStatus.startedEnginePath,
    `Tauri install-time smoke for '${phase}' did not record the bundled engine path.`
  );
}

function cleanupInstallRootAfterPurge(target, installRoot, acceptanceRoot) {
  if (!existsSync(installRoot)) {
    return;
  }

  const remainingEntries = readdirSync(installRoot, { withFileTypes: true }).map((entry) => ({
    name: entry.name,
    kind: entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other",
  }));

  if (remainingEntries.length === 0) {
    rmSync(installRoot, { force: true, recursive: true });
    return;
  }

  const inventoryPath = path.join(acceptanceRoot, "post-purge-install-root.json");
  writeFileSync(inventoryPath, JSON.stringify({ target, remainingEntries }, null, 2), "utf8");
  console.log(
    `Installer acceptance cleanup: ${target} purge left ${remainingEntries.length} entr${
      remainingEntries.length === 1 ? "y" : "ies"
    } under ${installRoot}. Removing the target root before reinstall.`
  );
  rmSync(installRoot, { force: true, recursive: true });
}

function findUninstallKeysUnderInstallRoot(installRoot) {
  const installRootNormalized = path
    .resolve(installRoot)
    .replace(/[\\/]+$/, "")
    .toLowerCase();
  const hives = [
    "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    "HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
  ];

  const matches = [];

  for (const hive of hives) {
    const list = spawnSync("reg.exe", ["query", hive], { encoding: "utf8" });
    if ((list.status ?? 1) !== 0 || !list.stdout) {
      continue;
    }

    const subkeys = list.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^HKEY_(?:LOCAL_MACHINE|CURRENT_USER)\\/i.test(line));

    for (const subkey of subkeys) {
      const valueResult = spawnSync("reg.exe", ["query", subkey, "/v", "InstallLocation"], { encoding: "utf8" });
      if ((valueResult.status ?? 1) !== 0 || !valueResult.stdout) {
        continue;
      }

      const valueLine = valueResult.stdout.split(/\r?\n/).find((line) => /\s+InstallLocation\s+REG_/i.test(line));
      if (!valueLine) {
        continue;
      }

      const valueMatch = valueLine.match(/REG_(?:SZ|EXPAND_SZ)\s+(.*\S)/);
      if (!valueMatch) {
        continue;
      }

      const installLocation = valueMatch[1].trim();
      const installLocationNormalized = installLocation.replace(/[\\/]+$/, "").toLowerCase();

      if (
        installLocationNormalized === installRootNormalized ||
        installLocationNormalized.startsWith(`${installRootNormalized}\\`)
      ) {
        matches.push({ subkey, installLocation });
      }
    }
  }

  return matches;
}

function deleteUninstallKeysUnderInstallRoot(installRoot) {
  const matches = findUninstallKeysUnderInstallRoot(installRoot);
  return matches.map(({ subkey, installLocation }) => {
    const result = spawnSync("reg.exe", ["delete", subkey, "/f"], { encoding: "utf8" });
    const exitCode = result.status ?? 1;
    return {
      subkey,
      installLocation,
      ok: exitCode === 0,
      exitCode,
      stderr: result.stderr ?? "",
    };
  });
}

async function teardownAcceptanceInstall({ target, installRoot, acceptanceRoot, stepName }) {
  const summary = {
    installRoot,
    purge: { attempted: false, ok: false, toolPath: null, error: null },
    fallback: { attempted: false, removed: [] },
    orphansBefore: [],
    orphansAfter: [],
    clean: true,
    error: null,
  };

  if (!existsSync(installRoot)) {
    return summary;
  }

  summary.orphansBefore = findUninstallKeysUnderInstallRoot(installRoot);

  let toolPath = null;
  try {
    toolPath = resolveMaintenanceToolPath(installRoot);
  } catch (error) {
    summary.purge.error = error instanceof Error ? error.message : String(error);
    summary.purge.installRootContents = readdirSync(installRoot, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      kind: entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other",
    }));
    console.warn(
      `Installer acceptance teardown: maintenance tool not found at ${installRoot}. Install-root contents: ${
        summary.purge.installRootContents.map((entry) => `${entry.name} (${entry.kind})`).join(", ") || "<empty>"
      }. Falling back to direct registry cleanup.`
    );
  }

  if (toolPath) {
    summary.purge.toolPath = toolPath;
    summary.purge.attempted = true;
    const purgeResult = await safeRunCliStep(
      toolPath,
      ["--verbose", "--default-answer", "--confirm-command", "purge"],
      acceptanceRoot,
      stepName
    );
    summary.purge.ok = purgeResult.ok;
    if (!purgeResult.ok) {
      summary.purge.error = purgeResult.error;
      console.warn(
        `Installer acceptance teardown: maintenance-tool purge at ${toolPath} failed (${purgeResult.error}). Falling back to direct registry cleanup.`
      );
    }
  }

  const purgeLeftOrphans = findUninstallKeysUnderInstallRoot(installRoot).length > 0;

  if (!summary.purge.ok || purgeLeftOrphans) {
    summary.fallback.attempted = true;
    summary.fallback.removed = deleteUninstallKeysUnderInstallRoot(installRoot);
    if (summary.fallback.removed.length > 0) {
      console.log(
        `Installer acceptance teardown: removed ${summary.fallback.removed.length} orphaned Uninstall registry entr${
          summary.fallback.removed.length === 1 ? "y" : "ies"
        } via reg delete fallback.`
      );
    }
  }

  cleanupInstallRootAfterPurge(target, installRoot, acceptanceRoot);

  summary.orphansAfter = findUninstallKeysUnderInstallRoot(installRoot);
  summary.clean = summary.orphansAfter.length === 0;
  if (!summary.clean) {
    summary.error =
      `${summary.orphansAfter.length} orphaned Uninstall registry entr${
        summary.orphansAfter.length === 1 ? "y" : "ies"
      } remain referencing ${installRoot} after teardown:\n` +
      summary.orphansAfter.map((entry) => `  ${entry.subkey} (InstallLocation: ${entry.installLocation})`).join("\n");
  }

  return summary;
}

function resolveAcceptanceRoot(explicitRoot, target) {
  if (explicitRoot) {
    return explicitRoot;
  }

  // QtIFW rejects install roots that contain '~', which can appear in Windows temp paths.
  return path.join(rootDir, "release", "native-installer-acceptance", target);
}

async function main() {
  const target = parseTarget(readFlag("--target"));
  const runtimeKind = parseRuntime(readFlag("--runtime"));
  if (process.platform !== "win32") {
    throw new Error(`native-installer-acceptance.mjs target '${target}' must run on a matching host platform.`);
  }

  const installerExecutable = resolveInstallerExecutable(runtimeKind);
  const repositoryPath = resolveRepositoryPath(target, runtimeKind);

  assert(
    existsSync(installerExecutable),
    `${runtimeKind === "tauri" ? "Tauri candidate" : "Native"} ${target} installer artifact not found at ${installerExecutable}. Run the matching ${runtimeKind === "tauri" ? "tauri" : "native"}:installer:*:local command first.`
  );
  assert(
    existsSync(repositoryPath),
    `${runtimeKind === "tauri" ? "Tauri candidate" : "Native"} ${target} update repository not found at ${repositoryPath}. Run the matching ${runtimeKind === "tauri" ? "tauri" : "native"}:update-repo:*:local command first.`
  );

  const explicitRoot = resolvePathFromRoot(rootDir, process.env.SSE_NATIVE_INSTALLER_ACCEPTANCE_DIR);
  const acceptanceRoot = resolveAcceptanceRoot(explicitRoot, target);
  const stalePrePurgeRoot = path.join(acceptanceRoot, "install-root");
  if (existsSync(stalePrePurgeRoot)) {
    console.log(
      `Installer acceptance pre-purge: detected stale install at ${stalePrePurgeRoot}; purging maintenance-tool registry before recreating acceptance root.`
    );
    const prePurge = await teardownAcceptanceInstall({
      target,
      installRoot: stalePrePurgeRoot,
      acceptanceRoot,
      stepName: "maintenancetool-pre-purge",
    });
    if (!prePurge.clean) {
      console.warn(
        `Installer acceptance pre-purge: ${prePurge.error ?? "registry orphans persisted"}. The rmSync below will still remove the on-disk install root.`
      );
    }
  }
  rmSync(acceptanceRoot, { force: true, recursive: true });
  mkdirSync(acceptanceRoot, { recursive: true });

  const installRoot = path.join(acceptanceRoot, "install-root");
  const runtime = {
    appDataDir: path.join(acceptanceRoot, "runtime", "app-data"),
    logsDir: path.join(acceptanceRoot, "runtime", "logs"),
  };
  mkdirSync(runtime.appDataDir, { recursive: true });
  mkdirSync(runtime.logsDir, { recursive: true });

  console.log(`${runtimeKind === "tauri" ? "Tauri candidate" : "Native"} installer acceptance root: ${acceptanceRoot}`);

  let teardown;
  let mainError = null;
  let sentinel;
  try {
    console.log(SAVED_DATA_MARKER_CHANGED);
    console.log("Step 1: install the actual offline installer into a clean target root.");

    await runCliStep(
      installerExecutable,
      ["--verbose", "--root", installRoot, "--accept-licenses", "--default-answer", "--confirm-command", "install"],
      acceptanceRoot,
      "installer-install"
    );
    probeInstallRootAfterInstall(installRoot, "Step 1 install");
    assertInstallTimeSmokePassed(installRoot, runtimeKind, "install");

    let installed = resolveInstalledRuntime(target, installRoot, runtimeKind);
    assert(existsSync(installed.payloadPath), `Installed payload missing at ${installed.payloadPath}.`);
    assert(existsSync(installed.shellPath), `Installed shell missing at ${installed.shellPath}.`);
    assert(existsSync(installed.enginePath), `Installed engine missing at ${installed.enginePath}.`);

    console.log(
      "Step 2: start the installed shell on fresh saved data, save the page it opens on, publish the setup and persist a continuity sentinel (a lighting group)."
    );
    runInstalledSmoke(
      installed,
      acceptanceRoot,
      runtime,
      "installed-first-launch",
      "commissioning",
      await hardenedLaneEnv()
    );

    const firstRun = new EngineHarness({
      rootDir,
      appDataDir: runtime.appDataDir,
      logsDir: runtime.logsDir,
      engineExecutable: installed.enginePath,
      env: await hardenedLaneEnv(),
    });

    try {
      await firstRun.start();
      await assertSafeBundledSqlite(firstRun, "installer-installed", `Installed ${installed.label} engine`);

      const initialAppSnapshot = await firstRun.request("installer-app-installed", "app.snapshot");

      assert(
        initialAppSnapshot.startup?.targetSurface === "commissioning",
        `Expected installer acceptance's fresh saved data to start in commissioning, got '${initialAppSnapshot.startup?.targetSurface}'.`
      );
      // The page is seeded through the app's own request: new saved data
      // opens on the Console, and Lighting is saved instead.
      await seedSavedWorkspace(firstRun, "installer-installed", `Installed ${installed.label} engine`);

      // No hardware on this host: the explicit probe override (2026-09 audit
      // Slice 8), without which a fresh hardware link refuses the publish.
      await publishWithOverride(firstRun, "installer-installed", `Installed ${installed.label} engine`);

      sentinel = await createContinuitySentinel(
        firstRun,
        "installer-installed",
        sentinelGroupName,
        `Installed ${installed.label} engine`
      );
      await assertContinuitySentinel(
        firstRun,
        "installer-installed",
        sentinel,
        `Installed ${installed.label} engine`,
        "after the sentinel was created"
      );
    } finally {
      await firstRun.close().catch((error) => {
        throw error;
      });
    }

    console.log("Step 3: verify the installed maintenance tool can see the installed package and staged repository.");
    const maintenanceToolPath = resolveMaintenanceToolPath(installRoot);
    const repositoryUri = pathToFileURL(repositoryPath).href;

    const installedPackages = await runCliStep(
      maintenanceToolPath,
      ["--verbose", "list"],
      acceptanceRoot,
      "maintenancetool-list"
    );
    assert(
      installedPackages.stdout.includes(releaseIdentity.packageId),
      `Expected maintenance tool list output to include ${releaseIdentity.packageId}.`
    );

    const repositorySearch = await runCliStep(
      maintenanceToolPath,
      ["--verbose", "--set-temp-repository", repositoryUri, "--type", "package", "search", releaseIdentity.packageId],
      acceptanceRoot,
      "maintenancetool-search"
    );
    assert(
      repositorySearch.stdout.includes(releaseIdentity.packageId),
      `Expected maintenance tool search output to include ${releaseIdentity.packageId}.`
    );

    console.log("Step 4: purge the installed program directory through the maintenance tool and reinstall it.");
    await runCliStep(
      maintenanceToolPath,
      ["--verbose", "--default-answer", "--confirm-command", "purge"],
      acceptanceRoot,
      "maintenancetool-purge"
    );

    assert(
      !existsSync(installed.payloadPath),
      `Expected purge to remove ${installed.payloadPath}, but it still exists.`
    );
    cleanupInstallRootAfterPurge(target, installRoot, acceptanceRoot);

    await runCliStep(
      installerExecutable,
      ["--verbose", "--root", installRoot, "--accept-licenses", "--default-answer", "--confirm-command", "install"],
      acceptanceRoot,
      "installer-reinstall"
    );
    probeInstallRootAfterInstall(installRoot, "Step 4 reinstall");
    assertInstallTimeSmokePassed(installRoot, runtimeKind, "reinstall");

    installed = resolveInstalledRuntime(target, installRoot, runtimeKind);
    assert(existsSync(installed.payloadPath), `Reinstalled payload missing at ${installed.payloadPath}.`);
    assert(existsSync(installed.shellPath), `Reinstalled shell missing at ${installed.shellPath}.`);
    assert(existsSync(installed.enginePath), `Reinstalled engine missing at ${installed.enginePath}.`);

    console.log("Step 5: relaunch the reinstalled application and verify operator state survived the reinstall.");
    runInstalledSmoke(installed, acceptanceRoot, runtime, "installed-relaunch", "dashboard", await hardenedLaneEnv());

    const secondRun = new EngineHarness({
      rootDir,
      appDataDir: runtime.appDataDir,
      logsDir: runtime.logsDir,
      engineExecutable: installed.enginePath,
      env: await hardenedLaneEnv(),
    });

    try {
      await secondRun.start();
      await assertSafeBundledSqlite(secondRun, "installer-reinstalled", `Reinstalled ${installed.label} engine`);

      const reinstalledAppSnapshot = await secondRun.request("installer-app-reinstalled", "app.snapshot");

      assert(
        reinstalledAppSnapshot.startup?.targetSurface === "dashboard",
        `Expected reinstalled runtime to route to dashboard, got '${reinstalledAppSnapshot.startup?.targetSurface}'.`
      );
      assert(
        reinstalledAppSnapshot.commissioning?.stage === "ready",
        `Expected commissioning stage to remain ready after reinstall, got '${reinstalledAppSnapshot.commissioning?.stage}'.`
      );
      assertSavedWorkspace(
        reinstalledAppSnapshot,
        SEEDED_WORKSPACE,
        `Reinstalled ${installed.label} engine`,
        "after the reinstall"
      );
      await assertContinuitySentinel(
        secondRun,
        "installer-reinstalled",
        sentinel,
        `Reinstalled ${installed.label} engine`,
        "after the reinstall"
      );

      const backupExport = await secondRun.request("installer-support-backup-export", "support.backup.export");
      assert(
        backupExport.path && existsSync(backupExport.path),
        "Expected installer acceptance backup export to succeed."
      );
    } finally {
      await secondRun.close().catch((error) => {
        throw error;
      });
    }

    console.log(
      `${runtimeKind === "tauri" ? "Tauri candidate" : "Native"} installer acceptance passed: real installer install, purge, and reinstall preserve operator data.`
    );
  } catch (error) {
    mainError = error;
  } finally {
    teardown = await teardownAcceptanceInstall({
      target,
      installRoot,
      acceptanceRoot,
      stepName: "maintenancetool-final-purge",
    });
  }

  if (mainError) {
    if (teardown && !teardown.clean) {
      console.error(`Installer acceptance teardown also failed: ${teardown.error}`);
    }
    throw mainError;
  }

  if (!teardown.clean) {
    throw new Error(teardown.error);
  }

  console.log(
    `Installer acceptance final teardown: maintenance-tool purge ${
      teardown.purge.attempted
        ? teardown.purge.ok
          ? "succeeded"
          : `failed (${teardown.purge.error})`
        : "skipped (tool unavailable)"
    }; ${teardown.orphansBefore.length} Uninstall registry entr${
      teardown.orphansBefore.length === 1 ? "y" : "ies"
    } cleaned, ${teardown.fallback.attempted ? `${teardown.fallback.removed.length} via reg-delete fallback, ` : ""}0 orphans remain.`
  );
}

// Runs only as `node scripts/native-installer-acceptance.mjs …`: an import
// does nothing (2026-09-25). The two paths are compared as real paths —
// through a directory junction or a short 8.3 name, `process.argv[1]` and
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
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
