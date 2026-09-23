// Part of the fixture double (`../fixtureTransport.ts`): the in-memory stand-in for the
// hardware link that Playwright and the browser fixture mode run against. Test-only.
import { type FixtureRequestContext, type FixtureRequestResult, NOT_HANDLED } from "./requestContext";
import type { RequestMethod, JsonObject } from "../../generated/protocol";
import { cloneJson, asRecord, asBoolean, asString, asArray, asNumber } from "./json";
import {
  buildLightingDmxMonitorSnapshot,
  buildDefaultLightingSnapshot,
  lightingFixtures,
  lightingPalettes,
  normalizePaletteKind,
  validatePaletteValue,
  parseLightingColorIndex,
  nextCustomPaletteId,
  formatLightingPaletteValue,
  normalizePaletteValue,
  lightingPreviewActive,
  applyLightingPaletteToFixture,
  lightingScenes,
  previewFixturesFromScene,
  nextCustomSceneId,
  sceneFixtureStateFromFixture,
  clearLightingPreview,
  nextCustomFixtureId,
  normalizeControlValues,
  synchronizeLightingGroupCounts,
  asNumberRecord,
  clampNumber,
  defaultLightingBeamAngle,
  buildLightingFixtureUpdateSummary,
  nextCustomGroupId,
} from "./lighting";
import { synchronizeFixtureState } from "./state";
import {
  type IdentifyBursts,
  IDENTIFY_DEFAULT_DURATION_MS,
  IDENTIFY_MAX_MS,
  IDENTIFY_MIN_MS,
  IDENTIFY_SEQUENCE_MAX_FIXTURES,
  lightingIdList,
  lightingSnapshotView,
} from "./lightingOverlay";
import {
  fixtureDefinitionByIdentity,
  fixtureDefinitionSelectable,
  fixtureModeForDefinition,
  fixtureTypeForDefinition,
  fixtureProfileForFixture,
  lightingFixtureMaxStartAddress,
  lightingFixtureChannelCount,
  defaultLightingFixtureCct,
  lightingFixtureCctRange,
} from "./lightingCatalog";

/** The `lighting.*` requests: snapshots, preview mode, palettes, scenes, fixtures, groups, power. */
export function handleFixtureLightingRequest(
  context: FixtureRequestContext,
  method: RequestMethod,
  params: JsonObject
): FixtureRequestResult {
  const { state, emit } = context;
  switch (method) {
    // Read as the hardware link reads it: identify, highlight and solo shown
    // over the stored rig, the scenes pinned first — the DMX monitor included.
    case "lighting.snapshot":
      return lightingSnapshotView(state.lightingSnapshot, state.lightingIdentifyBursts, Date.now());
    case "lighting.fixtureCatalog.snapshot":
      return cloneJson(state.lightingFixtureCatalogSnapshot);
    case "lighting.dmxMonitor.snapshot":
      return buildLightingDmxMonitorSnapshot(
        lightingSnapshotView(state.lightingSnapshot, state.lightingIdentifyBursts, Date.now())
      );
    case "lighting.editor.previewMode": {
      const enabled = asBoolean(params.enabled, false);
      const patchModeActive = asBoolean(params.patchModeActive, asBoolean(params.patchMode, false));
      if (enabled && patchModeActive) {
        throw new Error("Exit patch mode before enabling lighting preview mode.");
      }
      const lightingSnapshot = asRecord(state.lightingSnapshot) ?? buildDefaultLightingSnapshot();
      lightingSnapshot.previewMode = enabled;
      lightingSnapshot.previewDirty = false;
      lightingSnapshot.previewSceneId = enabled
        ? asString(lightingSnapshot.lastRecalledSceneId) || asString(lightingSnapshot.selectedSceneId) || null
        : null;
      lightingSnapshot.previewFixtures = enabled ? cloneJson(lightingFixtures(lightingSnapshot)) : [];
      state.lightingSnapshot = lightingSnapshot;
      emit("lighting.changed", { reason: "preview-mode-updated" });
      return {
        enabled,
        dirty: false,
        previewSceneId: lightingSnapshot.previewSceneId,
        summary: enabled ? "Lighting preview mode enabled." : "Lighting preview mode disabled.",
      };
    }
    case "lighting.editor.previewDiscard": {
      const lightingSnapshot = asRecord(state.lightingSnapshot) ?? buildDefaultLightingSnapshot();
      lightingSnapshot.previewMode = false;
      lightingSnapshot.previewDirty = false;
      lightingSnapshot.previewSceneId = null;
      lightingSnapshot.previewFixtures = [];
      state.lightingSnapshot = lightingSnapshot;
      emit("lighting.changed", { reason: "preview-discarded" });
      return {
        discarded: true,
        summary: "Lighting preview edits discarded.",
      };
    }
    case "lighting.palette.list": {
      const lightingSnapshot = asRecord(state.lightingSnapshot) ?? buildDefaultLightingSnapshot();
      return {
        palettes: cloneJson(lightingPalettes(lightingSnapshot)),
      };
    }
    case "lighting.palette.create": {
      const name = asString(params.name).trim();
      if (!name) {
        throw new Error("name is required");
      }
      const kind = normalizePaletteKind(params.kind);
      if (!kind) {
        throw new Error("kind must be one of intensity or cct");
      }
      const value = validatePaletteValue(kind, params.value);
      const colorIndex = Object.prototype.hasOwnProperty.call(params, "colorIndex")
        ? parseLightingColorIndex(params.colorIndex)
        : null;
      const lightingSnapshot = asRecord(state.lightingSnapshot) ?? buildDefaultLightingSnapshot();
      const palettes = lightingPalettes(lightingSnapshot);
      const createdPalette: JsonObject = {
        id: nextCustomPaletteId(palettes),
        name,
        kind,
        value,
        colorIndex,
      };
      const insertIndex =
        kind === "intensity" ? palettes.findIndex((palette) => normalizePaletteKind(palette.kind) === "cct") : -1;
      lightingSnapshot.palettes =
        insertIndex >= 0
          ? [...palettes.slice(0, insertIndex), createdPalette, ...palettes.slice(insertIndex)]
          : [...palettes, createdPalette];
      const summary = `Lighting ${kind === "cct" ? "CCT" : "intensity"} palette '${name}' was created at ${formatLightingPaletteValue(kind, value)}.`;
      lightingSnapshot.lastActionStatus = "succeeded";
      lightingSnapshot.lastActionCode = null;
      lightingSnapshot.lastActionMessage = summary;
      lightingSnapshot.summary = summary;
      state.lightingSnapshot = lightingSnapshot;
      synchronizeFixtureState(state);
      emit("lighting.changed", { reason: "palette-created" });
      return {
        palette: cloneJson(createdPalette),
        summary,
      };
    }
    case "lighting.palette.update": {
      const paletteId = asString(params.paletteId).trim();
      if (!paletteId) {
        throw new Error("paletteId is required");
      }
      if (Object.prototype.hasOwnProperty.call(params, "kind")) {
        throw new Error("lighting.palette.update cannot change kind");
      }
      const hasName = typeof params.name === "string";
      const hasValue = typeof params.value === "number";
      const hasColor = Object.prototype.hasOwnProperty.call(params, "colorIndex");
      const hasBefore = Object.prototype.hasOwnProperty.call(params, "beforePaletteId");
      if (!hasName && !hasValue && !hasColor && !hasBefore) {
        throw new Error("lighting.palette.update requires a name, value, colorIndex, or beforePaletteId");
      }
      const lightingSnapshot = asRecord(state.lightingSnapshot) ?? buildDefaultLightingSnapshot();
      let palettes = lightingPalettes(lightingSnapshot);
      const targetPalette = palettes.find((palette) => asString(palette.id) === paletteId);
      if (!targetPalette) {
        throw new Error(`Lighting palette '${paletteId}' is not present in the palette list.`);
      }
      const kind = normalizePaletteKind(targetPalette.kind);
      if (!kind) {
        throw new Error(`Lighting palette '${paletteId}' has an unsupported kind.`);
      }
      const nextName = hasName ? asString(params.name).trim() : asString(targetPalette.name);
      if (hasName && !nextName) {
        throw new Error("name must not be empty");
      }
      const nextValue = hasValue
        ? validatePaletteValue(kind, params.value)
        : normalizePaletteValue(kind, targetPalette.value);
      const nextColorIndex = hasColor
        ? parseLightingColorIndex(params.colorIndex)
        : ((targetPalette.colorIndex as number | null | undefined) ?? null);
      const updatedPalette: JsonObject = {
        ...targetPalette,
        name: nextName,
        value: nextValue,
        colorIndex: nextColorIndex,
      };
      palettes = palettes.map((palette) => (asString(palette.id) === paletteId ? updatedPalette : palette));
      if (hasBefore) {
        const beforePaletteId = params.beforePaletteId === null ? null : asString(params.beforePaletteId).trim();
        if (beforePaletteId === paletteId) {
          throw new Error("beforePaletteId must differ from paletteId");
        }
        if (beforePaletteId) {
          const beforePalette = palettes.find((palette) => asString(palette.id) === beforePaletteId);
          if (!beforePalette) {
            throw new Error(`Lighting palette '${beforePaletteId}' is not present in the palette list.`);
          }
          if (normalizePaletteKind(beforePalette.kind) !== kind) {
            throw new Error("Palettes can only be reordered within the same attribute pool.");
          }
        }
        const withoutTarget = palettes.filter((palette) => asString(palette.id) !== paletteId);
        if (beforePaletteId) {
          const beforeIndex = withoutTarget.findIndex((palette) => asString(palette.id) === beforePaletteId);
          palettes = [...withoutTarget.slice(0, beforeIndex), updatedPalette, ...withoutTarget.slice(beforeIndex)];
        } else {
          const sameKindEntries = withoutTarget
            .map((palette, index) => ({ index, palette }))
            .filter((entry) => normalizePaletteKind(entry.palette.kind) === kind);
          const lastSameKind = sameKindEntries[sameKindEntries.length - 1];
          const insertIndex = lastSameKind ? lastSameKind.index + 1 : withoutTarget.length;
          palettes = [...withoutTarget.slice(0, insertIndex), updatedPalette, ...withoutTarget.slice(insertIndex)];
        }
      }
      lightingSnapshot.palettes = palettes;
      const summaryParts: string[] = [];
      if (hasName) summaryParts.push(`renamed to '${nextName}'`);
      if (hasValue) summaryParts.push(`set to ${formatLightingPaletteValue(kind, nextValue)}`);
      if (hasColor) summaryParts.push(nextColorIndex === null ? "color cleared" : "recolored");
      if (hasBefore) summaryParts.push("reordered");
      const summary = `Lighting palette '${nextName}' ${summaryParts.join(" + ")}.`;
      lightingSnapshot.lastActionStatus = "succeeded";
      lightingSnapshot.lastActionCode = null;
      lightingSnapshot.lastActionMessage = summary;
      lightingSnapshot.summary = summary;
      state.lightingSnapshot = lightingSnapshot;
      synchronizeFixtureState(state);
      emit("lighting.changed", { reason: "palette-updated" });
      return {
        palette: cloneJson(updatedPalette),
        summary,
      };
    }
    case "lighting.palette.delete": {
      const paletteId = asString(params.paletteId).trim();
      if (!paletteId) {
        throw new Error("paletteId is required");
      }
      const lightingSnapshot = asRecord(state.lightingSnapshot) ?? buildDefaultLightingSnapshot();
      const palettes = lightingPalettes(lightingSnapshot);
      const targetPalette = palettes.find((palette) => asString(palette.id) === paletteId);
      if (!targetPalette) {
        throw new Error(`Lighting palette '${paletteId}' is not present in the palette list.`);
      }
      lightingSnapshot.palettes = palettes.filter((palette) => asString(palette.id) !== paletteId);
      const summary = `Lighting palette '${asString(targetPalette.name, paletteId)}' was deleted.`;
      lightingSnapshot.lastActionStatus = "succeeded";
      lightingSnapshot.lastActionCode = null;
      lightingSnapshot.lastActionMessage = summary;
      lightingSnapshot.summary = summary;
      state.lightingSnapshot = lightingSnapshot;
      synchronizeFixtureState(state);
      emit("lighting.changed", { reason: "palette-deleted" });
      return {
        deleted: true,
        paletteId,
        summary,
      };
    }
    case "lighting.palette.apply": {
      const paletteId = asString(params.paletteId).trim();
      if (!paletteId) {
        throw new Error("paletteId is required");
      }
      if (asBoolean(params.patchModeActive, false) || asBoolean(params.patchMode, false)) {
        throw new Error("Exit patch mode before applying lighting palettes.");
      }
      const fixtureIds = asArray(params.fixtureIds)
        .map((id) => asString(id).trim())
        .filter(Boolean)
        .filter((id, index, ids) => ids.indexOf(id) === index);
      if (fixtureIds.length === 0) {
        throw new Error("fixtureIds must contain at least one id");
      }
      const lightingSnapshot = asRecord(state.lightingSnapshot) ?? buildDefaultLightingSnapshot();
      const palettes = lightingPalettes(lightingSnapshot);
      const palette = palettes.find((entry) => asString(entry.id) === paletteId);
      if (!palette) {
        throw new Error(`Lighting palette '${paletteId}' is not present in the palette list.`);
      }
      const kind = normalizePaletteKind(palette.kind);
      if (!kind) {
        throw new Error(`Lighting palette '${paletteId}' has an unsupported kind.`);
      }
      const previewActive = lightingPreviewActive(lightingSnapshot);
      const fixtures = previewActive
        ? lightingFixtures(lightingSnapshot, "previewFixtures")
        : lightingFixtures(lightingSnapshot);
      const missingFixtureId = fixtureIds.find(
        (fixtureId) => !fixtures.some((fixture) => asString(fixture.id) === fixtureId)
      );
      if (missingFixtureId) {
        throw new Error(`Lighting fixture '${missingFixtureId}' is not present in the fixture inventory.`);
      }
      const nextFixtures = fixtures.map((fixture) =>
        fixtureIds.includes(asString(fixture.id)) ? applyLightingPaletteToFixture(fixture, palette) : fixture
      );
      if (previewActive) {
        lightingSnapshot.previewFixtures = nextFixtures;
        lightingSnapshot.previewDirty = true;
      } else {
        lightingSnapshot.fixtures = nextFixtures;
      }
      const summary = `Lighting ${kind === "cct" ? "CCT" : "intensity"} palette '${asString(palette.name, paletteId)}' applied to ${fixtureIds.length} fixture${fixtureIds.length === 1 ? "" : "s"}${previewActive ? " in preview" : ""}.`;
      lightingSnapshot.lastActionStatus = "succeeded";
      lightingSnapshot.lastActionCode = null;
      lightingSnapshot.lastActionMessage = summary;
      lightingSnapshot.summary = summary;
      state.lightingSnapshot = lightingSnapshot;
      synchronizeFixtureState(state);
      emit("lighting.changed", { reason: "palette-applied" });
      return {
        paletteId,
        paletteName: asString(palette.name, paletteId),
        kind,
        affectedFixtures: fixtureIds.length,
        previewMode: previewActive,
        summary,
      };
    }
    case "lighting.scene.recall": {
      const sceneId = asString(params.sceneId).trim();
      if (!sceneId) {
        throw new Error("sceneId is required");
      }

      const lightingSnapshot = asRecord(state.lightingSnapshot) ?? {};
      const scenes = lightingScenes(lightingSnapshot);
      const targetScene = scenes.find((scene) => asString(scene.id) === sceneId);
      if (!targetScene) {
        throw new Error(`Lighting scene '${sceneId}' is not present in the scene list.`);
      }

      if (lightingPreviewActive(lightingSnapshot)) {
        const liveFixtures = lightingFixtures(lightingSnapshot);
        lightingSnapshot.previewSceneId = sceneId;
        lightingSnapshot.previewDirty = false;
        lightingSnapshot.previewFixtures = previewFixturesFromScene(liveFixtures, targetScene);
        state.lightingSnapshot = lightingSnapshot;
        synchronizeFixtureState(state);
        emit("lighting.changed", { reason: "scene-preview-recalled" });
        return {
          recalled: true,
          sceneId,
          sceneName: asString(targetScene.name, sceneId),
          recalledAt: null,
          fadeDurationSeconds: 0,
          fadeMs: 0,
          previewMode: true,
          summary: `Lighting scene '${asString(targetScene.name, sceneId)}' loaded into preview.`,
        };
      }

      if (!asBoolean(lightingSnapshot.reachable, false)) {
        throw new Error("Lighting scene recall requires a reachable lighting transport.");
      }

      const recalledAt = new Date().toISOString();
      const rawFadeMs =
        typeof params.fadeMs === "number"
          ? params.fadeMs
          : typeof params.fadeDurationSeconds === "number"
            ? params.fadeDurationSeconds * 1000
            : 0;
      const fadeMs = Math.max(0, Math.min(10_000, Math.round(rawFadeMs)));
      const fadeDurationSeconds = fadeMs / 1000;
      const fixtureStates = asArray(targetScene.fixtureStates)
        .map((fixtureState) => asRecord(fixtureState))
        .filter((fixtureState): fixtureState is JsonObject => fixtureState !== null);
      const previewActive = lightingPreviewActive(lightingSnapshot);
      const fixtures = previewActive
        ? lightingFixtures(lightingSnapshot, "previewFixtures")
        : lightingFixtures(lightingSnapshot);

      lightingSnapshot.selectedSceneId = sceneId;
      lightingSnapshot.lastRecalledSceneId = sceneId;
      lightingSnapshot.lastSceneRecallAt = recalledAt;
      lightingSnapshot.scenes = scenes.map((scene) => ({
        ...scene,
        lastRecalled: asString(scene.id) === sceneId,
        lastRecalledAt: asString(scene.id) === sceneId ? recalledAt : (scene.lastRecalledAt ?? null),
        fadeDurationMs: asString(scene.id) === sceneId && fadeMs > 0 ? fadeMs : null,
        fadeProgress: asString(scene.id) === sceneId && fadeMs > 0 ? 1 : null,
      }));
      lightingSnapshot.fixtures = fixtures.map((fixture) => {
        const nextState = fixtureStates.find(
          (fixtureState) => asString(fixtureState.fixtureId) === asString(fixture.id)
        );
        if (!nextState) {
          return fixture;
        }

        return {
          ...fixture,
          cct: asNumber(nextState.cct, asNumber(fixture.cct, 3200)),
          controlValues: asRecord(nextState.controlValues) ?? asRecord(fixture.controlValues) ?? {},
          intensity: asNumber(nextState.intensity, asNumber(fixture.intensity, 0)),
          on: asBoolean(nextState.on, asBoolean(fixture.on, false)),
        };
      });

      const transitionLabel =
        fadeMs > 0
          ? `${Number.isInteger(fadeDurationSeconds) ? fadeDurationSeconds.toFixed(0) : fadeDurationSeconds.toFixed(1)} s fade`
          : "immediate transition";
      const summary = `Fixture lighting scene '${asString(targetScene.name, sceneId)}' was recalled via ${transitionLabel} on ${asString(lightingSnapshot.bridgeIp, "unconfigured")} universe ${asNumber(lightingSnapshot.universe, 1)}.`;
      lightingSnapshot.lastActionStatus = "succeeded";
      lightingSnapshot.lastActionCode = null;
      lightingSnapshot.lastActionMessage = summary;
      lightingSnapshot.summary = summary;
      state.lightingSnapshot = lightingSnapshot;
      synchronizeFixtureState(state);
      emit("lighting.changed", { reason: "scene-recalled" });
      return {
        recalled: true,
        sceneId,
        sceneName: asString(targetScene.name, sceneId),
        recalledAt,
        fadeDurationSeconds,
        fadeMs,
        summary,
      };
    }
    case "lighting.scene.create": {
      const name = asString(params.name).trim();
      if (!name) {
        throw new Error("name is required");
      }

      const lightingSnapshot = asRecord(state.lightingSnapshot) ?? {};
      const previewActive = lightingPreviewActive(lightingSnapshot);
      const fixtures = previewActive
        ? lightingFixtures(lightingSnapshot, "previewFixtures")
        : lightingFixtures(lightingSnapshot);
      if (fixtures.length === 0) {
        throw new Error("No lighting fixtures are available for scene creation.");
      }
      const hasExplicitFixtureStates = Object.prototype.hasOwnProperty.call(params, "fixtureStates");
      const explicitFixtureStates = hasExplicitFixtureStates
        ? asArray(params.fixtureStates).map((entry) => {
            const fixtureState = asRecord(entry);
            if (!fixtureState) {
              throw new Error("fixtureStates entries must be objects");
            }
            const fixtureId = asString(fixtureState.fixtureId).trim();
            if (!fixtureId) {
              throw new Error("fixtureStates.fixtureId is required");
            }
            if (!fixtures.some((fixture) => asString(fixture.id) === fixtureId)) {
              throw new Error(`Lighting fixture '${fixtureId}' is not present in the fixture list.`);
            }
            const intensity = asNumber(fixtureState.intensity, NaN);
            if (!Number.isFinite(intensity) || intensity < 0 || intensity > 100) {
              throw new Error("fixtureStates.intensity must be between 0 and 100");
            }
            const cct = asNumber(fixtureState.cct, NaN);
            if (!Number.isFinite(cct) || cct < 2000 || cct > 10_000) {
              throw new Error("fixtureStates.cct must be between 2000 and 10000");
            }
            return {
              fixtureId,
              intensity: Math.round(intensity),
              cct: Math.round(cct),
              on: asBoolean(fixtureState.on, false),
              controlValues: asRecord(fixtureState.controlValues) ?? {},
            };
          })
        : null;
      if (hasExplicitFixtureStates && explicitFixtureStates?.length === 0) {
        throw new Error("Scene fixtureStates must include at least one fixture.");
      }
      const hasColor = Object.prototype.hasOwnProperty.call(params, "colorIndex");
      let colorIndex: number | null = null;
      if (hasColor) {
        if (params.colorIndex === null) {
          colorIndex = null;
        } else {
          const raw = asNumber(params.colorIndex, NaN);
          if (!Number.isInteger(raw) || raw < 0 || raw > 7) {
            throw new Error("colorIndex must be an integer 0..7 or null");
          }
          colorIndex = raw;
        }
      }

      const scenes = asArray(lightingSnapshot.scenes)
        .map((scene) => asRecord(scene))
        .filter((scene): scene is JsonObject => scene !== null);
      const createdScene: JsonObject = {
        id: nextCustomSceneId(scenes),
        name,
        fixtureCount: explicitFixtureStates?.length ?? fixtures.length,
        fixtureStates: explicitFixtureStates ?? fixtures.map((fixture) => sceneFixtureStateFromFixture(fixture)),
        lastRecalled: false,
        lastRecalledAt: null,
        colorIndex,
      };

      lightingSnapshot.scenes = [...scenes, createdScene];
      if (previewActive) {
        lightingSnapshot.selectedSceneId = createdScene.id;
        clearLightingPreview(lightingSnapshot);
      }
      const summary = hasExplicitFixtureStates
        ? `Lighting scene '${name}' was restored from a saved scene state.`
        : previewActive
          ? `Lighting scene '${name}' was saved from preview.`
          : `Lighting scene '${name}' was saved from the current fixture state.`;
      lightingSnapshot.lastActionStatus = "succeeded";
      lightingSnapshot.lastActionCode = null;
      lightingSnapshot.lastActionMessage = summary;
      lightingSnapshot.summary = summary;
      state.lightingSnapshot = lightingSnapshot;
      synchronizeFixtureState(state);
      emit("lighting.changed", { reason: "scene-created" });
      return {
        scene: cloneJson(createdScene),
        summary,
      };
    }
    case "lighting.scene.update": {
      const sceneId = asString(params.sceneId).trim();
      if (!sceneId) {
        throw new Error("sceneId is required");
      }
      const hasName = typeof params.name === "string";
      const hasCapture = params.captureCurrentState === true;
      const hasColor = Object.prototype.hasOwnProperty.call(params, "colorIndex");
      if (!hasName && !hasCapture && !hasColor) {
        throw new Error("lighting.scene.update requires a name, captureCurrentState, or colorIndex");
      }

      const lightingSnapshot = asRecord(state.lightingSnapshot) ?? {};
      const scenes = asArray(lightingSnapshot.scenes)
        .map((scene) => asRecord(scene))
        .filter((scene): scene is JsonObject => scene !== null);
      const targetScene = scenes.find((scene) => asString(scene.id) === sceneId);
      if (!targetScene) {
        throw new Error(`Lighting scene '${sceneId}' is not present in the scene list.`);
      }

      const previewActive = lightingPreviewActive(lightingSnapshot);
      const fixtures = previewActive
        ? lightingFixtures(lightingSnapshot, "previewFixtures")
        : lightingFixtures(lightingSnapshot);

      const nextName = hasName ? asString(params.name).trim() : asString(targetScene.name);
      if (hasName && !nextName) {
        throw new Error("name must not be empty");
      }
      const nextFixtureStates = hasCapture
        ? fixtures.map((fixture) => sceneFixtureStateFromFixture(fixture))
        : asArray(targetScene.fixtureStates);
      let nextColorIndex: number | null = (targetScene.colorIndex as number | null | undefined) ?? null;
      if (hasColor) {
        if (params.colorIndex === null) {
          nextColorIndex = null;
        } else {
          const raw = asNumber(params.colorIndex, NaN);
          if (!Number.isInteger(raw) || raw < 0 || raw > 7) {
            throw new Error("colorIndex must be an integer 0..7 or null");
          }
          nextColorIndex = raw;
        }
      }

      const updatedScene: JsonObject = {
        ...targetScene,
        name: nextName,
        fixtureStates: nextFixtureStates,
        fixtureCount: hasCapture ? fixtures.length : asNumber(targetScene.fixtureCount, fixtures.length),
        colorIndex: nextColorIndex,
      };

      lightingSnapshot.scenes = scenes.map((scene) => (asString(scene.id) === sceneId ? updatedScene : scene));
      if (hasCapture && previewActive) {
        clearLightingPreview(lightingSnapshot);
      }
      const summaryParts: string[] = [];
      if (hasName) summaryParts.push(`renamed to '${nextName}'`);
      if (hasCapture) summaryParts.push("captured current rig state");
      if (hasColor) summaryParts.push(nextColorIndex === null ? "color cleared" : "recolored");
      const summary = `Lighting scene '${nextName}' ${summaryParts.join(" + ")}.`;
      lightingSnapshot.lastActionStatus = "succeeded";
      lightingSnapshot.lastActionCode = null;
      lightingSnapshot.lastActionMessage = summary;
      lightingSnapshot.summary = summary;
      state.lightingSnapshot = lightingSnapshot;
      synchronizeFixtureState(state);
      emit("lighting.changed", { reason: "scene-updated" });
      return {
        scene: cloneJson(updatedScene),
        summary,
      };
    }
    case "lighting.scene.delete": {
      const sceneId = asString(params.sceneId).trim();
      if (!sceneId) {
        throw new Error("sceneId is required");
      }

      const lightingSnapshot = asRecord(state.lightingSnapshot) ?? {};
      const scenes = asArray(lightingSnapshot.scenes)
        .map((scene) => asRecord(scene))
        .filter((scene): scene is JsonObject => scene !== null);
      const targetScene = scenes.find((scene) => asString(scene.id) === sceneId);
      if (!targetScene) {
        throw new Error(`Lighting scene '${sceneId}' is not present in the scene list.`);
      }

      lightingSnapshot.scenes = scenes.filter((scene) => asString(scene.id) !== sceneId);
      if (asString(lightingSnapshot.selectedSceneId) === sceneId) {
        lightingSnapshot.selectedSceneId = null;
      }
      if (asString(lightingSnapshot.lastRecalledSceneId) === sceneId) {
        lightingSnapshot.lastRecalledSceneId = null;
        lightingSnapshot.lastSceneRecallAt = null;
      }

      const sceneName = asString(targetScene.name, sceneId);
      const summary = `Lighting scene '${sceneName}' was deleted.`;
      lightingSnapshot.lastActionStatus = "succeeded";
      lightingSnapshot.lastActionCode = null;
      lightingSnapshot.lastActionMessage = summary;
      lightingSnapshot.summary = summary;
      state.lightingSnapshot = lightingSnapshot;
      synchronizeFixtureState(state);
      emit("lighting.changed", { reason: "scene-deleted" });
      return {
        deleted: true,
        sceneId,
        summary,
      };
    }
    // The stored scene list is the rail's order; `lighting.snapshot` shows the
    // pinned ones first, so an unpinned scene goes back to its own place.
    case "lighting.scene.reorder": {
      const sceneId = requiredText(params, "sceneId");
      const beforeSceneId = reorderAnchor(params, "beforeSceneId", sceneId, "sceneId");
      const lightingSnapshot = asRecord(state.lightingSnapshot) ?? {};
      const scenes = lightingScenes(lightingSnapshot);
      const movedScene = scenes.find((scene) => asString(scene.id) === sceneId);
      if (!movedScene) {
        throw new Error(`Lighting scene '${sceneId}' is not exposed by the native editor state.`);
      }
      if (beforeSceneId !== null && !scenes.some((scene) => asString(scene.id) === beforeSceneId)) {
        throw new Error(`Reorder anchor scene '${beforeSceneId}' is not exposed by the native editor state.`);
      }
      lightingSnapshot.scenes = movedBefore(scenes, movedScene, beforeSceneId);
      const summary = `Lighting scene '${sceneId}' was reordered in the rail.`;
      finishLightingAction(context, lightingSnapshot, summary, "scene-reordered");
      return { sceneId, summary };
    }
    case "lighting.scene.pin": {
      const sceneId = requiredText(params, "sceneId");
      if (typeof params.pinned !== "boolean") {
        throw new Error("pinned must be a boolean");
      }
      const pinned = params.pinned;
      const lightingSnapshot = asRecord(state.lightingSnapshot) ?? {};
      const scenes = lightingScenes(lightingSnapshot);
      const targetScene = scenes.find((scene) => asString(scene.id) === sceneId);
      if (!targetScene) {
        throw new Error(`Lighting scene '${sceneId}' is not exposed by the native editor state.`);
      }
      const pinnedScene: JsonObject = { ...targetScene, pinned };
      lightingSnapshot.scenes = scenes.map((scene) => (scene === targetScene ? pinnedScene : scene));
      const sceneName = asString(targetScene.name);
      const summary = pinned
        ? `Lighting scene '${sceneName}' was pinned.`
        : `Lighting scene '${sceneName}' was unpinned.`;
      finishLightingAction(context, lightingSnapshot, summary, "scene-pinned");
      return { scene: cloneJson(pinnedScene), summary };
    }
    case "lighting.settings.update": {
      const lightingSnapshot = asRecord(state.lightingSnapshot) ?? {};
      const hasSelectedSceneId = Object.prototype.hasOwnProperty.call(params, "selectedSceneId");
      const hasSelectedFixtureId = Object.prototype.hasOwnProperty.call(params, "selectedFixtureId");
      // The Lighting page's Grand master sends `grandMaster` alone
      // (`useLightingRigControls.ts`). The hardware link reads it as a number,
      // rounds it and clamps it to 0–100 (`E/lighting/parse.rs`,
      // `parse_i64_value`); the double refused it until 2026-09-23.
      const hasGrandMaster = Object.prototype.hasOwnProperty.call(params, "grandMaster");

      if (!hasSelectedSceneId && !hasSelectedFixtureId && !hasGrandMaster) {
        throw new Error("lighting.settings.update requires one or more supported fields");
      }

      let grandMaster: number | null = null;
      if (hasGrandMaster) {
        const raw = params.grandMaster;
        if (typeof raw !== "number") {
          throw new Error("value must be a number");
        }
        if (!Number.isFinite(raw)) {
          throw new Error("value must be a finite number");
        }
        grandMaster = Math.min(100, Math.max(0, Math.round(raw)));
      }

      const fixtures = asArray(lightingSnapshot.fixtures)
        .map((fixture) => asRecord(fixture))
        .filter((fixture): fixture is JsonObject => fixture !== null);
      const scenes = asArray(lightingSnapshot.scenes)
        .map((scene) => asRecord(scene))
        .filter((scene): scene is JsonObject => scene !== null);
      const summaryParts: string[] = [];

      // Validated like the hardware link (`E/lighting/settings.rs`): the
      // fixture, then the scene, each checked before anything is stored, so a
      // refused request changes nothing, and refused in its words.
      if (hasSelectedFixtureId && params.selectedFixtureId !== null) {
        const fixtureId = asString(params.selectedFixtureId).trim();
        if (!fixtureId) {
          throw new Error("selectedFixtureId must be a string or null");
        }
        if (!fixtures.some((entry) => asString(entry.id) === fixtureId)) {
          throw new Error(`Lighting fixture '${fixtureId}' is not exposed by the native editor state.`);
        }
      }
      if (hasSelectedSceneId && params.selectedSceneId !== null) {
        const sceneId = asString(params.selectedSceneId).trim();
        if (!sceneId) {
          throw new Error("selectedSceneId must be a string or null");
        }
        if (!scenes.some((entry) => asString(entry.id) === sceneId)) {
          throw new Error(`Lighting scene '${sceneId}' is not exposed by the native editor state.`);
        }
      }

      if (grandMaster !== null) {
        lightingSnapshot.grandMaster = grandMaster;
        summaryParts.push(`grand master -> ${grandMaster}%`);
      }

      if (hasSelectedSceneId) {
        if (params.selectedSceneId === null) {
          lightingSnapshot.selectedSceneId = null;
          summaryParts.push("selected scene cleared");
        } else {
          const sceneId = asString(params.selectedSceneId).trim();
          if (!sceneId) {
            throw new Error("selectedSceneId must be a string or null");
          }

          const scene = scenes.find((entry) => asString(entry.id) === sceneId);
          if (!scene) {
            throw new Error(`Lighting scene '${sceneId}' is not present in the scene list.`);
          }

          lightingSnapshot.selectedSceneId = sceneId;
          summaryParts.push(`selected scene -> ${asString(scene.name, sceneId)}`);
        }
      }

      if (hasSelectedFixtureId) {
        if (params.selectedFixtureId === null) {
          lightingSnapshot.selectedFixtureId = null;
          summaryParts.push("selected fixture cleared");
        } else {
          const fixtureId = asString(params.selectedFixtureId).trim();
          if (!fixtureId) {
            throw new Error("selectedFixtureId must be a string or null");
          }

          const fixture = fixtures.find((entry) => asString(entry.id) === fixtureId);
          if (!fixture) {
            throw new Error(`Lighting fixture '${fixtureId}' is not present in the fixture inventory.`);
          }

          lightingSnapshot.selectedFixtureId = fixtureId;
          summaryParts.push(`selected fixture -> ${asString(fixture.name, fixtureId)}`);
        }
      }

      const summary =
        summaryParts.length > 0
          ? `Native lighting settings updated: ${summaryParts.join(", ")}.`
          : "Native lighting settings updated.";
      lightingSnapshot.lastActionStatus = "succeeded";
      lightingSnapshot.lastActionCode = null;
      lightingSnapshot.lastActionMessage = summary;
      lightingSnapshot.summary = summary;
      state.lightingSnapshot = lightingSnapshot;
      synchronizeFixtureState(state);
      emit("lighting.changed", { reason: "settings-updated" });
      return {
        grandMaster: asNumber(lightingSnapshot.grandMaster, 100),
        selectedSceneId: lightingSnapshot.selectedSceneId ?? null,
        selectedFixtureId: lightingSnapshot.selectedFixtureId ?? null,
        summary,
      };
    }
    case "lighting.fixture.create": {
      const name = asString(params.name).trim();
      if (!name) {
        throw new Error("name is required");
      }

      const lightingSnapshot = asRecord(state.lightingSnapshot) ?? {};
      const definition = fixtureDefinitionByIdentity(
        state.lightingFixtureCatalogSnapshot,
        params.definitionId,
        params.type
      );
      if (!definition || !fixtureDefinitionSelectable(definition)) {
        throw new Error("definitionId or type must resolve to a selectable verified fixture catalog entry");
      }
      const mode = fixtureModeForDefinition(definition, params.modeId);
      if (!mode) {
        throw new Error("modeId must resolve to a fixture catalog mode");
      }
      const normalizedFixtureType = fixtureTypeForDefinition(asString(definition.id));
      const fixtureProfileSeed = {
        type: normalizedFixtureType,
        definitionId: asString(definition.id),
        modeId: asString(mode.id),
      };
      const profile = fixtureProfileForFixture(fixtureProfileSeed, state.lightingFixtureCatalogSnapshot);
      const universe = Math.max(1, Math.round(asNumber(params.universe, asNumber(lightingSnapshot?.universe, 1))));

      const requestedStartAddress = Math.round(asNumber(params.dmxStartAddress, Number.NaN));
      if (!Number.isFinite(requestedStartAddress)) {
        throw new Error("dmxStartAddress is required");
      }

      const fixtures = asArray(lightingSnapshot.fixtures)
        .map((fixture) => asRecord(fixture))
        .filter((fixture): fixture is JsonObject => fixture !== null);
      const groups = asArray(lightingSnapshot.groups)
        .map((group) => asRecord(group))
        .filter((group): group is JsonObject => group !== null);
      const scenes = asArray(lightingSnapshot.scenes)
        .map((scene) => asRecord(scene))
        .filter((scene): scene is JsonObject => scene !== null);
      const groupId = asString(params.groupId).trim();

      if (groupId && !groups.some((group) => asString(group.id) === groupId)) {
        throw new Error(`Lighting group '${groupId}' is not present in the group list.`);
      }

      const maxDmxStartAddress = lightingFixtureMaxStartAddress(fixtureProfileSeed);
      if (profile.channelCount > 0 && (requestedStartAddress < 1 || requestedStartAddress > maxDmxStartAddress)) {
        throw new Error(
          `DMX start address must be between 1 and ${maxDmxStartAddress} for fixture definition '${asString(definition.id)}'.`
        );
      }

      const requestedEndAddress = requestedStartAddress + profile.channelCount - 1;
      const overlapFixture = fixtures.find((fixture) => {
        if (asNumber(fixture.universe, 1) !== universe) {
          return false;
        }
        const existingStartAddress = asNumber(fixture.dmxStartAddress, 1);
        const existingChannelCount = lightingFixtureChannelCount(fixture);
        if (existingChannelCount <= 0 || profile.channelCount <= 0) {
          return false;
        }
        const existingEndAddress = existingStartAddress + existingChannelCount - 1;
        return requestedStartAddress <= existingEndAddress && requestedEndAddress >= existingStartAddress;
      });
      if (overlapFixture) {
        throw new Error(
          `DMX address overlaps with '${asString(overlapFixture.name, "Fixture")}' at ${asNumber(
            overlapFixture.dmxStartAddress,
            0
          )}.`
        );
      }

      const createdFixture: JsonObject = {
        id: nextCustomFixtureId(fixtures),
        name,
        type: normalizedFixtureType,
        definitionId: asString(definition.id),
        modeId: asString(mode.id),
        universe,
        dmxStartAddress: profile.channelCount <= 0 ? 0 : requestedStartAddress,
        kind: asString(definition.kind),
        groupId: groupId || null,
        spatialRotation: 0,
        spatialX: null,
        spatialY: null,
        rigZ: null,
        beamAngleDegrees: null,
        on: false,
        intensity: 100,
        cct: defaultLightingFixtureCct(fixtureProfileSeed),
        controlValues: normalizeControlValues(fixtureProfileSeed, profile),
        effect: null,
      };

      lightingSnapshot.fixtures = [...fixtures, createdFixture];
      synchronizeLightingGroupCounts(lightingSnapshot);
      lightingSnapshot.scenes = scenes.map((scene) => ({
        ...scene,
        fixtureCount: asArray(scene.fixtureStates).length + 1,
        fixtureStates: [
          ...asArray(scene.fixtureStates),
          {
            fixtureId: createdFixture.id,
            intensity: 100,
            cct: defaultLightingFixtureCct(createdFixture),
            on: false,
            controlValues: asRecord(createdFixture.controlValues) ?? {},
          },
        ],
      }));

      const summary = `Lighting fixture '${name}' was created as ${normalizedFixtureType} on DMX ${requestedStartAddress}.`;
      lightingSnapshot.lastActionStatus = "succeeded";
      lightingSnapshot.lastActionCode = null;
      lightingSnapshot.lastActionMessage = summary;
      lightingSnapshot.summary = summary;
      state.lightingSnapshot = lightingSnapshot;
      synchronizeFixtureState(state);
      emit("lighting.changed", { reason: "fixture-created" });
      return {
        fixture: cloneJson(createdFixture),
        summary,
      };
    }
    case "lighting.fixture.update": {
      const fixtureId = asString(params.fixtureId).trim();
      if (!fixtureId) {
        throw new Error("fixtureId is required");
      }

      const hasName = typeof params.name === "string";
      const hasType = typeof params.type === "string";
      const hasDefinitionId = typeof params.definitionId === "string";
      const hasModeId = typeof params.modeId === "string";
      const hasUniverse = typeof params.universe === "number";
      const hasOn = typeof params.on === "boolean";
      const hasIntensity = typeof params.intensity === "number";
      const hasCct = typeof params.cct === "number";
      const hasControlValues = Object.prototype.hasOwnProperty.call(params, "controlValues");
      const hasDmxStartAddress = typeof params.dmxStartAddress === "number";
      const hasGroupId = Object.prototype.hasOwnProperty.call(params, "groupId");
      const hasSpatialX = Object.prototype.hasOwnProperty.call(params, "spatialX");
      const hasSpatialY = Object.prototype.hasOwnProperty.call(params, "spatialY");
      const hasSpatialRotation = Object.prototype.hasOwnProperty.call(params, "spatialRotation");
      const hasRigZ = Object.prototype.hasOwnProperty.call(params, "rigZ");
      const hasBeamAngleDegrees = Object.prototype.hasOwnProperty.call(params, "beamAngleDegrees");
      if (
        !hasName &&
        !hasType &&
        !hasDefinitionId &&
        !hasModeId &&
        !hasUniverse &&
        !hasOn &&
        !hasIntensity &&
        !hasCct &&
        !hasControlValues &&
        !hasDmxStartAddress &&
        !hasGroupId &&
        !hasSpatialX &&
        !hasSpatialY &&
        !hasSpatialRotation &&
        !hasRigZ &&
        !hasBeamAngleDegrees
      ) {
        throw new Error("lighting.fixture.update requires one or more supported fields");
      }

      const lightingSnapshot = asRecord(state.lightingSnapshot) ?? {};
      const previewActive = lightingPreviewActive(lightingSnapshot);
      const fixtures = lightingFixtures(lightingSnapshot);
      const groups = asArray(lightingSnapshot.groups)
        .map((group) => asRecord(group))
        .filter((group): group is JsonObject => group !== null);
      const targetFixture = fixtures.find((fixture) => asString(fixture.id) === fixtureId);
      if (!targetFixture) {
        throw new Error(`Lighting fixture '${fixtureId}' is not present in the fixture inventory.`);
      }

      if (previewActive) {
        if (
          hasName ||
          hasType ||
          hasDefinitionId ||
          hasModeId ||
          hasUniverse ||
          hasDmxStartAddress ||
          hasGroupId ||
          hasSpatialX ||
          hasSpatialY ||
          hasSpatialRotation ||
          hasRigZ ||
          hasBeamAngleDegrees
        ) {
          throw new Error("Preview mode only supports fixture power, intensity, CCT, and catalog control updates.");
        }
        const previewFixtures = lightingFixtures(lightingSnapshot, "previewFixtures");
        const editableFixtures =
          previewFixtures.length > 0 ? previewFixtures : fixtures.map((fixture) => ({ ...fixture }));
        const previewTarget = editableFixtures.find((fixture) => asString(fixture.id) === fixtureId) ?? targetFixture;
        const cctRange = lightingFixtureCctRange(targetFixture);
        const defaultCct = defaultLightingFixtureCct(targetFixture);
        const controlValues = hasControlValues
          ? {
              ...asNumberRecord(previewTarget.controlValues),
              ...asNumberRecord(params.controlValues),
            }
          : asNumberRecord(previewTarget.controlValues);
        const updatedFixture: JsonObject = {
          ...previewTarget,
          ...(hasOn ? { on: params.on } : {}),
          ...(hasIntensity
            ? {
                intensity: Math.max(
                  0,
                  Math.min(100, Math.round(asNumber(params.intensity, asNumber(previewTarget.intensity, 0))))
                ),
              }
            : {}),
          ...(hasCct
            ? {
                cct: clampNumber(
                  (() => {
                    const requested = Math.round(asNumber(params.cct, asNumber(previewTarget.cct, defaultCct)));
                    return requested === 0 ? defaultCct : requested;
                  })(),
                  cctRange.min,
                  cctRange.max
                ),
              }
            : {}),
          ...(hasControlValues ? { controlValues } : {}),
        };
        updatedFixture.controlValues = normalizeControlValues(updatedFixture);
        lightingSnapshot.previewFixtures = editableFixtures.map((fixture) =>
          asString(fixture.id) === fixtureId ? updatedFixture : fixture
        );
        lightingSnapshot.previewDirty = true;
        const summary = `Preview fixture '${asString(updatedFixture.name, fixtureId)}' updated.`;
        lightingSnapshot.lastActionStatus = "succeeded";
        lightingSnapshot.lastActionCode = null;
        lightingSnapshot.lastActionMessage = summary;
        lightingSnapshot.summary = summary;
        state.lightingSnapshot = lightingSnapshot;
        synchronizeFixtureState(state);
        emit("lighting.changed", { reason: "fixture-preview-updated" });
        return {
          fixture: cloneJson(updatedFixture),
          source: "preview",
          summary,
        };
      }

      if (!asBoolean(lightingSnapshot.reachable, false)) {
        throw new Error("Lighting fixture update requires a reachable lighting transport.");
      }

      const definition = fixtureDefinitionByIdentity(
        state.lightingFixtureCatalogSnapshot,
        hasDefinitionId ? params.definitionId : targetFixture.definitionId,
        hasType ? params.type : targetFixture.type,
        targetFixture.kind
      );
      const structuralCatalogChange = hasType || hasDefinitionId || hasModeId;
      if (
        !definition ||
        asString(definition.status) !== "verified" ||
        (structuralCatalogChange && !fixtureDefinitionSelectable(definition))
      ) {
        throw new Error("definitionId or type must resolve to a selectable verified fixture catalog entry");
      }
      const mode = fixtureModeForDefinition(definition, hasModeId ? params.modeId : targetFixture.modeId);
      if (!mode) {
        throw new Error("modeId must resolve to a fixture catalog mode");
      }
      const normalizedFixtureType = fixtureTypeForDefinition(asString(definition.id));
      const nextUniverse = hasUniverse
        ? Math.max(1, Math.round(asNumber(params.universe, asNumber(targetFixture.universe, 1))))
        : asNumber(targetFixture.universe, 1);
      const profileSeed = {
        ...targetFixture,
        type: normalizedFixtureType,
        definitionId: asString(definition.id),
        modeId: asString(mode.id),
      };
      const profile = fixtureProfileForFixture(profileSeed, state.lightingFixtureCatalogSnapshot);
      const cctRange = lightingFixtureCctRange(profileSeed);
      const defaultCct = defaultLightingFixtureCct(profileSeed);
      const maxDmxStartAddress = lightingFixtureMaxStartAddress(profileSeed);
      const nextDmxStartAddress = hasDmxStartAddress
        ? Math.round(asNumber(params.dmxStartAddress, asNumber(targetFixture.dmxStartAddress, 1)))
        : asNumber(targetFixture.dmxStartAddress, 1);
      if (profile.channelCount > 0 && (nextDmxStartAddress < 1 || nextDmxStartAddress > maxDmxStartAddress)) {
        throw new Error(
          `DMX start address must be between 1 and ${maxDmxStartAddress} for fixture definition '${asString(definition.id)}'.`
        );
      }

      const nextDmxEndAddress = nextDmxStartAddress + profile.channelCount - 1;
      const overlapFixture = fixtures.find((fixture) => {
        if (asString(fixture.id) === fixtureId) {
          return false;
        }
        if (asNumber(fixture.universe, 1) !== nextUniverse) {
          return false;
        }

        const existingStartAddress = asNumber(fixture.dmxStartAddress, 1);
        const existingChannelCount = lightingFixtureChannelCount(fixture);
        if (existingChannelCount <= 0 || profile.channelCount <= 0) {
          return false;
        }
        const existingEndAddress = existingStartAddress + existingChannelCount - 1;
        return nextDmxStartAddress <= existingEndAddress && nextDmxEndAddress >= existingStartAddress;
      });
      if (overlapFixture) {
        throw new Error(
          `DMX address overlaps with '${asString(overlapFixture.name, "Fixture")}' at ${asNumber(
            overlapFixture.dmxStartAddress,
            0
          )}.`
        );
      }

      const nextGroupId = hasGroupId ? asString(params.groupId).trim() : asString(targetFixture.groupId).trim();
      if (nextGroupId && !groups.some((group) => asString(group.id) === nextGroupId)) {
        throw new Error(`Lighting group '${nextGroupId}' is not present in the group list.`);
      }

      const updatedFixture: JsonObject = {
        ...targetFixture,
        ...(hasName ? { name: asString(params.name).trim() || asString(targetFixture.name) } : {}),
        ...(hasType || hasDefinitionId ? { type: normalizedFixtureType } : {}),
        ...(hasType || hasDefinitionId ? { definitionId: asString(definition.id) } : {}),
        ...(hasModeId || hasType || hasDefinitionId ? { modeId: asString(mode.id) } : {}),
        ...(hasUniverse ? { universe: nextUniverse } : {}),
        ...(hasOn ? { on: params.on } : {}),
        ...(hasDmxStartAddress || hasType || hasDefinitionId || hasModeId
          ? { dmxStartAddress: profile.channelCount <= 0 ? 0 : nextDmxStartAddress }
          : {}),
        ...(hasGroupId ? { groupId: nextGroupId || null } : {}),
        ...(hasSpatialX
          ? {
              spatialX:
                params.spatialX === null
                  ? null
                  : clampNumber(asNumber(params.spatialX, asNumber(targetFixture.spatialX, 0.5)), 0, 20),
            }
          : {}),
        ...(hasSpatialY
          ? {
              spatialY:
                params.spatialY === null
                  ? null
                  : clampNumber(asNumber(params.spatialY, asNumber(targetFixture.spatialY, 0.5)), 0, 20),
            }
          : {}),
        ...(hasSpatialRotation
          ? {
              spatialRotation:
                ((Math.round(asNumber(params.spatialRotation, asNumber(targetFixture.spatialRotation, 0))) % 360) +
                  360) %
                360,
            }
          : {}),
        ...(hasRigZ
          ? {
              rigZ:
                params.rigZ === null
                  ? null
                  : clampNumber(asNumber(params.rigZ, asNumber(targetFixture.rigZ, 0)), 0, 20),
            }
          : {}),
        ...(hasBeamAngleDegrees
          ? {
              beamAngleDegrees:
                params.beamAngleDegrees === null
                  ? null
                  : clampNumber(
                      asNumber(params.beamAngleDegrees, defaultLightingBeamAngle(normalizedFixtureType)),
                      1,
                      180
                    ),
            }
          : {}),
        ...(hasControlValues
          ? {
              controlValues: {
                ...asNumberRecord(targetFixture.controlValues),
                ...asNumberRecord(params.controlValues),
              },
            }
          : {}),
        ...(hasIntensity
          ? {
              intensity: Math.max(
                0,
                Math.min(100, Math.round(asNumber(params.intensity, asNumber(targetFixture.intensity, 0))))
              ),
            }
          : {}),
        ...(hasCct
          ? {
              cct: clampNumber(
                (() => {
                  const requested = Math.round(asNumber(params.cct, asNumber(targetFixture.cct, defaultCct)));
                  return requested === 0 ? defaultCct : requested;
                })(),
                cctRange.min,
                cctRange.max
              ),
            }
          : {}),
      };
      updatedFixture.controlValues = normalizeControlValues(updatedFixture, profile);
      lightingSnapshot.fixtures = fixtures.map((fixture) =>
        asString(fixture.id) === fixtureId ? updatedFixture : fixture
      );
      synchronizeLightingGroupCounts(lightingSnapshot);

      const summary = buildLightingFixtureUpdateSummary(updatedFixture);
      lightingSnapshot.lastActionStatus = "succeeded";
      lightingSnapshot.lastActionCode = null;
      lightingSnapshot.lastActionMessage = summary;
      lightingSnapshot.summary = summary;
      state.lightingSnapshot = lightingSnapshot;
      synchronizeFixtureState(state);
      emit("lighting.changed", { reason: "fixture-updated" });
      return {
        fixture: cloneJson(updatedFixture),
        summary,
      };
    }
    case "lighting.fixture.delete": {
      const fixtureId = requiredText(params, "fixtureId");
      const lightingSnapshot = asRecord(state.lightingSnapshot) ?? {};
      const deletedFixture = storedFixture(lightingSnapshot, fixtureId);
      lightingSnapshot.fixtures = lightingFixtures(lightingSnapshot).filter(
        (fixture) => asString(fixture.id) !== fixtureId
      );
      // The light leaves every scene with it (`remove_fixture_from_scenes`).
      lightingSnapshot.scenes = lightingScenes(lightingSnapshot).map((scene) => ({
        ...scene,
        fixtureStates: asArray(scene.fixtureStates).filter(
          (fixtureState) => asString(asRecord(fixtureState)?.fixtureId) !== fixtureId
        ),
      }));
      if (asString(lightingSnapshot.selectedFixtureId) === fixtureId) {
        lightingSnapshot.selectedFixtureId = null;
      }
      synchronizeLightingGroupCounts(lightingSnapshot);
      const summary = `Lighting fixture '${asString(deletedFixture.name)}' was deleted.`;
      finishLightingAction(context, lightingSnapshot, summary, "fixture-deleted");
      return { deleted: true, fixtureId, summary };
    }
    // Identify, Highlight, Solo and Find are overrides: they change what
    // `lighting.snapshot` shows, never the stored rig (`lightingOverlay.ts`).
    case "lighting.fixture.identify": {
      const fixtureId = requiredText(params, "fixtureId");
      const requestedDurationMs = params.durationMs;
      if (
        requestedDurationMs !== undefined &&
        requestedDurationMs !== null &&
        !(typeof requestedDurationMs === "number" && Number.isInteger(requestedDurationMs))
      ) {
        throw new Error("durationMs must be a number");
      }
      const lightingSnapshot = asRecord(state.lightingSnapshot) ?? {};
      const fixture = storedFixture(lightingSnapshot, fixtureId);
      const durationMs = clampNumber(
        typeof requestedDurationMs === "number" ? requestedDurationMs : IDENTIFY_DEFAULT_DURATION_MS,
        IDENTIFY_MIN_MS,
        IDENTIFY_MAX_MS
      );
      const nowMs = Date.now();
      // Finished flashes leave with this write; a Find's scheduled ones stay.
      const bursts: IdentifyBursts = Object.fromEntries(
        Object.entries(state.lightingIdentifyBursts).filter(([, burst]) => nowMs - burst.startedAtMs < burst.durationMs)
      );
      bursts[fixtureId] = { startedAtMs: nowMs, durationMs };
      state.lightingIdentifyBursts = bursts;
      const summary = `Identify burst for ${asString(fixture.name)} (${durationMs} ms on universe ${asNumber(lightingSnapshot.universe, 1)})`;
      finishLightingAction(context, lightingSnapshot, summary, "fixture-identified");
      return { fixtureId, durationMs, summary };
    }
    case "lighting.fixture.highlight": {
      const mode = typeof params.mode === "string" ? params.mode.trim() : null;
      if (mode === null) {
        throw new Error("mode is required");
      }
      if (mode !== "highlight" && mode !== "solo" && mode !== "off") {
        throw new Error('mode must be one of "highlight", "solo", or "off"');
      }
      const fixtureIds = fixtureIdList(params, "fixtureIds");
      const lightingSnapshot = asRecord(state.lightingSnapshot) ?? {};
      for (const fixtureId of fixtureIds) {
        storedFixture(lightingSnapshot, fixtureId);
      }
      // Highlight and Solo never stand together: the other one is cleared
      // first, and the hardware link refuses rather than drop it silently.
      if (mode === "highlight" && lightingIdList(lightingSnapshot.soloFixtureIds).length > 0) {
        throw new Error("Solo is active; clear solo before activating highlight.");
      }
      if (mode === "solo" && lightingIdList(lightingSnapshot.highlightFixtureIds).length > 0) {
        throw new Error("Highlight is active; clear highlight before activating solo.");
      }
      lightingSnapshot.highlightFixtureIds = mode === "highlight" ? lightingIdList(fixtureIds) : [];
      lightingSnapshot.soloFixtureIds = mode === "solo" ? lightingIdList(fixtureIds) : [];
      const fixtureCount = mode === "off" ? 0 : fixtureIds.length;
      const summary =
        mode === "highlight"
          ? `Highlight on ${fixtureCount} fixture(s)`
          : mode === "solo"
            ? `Solo on ${fixtureCount} fixture(s)`
            : "Cleared highlight + solo overlays";
      finishLightingAction(context, lightingSnapshot, summary, "fixture-highlighted");
      return { mode, fixtureCount, summary };
    }
    // Find: one flash per light, each a step after the one before; a new
    // sequence replaces whatever was flashing or waiting.
    case "lighting.fixture.identifySequence": {
      const fixtureIds = fixtureIdList(params, "fixtureIds");
      if (fixtureIds.length === 0) {
        throw new Error("fixtureIds must contain at least one id");
      }
      const requestedStepMs = wholeMilliseconds(params, "stepMs");
      const requestedDurationMs = wholeMilliseconds(params, "durationMs");
      if (fixtureIds.length > IDENTIFY_SEQUENCE_MAX_FIXTURES) {
        throw new Error(`identifySequence accepts at most ${IDENTIFY_SEQUENCE_MAX_FIXTURES} fixtures.`);
      }
      const lightingSnapshot = asRecord(state.lightingSnapshot) ?? {};
      for (const fixtureId of fixtureIds) {
        storedFixture(lightingSnapshot, fixtureId);
      }
      const stepMs = clampNumber(requestedStepMs, IDENTIFY_MIN_MS, IDENTIFY_MAX_MS);
      const durationMs = clampNumber(requestedDurationMs, IDENTIFY_MIN_MS, IDENTIFY_MAX_MS);
      const nowMs = Date.now();
      const bursts: IdentifyBursts = {};
      fixtureIds.forEach((fixtureId, index) => {
        bursts[fixtureId] = { startedAtMs: nowMs + index * stepMs, durationMs };
      });
      state.lightingIdentifyBursts = bursts;
      const totalDurationMs = Math.max(fixtureIds.length - 1, 0) * stepMs + durationMs;
      const summary = `Identify sequence on ${fixtureIds.length} fixture(s) (step ${stepMs} ms, ${durationMs} ms each)`;
      finishLightingAction(context, lightingSnapshot, summary, "identify-sequence-started");
      return { fixtureCount: fixtureIds.length, stepMs, durationMs, totalDurationMs, summary };
    }
    case "lighting.fixture.identify.clearAll": {
      const lightingSnapshot = asRecord(state.lightingSnapshot) ?? {};
      // Every flash counts, the finished ones not yet pruned among them.
      const clearedCount = Object.keys(state.lightingIdentifyBursts).length;
      state.lightingIdentifyBursts = {};
      const summary = `Cleared ${clearedCount} identify burst(s)`;
      finishLightingAction(context, lightingSnapshot, summary, "identify-cleared");
      return { clearedCount, summary };
    }
    case "lighting.group.power": {
      const groupId = asString(params.groupId).trim();
      if (!groupId) {
        throw new Error("groupId is required");
      }

      const on = typeof params.on === "boolean" ? params.on : null;
      if (on === null) {
        throw new Error("on must be a boolean");
      }

      const lightingSnapshot = asRecord(state.lightingSnapshot) ?? {};
      const groups = asArray(lightingSnapshot.groups)
        .map((group) => asRecord(group))
        .filter((group): group is JsonObject => group !== null);
      const targetGroup = groups.find((group) => asString(group.id) === groupId);
      if (!targetGroup) {
        throw new Error(`Lighting group '${groupId}' is not present in the group list.`);
      }

      const previewActive = lightingPreviewActive(lightingSnapshot);
      const fixtures = previewActive
        ? lightingFixtures(lightingSnapshot, "previewFixtures")
        : lightingFixtures(lightingSnapshot);
      const affectedFixtures = fixtures.filter((fixture) => asString(fixture.groupId) === groupId).length;
      if (affectedFixtures === 0) {
        throw new Error(`Lighting group '${asString(targetGroup.name, groupId)}' does not currently contain fixtures.`);
      }

      if (!previewActive && !asBoolean(lightingSnapshot.reachable, false)) {
        throw new Error("Lighting group power requires a reachable lighting transport.");
      }

      const nextFixtures = fixtures.map((fixture) =>
        asString(fixture.groupId) === groupId ? { ...fixture, on } : fixture
      );
      if (previewActive) {
        lightingSnapshot.previewFixtures = nextFixtures;
        lightingSnapshot.previewDirty = true;
      } else {
        lightingSnapshot.fixtures = nextFixtures;
      }

      const summary = `Lighting group '${asString(targetGroup.name, groupId)}' set ${on ? "on" : "off"} across ${affectedFixtures} fixtures${previewActive ? " in preview" : ""}.`;
      lightingSnapshot.lastActionStatus = "succeeded";
      lightingSnapshot.lastActionCode = null;
      lightingSnapshot.lastActionMessage = summary;
      lightingSnapshot.summary = summary;
      state.lightingSnapshot = lightingSnapshot;
      synchronizeFixtureState(state);
      emit("lighting.changed", { reason: previewActive ? "group-preview-powered" : "group-powered" });
      return {
        affectedFixtures,
        groupId,
        groupName: asString(targetGroup.name, groupId),
        summary,
      };
    }
    case "lighting.group.create": {
      const name = asString(params.name).trim();
      if (!name) {
        throw new Error("name is required");
      }

      const lightingSnapshot = asRecord(state.lightingSnapshot) ?? {};
      const groups = asArray(lightingSnapshot.groups)
        .map((group) => asRecord(group))
        .filter((group): group is JsonObject => group !== null);
      const createdGroup = {
        id: nextCustomGroupId(groups),
        name,
        fixtureCount: 0,
      };

      lightingSnapshot.groups = [...groups, createdGroup];
      const summary = `Lighting group '${name}' was created.`;
      lightingSnapshot.lastActionStatus = "succeeded";
      lightingSnapshot.lastActionCode = null;
      lightingSnapshot.lastActionMessage = summary;
      lightingSnapshot.summary = summary;
      state.lightingSnapshot = lightingSnapshot;
      synchronizeFixtureState(state);
      emit("lighting.changed", { reason: "group-created" });
      return {
        group: cloneJson(createdGroup),
        summary,
      };
    }
    case "lighting.group.update": {
      const groupId = asString(params.groupId).trim();
      if (!groupId) {
        throw new Error("groupId is required");
      }
      const hasName = typeof params.name === "string";
      const hasColor = Object.prototype.hasOwnProperty.call(params, "colorIndex");
      if (!hasName && !hasColor) {
        throw new Error("lighting.group.update requires a name or colorIndex");
      }
      const nextName = hasName ? asString(params.name).trim() : null;
      if (hasName && !nextName) {
        throw new Error("name must not be empty");
      }

      const lightingSnapshot = asRecord(state.lightingSnapshot) ?? {};
      const groups = asArray(lightingSnapshot.groups)
        .map((group) => asRecord(group))
        .filter((group): group is JsonObject => group !== null);
      const targetGroup = groups.find((group) => asString(group.id) === groupId);
      if (!targetGroup) {
        throw new Error(`Lighting group '${groupId}' is not present in the group list.`);
      }

      let nextColorIndex: number | null = (targetGroup.colorIndex as number | null | undefined) ?? null;
      if (hasColor) {
        if (params.colorIndex === null) {
          nextColorIndex = null;
        } else {
          const raw = asNumber(params.colorIndex, NaN);
          if (!Number.isInteger(raw) || raw < 0 || raw > 7) {
            throw new Error("colorIndex must be an integer 0..7 or null");
          }
          nextColorIndex = raw;
        }
      }

      const updatedGroup: JsonObject = {
        ...targetGroup,
        ...(hasName && nextName ? { name: nextName } : {}),
        colorIndex: nextColorIndex,
      };
      lightingSnapshot.groups = groups.map((group) => (asString(group.id) === groupId ? updatedGroup : group));
      const summaryParts: string[] = [];
      if (hasName && nextName) summaryParts.push(`renamed to '${nextName}'`);
      if (hasColor) summaryParts.push(nextColorIndex === null ? "color cleared" : "recolored");
      const groupName = asString(updatedGroup.name, groupId);
      const summary = `Lighting group '${groupName}' ${summaryParts.join(" + ")}.`;
      lightingSnapshot.lastActionStatus = "succeeded";
      lightingSnapshot.lastActionCode = null;
      lightingSnapshot.lastActionMessage = summary;
      lightingSnapshot.summary = summary;
      state.lightingSnapshot = lightingSnapshot;
      synchronizeFixtureState(state);
      emit("lighting.changed", { reason: "group-updated" });
      return {
        group: cloneJson(updatedGroup),
        summary,
      };
    }
    case "lighting.group.delete": {
      const groupId = asString(params.groupId).trim();
      if (!groupId) {
        throw new Error("groupId is required");
      }

      const lightingSnapshot = asRecord(state.lightingSnapshot) ?? {};
      const groups = asArray(lightingSnapshot.groups)
        .map((group) => asRecord(group))
        .filter((group): group is JsonObject => group !== null);
      const targetGroup = groups.find((group) => asString(group.id) === groupId);
      if (!targetGroup) {
        throw new Error(`Lighting group '${groupId}' is not present in the group list.`);
      }
      const groupName = asString(targetGroup.name, groupId);

      // Engine semantics: deleting a group clears its members' groupId
      // assignments but leaves the fixtures themselves in the rig.
      const fixtures = asArray(lightingSnapshot.fixtures)
        .map((fixture) => asRecord(fixture))
        .filter((fixture): fixture is JsonObject => fixture !== null)
        .map((fixture) => (asString(fixture.groupId) === groupId ? { ...fixture, groupId: null } : fixture));

      lightingSnapshot.groups = groups.filter((group) => asString(group.id) !== groupId);
      lightingSnapshot.fixtures = fixtures;
      const summary = `Lighting group '${groupName}' was deleted.`;
      lightingSnapshot.lastActionStatus = "succeeded";
      lightingSnapshot.lastActionCode = null;
      lightingSnapshot.lastActionMessage = summary;
      lightingSnapshot.summary = summary;
      state.lightingSnapshot = lightingSnapshot;
      synchronizeFixtureState(state);
      emit("lighting.changed", { reason: "group-deleted" });
      return {
        groupId,
        groupName,
        summary,
      };
    }
    case "lighting.group.reorder": {
      const groupId = requiredText(params, "groupId");
      const beforeGroupId = reorderAnchor(params, "beforeGroupId", groupId, "groupId");
      const lightingSnapshot = asRecord(state.lightingSnapshot) ?? {};
      const groups = asArray(lightingSnapshot.groups)
        .map((group) => asRecord(group))
        .filter((group): group is JsonObject => group !== null);
      const movedGroup = groups.find((group) => asString(group.id) === groupId);
      if (!movedGroup) {
        throw new Error(`Lighting group '${groupId}' is not exposed by the native editor state.`);
      }
      if (beforeGroupId !== null && !groups.some((group) => asString(group.id) === beforeGroupId)) {
        throw new Error(`Reorder anchor group '${beforeGroupId}' is not exposed by the native editor state.`);
      }
      lightingSnapshot.groups = movedBefore(groups, movedGroup, beforeGroupId);
      const summary = `Lighting group '${groupId}' was reordered in the rail.`;
      finishLightingAction(context, lightingSnapshot, summary, "group-reordered");
      return { groupId, summary };
    }
    case "lighting.power.all": {
      const on = typeof params.on === "boolean" ? params.on : null;
      if (on === null) {
        throw new Error("on must be a boolean");
      }

      const lightingSnapshot = asRecord(state.lightingSnapshot) ?? {};
      const previewActive = lightingPreviewActive(lightingSnapshot);
      const fixtures = previewActive
        ? lightingFixtures(lightingSnapshot, "previewFixtures")
        : lightingFixtures(lightingSnapshot);
      if (fixtures.length === 0) {
        throw new Error("No lighting fixtures are exposed by the fixture transport.");
      }

      const nextFixtures = fixtures.map((fixture) => ({ ...fixture, on }));
      if (previewActive) {
        lightingSnapshot.previewFixtures = nextFixtures;
        lightingSnapshot.previewDirty = true;
      } else {
        lightingSnapshot.fixtures = nextFixtures;
      }

      const summary = `All native lighting fixtures set ${on ? "on" : "off"} across ${fixtures.length} fixtures${previewActive ? " in preview" : ""}.`;
      lightingSnapshot.lastActionStatus = "succeeded";
      lightingSnapshot.lastActionCode = null;
      lightingSnapshot.lastActionMessage = summary;
      lightingSnapshot.summary = summary;
      state.lightingSnapshot = lightingSnapshot;
      synchronizeFixtureState(state);
      emit("lighting.changed", { reason: previewActive ? "all-preview-powered" : "all-powered" });
      return {
        affectedFixtures: fixtures.length,
        summary,
      };
    }
    // 2026-09 production readiness, Slice 11 (F31): as the hardware link
    // does it — the flag on the lighting snapshot and `lighting.changed`; the
    // Recent-actions row is the action log's (`actionLog.ts`), as for every
    // action the screen asks for.
    case "lighting.output.setArmed": {
      const armed = typeof params.armed === "boolean" ? params.armed : null;
      if (armed === null) {
        throw new Error("armed is required and must be true or false");
      }
      const lightingSnapshot = asRecord(state.lightingSnapshot) ?? {};
      lightingSnapshot.outputArmed = armed;
      state.lightingSnapshot = lightingSnapshot;
      synchronizeFixtureState(state);
      emit("lighting.changed", { reason: "output-armed-changed" });
      return {
        armed,
        summary: armed
          ? "Light outputs armed: the rig follows the app."
          : "Light outputs held: nothing is sent to the rig until they are armed.",
      };
    }
    default:
      return NOT_HANDLED;
  }
}

// What a lighting action leaves behind on the hardware link: the last action
// on the snapshot, the rest of the double brought in line, one `lighting.changed`.
function finishLightingAction(
  context: FixtureRequestContext,
  lightingSnapshot: JsonObject,
  summary: string,
  reason: string
) {
  lightingSnapshot.lastActionStatus = "succeeded";
  lightingSnapshot.lastActionCode = null;
  lightingSnapshot.lastActionMessage = summary;
  lightingSnapshot.summary = summary;
  context.state.lightingSnapshot = lightingSnapshot;
  synchronizeFixtureState(context.state);
  context.emit("lighting.changed", { reason });
}

function storedFixture(lightingSnapshot: JsonObject, fixtureId: string): JsonObject {
  const fixture = lightingFixtures(lightingSnapshot).find((entry) => asString(entry.id) === fixtureId);
  if (!fixture) {
    throw new Error(`Lighting fixture '${fixtureId}' is not exposed by the native editor state.`);
  }
  return fixture;
}

// The rails' reorder rule (`reorder_lighting_scene`, `reorder_lighting_group`):
// out of the list, then in before the anchor, or last when there is none.
function movedBefore(entries: readonly JsonObject[], moved: JsonObject, beforeId: string | null): JsonObject[] {
  const rest = entries.filter((entry) => entry !== moved);
  const anchorIndex = beforeId === null ? -1 : rest.findIndex((entry) => asString(entry.id) === beforeId);
  return anchorIndex < 0 ? [...rest, moved] : [...rest.slice(0, anchorIndex), moved, ...rest.slice(anchorIndex)];
}

// The request checks below say what `E/lighting/parse.rs` says, word for word.
function requiredText(params: JsonObject, key: string): string {
  const raw = params[key];
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function fixtureIdList(params: JsonObject, field: string): string[] {
  const value = params[field];
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array of strings`);
  }
  return value.map((entry) => {
    const fixtureId = typeof entry === "string" ? entry.trim() : "";
    if (!fixtureId) {
      throw new Error(`${field} entries must be non-empty strings`);
    }
    return fixtureId;
  });
}

// Absent, null or blank is "move to the end".
function reorderAnchor(params: JsonObject, key: string, movedId: string, movedKey: string): string | null {
  const value = params[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`${key} must be a string or null`);
  }
  const anchorId = value.trim();
  if (!anchorId) {
    return null;
  }
  if (anchorId === movedId) {
    throw new Error(`${key} must differ from ${movedKey}`);
  }
  return anchorId;
}

// `parse_i64_value`: a whole number, or a finite one rounded.
function wholeMilliseconds(params: JsonObject, key: string): number {
  const value = params[key];
  if (value === undefined) {
    throw new Error(`${key} is required`);
  }
  if (typeof value !== "number") {
    throw new Error("value must be a number");
  }
  if (!Number.isFinite(value)) {
    throw new Error("value must be a finite number");
  }
  return Math.round(value);
}
