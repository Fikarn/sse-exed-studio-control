import { useEffect, type MouseEvent as ReactMouseEvent } from "react";
import type { ShellStore } from "@sse/engine-client";

import styles from "./AudioSignalCanvas.module.css";
import type { AudioArmedAction } from "../audioArming";
import type { AudioLoadReport } from "../audioLoadReport";
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
  onNextBank,
  onOpenChannelMenu,
  onPreviousBank,
  loadReport,
  onDismissLoadReport,
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
  onNextBank: () => void;
  onOpenChannelMenu: (event: ReactMouseEvent<HTMLElement>, channelId: string) => void;
  onPreviousBank: () => void;
  loadReport: AudioLoadReport | null;
  onDismissLoadReport: () => void;
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
    <section className={styles.signalCanvas} data-testid="audio-signal-canvas" data-signal="canvas">
      {/* Visual overhaul A, Slice 4: the state, its sentence and its way out
          live in the cluster's state display, so the bay carries no band. */}
      {/* 2026-10-01: a TotalMix snapshot load says what the read-back
          brought, or, when the read-back failed after the load went out, the
          hardware link's sentence. 48 V does not switch with a TotalMix
          snapshot, so the band has nothing to arm. */}
      {loadReport ? (
        <div
          className={styles.warningBand}
          data-variant="compact"
          data-tone={loadReport.readBack ? "ok" : "attention"}
          data-testid="audio-load-report"
          role="status"
        >
          <strong>
            {loadReport.readBack ? "Loaded" : "Sent"} {loadReport.name} {loadReport.readBack ? "in" : "to"} TotalMix
          </strong>
          <span>{loadReport.line}</span>
          <span className={styles.warningRecoveryActions}>
            <button
              aria-label="Dismiss load report"
              data-testid="audio-load-report-dismiss"
              onClick={onDismissLoadReport}
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
        onNextBank={onNextBank}
        onOpenChannelMenu={onOpenChannelMenu}
        onPreviousBank={onPreviousBank}
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
