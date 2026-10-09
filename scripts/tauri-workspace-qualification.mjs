import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import dgram from "node:dgram";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { hardenedLaneEnv, laneProcessEnv } from "./native-runtime-harness.mjs";
import { createQualificationEvidence } from "./tauri-qualification-evidence.mjs";
import { shellStillRunning } from "./tauri-shell-running.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const devServerPort = 4174;
// The lane's evidence folder; main() makes it, so an import makes nothing.
let evidence = null;

function needsCommandShell(command) {
  return process.platform === "win32" && /\.(bat|cmd)$/i.test(command);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function findById(entries, id) {
  return asArray(entries).find((entry) => entry && typeof entry === "object" && entry.id === id) ?? null;
}

async function assertTcpPortAvailable(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error) => {
      reject(
        new Error(
          `Tauri workspace qualification requires 127.0.0.1:${port}, but the port preflight failed (${error.code ?? "unknown"}: ${error.message}). Stop the stale dev/preview server and rerun.`
        )
      );
    });
    server.listen(port, "127.0.0.1", () => {
      server.close(resolve);
    });
  });
}

async function reserveUdpPort() {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    socket.once("error", (error) => {
      socket.close();
      reject(error);
    });
    socket.bind(0, "127.0.0.1", () => {
      const address = socket.address();
      socket.close(() => resolve(address.port));
    });
  });
}

async function createLightingProbeServer() {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      socket.end();
    });
    server.once("error", (error) => {
      console.warn(
        `Tauri workspace qualification: could not bind temporary lighting probe server on 127.0.0.1:80 (${error.code ?? "unknown"}: ${error.message}); continuing with the host's existing port state.`
      );
      resolve(null);
    });
    server.listen(80, "127.0.0.1", () => {
      resolve(server);
    });
  });
}

async function closeLightingProbeServer(server) {
  if (!server) {
    return;
  }

  await new Promise((resolve) => {
    server.close(resolve);
  });
}

function createRuntimeDirs(prefix) {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  const appDataDir = path.join(root, "app-data");
  const logsDir = path.join(root, "logs");

  mkdirSync(appDataDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });

  return {
    appDataDir,
    cleanup() {
      rmSync(root, { force: true, recursive: true });
    },
    logsDir,
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
// simulated console.
async function launchTauriShell({ appDataDir, commandPath, logsDir, statusPath }) {
  const env = laneProcessEnv(
    await hardenedLaneEnv(),
    {
      SSE_APP_DATA_DIR: appDataDir,
      SSE_LOG_DIR: logsDir,
      SSE_TAURI_TEST_COMMAND_PATH: commandPath,
      SSE_TAURI_TEST_STATUS_PATH: statusPath,
    },
    { label: "The workspace qualification's shell" }
  );
  const child = spawn(npmCommand, ["run", "tauri:dev", "--workspace", "frontend/app"], {
    cwd: rootDir,
    env,
    shell: needsCommandShell(npmCommand),
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

// New pages program, Slice 1: Planning has left the screen, and with it this
// lane's Planning round-trips and the Planning page it restarted on. The page
// the lane leaves on is Lighting. D47 (2026-10-09, D1 amended): the app opens
// on the Overview at every start, whatever page was saved, so the restart
// opens the Overview and writes it as the saved page (the deck's word); what
// was saved is proved by the rest of the restart's checks. Until D47 the
// restart came back on Lighting, the page saved.
const SAVED_WORKSPACE = "lighting";
/** The page the app opens on at every start once the setup is published (D47). */
const LANDING_WORKSPACE = "overview";
const SCOPE_CHANGED =
  "D47 (2026-10-09): the lane leaves on Lighting and the restart opens the Overview, the page the app opens on at every start, and saves it; the scene, the console's selection and its last read prove the saved data. Until D47 the restart came back on Lighting. New pages program, Slice 1: no Planning project is checked; until then the page was Planning and a created Planning project had to survive the restart.";
// 2026-10-01 (the owner's decision, after the studio walk): the Console's
// snapshots are TotalMix's own. The lane loads TotalMix's slot 2 through the
// test bridge, as the operator's second press does; on the simulated console
// nothing is sent and the slot becomes active.
const AUDIO_LOAD_SLOT = 2;
const AUDIO_LOAD_CHANGED =
  "2026-10-01: the lane loads TotalMix's snapshot slot 2 and checks the slot reads active, and after the restart that the load was the console's last read; until then it recalled the app's first snapshot and checked lastRecalledSnapshotId.";

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

async function closeTauriShell(child) {
  // Gone means the whole group on Linux, not the npm leader: a leader that
  // has exited can leave vite or the shell behind, and they are signalled too.
  if (!shellStillRunning(child)) {
    return;
  }

  try {
    if (process.platform === "win32") {
      if (child.pid) {
        spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      } else {
        child.kill("SIGTERM");
      }
    } else if (child.pid) {
      process.kill(-child.pid, "SIGTERM");
    }
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") {
      throw error;
    }
    return;
  }

  // Until the shell's whole process group has gone (`tauri-shell-running.mjs`):
  // the leader's exitCode stays null after a signal, so waiting on it alone
  // ran out the deadline on every close.
  const deadline = Date.now() + 5_000;
  while (shellStillRunning(child) && Date.now() < deadline) {
    await delay(100);
  }

  if (shellStillRunning(child)) {
    try {
      if (process.platform === "win32") {
        if (child.pid) {
          spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        } else {
          child.kill("SIGKILL");
        }
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

function assertWorkspaceReady(status, workspaceId) {
  assert(
    status.shellState?.lifecycle === "ready",
    `Expected shell lifecycle 'ready', got '${status.shellState?.lifecycle}'.`
  );
  assert(
    status.shellState?.activeWorkspace === workspaceId,
    `Expected active workspace '${workspaceId}', got '${status.shellState?.activeWorkspace}'.`
  );
}

async function launchRestartReadySession(runtime) {
  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const session = createSessionFiles("sse-tauri-workspace-session-");
    const child = await launchTauriShell({
      appDataDir: runtime.appDataDir,
      commandPath: session.commandPath,
      logsDir: runtime.logsDir,
      statusPath: session.statusPath,
    });

    try {
      const status = await waitForStatus({
        child,
        label: "restart ready state",
        predicate: (value) => value?.shellState?.lifecycle === "ready",
        statusPath: session.statusPath,
      });

      return { child, session, status };
    } catch (error) {
      lastError = error;
      const lastStatus = readJson(session.statusPath);
      await closeTauriShell(child);
      session.cleanup();

      if (lastStatus || attempt === 2) {
        throw error;
      }

      console.warn("Tauri workspace qualification: restart shell produced no status file; retrying launch once.");
      await delay(2_500);
      await assertTcpPortAvailable(devServerPort);
    }
  }

  throw lastError ?? new Error("Tauri workspace qualification restart launch failed.");
}

async function runWorkspaceQualification() {
  await assertTcpPortAvailable(devServerPort);

  const runtime = createRuntimeDirs("sse-tauri-workspaces-");
  const firstSession = createSessionFiles("sse-tauri-workspace-session-");
  const audioReceivePort = await reserveUdpPort();
  const audioSendPort = audioReceivePort === 65535 ? 65534 : audioReceivePort + 1;

  let lightingFixtureId;
  let lightingRecalledSceneId;
  let audioChannelId;
  let audioMixTargetId;
  let audioLoadSummary;

  console.log("Tauri workspace qualification: step 1/2 live migrated workspace flows.");

  const firstRun = await launchTauriShell({
    appDataDir: runtime.appDataDir,
    commandPath: firstSession.commandPath,
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
    assertWorkspaceReady(initialStatus, "setup");

    // All three probes run (the audio probe against the simulated console
    // since Slice 2b of the new pages program). The engine refuses `stage:
    // ready` while any probe is not `passed` (2026-09 audit Slice 8). The
    // deck's probe passes only when Companion has asked the bridge in the last
    // 5 s (2026-09-29), and no Companion asks a lane's bridge, so the explicit
    // override is always sent.
    await dispatchCommand(firstSession, firstRun, "runCommissioningCheck", {
      request: {
        target: "control-surface",
      },
    });
    await dispatchCommand(firstSession, firstRun, "runCommissioningCheck", {
      request: {
        receivePort: audioReceivePort,
        sendHost: "127.0.0.1",
        sendPort: audioSendPort,
        target: "audio",
      },
    });
    const lightingProbeServer = await createLightingProbeServer();
    try {
      await dispatchCommand(firstSession, firstRun, "runCommissioningCheck", {
        request: {
          bridgeIp: "127.0.0.1",
          target: "lighting",
          universe: 1,
        },
      });
    } finally {
      await closeLightingProbeServer(lightingProbeServer);
    }
    const overrideProbes = true;
    await dispatchCommand(firstSession, firstRun, "updateCommissioning", {
      request: {
        runnerStage: "publish",
        stage: "ready",
        ...(overrideProbes ? { overrideProbes: true } : {}),
      },
    });
    evidence.recordCheck("commissioning-probes-and-publish-complete", {
      audioReceivePort,
      lightingUniverse: 1,
      overrideProbes,
    });

    const lightingWorkspace = await dispatchCommand(firstSession, firstRun, "setWorkspace", {
      workspaceId: "lighting",
    });
    assertWorkspaceReady(lightingWorkspace.status, "lighting");
    const lightingSnapshot = lightingWorkspace.status.shellState.lightingSnapshot;
    const fixture = asArray(lightingSnapshot?.fixtures)[0];
    const scene = asArray(lightingSnapshot?.scenes)[0];
    assert(fixture?.id, "Expected live lighting snapshot to expose at least one fixture.");
    assert(scene?.id, "Expected live lighting snapshot to expose at least one scene.");
    assert(
      asArray(lightingWorkspace.status.shellState.lightingDmxMonitorSnapshot?.channels).length > 0,
      "Expected live lighting DMX monitor snapshot to expose channels."
    );
    lightingFixtureId = fixture.id;

    const lightingUpdate = await dispatchCommand(firstSession, firstRun, "updateLightingFixture", {
      request: {
        cct: 5600,
        fixtureId: lightingFixtureId,
        intensity: 37,
        spatialX: 0.42,
        spatialY: 0.58,
      },
    });
    const updatedFixture = findById(lightingUpdate.status.shellState.lightingSnapshot?.fixtures, lightingFixtureId);
    assert(updatedFixture?.intensity === 37, "Expected live lighting fixture intensity update to round-trip.");
    assert(updatedFixture?.cct === 5600, "Expected live lighting fixture CCT update to round-trip.");

    // Direction D recall model: scene recall (no cue indirection) is the
    // mutation that survives a Tauri restart for the lighting workspace.
    const sceneRecall = await dispatchCommand(firstSession, firstRun, "recallLightingScene", {
      sceneId: scene.id,
      fadeDurationSeconds: 0,
    });
    assert(
      sceneRecall.status.shellState.lightingSnapshot?.lastRecalledSceneId === scene.id,
      "Expected live lighting scene recall to update lastRecalledSceneId."
    );
    lightingRecalledSceneId = scene.id;
    evidence.recordCheck("lighting-live-mutations-round-trip", {
      lastRecalledSceneId: sceneRecall.status.shellState.lightingSnapshot?.lastRecalledSceneId,
      fixtureId: lightingFixtureId,
    });

    const audioWorkspace = await dispatchCommand(firstSession, firstRun, "setWorkspace", {
      workspaceId: "audio",
    });
    assertWorkspaceReady(audioWorkspace.status, "audio");
    const audioSnapshot = audioWorkspace.status.shellState.audioSnapshot;

    // The audio block runs against the simulated console, whose probe passes
    // on any host; until 2026-10-09 CI skipped it (no TotalMix there).
    {
      assert(audioSnapshot?.verified === true, "Expected audio probe to make live audio snapshot verified.");
      const audioChannel =
        asArray(audioSnapshot?.channels).find((entry) => entry?.role === "front-preamp") ??
        asArray(audioSnapshot?.channels)[0];
      const audioMixTarget =
        asArray(audioSnapshot?.mixTargets).find((entry) => entry?.id !== audioSnapshot.selectedMixTargetId) ??
        asArray(audioSnapshot?.mixTargets)[0];
      // 2026-10-01: the Console's snapshots are TotalMix's eight slots, always
      // listed; the lane loads slot 2 (it recalled the app's first snapshot).
      const consoleSlots = asArray(audioSnapshot?.consoleSnapshots?.slots);
      assert(audioChannel?.id, "Expected live audio snapshot to expose at least one channel.");
      assert(audioMixTarget?.id, "Expected live audio snapshot to expose at least one mix target.");
      assert(
        consoleSlots.length === 8 && consoleSlots[1]?.slot === AUDIO_LOAD_SLOT,
        `Expected the audio snapshot to list TotalMix's eight snapshot slots, got ${JSON.stringify(consoleSlots)}.`
      );
      audioChannelId = audioChannel.id;
      audioMixTargetId = audioMixTarget.id;

      const audioSync = await dispatchCommand(firstSession, firstRun, "syncAudio");
      assert(
        audioSync.status.shellState.audioSnapshot?.consoleStateConfidence === "aligned",
        "Expected live audio sync to align console state."
      );

      const audioSettings = await dispatchCommand(firstSession, firstRun, "updateAudioSettings", {
        request: {
          selectedChannelId: audioChannelId,
          selectedMixTargetId: audioMixTargetId,
        },
      });
      assert(
        audioSettings.status.shellState.audioSnapshot?.selectedChannelId === audioChannelId,
        "Expected live audio selected channel setting to round-trip."
      );
      assert(
        audioSettings.status.shellState.audioSnapshot?.selectedMixTargetId === audioMixTargetId,
        "Expected live audio selected mix target setting to round-trip."
      );

      const audioChannelUpdate = await dispatchCommand(firstSession, firstRun, "updateAudioChannel", {
        request: {
          channelId: audioChannelId,
          mute: true,
        },
      });
      const updatedAudioChannel = findById(
        audioChannelUpdate.status.shellState.audioSnapshot?.channels,
        audioChannelId
      );
      assert(updatedAudioChannel?.mute === true, "Expected live audio channel mute update to round-trip.");

      const audioTargetUpdate = await dispatchCommand(firstSession, firstRun, "updateAudioMixTarget", {
        request: {
          dim: true,
          mixTargetId: audioMixTargetId,
        },
      });
      const updatedAudioTarget = findById(
        audioTargetUpdate.status.shellState.audioSnapshot?.mixTargets,
        audioMixTargetId
      );
      assert(updatedAudioTarget?.dim === true, "Expected live audio mix target dim update to round-trip.");

      // The simulated console sends nothing: the slot becomes active and the
      // reply says so in the hardware link's own sentence.
      const audioLoad = await dispatchCommand(firstSession, firstRun, "loadAudioSnapshot", {
        slot: AUDIO_LOAD_SLOT,
      });
      const loaded = audioLoad.result;
      assert(
        loaded?.loaded === true && loaded?.slot === AUDIO_LOAD_SLOT,
        `Expected the TotalMix snapshot load to answer for slot ${AUDIO_LOAD_SLOT}, got ${JSON.stringify(loaded)}.`
      );
      const loadedLabel = typeof loaded.name === "string" ? loaded.name : `slot ${AUDIO_LOAD_SLOT}`;
      audioLoadSummary = `Loaded ${loadedLabel} on the simulated console; nothing was sent (test mode).`;
      assert(
        loaded.summary === audioLoadSummary,
        `Expected the load's summary '${audioLoadSummary}', got '${loaded.summary}'.`
      );
      const loadedSlots = asArray(audioLoad.status.shellState.audioSnapshot?.consoleSnapshots?.slots);
      assert(
        loadedSlots[AUDIO_LOAD_SLOT - 1]?.state === "active",
        `Expected TotalMix's slot ${AUDIO_LOAD_SLOT} to read active after the load, got ${JSON.stringify(loadedSlots)}.`
      );
      evidence.recordCheck("audio-live-mutations-round-trip", {
        channelId: audioChannelId,
        loadedSlot: AUDIO_LOAD_SLOT,
        loadedSummary: loaded.summary,
        markerChanged: AUDIO_LOAD_CHANGED,
        mixTargetId: audioMixTargetId,
      });
    }

    // The page the operator leaves on is saved: the lane ends on it, and the
    // restart below opens the Overview all the same (D47).
    const finalWorkspace = await dispatchCommand(firstSession, firstRun, "setWorkspace", {
      workspaceId: SAVED_WORKSPACE,
    });
    assertWorkspaceReady(finalWorkspace.status, SAVED_WORKSPACE);

    // 2026-09 production readiness, Slice 11 (F30): what this lane did on
    // screen is in the action log with the screen as its source. The scene
    // recall above is a row; the fixture's intensity and colour temperature
    // were rides and are not. Recording an action raises no event (it would
    // cost every action a request), so the list is fetched — as opening
    // Setup fetches it — and needs no wait: the row is on disk before the
    // hardware link answers the request that made it.
    const refreshed = await dispatchCommand(firstSession, firstRun, "refresh");
    const recentEvents = asArray(refreshed.status.shellState.supportSnapshot?.recentEvents);
    const recallRow = recentEvents.find((row) => row?.action === "scene-recalled");
    assert(
      recallRow?.source === "ui" && typeof recallRow.detail === "string" && recallRow.detail.length > 0,
      `Expected the scene recall in Recent actions with the screen as its source, got ${JSON.stringify(recentEvents)}.`
    );
    assert(
      recentEvents.every((row) => ["ui", "deck", "console", "launch"].includes(row?.source)),
      `Expected every recent action to name a known source, got ${JSON.stringify(recentEvents)}.`
    );
    assert(
      !recentEvents.some((row) => row?.action === "light-on" || row?.action === "light-off"),
      `Expected the fixture's intensity ride to leave no row, got ${JSON.stringify(recentEvents)}.`
    );
    evidence.recordCheck("ui-actions-appear-in-recent-actions", {
      recallRow: `${recallRow.source}: ${recallRow.detail}`,
      rows: recentEvents.length,
    });
  } finally {
    await closeTauriShell(firstRun);
    firstSession.cleanup();
  }

  await delay(1_500);
  await assertTcpPortAvailable(devServerPort);

  console.log("Tauri workspace qualification: step 2/2 restart persistence across migrated workspaces.");

  let restartSession = null;

  try {
    restartSession = await launchRestartReadySession(runtime);
    const restartStatus = restartSession.status;

    // D47: the start opens the Overview though Lighting was saved, and writes
    // it before the shell is ready, so the saved page (the deck's word) says
    // it too.
    assertWorkspaceReady(restartStatus, LANDING_WORKSPACE);
    assert(
      restartStatus.shellState.appSnapshot?.shell?.workspace === LANDING_WORKSPACE,
      `Expected the restarted Tauri runtime to save the page it opened on, '${LANDING_WORKSPACE}', got '${restartStatus.shellState.appSnapshot?.shell?.workspace}'.`
    );
    assert(
      restartStatus.shellState.appSnapshot?.startup?.targetSurface === "dashboard",
      "Expected restarted Tauri runtime to route to the dashboard after workspace qualification."
    );
    assert(
      findById(restartStatus.shellState.lightingSnapshot?.fixtures, lightingFixtureId)?.id === lightingFixtureId,
      "Expected restarted Tauri runtime to preserve the lighting fixture inventory."
    );
    assert(
      restartStatus.shellState.lightingSnapshot?.lastRecalledSceneId === lightingRecalledSceneId,
      "Expected restarted Tauri runtime to preserve the recalled lighting scene."
    );
    {
      assert(
        restartStatus.shellState.audioSnapshot?.selectedChannelId === audioChannelId,
        "Expected restarted Tauri runtime to preserve selected audio channel."
      );
      assert(
        restartStatus.shellState.audioSnapshot?.selectedMixTargetId === audioMixTargetId,
        "Expected restarted Tauri runtime to preserve selected audio mix target."
      );
      // 2026-10-01: TotalMix reports its slots again after a restart, so what
      // is checked is what was saved: the load was the console's last read
      // (it was the app's last recalled snapshot).
      assert(
        restartStatus.shellState.audioSnapshot?.lastConsoleSyncReason === "simulated-load",
        `Expected restarted Tauri runtime to keep the load as the console's last read, got '${restartStatus.shellState.audioSnapshot?.lastConsoleSyncReason}'.`
      );
    }
    evidence.recordCheck("restart-preserves-migrated-workspace-state", {
      lastRecalledSceneId: restartStatus.shellState.lightingSnapshot?.lastRecalledSceneId,
      activeWorkspace: restartStatus.shellState.activeWorkspace,
      audioLastActionMessage: restartStatus.shellState.audioSnapshot?.lastActionMessage ?? null,
      audioLastConsoleSyncReason: restartStatus.shellState.audioSnapshot?.lastConsoleSyncReason ?? null,
      expectedAudioLoadSummary: audioLoadSummary ?? null,
      scopeChanged: SCOPE_CHANGED,
      selectedAudioChannelId: restartStatus.shellState.audioSnapshot?.selectedChannelId,
    });
  } finally {
    if (restartSession) {
      await closeTauriShell(restartSession.child);
      restartSession.session.cleanup();
    }
    runtime.cleanup();
  }
}

async function main() {
  evidence = createQualificationEvidence({ lane: "workspaces", rootDir });
  try {
    await runWorkspaceQualification();
    console.log(`Tauri workspace qualification evidence: ${evidence.write("passed")}`);
    console.log("Tauri workspace qualification passed.");
  } catch (error) {
    evidence.write("failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// Runs only as `node scripts/tauri-workspace-qualification.mjs`: an import does
// nothing (2026-09-26; the run makes an evidence folder and starts the dev
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
