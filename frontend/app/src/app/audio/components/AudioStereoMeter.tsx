import type { CSSProperties } from "react";

import styles from "../AudioWorkspace.module.css";
import { formatMeterDb, meterTone, normalizedToDbfs } from "../audioFormatting";

function formatPeakReadout(value: number) {
  const db = normalizedToDbfs(value);
  if (!Number.isFinite(db)) return "-∞";
  return db.toFixed(1);
}

export function AudioStereoMeter({
  clip,
  left,
  peak,
  right,
  simulated = false,
  simulationIndex = 0,
  showPeakReadout = false,
  showReadout = true,
  showScale = false,
}: {
  clip?: boolean;
  left: number;
  peak: number;
  right: number;
  simulated?: boolean;
  simulationIndex?: number;
  showPeakReadout?: boolean;
  showReadout?: boolean;
  showScale?: boolean;
}) {
  const style = {
    "--audio-meter-left": `${Math.round(Math.max(0, Math.min(1, left)) * 100)}%`,
    "--audio-meter-right": `${Math.round(Math.max(0, Math.min(1, right)) * 100)}%`,
    "--audio-meter-peak": `${Math.round(Math.max(0, Math.min(1, peak)) * 100)}%`,
    "--audio-meter-sim-duration": `${980 + (simulationIndex % 5) * 130}ms`,
    "--audio-meter-sim-delay": `${(simulationIndex % 7) * -110}ms`,
  } as CSSProperties;

  return (
    <div
      className={styles.stereoMeter}
      data-clip={clip === true}
      data-peak-readout={showPeakReadout}
      data-readout={showReadout}
      data-simulated-meter={simulated}
      style={style}
    >
      {showPeakReadout ? (
        <div className={styles.meterPeakReadout} aria-hidden="true">
          <span>{formatPeakReadout(left)}</span>
          <span>{formatPeakReadout(right)}</span>
        </div>
      ) : null}
      <div className={styles.meterPair}>
        <span className={styles.meterTrack} data-tone={meterTone(left, clip)}>
          <span className={styles.meterFill} data-meter-fill="left" data-side="left" />
          <span className={styles.meterPeak} />
        </span>
        <span className={styles.meterTrack} data-tone={meterTone(right, clip)}>
          <span className={styles.meterFill} data-meter-fill="right" data-side="right" />
          <span className={styles.meterPeak} />
        </span>
      </div>
      {showScale ? (
        <div className={styles.meterScale} aria-hidden="true">
          <span>0</span>
          <span>-6</span>
          <span>-12</span>
          <span>-24</span>
          <span>-∞</span>
        </div>
      ) : null}
      {showReadout ? <div className={styles.meterReadout}>{clip ? "CLIP" : formatMeterDb(Math.max(left, right))}</div> : null}
    </div>
  );
}
