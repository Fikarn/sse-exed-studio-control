import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createQualificationEvidence } from "./tauri-qualification-evidence.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const devServerPort = 4173;
const evidence = createQualificationEvidence({ lane: "setup-support", rootDir });

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
    // Windows: npm is npm.cmd, and Node >= 18.20 refuses to spawn .cmd files
    // without a shell (EINVAL, CVE-2024-27980 hardening).
    shell: process.platform === "win32",
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

// Default waitForStatus deadline. `SSE_TAURI_QUALIFICATION_TIMEOUT_MS` lets
// CI extend the window — the operator laptop completes each phase within
// 40s, but ubuntu-latest hardware needs ~3 min for the engine's first
// health snapshot to arrive after the WebKitGTK shell launches under xvfb
// software rendering. The qualification CI job (plan PR 2b) sets this.
const DEFAULT_WAIT_TIMEOUT_MS = Number(process.env.SSE_TAURI_QUALIFICATION_TIMEOUT_MS ?? 40_000);

async function waitForStatus({ child, label, predicate, statusPath, timeoutMs = DEFAULT_WAIT_TIMEOUT_MS }) {
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

// Addresses whose port-80 connect neither answers nor fails promptly: the
// documentation ranges (RFC 5737) and a shared-address-space host (RFC 6598)
// are not routed on the public internet and have no host on a studio LAN or
// a CI network, so the engine's lighting probe sits in its 1.5 s connect
// timeout — the stalled request finding F07 describes. The first candidate
// that stalls for Node stalls for the engine too (same host, same stack).
const UNROUTED_BRIDGE_CANDIDATES = ["203.0.113.113", "198.51.100.113", "192.0.2.113", "100.127.255.113"];
const UNROUTED_PRECHECK_MS = 1_200;
const STALLED_REQUEST_MIN_PROBE_MS = 1_000;
const STALLED_REQUEST_MAX_GAP_MS = 1_000;

function connectStalls(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(true);
    }, timeoutMs);
    const settle = () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(false);
    };
    socket.once("connect", settle);
    socket.once("error", settle);
  });
}

async function pickUnroutedBridgeAddress() {
  for (const host of UNROUTED_BRIDGE_CANDIDATES) {
    if (await connectStalls(host, 80, UNROUTED_PRECHECK_MS)) {
      return host;
    }
  }
  throw new Error(
    `The stalled-request check needs an address whose port-80 connect neither answers nor fails within ${UNROUTED_PRECHECK_MS} ms; none of ${UNROUTED_BRIDGE_CANDIDATES.join(", ")} stalls on this host.`
  );
}

// Finding F07 (2026-09 production readiness, Slice 4): a request the engine
// takes seconds to answer must not stall the shell. The lighting probe
// against an unrouted address sits in the engine's 1.5 s connect timeout;
// while it does, the test bridge's 250 ms heartbeat must keep reaching the
// status file. Every heartbeat is an IPC call the shell answers on its main
// thread, so a main thread blocked on the engine's reply — the shell before
// this slice — freezes the file for the whole stall.
async function runStalledRequestCheck(session, child, bridgeIp) {
  commandCounter += 1;
  const id = `runCommissioningCheck-${commandCounter}`;
  const startedAt = Date.now();
  writeFileSync(
    session.commandPath,
    JSON.stringify(
      { action: "runCommissioningCheck", id, request: { bridgeIp, target: "lighting", universe: 1 } },
      null,
      2
    )
  );

  const heartbeats = [];
  let lastHeartbeat = null;
  let finalStatus = null;
  const deadline = Date.now() + DEFAULT_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Tauri shell exited early during the stalled-request check with code ${child.exitCode}.`);
    }
    const status = readJson(session.statusPath);
    if (status) {
      const heartbeat = status.testBridge?.heartbeat;
      if (typeof heartbeat === "number" && heartbeat !== lastHeartbeat) {
        lastHeartbeat = heartbeat;
        heartbeats.push({ at: Date.now(), heartbeat });
      }
      if (status.testBridge?.lastCommand?.id === id) {
        finalStatus = status;
        break;
      }
    }
    await delay(50);
  }
  const finishedAt = Date.now();
  assert(finalStatus, `Timed out waiting for the stalled lighting probe '${id}' to finish.`);
  const result = finalStatus.testBridge.lastCommand;
  assert(result.ok === true, `Shell test command '${id}' failed: ${result.error ?? "unknown error"}`);

  const probeMs = finishedAt - startedAt;
  const checks = finalStatus.shellState.commissioningSnapshot?.checks;
  const lightingCheck = (Array.isArray(checks) ? checks : []).find((check) => check?.id === "lighting");
  assert(
    lightingCheck?.status === "failed",
    `Expected the lighting probe against ${bridgeIp} to fail as unreachable, got '${lightingCheck?.status}'.`
  );
  assert(
    probeMs >= STALLED_REQUEST_MIN_PROBE_MS,
    `Expected the lighting probe against ${bridgeIp} to sit in the engine's 1.5 s connect timeout, but it answered in ${probeMs} ms, so the check cannot prove anything on this network.`
  );

  const ticks = heartbeats.filter((tick) => tick.at > startedAt && tick.at < finishedAt);
  const instants = [startedAt, ...ticks.map((tick) => tick.at), finishedAt];
  let maxGapMs = 0;
  for (let index = 1; index < instants.length; index += 1) {
    maxGapMs = Math.max(maxGapMs, instants[index] - instants[index - 1]);
  }
  assert(
    ticks.length >= 2,
    `Expected the shell's status file to keep updating while the lighting probe stalled for ${probeMs} ms, but only ${ticks.length} heartbeat(s) landed.`
  );
  assert(
    maxGapMs < STALLED_REQUEST_MAX_GAP_MS,
    `The shell's status file stopped updating for ${maxGapMs} ms while a ${probeMs} ms lighting probe was in flight; a stalled engine reply must not block the shell.`
  );
  return { heartbeats: ticks.length, maxGapMs, probeMs };
}

// Scenario `engine-crash` (2026-09 production readiness, Slice 5 — finding
// F09): the shell must notice a dead engine within two seconds, and a second
// copy of the shell (`second-instance`, finding F19) must be refused within
// five.
const ENGINE_CRASH_DETECT_MS = 2_000;
// On Windows and macOS the single-instance plugin refuses the second copy
// before its window exists — within 5 s (113 ms on the workstation). On
// Linux the second copy first goes through GTK's start-up, which under xvfb
// waits about 30 s on the AT-SPI bus lookup before any Tauri plugin runs
// (the first CI run of Slice 5 saw the refusal land after ~30 s), so its
// bound is the lane's wait timeout; and a Linux session without a D-Bus
// session bus refuses through the engine lock instead, which shows in the
// second shell's own status file. Whichever refusal comes first counts.
const SECOND_INSTANCE_EXIT_MS = process.platform === "linux" ? DEFAULT_WAIT_TIMEOUT_MS : 5_000;

// Ends the engine process from outside the shell — what a crash looks like
// to it. The engine has no children of its own, so no tree kill.
function killEngineProcess(pid) {
  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/PID", String(pid), "/F"], { encoding: "utf8" });
    assert(result.status === 0, `taskkill /PID ${pid} /F failed: ${result.stderr || result.stdout}`);
    return;
  }
  process.kill(pid, "SIGKILL");
}

function debugShellBinaryPath() {
  const binaryName = process.platform === "win32" ? "sse-exed-tauri-shell.exe" : "sse-exed-tauri-shell";
  return path.join(rootDir, "native", "target", "debug", binaryName);
}

// A second copy of the shell, launched as the debug binary the first
// `tauri dev` run compiled: it loads the same devUrl, which the first run's
// Vite serves. `tauri dev` itself cannot be the second copy — its Vite
// would refuse port 4173 before the shell ever ran, proving nothing about
// the shell.
function launchSecondShellInstance({ appDataDir, commandPath, logsDir, statusPath, updateRepoDir }) {
  const binaryPath = debugShellBinaryPath();
  assert(existsSync(binaryPath), `Expected the debug shell binary at ${binaryPath} after the first tauri dev run.`);
  const child = spawn(binaryPath, [], {
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
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[second-shell stdout] ${chunk}`);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[second-shell stderr] ${chunk}`);
  });

  return child;
}

function killWindowsProcessTree(pid) {
  if (!pid) {
    return;
  }
  spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
}

async function closeTauriShell(child) {
  if (child.exitCode !== null) {
    return;
  }

  try {
    if (process.platform === "win32") {
      // npm.cmd -> node -> tauri.js -> vite + cargo -> shell: killing only the
      // npm parent leaves vite holding the dev port and the shell alive, and
      // the next step's port preflight then fails. Kill the whole tree.
      killWindowsProcessTree(child.pid);
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
        killWindowsProcessTree(child.pid);
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

  console.log("Tauri Setup/Support qualification: step 1/6 clean startup and support workflow.");

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
    evidence.recordCheck("clean-startup-routes-to-commissioning", {
      activeWorkspace: initialStatus.shellState.activeWorkspace,
      targetSurface: initialStatus.shellState.appSnapshot?.startup?.targetSurface,
    });

    const supportStatus = await dispatchCommand(firstSession, firstRun, "setSetupSection", {
      section: "support",
    });
    assert(
      supportStatus.status.shellState.appSnapshot?.shell?.setup?.activeSection === "support",
      "Expected support section toggle to persist through the live Tauri shell."
    );
    evidence.recordCheck("support-section-toggle-persists", {
      activeSection: supportStatus.status.shellState.appSnapshot?.shell?.setup?.activeSection,
    });

    await dispatchCommand(firstSession, firstRun, "setSetupSection", {
      section: "commissioning",
    });

    // Finding F07 (2026-09 production readiness, Slice 4): the shell stays
    // responsive while the engine sits in a stalled lighting probe.
    const unroutedBridgeIp = await pickUnroutedBridgeAddress();
    const stalledRequest = await runStalledRequestCheck(firstSession, firstRun, unroutedBridgeIp);
    evidence.recordCheck("shell-stays-responsive-during-stalled-request", {
      bridgeIp: unroutedBridgeIp,
      ...stalledRequest,
    });
    // The probe persisted the unrouted address as the lighting bridge; point
    // the bridge back at loopback so nothing streams off this host afterwards
    // (nothing listens on 127.0.0.1:80, and a refused connect counts as a
    // reachable host for the probe).
    await dispatchCommand(firstSession, firstRun, "runCommissioningCheck", {
      request: {
        bridgeIp: "127.0.0.1",
        target: "lighting",
        universe: 1,
      },
    });

    // No hardware on this host: explicit probe override (2026-09 audit Slice 8).
    const publishStatus = await dispatchCommand(firstSession, firstRun, "updateCommissioning", {
      request: {
        runnerStage: "publish",
        stage: "ready",
        overrideProbes: true,
      },
    });
    assert(
      publishStatus.status.shellState.appSnapshot?.startup?.targetSurface === "dashboard",
      "Expected commissioning publish to unlock dashboard startup through the live Tauri shell."
    );
    evidence.recordCheck("commissioning-publish-unlocks-dashboard", {
      targetSurface: publishStatus.status.shellState.appSnapshot?.startup?.targetSurface,
    });

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
    evidence.recordCheck("backup-export-creates-archive", {
      backupCount: backupExport.status.shellState.supportSnapshot?.backupCount,
    });

    // A directory of the lane's own reaches the shell through the test-bridge
    // command `shell_test_bridge_export_diagnostics_to`; the production
    // command takes no directory (2026-09 production readiness, Slice 4).
    const diagnosticsExport = await dispatchCommand(firstSession, firstRun, "exportShellDiagnostics", {
      directory: runtime.diagnosticsDir,
    });
    assert(
      typeof diagnosticsExport.result === "string" && existsSync(diagnosticsExport.result),
      "Expected diagnostics export to write a report through the live Tauri shell."
    );
    evidence.recordCheck("diagnostics-export-writes-report");

    // Finding F15: without a directory of the lane's own, the export lands in
    // the app-data `exports` folder and nowhere else.
    const defaultDiagnosticsExport = await dispatchCommand(firstSession, firstRun, "exportShellDiagnostics");
    const defaultDiagnosticsPath = defaultDiagnosticsExport.result;
    assert(
      typeof defaultDiagnosticsPath === "string" && existsSync(defaultDiagnosticsPath),
      "Expected the default diagnostics export to write a report through the live Tauri shell."
    );
    const expectedExportsDir = path.join(runtime.appDataDir, "exports");
    assert(
      path.dirname(defaultDiagnosticsPath) === expectedExportsDir,
      `Expected the default diagnostics export under ${expectedExportsDir}, got ${defaultDiagnosticsPath}.`
    );
    assert(
      /^diagnostics-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/.test(path.basename(defaultDiagnosticsPath)),
      `Expected a diagnostics-<UTC timestamp>.json name, got ${path.basename(defaultDiagnosticsPath)}.`
    );
    evidence.recordCheck("diagnostics-export-defaults-to-app-data-exports", {
      file: path.basename(defaultDiagnosticsPath),
    });

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
    evidence.recordCheck("backup-restore-round-trips-native-support-backup", {
      sourceFormat: restoreStatus.result?.sourceFormat,
    });

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

  console.log("Tauri Setup/Support qualification: step 2/6 persisted restart on the same runtime.");

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
    evidence.recordCheck("persisted-restart-restores-dashboard-state", {
      activeWorkspace: restartStatus.shellState.activeWorkspace,
      targetSurface: restartStatus.shellState.appSnapshot?.startup?.targetSurface,
    });
  } finally {
    await closeTauriShell(secondRun);
    secondSession.cleanup();
    runtime.cleanup();
  }

  await delay(1_500);
  await assertTcpPortAvailable(devServerPort);

  console.log("Tauri Setup/Support qualification: step 3/6 recovery posture for bootstrap failure.");

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
    evidence.recordCheck("bootstrap-failure-remains-operator-visible", {
      code: recoveryStatus.shellState.startupFailure?.code,
      stage: recoveryStatus.shellState.startupFailure?.stage,
    });
  } finally {
    await closeTauriShell(recoveryRun);
    recoverySession.cleanup();
    blockedRuntime.cleanup();
  }

  await delay(1_500);
  await assertTcpPortAvailable(devServerPort);

  // Scenario `corrupt-db` (2026-09 production readiness, Slice 3 — F02): junk
  // where the database should be reaches the recovery surface as
  // STORAGE_CORRUPT, the engine's sentence names a backup, and the damaged
  // file is left exactly as it was — nothing migrates or overwrites it.
  console.log("Tauri Setup/Support qualification: step 4/6 recovery posture for a corrupt database.");

  const corruptRuntime = createRuntimeDirs("sse-tauri-corrupt-db-");
  const corruptDbPath = path.join(corruptRuntime.appDataDir, "studio-control.sqlite3");
  const junk = Buffer.from("this is not a database\n".repeat(400), "utf8");
  writeFileSync(corruptDbPath, junk);
  const corruptSession = createSessionFiles("sse-tauri-session-");
  const corruptRun = launchTauriShell({
    appDataDir: corruptRuntime.appDataDir,
    commandPath: corruptSession.commandPath,
    logsDir: corruptRuntime.logsDir,
    statusPath: corruptSession.statusPath,
    updateRepoDir: corruptRuntime.updateRepoDir,
  });

  try {
    const corruptStatus = await waitForStatus({
      child: corruptRun,
      label: "corrupt database recovery state",
      predicate: (value) => value?.shellState?.lifecycle === "failed",
      statusPath: corruptSession.statusPath,
    });
    const failure = corruptStatus.shellState.startupFailure;

    assert(
      failure?.code === "STORAGE_CORRUPT",
      `Expected corrupt database recovery code 'STORAGE_CORRUPT', got '${failure?.code}'.`
    );
    assert(
      failure?.stage === "bootstrap",
      `Expected corrupt database recovery stage 'bootstrap', got '${failure?.stage}'.`
    );
    assert(
      typeof failure?.message === "string" && failure.message.includes("backup"),
      `Expected the corrupt database sentence to name a backup, got '${failure?.message}'.`
    );
    assert(
      existsSync(corruptDbPath) && readFileSync(corruptDbPath).equals(junk),
      "Expected the damaged database file to be left exactly as it was."
    );
    evidence.recordCheck("corrupt-db-reaches-recovery-surface", {
      code: failure?.code,
      stage: failure?.stage,
    });
  } finally {
    await closeTauriShell(corruptRun);
    corruptSession.cleanup();
    corruptRuntime.cleanup();
  }

  await delay(1_500);
  await assertTcpPortAvailable(devServerPort);

  // Scenario `engine-crash` (2026-09 production readiness, Slice 5 — F09):
  // the engine process is ended from outside. The shell notices within two
  // seconds, the recovery surface reads ENGINE_EXITED with the automatic
  // restart announced, and the engine is restarted on its own — a new
  // process, the next launch number, the dashboard back.
  console.log(
    "Tauri Setup/Support qualification: step 5/6 an engine ended from outside reaches recovery and restarts on its own."
  );

  const crashRuntime = createRuntimeDirs("sse-tauri-engine-crash-");
  const crashSession = createSessionFiles("sse-tauri-session-");
  const crashRun = launchTauriShell({
    appDataDir: crashRuntime.appDataDir,
    commandPath: crashSession.commandPath,
    logsDir: crashRuntime.logsDir,
    statusPath: crashSession.statusPath,
    updateRepoDir: crashRuntime.updateRepoDir,
  });

  try {
    const readyStatus = await waitForStatus({
      child: crashRun,
      label: "engine-crash ready state",
      predicate: (value) =>
        value?.shellState?.lifecycle === "ready" && typeof value?.testBridge?.enginePid === "number",
      statusPath: crashSession.statusPath,
    });
    const enginePid = readyStatus.testBridge.enginePid;
    const engineGeneration = readyStatus.testBridge.engineGeneration;
    assert(
      Number.isInteger(enginePid) && enginePid > 0,
      `Expected the status file to carry the engine pid, got ${enginePid}.`
    );

    killEngineProcess(enginePid);
    const killedAt = Date.now();
    const exitedStatus = await waitForStatus({
      child: crashRun,
      label: "ENGINE_EXITED recovery state",
      predicate: (value) => value?.shellState?.startupFailure?.code === "ENGINE_EXITED",
      statusPath: crashSession.statusPath,
      timeoutMs: ENGINE_CRASH_DETECT_MS,
    });
    const detectMs = Date.now() - killedAt;
    const exitFailure = exitedStatus.shellState.startupFailure;
    assert(
      exitedStatus.shellState.lifecycle === "failed",
      `Expected the shell to leave ready when the engine died, got '${exitedStatus.shellState.lifecycle}'.`
    );
    assert(
      exitFailure?.stage === "runtime",
      `Expected the ENGINE_EXITED stage 'runtime', got '${exitFailure?.stage}'.`
    );
    assert(
      typeof exitFailure?.message === "string" && exitFailure.message.includes("restarts it on its own"),
      `Expected the ENGINE_EXITED sentence to announce the automatic restart, got '${exitFailure?.message}'.`
    );

    const recoveredStatus = await waitForStatus({
      child: crashRun,
      label: "automatic restart ready state",
      predicate: (value) =>
        value?.shellState?.lifecycle === "ready" &&
        typeof value?.testBridge?.enginePid === "number" &&
        value.testBridge.enginePid !== enginePid,
      statusPath: crashSession.statusPath,
    });
    const restartMs = Date.now() - killedAt;
    assert(
      recoveredStatus.shellState.startupFailure === null,
      "Expected the automatic restart to clear the recovery surface."
    );
    assert(
      recoveredStatus.testBridge.engineGeneration === engineGeneration + 1,
      `Expected launch ${engineGeneration + 1} after the automatic restart, got ${recoveredStatus.testBridge.engineGeneration}.`
    );
    evidence.recordCheck("engine-crash-reaches-recovery-and-restarts", {
      detectMs,
      killedPid: enginePid,
      newPid: recoveredStatus.testBridge.enginePid,
      restartMs,
    });

    // Scenario `second-instance` (Slice 5 — F19): a second copy of the shell
    // launched while the first is up never gets a working engine. On Windows
    // and macOS the shell's single-instance plugin hands the launch to the
    // running shell and exits; on a Linux session without a D-Bus session
    // bus the plugin cannot see the first shell, and the engine's lock on
    // `<app-data>/engine.lock` refuses the second engine instead, so the
    // second shell stops at ENGINE_ALREADY_RUNNING. Both are recorded; only
    // the plugin's refusal is accepted on Windows and macOS.
    console.log("Tauri Setup/Support qualification: step 6/6 a second copy of the shell is refused.");
    const secondSession = createSessionFiles("sse-tauri-second-instance-");
    const secondRun = launchSecondShellInstance({
      appDataDir: crashRuntime.appDataDir,
      commandPath: secondSession.commandPath,
      logsDir: crashRuntime.logsDir,
      statusPath: secondSession.statusPath,
      updateRepoDir: crashRuntime.updateRepoDir,
    });
    const launchedAt = Date.now();

    try {
      const refusalDeadline = launchedAt + SECOND_INSTANCE_EXIT_MS;
      let refusal = null;
      while (refusal === null && Date.now() < refusalDeadline) {
        if (secondRun.exitCode !== null) {
          assert(
            secondRun.exitCode === 0,
            `Expected the second shell to exit cleanly after handing over, got code ${secondRun.exitCode}.`
          );
          refusal = {
            exitCode: secondRun.exitCode,
            refusalMs: Date.now() - launchedAt,
            refusedBy: "shell-single-instance",
          };
          break;
        }
        const secondStatus = readJson(secondSession.statusPath);
        if (secondStatus?.shellState?.startupFailure?.code === "ENGINE_ALREADY_RUNNING") {
          assert(
            process.platform === "linux",
            `Expected the single-instance plugin to refuse the second shell on ${process.platform}, but it reached the recovery surface as ENGINE_ALREADY_RUNNING.`
          );
          refusal = {
            exitCode: null,
            refusalMs: Date.now() - launchedAt,
            refusedBy: "engine-lock",
            stage: secondStatus.shellState.startupFailure.stage,
          };
          break;
        }
        await delay(100);
      }
      assert(
        refusal !== null,
        `Expected the second shell to be refused within ${SECOND_INSTANCE_EXIT_MS} ms on ${process.platform}; it is still running and reported no refusal.`
      );

      // The first shell is untouched: still ready, its engine the same, its
      // status file still moving.
      const before = readJson(crashSession.statusPath);
      const after = await waitForStatus({
        child: crashRun,
        label: "first shell heartbeat after the second launch",
        predicate: (value) =>
          value?.shellState?.lifecycle === "ready" && value?.testBridge?.heartbeat !== before?.testBridge?.heartbeat,
        statusPath: crashSession.statusPath,
      });
      assert(
        after.testBridge.enginePid === recoveredStatus.testBridge.enginePid,
        "Expected the first shell's engine to be untouched by the second launch."
      );
      evidence.recordCheck("second-instance-is-refused", refusal);
    } finally {
      await closeTauriShell(secondRun);
      secondSession.cleanup();
    }
  } finally {
    await closeTauriShell(crashRun);
    crashSession.cleanup();
    crashRuntime.cleanup();
  }
}

try {
  await runSetupSupportQualification();
  console.log(`Tauri Setup/Support qualification evidence: ${evidence.write("passed")}`);
  console.log("Tauri Setup/Support qualification passed.");
} catch (error) {
  evidence.write("failed", {
    error: error instanceof Error ? error.message : String(error),
  });
  throw error;
}
