import type { CSSProperties } from "react";

import styles from "./Meter.module.css";

// Visual overhaul A, Slice 3 (system §4, §5, §7): the meter is signal, not
// status — the ramp keeps the physical green / yellow / orange / red, doubled
// by a blurred emissive copy so the bar lights the well floor around it; the
// −18 dBFS reference is a dashed line at 70 %, the peak a white line with its
// bloom, the clip a lamp. `empty` leaves the well with the reference only
// (no metering); `stale` shows the last frame dimmed with no glow.
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
  testId?: string;
  className?: string;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

function Bar({
  level,
  peak,
  empty,
  stale,
  orientation,
}: Pick<MeterProps, "level" | "peak" | "empty" | "stale" | "orientation">) {
  const fill = empty ? 0 : clamp01(level);
  const style = { "--meter-level": String(fill) } as CSSProperties;
  return (
    <span className={styles.bar} style={style}>
      {!empty && !stale ? <span className={styles.glow} data-signal="meter" /> : null}
      {!empty ? <span className={styles.ramp} data-signal="meter" /> : null}
      {!empty && peak !== undefined ? (
        <span
          className={styles.peak}
          data-lit={stale ? undefined : ""}
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
  testId,
  className,
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
      style={{ "--meter-reference": String(clamp01(reference)) } as CSSProperties}
    >
      <span className={styles.bars} aria-hidden="true">
        <Bar level={level} peak={peak} empty={empty} stale={stale} orientation={orientation} />
        {stereo ? (
          <Bar level={levelRight} peak={peakRight} empty={empty} stale={stale} orientation={orientation} />
        ) : null}
      </span>
      <span className={styles.reference} aria-hidden="true" />
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
