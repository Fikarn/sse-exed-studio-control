import { Clock3, TimerReset } from "lucide-react";

import styles from "../AudioWorkspace.module.css";
import { formatAudioTimestamp } from "../audioFormatting";
import type { AudioWorkspaceViewModel } from "../audioViewModel";

export function AudioHealthBar({ viewModel }: { viewModel: AudioWorkspaceViewModel }) {
  const snapshot = viewModel.audioSnapshot;

  // Why: the Trust panel in the rail is the canonical surface for OSC,
  // Endpoint, and Metering telemetry. The health bar previously duplicated
  // those rows, which made small state divergences (eg. metering chip vs rail
  // chip) read as bugs. The footer keeps the temporal facts (clock, last
  // sync) and the keyboard shortcut hints — the rail keeps the trust facts.
  return (
    <footer className={styles.healthBar} data-testid="audio-health-bar">
      <div className={styles.healthTelemetry} data-testid="audio-footer-telemetry">
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
