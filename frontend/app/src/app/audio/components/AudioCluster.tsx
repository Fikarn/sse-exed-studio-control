import { useMemo } from "react";
import type { ShellStore } from "@sse/engine-client";
import { Key, Latch, LatchSlot, MenuButton, StateDisplay, type MenuEntry, type UseArmResult } from "@sse/design-system";

import styles from "./AudioCluster.module.css";
import type { AudioArmedAction } from "../audioArming";
import { audioDeskLockReason, audioLatches, audioWayOut } from "../audioLatches";
import { type AudioControlDraftStore } from "../audioControlDraftStore";
import { type AudioFeedbackTone } from "../audioFormatting";
import type { AudioLoadReport } from "../audioLoadReport";
import type { AudioWorkspaceViewModel } from "../audioViewModel";
import { AudioOutputs } from "./AudioOutputs";
import { AudioSnapshotKeys } from "./AudioSnapshotKeys";

// The Console's cluster, the fixed left column the operator's hand learns once
// (visual overhaul, the Console). The state display is first and never moves,
// with the page's ⋯ holding the Console's standing commands; the latch slot
// under it; then the outputs block (DIM, MONO and the three outputs, graft 1)
// and TotalMix's eight snapshots. What the last load read back, or a message
// from the last action, stands at the column's foot, so nothing above it ever
// moves and the bay never shrinks. Arming renders in the display and on the
// key (finding C1).

type AudioMixTargetUpdate = Parameters<ShellStore["updateAudioMixTarget"]>[0];

export interface AudioClusterFeedback {
  message: string;
  tone: AudioFeedbackTone;
}

export interface AudioClusterProps {
  arm: UseArmResult;
  armedAction: AudioArmedAction | null;
  busyAction: string | null;
  clearDraftValueLater: (key: string, delayMs?: number) => void;
  commitMixTargetContinuous: (request: AudioMixTargetUpdate) => void;
  draftStore: AudioControlDraftStore;
  feedback: AudioClusterFeedback | null;
  getDraftValue: (key: string, fallback: number) => number;
  loadReport: AudioLoadReport | null;
  onClearAllSolo: () => void;
  onClearClips: () => void;
  onDismissLoadReport: () => void;
  onLoadSnapshot: (slot: number) => void;
  onOpenSetup: () => void;
  onResetPeakHolds: () => void;
  onRunAudioProbe: () => void;
  onSelectMixTarget: (mixTargetId: string) => void;
  onShowOutput: (mixTargetId: string) => void;
  onSync: () => void;
  onTogglePeakHold: () => void;
  onUpdateMixTarget: (request: AudioMixTargetUpdate) => void;
  peakHoldEnabled: boolean;
  setDraftValue: (key: string, value: number) => void;
  viewModel: AudioWorkspaceViewModel;
}

/**
 * The words of the state display's armed row. A strip menu's "Turn 48 V off…"
 * arms `menu:phantom:<channel>:false` with its own words; the row names the
 * channel, as the strip's 48 V key does.
 */
function armedRowWords(armed: AudioArmedAction, viewModel: AudioWorkspaceViewModel) {
  const menuPhantom = /^menu:phantom:(.+):(true|false)$/.exec(armed.key);
  if (menuPhantom) {
    const channel = viewModel.channels.find((entry) => entry.id === menuPhantom[1]);
    const on = menuPhantom[2] === "true";
    return `Turn 48 V ${on ? "on" : "off"}${channel ? ` on ${channel.name}` : ""}`;
  }
  return armed.label;
}

export function AudioCluster({
  arm,
  armedAction,
  busyAction,
  clearDraftValueLater,
  commitMixTargetContinuous,
  draftStore,
  feedback,
  getDraftValue,
  loadReport,
  onClearAllSolo,
  onClearClips,
  onDismissLoadReport,
  onLoadSnapshot,
  onOpenSetup,
  onResetPeakHolds,
  onRunAudioProbe,
  onSelectMixTarget,
  onShowOutput,
  onSync,
  onTogglePeakHold,
  onUpdateMixTarget,
  peakHoldEnabled,
  setDraftValue,
  viewModel,
}: AudioClusterProps) {
  const status = viewModel.status;
  const snapshot = viewModel.audioSnapshot;
  const consoleLink = snapshot.consoleLink;

  // The meta line: the engine's own counts. Never a count the snapshot does
  // not carry (non-negotiable 4). The visual overhaul's polish (2026-10-05, the
  // owner's rule: beside a way-out key the meta holds about 30 characters).
  // Old: "12 values confirmed · 3 unconfirmed · last sync 23 Apr 2026, 18:24".
  // New: "12 values confirmed", or "12 confirmed · 3 unconfirmed". Reason: the
  // footer prints the last sync whole, and the second count says what the
  // first counts.
  const meta = useMemo(() => {
    const confirmed = typeof consoleLink?.confirmedSends === "number" ? consoleLink.confirmedSends : null;
    const unconfirmed = typeof consoleLink?.unconfirmedSends === "number" ? consoleLink.unconfirmedSends : 0;
    if (unconfirmed > 0) {
      return confirmed === null
        ? `${unconfirmed} values unconfirmed`
        : `${confirmed} confirmed · ${unconfirmed} unconfirmed`;
    }
    return confirmed === null ? undefined : `${confirmed} values confirmed`;
  }, [consoleLink?.confirmedSends, consoleLink?.unconfirmedSends]);

  const wayOut = audioWayOut(status.label);
  const stateActions = (
    <>
      {wayOut === "probe" ? (
        <Key mode="primary" size="small" testId="audio-state-probe" onClick={onRunAudioProbe}>
          Run audio probe
        </Key>
      ) : null}
      {wayOut === "sync" ? (
        <Key mode="primary" size="small" testId="audio-state-sync" onClick={onSync}>
          Sync from TotalMix
        </Key>
      ) : null}
      {wayOut === "setup" ? (
        <Key mode="primary" size="small" testId="audio-state-setup" onClick={onOpenSetup}>
          Open Setup
        </Key>
      ) : null}
      {wayOut === "failed" ? (
        // ACTION FAILED clears when the next action succeeds, so the way out is
        // the action itself. A "Dismiss" key would claim to clear an engine
        // state the front-end cannot clear (non-negotiable 4).
        <Key mode="primary" size="small" testId="audio-state-sync" onClick={onSync}>
          Sync from TotalMix
        </Key>
      ) : null}
    </>
  );

  // The page's ⋯ (the shell, overhaul 3): the Console's standing commands. Since
  // the Console's own pull request it is their only home; the items keep the
  // test ids the standing keys had.
  const syncLocked = !viewModel.capabilities.canSync
    ? "TotalMix cannot be read now"
    : busyAction === "audio-sync"
      ? "a sync is running"
      : null;
  const clearClipsLocked = !viewModel.capabilities.canClearClips
    ? "OSC control is off"
    : viewModel.healthStats.clippedChannels === 0
      ? "no clip held"
      : null;
  const pageMenu: MenuEntry[] = [
    {
      id: "sync",
      label: "Sync from TotalMix",
      onSelect: onSync,
      disabledReason: syncLocked,
      testId: "audio-topbar-sync",
    },
    { id: "probe", label: "Run audio probe", onSelect: onRunAudioProbe, testId: "audio-topbar-probe" },
    {
      id: "clear-clips",
      label: "Clear clips",
      onSelect: () => onClearClips(),
      disabledReason: clearClipsLocked,
      testId: "audio-clear-clips",
    },
    { kind: "divider", id: "meters" },
    {
      kind: "check",
      id: "peak-hold",
      label: "Peak hold",
      checked: peakHoldEnabled,
      onCheckedChange: () => onTogglePeakHold(),
      testId: "audio-peak-hold-toggle",
    },
    { id: "reset-peaks", label: "Reset peaks", onSelect: onResetPeakHolds, testId: "audio-peak-hold-reset" },
    { kind: "divider", id: "setup-divider" },
    { id: "setup", label: "Open Setup", onSelect: onOpenSetup, testId: "audio-topbar-setup" },
  ];
  // Slice 8 (system §9): the desk's fault code is its own field, so nothing
  // leads a sentence with it. The state display puts it in its small slot; the
  // locked reasons and tooltips read the sentence alone.
  const failureCode = status.warningCode ?? undefined;
  const stateSentence = status.warningBody ?? viewModel.appSummary;
  // Why a refused key is locked, in the desk's own words: the outputs' and the
  // snapshot keys' reason, and since the visual overhaul's polish (2026-10-05)
  // the latch's Clear all's.
  const deskLockReason = audioDeskLockReason(status);
  // The latches, as the Overview shows them too (`audioLatches`, D47).
  const latches = audioLatches(viewModel);
  const solo = latches.find((latch) => latch.id === "solo");
  const clip = latches.find((latch) => latch.id === "clip");

  return (
    <div
      className={styles.cluster}
      data-testid="audio-monitor-bar"
      data-audio-cluster=""
      data-canvas-metering={viewModel.meterSimulationState === "gated" ? "false" : "true"}
    >
      <StateDisplay
        tone={status.tone}
        word={status.label}
        sentence={stateSentence}
        code={failureCode}
        meta={meta}
        actions={stateActions}
        armed={
          armedAction
            ? {
                text: `${armedRowWords(armedAction, viewModel)} · press again to apply`,
                timeoutMs: armedAction.timeoutMs,
                armedAt: armedAction.armedAt,
              }
            : null
        }
        testId="audio-state-display"
        menu={
          <MenuButton
            buttonLabel="Audio menu"
            buttonTestId="audio-page-menu"
            menu={{ head: { title: "Audio" }, items: pageMenu, arm }}
          />
        }
      />

      {/* The shell (overhaul 3): the latch slot, the same on every page. Solo
          and a clip stand side by side in it; nothing above or between the
          keys. The visual overhaul's polish (2026-10-05): a refused Clear is
          locked (dashed, 55 %, its reason on hover) like every key the desk
          refuses, not disabled, which is the busy form. */}
      <LatchSlot testId="audio-latch-slot">
        {solo ? (
          <Latch
            who={solo.who}
            action={
              <Key
                size="small"
                testId="audio-topbar-solo"
                aria-label={solo.clear.ariaLabel}
                onClick={onClearAllSolo}
                locked={solo.clear.locked}
                reason={solo.clear.reason}
              >
                {solo.clear.label}
              </Key>
            }
            testId="audio-solo-warning-band"
          >
            {solo.text}
          </Latch>
        ) : null}

        {clip ? (
          <Latch
            who={clip.who}
            action={
              <Key
                size="small"
                testId="audio-clip-clear-clips"
                aria-label={clip.clear.ariaLabel}
                onClick={() => onClearClips()}
                locked={clip.clear.locked}
                reason={clip.clear.reason}
              >
                {clip.clear.label}
              </Key>
            }
            testId="audio-clip-warning-band"
          >
            {clip.text}
          </Latch>
        ) : null}
      </LatchSlot>

      <AudioOutputs
        arm={arm}
        clearDraftValueLater={clearDraftValueLater}
        commitMixTargetContinuous={commitMixTargetContinuous}
        draftStore={draftStore}
        getDraftValue={getDraftValue}
        onResetPeakHolds={onResetPeakHolds}
        onSelectMixTarget={onSelectMixTarget}
        onShowOutput={onShowOutput}
        onUpdateMixTarget={onUpdateMixTarget}
        setDraftValue={setDraftValue}
        viewModel={viewModel}
      />

      <AudioSnapshotKeys
        actionsAllowed={viewModel.capabilities.canRecallConsoleSnapshot}
        lockedReason={deskLockReason}
        armedActionKey={armedAction?.key ?? null}
        busyAction={busyAction}
        onLoadSnapshot={onLoadSnapshot}
        slots={viewModel.consoleSnapshots}
        source={viewModel.consoleSnapshotSource}
      />

      {/* 2026-10-01: a TotalMix snapshot load says what the read-back brought,
          or, when the read-back failed after the load went out, the hardware
          link's sentence. The column's foot is its home, so it pushes nothing. */}
      <div className={styles.foot}>
        {loadReport ? (
          <div
            className={styles.notice}
            data-tone={loadReport.readBack ? "ok" : "attention"}
            data-testid="audio-load-report"
            role="status"
          >
            <span className={styles.noticeText}>
              <strong>
                {loadReport.readBack ? "Loaded" : "Sent"} {loadReport.name} {loadReport.readBack ? "in" : "to"} TotalMix
              </strong>
              <span>{loadReport.line}</span>
            </span>
            <Key
              size="small"
              testId="audio-load-report-dismiss"
              aria-label="Dismiss load report"
              onClick={onDismissLoadReport}
            >
              Dismiss
            </Key>
          </div>
        ) : null}
        {feedback ? (
          <div className={styles.notice} data-tone={feedback.tone} data-testid="audio-feedback" role="status">
            <span className={styles.noticeText}>{feedback.message}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
