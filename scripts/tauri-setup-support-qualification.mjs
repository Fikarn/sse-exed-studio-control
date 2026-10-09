import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { BRIDGE_LOOK_STALLS_ENV, hardenedLaneEnv, laneProcessEnv } from "./native-runtime-harness.mjs";
import { carriesLaunchNumber, launchNumberOf } from "./tauri-launch-number.mjs";
import { createQualificationEvidence } from "./tauri-qualification-evidence.mjs";
import { shellStillRunning } from "./tauri-shell-running.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const devServerPort = 4174;
// The lane's evidence folder; main() makes it, so an import makes nothing.
let evidence = null;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// The saved data the backup and restore steps follow (new pages program,
// Slice 1). Until then it was the Planning data: the sample projects and a
// project added later, counted on the commissioning snapshot. Planning left
// the screen, and its data the hardware link in Slice 2, so the marker became
// a snapshot slot of the Console, found by name.
// 2026-10-01: the Console's snapshots follow TotalMix, and the app keeps none
// of its own, so the marker is now a lighting group, found by name. A group is
// saved data (`app.lighting.editor.state` in the settings table, written by
// `create_lighting_group`), so a database backup carries it, and the restore
// that stages the backup brings the whole table back at the next start; the
// archive carries every `app.lighting.` setting but the light outputs' hold,
// and a restore clears and rewrites them as a whole (`support.rs`). Creating
// or deleting a group needs no fixture and sends nothing to the rig, and the
// hardware link allows it with no probe passed (this lane runs none). Found by
// name, because a deleted group's id can be given to the next one created.
const ARCHIVE_MARKER = "Qualification: kept by the archive";
const DATABASE_MARKER = "Qualification: kept by the database backup";
const LATER_CHANGE = "Qualification: added after the backup";
const MARKER_CHANGED =
  "2026-10-01: the saved data followed is a lighting group; from the new pages program's Slice 1 it was a snapshot slot of the Console, which the app no longer keeps (its snapshots are TotalMix's), and until then it was the Planning projects and tasks.";
// The page is saved data too. The lane leaves on Lighting, and the restart
// opens the Overview all the same: the app opens on it at every start once
// the setup is published, and saves it (D47, 2026-10-09, D1 amended). Until
// D47 the restart came back on Lighting, the page saved; the restored marker
// and the backups prove the saved data now.
const LANDING_WORKSPACE = "overview";
const WORKSPACE_CHANGED =
  "D47 (2026-10-09): the lane leaves on Lighting and the restart opens the Overview, the page the app opens on at every start, and saves it; the restored marker proves the saved data (a lighting group since 2026-10-01, a snapshot slot of the Console before). Until D47 the restart came back on Lighting, and until the new pages program's Slice 1 the page was Planning.";

function lightingGroupNames(status) {
  const groups = status?.shellState?.lightingSnapshot?.groups;
  return (Array.isArray(groups) ? groups : []).map((entry) => entry?.name);
}

async function createLightingGroupMarker(session, child, name) {
  const created = await dispatchCommand(session, child, "createLightingGroup", { name });
  const id = created.result?.group?.id;
  assert(typeof id === "string" && id.length > 0, `Expected the new lighting group '${name}' to come back with an id.`);
  assert(
    lightingGroupNames(created.status).includes(name),
    `Expected the lighting group '${name}' in the rig's groups, got ${JSON.stringify(lightingGroupNames(created.status))}.`
  );
  return { id, status: created.status };
}

function createRuntimeDirs(prefix) {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  const appDataDir = path.join(root, "app-data");
  const logsDir = path.join(root, "logs");
  const diagnosticsDir = path.join(root, "diagnostics");

  mkdirSync(appDataDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });
  mkdirSync(diagnosticsDir, { recursive: true });

  return {
    appDataDir,
    cleanup() {
      rmSync(root, { force: true, recursive: true });
    },
    diagnosticsDir,
    logsDir,
    root,
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

// Every shell gets the lanes' hardening (native-runtime-harness.mjs, new pages
// program, Slice 2b): a bridge port of its own, the light outputs held and the
// simulated console. `envCheck` names the one launch that may leave the safe
// start out (step 8).
async function launchTauriShell({ appDataDir, commandPath, envCheck = {}, extraEnv = {}, logsDir, statusPath }) {
  const env = laneProcessEnv(
    await hardenedLaneEnv(),
    {
      SSE_APP_DATA_DIR: appDataDir,
      SSE_LOG_DIR: logsDir,
      SSE_TAURI_TEST_COMMAND_PATH: commandPath,
      SSE_TAURI_TEST_STATUS_PATH: statusPath,
      ...extraEnv,
    },
    { label: "The Setup/Support qualification's shell", ...envCheck }
  );
  const child = spawn(npmCommand, ["run", "tauri:dev", "--workspace", "frontend/app"], {
    // Windows: npm is npm.cmd, and Node >= 18.20 refuses to spawn .cmd files
    // without a shell (EINVAL, CVE-2024-27980 hardening).
    shell: true,
    cwd: rootDir,
    env,
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

// Default waitForStatus deadline: the studio PC completes each phase within
// 40 s (the shell is built before the lane starts, `native:shell:build`).
const DEFAULT_WAIT_TIMEOUT_MS = 40_000;

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

// Finding F07 (2026-09 production readiness, Slice 4): a request the engine
// takes seconds to answer must not stall the shell. The lighting probe of
// `STALLED_BRIDGE_IP` sits in the engine's 1.5 s look timeout; while it does,
// the test bridge's 250 ms heartbeat must keep reaching the status file.
// Every heartbeat is an IPC call the shell answers on its main thread, so a
// main thread blocked on the engine's reply — the shell before this slice —
// freezes the file for the whole stall.
//
// The stall is the engine's own (2026-10-09, D46): the first shell's
// environment names the address in `SSE_BRIDGE_LOOK_STALLS`, and a
// development build's look at it waits the whole timeout and answers
// silence, with no connection made. Until then the lane connected to an
// address of no network, a documentation address (RFC 5737), and the engine
// did the same, which kept the lane off the studio PC: its second default
// route could carry such a packet towards the lighting bridge
// (docs/HARDWARE.md). Now nothing is sent. The address is still one of no
// network, so a look that did go out would find silence as well.
const STALLED_BRIDGE_IP = "203.0.113.113";
const STALLED_REQUEST_MIN_PROBE_MS = 1_000;
const STALLED_REQUEST_MAX_GAP_MS = 1_000;

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
    `Expected the lighting probe against ${bridgeIp} to sit in the engine's 1.5 s look timeout, but it answered in ${probeMs} ms: the engine did not stall, so ${BRIDGE_LOOK_STALLS_ENV} did not reach it, or the shell started no development build.`
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
// The single-instance plugin refuses the second copy before its window
// exists: within 5 s (113 ms on the studio PC).
const SECOND_INSTANCE_EXIT_MS = 5_000;

// Ends the engine process from outside the shell — what a crash looks like
// to it. No tree kill: the engine's one child, the pictures helper, ends by
// itself when the engine's end closes its stdin.
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
// would refuse port 4174 before the shell ever ran, proving nothing about
// the shell.
async function launchSecondShellInstance({ appDataDir, commandPath, logsDir, statusPath }) {
  const binaryPath = debugShellBinaryPath();
  assert(existsSync(binaryPath), `Expected the debug shell binary at ${binaryPath} after the first tauri dev run.`);
  const env = laneProcessEnv(
    await hardenedLaneEnv(),
    {
      SSE_APP_DATA_DIR: appDataDir,
      SSE_LOG_DIR: logsDir,
      SSE_TAURI_TEST_COMMAND_PATH: commandPath,
      SSE_TAURI_TEST_STATUS_PATH: statusPath,
    },
    { label: "The Setup/Support qualification's second shell" }
  );
  const child = spawn(binaryPath, [], {
    cwd: rootDir,
    env,
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
  if (!shellStillRunning(child)) {
    return;
  }

  // npm.cmd -> node -> tauri.js -> vite + cargo -> shell: killing only the
  // npm parent leaves vite holding the dev port and the shell alive, and
  // the next step's port preflight then fails. Kill the whole tree.
  killWindowsProcessTree(child.pid);

  // Until the shell has gone (`tauri-shell-running.mjs`).
  const deadline = Date.now() + 5_000;
  while (shellStillRunning(child) && Date.now() < deadline) {
    await delay(100);
  }

  if (shellStillRunning(child)) {
    killWindowsProcessTree(child.pid);
    await delay(200);
  }
}

async function runSetupSupportQualification() {
  await assertTcpPortAvailable(devServerPort);

  const runtime = createRuntimeDirs("sse-tauri-setup-support-");
  const firstSession = createSessionFiles("sse-tauri-session-");

  console.log("Tauri Setup/Support qualification: step 1/8 clean startup and support workflow.");

  const firstRun = await launchTauriShell({
    appDataDir: runtime.appDataDir,
    commandPath: firstSession.commandPath,
    // The stalled-request check's stall (`runStalledRequestCheck`).
    extraEnv: { [BRIDGE_LOOK_STALLS_ENV]: STALLED_BRIDGE_IP },
    logsDir: runtime.logsDir,
    statusPath: firstSession.statusPath,
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
    const stalledRequest = await runStalledRequestCheck(firstSession, firstRun, STALLED_BRIDGE_IP);
    evidence.recordCheck("shell-stays-responsive-during-stalled-request", {
      bridgeIp: STALLED_BRIDGE_IP,
      ...stalledRequest,
    });
    // The probe persisted the stalled address as the lighting bridge; point
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

    // The saved data the archive must carry, written before it is exported.
    const archiveMarker = await createLightingGroupMarker(firstSession, firstRun, ARCHIVE_MARKER);

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

    // The saved data changes after the export: the marker goes and a group the
    // archive never saw arrives. The restore must undo both.
    const markerDeleted = await dispatchCommand(firstSession, firstRun, "deleteLightingGroup", {
      groupId: archiveMarker.id,
    });
    assert(
      !lightingGroupNames(markerDeleted.status).includes(ARCHIVE_MARKER),
      `Expected the lighting group '${ARCHIVE_MARKER}' to be gone after it was deleted.`
    );
    await createLightingGroupMarker(firstSession, firstRun, LATER_CHANGE);

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
    const restoredNames = lightingGroupNames(restoreStatus.status);
    assert(
      restoredNames.includes(ARCHIVE_MARKER),
      `Expected the restore to bring back the lighting group the archive carried, got ${JSON.stringify(restoredNames)}.`
    );
    assert(
      !restoredNames.includes(LATER_CHANGE),
      `Expected the restore to undo the lighting group added after the export, got ${JSON.stringify(restoredNames)}.`
    );
    evidence.recordCheck("backup-restore-round-trips-native-support-backup", {
      marker: ARCHIVE_MARKER,
      markerChanged: MARKER_CHANGED,
      sourceFormat: restoreStatus.result?.sourceFormat,
    });

    const workspaceStatus = await dispatchCommand(firstSession, firstRun, "setWorkspace", {
      workspaceId: "lighting",
    });
    assert(
      workspaceStatus.status.shellState.activeWorkspace === "lighting",
      "Expected workspace switch to lighting to persist through the live Tauri shell."
    );
  } finally {
    await closeTauriShell(firstRun);
    firstSession.cleanup();
  }

  await delay(1_500);
  await assertTcpPortAvailable(devServerPort);

  console.log("Tauri Setup/Support qualification: step 2/8 persisted restart on the same runtime.");

  // Slice 7 (F20): the database backup step 2 restores is kept for the
  // corrupt-database scenario, which restores it from the recovery surface.
  let databaseBackupBytes;
  const secondSession = createSessionFiles("sse-tauri-session-");
  const secondRun = await launchTauriShell({
    appDataDir: runtime.appDataDir,
    commandPath: secondSession.commandPath,
    logsDir: runtime.logsDir,
    statusPath: secondSession.statusPath,
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
    // D47: Lighting was saved, and the start opens the Overview, written before
    // the shell is ready, so the saved page (the deck's word) says it too.
    assert(
      restartStatus.shellState.activeWorkspace === LANDING_WORKSPACE,
      `Expected restarted Tauri runtime to open the ${LANDING_WORKSPACE} workspace, got '${restartStatus.shellState.activeWorkspace}'.`
    );
    assert(
      restartStatus.shellState.appSnapshot?.shell?.workspace === LANDING_WORKSPACE,
      `Expected restarted Tauri runtime to save the page it opened on, '${LANDING_WORKSPACE}', got '${restartStatus.shellState.appSnapshot?.shell?.workspace}'.`
    );
    assert(
      restartStatus.shellState.supportSnapshot?.backupCount >= 2,
      "Expected restarted Tauri runtime to preserve support backup history."
    );
    assert(
      lightingGroupNames(restartStatus).includes(ARCHIVE_MARKER),
      `Expected restarted Tauri runtime to keep the restored lighting group, got ${JSON.stringify(lightingGroupNames(restartStatus))}.`
    );
    evidence.recordCheck("persisted-restart-restores-dashboard-state", {
      activeWorkspace: restartStatus.shellState.activeWorkspace,
      keptMarker: ARCHIVE_MARKER,
      scopeChanged: WORKSPACE_CHANGED,
      targetSurface: restartStatus.shellState.appSnapshot?.startup?.targetSurface,
    });

    // Scenario `database-restore` (2026-09 production readiness, Slice 7 —
    // F20): a database backup is verified and restored through the running
    // shell. The restart the test bridge asks for stops the engine
    // gracefully, which writes a `shutdown` database backup; a lighting group
    // saved before it must come back, and one added after it is the change
    // the restore must undo (a snapshot slot of the Console until 2026-10-01).
    // Verify reads the backup without touching anything (and calls junk junk);
    // the restore stages the backup, the store restarts the hardware link, and
    // the bootstrap moves the backup into place with the old file kept as
    // `replaced`.
    await createLightingGroupMarker(secondSession, secondRun, DATABASE_MARKER);
    // Launch numbers reach the status file after the fact, so each count starts
    // from a number that was waited for and waits for the next one
    // (`tauri-launch-number.mjs`).
    const generationBeforeRestart = launchNumberOf(
      await waitForStatus({
        child: secondRun,
        label: "launch number before the requested restart",
        predicate: carriesLaunchNumber(),
        statusPath: secondSession.statusPath,
      })
    );
    const restartedStatus = await dispatchCommand(secondSession, secondRun, "restart");
    assert(
      restartedStatus.status.shellState.lifecycle === "ready",
      `Expected the shell to be ready after the requested restart, got '${restartedStatus.status.shellState.lifecycle}'.`
    );
    const launchAfterRestart = launchNumberOf(
      await waitForStatus({
        child: secondRun,
        label: "launch number after the requested restart",
        predicate: carriesLaunchNumber(generationBeforeRestart),
        statusPath: secondSession.statusPath,
      })
    );
    assert(
      launchAfterRestart === generationBeforeRestart + 1,
      `Expected launch ${generationBeforeRestart + 1} after the requested restart, got ${launchAfterRestart}.`
    );
    const backupsDir = restartedStatus.status.shellState.supportSnapshot?.backupDir;
    assert(
      typeof backupsDir === "string" && existsSync(backupsDir),
      "Expected the support snapshot to name the backups folder."
    );
    const listedBackups = restartedStatus.status.shellState.supportSnapshot?.backups ?? [];
    const shutdownBackup = listedBackups.find(
      (entry) =>
        entry?.kind === "database" && typeof entry?.name === "string" && entry.name.endsWith("-shutdown.sqlite3")
    );
    assert(
      shutdownBackup && existsSync(shutdownBackup.path),
      `Expected the graceful restart to leave a shutdown database backup in the backups folder, got ${JSON.stringify(listedBackups.map((entry) => entry?.name))}.`
    );
    databaseBackupBytes = readFileSync(shutdownBackup.path);

    await createLightingGroupMarker(secondSession, secondRun, LATER_CHANGE);

    const verifyStatus = await dispatchCommand(secondSession, secondRun, "verifySupportBackup", {
      path: shutdownBackup.path,
    });
    assert(
      verifyStatus.result?.ok === true && verifyStatus.result?.kind === "database",
      `Expected the shutdown backup to verify as a database backup, got ${JSON.stringify(verifyStatus.result)}.`
    );
    assert(
      Number.isInteger(verifyStatus.result?.schemaVersion) && verifyStatus.result.schemaVersion > 0,
      `Expected the verification to report the schema version, got ${JSON.stringify(verifyStatus.result)}.`
    );
    const junkBackupPath = path.join(backupsDir, "db-2026-01-01T00-00-00-000Z-daily.sqlite3");
    writeFileSync(junkBackupPath, Buffer.from("this is not a database\n".repeat(64), "utf8"));
    const junkStatus = await dispatchCommand(secondSession, secondRun, "verifySupportBackup", {
      path: junkBackupPath,
    });
    assert(
      junkStatus.result?.ok === false &&
        typeof junkStatus.result?.detail === "string" &&
        junkStatus.result.detail.length > 0,
      `Expected junk where a database backup should be to fail its check, got ${JSON.stringify(junkStatus.result)}.`
    );
    rmSync(junkBackupPath, { force: true });

    const restoreDatabaseStatus = await dispatchCommand(secondSession, secondRun, "restoreSupportBackup", {
      path: shutdownBackup.path,
    });
    assert(
      restoreDatabaseStatus.result?.requiresRestart === true &&
        restoreDatabaseStatus.result?.sourceFormat === "database-backup",
      `Expected a database restore to answer requiresRestart, got ${JSON.stringify(restoreDatabaseStatus.result)}.`
    );
    assert(
      typeof restoreDatabaseStatus.result?.rollbackBackupPath === "string" &&
        restoreDatabaseStatus.result.rollbackBackupPath.endsWith("-pre-restore.sqlite3") &&
        existsSync(restoreDatabaseStatus.result.rollbackBackupPath),
      `Expected a pre-restore database backup before the restore, got '${restoreDatabaseStatus.result?.rollbackBackupPath}'.`
    );
    assert(
      restoreDatabaseStatus.status.shellState.lifecycle === "ready" &&
        restoreDatabaseStatus.status.shellState.startupFailure === null,
      `Expected the shell to be ready again after the restart the restore asked for, got '${restoreDatabaseStatus.status.shellState.lifecycle}'.`
    );
    const launchAfterRestore = launchNumberOf(
      await waitForStatus({
        child: secondRun,
        label: "launch number after the restore's restart",
        predicate: carriesLaunchNumber(launchAfterRestart),
        statusPath: secondSession.statusPath,
      })
    );
    assert(
      launchAfterRestore === generationBeforeRestart + 2,
      `Expected launch ${generationBeforeRestart + 2} after the restore's restart, got ${launchAfterRestore}.`
    );
    const restoredDatabaseNames = lightingGroupNames(restoreDatabaseStatus.status);
    assert(
      restoredDatabaseNames.includes(DATABASE_MARKER),
      `Expected the database restore to keep the lighting group saved before the backup, got ${JSON.stringify(restoredDatabaseNames)}.`
    );
    assert(
      !restoredDatabaseNames.includes(LATER_CHANGE),
      `Expected the database restore to undo the lighting group added after the backup, got ${JSON.stringify(restoredDatabaseNames)}.`
    );
    assert(
      !existsSync(path.join(runtime.appDataDir, "restore-pending.sqlite3")),
      "Expected the pending restore file to be gone once applied."
    );
    const replacedFiles = readdirSync(backupsDir).filter((name) => name.endsWith("-replaced.sqlite3"));
    assert(
      replacedFiles.length === 1,
      `Expected the replaced database to be kept as one replaced backup, got ${JSON.stringify(replacedFiles)}.`
    );
    evidence.recordCheck("database-backup-verifies-and-restores-after-restart", {
      backup: shutdownBackup.name,
      marker: DATABASE_MARKER,
      markerChanged: MARKER_CHANGED,
      replaced: replacedFiles[0],
      rollback: path.basename(restoreDatabaseStatus.result.rollbackBackupPath),
      schemaVersion: verifyStatus.result?.schemaVersion,
    });
  } finally {
    await closeTauriShell(secondRun);
    secondSession.cleanup();
    runtime.cleanup();
  }

  await delay(1_500);
  await assertTcpPortAvailable(devServerPort);

  console.log("Tauri Setup/Support qualification: step 3/8 recovery posture for bootstrap failure.");

  const blockedRuntime = createBlockedRuntimeDirs("sse-tauri-bootstrap-failure-");
  const recoverySession = createSessionFiles("sse-tauri-session-");
  const recoveryRun = await launchTauriShell({
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
  console.log("Tauri Setup/Support qualification: step 4/8 recovery posture for a corrupt database.");

  const corruptRuntime = createRuntimeDirs("sse-tauri-corrupt-db-");
  const corruptDbPath = path.join(corruptRuntime.appDataDir, "studio-control.sqlite3");
  const junk = Buffer.from("this is not a database\n".repeat(400), "utf8");
  writeFileSync(corruptDbPath, junk);
  // Slice 7 (F20): a database backup in the backups folder is what the
  // recovery surface restores from; step 2's shutdown backup stands in.
  const corruptBackupsDir = path.join(corruptRuntime.appDataDir, "backups");
  mkdirSync(corruptBackupsDir, { recursive: true });
  const recoveryBackupPath = path.join(corruptBackupsDir, "db-2026-09-11T00-00-00-000Z-daily.sqlite3");
  assert(
    Buffer.isBuffer(databaseBackupBytes),
    "Expected step 2 to have kept a database backup for the recovery scenario."
  );
  writeFileSync(recoveryBackupPath, databaseBackupBytes);
  const corruptSession = createSessionFiles("sse-tauri-session-");
  const corruptRun = await launchTauriShell({
    appDataDir: corruptRuntime.appDataDir,
    commandPath: corruptSession.commandPath,
    logsDir: corruptRuntime.logsDir,
    statusPath: corruptSession.statusPath,
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

    // Recovery mode (Slice 7 — F20): the engine stays up for the backup
    // requests and the store fetched the backup list; a database backup
    // restored from the recovery surface stages without a rollback copy (the
    // damaged file cannot be copied), the shell restarts into it, and the
    // damaged file is kept as a `replaced` backup, byte for byte.
    // The launch number is waited for as well: on run 35714853611 the list
    // arrived before it, `null + 1` made 1, and a restore that restarted the
    // engine once (launch 1 -> 2) failed as a restart too many.
    const listedInRecovery = await waitForStatus({
      child: corruptRun,
      label: "backup list on the recovery surface",
      predicate: (value) =>
        value?.shellState?.lifecycle === "failed" &&
        (value?.shellState?.supportSnapshot?.backupCount ?? 0) >= 1 &&
        carriesLaunchNumber()(value),
      statusPath: corruptSession.statusPath,
    });
    const recoveryGeneration = launchNumberOf(listedInRecovery);
    const recoveryVerify = await dispatchCommand(corruptSession, corruptRun, "verifySupportBackup", {
      path: recoveryBackupPath,
    });
    assert(
      recoveryVerify.result?.ok === true && recoveryVerify.result?.kind === "database",
      `Expected the seeded backup to verify from the recovery surface, got ${JSON.stringify(recoveryVerify.result)}.`
    );
    const recoveryRestore = await dispatchCommand(corruptSession, corruptRun, "restoreSupportBackup", {
      path: recoveryBackupPath,
    });
    assert(
      recoveryRestore.result?.requiresRestart === true && recoveryRestore.result?.rollbackBackupPath === null,
      `Expected a database restore from the recovery surface to stage without a rollback copy, got ${JSON.stringify(recoveryRestore.result)}.`
    );
    assert(
      recoveryRestore.status.shellState.lifecycle === "ready" &&
        recoveryRestore.status.shellState.startupFailure === null,
      `Expected the shell to reach ready after restoring from the recovery surface, got '${recoveryRestore.status.shellState.lifecycle}'.`
    );
    const launchAfterRecoveryRestore = launchNumberOf(
      await waitForStatus({
        child: corruptRun,
        label: "launch number after the restore's restart",
        predicate: carriesLaunchNumber(recoveryGeneration),
        statusPath: corruptSession.statusPath,
      })
    );
    assert(
      launchAfterRecoveryRestore === recoveryGeneration + 1,
      `Expected launch ${recoveryGeneration + 1} after the restore's restart, got ${launchAfterRecoveryRestore}.`
    );
    assert(
      lightingGroupNames(recoveryRestore.status).includes(DATABASE_MARKER),
      `Expected the restored database to carry the lighting group saved before the backup, got ${JSON.stringify(lightingGroupNames(recoveryRestore.status))}.`
    );
    const replacedJunk = readdirSync(corruptBackupsDir).filter((name) => name.endsWith("-replaced.sqlite3"));
    assert(
      replacedJunk.length === 1 && readFileSync(path.join(corruptBackupsDir, replacedJunk[0])).equals(junk),
      `Expected the damaged file to be kept as one replaced backup, byte for byte, got ${JSON.stringify(replacedJunk)}.`
    );
    evidence.recordCheck("corrupt-db-restores-from-database-backup", {
      generation: launchAfterRecoveryRestore,
      marker: DATABASE_MARKER,
      markerChanged: MARKER_CHANGED,
      replaced: replacedJunk[0],
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
    "Tauri Setup/Support qualification: step 5/8 an engine ended from outside reaches recovery and restarts on its own."
  );

  const crashRuntime = createRuntimeDirs("sse-tauri-engine-crash-");
  const crashSession = createSessionFiles("sse-tauri-session-");
  const crashRun = await launchTauriShell({
    appDataDir: crashRuntime.appDataDir,
    commandPath: crashSession.commandPath,
    logsDir: crashRuntime.logsDir,
    statusPath: crashSession.statusPath,
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
    // launched while the first is up never gets a working engine: the
    // shell's single-instance plugin hands the launch to the running shell
    // and exits. The engine's own lock on `<app-data>/engine.lock` stands
    // behind it; a second shell that got as far as ENGINE_ALREADY_RUNNING
    // would mean the plugin did not refuse it, and fails the check.
    console.log("Tauri Setup/Support qualification: step 6/8 a second copy of the shell is refused.");
    const secondSession = createSessionFiles("sse-tauri-second-instance-");
    const secondRun = await launchSecondShellInstance({
      appDataDir: crashRuntime.appDataDir,
      commandPath: secondSession.commandPath,
      logsDir: crashRuntime.logsDir,
      statusPath: secondSession.statusPath,
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
        assert(
          secondStatus?.shellState?.startupFailure?.code !== "ENGINE_ALREADY_RUNNING",
          "Expected the single-instance plugin to refuse the second shell, but it reached the recovery surface as ENGINE_ALREADY_RUNNING."
        );
        await delay(100);
      }
      assert(
        refusal !== null,
        `Expected the second shell to be refused within ${SECOND_INSTANCE_EXIT_MS} ms; it is still running and reported no refusal.`
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

  await delay(1_500);
  await assertTcpPortAvailable(devServerPort);

  // Scenario `bridge-port-taken` (2026-09 production readiness, Slice 8 —
  // F14): when the Stream Deck bridge cannot bind its port, the engine's
  // health reads `attention` — the registry entry under checks.engine names
  // the bridge, the app snapshot reports the bridge unavailable on that
  // port, and the store derives its degraded recovery state — where before
  // the slice health read `ok` whatever had failed. A throwaway listener
  // holds the port the shell is told to use (in place of the lane's own); the
  // engine scans for no other.
  console.log("Tauri Setup/Support qualification: step 7/8 a taken Stream Deck bridge port reads as health attention.");

  const portHolder = net.createServer();
  const takenPort = await new Promise((resolve, reject) => {
    portHolder.once("error", reject);
    portHolder.listen(0, "127.0.0.1", () => resolve(portHolder.address().port));
  });
  const portRuntime = createRuntimeDirs("sse-tauri-bridge-port-");
  const portSession = createSessionFiles("sse-tauri-session-");
  const portRun = await launchTauriShell({
    appDataDir: portRuntime.appDataDir,
    commandPath: portSession.commandPath,
    extraEnv: { SSE_CONTROL_SURFACE_PORT: String(takenPort) },
    logsDir: portRuntime.logsDir,
    statusPath: portSession.statusPath,
  });

  try {
    const portStatus = await waitForStatus({
      child: portRun,
      label: "ready state with the bridge port taken",
      predicate: (value) => value?.shellState?.lifecycle === "ready",
      statusPath: portSession.statusPath,
    });
    const health = portStatus.shellState.healthSnapshot;
    const bridgeEntry = health?.checks?.engine?.bridge;
    const controlSurface = portStatus.shellState.appSnapshot?.runtime?.controlSurface;
    assert(
      health?.status === "attention",
      `Expected health status 'attention' with the bridge port taken, got '${health?.status}'.`
    );
    assert(
      bridgeEntry?.state === "attention",
      `Expected checks.engine.bridge.state 'attention', got ${JSON.stringify(bridgeEntry)}.`
    );
    assert(
      typeof bridgeEntry?.detail === "string" && bridgeEntry.detail.includes("could not open its port"),
      `Expected the bridge entry to say its port could not open, got '${bridgeEntry?.detail}'.`
    );
    assert(
      controlSurface?.available === false && controlSurface?.port === takenPort,
      `Expected the app snapshot to report the bridge unavailable on port ${takenPort}, got ${JSON.stringify(controlSurface)}.`
    );
    assert(
      portStatus.shellState.recovery === "degraded",
      `Expected the store's recovery state 'degraded', got '${portStatus.shellState.recovery}'.`
    );
    assert(
      typeof health?.recentLogExcerpt === "string" && health.recentLogExcerpt.length <= 64 * 1024,
      "Expected the health snapshot's log excerpt to be a bounded string."
    );
    const engineLogPath = path.join(portRuntime.logsDir, "engine.log");
    assert(existsSync(engineLogPath), `Expected the engine log at ${engineLogPath}.`);
    evidence.recordCheck("bridge-port-taken-reads-as-health-attention", {
      bridgeDetail: bridgeEntry.detail,
      healthStatus: health.status,
      port: takenPort,
      recovery: portStatus.shellState.recovery,
    });
  } finally {
    await closeTauriShell(portRun);
    await new Promise((resolve) => portHolder.close(resolve));
    portSession.cleanup();
    portRuntime.cleanup();
  }

  await delay(1_500);
  await assertTcpPortAvailable(devServerPort);

  // Scenario `safe-start` (2026-09 production readiness, Slice 11 — F31):
  // `SSE_SAFE_START=1` reaches the hardware link through the shell's
  // environment and holds the light outputs before anything could stream.
  // The hold is observed where the operator would see it — `outputArmed` on
  // the lighting state, the `sacn` health entry (still `ok`: a hold is not a
  // fault), the start-up row in Recent actions — never by listening for
  // packets: 5568 may belong to other lighting software on the workstation.
  // The hold is persisted, so a second launch WITHOUT the variable is still
  // held; only the switch arms, and the switch is a row of its own.
  console.log("Tauri Setup/Support qualification: step 8/8 a safe start holds the light outputs until they are armed.");

  const safeRuntime = createRuntimeDirs("sse-tauri-safe-start-");
  const heldOutputs = (value) => {
    const sacn = value?.shellState?.healthSnapshot?.checks?.engine?.sacn;
    return (
      value?.shellState?.lifecycle === "ready" &&
      value?.shellState?.lightingSnapshot?.outputArmed === false &&
      typeof sacn?.detail === "string" &&
      sacn.detail.includes("held")
    );
  };
  const rowsOf = (value) =>
    Array.isArray(value?.shellState?.supportSnapshot?.recentEvents)
      ? value.shellState.supportSnapshot.recentEvents
      : [];
  let safeEvidence;

  const safeSession = createSessionFiles("sse-tauri-session-");
  const safeRun = await launchTauriShell({
    appDataDir: safeRuntime.appDataDir,
    commandPath: safeSession.commandPath,
    extraEnv: { SSE_SAFE_START: "1" },
    logsDir: safeRuntime.logsDir,
    statusPath: safeSession.statusPath,
  });
  try {
    const held = await waitForStatus({
      child: safeRun,
      label: "held light outputs after a safe start",
      predicate: heldOutputs,
      statusPath: safeSession.statusPath,
    });
    const sacn = held.shellState.healthSnapshot.checks.engine.sacn;
    assert(sacn.state === "ok", `Expected the held sacn entry to stay 'ok', got ${JSON.stringify(sacn)}.`);
    assert(
      held.shellState.recovery !== "degraded",
      `A hold is not a fault: expected the store's recovery state not to be 'degraded', got '${held.shellState.recovery}'.`
    );
    const launchRow = rowsOf(held).find((row) => row?.source === "launch" && row?.action === "outputs-held");
    assert(launchRow, `Expected a start-up row for the hold, got ${JSON.stringify(rowsOf(held))}.`);
    safeEvidence = { heldDetail: sacn.detail, launchRow: launchRow.detail };
  } finally {
    await closeTauriShell(safeRun);
    safeSession.cleanup();
  }

  await delay(1_500);
  await assertTcpPortAvailable(devServerPort);

  // The one launch of any lane without the lanes' safe start (new pages
  // program, Slice 2b): with it, this launch would hold the outputs itself and
  // prove nothing about the hold outliving the launch that made it. The rest
  // of the hardening stays, and this runtime has no lighting bridge to arm.
  const armSession = createSessionFiles("sse-tauri-session-");
  const armRun = await launchTauriShell({
    appDataDir: safeRuntime.appDataDir,
    commandPath: armSession.commandPath,
    envCheck: { safeStart: false },
    extraEnv: { SSE_SAFE_START: "0" },
    logsDir: safeRuntime.logsDir,
    statusPath: armSession.statusPath,
  });
  try {
    const stillHeld = await waitForStatus({
      child: armRun,
      label: "the hold outliving the launch that made it",
      predicate: heldOutputs,
      statusPath: armSession.statusPath,
    });
    assert(
      rowsOf(stillHeld).filter((row) => row?.source === "launch").length === 1,
      `Expected the second launch to add no start-up row, got ${JSON.stringify(rowsOf(stillHeld))}.`
    );

    await dispatchCommand(armSession, armRun, "setLightingOutputArmed", { armed: true });
    const armed = await waitForStatus({
      child: armRun,
      label: "armed light outputs after the switch",
      predicate: (value) => {
        const sacn = value?.shellState?.healthSnapshot?.checks?.engine?.sacn;
        return (
          value?.shellState?.lightingSnapshot?.outputArmed === true &&
          typeof sacn?.detail === "string" &&
          !sacn.detail.includes("held") &&
          rowsOf(value).some((row) => row?.action === "outputs-armed")
        );
      },
      statusPath: armSession.statusPath,
    });
    // Found by its action, not by its place: a console row can land after it
    // (the lane's engine heard the real TotalMix on the workstation until it
    // ran the simulated console, new pages program Slice 2b).
    const armedRow = rowsOf(armed).find((row) => row?.action === "outputs-armed");
    assert(armedRow.source === "ui", `Expected the switch's row to be the screen's, got ${JSON.stringify(armedRow)}.`);
    evidence.recordCheck("safe-start-holds-the-light-outputs-until-armed", {
      ...safeEvidence,
      armedDetail: armed.shellState.healthSnapshot.checks.engine.sacn.detail,
      armedRow: `${armedRow.source}: ${armedRow.detail}`,
      heldAcrossLaunches: true,
    });
  } finally {
    await closeTauriShell(armRun);
    armSession.cleanup();
    safeRuntime.cleanup();
  }
}

async function main() {
  evidence = createQualificationEvidence({ lane: "setup-support", rootDir });
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
}

// Runs only as `node scripts/tauri-setup-support-qualification.mjs`: an import
// does nothing (2026-09-26; the run makes an evidence folder and starts the dev
// server, engines and shells on scratch app data). The two paths are compared
// as real paths — through a directory junction or a short 8.3 name,
// `process.argv[1]` and `import.meta.url` spell the same file differently, and
// a plain comparison would skip the run without a word
// (scripts/dev-check-cli.mjs).
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
