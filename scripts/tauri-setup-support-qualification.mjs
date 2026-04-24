import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const devServerPort = 4173;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function createRuntimeDirs(prefix) {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  const appDataDir = path.join(root, "app-data");
  const logsDir = path.join(root, "logs");
  const updateRepoDir = path.join(root, "update-repository");
  const diagnosticsDir = path.join(root, "diagnostics");

  mkdirSync(appDataDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });
  mkdirSync(updateRepoDir, { recursive: true });
  mkdirSync(diagnosticsDir, { recursive: true });

  return {
    appDataDir,
    cleanup() {
      rmSync(root, { force: true, recursive: true });
    },
    diagnosticsDir,
    logsDir,
    root,
    updateRepoDir,
  };
}

async function assertTcpPortAvailable(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error) => {
      reject(
        new Error(
          `Tauri Setup/Support qualification requires 127.0.0.1:${port}, but the port preflight failed (${error.code ?? "unknown"}: ${error.message}). Stop the stale dev/preview server and rerun.`
        )
      );
    });
    server.listen(port, "127.0.0.1", () => {
      server.close(resolve);
    });
  });
}

function createBlockedRuntimeDirs(prefix) {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  const blockedPath = path.join(root, "blocked-runtime");
  closeSync(openSync(blockedPath, "w"));

  return {
    appDataDir: blockedPath,
    cleanup() {
      rmSync(root, { force: true, recursive: true });
    },
    logsDir: path.join(blockedPath, "logs"),
    root,
  };
}

function createSessionFiles(prefix) {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  return {
    cleanup() {
      rmSync(root, { force: true, recursive: true });
    },
    commandPath: path.join(root, "command.json"),
    root,
    statusPath: path.join(root, "status.json"),
  };
}

function readJson(pathname) {
  if (!existsSync(pathname)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(pathname, "utf8"));
  } catch {
    return null;
  }
}

function launchTauriShell({ appDataDir, commandPath, extraEnv = {}, logsDir, statusPath, updateRepoDir }) {
  const child = spawn(npmCommand, ["run", "tauri:dev", "--workspace", "frontend/app"], {
    cwd: rootDir,
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      SSE_APP_DATA_DIR: appDataDir,
      SSE_DISABLE_AUTO_IMPORT: "1",
      SSE_LOG_DIR: logsDir,
      SSE_TAURI_TEST_COMMAND_PATH: commandPath,
      SSE_TAURI_TEST_STATUS_PATH: statusPath,
      SSE_UPDATE_REPOSITORY_PATH: updateRepoDir ?? "",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[tauri-shell stdout] ${chunk}`);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[tauri-shell stderr] ${chunk}`);
  });

  return child;
}

async function waitForStatus({ child, label, predicate, statusPath, timeoutMs = 40_000 }) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = null;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `Tauri shell exited early during '${label}' with code ${child.exitCode}.${lastStatus ? ` Last status: ${JSON.stringify(lastStatus)}` : ""}`
      );
    }

    const status = readJson(statusPath);
    if (status) {
      lastStatus = status;
      if (predicate(status)) {
        return status;
      }
    }

    await delay(100);
  }

  throw new Error(
    `Timed out waiting for '${label}'.${lastStatus ? ` Last status: ${JSON.stringify(lastStatus)}` : ""}`
  );
}

let commandCounter = 0;

async function dispatchCommand(session, child, action, payload = {}) {
  commandCounter += 1;
  const id = `${action}-${commandCounter}`;
  const command = { action, id, ...payload };
  writeFileSync(session.commandPath, JSON.stringify(command, null, 2));

  const status = await waitForStatus({
    child,
    label: `command ${id}`,
    predicate: (value) => value?.testBridge?.lastCommand?.id === id,
    statusPath: session.statusPath,
  });
  const result = status.testBridge.lastCommand;

  assert(result.ok === true, `Shell test command '${id}' failed: ${result.error ?? "unknown error"}`);
  return {
    result: result.result ?? null,
    status,
  };
}

async function closeTauriShell(child) {
  if (child.exitCode !== null) {
    return;
  }

  try {
    if (process.platform === "win32") {
      child.kill("SIGTERM");
    } else if (child.pid) {
      process.kill(-child.pid, "SIGTERM");
    }
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") {
      throw error;
    }
    return;
  }

  const deadline = Date.now() + 5_000;
  while (child.exitCode === null && Date.now() < deadline) {
    await delay(100);
  }

  if (child.exitCode === null) {
    try {
      if (process.platform === "win32") {
        child.kill("SIGKILL");
      } else if (child.pid) {
        process.kill(-child.pid, "SIGKILL");
      }
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") {
        throw error;
      }
    }
    await delay(200);
  }
}

async function runSetupSupportQualification() {
  await assertTcpPortAvailable(devServerPort);

  const runtime = createRuntimeDirs("sse-tauri-setup-support-");
  const firstSession = createSessionFiles("sse-tauri-session-");

  console.log("Tauri Setup/Support qualification: step 1/3 clean startup and support workflow.");

  const firstRun = launchTauriShell({
    appDataDir: runtime.appDataDir,
    commandPath: firstSession.commandPath,
    logsDir: runtime.logsDir,
    statusPath: firstSession.statusPath,
    updateRepoDir: runtime.updateRepoDir,
  });

  try {
    const initialStatus = await waitForStatus({
      child: firstRun,
      label: "initial ready state",
      predicate: (value) => value?.shellState?.lifecycle === "ready",
      statusPath: firstSession.statusPath,
    });

    assert(initialStatus.shellState.activeWorkspace === "setup", "Expected clean Tauri startup to route to Setup.");
    assert(
      initialStatus.shellState.appSnapshot?.startup?.targetSurface === "commissioning",
      `Expected clean Tauri startup targetSurface 'commissioning', got '${initialStatus.shellState.appSnapshot?.startup?.targetSurface}'.`
    );
    assert(
      initialStatus.shellState.appSnapshot?.runtime?.paths?.updateRepositoryPath === runtime.updateRepoDir,
      "Expected update repository path to flow through the live Tauri shell."
    );
    assert(
      initialStatus.shellState.commissioningSnapshot?.runnerStage === "import",
      `Expected clean commissioning runnerStage 'import', got '${initialStatus.shellState.commissioningSnapshot?.runnerStage}'.`
    );

    const supportStatus = await dispatchCommand(firstSession, firstRun, "setSetupSection", {
      section: "support",
    });
    assert(
      supportStatus.status.shellState.appSnapshot?.shell?.setup?.activeSection === "support",
      "Expected support section toggle to persist through the live Tauri shell."
    );

    await dispatchCommand(firstSession, firstRun, "setSetupSection", {
      section: "commissioning",
    });

    const publishStatus = await dispatchCommand(firstSession, firstRun, "updateCommissioning", {
      request: {
        runnerStage: "publish",
        stage: "ready",
      },
    });
    assert(
      publishStatus.status.shellState.appSnapshot?.startup?.targetSurface === "dashboard",
      "Expected commissioning publish to unlock dashboard startup through the live Tauri shell."
    );

    const backupExport = await dispatchCommand(firstSession, firstRun, "exportSupportBackup");
    const backupPath = backupExport.result?.path;
    assert(
      typeof backupPath === "string" && existsSync(backupPath),
      "Expected live Tauri support backup export to create an archive."
    );
    assert(
      backupExport.status.shellState.supportSnapshot?.backupCount >= 1,
      "Expected support snapshot to reflect at least one backup after export."
    );

    const diagnosticsExport = await dispatchCommand(firstSession, firstRun, "exportShellDiagnostics", {
      directory: runtime.diagnosticsDir,
    });
    assert(
      typeof diagnosticsExport.result === "string" && existsSync(diagnosticsExport.result),
      "Expected diagnostics export to write a report through the live Tauri shell."
    );

    const seedStatus = await dispatchCommand(firstSession, firstRun, "seedPlanningDemo", {
      replaceExistingData: true,
    });
    assert(
      seedStatus.status.shellState.commissioningSnapshot?.planningProjectCount === 2,
      "Expected demo seeding to populate two planning projects through the live Tauri shell."
    );
    assert(
      seedStatus.status.shellState.commissioningSnapshot?.planningTaskCount === 3,
      "Expected demo seeding to populate three planning tasks through the live Tauri shell."
    );

    const restoreStatus = await dispatchCommand(firstSession, firstRun, "restoreSupportBackup", {
      path: backupPath,
    });
    assert(
      restoreStatus.result?.sourceFormat === "native-support-backup",
      `Expected restore sourceFormat 'native-support-backup', got '${restoreStatus.result?.sourceFormat}'.`
    );
    assert(
      typeof restoreStatus.result?.rollbackBackupPath === "string" &&
        existsSync(restoreStatus.result.rollbackBackupPath),
      "Expected restore to create a rollback backup archive."
    );
    assert(
      restoreStatus.status.shellState.commissioningSnapshot?.planningProjectCount === 0,
      "Expected restore to return planning project count to the exported baseline."
    );
    assert(
      restoreStatus.status.shellState.commissioningSnapshot?.planningTaskCount === 0,
      "Expected restore to return planning task count to the exported baseline."
    );

    const planningStatus = await dispatchCommand(firstSession, firstRun, "setWorkspace", {
      workspaceId: "planning",
    });
    assert(
      planningStatus.status.shellState.activeWorkspace === "planning",
      "Expected workspace switch to planning to persist through the live Tauri shell."
    );
  } finally {
    await closeTauriShell(firstRun);
    firstSession.cleanup();
  }

  await delay(1_500);
  await assertTcpPortAvailable(devServerPort);

  console.log("Tauri Setup/Support qualification: step 2/3 persisted restart on the same runtime.");

  const secondSession = createSessionFiles("sse-tauri-session-");
  const secondRun = launchTauriShell({
    appDataDir: runtime.appDataDir,
    commandPath: secondSession.commandPath,
    logsDir: runtime.logsDir,
    statusPath: secondSession.statusPath,
    updateRepoDir: runtime.updateRepoDir,
  });

  try {
    const restartStatus = await waitForStatus({
      child: secondRun,
      label: "restart ready state",
      predicate: (value) => value?.shellState?.lifecycle === "ready",
      statusPath: secondSession.statusPath,
    });

    assert(
      restartStatus.shellState.appSnapshot?.startup?.targetSurface === "dashboard",
      "Expected restarted Tauri runtime to keep dashboard startup after publish and restore."
    );
    assert(
      restartStatus.shellState.activeWorkspace === "planning",
      "Expected restarted Tauri runtime to restore the planning workspace."
    );
    assert(
      restartStatus.shellState.supportSnapshot?.backupCount >= 2,
      "Expected restarted Tauri runtime to preserve support backup history."
    );
  } finally {
    await closeTauriShell(secondRun);
    secondSession.cleanup();
    runtime.cleanup();
  }

  await delay(1_500);
  await assertTcpPortAvailable(devServerPort);

  console.log("Tauri Setup/Support qualification: step 3/3 recovery posture for bootstrap failure.");

  const blockedRuntime = createBlockedRuntimeDirs("sse-tauri-bootstrap-failure-");
  const recoverySession = createSessionFiles("sse-tauri-session-");
  const recoveryRun = launchTauriShell({
    appDataDir: blockedRuntime.appDataDir,
    commandPath: recoverySession.commandPath,
    logsDir: blockedRuntime.logsDir,
    statusPath: recoverySession.statusPath,
  });

  try {
    const recoveryStatus = await waitForStatus({
      child: recoveryRun,
      label: "bootstrap recovery state",
      predicate: (value) => value?.shellState?.lifecycle === "failed",
      statusPath: recoverySession.statusPath,
    });

    assert(
      recoveryStatus.shellState.startupFailure?.code === "BOOTSTRAP_FAILED",
      `Expected bootstrap recovery code 'BOOTSTRAP_FAILED', got '${recoveryStatus.shellState.startupFailure?.code}'.`
    );
    assert(
      recoveryStatus.shellState.startupFailure?.stage === "bootstrap",
      `Expected bootstrap recovery stage 'bootstrap', got '${recoveryStatus.shellState.startupFailure?.stage}'.`
    );
  } finally {
    await closeTauriShell(recoveryRun);
    recoverySession.cleanup();
    blockedRuntime.cleanup();
  }
}

await runSetupSupportQualification();
console.log("Tauri Setup/Support qualification passed.");
