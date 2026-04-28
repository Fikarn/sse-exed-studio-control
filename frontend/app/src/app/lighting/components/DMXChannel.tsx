import { formatDmxValue } from "../lightingHelpers";
import { lightingPatchBarSegments } from "../lightingPatch";

import styles from "./LightingInspector.module.css";

export interface DMXChannelProps {
  channel: number;
  label: string;
  value: number;
  highlighted?: boolean;
}

const SEGMENT_COUNT = 8;

export function DMXChannel({ channel, label, value, highlighted = false }: DMXChannelProps) {
  const filledSegments = lightingPatchBarSegments(value);
  const address = String(channel).padStart(3, "0");

  return (
    <div
      className={`${styles.channelRow} ${highlighted ? styles.channelRowHighlighted : ""}`}
      role="listitem"
      title={`${label} · ${address} · ${value}`}
    >
      <span className={styles.channelAddress}>{address}</span>
      <div className={styles.channelBar} aria-hidden="true">
        {Array.from({ length: SEGMENT_COUNT }, (_, index) => (
          <span
            key={index}
            className={styles.channelSegment}
            data-active={index < filledSegments}
          />
        ))}
      </div>
      <span className={styles.channelLabel}>{label}</span>
      <span className={styles.channelValue}>{formatDmxValue(value)}</span>
    </div>
  );
}
