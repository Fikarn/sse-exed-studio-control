import { useEffect, useRef } from "react";
import type { AudioMeterEntry, AudioMeterFrame, ShellStore } from "@sse/engine-client";

import styles from "./AudioMeterCanvasOverlay.module.css";
import {
  dbfsToMeterPercent,
  METER_FLOOR_DBFS,
  METER_NOMINAL_DBFS,
  meterDisplayTargetFromEntry,
  type MeterDisplayState,
  updateMeterDisplayState,
} from "../audioMeterDisplayModel";

interface MeterRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

interface StereoMeterGeometry {
  kind: "stereo";
  left: MeterRect;
  meterId: string;
  meterKind: "channel" | "mixTarget";
  mirrorRight: boolean;
  // DP2 (2026-06-04 Console polish): null when the meter renders as a single
  // mono bar — the mirrored right track is display:none (it has no box), so the
  // left track has already grown to full width and there is no second rect to
  // paint. drawStereoMeter skips every right-track draw in that case.
  right: MeterRect | null;
}

interface MiniMeterGeometry {
  kind: "mini";
  meterId: string;
  meterKind: "channel" | "mixTarget";
  rect: MeterRect;
  side: "left" | "right";
}

type MeterGeometry = StereoMeterGeometry | MiniMeterGeometry;

interface MeterColors {
  amber: string;
  bg: string;
  clip: string;
  green: string;
  hot: string;
  over: string;
  overTone: string;
  peak: string;
  peakEdge: string;
  rms: string;
  zoneAmber: string;
}

// DP2 (2026-06-04 Console polish): the design's fixed dBFS caution zone is a
// literal amber, NOT a token — the audio theme maps every --audio-meter-warn /
// -hot token onto the single cream tone (no amber token exists), so the
// prototype hardcodes oklch(80% 0.155 82) for the caution band between the
// cream safe zone and the red clip cap. Fixed across all three themes by design
// (the zone map is an absolute-dBFS instrument scale, not a themed surface).
const METER_ZONE_AMBER = "oklch(80% 0.155 82)";

type GradientCache = Map<string, CanvasGradient>;

function cssColor(style: CSSStyleDeclaration, name: string, fallback: string) {
  return style.getPropertyValue(name).trim() || fallback;
}

// DP2 (2026-06-04 Console polish): the design's meter zones bloom between bands
// with CSS color-mix() stops (e.g. mix(over, amber, 50%)). Canvas gradients take
// concrete colour strings, so we resolve each themed colour (hex / oklch / rgb)
// to sRGB once and mix in sRGB to reproduce `color-mix(in srgb, …)`. A reused
// 1×1 scratch context turns any CSS colour string into [r,g,b,a]; the result is
// memoised per colour string (theme swaps produce a small fixed set).
let colorResolverCtx: CanvasRenderingContext2D | null = null;
const resolvedColorCache = new Map<string, [number, number, number, number]>();

function resolveColor(color: string): [number, number, number, number] {
  const cached = resolvedColorCache.get(color);
  if (cached) return cached;

  if (!colorResolverCtx) {
    const scratch = document.createElement("canvas");
    scratch.width = 1;
    scratch.height = 1;
    colorResolverCtx = scratch.getContext("2d", { willReadFrequently: true });
  }

  let rgba: [number, number, number, number] = [0, 0, 0, 1];
  if (colorResolverCtx) {
    colorResolverCtx.clearRect(0, 0, 1, 1);
    colorResolverCtx.fillStyle = "#000";
    colorResolverCtx.fillStyle = color;
    colorResolverCtx.fillRect(0, 0, 1, 1);
    const data = colorResolverCtx.getImageData(0, 0, 1, 1).data;
    rgba = [data[0], data[1], data[2], data[3] / 255];
  }
  resolvedColorCache.set(color, rgba);
  return rgba;
}

// Reproduces CSS `color-mix(in srgb, a (amount*100)%, b)` — amount is the weight
// of `a`. Returns an rgba() string the canvas gradient can consume.
function mixColor(a: string, b: string, amount: number): string {
  const [ar, ag, ab, aa] = resolveColor(a);
  const [br, bg, bb, ba] = resolveColor(b);
  const weight = Math.max(0, Math.min(1, amount));
  const r = Math.round(ar * weight + br * (1 - weight));
  const g = Math.round(ag * weight + bg * (1 - weight));
  const bl = Math.round(ab * weight + bb * (1 - weight));
  const alpha = aa * weight + ba * (1 - weight);
  return `rgba(${r}, ${g}, ${bl}, ${alpha})`;
}

function readColors(root: HTMLElement): MeterColors {
  const style = getComputedStyle(root);
  return {
    amber: cssColor(style, "--audio-meter-warn", "#f1c95f"),
    // DP2: the recessed-trough bg tone — used to tint the −18 dBFS nominal line
    // so it reads on the lit fill in every theme (dark line on the cream
    // Studio/Graphite bodies; light line on Bone's dark-brown fill).
    bg: cssColor(style, "--audio-meter-bg", "#050608"),
    clip: cssColor(style, "--audio-clip", "#ff4b4b"),
    green: cssColor(style, "--audio-meter-low-hot", "#62d979"),
    hot: cssColor(style, "--audio-meter-hot", "#ff9f43"),
    over: cssColor(style, "--audio-meter-over", "#ff4b4b"),
    // C09(b): desaturated orange-red intermediate for the transient over band,
    // distinct from both the saturated clip-red and the amber peak-warning
    // outline. C09(c): theme-aware keyline tone for the peak-hold tick.
    overTone: cssColor(style, "--meter-over-tone", "#e8743a"),
    peak: cssColor(style, "--audio-meter-peak-hold", "#f8f1a5"),
    peakEdge: cssColor(style, "--meter-peak-edge", "#2a2418"),
    rms: cssColor(style, "--audio-meter-low", "#39c46b"),
    // DP2: fixed-amber caution band (see METER_ZONE_AMBER) — a constant, not a
    // token, so it stays identical across Studio / Graphite / Bone.
    zoneAmber: METER_ZONE_AMBER,
  };
}

function elementRect(element: HTMLElement, canvasRect: DOMRect, scaleX: number, scaleY: number): MeterRect | null {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    height: rect.height * scaleY,
    width: rect.width * scaleX,
    x: (rect.left - canvasRect.left) * scaleX,
    y: (rect.top - canvasRect.top) * scaleY,
  };
}

function entryForGeometry(frame: AudioMeterFrame, geometry: MeterGeometry): AudioMeterEntry | null {
  return geometry.meterKind === "channel"
    ? (frame.channels[geometry.meterId] ?? null)
    : (frame.mixTargets[geometry.meterId] ?? null);
}

function clearRectWithPadding(ctx: CanvasRenderingContext2D, rect: MeterRect, padding = 2) {
  ctx.clearRect(
    Math.floor(rect.x - padding),
    Math.floor(rect.y - padding),
    Math.ceil(rect.width + padding * 2),
    Math.ceil(rect.height + padding * 2)
  );
}

function clearMeterGeometry(ctx: CanvasRenderingContext2D, geometry: MeterGeometry) {
  if (geometry.kind === "stereo") {
    clearRectWithPadding(ctx, geometry.left, 3);
    // DP2: right is null for mono single-bar meters — nothing to clear there.
    if (geometry.right) clearRectWithPadding(ctx, geometry.right, 3);
    return;
  }
  clearRectWithPadding(ctx, geometry.rect, 3);
}

function datasetSet(canvas: HTMLCanvasElement, key: string, value: string) {
  if (canvas.dataset[key] === value) return;
  canvas.dataset[key] = value;
}

function gradientKey(prefix: string, rect: MeterRect, colors: MeterColors) {
  return [
    prefix,
    Math.round(rect.x),
    Math.round(rect.y),
    Math.round(rect.width),
    Math.round(rect.height),
    // DP2: the zone map reads cream (green) → fixed amber → red (over). Key on
    // exactly those so a theme swap (which moves green/over) rebuilds the cache;
    // zoneAmber is a constant but included for completeness.
    colors.green,
    colors.zoneAmber,
    colors.over,
  ].join(":");
}

// DP2 (2026-06-04 Console polish): fixed dBFS colour zones, anchored to the
// TRACK (absolute level), NOT painted on the moving fill — so red always means
// "you are clipping", never just "here is the signal head". The gradient spans
// the full track height/width; drawMeterBody / drawMiniMeter reveal only the lit
// sub-rect of it, so a given dBFS position keeps the same colour as level moves.
// Vertical map (top = 0 dBFS): red clip cap in the top ~2 dB, blooming through a
// fixed amber caution band, into the cream safe zone anchored at the −18 dBFS
// nominal mark (~30% from top). Mirrors the design's .meterFill stops.
function meterBodyGradient(
  ctx: CanvasRenderingContext2D,
  rect: MeterRect,
  colors: MeterColors,
  gradients: GradientCache
) {
  const key = gradientKey("body", rect, colors);
  const cached = gradients.get(key);
  if (cached) return cached;
  const gradient = ctx.createLinearGradient(0, rect.y, 0, rect.y + rect.height);
  gradient.addColorStop(0, colors.over);
  gradient.addColorStop(0.04, colors.over);
  gradient.addColorStop(0.065, mixColor(colors.over, colors.zoneAmber, 0.5));
  gradient.addColorStop(0.09, colors.zoneAmber);
  gradient.addColorStop(0.16, colors.zoneAmber);
  gradient.addColorStop(0.27, mixColor(colors.zoneAmber, colors.green, 0.5));
  gradient.addColorStop(0.35, colors.green);
  gradient.addColorStop(1, colors.green);
  gradients.set(key, gradient);
  return gradient;
}

// DP2: the horizontal master bar's zone map — the vertical map flipped to read
// left→right: cream safe through ~−6 dB, a fixed amber caution band across the
// last few dB, red only in the clip region, blooming (never snapping). Mirrors
// the design's .masterFill stops (--m-amber = the same fixed zone amber; red =
// --audio-meter-over / --meter-hi).
function miniMeterGradient(
  ctx: CanvasRenderingContext2D,
  rect: MeterRect,
  colors: MeterColors,
  gradients: GradientCache
) {
  const key = gradientKey("mini", rect, colors);
  const cached = gradients.get(key);
  if (cached) return cached;
  const gradient = ctx.createLinearGradient(rect.x, 0, rect.x + rect.width, 0);
  gradient.addColorStop(0, colors.green);
  gradient.addColorStop(0.62, colors.green);
  gradient.addColorStop(0.73, mixColor(colors.green, colors.zoneAmber, 0.45));
  gradient.addColorStop(0.8, colors.zoneAmber);
  gradient.addColorStop(0.88, colors.zoneAmber);
  gradient.addColorStop(0.925, mixColor(colors.zoneAmber, colors.over, 0.55));
  gradient.addColorStop(0.96, colors.over);
  gradient.addColorStop(1, colors.over);
  gradients.set(key, gradient);
  return gradient;
}

function yForDbfs(rect: MeterRect, dbfs: number) {
  const percent = dbfsToMeterPercent(dbfs) / 100;
  return rect.y + rect.height - rect.height * percent;
}

function drawMeterBody(
  ctx: CanvasRenderingContext2D,
  rect: MeterRect,
  dbfs: number,
  colors: MeterColors,
  gradients: GradientCache
) {
  const inset = 2;
  const x = rect.x + inset;
  const y = yForDbfs(rect, dbfs);
  const width = Math.max(1, rect.width - inset * 2);
  const height = Math.max(0, rect.y + rect.height - inset - y);
  if (height <= 0) return;

  ctx.fillStyle = meterBodyGradient(ctx, rect, colors, gradients);
  ctx.fillRect(x, y, width, height);
}

// DP2 (2026-06-04 Console polish): cylindrical glass body + recessed top edge.
// The design paints these as a CSS ::before over the fill, but the z-index-8
// canvas covers the track, so the sheen has to be a canvas overlay. Two soft
// layers: a short top-edge shadow (recessed lip) + a left-light / right-dark
// (or top-light / bottom-dark for the horizontal master) lens highlight, so the
// lit bar reads as a glass tube instead of a flat slab. Anchored to the full
// track rect so the sheen stays put as level moves; alpha-only, so it tints the
// zone colours rather than recolouring them. Mirrors .meterTrack::before.
function drawVerticalGlassOverlay(ctx: CanvasRenderingContext2D, rect: MeterRect) {
  const inset = 2;
  const x = rect.x + inset;
  const y = rect.y + inset;
  const width = Math.max(1, rect.width - inset * 2);
  const height = Math.max(1, rect.height - inset * 2);

  const edge = ctx.createLinearGradient(0, y, 0, y + height);
  edge.addColorStop(0, "rgba(0, 0, 0, 0.24)");
  edge.addColorStop(0.07, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = edge;
  ctx.fillRect(x, y, width, height);

  const sheen = ctx.createLinearGradient(x, 0, x + width, 0);
  sheen.addColorStop(0, "rgba(255, 255, 255, 0.09)");
  sheen.addColorStop(0.26, "rgba(255, 255, 255, 0)");
  sheen.addColorStop(0.58, "rgba(0, 0, 0, 0)");
  sheen.addColorStop(1, "rgba(0, 0, 0, 0.14)");
  ctx.fillStyle = sheen;
  ctx.fillRect(x, y, width, height);
}

function drawHorizontalGlassOverlay(ctx: CanvasRenderingContext2D, rect: MeterRect) {
  const edge = ctx.createLinearGradient(0, rect.y, 0, rect.y + rect.height);
  edge.addColorStop(0, "rgba(0, 0, 0, 0.26)");
  edge.addColorStop(0.24, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = edge;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);

  const sheen = ctx.createLinearGradient(0, rect.y, 0, rect.y + rect.height);
  sheen.addColorStop(0, "rgba(255, 255, 255, 0.16)");
  sheen.addColorStop(0.32, "rgba(255, 255, 255, 0.04)");
  sheen.addColorStop(0.55, "rgba(0, 0, 0, 0)");
  sheen.addColorStop(1, "rgba(0, 0, 0, 0.16)");
  ctx.fillStyle = sheen;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
}

function drawPeakLine(ctx: CanvasRenderingContext2D, rect: MeterRect, dbfs: number, colors: MeterColors) {
  if (!Number.isFinite(dbfs) || dbfs <= METER_FLOOR_DBFS) return;
  const y = Math.max(rect.y + 1, Math.min(rect.y + rect.height - 2, yForDbfs(rect, dbfs)));
  const x = rect.x + 1;
  const width = Math.max(1, rect.width - 2);
  // C09(c): the live canvas force-hides the CSS .meterPeak's separating glow,
  // leaving the cream peak tick at ~1.38:1 on the cream body. Lay a 1px
  // theme-aware keyline above and below the tick (dark on light bodies, light
  // on Bone's dark body) so it separates from the body without a new hue.
  ctx.fillStyle = colors.peakEdge;
  ctx.fillRect(x, y - 1, width, 4);
  ctx.fillStyle = colors.peak;
  ctx.fillRect(x, y, width, 2);
}

function drawNominalReference(ctx: CanvasRenderingContext2D, rect: MeterRect, colors: MeterColors) {
  const y = Math.max(rect.y + 1, Math.min(rect.y + rect.height - 2, yForDbfs(rect, METER_NOMINAL_DBFS)));
  // DP2 (2026-06-04 Console polish): the −18 dBFS nominal line is tinted from the
  // recessed-trough bg tone (was the warn/amber token) so it reads on the lit
  // fill in every theme — a dark line on the cream Studio/Graphite bodies, a
  // light line on Bone's dark-brown fill. Mirrors .meterNominal's
  // color-mix(--audio-meter-bg 60%, transparent) at opacity 0.6 (≈0.36 net).
  ctx.globalAlpha = 0.6 * 0.6;
  ctx.fillStyle = colors.bg;
  ctx.fillRect(rect.x + 1, y, Math.max(1, rect.width - 2), 1);
  ctx.globalAlpha = 1;
}

function drawClipOverlay(ctx: CanvasRenderingContext2D, rect: MeterRect, colors: MeterColors) {
  ctx.strokeStyle = colors.clip;
  ctx.lineWidth = 1;
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, Math.max(1, rect.width - 1), Math.max(1, rect.height - 1));
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = colors.clip;
  ctx.fillRect(rect.x + 1, rect.y + 1, Math.max(1, rect.width - 2), Math.max(1, rect.height - 2));
  ctx.globalAlpha = 1;
}

function drawPeakWarningOverlay(ctx: CanvasRenderingContext2D, rect: MeterRect, colors: MeterColors) {
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = colors.amber;
  ctx.lineWidth = 1;
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, Math.max(1, rect.width - 1), Math.max(1, rect.height - 1));
  ctx.globalAlpha = 1;
}

function drawMeterPointOverIndicator(ctx: CanvasRenderingContext2D, rect: MeterRect, colors: MeterColors) {
  // C09(b): a transient over-sample (meterPointOver) and a latched channel-path
  // clip used to draw identically (both saturated red) and overlap geometrically.
  // Render the over band as a thinner desaturated orange-red intermediate
  // (--meter-over-tone) and offset it a hair below the top edge so it no longer
  // sits exactly under the 1px clip outline drawn at rect.y + 0.5.
  ctx.fillStyle = colors.overTone;
  ctx.fillRect(rect.x + 2, rect.y + 3, Math.max(1, rect.width - 4), 2);
}

function drawMiniMeter(
  ctx: CanvasRenderingContext2D,
  geometry: MiniMeterGeometry,
  entry: MeterDisplayState,
  colors: MeterColors,
  gradients: GradientCache
) {
  const rect = geometry.rect;
  const bodyDbfs = geometry.side === "left" ? entry.bodyLeftDbfs : entry.bodyRightDbfs;
  const peakDbfs = geometry.side === "left" ? entry.peakLeftDbfs : entry.peakRightDbfs;
  const nominalX = rect.x + rect.width * (dbfsToMeterPercent(METER_NOMINAL_DBFS) / 100);

  const width = Math.max(0, rect.width * (dbfsToMeterPercent(bodyDbfs) / 100));
  if (width > 0) {
    ctx.fillStyle = miniMeterGradient(ctx, rect, colors, gradients);
    ctx.fillRect(rect.x, rect.y, width, rect.height);
  }

  // DP2 (2026-06-04 Console polish): cylindrical glass sheen over the lit master
  // bar so it reads as a lens, not a sticker (mirrors .masterTrack::before).
  drawHorizontalGlassOverlay(ctx, rect);

  // DP2: nominal (−18 dBFS) reference tinted from the trough bg so it reads on
  // the fill in every theme — same treatment as the vertical meters.
  ctx.globalAlpha = 0.6 * 0.6;
  ctx.fillStyle = colors.bg;
  ctx.fillRect(Math.max(rect.x, Math.min(rect.x + rect.width - 1, nominalX)), rect.y, 1, rect.height);
  ctx.globalAlpha = 1;

  if (Number.isFinite(peakDbfs) && peakDbfs > METER_FLOOR_DBFS) {
    const peakX = rect.x + rect.width * (dbfsToMeterPercent(peakDbfs) / 100);
    const tickX = Math.max(rect.x, Math.min(rect.x + rect.width - 2, peakX - 1));
    // DP2: crisp 2px peak-hold tick with a dark hairline outline so it reads on
    // both the lit cream bar and the dark trough (mirrors .masterPeak's
    // box-shadow keyline).
    ctx.fillStyle = colors.peakEdge;
    ctx.fillRect(tickX - 0.5, rect.y, 3, rect.height);
    ctx.fillStyle = colors.peak;
    ctx.fillRect(tickX, rect.y, 2, rect.height);
  }

  if (entry.peakWarning) {
    drawPeakWarningOverlay(ctx, rect, colors);
  }

  const meterPointOver = geometry.side === "left" ? entry.meterPointOverLeft : entry.meterPointOverRight;
  if (meterPointOver) {
    drawMeterPointOverIndicator(ctx, rect, colors);
  }

  if (entry.channelPathClip) {
    drawClipOverlay(ctx, rect, colors);
  }
}

function drawStereoMeter(
  ctx: CanvasRenderingContext2D,
  geometry: StereoMeterGeometry,
  entry: MeterDisplayState,
  colors: MeterColors,
  gradients: GradientCache
) {
  // DP2: when the meter is mono the right track is display:none (geometry.right
  // is null) and the left track spans full width — paint the single left bar
  // only. Otherwise paint the full stereo pair.
  const { left, right } = geometry;

  drawMeterBody(ctx, left, entry.bodyLeftDbfs, colors, gradients);
  if (right) {
    drawMeterBody(ctx, right, geometry.mirrorRight ? entry.bodyLeftDbfs : entry.bodyRightDbfs, colors, gradients);
  }
  // DP2: glass sheen over each fill, then the nominal line + peak on top so the
  // instrument references stay crisp above the subtle lens highlight.
  drawVerticalGlassOverlay(ctx, left);
  drawNominalReference(ctx, left, colors);
  drawPeakLine(ctx, left, entry.peakLeftDbfs, colors);
  if (right) {
    drawVerticalGlassOverlay(ctx, right);
    drawNominalReference(ctx, right, colors);
    drawPeakLine(ctx, right, geometry.mirrorRight ? entry.peakLeftDbfs : entry.peakRightDbfs, colors);
  }

  if (entry.peakWarning) {
    drawPeakWarningOverlay(ctx, left, colors);
    if (right) drawPeakWarningOverlay(ctx, right, colors);
  }

  if (entry.meterPointOverLeft) {
    drawMeterPointOverIndicator(ctx, left, colors);
  }

  if (right && entry.meterPointOverRight) {
    drawMeterPointOverIndicator(ctx, right, colors);
  }

  if (entry.channelPathClip) {
    drawClipOverlay(ctx, left, colors);
    if (right) drawClipOverlay(ctx, right, colors);
  }
}

function measureGeometry(canvas: HTMLCanvasElement, root: HTMLElement) {
  const canvasRect = canvas.getBoundingClientRect();
  const localWidth = Math.max(1, canvas.offsetWidth);
  const localHeight = Math.max(1, canvas.offsetHeight);
  const scaleX = localWidth / Math.max(1, canvasRect.width);
  const scaleY = localHeight / Math.max(1, canvasRect.height);
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(localWidth * dpr));
  const height = Math.max(1, Math.round(localHeight * dpr));

  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  const geometry: MeterGeometry[] = [];
  for (const meter of root.querySelectorAll<HTMLElement>('[data-meter-component="stereo"]')) {
    const leftTrack = meter.querySelector<HTMLElement>('[data-meter-track="left"]');
    const rightTrack = meter.querySelector<HTMLElement>('[data-meter-track="right"]');
    const meterId = meter.dataset.meterId;
    const meterKind = meter.dataset.meterKind;
    const left = leftTrack ? elementRect(leftTrack, canvasRect, scaleX, scaleY) : null;
    // DP2: the right rect is optional — a mono meter hides its right track
    // (display:none → no box → elementRect returns null) and the left track has
    // already grown to full width. Gate only on the left track so the single
    // full-width bar still gets painted; null right is handled by drawStereoMeter.
    const right = rightTrack ? elementRect(rightTrack, canvasRect, scaleX, scaleY) : null;
    if (!meterId || (meterKind !== "channel" && meterKind !== "mixTarget") || !left) {
      continue;
    }

    geometry.push({
      kind: "stereo",
      left,
      meterId,
      meterKind,
      mirrorRight: meter.dataset.meterMirrorRight === "true",
      right,
    });
  }

  for (const meter of root.querySelectorAll<HTMLElement>("[data-mini-meter-kind]")) {
    const meterId = meter.dataset.miniMeterId;
    const meterKind = meter.dataset.miniMeterKind;
    const side = meter.dataset.miniMeterSide === "right" ? "right" : "left";
    const rect = elementRect(meter, canvasRect, scaleX, scaleY);
    if (!meterId || (meterKind !== "channel" && meterKind !== "mixTarget") || !rect) {
      continue;
    }

    geometry.push({
      kind: "mini",
      meterId,
      meterKind,
      rect,
      side,
    });
  }

  return {
    colors: readColors(root),
    dpr,
    geometry,
  };
}

export function AudioMeterCanvasOverlay({
  peakHoldEnabled,
  peakHoldResetToken,
  store,
}: {
  peakHoldEnabled: boolean;
  peakHoldResetToken: number;
  store: ShellStore;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const root = canvas?.closest<HTMLElement>('[data-testid="audio-workspace"]');
    if (!canvas || !root) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let animationFrame = 0;
    let colors = readColors(root);
    let dpr = window.devicePixelRatio || 1;
    let geometry: MeterGeometry[] = [];
    let latestFrame = store.getAudioMeterFrame();
    let needsMeasure = true;
    let lastPaintedAtMs = performance.now();
    const gradients: GradientCache = new Map();
    const displayStates = new Map<string, MeterDisplayState>();
    // R2-MOT-01: live MediaQueryList — `.matches` is read per frame so a
    // preference flip takes effect without restarting the loop. The loop
    // itself always runs (meters are essential telemetry); only the eased
    // ballistics snap.
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const requestMeasure = () => {
      needsMeasure = true;
    };

    const unsubscribe = store.subscribeAudioMeters(() => {
      latestFrame = store.getAudioMeterFrame();
    });

    const resizeObserver = new ResizeObserver(requestMeasure);
    resizeObserver.observe(root);

    const mutationObserver = new MutationObserver(requestMeasure);
    mutationObserver.observe(root, {
      attributeFilter: ["data-density", "data-view-mode", "data-selected"],
      attributes: true,
      childList: true,
      subtree: true,
    });

    const paint = () => {
      if (needsMeasure) {
        const measured = measureGeometry(canvas, root);
        colors = measured.colors;
        dpr = measured.dpr;
        geometry = measured.geometry;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        gradients.clear();
        ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
        needsMeasure = false;
      }

      const nowMs = performance.now();
      const deltaSeconds = Math.min(0.1, Math.max(0.001, (nowMs - lastPaintedAtMs) / 1000));
      lastPaintedAtMs = nowMs;
      const visibleStateKeys = new Set<string>();
      // Why: when the workspace flags metering as gated (OSC disabled, console
      // state unverified, last action failed) the simulated tick would be a
      // lie. Clear every meter rect this frame and skip the draw loop so the
      // canvas stays empty while the warning band tells the operator what is
      // wrong. dataset is read fresh each frame so a state change is picked up
      // without invalidating the rAF loop.
      const gated = root.dataset.canvasMetering === "false";
      if (gated) {
        for (const meterGeometry of geometry) {
          clearMeterGeometry(ctx, meterGeometry);
        }
        displayStates.clear();
        datasetSet(canvas, "meterBallistics", "gated");
        datasetSet(canvas, "meterPeakHoldEnabled", peakHoldEnabled ? "true" : "false");
        datasetSet(canvas, "meterPeakHoldResetToken", String(peakHoldResetToken));
        datasetSet(canvas, "meterSequence", String(latestFrame.sequence));
        datasetSet(canvas, "meterCount", String(geometry.length));
        animationFrame = window.requestAnimationFrame(paint);
        return;
      }

      for (const meterGeometry of geometry) {
        clearMeterGeometry(ctx, meterGeometry);
        const entry = entryForGeometry(latestFrame, meterGeometry);
        if (!entry) continue;

        const stateKey =
          meterGeometry.kind === "stereo"
            ? `${meterGeometry.meterKind}:${meterGeometry.meterId}:stereo`
            : `${meterGeometry.meterKind}:${meterGeometry.meterId}:mini:${meterGeometry.side}`;
        visibleStateKeys.add(stateKey);

        const target = meterDisplayTargetFromEntry(
          entry,
          meterGeometry.kind === "stereo" ? meterGeometry.mirrorRight : false
        );
        const displayState = updateMeterDisplayState({
          deltaSeconds,
          nowMs,
          peakHoldEnabled,
          previous: displayStates.get(stateKey),
          snap: reduceMotion.matches,
          target,
        });
        displayStates.set(stateKey, displayState);

        if (meterGeometry.kind === "stereo") {
          drawStereoMeter(ctx, meterGeometry, displayState, colors, gradients);
        } else {
          drawMiniMeter(ctx, meterGeometry, displayState, colors, gradients);
        }
      }

      for (const key of displayStates.keys()) {
        if (!visibleStateKeys.has(key)) {
          displayStates.delete(key);
        }
      }
      datasetSet(canvas, "meterBallistics", "display");
      datasetSet(canvas, "meterPeakHoldEnabled", peakHoldEnabled ? "true" : "false");
      datasetSet(canvas, "meterPeakHoldResetToken", String(peakHoldResetToken));
      datasetSet(canvas, "meterSequence", String(latestFrame.sequence));
      datasetSet(canvas, "meterCount", String(geometry.length));

      animationFrame = window.requestAnimationFrame(paint);
    };

    animationFrame = window.requestAnimationFrame(paint);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      unsubscribe();
    };
  }, [peakHoldEnabled, peakHoldResetToken, store]);

  return (
    <canvas
      aria-hidden="true"
      className={styles.audioMeterCanvas}
      data-meter-peak-hold-enabled={peakHoldEnabled ? "true" : "false"}
      data-meter-peak-hold-reset-token={peakHoldResetToken}
      data-testid="audio-meter-canvas"
      data-meter-renderer="canvas"
      ref={canvasRef}
    />
  );
}
