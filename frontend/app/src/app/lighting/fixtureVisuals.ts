import type {
  LightingFixtureCatalogSnapshot,
  LightingFixtureDefinitionSnapshot,
  LightingFixtureModeSnapshot,
  LightingFixtureSnapshot,
  LightingFixtureVisualSnapshot,
} from "@sse/engine-client";

import { getFixtureDefinition, getFixtureMode, normalizeCatalogAlias } from "./fixtureCatalog";
import { deriveMounting, type FixtureMounting } from "./fixtureMounting";
import { lightingFixtureBeamAngle } from "./lightingHelpers";

export type StagePlotRenderMode = "rig" | "coverage" | "photometric" | "pixel";

export type FixtureSymbolKind = "control-node" | "fresnel" | "linear-bar" | "panel" | "soft-mat";
export type FixtureBeamType = "fresnel" | "glow" | "none" | "rectangle" | "spot" | "wash";
export type FixtureVisualConfidence = "catalogue-derived" | "fallback" | "verified";

export interface FixtureMarkerDimensions {
  height: number;
  width: number;
}

export interface FixtureEmitterLayoutModel {
  columns: number;
  direction: string;
  emitterKind: string;
  physicalPixels: number | null;
  rows: number;
  segments: number;
}

export interface FixtureOutputModel {
  beamAngle: number | null;
  beamType: FixtureBeamType;
  fieldAngle: number | null;
  hasPhotometricSamples: boolean;
  photometricLabel: string | null;
}

export interface FixtureVisualModel {
  beamSummary: string | null;
  body: FixtureMarkerDimensions;
  confidence: FixtureVisualConfidence;
  confidenceLabel: string;
  definition: LightingFixtureDefinitionSnapshot | null;
  definitionId: string;
  displayName: string;
  emitterLayout: FixtureEmitterLayoutModel | null;
  mode: LightingFixtureModeSnapshot | null;
  modeFootprint: string;
  mounting: FixtureMounting;
  output: FixtureOutputModel;
  symbolKind: FixtureSymbolKind;
  symbolVariant: string;
}

const MIN_BODY = 14;
const MAX_BODY_WIDTH = 52;
const MAX_BODY_HEIGHT = 32;

const FALLBACK_DIMENSIONS: Record<FixtureMounting, FixtureMarkerDimensions> = {
  bar: { height: 14, width: 44 },
  "control-node": { height: 16, width: 16 },
  fresnel: { height: 18, width: 18 },
  mat: { height: 18, width: 26 },
  panel: { height: 18, width: 18 },
};

function isSymbolKind(value: string | null | undefined): value is FixtureSymbolKind {
  return (
    value === "control-node" ||
    value === "fresnel" ||
    value === "linear-bar" ||
    value === "panel" ||
    value === "soft-mat"
  );
}

function isBeamType(value: string | null | undefined): value is FixtureBeamType {
  return (
    value === "fresnel" ||
    value === "glow" ||
    value === "none" ||
    value === "rectangle" ||
    value === "spot" ||
    value === "wash"
  );
}

function isConfidence(value: string | null | undefined): value is FixtureVisualConfidence {
  return value === "catalogue-derived" || value === "fallback" || value === "verified";
}

function symbolKindForMounting(mounting: FixtureMounting): FixtureSymbolKind {
  switch (mounting) {
    case "bar":
      return "linear-bar";
    case "control-node":
      return "control-node";
    case "mat":
      return "soft-mat";
    case "panel":
      return "panel";
    case "fresnel":
    default:
      return "fresnel";
  }
}

function beamTypeForMounting(mounting: FixtureMounting): FixtureBeamType {
  switch (mounting) {
    case "bar":
      return "rectangle";
    case "control-node":
      return "none";
    case "mat":
    case "panel":
      return "wash";
    case "fresnel":
    default:
      return "fresnel";
  }
}

function confidenceLabel(confidence: FixtureVisualConfidence) {
  switch (confidence) {
    case "verified":
      return "verified";
    case "catalogue-derived":
      return "catalog";
    case "fallback":
    default:
      return "fallback";
  }
}

function normalizeDimensions(visual: LightingFixtureVisualSnapshot | null | undefined, mounting: FixtureMounting) {
  const fallback = FALLBACK_DIMENSIONS[mounting];
  const rawWidth = visual && visual.widthMm > 0 ? visual.widthMm / 10 : fallback.width;
  const rawHeight = visual && visual.heightMm > 0 ? visual.heightMm / 10 : fallback.height;
  const width = Math.max(1, rawWidth);
  const height = Math.max(1, rawHeight);
  const scaleDown = Math.min(1, MAX_BODY_WIDTH / width, MAX_BODY_HEIGHT / height);
  let nextWidth = width * scaleDown;
  let nextHeight = height * scaleDown;

  if (nextWidth < MIN_BODY || nextHeight < MIN_BODY) {
    const scaleUp = Math.max(MIN_BODY / nextWidth, MIN_BODY / nextHeight);
    const scaledWidth = nextWidth * scaleUp;
    const scaledHeight = nextHeight * scaleUp;
    if (scaledWidth <= MAX_BODY_WIDTH && scaledHeight <= MAX_BODY_HEIGHT) {
      nextWidth = scaledWidth;
      nextHeight = scaledHeight;
    } else {
      nextWidth = Math.min(MAX_BODY_WIDTH, Math.max(MIN_BODY, nextWidth));
      nextHeight = Math.min(MAX_BODY_HEIGHT, Math.max(MIN_BODY, nextHeight));
    }
  }

  return {
    height: Number(nextHeight.toFixed(2)),
    width: Number(nextWidth.toFixed(2)),
  };
}

function normalizeEmitterLayout(
  visual: LightingFixtureVisualSnapshot | null | undefined
): FixtureEmitterLayoutModel | null {
  const emitterLayout = visual?.emitterLayout;
  if (emitterLayout) {
    return {
      columns: Math.max(1, Math.round(emitterLayout.columns)),
      direction: emitterLayout.direction || "row-major",
      emitterKind: emitterLayout.emitterKind || "pixel-grid",
      physicalPixels: typeof emitterLayout.physicalPixels === "number" ? emitterLayout.physicalPixels : null,
      rows: Math.max(1, Math.round(emitterLayout.rows)),
      segments: Math.max(1, Math.round(emitterLayout.segments)),
    };
  }

  const pixelLayout = visual?.pixelLayout;
  if (!pixelLayout) return null;
  return {
    columns: Math.max(1, Math.round(pixelLayout.columns)),
    direction: pixelLayout.order || "row-major",
    emitterKind: "pixel-grid",
    physicalPixels: null,
    rows: Math.max(1, Math.round(pixelLayout.rows)),
    segments: Math.max(1, Math.round(pixelLayout.segments)),
  };
}

function samplePhotometricLabel(samples: LightingFixtureVisualSnapshot["output"]["photometricSamples"]) {
  const sample = samples.find((entry) => Math.abs(entry.distanceMeters - 1) < 0.01) ?? samples[0] ?? null;
  if (!sample) return null;
  const distance = Number.isInteger(sample.distanceMeters)
    ? sample.distanceMeters.toFixed(0)
    : sample.distanceMeters.toFixed(1);
  return `${Math.round(sample.lux)} lx @ ${distance} m`;
}

function formatEstimateLabel(beamAngle: number | null) {
  return beamAngle ? `${Math.round(beamAngle)} deg est.` : "est.";
}

function formatBeamSummary(beamAngle: number | null, fieldAngle: number | null) {
  if (beamAngle && fieldAngle) return `${Math.round(beamAngle)} / ${Math.round(fieldAngle)} deg`;
  if (beamAngle) return `${Math.round(beamAngle)} deg beam`;
  if (fieldAngle) return `${Math.round(fieldAngle)} deg field`;
  return null;
}

export function getFixtureVisualModel(
  catalog: LightingFixtureCatalogSnapshot | null | undefined,
  fixture: LightingFixtureSnapshot
): FixtureVisualModel {
  const definition = getFixtureDefinition(catalog, fixture);
  const visual = definition?.visual ?? null;
  const mode = getFixtureMode(definition, fixture.modeId);
  const mounting = deriveMounting(fixture, catalog);
  const symbolKind = isSymbolKind(visual?.symbolKind) ? visual.symbolKind : symbolKindForMounting(mounting);
  const beamType = isBeamType(visual?.output?.beamType) ? visual.output.beamType : beamTypeForMounting(mounting);
  const confidence = isConfidence(visual?.visualConfidence) ? visual.visualConfidence : "fallback";
  const beamAngle =
    beamType === "none"
      ? null
      : (visual?.output?.beamAngle ??
        visual?.beamAngleMax ??
        visual?.beamAngleMin ??
        fixture.beamAngleDegrees ??
        lightingFixtureBeamAngle(fixture.type, fixture.beamAngleDegrees ?? undefined));
  const fieldAngle = beamType === "none" ? null : (visual?.output?.fieldAngle ?? visual?.fieldAngle ?? null);
  const samples = visual?.output?.photometricSamples ?? [];
  const hasPhotometricSamples = samples.length > 0;
  const photometricLabel = hasPhotometricSamples ? samplePhotometricLabel(samples) : formatEstimateLabel(beamAngle);

  return {
    beamSummary: formatBeamSummary(beamAngle, fieldAngle),
    body: normalizeDimensions(visual, mounting),
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    definition,
    definitionId: definition?.id ?? normalizeCatalogAlias(fixture.definitionId || fixture.type || fixture.kind),
    displayName: definition?.displayName || fixture.type || fixture.name,
    emitterLayout: normalizeEmitterLayout(visual),
    mode,
    modeFootprint: mode ? `${mode.channelCount} ch` : "unknown",
    mounting,
    output: {
      beamAngle,
      beamType,
      fieldAngle,
      hasPhotometricSamples,
      photometricLabel,
    },
    symbolKind,
    symbolVariant: visual?.symbolVariant || symbolKind,
  };
}
