import type { CSSProperties } from "react";

import styles from "./Meter.module.css";

// Visual overhaul A, Slice 3 (system §4, §5, §7): the meter is signal, not
// status. The overhaul's look (Atrium): each bar runs in a slot one step up
// inside the black well; the ramp is flat, with nothing glowing, in the
// meters' own colours, used for nothing else (D50): aqua to −18 dBFS, light
// aqua to −3 and hot pink above; the peak is a 2 px ice-white line, the clip
// a hot-pink lamp, and the −18 dBFS reference a hairline tick at the slots'
// edges. `empty` leaves the slots only (no metering); `stale` shows the last
// frame at 0.4.
//
// Slice 4: a meter can name the engine's meter entry (`meterId` / `meterKind`),
// which stamps the `data-mini-meter-*` attributes the Console's canvas overlay
// paints into — so a meter tracks the desk live without a React render.
//
// The wide form (the Console's strip, 2026-10-11, D50): the meter is the
// strip's hero, 64 px with its bars 4 px inside the well, short ticks at its
// edges and the reference as a longer tick through each edge, so nothing is
// drawn across the signal. Its clip shows in its host's peak well, so it has
// no lamp.
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
  /** The strip's wide form (vertical only); `standard` by default. */
  form?: "standard" | "wide";
  /** The wide form's edge ticks, 0..1 from the bottom (the reference draws its own). */
  marks?: readonly number[];
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
  form: "standard" | "wide";
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
// The wide form says so to the painter, which leaves the clip and the warning
// to the host's peak well and the reference to the edge ticks.
function Bar({ level, peak, empty, stale, form, orientation, meterId, meterKind, side }: BarProps) {
  const fill = empty ? 0 : clamp01(level);
  return (
    <span
      className={styles.bar}
      style={{ "--meter-level": String(fill) } as CSSProperties}
      data-mini-meter-id={meterId}
      data-mini-meter-kind={meterId ? meterKind : undefined}
      data-mini-meter-side={meterId ? side : undefined}
      data-mini-meter-orientation={meterId ? orientation : undefined}
      data-mini-meter-form={meterId && form === "wide" ? "wide" : undefined}
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
  form = "standard",
  marks,
  label,
  meterId,
  meterKind,
  testId,
  className,
  style,
}: MeterProps) {
  const stereo = levelRight !== undefined;
  const wide = form === "wide" && orientation === "vertical";
  return (
    <div
      className={[
        styles.meter,
        styles[orientation],
        stereo ? styles.stereo : "",
        wide ? styles.wide : "",
        empty ? styles.empty : "",
        stale ? styles.stale : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      data-well=""
      data-meter=""
      data-meter-form={wide ? "wide" : undefined}
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
      {wide ? null : <span className={styles.reference} aria-hidden="true" />}
      <span className={styles.bars} aria-hidden="true">
        <Bar
          level={level}
          peak={peak}
          empty={empty}
          stale={stale}
          form={form}
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
            form={form}
            orientation={orientation}
            meterId={meterId}
            meterKind={meterKind}
            side="right"
          />
        ) : null}
      </span>
      {wide ? (
        <EdgeTicks marks={marks} reference={reference} />
      ) : orientation === "vertical" ? (
        <span
          className={[styles.clip, clip ? styles.clipLit : ""].filter(Boolean).join(" ")}
          data-lit={clip ? "" : undefined}
          aria-hidden="true"
        />
      ) : null}
    </div>
  );
}

// The wide form's scale on the well itself: a short tick at each edge for
// each mark, between the edge and the bars, and the reference as a longer,
// brighter tick through each edge (it stands 4 px outside the well).
function EdgeTicks({ marks = [], reference }: { marks?: readonly number[]; reference: number }) {
  const ticks = [...marks.map((at) => ({ at, reference: false })), { at: reference, reference: true }];
  return (
    <>
      {ticks.flatMap(({ at, reference: isReference }) =>
        (["left", "right"] as const).map((side) => (
          <span
            key={`${at}-${side}`}
            className={styles.edgeTick}
            data-side={side}
            data-reference={isReference ? "" : undefined}
            aria-hidden="true"
            style={{ "--meter-tick": String(clamp01(at)) } as CSSProperties}
          />
        ))
      )}
    </>
  );
}
