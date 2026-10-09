import type { CSSProperties } from "react";

import styles from "./AudioStereoMeter.module.css";
import {
  AUDIO_METER_NEG_INFINITY,
  dbfsToMeterPercent,
  formatMeterDb,
  formatMeterPercent,
  meterTone,
  METER_NOMINAL_DBFS,
  MINUS,
  normalizedToDbfs,
} from "../audioFormatting";

// The visual overhaul's polish (2026-10-05): the marks print the real minus
// (DESIGN.md §3); each mark's `data-meter-scale-mark` stays its number as
// written in code ("-6"), the name the meter tests read it by.
export const METER_SCALE_MARKS = [
  { dbfs: 0, label: "0" },
  { dbfs: -6, label: `${MINUS}6` },
  { dbfs: -12, label: `${MINUS}12` },
  { dbfs: -18, label: `${MINUS}18` },
  { dbfs: -24, label: `${MINUS}24` },
  { dbfs: -40, label: `${MINUS}40` },
  { dbfs: -60, label: `${MINUS}60` },
];

function formatPeakReadout(value: number) {
  const db = normalizedToDbfs(value);
  if (!Number.isFinite(db)) return AUDIO_METER_NEG_INFINITY;
  const rounded = Number(db.toFixed(1));
  return rounded < 0 ? `${MINUS}${Math.abs(rounded).toFixed(1)}` : Math.abs(rounded).toFixed(1);
}

function meterPercent(value: number) {
  return formatMeterPercent(value);
}

function resolveMeterValues({
  clip,
  fallbackLeft,
  fallbackRight,
  fallbackPeak,
  fallbackPeakLeft,
  fallbackPeakRight,
  mirrorRight,
}: {
  clip?: boolean;
  fallbackLeft: number;
  fallbackRight: number;
  fallbackPeak?: number;
  fallbackPeakLeft?: number;
  fallbackPeakRight?: number;
  mirrorRight: boolean;
}) {
  const liveLeft = fallbackLeft;
  const liveRight = mirrorRight ? fallbackLeft : fallbackRight;
  const liveClip = clip;
  const leftPeak = fallbackPeakLeft ?? fallbackPeak ?? Math.max(liveLeft, liveRight);
  const rightPeak = mirrorRight ? leftPeak : (fallbackPeakRight ?? fallbackPeak ?? Math.max(liveLeft, liveRight));

  return {
    leftPeak,
    liveClip,
    liveLeft,
    liveRight,
    rightPeak,
  };
}

export function AudioStereoMeter({
  clip,
  clipHold,
  left,
  meterId,
  meterKind,
  over,
  peak,
  peakLeft,
  peakRight,
  peakWarning,
  mirrorRight = false,
  right,
  showPeakReadout = false,
  showReadout = true,
  showScale = false,
}: {
  clip?: boolean;
  clipHold?: boolean;
  left: number;
  meterId: string;
  meterKind: "channel" | "mixTarget";
  mirrorRight?: boolean;
  over?: boolean;
  peak?: number;
  peakLeft?: number;
  peakRight?: number;
  peakWarning?: boolean;
  right: number;
  showPeakReadout?: boolean;
  showReadout?: boolean;
  showScale?: boolean;
}) {
  const channelPathClip = clip === true || clipHold === true;
  const meterPointOver = over === true;
  const { leftPeak, liveClip, liveLeft, liveRight, rightPeak } = resolveMeterValues({
    clip: channelPathClip,
    fallbackLeft: left,
    fallbackPeak: peak,
    fallbackPeakLeft: peakLeft,
    fallbackPeakRight: peakRight,
    fallbackRight: right,
    mirrorRight,
  });
  const style = {
    "--audio-meter-left": meterPercent(liveLeft),
    "--audio-meter-right": meterPercent(liveRight),
    "--audio-meter-peak-left": meterPercent(leftPeak),
    "--audio-meter-peak-right": meterPercent(rightPeak),
    "--audio-meter-peak-left-offset": `${(100 - Number.parseFloat(meterPercent(leftPeak))).toFixed(2)}%`,
    "--audio-meter-peak-right-offset": `${(100 - Number.parseFloat(meterPercent(rightPeak))).toFixed(2)}%`,
    "--audio-meter-nominal-offset": `${(100 - dbfsToMeterPercent(METER_NOMINAL_DBFS)).toFixed(2)}%`,
  } as CSSProperties;

  return (
    <div
      className={styles.stereoMeter}
      data-clip={liveClip === true}
      data-channel-path-clip={channelPathClip}
      data-meter-point-over={meterPointOver}
      data-peak-warning={peakWarning === true}
      data-meter-component="stereo"
      data-meter-id={meterId}
      data-meter-kind={meterKind}
      data-meter-mirror-right={mirrorRight}
      data-peak-readout={showPeakReadout}
      data-readout={showReadout}
      style={style}
    >
      {showPeakReadout ? (
        <div className={styles.meterPeakReadout} aria-hidden="true">
          <span data-meter-peak-readout="left">{formatPeakReadout(leftPeak)}</span>
          <span data-meter-peak-readout="right">{formatPeakReadout(rightPeak)}</span>
        </div>
      ) : null}
      <div className={styles.meterPair}>
        <span className={styles.meterTrack} data-meter-track="left" data-tone={meterTone(liveLeft, liveClip)}>
          <span className={styles.meterFill} data-meter-fill="left" data-side="left" data-signal="meter" />
          <span className={styles.meterNominal} data-meter-reference="nominal" />
          <span className={styles.meterPeak} data-meter-peak="left" data-side="left" />
        </span>
        <span className={styles.meterTrack} data-meter-track="right" data-tone={meterTone(liveRight, liveClip)}>
          <span className={styles.meterFill} data-meter-fill="right" data-side="right" data-signal="meter" />
          <span className={styles.meterNominal} data-meter-reference="nominal" />
          <span className={styles.meterPeak} data-meter-peak="right" data-side="right" />
        </span>
      </div>
      {showScale ? (
        <div className={styles.meterScale} aria-hidden="true" data-meter-scale="dbfs">
          {METER_SCALE_MARKS.map((mark) => (
            <span
              data-meter-scale-mark={String(mark.dbfs)}
              key={mark.dbfs}
              style={{ "--meter-scale-position": `${dbfsToMeterPercent(mark.dbfs).toFixed(2)}%` } as CSSProperties}
            >
              {mark.label}
            </span>
          ))}
        </div>
      ) : null}
      {showReadout ? (
        <div className={styles.meterReadout} data-meter-readout="true">
          {liveClip ? "CLIP" : formatMeterDb(Math.max(liveLeft, liveRight))}
        </div>
      ) : null}
      {mirrorRight ? (
        // Why: GS-AUD inline P2. The right meter mirrors the left for mono
        // channels (no actual stereo signal). The M glyph overlays the
        // meter pair to tell the operator at a glance that the second bar
        // is a mirror, not an independent channel. Position absolute so
        // the laneBody grid arity stays at 2 columns (previous attempt
        // collapsed the fader column by adding a 3rd grid child).
        <span aria-hidden="true" className={styles.meterMonoBadge} data-meter-mono-badge="true">
          M
        </span>
      ) : null}
    </div>
  );
}
