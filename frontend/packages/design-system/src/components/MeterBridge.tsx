import type { HTMLAttributes } from "react";

import styles from "./MeterBridge.module.css";

export type MeterState = "idle" | "signal" | "hot" | "clip";

export interface MeterBridgeChannel {
  id: string;
  label: string;
  level: number;
  peak?: number;
  state?: MeterState;
  valueText?: string;
}

export interface MeterBridgeProps extends HTMLAttributes<HTMLDivElement> {
  channels: MeterBridgeChannel[];
  label: string;
}

function clampMeter(value: number) {
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function MeterBridge({ channels, className, label, ...props }: MeterBridgeProps) {
  return (
    <div aria-label={label} className={[styles.bridge, className].filter(Boolean).join(" ")} role="group" {...props}>
      {channels.map((channel) => {
        const level = clampMeter(channel.level);
        const peak = typeof channel.peak === "number" ? clampMeter(channel.peak) : undefined;
        const state = channel.state ?? (level > 92 ? "clip" : level > 78 ? "hot" : level > 2 ? "signal" : "idle");

        return (
          <div className={styles.channel} key={channel.id}>
            <div
              aria-label={channel.label}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={level}
              aria-valuetext={channel.valueText ?? `${level}%`}
              className={[styles.meter, styles[state]].join(" ")}
              role="meter"
            >
              <span className={styles.fill} style={{ transform: `scaleY(${level / 100})` }} />
              {typeof peak === "number" ? <span className={styles.peak} style={{ bottom: `${peak}%` }} /> : null}
            </div>
            <span className={styles.label}>{channel.label}</span>
          </div>
        );
      })}
    </div>
  );
}
