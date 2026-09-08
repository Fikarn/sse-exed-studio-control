import { useEffect, type MouseEvent as ReactMouseEvent } from "react";
import type { ShellStore } from "@sse/engine-client";

import styles from "./AudioSignalCanvas.module.css";
import type { AudioArmedAction } from "../audioArming";
import type { AudioRecallReport } from "../audioRecallReport";
import { type AudioControlDraftStore } from "../audioControlDraftStore";
import type { AudioChannelGroupSelectionRequest, AudioWorkspaceViewModel } from "../audioViewModel";
import { AudioTieredMixer } from "./AudioTieredMixer";

type AudioChannelUpdate = Parameters<ShellStore["updateAudioChannel"]>[0];
type AudioMixTargetUpdate = Parameters<ShellStore["updateAudioMixTarget"]>[0];

export function AudioSignalCanvas({
  armedAction,
  clearDraftValueLater,
  commitChannelContinuous,
  commitMixTargetContinuous,
  draftStore,
  getDraftValue,
  onClearClips,
  onOpenChannelMenu,
  recallReport,
  onDismissRecallReport,
  onArmPhantomFromRecall,
  onSelectChannel,
  onSelectChannelGroup,
  onSelectMixTarget: _onSelectMixTarget,
  onSelectOutputMixTarget,
  onTogglePhantom,
  setDraftValue,
  onUpdateChannel,
  onUpdateMixTarget,
  store: _store,
  viewModel,
}: {
  armedAction: AudioArmedAction | null;
  clearDraftValueLater: (key: string, delayMs?: number) => void;
  commitChannelContinuous: (request: AudioChannelUpdate) => void;
  commitMixTargetContinuous: (request: AudioMixTargetUpdate) => void;
  draftStore: AudioControlDraftStore;
  getDraftValue: (key: string, fallback: number) => number;
  onClearClips: (channelId?: string) => void;
  onOpenChannelMenu: (event: ReactMouseEvent<HTMLElement>, channelId: string) => void;
  recallReport: AudioRecallReport | null;
  onDismissRecallReport: () => void;
  onArmPhantomFromRecall: (channelId: string, channelName: string, phantom: boolean) => void;
  onSelectChannel: (channelId: string | null) => void;
  onSelectChannelGroup: (request: AudioChannelGroupSelectionRequest) => void;
  onSelectMixTarget: (mixTargetId: string) => void;
  onSelectOutputMixTarget: (mixTargetId: string) => void;
  onTogglePhantom: (request: { channelId: string; channelName: string; phantom: boolean }) => void;
  setDraftValue: (key: string, value: number) => void;
  onUpdateChannel: (request: AudioChannelUpdate) => void;
  onUpdateMixTarget: (request: AudioMixTargetUpdate) => void;
  store: ShellStore;
  viewModel: AudioWorkspaceViewModel;
}) {
  useEffect(() => {
    if (!window.__SSE_TEST_RENDER_COUNTS__) return;
    window.__SSE_TEST_RENDER_COUNTS__.audioSignalCanvas =
      (window.__SSE_TEST_RENDER_COUNTS__.audioSignalCanvas ?? 0) + 1;
  });

  return (
    <section className={styles.signalCanvas} data-testid="audio-signal-canvas">
      {/* Visual overhaul A, Slice 4: the state, its sentence and its way out
          live in the cluster's state display, so the bay carries no band. */}
      {/* 2026-09 audit remediation, Slice 4: a recall pushes the snapshot to
          the desk and says what the console confirmed. 48V is never pushed —
          each difference gets its own armed confirm right here. */}
      {recallReport ? (
        <div
          className={styles.warningBand}
          data-variant="compact"
          data-tone={recallReport.unconfirmed > 0 ? "attention" : "ok"}
          data-testid="audio-recall-report"
          role="status"
        >
          <strong>Recalled {recallReport.snapshotName}</strong>
          <span>{recallReport.summaryLine}</span>
          <span className={styles.warningRecoveryActions}>
            {recallReport.phantomDifferences.map((difference) => {
              const armKey = `phantom:${difference.channelId}:${difference.target}`;
              return (
                <button
                  data-armed={armedAction?.key === armKey ? "true" : "false"}
                  data-testid={`audio-recall-arm-phantom-${difference.channelId}`}
                  key={difference.channelId}
                  onClick={() =>
                    onArmPhantomFromRecall(difference.channelId, difference.channelName, difference.target)
                  }
                  title={`${difference.target ? "Enable" : "Disable"} 48V on ${difference.channelName} — arm, then press again to apply`}
                  type="button"
                >
                  {armedAction?.key === armKey ? "Confirm" : "Arm"} 48V {difference.target ? "on" : "off"} ·{" "}
                  {difference.channelName}
                </button>
              );
            })}
            <button
              aria-label="Dismiss recall report"
              data-testid="audio-recall-report-dismiss"
              onClick={onDismissRecallReport}
              type="button"
            >
              Dismiss
            </button>
          </span>
        </div>
      ) : null}

      {/* Visual overhaul A, Slice 4: a latched state the operator must see from
          anywhere — a solo, a clip — is a latch in the cluster, beside the
          state display, not a band on the bay floor. */}

      <AudioTieredMixer
        armedActionKey={armedAction?.key ?? null}
        clearDraftValueLater={clearDraftValueLater}
        commitChannelContinuous={commitChannelContinuous}
        commitMixTargetContinuous={commitMixTargetContinuous}
        draftStore={draftStore}
        getDraftValue={getDraftValue}
        onOpenChannelMenu={onOpenChannelMenu}
        onClearClip={onClearClips}
        onSelectChannel={onSelectChannel}
        onSelectChannelGroup={onSelectChannelGroup}
        onSelectOutputMixTarget={onSelectOutputMixTarget}
        onTogglePhantom={onTogglePhantom}
        setDraftValue={setDraftValue}
        onUpdateChannel={onUpdateChannel}
        onUpdateMixTarget={onUpdateMixTarget}
        viewModel={viewModel}
      />
    </section>
  );
}
