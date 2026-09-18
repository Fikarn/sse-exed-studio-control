// Part of the fixture double (`../fixtureTransport.ts`): the in-memory stand-in for the
// hardware link that Playwright and the browser fixture mode run against. Test-only.
import { type FixtureRequestContext, type FixtureRequestResult, NOT_HANDLED } from "./requestContext";
import type { RequestMethod, JsonObject } from "../../generated/protocol";
import { asRecord, cloneJson, asString, asNumber, asArray } from "./json";
import {
  normalizeTalentMarks,
  synchronizeFixtureState,
  ensureCommissioningChecks,
  normalizeRunnerStage,
  legacyStageFromRunnerStage,
  validateIpv4,
  updateFixtureCheck,
  validatePort,
  countControls,
  buildFixtureBackupEntry,
  countPlanningActivity,
  findFixtureBackup,
} from "./state";
import type { CommissioningStage, RunnerStage, CommissioningCheckTarget } from "../../types";
import { buildSeededPlanningSnapshot } from "./planning";

/** Setup / Support's requests: shell settings, commissioning, backups, the Stream Deck profile export. */
export function handleFixtureSetupRequest(
  context: FixtureRequestContext,
  method: RequestMethod,
  params: JsonObject
): FixtureRequestResult {
  const { state, emit } = context;
  switch (method) {
    case "settings.update": {
      if (typeof params.workspace === "string") {
        const shell = asRecord(state.appSnapshot.shell) ?? {};
        shell.workspace = params.workspace;
        state.appSnapshot.shell = shell;
        emit("settings.changed", { reason: "workspace-updated" });
      }
      const setup = asRecord(params.setup);
      if (typeof setup?.activeSection === "string") {
        const shell = asRecord(state.appSnapshot.shell) ?? {};
        const shellSetup = asRecord(shell.setup) ?? {};
        shellSetup.activeSection = setup.activeSection;
        shell.setup = shellSetup;
        state.appSnapshot.shell = shell;
        emit("settings.changed", { reason: "setup-section-updated" });
      }
      const lighting = asRecord(params.lighting);
      let shellSettingsChanged = false;
      if (lighting && "currentSectionId" in lighting) {
        const shell = asRecord(state.appSnapshot.shell) ?? {};
        const shellLighting = asRecord(shell.lighting) ?? {};
        shellLighting.currentSectionId =
          typeof lighting.currentSectionId === "string" ? lighting.currentSectionId : null;
        shell.lighting = shellLighting;
        state.appSnapshot.shell = shell;
        shellSettingsChanged = true;
      }
      if (lighting && "sceneThumbs" in lighting) {
        const shell = asRecord(state.appSnapshot.shell) ?? {};
        const shellLighting = asRecord(shell.lighting) ?? {};
        shellLighting.sceneThumbs = asRecord(lighting.sceneThumbs) ?? {};
        shell.lighting = shellLighting;
        state.appSnapshot.shell = shell;
        shellSettingsChanged = true;
      }
      if (lighting && "talentMarks" in lighting) {
        const shell = asRecord(state.appSnapshot.shell) ?? {};
        const shellLighting = asRecord(shell.lighting) ?? {};
        shellLighting.talentMarks = normalizeTalentMarks(lighting.talentMarks);
        shell.lighting = shellLighting;
        state.appSnapshot.shell = shell;
        shellSettingsChanged = true;
      }
      if (shellSettingsChanged) {
        emit("settings.changed", { reason: "lighting-shell-state-updated" });
      }
      synchronizeFixtureState(state);
      return cloneJson(state.appSnapshot);
    }
    case "commissioning.update": {
      if (params.stage === "ready") {
        // 2026-09 audit Slice 8: mirror the engine's publish gate. Publishing
        // is refused while a probe is not passed unless overrideProbes is
        // explicit; an override is recorded, a clean publish clears it.
        const probeIds = new Set(["control-surface", "lighting", "audio"]);
        const failing = ensureCommissioningChecks(state)
          .filter((check) => probeIds.has(asString(check.id)))
          .filter((check) => asString(check.status) !== "passed" && asString(check.status) !== "ok")
          .map((check) => `${asString(check.label)} ${asString(check.status) === "failed" ? "failed" : "not run"}`);
        if (failing.length > 0 && params.overrideProbes !== true) {
          throw new Error(
            `Publish refused: ${failing.join(", ")}. Run the probes until they pass, or publish with the explicit override to record the exception.`
          );
        }
        state.commissioningSnapshot.publishOverrideAt = failing.length > 0 ? new Date().toISOString() : null;
      }
      if (typeof params.stage === "string") {
        state.commissioningSnapshot.stage = params.stage as CommissioningStage;
        state.commissioningSnapshot.runnerStage = normalizeRunnerStage(
          state.commissioningSnapshot.runnerStage,
          params.stage
        );
        state.commissioningSnapshot.hasCompletedSetup = params.stage === "ready";
      }
      if (typeof params.runnerStage === "string") {
        state.commissioningSnapshot.runnerStage = normalizeRunnerStage(
          params.runnerStage,
          state.commissioningSnapshot.stage
        );
        state.commissioningSnapshot.stage =
          typeof params.stage === "string"
            ? (params.stage as CommissioningStage)
            : legacyStageFromRunnerStage(state.commissioningSnapshot.runnerStage as RunnerStage, false);
        state.commissioningSnapshot.hasCompletedSetup = state.commissioningSnapshot.stage === "ready";
      }
      if (typeof params.hardwareProfile === "string" && params.hardwareProfile.trim()) {
        state.commissioningSnapshot.hardwareProfile = params.hardwareProfile.trim();
      }
      synchronizeFixtureState(state);
      emit("app.changed", { reason: "commissioning-updated" });
      emit("commissioning.changed", { reason: "commissioning-updated" });
      return cloneJson(state.appSnapshot);
    }
    case "commissioning.check.run": {
      const target = asString(params.target) as CommissioningCheckTarget;

      if (target === "lighting") {
        const bridgeIp = asString(params.bridgeIp, asString(asRecord(state.commissioningSnapshot.lighting)?.bridgeIp));
        const universe = asNumber(
          params.universe,
          asNumber(asRecord(state.commissioningSnapshot.lighting)?.universe, 1)
        );
        if (!bridgeIp || !validateIpv4(bridgeIp)) {
          throw new Error("bridgeIp is required and must be a valid IPv4 address");
        }
        if (!Number.isInteger(universe) || universe < 1 || universe > 63999) {
          throw new Error("universe must be between 1 and 63999");
        }
        state.commissioningSnapshot.lighting = { bridgeIp, universe };
        // 2026-09 audit Slice 8: a deterministic failure so specs can drive
        // the publish gate — 0.0.0.0 is never a reachable bridge.
        if (bridgeIp === "0.0.0.0") {
          updateFixtureCheck(state, "lighting", "failed", `Bridge ${bridgeIp} did not answer the sACN probe.`);
        } else {
          updateFixtureCheck(state, "lighting", "passed", `Bridge probe reached ${bridgeIp} on universe ${universe}.`);
        }
      } else if (target === "audio") {
        const sendHost = asString(
          params.sendHost,
          asString(asRecord(state.commissioningSnapshot.audio)?.sendHost, "127.0.0.1")
        );
        const sendPort = asNumber(
          params.sendPort,
          asNumber(asRecord(state.commissioningSnapshot.audio)?.sendPort, 7001)
        );
        const receivePort = asNumber(
          params.receivePort,
          asNumber(asRecord(state.commissioningSnapshot.audio)?.receivePort, 9001)
        );
        if (!sendHost || (!validateIpv4(sendHost) && sendHost !== "127.0.0.1" && sendHost !== "localhost")) {
          throw new Error("sendHost must be localhost or a valid IPv4 address");
        }
        if (!validatePort(sendPort) || !validatePort(receivePort)) {
          throw new Error("sendPort and receivePort must be between 1 and 65535");
        }
        state.commissioningSnapshot.audio = { sendHost, sendPort, receivePort };
        if (sendPort === 1) {
          // Deterministic failure for the publish-gate specs (Slice 8).
          updateFixtureCheck(state, "audio", "failed", `No TotalMix answer on ${sendHost}:${sendPort}.`);
        } else {
          updateFixtureCheck(
            state,
            "audio",
            "passed",
            `OSC transport config accepted for ${sendHost} (send ${sendPort}, receive ${receivePort}).`
          );
        }
      } else if (target === "control-surface") {
        updateFixtureCheck(
          state,
          "control-surface",
          "passed",
          `Control surface bridge exposes ${countControls(state)} mapped controls across ${asArray(state.controlSurfaceSnapshot.pages).length} pages.`
        );
      } else {
        throw new Error("target must be one of: control-surface, lighting, audio");
      }

      if (
        normalizeRunnerStage(state.commissioningSnapshot.runnerStage, state.commissioningSnapshot.stage) !== "publish"
      ) {
        state.commissioningSnapshot.runnerStage = "probe";
      }

      synchronizeFixtureState(state);
      emit("commissioning.changed", { reason: "check-updated" });
      if (target === "audio") {
        // Mirrors the engine: the audio probe outcome changes the audio
        // capabilities, so audio consumers re-derive their state.
        emit("audio.changed", { reason: "probe-updated" });
      }
      return cloneJson(state.commissioningSnapshot);
    }
    case "commissioning.seedPlanningDemo": {
      state.planningSnapshot = buildSeededPlanningSnapshot();
      synchronizeFixtureState(state);
      emit("planning.changed", { reason: "sample-planning-seeded" });
      emit("commissioning.changed", { reason: "sample-planning-seeded" });
      return cloneJson(state.commissioningSnapshot);
    }
    case "support.backup.export": {
      const backupEntry = buildFixtureBackupEntry(state);
      const backups = asArray(state.supportSnapshot.backups)
        .map((entry) => asRecord(entry))
        .filter((entry): entry is JsonObject => entry !== null);
      backups.unshift(backupEntry);
      state.supportSnapshot.backups = backups;
      synchronizeFixtureState(state);
      emit("support.changed", { reason: "backup-exported" });
      return {
        actionCount: countControls(state),
        activityEntryCount: countPlanningActivity(state),
        fileName: backupEntry.name,
        formatVersion: 4,
        path: backupEntry.path,
        projectCount: asNumber(state.commissioningSnapshot.planningProjectCount, 0),
        taskCount: asNumber(state.commissioningSnapshot.planningTaskCount, 0),
      };
    }
    case "support.backup.verify": {
      const path = asString(params.path);
      const match = findFixtureBackup(state, path);
      const kind = path.endsWith(".sqlite3") ? "database" : "archive";
      const projectCount = asNumber(state.commissioningSnapshot.planningProjectCount, 0);
      const taskCount = asNumber(state.commissioningSnapshot.planningTaskCount, 0);
      if (kind === "database") {
        return {
          detail: `Database backup, schema 6, integrity ok: ${projectCount} projects, ${taskCount} tasks and 40 settings.`,
          kind,
          ok: true,
          path,
          schemaVersion: 6,
        };
      }
      const exportedAt = new Date(asNumber(match?.modifiedAt, Date.now())).toISOString();
      return {
        detail: `Backup archive, format 4, exported ${exportedAt}: ${projectCount} projects and ${taskCount} tasks.`,
        formatVersion: 4,
        kind,
        ok: true,
        path,
      };
    }
    case "support.backup.restore": {
      const path = asString(params.path);
      findFixtureBackup(state, path);
      const legacyImport = path.endsWith("db.json");
      // A database backup is staged and applied at the next start; the
      // store restarts the link on `requiresRestart` (Slice 7 — F20).
      const databaseRestore = path.endsWith(".sqlite3");

      state.planningSnapshot = buildSeededPlanningSnapshot();
      state.commissioningSnapshot.runnerStage = "publish";
      state.commissioningSnapshot.stage = "ready";
      state.commissioningSnapshot.hasCompletedSetup = true;
      updateFixtureCheck(
        state,
        "control-surface",
        "passed",
        "Control surface bridge is reachable and restored bindings are current."
      );
      updateFixtureCheck(state, "lighting", "passed", "Lighting bridge settings were restored from support backup.");
      updateFixtureCheck(state, "audio", "passed", "Audio transport settings were restored from support backup.");
      synchronizeFixtureState(state);
      if (databaseRestore) {
        emit("support.changed", { reason: "backup-restore-staged" });
      } else {
        emit("support.changed", { reason: "backup-restored" });
        emit("commissioning.changed", { reason: "backup-restored" });
        emit("planning.changed", { reason: "backup-restored" });
        emit("app.changed", { reason: "backup-restored" });
      }
      return {
        activityEntryCount: countPlanningActivity(state),
        checklistItemCount: Math.max(1, Math.floor(asNumber(state.commissioningSnapshot.planningTaskCount, 0) / 2)),
        projectCount: asNumber(state.commissioningSnapshot.planningProjectCount, 0),
        requiresRestart: databaseRestore,
        rollbackBackupPath: buildFixtureBackupEntry(state).path,
        settingsRestored: 12,
        sourceFormat: databaseRestore ? "database-backup" : legacyImport ? "legacy-db-json" : "native-support-backup",
        sourcePath: path,
        taskCount: asNumber(state.commissioningSnapshot.planningTaskCount, 0),
      };
    }
    case "exports.companion.export": {
      const runtime = asRecord(state.appSnapshot.runtime) ?? {};
      const controlSurface = asRecord(runtime.controlSurface) ?? {};
      const baseUrl = asString(params.baseUrl, asString(controlSurface.baseUrl, "http://127.0.0.1:38201"));
      const pageCount = asArray(state.controlSurfaceSnapshot.pages).length;
      return {
        actionCount: countControls(state),
        baseUrl,
        fileName: "sse-exed-studio-control-native-fixture.companionconfig",
        pageCount,
        path: `${asString(asRecord(runtime.paths)?.appDataDir)}/exports/sse-exed-studio-control-native-fixture.companionconfig`,
      };
    }
    default:
      return NOT_HANDLED;
  }
}
