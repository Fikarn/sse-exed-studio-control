import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Maximize2, X } from "lucide-react";

import type { LightingDmxMonitorSnapshot, LightingFixtureSnapshot } from "@sse/engine-client";

import { lightingFixtureColorHex } from "../lightingHelpers";

import styles from "./DMXCompactStrip.module.css";

// 30 Hz cap: paint at most every ~33 ms. Snapshot ticks faster than this on
// busy rigs; rAF naturally clamps to display refresh rate (typically 60 Hz)
// but we don't need that granularity for a glanceable strip.
const FRAME_INTERVAL_MS = 1000 / 30;
const TOOLTIP_OFFSET_Y = 12;

export interface DMXCompactStripProps {
  /** Live channel snapshot from the engine. Read once per rAF tick. */
  snapshot: LightingDmxMonitorSnapshot | null;
  /** Fixture list for tooltip (channel → fixture name). The strip uses the
   *  snapshot's `lightName` when available, falling back to fixture lookup
   *  by start address ranges only when the snapshot is stale. */
  fixtures: readonly LightingFixtureSnapshot[];
  /** Bridge reachability — when false, the strip dims and reads "stale" in
   *  the tooltip. */
  bridgeReachable: boolean;
  /** Universe label shown at the strip's left edge. */
  universe: number;
  /** Click any cell (or the strip body outside cells) to open the full
   *  ⌘⇧M monitor dialog. */
  onOpenMonitor: () => void;
  /** Hide the strip — either via the small × on the right edge or via the
   *  health bar toggle. */
  onClose: () => void;
}

interface ChannelCell {
  channel: number;
  value: number;
  label: string;
  lightName: string;
  cct: number | null;
  on: boolean;
}

function lookupFixtureCct(
  channel: number,
  fixtures: readonly LightingFixtureSnapshot[]
): { cct: number; on: boolean } | null {
  // Snapshot channels are 1-indexed. Match against fixture.dmxStartAddress
  // (also 1-indexed). Each fixture occupies dmxStartAddress..+(channelCount-1).
  // We don't store channelCount on the snapshot; assume 4 (standard for our
  // fixture types) — the strip's CCT-tinted color is a glance hint, not
  // load-bearing. If a fixture occupies fewer/more channels the tint just
  // reads as the closest-fixture's color.
  for (const fixture of fixtures) {
    if (!fixture.dmxStartAddress || fixture.dmxStartAddress < 1) continue;
    if (channel < fixture.dmxStartAddress) continue;
    if (channel > fixture.dmxStartAddress + 3) continue; // assume 4-channel
    return { cct: fixture.cct, on: fixture.on };
  }
  return null;
}

/**
 * Wave 31 — P4 persistent compact DMX strip. Renders the live universe to
 * a single `<canvas>` at ~30 Hz via a shared rAF loop. The strip docks
 * above the health bar when toggled on (P4 spec; toggle persists to
 * localStorage). One pixel-wide cell per channel; intensity drives
 * cell brightness, fixture lookup drives CCT-tinted color when patched.
 *
 * Hover any cell → tooltip shows `Ch NNN · {fixtureName} · {channelLabel} ·
 * {value}`. Click any cell → opens the full ⌘⇧M monitor dialog (delegating
 * to the existing surface so we don't duplicate UI).
 */
export function DMXCompactStrip({
  snapshot,
  fixtures,
  bridgeReachable,
  universe,
  onOpenMonitor,
  onClose,
}: DMXCompactStripProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    channel: number;
    label: string;
    lightName: string;
    value: number;
  } | null>(null);

  // Channel cells — only "interesting" channels are rendered so each cell
  // gets meaningful width on a typical rig (~24 patched channels out of
  // 512). Interesting = part of any patched fixture's address range OR
  // currently firing a non-zero value (catches stuck / unexpected output
  // even on unpatched addresses; the full ⌘⇧M monitor still shows the
  // whole 512-channel universe for power users).
  const cells = useMemo<ChannelCell[]>(() => {
    const includeChannel = new Set<number>();
    for (const fixture of fixtures) {
      if (!fixture.dmxStartAddress || fixture.dmxStartAddress < 1) continue;
      // Assume 4-channel patches (matches our fixture types). The exact
      // channel count is glance-only — the strip is a meter, not a patch
      // table.
      for (let offset = 0; offset < 4; offset += 1) {
        includeChannel.add(fixture.dmxStartAddress + offset);
      }
    }
    const map = new Map<number, ChannelCell>();
    for (const channel of snapshot?.channels ?? []) {
      const isFiring = channel.value > 0;
      if (!includeChannel.has(channel.channel) && !isFiring) continue;
      const lookup = lookupFixtureCct(channel.channel, fixtures);
      map.set(channel.channel, {
        channel: channel.channel,
        value: channel.value,
        label: channel.label,
        lightName: channel.lightName,
        cct: lookup?.cct ?? null,
        on: lookup?.on ?? false,
      });
    }
    // Backfill any patched channel the snapshot didn't include so the strip
    // shows the full patched footprint even when the bridge is stale.
    for (const channel of includeChannel) {
      if (!map.has(channel)) {
        const lookup = lookupFixtureCct(channel, fixtures);
        map.set(channel, {
          channel,
          value: 0,
          label: "",
          lightName: "",
          cct: lookup?.cct ?? null,
          on: lookup?.on ?? false,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.channel - b.channel);
  }, [snapshot, fixtures]);

  // Single rAF loop reads canvas.clientWidth / clientHeight (its actual
  // rendered size from CSS flex layout) on each tick and resizes the
  // BUFFER (canvas.width / canvas.height) to match × DPR. No inline
  // width/height styling on the canvas — flex owns the layout, the
  // buffer just follows. This avoids the Wave 31 v1 feedback loop where
  // an inline canvas width = container.contentRect.width pushed flex
  // siblings out and re-triggered ResizeObserver indefinitely.
  const cellsRef = useRef(cells);
  cellsRef.current = cells;
  const dimmedRef = useRef(!bridgeReachable);
  dimmedRef.current = !bridgeReachable;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let lastPaint = 0;
    let raf = 0;

    const paint = (now: number) => {
      raf = requestAnimationFrame(paint);
      if (now - lastPaint < FRAME_INTERVAL_MS) return;
      lastPaint = now;
      const cssWidth = canvas.clientWidth;
      const cssHeight = canvas.clientHeight;
      if (cssWidth === 0 || cssHeight === 0) return;
      const targetW = Math.floor(cssWidth * dpr);
      const targetH = Math.floor(cssHeight * dpr);
      if (canvas.width !== targetW) canvas.width = targetW;
      if (canvas.height !== targetH) canvas.height = targetH;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssWidth, cssHeight);

      const cellsRefValue = cellsRef.current;
      const cellCount = cellsRefValue.length;
      if (cellCount === 0) {
        // No patched fixtures + no firing channels → empty-state placeholder
        // is rendered above the canvas (see JSX). Bail without painting.
        return;
      }
      const cellWidth = cssWidth / cellCount;
      const dimmed = dimmedRef.current;
      const baseAlpha = dimmed ? 0.35 : 1;
      const minCellWidth = Math.max(1, cellWidth);

      for (let i = 0; i < cellCount; i += 1) {
        const cell = cellsRefValue[i]!;
        const x = i * cellWidth;
        // Patched-but-dark cells render a faint outline so the operator can
        // see the full footprint of the patched rig. Active cells fill with
        // CCT-tinted color at intensity-driven alpha.
        const intensity = cell.value / 255;
        if (intensity > 0.01) {
          const color = cell.cct !== null && cell.on ? lightingFixtureColorHex(cell.cct, true) : "#99BA92";
          ctx.globalAlpha = baseAlpha * Math.max(0.18, intensity);
          ctx.fillStyle = color;
          ctx.fillRect(x, 0, minCellWidth, cssHeight);
        } else {
          ctx.globalAlpha = baseAlpha * 0.12;
          ctx.fillStyle = cell.cct !== null ? lightingFixtureColorHex(cell.cct, true) : "#99BA92";
          ctx.fillRect(x, 0, minCellWidth, cssHeight);
        }
      }
      ctx.globalAlpha = 1;
    };

    raf = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf);
  }, []);

  const handleMouseMove = useCallback(
    (event: MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      if (rect.width === 0 || cells.length === 0) return;
      const cellIndex = Math.min(cells.length - 1, Math.max(0, Math.floor((x / rect.width) * cells.length)));
      const cell = cells[cellIndex];
      if (!cell) {
        setTooltip(null);
        return;
      }
      setTooltip({
        x: event.clientX,
        y: event.clientY,
        channel: cell.channel,
        label: cell.label || "—",
        lightName: cell.lightName || "(unpatched)",
        value: cell.value,
      });
    },
    [cells]
  );

  const handleMouseLeave = useCallback(() => setTooltip(null), []);

  const address = tooltip ? String(tooltip.channel).padStart(3, "0") : "";

  return (
    <div className={styles.shell} role="region" aria-label={`Universe ${universe} compact DMX strip`}>
      <span className={styles.label}>
        DMX <strong>U{universe}</strong>
        <span className={styles.count}>· {cells.length} ch</span>
        {!bridgeReachable ? <span className={styles.stale}> · stale</span> : null}
      </span>
      {cells.length === 0 ? (
        <span className={styles.empty} role="status">
          No patched channels — patch fixtures to see live output here.
        </span>
      ) : (
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          onClick={onOpenMonitor}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          aria-label="Click to open the full DMX monitor"
        />
      )}
      <button
        type="button"
        className={styles.expandButton}
        onClick={onOpenMonitor}
        aria-label="Open full DMX monitor"
        title="Open full DMX monitor (⌘ ⇧ M)"
      >
        <Maximize2 aria-hidden="true" size={11} strokeWidth={2} />
      </button>
      <button
        type="button"
        className={styles.closeButton}
        onClick={onClose}
        aria-label="Hide DMX strip"
        title="Hide DMX strip"
      >
        <X aria-hidden="true" size={11} strokeWidth={2} />
      </button>
      {tooltip ? (
        <div
          className={styles.tooltip}
          style={{ left: tooltip.x + TOOLTIP_OFFSET_Y, top: tooltip.y - TOOLTIP_OFFSET_Y }}
          role="tooltip"
        >
          <span className={styles.tooltipChannel}>Ch {address}</span>
          <span className={styles.tooltipLight}>{tooltip.lightName}</span>
          <span className={styles.tooltipLabel}>{tooltip.label}</span>
          <span className={styles.tooltipValue}>{tooltip.value}</span>
        </div>
      ) : null}
    </div>
  );
}
