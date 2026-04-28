import type { LightingFixtureSnapshot, LightingSceneFixtureSnapshot } from "@sse/engine-client";

import { lightingFixtureColor } from "./lightingHelpers";
import { STUDIO_LAYOUT } from "./studioLayout";

export const SCENE_THUMB_VIEWBOX_WIDTH = 160;
export const SCENE_THUMB_VIEWBOX_HEIGHT = 110;

interface SceneThumbContext {
  fixtures: readonly LightingFixtureSnapshot[];
  fixtureStates: readonly LightingSceneFixtureSnapshot[];
}

const fallbackPosition = (fixture: LightingFixtureSnapshot, index: number) => {
  const x = fixture.spatialX ?? (index + 1) / 8;
  const y = fixture.spatialY ?? 0.5;
  return { x: clamp01(x), y: clamp01(y) };
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const utf8ToBase64 = (input: string): string => {
  if (typeof window !== "undefined" && typeof window.btoa === "function") {
    const bytes = new TextEncoder().encode(input);
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return window.btoa(binary);
  }
  // Node fallback used by unit tests / SSR.
  return Buffer.from(input, "utf8").toString("base64");
};

export function renderSceneThumbnailSvg({ fixtures, fixtureStates }: SceneThumbContext): string {
  const stateById = new Map<string, LightingSceneFixtureSnapshot>();
  for (const state of fixtureStates) {
    stateById.set(state.fixtureId, state);
  }

  const padding = 6;
  const innerW = SCENE_THUMB_VIEWBOX_WIDTH - padding * 2;
  const innerH = SCENE_THUMB_VIEWBOX_HEIGHT - padding * 2;

  const dots = fixtures
    .map((fixture, index) => {
      const state = stateById.get(fixture.id);
      const intensity = state?.intensity ?? fixture.intensity ?? 0;
      const cct = state?.cct ?? fixture.cct ?? 4400;
      const on = state?.on ?? fixture.on ?? false;
      if (!on || intensity <= 0) {
        return `<circle cx="${pos(fallbackPosition(fixture, index).x, padding, innerW)}" cy="${pos(
          fallbackPosition(fixture, index).y,
          padding,
          innerH
        )}" r="2" fill="rgba(250, 246, 230, 0.18)" />`;
      }
      const { x, y } = fallbackPosition(fixture, index);
      const color = lightingFixtureColor(cct, on);
      const radius = 2 + (intensity / 100) * 4;
      const opacity = 0.4 + (intensity / 100) * 0.6;
      return `<circle cx="${pos(x, padding, innerW)}" cy="${pos(y, padding, innerH)}" r="${radius.toFixed(2)}" fill="${escapeXml(color)}" fill-opacity="${opacity.toFixed(3)}" />`;
    })
    .join("");

  const room = `<rect x="${padding}" y="${padding}" width="${innerW}" height="${innerH}" rx="4" fill="#0d100c" stroke="rgba(250, 246, 230, 0.08)" stroke-width="0.6" />`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SCENE_THUMB_VIEWBOX_WIDTH} ${SCENE_THUMB_VIEWBOX_HEIGHT}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Lighting scene preview">${room}${dots}</svg>`;

  return svg;
}

export function renderSceneThumbnailDataUri(context: SceneThumbContext): string {
  const svg = renderSceneThumbnailSvg(context);
  return `data:image/svg+xml;base64,${utf8ToBase64(svg)}`;
}

const pos = (normalized: number, offset: number, span: number): string =>
  (offset + clamp01(normalized) * span).toFixed(2);

// Keep STUDIO_LAYOUT referenced so import-tracking doesn't drop it; the
// helper's room footprint is sized to the studio aspect ratio
// (12 m × 8 m → 1.5:1) which matches the 160 × 110 viewBox at 96.4 % h.
export const SCENE_THUMB_ROOM_ASPECT = STUDIO_LAYOUT.roomWidthMeters / STUDIO_LAYOUT.roomDepthMeters;

// Convenience: produce a fresh thumbs map with one entry upserted or
// removed. Pair with store.setLightingSceneThumbs(updatedMap).
export function withSceneThumbUpserted(
  current: Record<string, string>,
  sceneId: string,
  thumb: string
): Record<string, string> {
  return { ...current, [sceneId]: thumb };
}

export function withSceneThumbRemoved(current: Record<string, string>, sceneId: string): Record<string, string> {
  if (!(sceneId in current)) {
    return current;
  }
  const next = { ...current };
  delete next[sceneId];
  return next;
}
