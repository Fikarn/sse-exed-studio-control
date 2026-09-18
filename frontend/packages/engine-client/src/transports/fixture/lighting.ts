// Part of the fixture double (`../fixtureTransport.ts`): the in-memory stand-in for the
// hardware link that Playwright and the browser fixture mode run against. Test-only.
import type { JsonObject } from "../../generated/protocol";
import { asArray, asRecord, asBoolean, asString, asNumber } from "./json";
import {
  normalizeFixtureType,
  lightingFixtureCctRange,
  fixtureProfileForFixture,
  defaultLightingFixtureCct,
} from "./lightingCatalog";

export function lightingFixtures(snapshot: JsonObject, key: "fixtures" | "previewFixtures" = "fixtures"): JsonObject[] {
  return asArray(snapshot[key])
    .map((fixture) => asRecord(fixture))
    .filter((fixture): fixture is JsonObject => fixture !== null);
}

export function lightingScenes(snapshot: JsonObject): JsonObject[] {
  return asArray(snapshot.scenes)
    .map((scene) => asRecord(scene))
    .filter((scene): scene is JsonObject => scene !== null);
}

export function lightingPalettes(snapshot: JsonObject): JsonObject[] {
  return asArray(snapshot.palettes)
    .map((palette) => asRecord(palette))
    .filter((palette): palette is JsonObject => palette !== null);
}

export function lightingPreviewActive(snapshot: JsonObject): boolean {
  return asBoolean(snapshot.previewMode, false);
}

export function previewFixturesFromScene(liveFixtures: readonly JsonObject[], scene: JsonObject): JsonObject[] {
  const fixtureStates = asArray(scene.fixtureStates)
    .map((fixtureState) => asRecord(fixtureState))
    .filter((fixtureState): fixtureState is JsonObject => fixtureState !== null);

  return liveFixtures.map((fixture) => {
    const nextState = fixtureStates.find((fixtureState) => asString(fixtureState.fixtureId) === asString(fixture.id));
    if (!nextState) return fixture;
    return {
      ...fixture,
      cct: asNumber(nextState.cct, asNumber(fixture.cct, 3200)),
      controlValues: asRecord(nextState.controlValues) ?? asRecord(fixture.controlValues) ?? {},
      intensity: asNumber(nextState.intensity, asNumber(fixture.intensity, 0)),
      on: asBoolean(nextState.on, asBoolean(fixture.on, false)),
    };
  });
}

export function clearLightingPreview(snapshot: JsonObject) {
  snapshot.previewMode = false;
  snapshot.previewDirty = false;
  snapshot.previewSceneId = null;
  snapshot.previewFixtures = [];
}

export function buildDefaultLightingSnapshot(): JsonObject {
  return {
    status: "unconfigured",
    summary: "Lighting snapshot has not been commissioned yet.",
    adapterMode: "fixture",
    bridgeIp: "",
    universe: 1,
    enabled: false,
    grandMaster: 100,
    connected: false,
    reachable: false,
    outputArmed: true,
    lastActionStatus: "idle",
    fixtures: [],
    groups: [],
    scenes: [],
    palettes: defaultLightingPalettes(),
    previewMode: false,
    previewDirty: false,
    previewSceneId: null,
    previewFixtures: [],
    selectedSceneId: null,
    selectedFixtureId: null,
  };
}

export function defaultLightingPalettes(): JsonObject[] {
  return [
    { id: "palette-intensity-low", name: "Low", kind: "intensity", value: 10, colorIndex: 5 },
    { id: "palette-intensity-quarter", name: "Quarter", kind: "intensity", value: 25, colorIndex: 4 },
    { id: "palette-intensity-half", name: "Half", kind: "intensity", value: 50, colorIndex: 2 },
    { id: "palette-intensity-full", name: "Full", kind: "intensity", value: 100, colorIndex: 0 },
    { id: "palette-cct-warm", name: "Warm", kind: "cct", value: 2700, colorIndex: 0 },
    { id: "palette-cct-studio", name: "Studio", kind: "cct", value: 4000, colorIndex: 4 },
    { id: "palette-cct-daylight", name: "Daylight", kind: "cct", value: 5600, colorIndex: 5 },
    { id: "palette-cct-cool", name: "Cool", kind: "cct", value: 6500, colorIndex: 5 },
  ];
}

export function normalizePaletteKind(value: unknown): "intensity" | "cct" | null {
  const kind = asString(value).trim();
  return kind === "intensity" || kind === "cct" ? kind : null;
}

export function normalizePaletteValue(kind: "intensity" | "cct", value: unknown) {
  const raw = asNumber(value, kind === "intensity" ? 50 : 4000);
  return kind === "intensity" ? clampNumber(raw, 0, 100) : clampNumber(raw, 2000, 10000);
}

export function validatePaletteValue(kind: "intensity" | "cct", value: unknown) {
  const raw = asNumber(value, NaN);
  const min = kind === "intensity" ? 0 : 2000;
  const max = kind === "intensity" ? 100 : 10000;
  if (!Number.isFinite(raw) || raw < min || raw > max) {
    throw new Error(`Palette value must be between ${min} and ${max}.`);
  }
  return raw;
}

export function parseLightingColorIndex(value: unknown): number | null {
  if (value === null) return null;
  const raw = asNumber(value, NaN);
  if (!Number.isInteger(raw) || raw < 0 || raw > 7) {
    throw new Error("colorIndex must be an integer 0..7 or null");
  }
  return raw;
}

export function formatLightingPaletteValue(kind: "intensity" | "cct", value: unknown) {
  const normalized = normalizePaletteValue(kind, value);
  return kind === "intensity" ? `${Math.round(normalized)}%` : `${Math.round(normalized)}K`;
}

export function applyLightingPaletteToFixture(fixture: JsonObject, palette: JsonObject): JsonObject {
  const kind = normalizePaletteKind(palette.kind);
  if (kind === "intensity") {
    const intensity = Math.round(normalizePaletteValue(kind, palette.value));
    return {
      ...fixture,
      intensity,
      on: intensity > 0,
    };
  }
  if (kind === "cct") {
    const fixtureType = normalizeFixtureType(fixture.type);
    const cctRange = lightingFixtureCctRange(fixtureType);
    return {
      ...fixture,
      cct: clampNumber(Math.round(normalizePaletteValue(kind, palette.value)), cctRange.min, cctRange.max),
    };
  }
  return fixture;
}

export function defaultLightingBeamAngle(fixtureType: string) {
  switch (fixtureType) {
    case "infinibar-pb12":
      return 110;
    case "infinimat":
      return 100;
    case "apollo-bridge":
    case "astra-bicolor":
      return 50;
    default:
      return 60;
  }
}

export function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function intensityToDmx(percent: number) {
  return Math.round(clampNumber(percent, 0, 100) * 2.55);
}

export function cctToDmx(kelvin: number, min: number, max: number) {
  const clamped = clampNumber(kelvin, min, max);
  if (max <= min) return 0;
  return Math.round(((clamped - min) / (max - min)) * 255);
}

export function asNumberRecord(value: unknown): Record<string, number> {
  const record = asRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record).flatMap(([key, entry]) => {
      const numeric = asNumber(entry, NaN);
      return Number.isFinite(numeric) ? [[key, numeric]] : [];
    })
  );
}

export function normalizeControlValues(
  fixture: JsonObject,
  profile = fixtureProfileForFixture(fixture)
): Record<string, number> {
  const current = asNumberRecord(fixture.controlValues);
  const values: Record<string, number> = {};
  for (const control of profile.controls) {
    const id = asString(control.id);
    if (!id || id === "intensity" || id === "cct") continue;
    values[id] = clampNumber(
      Math.round(current[id] ?? asNumber(control.defaultValue, 0)),
      asNumber(control.min, 0),
      asNumber(control.max, 255)
    );
  }
  values.intensity = clampNumber(Math.round(asNumber(fixture.intensity, 0)), 0, 100);
  if (profile.channels.some((channel) => asString(channel.controlId) === "cct")) {
    const range = lightingFixtureCctRange(fixture);
    values.cct = clampNumber(
      Math.round(asNumber(fixture.cct, defaultLightingFixtureCct(fixture))),
      range.min,
      range.max
    );
  }
  return values;
}

export function dmxValueForControl(
  controlId: string,
  valueType: string,
  fixture: JsonObject,
  profile: ReturnType<typeof fixtureProfileForFixture>,
  grandMaster: number
) {
  const controlValues = normalizeControlValues(fixture, profile);
  switch (controlId) {
    case "intensity":
      return asBoolean(fixture.on, false) ? Math.round(intensityToDmx(controlValues.intensity ?? 0) * grandMaster) : 0;
    case "cct": {
      const range = lightingFixtureCctRange(fixture);
      return cctToDmx(controlValues.cct ?? defaultLightingFixtureCct(fixture), range.min, range.max);
    }
    case "green-magenta":
      return (Math.round(clampNumber(controlValues["green-magenta"] ?? 0, -100, 100) + 100) * 255) / 200;
    default:
      if (valueType === "fine") return 0;
      return clampNumber(Math.round(controlValues[controlId] ?? asNumber(profile.defaults[controlId], 0)), 0, 255);
  }
}

export function buildLightingDmxMonitorSnapshot(lightingSnapshot: JsonObject | null): JsonObject {
  const fixtures = asArray(lightingSnapshot?.fixtures)
    .map((fixture) => asRecord(fixture))
    .filter((fixture): fixture is JsonObject => fixture !== null);
  const grandMaster = clampNumber(asNumber(lightingSnapshot?.grandMaster, 100), 0, 100) / 100;
  const channels: JsonObject[] = [];

  for (const fixture of fixtures) {
    const profile = fixtureProfileForFixture(fixture);
    const channelCount = profile.channelCount;
    const startAddress = asNumber(fixture.dmxStartAddress, 1);
    if (channelCount <= 0 || startAddress <= 0) continue;
    const universe = asNumber(fixture.universe, asNumber(lightingSnapshot?.universe, 1));

    for (let offset = 0; offset < channelCount; offset += 1) {
      const channel = startAddress + offset;
      const catalogChannel = profile.channels[offset] ?? {};
      const controlId = asString(catalogChannel.controlId, "reserved");
      const valueType = asString(catalogChannel.valueType, "range");
      const value = dmxValueForControl(controlId, valueType, fixture, profile, grandMaster);

      channels.push({
        universe,
        channel,
        label: asString(catalogChannel.label, `Ch${offset + 1}`),
        lightName: asString(fixture.name, asString(fixture.id, "Fixture")),
        value: Math.round(clampNumber(value, 0, 255)),
      });
    }
  }

  channels.sort((left, right) => {
    const universeDelta = asNumber(left.universe, 1) - asNumber(right.universe, 1);
    return universeDelta !== 0 ? universeDelta : asNumber(left.channel, 0) - asNumber(right.channel, 0);
  });
  return { channels };
}

export function buildLightingFixtureUpdateSummary(fixture: JsonObject) {
  const spatialRotation = asNumber(fixture.spatialRotation, 0);
  const spatialSummary =
    typeof fixture.spatialX === "number" && typeof fixture.spatialY === "number"
      ? `manual layout at ${fixture.spatialX.toFixed(1)}m / ${fixture.spatialY.toFixed(1)}m / ${Math.round(spatialRotation)}deg`
      : `auto layout / ${Math.round(spatialRotation)}deg`;
  const beamAngle = asNumber(fixture.beamAngleDegrees, defaultLightingBeamAngle(asString(fixture.type, "fixture")));
  const rigZSummary = typeof fixture.rigZ === "number" ? `${fixture.rigZ.toFixed(1)}m rig` : "auto rig height";
  const effect = asRecord(fixture.effect);
  const effectSummary =
    effect && typeof effect.effectType === "string"
      ? `${effect.effectType} at speed ${asNumber(effect.speed, 0)}`
      : "no effect";
  const groupId = asString(fixture.groupId).trim();

  return `Lighting fixture '${asString(fixture.name, "Fixture")}' (${asString(fixture.type, "fixture")}, DMX ${asNumber(fixture.dmxStartAddress, 0)}) saved as ${asBoolean(fixture.on, false) ? "on" : "off"} at ${asNumber(fixture.intensity, 0)}% / ${asNumber(fixture.cct, 3200)}K in ${groupId || "ungrouped"} with ${spatialSummary}, ${rigZSummary}, beam ${Math.round(beamAngle)}deg, and ${effectSummary}.`;
}

export function nextCustomFixtureId(fixtures: JsonObject[]) {
  const usedIds = new Set(fixtures.map((fixture) => asString(fixture.id)));
  let index = 1;
  while (usedIds.has(`fixture-custom-${index}`)) {
    index += 1;
  }
  return `fixture-custom-${index}`;
}

export function nextCustomGroupId(groups: JsonObject[]) {
  const usedIds = new Set(groups.map((group) => asString(group.id)));
  let index = 1;
  while (usedIds.has(`group-custom-${index}`)) {
    index += 1;
  }
  return `group-custom-${index}`;
}

export function nextCustomSceneId(scenes: JsonObject[]) {
  const usedIds = new Set(scenes.map((scene) => asString(scene.id)));
  let index = 1;
  while (usedIds.has(`scene-custom-${index}`)) {
    index += 1;
  }
  return `scene-custom-${index}`;
}

export function nextCustomPaletteId(palettes: JsonObject[]) {
  const usedIds = new Set(palettes.map((palette) => asString(palette.id)));
  let index = 1;
  while (usedIds.has(`palette-custom-${index}`)) {
    index += 1;
  }
  return `palette-custom-${index}`;
}

export function synchronizeLightingGroupCounts(lightingSnapshot: JsonObject) {
  const fixtures = asArray(lightingSnapshot.fixtures)
    .map((fixture) => asRecord(fixture))
    .filter((fixture): fixture is JsonObject => fixture !== null);
  const groups = asArray(lightingSnapshot.groups)
    .map((group) => asRecord(group))
    .filter((group): group is JsonObject => group !== null);

  lightingSnapshot.groups = groups.map((group) => ({
    ...group,
    fixtureCount: fixtures.filter((fixture) => asString(fixture.groupId) === asString(group.id)).length,
  }));
}

export function normalizeLightingFixtureSnapshotEntry(fixture: JsonObject, fallbackUniverse: number): JsonObject {
  const profile = fixtureProfileForFixture(fixture);
  const cctRange = lightingFixtureCctRange(fixture);
  const defaultCct = defaultLightingFixtureCct(fixture);
  const channelCount = profile.channelCount;
  const normalizedStart =
    channelCount <= 0 ? 0 : clampNumber(Math.round(asNumber(fixture.dmxStartAddress, 1)), 1, 512 - channelCount + 1);
  const normalizedFixture: JsonObject = {
    ...fixture,
    type: profile.fixtureType,
    definitionId: profile.definitionId,
    modeId: profile.modeId,
    universe: Math.max(1, Math.round(asNumber(fixture.universe, fallbackUniverse))),
    dmxStartAddress: normalizedStart,
    kind: profile.kind,
    groupId: typeof fixture.groupId === "string" && fixture.groupId.trim() ? fixture.groupId : null,
    spatialX: typeof fixture.spatialX === "number" ? clampNumber(fixture.spatialX, 0, 20) : null,
    spatialY: typeof fixture.spatialY === "number" ? clampNumber(fixture.spatialY, 0, 20) : null,
    spatialRotation: asNumber(fixture.spatialRotation, 0),
    rigZ: typeof fixture.rigZ === "number" ? clampNumber(fixture.rigZ, 0, 20) : null,
    beamAngleDegrees:
      typeof fixture.beamAngleDegrees === "number" ? clampNumber(fixture.beamAngleDegrees, 1, 180) : null,
    on: asBoolean(fixture.on, false),
    intensity: clampNumber(Math.round(asNumber(fixture.intensity, 0)), 0, 100),
    cct: clampNumber(Math.round(asNumber(fixture.cct, defaultCct)), cctRange.min, cctRange.max),
    effect: asRecord(fixture.effect),
  };
  normalizedFixture.controlValues = normalizeControlValues(normalizedFixture, profile);
  return normalizedFixture;
}

export function sceneFixtureStateFromFixture(fixture: JsonObject): JsonObject {
  return {
    fixtureId: asString(fixture.id),
    intensity: asNumber(fixture.intensity, 0),
    cct: asNumber(fixture.cct, 3200),
    on: asBoolean(fixture.on, false),
    controlValues: asRecord(fixture.controlValues) ?? {},
  };
}
