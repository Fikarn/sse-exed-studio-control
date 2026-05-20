import { memo, type CSSProperties } from "react";

import styles from "../AudioWorkspace.module.css";
import { formatMeterDb, meterTone, normalizedToDbfs } from "../audioFormatting";

function formatPeakReadout(value: number) {
  const db = normalizedToDbfs(value);
  if (!Number.isFinite(db)) return "-∞";
  return db.toFixed(1);
}

function meterPercent(value: number) {
  return `${(Math.max(0, Math.min(1, value)) * 100).toFixed(1)}%`;
}

type AudioStereoMeterProps = {
  clip?: boolean;
  left: number;
  peak?: number;
  peakLeft?: number;
  peakRight?: number;
  right: number;
  showPeakReadout?: boolean;
  showReadout?: boolean;
  showScale?: boolean;
};

function AudioStereoMeterImpl({
  clip,
  left,
  peak,
  peakLeft,
  peakRight,
  right,
  showPeakReadout = false,
  showReadout = true,
  showScale = false,
}: AudioStereoMeterProps) {
  const leftPeak = peakLeft ?? peak ?? Math.max(left, right);
  const rightPeak = peakRight ?? peak ?? Math.max(left, right);
  const style = {
    "--audio-meter-left": meterPercent(left),
    "--audio-meter-right": meterPercent(right),
    "--audio-meter-peak-left": meterPercent(leftPeak),
    "--audio-meter-peak-right": meterPercent(rightPeak),
  } as CSSProperties;

  return (
    <div
      className={styles.stereoMeter}
      data-clip={clip === true}
      data-meter-component="stereo"
      data-peak-readout={showPeakReadout}
      data-readout={showReadout}
      style={style}
    >
      {showPeakReadout ? (
        <div className={styles.meterPeakReadout} aria-hidden="true">
          <span>{formatPeakReadout(leftPeak)}</span>
          <span>{formatPeakReadout(rightPeak)}</span>
        </div>
      ) : null}
      <div className={styles.meterPair}>
        <span className={styles.meterTrack} data-tone={meterTone(left, clip)}>
          <span className={styles.meterFill} data-meter-fill="left" data-side="left" />
          <span className={styles.meterPeak} data-meter-peak="left" data-side="left" />
        </span>
        <span className={styles.meterTrack} data-tone={meterTone(right, clip)}>
          <span className={styles.meterFill} data-meter-fill="right" data-side="right" />
          <span className={styles.meterPeak} data-meter-peak="right" data-side="right" />
        </span>
      </div>
      {showScale ? (
        <div className={styles.meterScale} aria-hidden="true">
          <span>0</span>
          <span>-6</span>
          <span>-12</span>
          <span>-24</span>
          <span>-48</span>
          <span>-∞</span>
        </div>
      ) : null}
      {showReadout ? (
        <div className={styles.meterReadout}>{clip ? "CLIP" : formatMeterDb(Math.max(left, right))}</div>
      ) : null}
    </div>
  );
}

function arePropsEqual(prev: AudioStereoMeterProps, next: AudioStereoMeterProps) {
  return (
    prev.left === next.left &&
    prev.right === next.right &&
    prev.peak === next.peak &&
    prev.peakLeft === next.peakLeft &&
    prev.peakRight === next.peakRight &&
    prev.clip === next.clip &&
    prev.showPeakReadout === next.showPeakReadout &&
    prev.showReadout === next.showReadout &&
    prev.showScale === next.showScale
  );
}

export const AudioStereoMeter = memo(AudioStereoMeterImpl, arePropsEqual);
