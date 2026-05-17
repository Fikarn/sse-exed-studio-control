import { Clock3, Gauge, Radio, ShieldCheck, TimerReset } from "lucide-react";

import styles from "../AudioWorkspace.module.css";
import { formatAudioTimestamp } from "../audioFormatting";
import type { AudioWorkspaceViewModel } from "../audioViewModel";

export function AudioHealthBar({ viewModel }: { viewModel: AudioWorkspaceViewModel }) {
  const snapshot = viewModel.audioSnapshot;

  return (
    <footer className={styles.healthBar} data-testid="audio-health-bar">
      <div className={styles.healthTelemetry} data-testid="audio-footer-telemetry">
        <div className={styles.healthItem}>
          <ShieldCheck size={15} strokeWidth={1.8} aria-hidden="true" />
          <span>OSC</span>
          <strong>{viewModel.status.label}</strong>
        </div>
        <div className={styles.healthItem}>
          <Radio size={15} strokeWidth={1.8} aria-hidden="true" />
          <span>Endpoint</span>
          <strong>{viewModel.footerTelemetry.endpoint}</strong>
        </div>
        <div className={styles.healthItem}>
          <Gauge size={15} strokeWidth={1.8} aria-hidden="true" />
          <span>Metering</span>
          <strong>{viewModel.footerTelemetry.metering}</strong>
        </div>
        <div className={styles.healthItem}>
          <Clock3 size={15} strokeWidth={1.8} aria-hidden="true" />
          <span>Clock</span>
          <strong>{viewModel.footerTelemetry.clock}</strong>
        </div>
        <div className={styles.healthItem}>
          <TimerReset size={15} strokeWidth={1.8} aria-hidden="true" />
          <span>Last sync</span>
          <strong>{formatAudioTimestamp(snapshot.lastConsoleSyncAt)}</strong>
        </div>
      </div>
      <div className={styles.healthShortcutGroup} data-testid="audio-footer-shortcuts">
        <span className={styles.healthCommand}>
          <kbd>⌘K</kbd>
          Command palette
        </span>
        <span className={styles.healthCommand}>
          <kbd>?</kbd>
          Shortcuts
        </span>
        <span className={styles.healthCommand}>
          <kbd>[</kbd>
          Bank prev
        </span>
        <span className={styles.healthCommand}>
          Bank next
          <kbd>]</kbd>
        </span>
      </div>
    </footer>
  );
}
