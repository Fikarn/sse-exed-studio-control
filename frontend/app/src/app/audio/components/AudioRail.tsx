import { useEffect, type CSSProperties } from "react";
import type { ShellStore } from "@sse/engine-client";
import { RefreshCw, RotateCcw, Settings } from "lucide-react";

import styles from "./AudioRail.module.css";
import { PROTOTYPE_MONITOR_LEVEL_DB } from "../audioConstants";
import { type AudioControlDraftStore, useAudioControlDraftValue } from "../audioControlDraftStore";
import { faderDbToNormalized, formatAudioDb, formatAudioTimestamp, formatMeterPercent } from "../audioFormatting";
import type { AudioWorkspaceViewModel } from "../audioViewModel";
import { AudioHardwareReadout } from "./AudioHardwareReadout";
import { AudioLiveMasterHalo } from "./AudioLiveMeterReadout";
import { AudioSliderControl } from "./AudioSliderControl";

type AudioMixTargetUpdate = Parameters<ShellStore["updateAudioMixTarget"]>[0];

function mixTargetMeta(role: string, talkback: boolean) {
  if (role === "main-out") return "Monitor · stereo";
  if (role === "phones-a") return talkback ? "Cue A · talk" : "Cue A";
  if (role === "phones-b") return "Cue B";
  return "Stereo";
}

const PROTOTYPE_MONITOR_LEVEL = faderDbToNormalized(PROTOTYPE_MONITOR_LEVEL_DB);

function compactPortRange(start: string, end: string) {
  const compactEnd = start.length === end.length && start.slice(0, -2) === end.slice(0, -2) ? end.slice(-2) : end;
  return `${start}-${compactEnd}`;
}

function compactRailEndpoint(value: string) {
  return value
    .replace(/\brecv\s+(\d+)-(\d+)\b/gi, (_match, start: string, end: string) => `rx ${compactPortRange(start, end)}`)
    .replace(/\bsend\s+(\d+)-(\d+)\b/gi, (_match, start: string, end: string) => `tx ${compactPortRange(start, end)}`);
}

export function AudioRail({
  clearDraftValueLater,
  commitMixTargetContinuous,
  draftStore,
  getDraftValue,
  onRecallCurrentSnapshot,
  onOpenSetup,
  onSync,
  onSelectMixTarget,
  store,
  setDraftValue,
  onUpdateMixTarget,
  viewModel,
}: {
  clearDraftValueLater: (key: string, delayMs?: number) => void;
  commitMixTargetContinuous: (request: AudioMixTargetUpdate) => void;
  draftStore: AudioControlDraftStore;
  getDraftValue: (key: string, fallback: number) => number;
  onRecallCurrentSnapshot: () => void;
  onOpenSetup: () => void;
  onSync: () => void;
  onSelectMixTarget: (mixTargetId: string) => void;
  store: ShellStore;
  setDraftValue: (key: string, value: number) => void;
  onUpdateMixTarget: (request: AudioMixTargetUpdate) => void;
  viewModel: AudioWorkspaceViewModel;
}) {
  useEffect(() => {
    if (!window.__SSE_TEST_RENDER_COUNTS__) return;
    window.__SSE_TEST_RENDER_COUNTS__.audioRail = (window.__SSE_TEST_RENDER_COUNTS__.audioRail ?? 0) + 1;
  });

  const selectedMixTarget = viewModel.selectedMixTarget;
  const monitorDraftKey = selectedMixTarget
    ? `mixTarget:${selectedMixTarget.id}:rail-volume`
    : "mixTarget:none:rail-volume";
  const monitorValue = useAudioControlDraftValue(
    draftStore,
    monitorDraftKey,
    getDraftValue(monitorDraftKey, selectedMixTarget?.volume ?? PROTOTYPE_MONITOR_LEVEL)
  );
  const currentSnapshot = viewModel.selectedSnapshot;
  const populatedSnapshotCount = viewModel.snapshots.length;
  const fullEndpoint = viewModel.footerTelemetry.endpoint;
  const compactEndpoint = compactRailEndpoint(fullEndpoint);

  return (
    <aside className={styles.audioRail}>
      <div className={`${styles.railPanel} ${styles.railMonitorCard}`} data-testid="audio-rail-monitor-card">
        <AudioLiveMasterHalo
          fallbackLeft={viewModel.activeMixReadout.meterLeft}
          fallbackRight={viewModel.activeMixReadout.meterRight}
          mixTargetId={viewModel.selectedMixTargetId}
          store={store}
        />
        <div className={styles.monitorCardStatus}>
          <span className={styles.statusDot} />
          {/* The Phase 3 Slice 0 plan called for restructuring this line into a
              <small> suffix chip. On inspection the visible "Active mix-28"
              defect lived in AudioLiveMeterReadout.module.css's canvas overlay
              grid, not here — the fix landed there in commit 32a5815. This
              line is intentionally simple; if a future polish pass adds a
              data-driven suffix to the eyebrow, route it through a separate
              <small> chip per the original Slice 0 intent. (C9) */}
          <span>{viewModel.meterSimulationActive ? "Active mix · test meters" : "Active mix · live"}</span>
        </div>
        <div className={styles.railHeader}>
          <div>
            <h2>
              {selectedMixTarget?.name ?? "Main Out"}
              <span className={styles.railCaret} aria-hidden="true">
                ˅
              </span>
            </h2>
          </div>
        </div>

        <div className={styles.monitorMeta}>Stereo monitor · 24-bit / 48 kHz</div>

        <div className={styles.mixTargetList}>
          {viewModel.mixTargets.map((mixTarget) => {
            // Why: hoist the percent computation out of an IIFE in the JSX
            // body so the React Compiler can optimise the render. The values
            // are only consumed once each, but extracting them keeps the
            // markup readable and silences `@eslint-react/unsupported-syntax`.
            const leftPercent = Math.round(
              Math.min(100, Math.max(0, Number(formatMeterPercent(mixTarget.meterLeft).replace("%", ""))))
            );
            const rightSourceValue = mixTarget.mono ? mixTarget.meterLeft : mixTarget.meterRight;
            const rightPercent = Math.round(
              Math.min(100, Math.max(0, Number(formatMeterPercent(rightSourceValue).replace("%", ""))))
            );
            return (
              <button
                className={styles.mixTargetButton}
                data-role={mixTarget.role}
                data-selected={mixTarget.id === viewModel.selectedMixTargetId}
                data-testid={`audio-mix-target-${mixTarget.id}`}
                key={mixTarget.id}
                onClick={() => onSelectMixTarget(mixTarget.id)}
                type="button"
              >
                <span className={styles.mixTargetStripe} aria-hidden="true" />
                <span className={styles.mixTargetCopy}>
                  <span className={styles.mixTargetName}>{mixTarget.name}</span>
                  <span className={styles.mixTargetMeta}>{mixTargetMeta(mixTarget.role, mixTarget.talkback)}</span>
                </span>
                <span className={styles.mixTargetMiniMeter}>
                  <i
                    aria-label={`${mixTarget.name} L meter ${leftPercent}%`}
                    aria-valuemax={100}
                    aria-valuemin={0}
                    aria-valuenow={leftPercent}
                    data-mini-meter-id={mixTarget.id}
                    data-mini-meter-kind="mixTarget"
                    data-mini-meter-side="left"
                    role="meter"
                    style={{ "--meter-level": `${leftPercent}%` } as CSSProperties}
                  />
                  <i
                    aria-label={`${mixTarget.name} R meter ${rightPercent}%`}
                    aria-valuemax={100}
                    aria-valuemin={0}
                    aria-valuenow={rightPercent}
                    data-mini-meter-id={mixTarget.id}
                    data-mini-meter-kind="mixTarget"
                    data-mini-meter-side="right"
                    role="meter"
                    style={{ "--meter-level": `${rightPercent}%` } as CSSProperties}
                  />
                </span>
                <span className={styles.mixTargetFlags}>
                  {mixTarget.mute ? <span>Mute</span> : null}
                  {mixTarget.dim ? <span>Dim</span> : null}
                  {mixTarget.talkback ? <span>TB</span> : null}
                </span>
              </button>
            );
          })}
        </div>

        <label className={styles.monitorLevel}>
          <span>Monitor level</span>
          <AudioHardwareReadout>
            <strong>{formatAudioDb(monitorValue)}</strong>
          </AudioHardwareReadout>
          <AudioSliderControl
            disabled={!selectedMixTarget || !viewModel.actionsAllowed}
            label="Rail monitor level"
            onCommit={(value) => {
              if (!selectedMixTarget) return;
              setDraftValue(monitorDraftKey, value);
              commitMixTargetContinuous({ mixTargetId: selectedMixTarget.id, volume: value });
              clearDraftValueLater(monitorDraftKey);
            }}
            onPreview={(value) => {
              setDraftValue(monitorDraftKey, value);
            }}
            orientation="horizontal"
            snapUnity
            value={monitorValue}
            valueText={formatAudioDb(monitorValue)}
          />
        </label>

        <div className={styles.monitorButtonGrid}>
          <button
            aria-pressed={selectedMixTarget?.dim === true}
            data-control="dim"
            data-active={selectedMixTarget?.dim === true}
            disabled={!selectedMixTarget || !viewModel.actionsAllowed}
            onClick={() => {
              if (!selectedMixTarget) return;
              onUpdateMixTarget({ mixTargetId: selectedMixTarget.id, dim: !selectedMixTarget.dim });
            }}
            type="button"
          >
            Dim
          </button>
          <button
            aria-pressed={selectedMixTarget?.mono === true}
            data-control="mono"
            data-active={selectedMixTarget?.mono === true}
            disabled={!selectedMixTarget || !viewModel.actionsAllowed}
            onClick={() => {
              if (!selectedMixTarget) return;
              onUpdateMixTarget({ mixTargetId: selectedMixTarget.id, mono: !selectedMixTarget.mono });
            }}
            type="button"
          >
            Mono
          </button>
          <button
            aria-pressed={selectedMixTarget?.talkback === true}
            data-control="talk"
            data-active={selectedMixTarget?.talkback === true}
            disabled={!selectedMixTarget || !viewModel.actionsAllowed}
            onClick={() => {
              if (!selectedMixTarget) return;
              onUpdateMixTarget({ mixTargetId: selectedMixTarget.id, talkback: !selectedMixTarget.talkback });
            }}
            type="button"
          >
            Talk
          </button>
        </div>
      </div>

      <div className={styles.railToolsPanel} data-testid="audio-rail-tools">
        <div className={styles.railHeader}>
          <div>
            <h2>Tools</h2>
          </div>
          <span className={styles.eyebrow}>Audio</span>
        </div>
        <div className={styles.railToolGrid}>
          <button aria-label="Sync" disabled={!viewModel.capabilities.canSync} onClick={onSync} type="button">
            <RefreshCw size={13} strokeWidth={1.8} aria-hidden="true" />
            Sync
            {viewModel.status.warningTitle && !viewModel.status.bannerEligible ? (
              // Slice 7's status dot was originally added to AudioToolbar.tsx,
              // but that component is dead code (not mounted in the active
              // layout — see Phase 2 GS-AUD-44 drift entry). Mirroring the
              // dot here next to the live Sync button is the actual surface
              // operators see. The testid stays "audio-toolbar-status-dot"
              // for spec continuity with the existing operator-shell test.
              <span
                className={styles.toolbarStatusDot}
                data-testid="audio-toolbar-status-dot"
                role="status"
                title={`${viewModel.status.warningTitle} — ${viewModel.status.warningBody ?? "press Sync to verify"}`}
                aria-label={`${viewModel.status.warningTitle}. ${viewModel.status.warningBody ?? ""}`}
              />
            ) : null}
          </button>
          <button onClick={onOpenSetup} title="Open Setup / Support" type="button">
            <Settings size={13} strokeWidth={1.8} aria-hidden="true" />
            Setup
          </button>
          <button
            disabled={!viewModel.selectedSnapshot || !viewModel.actionsAllowed}
            onClick={onRecallCurrentSnapshot}
            type="button"
          >
            <RotateCcw size={13} strokeWidth={1.8} aria-hidden="true" />
            Recall
          </button>
        </div>
      </div>

      <div className={`${styles.railPanel} ${styles.railAuxPanel}`} data-testid="audio-rail-trust-panel">
        <div className={styles.railHeader}>
          <div>
            <h2>Trust</h2>
          </div>
          <span className={styles.eyebrow}>State</span>
        </div>
        <div className={styles.railFactGrid}>
          <span>
            <small>Console</small>
            <strong>{viewModel.status.label}</strong>
          </span>
          <span>
            <small>OSC</small>
            <strong>{viewModel.footerTelemetry.osc}</strong>
          </span>
          <span data-rail-fact="metering">
            <small>Metering</small>
            <strong>{viewModel.meterSimulationActive ? "test simulation" : viewModel.footerTelemetry.metering}</strong>
          </span>
          <span data-rail-fact="endpoint">
            <small>Endpoint</small>
            <strong title={fullEndpoint}>{compactEndpoint}</strong>
          </span>
          <span>
            <small>Solo</small>
            <strong>{viewModel.healthStats.soloedChannels}</strong>
          </span>
          <span>
            <small>Clips</small>
            <strong>{viewModel.healthStats.clippedChannels}</strong>
          </span>
        </div>
      </div>

      <div className={`${styles.railPanel} ${styles.railAuxPanel}`} data-testid="audio-rail-snapshot-panel">
        <div className={styles.railHeader}>
          <div>
            <h2>Snapshot</h2>
          </div>
          <span className={styles.eyebrow}>{populatedSnapshotCount} saved</span>
        </div>
        <div className={styles.railSnapshotCard}>
          <span>Current recall</span>
          <strong>{currentSnapshot?.name ?? "None loaded"}</strong>
          <small>
            {currentSnapshot
              ? `Slot ${currentSnapshot.oscIndex + 1} · ${formatAudioTimestamp(currentSnapshot.lastRecalledAt)}`
              : "Recall is armed before apply"}
          </small>
        </div>
        <div className={styles.railFactGrid}>
          <span>
            <small>Sources</small>
            <strong>{viewModel.channels.length}</strong>
          </span>
          <span>
            <small>Dest</small>
            <strong>{viewModel.mixTargets.length}</strong>
          </span>
          <span data-rail-fact="active-sends">
            <small>Active sends</small>
            <strong>{viewModel.healthStats.activeSends}</strong>
          </span>
        </div>
      </div>
    </aside>
  );
}
