import { useEffect, useRef } from "react";
import type { AudioMeterEntry, AudioMeterFrame, ShellStore } from "@sse/engine-client";

import styles from "../AudioWorkspace.module.css";
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
  right: MeterRect;
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
  clip: string;
  green: string;
  hot: string;
  over: string;
  peak: string;
  rms: string;
}

type GradientCache = Map<string, CanvasGradient>;

function cssColor(style: CSSStyleDeclaration, name: string, fallback: string) {
  return style.getPropertyValue(name).trim() || fallback;
}

function readColors(root: HTMLElement): MeterColors {
  const style = getComputedStyle(root);
  return {
    amber: cssColor(style, "--audio-meter-warn", "#f1c95f"),
    clip: cssColor(style, "--audio-clip", "#ff4b4b"),
    green: cssColor(style, "--audio-meter-low-hot", "#62d979"),
    hot: cssColor(style, "--audio-meter-hot", "#ff9f43"),
    over: cssColor(style, "--audio-meter-over", "#ff4b4b"),
    peak: cssColor(style, "--audio-meter-peak-hold", "#f8f1a5"),
    rms: cssColor(style, "--audio-meter-low", "#39c46b"),
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
    clearRectWithPadding(ctx, geometry.right, 3);
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
    colors.green,
    colors.amber,
    colors.hot,
    colors.over,
  ].join(":");
}

function meterBodyGradient(
  ctx: CanvasRenderingContext2D,
  rect: MeterRect,
  colors: MeterColors,
  gradients: GradientCache
) {
  const key = gradientKey("body", rect, colors);
  const cached = gradients.get(key);
  if (cached) return cached;
  const gradient = ctx.createLinearGradient(0, rect.y + 2, 0, rect.y + rect.height - 2);
  gradient.addColorStop(0, colors.over);
  gradient.addColorStop(0.1, colors.hot);
  gradient.addColorStop(0.22, colors.amber);
  gradient.addColorStop(1, colors.green);
  gradients.set(key, gradient);
  return gradient;
}

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
  gradient.addColorStop(0.7, colors.green);
  gradient.addColorStop(0.7, colors.amber);
  gradient.addColorStop(0.9, colors.hot);
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
  ctx.fillStyle = colors.peak;
  ctx.fillRect(rect.x + 1, y, Math.max(1, rect.width - 2), 2);
}

function drawNominalReference(ctx: CanvasRenderingContext2D, rect: MeterRect, colors: MeterColors) {
  const y = Math.max(rect.y + 1, Math.min(rect.y + rect.height - 2, yForDbfs(rect, METER_NOMINAL_DBFS)));
  ctx.globalAlpha = 0.72;
  ctx.fillStyle = colors.amber;
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
  ctx.fillStyle = colors.over;
  ctx.fillRect(rect.x + 1, rect.y + 1, Math.max(1, rect.width - 2), Math.min(4, Math.max(2, rect.height * 0.08)));
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

  ctx.globalAlpha = 0.72;
  ctx.fillStyle = colors.amber;
  ctx.fillRect(Math.max(rect.x, Math.min(rect.x + rect.width - 1, nominalX)), rect.y, 1, rect.height);
  ctx.globalAlpha = 1;

  if (Number.isFinite(peakDbfs) && peakDbfs > METER_FLOOR_DBFS) {
    const peakX = rect.x + rect.width * (dbfsToMeterPercent(peakDbfs) / 100);
    ctx.fillStyle = colors.peak;
    ctx.fillRect(Math.max(rect.x, Math.min(rect.x + rect.width - 2, peakX - 1)), rect.y, 2, rect.height);
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
  drawMeterBody(ctx, geometry.left, entry.bodyLeftDbfs, colors, gradients);
  drawMeterBody(
    ctx,
    geometry.right,
    geometry.mirrorRight ? entry.bodyLeftDbfs : entry.bodyRightDbfs,
    colors,
    gradients
  );
  drawNominalReference(ctx, geometry.left, colors);
  drawNominalReference(ctx, geometry.right, colors);
  drawPeakLine(ctx, geometry.left, entry.peakLeftDbfs, colors);
  drawPeakLine(ctx, geometry.right, geometry.mirrorRight ? entry.peakLeftDbfs : entry.peakRightDbfs, colors);

  if (entry.peakWarning) {
    drawPeakWarningOverlay(ctx, geometry.left, colors);
    drawPeakWarningOverlay(ctx, geometry.right, colors);
  }

  if (entry.meterPointOverLeft) {
    drawMeterPointOverIndicator(ctx, geometry.left, colors);
  }

  if (entry.meterPointOverRight) {
    drawMeterPointOverIndicator(ctx, geometry.right, colors);
  }

  if (entry.channelPathClip) {
    drawClipOverlay(ctx, geometry.left, colors);
    drawClipOverlay(ctx, geometry.right, colors);
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
    const right = rightTrack ? elementRect(rightTrack, canvasRect, scaleX, scaleY) : null;
    if (!meterId || (meterKind !== "channel" && meterKind !== "mixTarget") || !left || !right) {
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
