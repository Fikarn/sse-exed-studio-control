import { useMemo, type CSSProperties } from "react";
import type { ShellStore } from "@sse/engine-client";
import { Key, Latch, Meter, Readout, Section, Segmented, Slider, StateDisplay } from "@sse/design-system";

import styles from "./AudioCluster.module.css";
import { AUDIO_THROTTLE_FADER_MS } from "../audioConstants";
import { type AudioControlDraftStore, useAudioControlDraftValue } from "../audioControlDraftStore";
import { createThrottledCommit } from "../audioContinuousControls";
import { dbfsToMeterPercent, formatAudioDb, formatAudioTimestamp, meterFill } from "../audioFormatting";
import type { AudioArmedAction } from "../audioArming";
import type { AudioWorkspaceViewModel } from "../audioViewModel";
import { useMomentaryTalkback } from "../hooks/useMomentaryTalkback";
import { AudioSnapshotKeys } from "./AudioSnapshotKeys";

// Visual overhaul A, Slice 4 (plan D1, D5, D6, D8; console-a-states): the
// Console's cluster — the fixed left column the operator's hand learns once.
// The state display is first and never moves; below it the take-time keys
// (talkback, dim, mono, the mix target, the main level, the master meter),
// the snapshot keys and the standing actions. Arming renders in the display
// and on the key, so nothing else moves (finding C1).

type AudioMixTargetUpdate = Parameters<ShellStore["updateAudioMixTarget"]>[0];
type AudioTalkbackHold = Parameters<ShellStore["holdAudioTalkback"]>[0];

// The marks the mock prints under the monitor meter, in dBFS.
const MASTER_METER_MARKS = [-60, -40, -30, -18, -12, -6, 0] as const;

export interface AudioClusterProps {
  armedAction: AudioArmedAction | null;
  busyAction: string | null;
  clearDraftValueLater: (key: string, delayMs?: number) => void;
  commitMixTargetContinuous: (request: AudioMixTargetUpdate) => void;
  draftStore: AudioControlDraftStore;
  getDraftValue: (key: string, fallback: number) => number;
  onCaptureSnapshot: () => void;
  onClearAllSolo: () => void;
  onClearClips: () => void;
  onDeleteSnapshot: (snapshotId: string, snapshotName: string) => void;
  onHoldTalkback: (request: AudioTalkbackHold) => void;
  onOpenSetup: () => void;
  onRecallSnapshot: (snapshotId: string) => void;
  onRenameSnapshot: (snapshotId: string, snapshotName: string) => void;
  onRunAudioProbe: () => void;
  onSaveSnapshot: (snapshotId: string) => void;
  onSelectMixTarget: (mixTargetId: string) => void;
  onSync: () => void;
  onUpdateMixTarget: (request: AudioMixTargetUpdate) => void;
  recentlyRecalledSnapshotId: string | null;
  setDraftValue: (key: string, value: number) => void;
  viewModel: AudioWorkspaceViewModel;
}

/** The way out of the state the engine reports, and the words on its key. */
function wayOutFor(label: string): "probe" | "sync" | "setup" | "failed" | null {
  switch (label) {
    case "NOT VERIFIED":
    case "STALE":
    case "OFFLINE":
    case "DISCONNECTED":
      return "probe";
    case "ASSUMED":
      return "sync";
    case "DISABLED":
      return "setup";
    case "ACTION FAILED":
      return "failed";
    default:
      return null;
  }
}

export function AudioCluster({
  armedAction,
  busyAction,
  clearDraftValueLater,
  commitMixTargetContinuous,
  draftStore,
  getDraftValue,
  onCaptureSnapshot,
  onClearAllSolo,
  onClearClips,
  onDeleteSnapshot,
  onHoldTalkback,
  onOpenSetup,
  onRecallSnapshot,
  onRenameSnapshot,
  onRunAudioProbe,
  onSaveSnapshot,
  onSelectMixTarget,
  onSync,
  onUpdateMixTarget,
  recentlyRecalledSnapshotId,
  setDraftValue,
  viewModel,
}: AudioClusterProps) {
  const status = viewModel.status;
  const snapshot = viewModel.audioSnapshot;
  const selectedMixTarget = viewModel.selectedMixTarget ?? viewModel.mixTargets[0] ?? null;
  const actionsAllowed = viewModel.actionsAllowed;
  const consoleLink = snapshot.consoleLink;

  // The meta line: the engine's own counts and the time it last confirmed
  // them. Never a count the snapshot does not carry (non-negotiable 4).
  const meta = useMemo(() => {
    const parts: string[] = [];
    if (typeof consoleLink?.confirmedSends === "number") {
      parts.push(`${consoleLink.confirmedSends} values confirmed`);
    }
    if (typeof consoleLink?.unconfirmedSends === "number" && consoleLink.unconfirmedSends > 0) {
      parts.push(`${consoleLink.unconfirmedSends} unconfirmed`);
    }
    parts.push(`last sync ${formatAudioTimestamp(snapshot.lastConsoleSyncAt)}`);
    return parts.join(" · ");
  }, [consoleLink?.confirmedSends, consoleLink?.unconfirmedSends, snapshot.lastConsoleSyncAt]);

  const wayOut = wayOutFor(status.label);
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

  // Talkback is a hold, never a toggle (2026-09 audit Slice 6): the hook owns
  // engage / heartbeat / release for the key and for the page-wide T key.
  const talkback = useMomentaryTalkback({
    enabled: Boolean(selectedMixTarget) && actionsAllowed,
    hold: (engaged) => {
      if (selectedMixTarget) onHoldTalkback({ mixTargetId: selectedMixTarget.id, engaged });
    },
  });
  const talkbackRefused = String(snapshot.lastActionCode ?? "") === "AUDIO_TALKBACK_REFUSED";

  const volumeDraftKey = `mixTarget:${selectedMixTarget?.id ?? "none"}:volume`;
  const volume = useAudioControlDraftValue(
    draftStore,
    volumeDraftKey,
    getDraftValue(volumeDraftKey, selectedMixTarget?.volume ?? 0)
  );
  const throttledVolumeCommit = useMemo(
    () => createThrottledCommit<AudioMixTargetUpdate>(commitMixTargetContinuous, AUDIO_THROTTLE_FADER_MS),
    [commitMixTargetContinuous]
  );

  const lockedReason = actionsAllowed ? undefined : (status.warningBody ?? `The console is ${status.label}.`);
  // The state display carries the fault code in its own slot, so the sentence
  // says what happened in words first. `warningBody` still leads with the code
  // for the places that have nowhere else to put it (tooltips, the monitor
  // strip's detail), so strip the prefix only here.
  const failureCode = status.label === "ACTION FAILED" ? (snapshot.lastActionCode ?? undefined) : undefined;
  const codePrefix = typeof failureCode === "string" ? `${failureCode} · ` : null;
  const stateSentence =
    codePrefix && status.warningBody?.startsWith(codePrefix)
      ? status.warningBody.slice(codePrefix.length)
      : (status.warningBody ?? viewModel.appSummary);
  const meterEmpty = viewModel.meterSimulationState === "gated";
  const meterStale = String(snapshot.meteringState ?? "").toLowerCase() === "stale";

  return (
    <div className={styles.cluster} data-testid="audio-monitor-bar" data-audio-cluster="">
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
                text: `${armedAction.label} · press again to apply · Esc cancels`,
                timeoutMs: armedAction.timeoutMs,
              }
            : null
        }
        testId="audio-state-display"
      />

      {viewModel.soloedChannels.length > 0 ? (
        <Latch
          who={`${viewModel.soloedChannels.length} solo engaged`}
          action={
            <Key size="small" testId="audio-topbar-solo" onClick={onClearAllSolo} disabled={!actionsAllowed}>
              Clear all solo
            </Key>
          }
          testId="audio-solo-warning-band"
        >
          on {viewModel.soloedChannels.map((channel) => channel.name).join(", ")}
        </Latch>
      ) : null}

      {viewModel.healthStats.clippedChannels > 0 ? (
        <Latch
          who={`${viewModel.healthStats.clippedChannels} channels clipped`}
          action={
            <Key
              size="small"
              testId="audio-clip-clear-clips"
              aria-label="Clear clips"
              onClick={onClearClips}
              disabled={!viewModel.capabilities.canClearClips}
            >
              Clear clips
            </Key>
          }
          testId="audio-clip-warning-band"
        >
          over 0 dBFS
        </Latch>
      ) : null}

      <div className={styles.monitorRow}>
        <Key
          mode="momentary"
          cap="Talkback"
          hint={talkbackRefused ? "refused · no talkback channel in TotalMix" : "Hold · T"}
          layout="stack"
          size="tall"
          live={selectedMixTarget?.talkback ?? false}
          locked={!actionsAllowed}
          reason={lockedReason}
          take
          testId="audio-monitor-talkback"
          className={talkbackRefused ? styles.refused : undefined}
          aria-pressed={selectedMixTarget?.talkback ?? false}
          data-active={selectedMixTarget?.talkback ?? false}
          data-control="talk"
          data-holding={talkback.holding ? "true" : undefined}
          title="Hold to talk to the monitor output; release to stop. Or hold T."
          {...talkback.buttonProps}
        />
        <div className={styles.monitorToggles}>
          <Key
            mode="toggle"
            cap="Dim"
            hint="−20"
            engaged={selectedMixTarget?.dim ?? false}
            locked={!actionsAllowed}
            reason={lockedReason}
            take
            testId="audio-monitor-dim"
            data-active={selectedMixTarget?.dim ?? false}
            data-control="dim"
            onClick={() =>
              selectedMixTarget && onUpdateMixTarget({ mixTargetId: selectedMixTarget.id, dim: !selectedMixTarget.dim })
            }
          />
          <Key
            mode="toggle"
            cap="Mono"
            hint="L+R"
            engaged={selectedMixTarget?.mono ?? false}
            locked={!actionsAllowed}
            reason={lockedReason}
            take
            testId="audio-monitor-mono"
            data-active={selectedMixTarget?.mono ?? false}
            data-control="mono"
            onClick={() =>
              selectedMixTarget &&
              onUpdateMixTarget({ mixTargetId: selectedMixTarget.id, mono: !selectedMixTarget.mono })
            }
          />
        </div>
      </div>

      <span className={styles.mixTargetCaption}>Mix target · faders set sends into</span>
      <Segmented label="Mix target" testId="audio-mix-target-group">
        {viewModel.mixTargets.map((mixTarget) => (
          <Key
            key={mixTarget.id}
            mode="segmented"
            cap={mixTarget.name}
            engaged={mixTarget.id === viewModel.selectedMixTargetId}
            locked={!actionsAllowed}
            reason={lockedReason}
            take
            testId={`audio-mix-target-${mixTarget.id}`}
            aria-pressed={mixTarget.id === viewModel.selectedMixTargetId}
            onClick={() => onSelectMixTarget(mixTarget.id)}
          />
        ))}
      </Segmented>

      <section className={styles.mainLevel} aria-label="Main level">
        <div className={styles.mainLevelHead}>
          <span className={styles.mainLevelLabel}>{selectedMixTarget?.name ?? "Main Out"}</span>
          <span className={styles.mainLevelHint}>monitor level</span>
        </div>
        <Readout
          value={selectedMixTarget ? formatAudioDb(selectedMixTarget.volume) : "—"}
          size="hero"
          testId="audio-main-level"
        />
        <Slider
          label={`${selectedMixTarget?.name ?? "Main Out"} output level`}
          value={volume}
          unity={0.8172}
          locked={!actionsAllowed || !selectedMixTarget}
          take
          valueText={selectedMixTarget ? formatAudioDb(volume) : undefined}
          testId="audio-main-level-slider"
          onChange={(value) => {
            if (!selectedMixTarget) return;
            setDraftValue(volumeDraftKey, value);
            throttledVolumeCommit.schedule({ mixTargetId: selectedMixTarget.id, volume: value });
          }}
          onCommit={(value) => {
            if (!selectedMixTarget) return;
            setDraftValue(volumeDraftKey, value);
            throttledVolumeCommit.schedule({ mixTargetId: selectedMixTarget.id, volume: value });
            throttledVolumeCommit.flush();
            clearDraftValueLater(volumeDraftKey);
          }}
        />
        <Meter
          label={`Monitor output meter — ${selectedMixTarget?.name ?? "Main Out"}`}
          level={meterFill(selectedMixTarget?.meterLeft ?? 0)}
          levelRight={meterFill(
            selectedMixTarget
              ? selectedMixTarget.mono
                ? selectedMixTarget.meterLeft
                : selectedMixTarget.meterRight
              : 0
          )}
          peak={meterFill(selectedMixTarget?.peakHoldLeft ?? 0)}
          peakRight={meterFill(selectedMixTarget?.peakHoldRight ?? 0)}
          orientation="horizontal"
          empty={meterEmpty}
          stale={meterStale}
          meterId={selectedMixTarget?.id}
          meterKind="mixTarget"
          className={styles.masterMeter}
          testId="audio-monitor-master-meter"
          style={{ "--master-meter-height": "24px" } as CSSProperties}
        />
        {/* The scale the operator reads the bar against — the same dBFS marks
            the strip meters carry, placed where the mock puts them. */}
        <div className={styles.masterMeterScale} aria-hidden="true">
          {MASTER_METER_MARKS.map((mark) => (
            <span key={mark} style={{ left: `${dbfsToMeterPercent(mark)}%` }}>
              {mark}
            </span>
          ))}
        </div>
      </section>

      <AudioSnapshotKeys
        actionsAllowed={viewModel.capabilities.canCaptureSnapshot}
        channels={viewModel.channels}
        mixTargets={viewModel.mixTargets}
        selectedMixTargetId={viewModel.selectedMixTargetId}
        armedActionKey={armedAction?.key ?? null}
        busyAction={busyAction}
        onCaptureSnapshot={onCaptureSnapshot}
        onDeleteSnapshot={onDeleteSnapshot}
        onRecallSnapshot={onRecallSnapshot}
        onRenameSnapshot={onRenameSnapshot}
        onSaveSnapshot={onSaveSnapshot}
        recentlyRecalledSnapshotId={recentlyRecalledSnapshotId}
        snapshots={viewModel.snapshots}
      />

      <Section title="Console" className={styles.actions} testId="audio-standing-actions">
        <div className={styles.actionRow}>
          <Key
            size="small"
            testId="audio-topbar-sync"
            onClick={onSync}
            disabled={!viewModel.capabilities.canSync || busyAction === "audio-sync"}
          >
            Sync from TotalMix
          </Key>
          <Key size="small" testId="audio-topbar-probe" onClick={onRunAudioProbe}>
            Run audio probe
          </Key>
          <Key
            size="small"
            testId="audio-clear-clips"
            onClick={onClearClips}
            disabled={!viewModel.capabilities.canClearClips}
          >
            Clear clips
          </Key>
          <Key size="small" testId="audio-topbar-setup" onClick={onOpenSetup}>
            Open Setup
          </Key>
        </div>
      </Section>
    </div>
  );
}
