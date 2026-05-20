import { ChevronLeft, ChevronRight, RefreshCw, SlidersHorizontal } from "lucide-react";

import { Button, StatusBadge } from "@sse/design-system";

import styles from "../AudioWorkspace.module.css";
import { formatAudioTimestamp, type AudioDensityMode } from "../audioFormatting";
import type { AudioWorkspaceViewModel } from "../audioViewModel";
import { mapStatusBadgeTone } from "../../shellData";

export function AudioToolbar({
  busyAction,
  density,
  onPreviousBank,
  onRecallCurrentSnapshot,
  onSetDensity,
  onNextBank,
  onSync,
  viewModel,
}: {
  busyAction: string | null;
  density: AudioDensityMode;
  onPreviousBank: () => void;
  onRecallCurrentSnapshot: () => void;
  onSetDensity: (density: AudioDensityMode) => void;
  onNextBank: () => void;
  onSync: () => void;
  viewModel: AudioWorkspaceViewModel;
}) {
  return (
    <section className={styles.audioToolbar}>
      <div className={styles.toolbarIdentity}>
        <span className={styles.eyebrow}>Editing output</span>
        <h1>{viewModel.selectedMixTarget?.name ?? "Audio"}</h1>
        <p>{viewModel.appSummary}</p>
      </div>

      <div className={styles.toolbarCluster}>
        <StatusBadge label={viewModel.status.label} tone={mapStatusBadgeTone(viewModel.status.tone)} />
        <span className={styles.toolbarMeta}>
          Sync {formatAudioTimestamp(viewModel.audioSnapshot.lastConsoleSyncAt)}
        </span>
        <Button
          disabled={!viewModel.actionsAllowed || busyAction === "audio-sync"}
          onClick={onSync}
          size="compact"
          variant="secondary"
        >
          <RefreshCw size={14} strokeWidth={1.8} aria-hidden="true" />
          Sync
        </Button>
      </div>

      <div className={styles.toolbarCluster}>
        <button
          aria-label="Previous audio bank"
          className={styles.iconButton}
          disabled={viewModel.clampedBankIndex === 0}
          onClick={onPreviousBank}
          type="button"
        >
          <ChevronLeft size={16} strokeWidth={1.85} aria-hidden="true" />
        </button>
        <span className={styles.bankPill} data-testid="audio-toolbar-bank-pill">
          Bank {viewModel.clampedBankIndex + 1} / {viewModel.totalBanks}
          <small>
            {" "}
            · ch {viewModel.bankStart + 1}-
            {Math.min(viewModel.bankStart + viewModel.visibleStripCount, viewModel.channels.length)} of{" "}
            {viewModel.channels.length}
          </small>
        </span>
        <button
          aria-label="Next audio bank"
          className={styles.iconButton}
          disabled={viewModel.clampedBankIndex >= viewModel.totalBanks - 1}
          onClick={onNextBank}
          type="button"
        >
          <ChevronRight size={16} strokeWidth={1.85} aria-hidden="true" />
        </button>
      </div>

      <div className={styles.densityToggle} aria-label="Audio density">
        <SlidersHorizontal size={14} strokeWidth={1.75} aria-hidden="true" />
        <button data-active={density === "desktop"} onClick={() => onSetDensity("desktop")} type="button">
          Desktop
        </button>
        <button data-active={density === "touch"} onClick={() => onSetDensity("touch")} type="button">
          Touch
        </button>
      </div>

      <div className={styles.snapshotStatus}>
        <span className={styles.eyebrow}>Current snapshot</span>
        <span className={styles.snapshotStatusName} data-testid="audio-toolbar-current-snapshot">
          {viewModel.selectedSnapshot ? `Recalled ${viewModel.selectedSnapshot.name}` : "No recall yet"}
        </span>
        <Button
          disabled={!viewModel.selectedSnapshot || !viewModel.actionsAllowed || busyAction === "audio-current-snapshot"}
          onClick={onRecallCurrentSnapshot}
          size="compact"
          variant="primary"
        >
          Recall
        </Button>
      </div>
    </section>
  );
}
