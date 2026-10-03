import type { CSSProperties } from "react";

import styles from "./Meter.module.css";

// Visual overhaul A, Slice 3 (system §4, §5, §7): the meter is signal, not
// status. The overhaul's look (Atrium): each bar runs in a slot one step up
// inside the black well; the ramp is the signal token's green to −18 dBFS,
// yellow to −3 and coral above, flat, with nothing glowing; the peak is a
// 2 px tick, the clip a coral lamp, and the −18 dBFS reference a hairline
// tick at the slots' edges. `empty` leaves the slots only (no metering);
// `stale` shows the last frame at 0.4.
//
// Slice 4: a meter can name the engine's meter entry (`meterId` / `meterKind`),
// which stamps the `data-mini-meter-*` attributes the Console's canvas overlay
// paints into — so a meter tracks the desk live without a React render.
export interface MeterProps {
  /** 0..1 of the well (0 = floor, 0.7 = −18 dBFS, 1 = 0 dBFS). */
  level: number;
  /** Right channel for a stereo meter; omit for mono. */
  levelRight?: number;
  peak?: number;
  peakRight?: number;
  clip?: boolean;
  empty?: boolean;
  stale?: boolean;
  /** Vertical (default) or horizontal bar. */
  orientation?: "vertical" | "horizontal";
  /** Where the reference line sits, 0..1 (default 0.7 = −18 dBFS). */
  reference?: number;
  label: string;
  /** The engine's meter entry this well shows, for the live painter. */
  meterId?: string;
  meterKind?: "channel" | "mixTarget";
  testId?: string;
  className?: string;
  style?: CSSProperties;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

interface BarProps {
  level: number;
  peak?: number;
  empty?: boolean;
  stale?: boolean;
  orientation: "vertical" | "horizontal";
  meterId?: string;
  meterKind?: "channel" | "mixTarget";
  side: "left" | "right";
}

// The live painter fills a bar along its own axis, so each bar says which axis
// it runs on (`data-mini-meter-orientation`) rather than the painter assuming
// the cluster's horizontal one. `data-meter-track` is the same marker the
// Console's tall meters have always carried, so anything that reads a meter's
// left or right track — the canvas sampler, the tests — reads this one too.
function Bar({ level, peak, empty, stale, orientation, meterId, meterKind, side }: BarProps) {
  const fill = empty ? 0 : clamp01(level);
  return (
    <span
      className={styles.bar}
      style={{ "--meter-level": String(fill) } as CSSProperties}
      data-mini-meter-id={meterId}
      data-mini-meter-kind={meterId ? meterKind : undefined}
      data-mini-meter-side={meterId ? side : undefined}
      data-mini-meter-orientation={meterId ? orientation : undefined}
      data-meter-track={side}
    >
      {!empty ? <span className={styles.ramp} data-signal="meter" data-meter-fill={side} /> : null}
      {!empty && peak !== undefined ? (
        <span
          className={styles.peak}
          data-lit={stale ? undefined : ""}
          data-meter-peak={side}
          style={
            {
              [orientation === "horizontal" ? "left" : "bottom"]: `${clamp01(peak) * 100}%`,
            } as CSSProperties
          }
        />
      ) : null}
    </span>
  );
}

export function Meter({
  level,
  levelRight,
  peak,
  peakRight,
  clip = false,
  empty = false,
  stale = false,
  orientation = "vertical",
  reference = 0.7,
  label,
  meterId,
  meterKind,
  testId,
  className,
  style,
}: MeterProps) {
  const stereo = levelRight !== undefined;
  return (
    <div
      className={[
        styles.meter,
        styles[orientation],
        stereo ? styles.stereo : "",
        empty ? styles.empty : "",
        stale ? styles.stale : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      data-well=""
      data-meter=""
      data-empty={empty ? "" : undefined}
      data-stale={stale ? "" : undefined}
      data-clip={clip ? "" : undefined}
      data-testid={testId}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={empty ? undefined : Math.round(clamp01(level) * 100)}
      style={{ ...style, "--meter-reference": String(clamp01(reference)) } as CSSProperties}
    >
      {/* First, so the slots paint over it: the reference shows at their edges. */}
      <span className={styles.reference} aria-hidden="true" />
      <span className={styles.bars} aria-hidden="true">
        <Bar
          level={level}
          peak={peak}
          empty={empty}
          stale={stale}
          orientation={orientation}
          meterId={meterId}
          meterKind={meterKind}
          side="left"
        />
        {stereo ? (
          <Bar
            level={levelRight}
            peak={peakRight}
            empty={empty}
            stale={stale}
            orientation={orientation}
            meterId={meterId}
            meterKind={meterKind}
            side="right"
          />
        ) : null}
      </span>
      {orientation === "vertical" ? (
        <span
          className={[styles.clip, clip ? styles.clipLit : ""].filter(Boolean).join(" ")}
          data-lit={clip ? "" : undefined}
          aria-hidden="true"
        />
      ) : null}
    </div>
  );
}
