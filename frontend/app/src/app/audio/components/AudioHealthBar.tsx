import { Clock3, Command, Gauge, Keyboard, Radio, Route, ShieldCheck, TimerReset } from "lucide-react";

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
        <div className={styles.healthItem}>
          <Route size={15} strokeWidth={1.8} aria-hidden="true" />
          <span>Selected</span>
          <strong>{viewModel.selectedSourceLabel}</strong>
        </div>
      </div>
      <div className={styles.healthShortcutGroup} data-testid="audio-footer-shortcuts">
        <span className={styles.healthCommand}>
          <Command size={14} strokeWidth={1.8} aria-hidden="true" />
          Palette
        </span>
        <span className={styles.healthCommand}>
          <Keyboard size={14} strokeWidth={1.8} aria-hidden="true" />
          <kbd>[</kbd>
          <kbd>]</kbd>
          Bank
        </span>
        <span className={styles.healthShortcut}>1-8 select</span>
        <span className={styles.healthShortcut}>Shift 1-8 recall</span>
        <span className={styles.healthShortcut}>V view</span>
        <span className={styles.healthShortcut}>Alt C clips</span>
        <span className={styles.healthShortcut}>Cmd S save</span>
        <span className={styles.healthShortcut}>Esc clear</span>
      </div>
    </footer>
  );
}
