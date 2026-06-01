import type { ShellStore } from "@sse/engine-client";
import { RefreshCw, RotateCcw, Settings } from "lucide-react";

import styles from "./AudioTopBar.module.css";
import type { AudioTheme } from "../AudioWorkspace";
import type { AudioWorkspaceViewModel } from "../audioViewModel";

const THEMES: { id: AudioTheme; label: string }[] = [
  { id: "studio", label: "Studio" },
  { id: "graphite", label: "Graphite" },
  { id: "bone", label: "Bone" },
];

interface AudioTopBarProps {
  audioTheme: AudioTheme;
  onOpenSetup: () => void;
  onRecallCurrentSnapshot: () => void;
  onSelectTheme: (theme: AudioTheme) => void;
  onSync: () => void;
  viewModel: AudioWorkspaceViewModel;
  store: ShellStore;
}

export function AudioTopBar({
  audioTheme,
  onOpenSetup,
  onRecallCurrentSnapshot,
  onSelectTheme,
  onSync,
  viewModel,
}: AudioTopBarProps) {
  const currentSnapshot = viewModel.selectedSnapshot;
  const oscFact = viewModel.footerTelemetry.osc;
  const meteringFact = viewModel.meterSimulationActive ? "test simulation" : viewModel.footerTelemetry.metering;
  const consoleFact = viewModel.status.label;
  const warningTitle = viewModel.status.warningTitle;

  return (
    <header className={styles.topbar} data-testid="audio-topbar">
      <div className={styles.brand}>
        <span className={styles.brandName}>Console</span>
        <span className={styles.brandDevice}>Fireface UFX III</span>
      </div>

      <span className={styles.spacer} />

      <div className={styles.statCluster}>
        <div className={styles.statCell}>
          <span className={styles.statKey}>Console</span>
          <span className={styles.statValue}>
            <span className={styles.statDot} data-warn={Boolean(warningTitle)} aria-hidden="true" />
            {consoleFact}
          </span>
        </div>
        <div className={styles.statCell}>
          <span className={styles.statKey}>OSC</span>
          <span className={styles.statValue}>{oscFact}</span>
        </div>
        <div className={styles.statCell}>
          <span className={styles.statKey}>Metering</span>
          <span className={styles.statValue}>{meteringFact}</span>
        </div>
      </div>

      <div className={styles.snapshotPill} data-testid="audio-topbar-snapshot">
        <span className={styles.snapshotPillLabel}>Snapshot</span>
        <span className={styles.snapshotPillName}>{currentSnapshot?.name ?? "None"}</span>
      </div>

      <div className={styles.themeSwitch} role="group" aria-label="Console theme">
        {THEMES.map((theme) => (
          <button
            aria-pressed={audioTheme === theme.id}
            data-active={audioTheme === theme.id}
            data-testid={`audio-theme-${theme.id}`}
            key={theme.id}
            onClick={() => onSelectTheme(theme.id)}
            title={`${theme.label} theme`}
            type="button"
          >
            {theme.label}
          </button>
        ))}
      </div>

      <div className={styles.actionRow}>
        <button
          aria-label="Sync"
          className={styles.actionButton}
          disabled={!viewModel.capabilities.canSync}
          onClick={onSync}
          type="button"
          data-testid="audio-topbar-sync"
        >
          <RefreshCw size={13} strokeWidth={1.8} aria-hidden="true" />
          <span>Sync</span>
          {warningTitle && !viewModel.status.bannerEligible ? (
            <span
              className={styles.warnDot}
              data-testid="audio-toolbar-status-dot"
              role="status"
              title={`${warningTitle} — ${viewModel.status.warningBody ?? "press Sync to verify"}`}
              aria-label={`${warningTitle}. ${viewModel.status.warningBody ?? ""}`}
            />
          ) : null}
        </button>

        <button
          className={styles.actionButton}
          disabled={!currentSnapshot || !viewModel.actionsAllowed}
          onClick={onRecallCurrentSnapshot}
          type="button"
          data-testid="audio-topbar-recall"
          title={currentSnapshot ? `Recall ${currentSnapshot.name}` : "No snapshot selected"}
        >
          <RotateCcw size={13} strokeWidth={1.8} aria-hidden="true" />
          <span>Recall</span>
        </button>

        <button
          className={styles.actionButton}
          onClick={onOpenSetup}
          type="button"
          data-testid="audio-topbar-setup"
          title="Open Setup / Support"
          aria-label="Setup"
        >
          <Settings size={14} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
