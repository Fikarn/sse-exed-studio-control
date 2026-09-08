import { Meter } from "@sse/design-system";

import styles from "./AudioStripFader.module.css";
import { AudioFader } from "./AudioFader";
import { faderDbToNormalized, meterFill } from "../audioFormatting";

// Visual overhaul A, Slice 4b (system §7, "Strip"): the fader block at the foot
// of every strip — the scale the operator reads the cap against, the groove
// itself, and the meter beside it. The marks are the desk's fader scale (what
// the fader is set to), not the meter's dBFS scale (what is coming back); the
// meter carries its own −18 dBFS reference line.
const FADER_SCALE_MARKS: readonly (readonly [number, string])[] = [
  [6, "+6"],
  [0, "0"],
  [-6, "-6"],
  [-12, "-12"],
  [-20, "-20"],
  [-30, "-30"],
  [-40, "-40"],
  [-60, "-60"],
];

export interface AudioStripFaderProps {
  clip?: boolean;
  disabled?: boolean;
  empty?: boolean;
  label: string;
  level: number;
  levelRight?: number;
  meterId: string;
  meterKind: "channel" | "mixTarget";
  meterLabel: string;
  onCommit: (value: number) => void;
  onPreview: (value: number) => void;
  peak?: number;
  peakRight?: number;
  stale?: boolean;
  testId?: string;
  value: number;
}

export function AudioStripFader({
  clip = false,
  disabled = false,
  empty = false,
  label,
  level,
  levelRight,
  meterId,
  meterKind,
  meterLabel,
  onCommit,
  onPreview,
  peak,
  peakRight,
  stale = false,
  testId,
  value,
}: AudioStripFaderProps) {
  return (
    <div className={styles.faderBlock}>
      <div className={styles.scale} data-fader-scale="" aria-hidden="true">
        {FADER_SCALE_MARKS.map(([db, mark]) => (
          <span
            key={mark}
            className={styles.scaleMark}
            data-fader-scale-mark={mark}
            style={{ bottom: `${(faderDbToNormalized(db) * 100).toFixed(2)}%` }}
          >
            {mark}
          </span>
        ))}
      </div>
      <AudioFader
        disabled={disabled}
        label={label}
        onCommit={onCommit}
        onPreview={onPreview}
        showValue={false}
        testId={testId}
        value={value}
      />
      <Meter
        className={styles.meter}
        clip={clip}
        empty={empty}
        label={meterLabel}
        level={meterFill(level)}
        levelRight={levelRight === undefined ? undefined : meterFill(levelRight)}
        meterId={meterId}
        meterKind={meterKind}
        peak={peak === undefined ? undefined : meterFill(peak)}
        peakRight={peakRight === undefined ? undefined : meterFill(peakRight)}
        stale={stale}
        testId={`audio-lane-meter-${meterId}`}
      />
    </div>
  );
}
