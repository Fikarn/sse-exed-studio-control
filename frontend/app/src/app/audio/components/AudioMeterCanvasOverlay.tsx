import { useEffect, useRef } from "react";
import type { AudioMeterEntry, AudioMeterFrame, ShellStore } from "@sse/engine-client";

import styles from "./AudioMeterCanvasOverlay.module.css";
import {
  dbfsToMeterPercent,
  formatPeakWellDbfs,
  METER_FLOOR_DBFS,
  METER_HOT_DBFS,
  METER_NOMINAL_DBFS,
  meterDisplayTargetFromEntry,
  type MeterDisplayState,
  peakWellLevel,
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
  /** The strip's wide meter (D50): its host's peak well carries the clip and the warning. */
  form: "standard" | "wide";
  meterId: string;
  meterKind: "channel" | "mixTarget";
  orientation: "vertical" | "horizontal";
  rect: MeterRect;
  side: "left" | "right";
}

type MeterGeometry = StereoMeterGeometry | MiniMeterGeometry;

/** A strip's peak well: its number, written here when the whole dB changes. */
interface PeakWell {
  element: HTMLElement;
  meterId: string;
  meterKind: "channel" | "mixTarget";
  stereo: boolean;
  value: HTMLElement;
}

interface MeterColors {
  /** The well's black: the keyline round a peak tick, the −18 line's tint. */
  bg: string;
  /** Hot pink: from −3 dBFS, the warning, the over and the clip. */
  hot: string;
  /** Ice white: the held peak's line. */
  hold: string;
  low: string;
  mid: string;
}

type GradientCache = Map<string, CanvasGradient>;

function cssColor(style: CSSStyleDeclaration, name: string, fallback: string) {
  return style.getPropertyValue(name).trim() || fallback;
}

// The meters' own colours (the Console's strip, 2026-10-11, D50; DESIGN.md
// §4), used for nothing else: aqua to −18 dBFS, light aqua to −3, hot pink
// above, flat and with hard stops, as the design system's Meter draws them;
// the held peak an ice-white line; the warning and a held clip in the hot
// pink. The names are read from the page's root, where the tokens declare
// them; the fallbacks are the tokens' values.
function readColors(root: HTMLElement): MeterColors {
  const style = getComputedStyle(root);
  return {
    bg: cssColor(style, "--material-well", "#040706"),
    hot: cssColor(style, "--signal-meter-over", "#FF4FA3"),
    hold: cssColor(style, "--signal-peak", "#ECFDFF"),
    low: cssColor(style, "--signal-meter-low", "#2AA7B6"),
    mid: cssColor(style, "--signal-meter-mid", "#86E2E9"),
  };
}

// The peak's segment is the ramp at this strength; its hot zone is never dimmed.
const PEAK_SEGMENT_ALPHA = 0.36;

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
    // The ramp's three colours, so new colours rebuild the cache.
    colors.low,
    colors.mid,
    colors.hot,
  ].join(":");
}

// DP2 (2026-06-04 Console polish): fixed dBFS colour zones, anchored to the
// TRACK (absolute level), NOT painted on the moving fill — so the hot pink
// always means "you are near the top", never just "here is the signal head".
// The gradient spans the full track height/width; the bodies reveal only the
// lit sub-rect of it, so a given dBFS position keeps the same colour as level
// moves.
function meterBodyGradient(
  ctx: CanvasRenderingContext2D,
  rect: MeterRect,
  colors: MeterColors,
  gradients: GradientCache
) {
  const key = gradientKey("body", rect, colors);
  const cached = gradients.get(key);
  if (cached) return cached;
  // Top = 0 dBFS: hot pink above −3 dBFS (the top 5 %), light aqua to −18
  // (30 %), aqua below, hard stops (DESIGN.md §4).
  const gradient = ctx.createLinearGradient(0, rect.y, 0, rect.y + rect.height);
  gradient.addColorStop(0, colors.hot);
  gradient.addColorStop(0.05, colors.hot);
  gradient.addColorStop(0.05, colors.mid);
  gradient.addColorStop(0.3, colors.mid);
  gradient.addColorStop(0.3, colors.low);
  gradient.addColorStop(1, colors.low);
  gradients.set(key, gradient);
  return gradient;
}

// DP2: the horizontal bar's zone map — the vertical map flipped to read left
// to right.
function miniMeterGradient(
  ctx: CanvasRenderingContext2D,
  rect: MeterRect,
  colors: MeterColors,
  gradients: GradientCache
) {
  const key = gradientKey("mini", rect, colors);
  const cached = gradients.get(key);
  if (cached) return cached;
  // Left to right: aqua to −18 dBFS (70 %), light aqua to −3 (95 %), hot pink above.
  const gradient = ctx.createLinearGradient(rect.x, 0, rect.x + rect.width, 0);
  gradient.addColorStop(0, colors.low);
  gradient.addColorStop(0.7, colors.low);
  gradient.addColorStop(0.7, colors.mid);
  gradient.addColorStop(0.95, colors.mid);
  gradient.addColorStop(0.95, colors.hot);
  gradient.addColorStop(1, colors.hot);
  gradients.set(key, gradient);
  return gradient;
}

function yForDbfs(rect: MeterRect, dbfs: number) {
  const percent = dbfsToMeterPercent(dbfs) / 100;
  return rect.y + rect.height - rect.height * percent;
}

// The two layers (the Console's strip, 2026-10-11, D50), as iZotope Insight
// and Ableton Live draw them: the level, the hardware link's moving body, as
// the solid bar; the peak as a fainter segment above it, so the headroom
// shows. The segment's part above −3 dBFS is never dimmed: a peak that
// reaches the warning shows the hot pink at full strength, as the level would.
function drawMeterBody(
  ctx: CanvasRenderingContext2D,
  rect: MeterRect,
  dbfs: number,
  colors: MeterColors,
  gradients: GradientCache,
  inset = 2,
  peakDbfs = dbfs
) {
  const x = rect.x + inset;
  const width = Math.max(1, rect.width - inset * 2);
  const bottom = rect.y + rect.height - inset;
  const y = yForDbfs(rect, dbfs);
  const peakY = Math.min(y, yForDbfs(rect, peakDbfs));
  ctx.fillStyle = meterBodyGradient(ctx, rect, colors, gradients);
  if (peakY < y && peakY < bottom) {
    const segmentBottom = Math.min(y, bottom);
    ctx.globalAlpha = PEAK_SEGMENT_ALPHA;
    ctx.fillRect(x, peakY, width, segmentBottom - peakY);
    ctx.globalAlpha = 1;
    const hotY = Math.min(segmentBottom, yForDbfs(rect, METER_HOT_DBFS));
    if (peakY < hotY) ctx.fillRect(x, peakY, width, hotY - peakY);
  }
  if (y >= bottom) return;
  ctx.fillRect(x, y, width, bottom - y);
}

function drawPeakLine(
  ctx: CanvasRenderingContext2D,
  rect: MeterRect,
  dbfs: number,
  colors: MeterColors,
  form: "standard" | "wide" = "standard"
) {
  if (!Number.isFinite(dbfs) || dbfs <= METER_FLOOR_DBFS) return;
  const y = Math.max(rect.y + 1, Math.min(rect.y + rect.height - 2, yForDbfs(rect, dbfs)));
  // The wide meter's line spans its bar, centred on its place, as the board
  // draws it; it stands on the dark slot or on the peak's faint segment.
  if (form === "wide") {
    ctx.fillStyle = colors.hold;
    ctx.fillRect(rect.x, y - 1, rect.width, 2);
    return;
  }
  const x = rect.x + 1;
  const width = Math.max(1, rect.width - 2);
  // C09(c): a 1 px keyline in the well's black above and below the tick, so
  // the line separates from the body it sits on without a new hue.
  ctx.fillStyle = colors.bg;
  ctx.fillRect(x, y - 1, width, 4);
  ctx.fillStyle = colors.hold;
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
  ctx.strokeStyle = colors.hot;
  ctx.lineWidth = 1;
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, Math.max(1, rect.width - 1), Math.max(1, rect.height - 1));
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = colors.hot;
  ctx.fillRect(rect.x + 1, rect.y + 1, Math.max(1, rect.width - 2), Math.max(1, rect.height - 2));
  ctx.globalAlpha = 1;
}

function drawPeakWarningOverlay(ctx: CanvasRenderingContext2D, rect: MeterRect, colors: MeterColors) {
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = colors.hot;
  ctx.lineWidth = 1;
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, Math.max(1, rect.width - 1), Math.max(1, rect.height - 1));
  ctx.globalAlpha = 1;
}

function drawMeterPointOverIndicator(ctx: CanvasRenderingContext2D, rect: MeterRect, colors: MeterColors) {
  // C09(b): a transient over-sample (meterPointOver) and a latched channel-path
  // clip overlap geometrically: the over is a thin band a hair below the top
  // edge, so it never sits under the clip's 1 px outline at rect.y + 0.5.
  ctx.fillStyle = colors.hot;
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
  const transientDbfs = geometry.side === "left" ? entry.transientLeftDbfs : entry.transientRightDbfs;
  const peakDbfs = geometry.side === "left" ? entry.peakLeftDbfs : entry.peakRightDbfs;

  // The strip's wide meter (D50): the two layers fill the whole bar and the
  // held peak's line spans it; the edge ticks are the well's own, and the
  // peak well over the meter says the warning and the clip.
  if (geometry.form === "wide" && geometry.orientation === "vertical") {
    drawMeterBody(ctx, rect, bodyDbfs, colors, gradients, 0, transientDbfs);
    drawPeakLine(ctx, rect, peakDbfs, colors, "wide");
    return;
  }

  // Visual overhaul A, Slice 4b: a strip's meter bar runs bottom-to-top, so it
  // is painted with the vertical body, sheen, reference and peak the tall
  // meters already use; the cluster's bar keeps the horizontal treatment below.
  if (geometry.orientation === "vertical") {
    drawMeterBody(ctx, rect, bodyDbfs, colors, gradients, 2, transientDbfs);
    drawNominalReference(ctx, rect, colors);
    if (Number.isFinite(peakDbfs) && peakDbfs > METER_FLOOR_DBFS) {
      drawPeakLine(ctx, rect, peakDbfs, colors);
    }
    if (entry.peakWarning) drawPeakWarningOverlay(ctx, rect, colors);
    const overVertical = geometry.side === "left" ? entry.meterPointOverLeft : entry.meterPointOverRight;
    if (overVertical) drawMeterPointOverIndicator(ctx, rect, colors);
    if (entry.channelPathClip) drawClipOverlay(ctx, rect, colors);
    return;
  }

  const nominalX = rect.x + rect.width * (dbfsToMeterPercent(METER_NOMINAL_DBFS) / 100);

  const width = Math.max(0, rect.width * (dbfsToMeterPercent(bodyDbfs) / 100));
  const peakWidth = Math.max(width, rect.width * (dbfsToMeterPercent(transientDbfs) / 100));
  ctx.fillStyle = miniMeterGradient(ctx, rect, colors, gradients);
  if (peakWidth > width) {
    // The peak's segment, its hot zone at full strength (see drawMeterBody).
    ctx.globalAlpha = PEAK_SEGMENT_ALPHA;
    ctx.fillRect(rect.x + width, rect.y, peakWidth - width, rect.height);
    ctx.globalAlpha = 1;
    const hotX = Math.max(rect.x + width, rect.x + rect.width * (dbfsToMeterPercent(METER_HOT_DBFS) / 100));
    if (rect.x + peakWidth > hotX) ctx.fillRect(hotX, rect.y, rect.x + peakWidth - hotX, rect.height);
  }
  if (width > 0) {
    ctx.fillRect(rect.x, rect.y, width, rect.height);
  }

  // DP2: nominal (−18 dBFS) reference tinted from the trough bg so it reads on
  // the fill in every theme — same treatment as the vertical meters.
  ctx.globalAlpha = 0.6 * 0.6;
  ctx.fillStyle = colors.bg;
  ctx.fillRect(Math.max(rect.x, Math.min(rect.x + rect.width - 1, nominalX)), rect.y, 1, rect.height);
  ctx.globalAlpha = 1;

  if (Number.isFinite(peakDbfs) && peakDbfs > METER_FLOOR_DBFS) {
    const peakX = rect.x + rect.width * (dbfsToMeterPercent(peakDbfs) / 100);
    const tickX = Math.max(rect.x, Math.min(rect.x + rect.width - 2, peakX - 1));
    // DP2: a crisp 2 px held-peak tick with a dark hairline outline, so it
    // reads on the lit bar and on the dark trough alike.
    ctx.fillStyle = colors.bg;
    ctx.fillRect(tickX - 0.5, rect.y, 3, rect.height);
    ctx.fillStyle = colors.hold;
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

  drawMeterBody(ctx, left, entry.bodyLeftDbfs, colors, gradients, 2, entry.transientLeftDbfs);
  if (right) {
    drawMeterBody(
      ctx,
      right,
      geometry.mirrorRight ? entry.bodyLeftDbfs : entry.bodyRightDbfs,
      colors,
      gradients,
      2,
      geometry.mirrorRight ? entry.transientLeftDbfs : entry.transientRightDbfs
    );
  }
  // DP2: glass sheen over each fill, then the nominal line + peak on top so the
  // instrument references stay crisp above the subtle lens highlight.
  drawNominalReference(ctx, left, colors);
  drawPeakLine(ctx, left, entry.peakLeftDbfs, colors);
  if (right) {
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
    const orientation = meter.dataset.miniMeterOrientation === "vertical" ? "vertical" : "horizontal";
    const rect = elementRect(meter, canvasRect, scaleX, scaleY);
    if (!meterId || (meterKind !== "channel" && meterKind !== "mixTarget") || !rect) {
      continue;
    }

    geometry.push({
      kind: "mini",
      form: meter.dataset.miniMeterForm === "wide" ? "wide" : "standard",
      meterId,
      meterKind,
      orientation,
      rect,
      side,
    });
  }

  const wells: PeakWell[] = [];
  for (const element of root.querySelectorAll<HTMLElement>("[data-peak-well-id]")) {
    const meterId = element.dataset.peakWellId;
    const meterKind = element.dataset.peakWellKind === "mixTarget" ? "mixTarget" : "channel";
    const value = element.querySelector<HTMLElement>("[data-peak-well-value]");
    if (!meterId || !value) continue;
    wells.push({ element, meterId, meterKind, stereo: element.dataset.peakWellStereo === "true", value });
  }

  return {
    colors: readColors(root),
    dpr,
    geometry,
    wells,
  };
}

// The well's number and its level, written only when they change: the page
// never renders for them.
function writePeakWell(well: PeakWell, dbfs: number) {
  const text = formatPeakWellDbfs(dbfs);
  if (well.value.textContent !== text) well.value.textContent = text;
  const level = peakWellLevel(dbfs);
  if (well.element.dataset.peakLevel !== level) well.element.dataset.peakLevel = level;
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
    // The page that mounts the canvas, found by the metering gate it carries:
    // the Console's workspace, or the Overview's (D47), which paints the same
    // meters in its own placeholders.
    const root = canvas?.closest<HTMLElement>("[data-canvas-metering]");
    // Visual overhaul A, Slice 4: the cluster's meters live in the shell's own
    // region, outside the workspace element, so the canvas covers the shell
    // frame and the observers watch it. The workspace element stays the source
    // of the palette and the metering gate.
    const paintRoot = canvas?.closest<HTMLElement>("[data-shell-frame]") ?? root ?? null;
    if (!canvas || !root || !paintRoot) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let animationFrame = 0;
    let colors = readColors(root);
    let dpr = window.devicePixelRatio || 1;
    let geometry: MeterGeometry[] = [];
    let wells: PeakWell[] = [];
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
    resizeObserver.observe(paintRoot);

    const mutationObserver = new MutationObserver(requestMeasure);
    mutationObserver.observe(paintRoot, {
      attributeFilter: ["data-view-mode", "data-selected"],
      attributes: true,
      childList: true,
      subtree: true,
    });

    const paint = () => {
      if (needsMeasure) {
        const measured = measureGeometry(canvas, paintRoot);
        colors = measured.colors;
        dpr = measured.dpr;
        geometry = measured.geometry;
        wells = measured.wells;
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
        for (const well of wells) writePeakWell(well, Number.NEGATIVE_INFINITY);
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
      // A strip's peak well: the held peak of its meter's bars, as the line shows it.
      for (const well of wells) {
        const state = displayStates.get(`${well.meterKind}:${well.meterId}:mini:left`);
        const dbfs = !state
          ? Number.NEGATIVE_INFINITY
          : well.stereo
            ? Math.max(state.peakLeftDbfs, state.peakRightDbfs)
            : state.peakLeftDbfs;
        writePeakWell(well, dbfs);
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
