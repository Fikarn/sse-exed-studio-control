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
  orientation: "vertical" | "horizontal";
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

type GradientCache = Map<string, CanvasGradient>;

function cssColor(style: CSSStyleDeclaration, name: string, fallback: string) {
  return style.getPropertyValue(name).trim() || fallback;
}

// The visual overhaul's Console pull request: the meters draw the design
// system's signal ramp (DESIGN.md §4): green to −18 dBFS, yellow to −3,
// coral above, flat and with hard stops, as the design system's Meter does;
// a 2 px peak tick; a held clip in coral. The names are read from the page's
// root, where the tokens declare them; the fallbacks are the palette's.
function readColors(root: HTMLElement): MeterColors {
  const style = getComputedStyle(root);
  const low = cssColor(style, "--signal-meter-low", "#99BA92");
  const mid = cssColor(style, "--signal-meter-mid", "#F2DE6F");
  const over = cssColor(style, "--signal-meter-over", "#FF7D55");
  const well = cssColor(style, "--material-well", "#040706");
  return {
    amber: mid,
    bg: well,
    clip: cssColor(style, "--role-coral-text", over),
    green: low,
    hot: mid,
    over,
    overTone: over,
    peak: cssColor(style, "--signal-peak", "#C5C7B9"),
    peakEdge: well,
    rms: low,
    zoneAmber: mid,
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
  // Top = 0 dBFS: coral above −3 dBFS (the top 5 %), yellow to −18 (30 %),
  // green below, hard stops (DESIGN.md §4).
  const gradient = ctx.createLinearGradient(0, rect.y, 0, rect.y + rect.height);
  gradient.addColorStop(0, colors.over);
  gradient.addColorStop(0.05, colors.over);
  gradient.addColorStop(0.05, colors.zoneAmber);
  gradient.addColorStop(0.3, colors.zoneAmber);
  gradient.addColorStop(0.3, colors.green);
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
  // Left to right: green to −18 dBFS (70 %), yellow to −3 (95 %), coral above.
  const gradient = ctx.createLinearGradient(rect.x, 0, rect.x + rect.width, 0);
  gradient.addColorStop(0, colors.green);
  gradient.addColorStop(0.7, colors.green);
  gradient.addColorStop(0.7, colors.zoneAmber);
  gradient.addColorStop(0.95, colors.zoneAmber);
  gradient.addColorStop(0.95, colors.over);
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

  // Visual overhaul A, Slice 4b: a strip's meter bar runs bottom-to-top, so it
  // is painted with the vertical body, sheen, reference and peak the tall
  // meters already use; the cluster's bar keeps the horizontal treatment below.
  if (geometry.orientation === "vertical") {
    drawMeterBody(ctx, rect, bodyDbfs, colors, gradients);
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
  if (width > 0) {
    ctx.fillStyle = miniMeterGradient(ctx, rect, colors, gradients);
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
      meterId,
      meterKind,
      orientation,
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
