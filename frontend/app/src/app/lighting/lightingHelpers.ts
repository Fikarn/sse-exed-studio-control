import type { StatusTone } from "@sse/design-system";

// ---------------------------------------------------------------------------
// Studio plot dimensions used by both the stage rendering and the keyboard
// nudge handler. Keep them here so any future tuning lives in one place.
// ---------------------------------------------------------------------------
export const LIGHTING_ROOM_WIDTH_METERS = 12;
export const LIGHTING_NUDGE_METERS = 0.1;

// ---------------------------------------------------------------------------
// Status / cue tone mapping
// ---------------------------------------------------------------------------

export function lightingStatusTone(status: unknown) {
  switch (status) {
    case "ready":
      return "ok";
    case "attention":
      return "attention";
    case "error":
      return "error";
    default:
      return "info";
  }
}

export function lightingCueTone(state: string): StatusTone {
  switch (state) {
    case "active":
      return "connected";
    case "fired":
      return "healthy";
    default:
      return "idle";
  }
}

// ---------------------------------------------------------------------------
// Fixture rendering: colour, beam geometry, intensity → opacity, CCT range.
// ---------------------------------------------------------------------------

export function lightingFixtureColor(cct: number, on: boolean) {
  if (!on) {
    return "color-mix(in srgb, var(--color-surface-500) 88%, black)";
  }

  if (cct <= 3200) {
    return "#ffb35c";
  }

  if (cct <= 4400) {
    return "#ffd38b";
  }

  return "#eaf0ff";
}

export function defaultLightingBeamAngle(fixtureType: string) {
  const normalized = fixtureType.trim().toLowerCase();
  switch (normalized) {
    case "infinibar":
    case "infinibar pb12":
    case "infinibar-pb12":
      return 110;
    case "infinimat":
      return 100;
    case "apollo bridge":
    case "astra":
    case "astra bi-color":
    case "astra-bicolor":
      return 50;
    default:
      return 60;
  }
}

export function lightingFixtureBeamAngle(fixtureType: string, beamAngleDegrees?: number) {
  const fallback = defaultLightingBeamAngle(fixtureType);
  if (typeof beamAngleDegrees !== "number" || Number.isNaN(beamAngleDegrees)) {
    return fallback;
  }
  return Math.max(1, Math.min(180, beamAngleDegrees));
}

export function formatLightingRigHeight(rigZ?: number) {
  return typeof rigZ === "number" && Number.isFinite(rigZ) ? `${rigZ.toFixed(1)} m` : "Auto";
}

export function formatLightingBeamAngleValue(fixtureType: string, beamAngleDegrees?: number) {
  return `${Math.round(lightingFixtureBeamAngle(fixtureType, beamAngleDegrees))}°`;
}

export function lightingFixtureBeamLength(kind: string) {
  switch (kind.trim().toLowerCase()) {
    case "beam":
      return 19;
    case "wash":
      return 24;
    default:
      return 22;
  }
}

export function lightingFixtureBeamWidth(beamAngleDegrees: number, beamLength: number) {
  return Math.max(10, Math.min(42, (beamAngleDegrees / 180) * beamLength * 1.6));
}

export function lightingFixtureBeamOpacity(intensity: number, on: boolean) {
  if (!on || intensity <= 0) {
    return 0;
  }
  return Math.max(0.16, Math.min(0.44, 0.14 + (intensity / 100) * 0.3));
}

export function clampLightingIntensity(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function interpolateLightingValue(start: number, end: number, progress: number) {
  return start + (end - start) * Math.max(0, Math.min(1, progress));
}

export function lightingFixtureStageFadeOpacity(intensity: number, on: boolean) {
  if (!on || intensity <= 0) {
    return 0.22;
  }
  return Math.max(0.22, Math.min(1, 0.18 + (intensity / 100) * 0.82));
}

export function lightingFixtureCctRange(fixtureType: string) {
  const normalized = fixtureType.trim().toLowerCase();
  switch (normalized) {
    case "infinimat":
    case "infinibar":
    case "infinibar pb12":
    case "infinibar-pb12":
      return { max: 10_000, min: 2_000 };
    default:
      return { max: 5_600, min: 3_200 };
  }
}

export function lightingFixtureCctPercent(cct: number, fixtureType: string) {
  const range = lightingFixtureCctRange(fixtureType);
  const clamped = Math.max(range.min, Math.min(range.max, Math.round(cct)));
  return ((clamped - range.min) / (range.max - range.min)) * 100;
}

// ---------------------------------------------------------------------------
// Cue / value formatting (used by the cue rail, DMX monitor, and the patch
// inspector's read-only displays).
// ---------------------------------------------------------------------------

export function formatLightingCueFadeSeconds(fadeInMs: number) {
  return `${(Math.max(0, fadeInMs) / 1000).toFixed(1)} s`;
}

export function formatLightingValueRange(min: number, max: number, suffix: string) {
  return min === max ? `${min}${suffix}` : `${min}-${max}${suffix}`;
}

export function formatDmxValue(value: number) {
  const normalized = Math.max(0, Math.min(255, Math.round(value)));
  return normalized.toString(16).toUpperCase().padStart(2, "0");
}

// ---------------------------------------------------------------------------
// Search and keyboard predicates used by the toolbar search and the slider
// inspector. Pure utilities, no DOM access.
// ---------------------------------------------------------------------------

export function lightingSearchMatchesFixture(
  fixture: {
    kind: string;
    name: string;
    type: string;
  },
  groupLabel: string,
  query: string
) {
  if (!query) {
    return true;
  }

  const haystack = `${fixture.name} ${fixture.type} ${fixture.kind} ${groupLabel}`.toLowerCase();
  return haystack.includes(query);
}

export function isLightingRangeCommitKey(key: string) {
  return (
    key === "Home" ||
    key === "End" ||
    key === "PageUp" ||
    key === "PageDown" ||
    key.startsWith("Arrow") ||
    /^[0-9]$/.test(key)
  );
}

export function fallbackFixturePosition(index: number) {
  const columns = 4;
  const column = index % columns;
  const row = Math.floor(index / columns);
  return {
    x: 0.16 + column * 0.2,
    y: 0.24 + row * 0.18,
  };
}

// ---------------------------------------------------------------------------
// Stage section bins. The keyboard `1`-`5` shortcuts pivot between these,
// and the stage plot uses them to decide which fixtures glow when a section
// is "active".
// ---------------------------------------------------------------------------

export interface LightingSectionDefinition {
  id: string;
  key: string;
  label: string;
  xMax: number;
  xMin: number;
  yMax: number;
  yMin: number;
}

export const LIGHTING_SECTION_DEFINITIONS: LightingSectionDefinition[] = [
  { id: "stage-left", key: "1", label: "Stage Left", xMin: 0, xMax: 0.34, yMin: 0, yMax: 1 },
  { id: "center-line", key: "2", label: "Center Line", xMin: 0.34, xMax: 0.66, yMin: 0, yMax: 1 },
  { id: "stage-right", key: "3", label: "Stage Right", xMin: 0.66, xMax: 1, yMin: 0, yMax: 1 },
  { id: "upstage", key: "4", label: "Upstage", xMin: 0, xMax: 1, yMin: 0, yMax: 0.42 },
  { id: "downstage", key: "5", label: "Downstage", xMin: 0, xMax: 1, yMin: 0.42, yMax: 1 },
];

export function fixtureMatchesLightingSection(
  fixture: { spatialX?: number; spatialY?: number },
  section: LightingSectionDefinition
) {
  if (typeof fixture.spatialX !== "number" || typeof fixture.spatialY !== "number") {
    return false;
  }

  return (
    fixture.spatialX >= section.xMin &&
    fixture.spatialX <= section.xMax &&
    fixture.spatialY >= section.yMin &&
    fixture.spatialY <= section.yMax
  );
}

export function buildLightingSections(
  fixtures: Array<{ spatialX?: number; spatialY?: number }>
): LightingSectionDefinition[] {
  return LIGHTING_SECTION_DEFINITIONS.filter((section) =>
    fixtures.some((fixture) => fixtureMatchesLightingSection(fixture, section))
  );
}
