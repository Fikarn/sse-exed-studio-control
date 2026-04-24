import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import dgram from "node:dgram";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createQualificationEvidence } from "./tauri-qualification-evidence.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const devServerPort = 4173;
const evidence = createQualificationEvidence({ lane: "workspaces", rootDir });

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

function createRuntimeDirs(prefix) {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  const appDataDir = path.join(root, "app-data");
  const logsDir = path.join(root, "logs");
  const updateRepoDir = path.join(root, "update-repository");

  mkdirSync(appDataDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });
  mkdirSync(updateRepoDir, { recursive: true });

  return {
    appDataDir,
    cleanup() {
      rmSync(root, { force: true, recursive: true });
    },
    logsDir,
    root,
    updateRepoDir,
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

function launchTauriShell({ appDataDir, commandPath, logsDir, statusPath, updateRepoDir }) {
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
    const child = launchTauriShell({
      appDataDir: runtime.appDataDir,
      commandPath: session.commandPath,
      logsDir: runtime.logsDir,
      statusPath: session.statusPath,
      updateRepoDir: runtime.updateRepoDir,
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

  let lightingFixtureId = null;
  let lightingCueId = null;
  let audioChannelId = null;
  let audioMixTargetId = null;
  let audioSnapshotId = null;
  let planningProjectTitle = null;

  console.log("Tauri workspace qualification: step 1/2 live migrated workspace flows.");

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
    assertWorkspaceReady(initialStatus, "setup");

    await dispatchCommand(firstSession, firstRun, "runCommissioningCheck", {
      request: {
        receivePort: audioReceivePort,
        sendHost: "127.0.0.1",
        sendPort: audioSendPort,
        target: "audio",
      },
    });
    await dispatchCommand(firstSession, firstRun, "runCommissioningCheck", {
      request: {
        bridgeIp: "127.0.0.1",
        target: "lighting",
        universe: 1,
      },
    });
    await dispatchCommand(firstSession, firstRun, "updateCommissioning", {
      request: {
        runnerStage: "publish",
        stage: "ready",
      },
    });
    await dispatchCommand(firstSession, firstRun, "seedPlanningDemo", {
      replaceExistingData: true,
    });
    evidence.recordCheck("commissioning-probes-and-publish-complete", {
      audioReceivePort,
      lightingUniverse: 1,
    });

    const lightingWorkspace = await dispatchCommand(firstSession, firstRun, "setWorkspace", {
      workspaceId: "lighting",
    });
    assertWorkspaceReady(lightingWorkspace.status, "lighting");
    const lightingSnapshot = lightingWorkspace.status.shellState.lightingSnapshot;
    const fixture = asArray(lightingSnapshot?.fixtures)[0];
    const scene = asArray(lightingSnapshot?.scenes)[0];
    let cue = asArray(lightingSnapshot?.cues)[0];
    assert(fixture?.id, "Expected live lighting snapshot to expose at least one fixture.");
    assert(scene?.id, "Expected live lighting snapshot to expose at least one scene.");
    assert(
      asArray(lightingWorkspace.status.shellState.lightingDmxMonitorSnapshot?.channels).length > 0,
      "Expected live lighting DMX monitor snapshot to expose channels."
    );
    lightingFixtureId = fixture.id;

    if (!cue?.id) {
      const cueCreate = await dispatchCommand(firstSession, firstRun, "createLightingCue", {
        request: {
          fadeInMs: 0,
          fadeOutMs: 0,
          label: "Live qualification cue",
          sceneId: scene.id,
        },
      });
      cue =
        asArray(cueCreate.status.shellState.lightingSnapshot?.cues).find(
          (entry) => entry?.label === "Live qualification cue"
        ) ?? null;
    }

    assert(cue?.id, "Expected live lighting cue create to expose a cue.");
    lightingCueId = cue.id;

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

    const cueFire = await dispatchCommand(firstSession, firstRun, "fireLightingCue", {
      cueId: lightingCueId,
      fadeOverrideMs: 0,
    });
    assert(
      cueFire.status.shellState.lightingSnapshot?.activeCueId === lightingCueId,
      "Expected live lighting cue fire to update activeCueId."
    );
    evidence.recordCheck("lighting-live-mutations-round-trip", {
      activeCueId: cueFire.status.shellState.lightingSnapshot?.activeCueId,
      fixtureId: lightingFixtureId,
    });

    const audioWorkspace = await dispatchCommand(firstSession, firstRun, "setWorkspace", {
      workspaceId: "audio",
    });
    assertWorkspaceReady(audioWorkspace.status, "audio");
    const audioSnapshot = audioWorkspace.status.shellState.audioSnapshot;
    assert(audioSnapshot?.verified === true, "Expected audio probe to make live audio snapshot verified.");
    const audioChannel =
      asArray(audioSnapshot?.channels).find((entry) => entry?.role === "front-preamp") ??
      asArray(audioSnapshot?.channels)[0];
    const audioMixTarget =
      asArray(audioSnapshot?.mixTargets).find((entry) => entry?.id !== audioSnapshot.selectedMixTargetId) ??
      asArray(audioSnapshot?.mixTargets)[0];
    const audioRecallSnapshot = asArray(audioSnapshot?.snapshots)[0];
    assert(audioChannel?.id, "Expected live audio snapshot to expose at least one channel.");
    assert(audioMixTarget?.id, "Expected live audio snapshot to expose at least one mix target.");
    assert(audioRecallSnapshot?.id, "Expected live audio snapshot to expose at least one recall snapshot.");
    audioChannelId = audioChannel.id;
    audioMixTargetId = audioMixTarget.id;
    audioSnapshotId = audioRecallSnapshot.id;

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
    const updatedAudioChannel = findById(audioChannelUpdate.status.shellState.audioSnapshot?.channels, audioChannelId);
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

    const audioRecall = await dispatchCommand(firstSession, firstRun, "recallAudioSnapshot", {
      snapshotId: audioSnapshotId,
    });
    assert(
      audioRecall.status.shellState.audioSnapshot?.lastRecalledSnapshotId === audioSnapshotId,
      "Expected live audio snapshot recall to update lastRecalledSnapshotId."
    );
    evidence.recordCheck("audio-live-mutations-round-trip", {
      channelId: audioChannelId,
      mixTargetId: audioMixTargetId,
      snapshotId: audioSnapshotId,
    });

    const planningWorkspace = await dispatchCommand(firstSession, firstRun, "setWorkspace", {
      workspaceId: "planning",
    });
    assertWorkspaceReady(planningWorkspace.status, "planning");
    const planningSnapshot = planningWorkspace.status.shellState.planningSnapshot;
    const project = asArray(planningSnapshot?.projects)[0];
    const task =
      asArray(planningSnapshot?.tasks).find((entry) => entry?.projectId === project?.id) ??
      asArray(planningSnapshot?.tasks)[0];
    assert(project?.id, "Expected live planning snapshot to expose a seeded project.");
    assert(task?.id, "Expected live planning snapshot to expose a seeded task.");

    planningProjectTitle = `Live Tauri Qualification ${Date.now()}`;
    const projectCreate = await dispatchCommand(firstSession, firstRun, "createPlanningProject", {
      request: {
        priority: "p2",
        status: "in-progress",
        title: planningProjectTitle,
      },
    });
    const createdProject = asArray(projectCreate.status.shellState.planningSnapshot?.projects).find(
      (entry) => entry?.title === planningProjectTitle
    );
    assert(createdProject?.id, "Expected live planning project creation to round-trip.");

    const taskCreate = await dispatchCommand(firstSession, firstRun, "createPlanningTask", {
      request: {
        labels: ["qualification"],
        priority: "p1",
        projectId: createdProject.id,
        title: "Live shell acceptance task",
      },
    });
    const createdTask = asArray(taskCreate.status.shellState.planningSnapshot?.tasks).find(
      (entry) => entry?.title === "Live shell acceptance task"
    );
    assert(createdTask?.id, "Expected live planning task creation to round-trip.");

    const reschedule = await dispatchCommand(firstSession, firstRun, "reschedulePlanningTask", {
      request: {
        scheduledDurationSeconds: 1800,
        scheduledStart: "2026-04-23T09:30:00Z",
        taskId: createdTask.id,
      },
    });
    const rescheduledTask = findById(reschedule.status.shellState.planningSnapshot?.tasks, createdTask.id);
    assert(
      rescheduledTask?.scheduledStart === "2026-04-23T09:30:00Z",
      "Expected live planning task reschedule to persist scheduledStart."
    );

    const completed = await dispatchCommand(firstSession, firstRun, "togglePlanningTaskComplete", {
      taskId: createdTask.id,
    });
    const completedTask = findById(completed.status.shellState.planningSnapshot?.tasks, createdTask.id);
    assert(
      completedTask?.completed === true,
      "Expected live planning task completion toggle to mark the task completed."
    );

    const timeReport = await dispatchCommand(firstSession, firstRun, "readPlanningTimeReport", {
      projectId: createdProject.id,
    });
    assert(
      timeReport.result && typeof timeReport.result === "object",
      "Expected live planning time report to return an object."
    );
    evidence.recordCheck("planning-live-mutations-round-trip", {
      projectTitle: planningProjectTitle,
      taskTitle: "Live shell acceptance task",
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

    assertWorkspaceReady(restartStatus, "planning");
    assert(
      restartStatus.shellState.appSnapshot?.startup?.targetSurface === "dashboard",
      "Expected restarted Tauri runtime to route to the dashboard after workspace qualification."
    );
    assert(
      findById(restartStatus.shellState.lightingSnapshot?.fixtures, lightingFixtureId)?.id === lightingFixtureId,
      "Expected restarted Tauri runtime to preserve the lighting fixture inventory."
    );
    assert(
      restartStatus.shellState.lightingSnapshot?.activeCueId === lightingCueId,
      "Expected restarted Tauri runtime to preserve the fired lighting cue."
    );
    assert(
      restartStatus.shellState.audioSnapshot?.selectedChannelId === audioChannelId,
      "Expected restarted Tauri runtime to preserve selected audio channel."
    );
    assert(
      restartStatus.shellState.audioSnapshot?.selectedMixTargetId === audioMixTargetId,
      "Expected restarted Tauri runtime to preserve selected audio mix target."
    );
    assert(
      restartStatus.shellState.audioSnapshot?.lastRecalledSnapshotId === audioSnapshotId,
      "Expected restarted Tauri runtime to preserve last recalled audio snapshot."
    );
    assert(
      asArray(restartStatus.shellState.planningSnapshot?.projects).some(
        (entry) => entry?.title === planningProjectTitle
      ),
      "Expected restarted Tauri runtime to preserve the created planning project."
    );
    evidence.recordCheck("restart-preserves-migrated-workspace-state", {
      activeCueId: restartStatus.shellState.lightingSnapshot?.activeCueId,
      activeWorkspace: restartStatus.shellState.activeWorkspace,
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
