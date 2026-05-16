import type { CSSProperties } from "react";
import type { ShellStore } from "@sse/engine-client";
import { RefreshCw, RotateCcw, Settings, SlidersVertical } from "lucide-react";

import styles from "../AudioWorkspace.module.css";
import { faderDbToNormalized, formatAudioDb } from "../audioFormatting";
import type { AudioWorkspaceViewModel } from "../audioViewModel";
import { AudioSliderControl } from "./AudioSliderControl";

type AudioMixTargetUpdate = Parameters<ShellStore["updateAudioMixTarget"]>[0];

function mixTargetMeta(role: string, talkback: boolean) {
  if (role === "main-out") return "Monitor · stereo";
  if (role === "phones-a") return talkback ? "Cue A · talk" : "Cue A";
  if (role === "phones-b") return "Cue B";
  return "Stereo";
}

const PROTOTYPE_MONITOR_LEVEL = faderDbToNormalized(-12);

export function AudioRail({
  clearDraftValue,
  commitMixTargetContinuous,
  getDraftValue,
  onRecallCurrentSnapshot,
  onSync,
  onSelectMixTarget,
  setDraftValue,
  onUpdateMixTarget,
  viewModel,
}: {
  clearDraftValue: (key: string) => void;
  commitMixTargetContinuous: (request: AudioMixTargetUpdate) => void;
  getDraftValue: (key: string, fallback: number) => number;
  onRecallCurrentSnapshot: () => void;
  onSync: () => void;
  onSelectMixTarget: (mixTargetId: string) => void;
  setDraftValue: (key: string, value: number) => void;
  onUpdateMixTarget: (request: AudioMixTargetUpdate) => void;
  viewModel: AudioWorkspaceViewModel;
}) {
  const selectedMixTarget = viewModel.selectedMixTarget;
  const monitorDraftKey = selectedMixTarget
    ? `mixTarget:${selectedMixTarget.id}:rail-volume`
    : "mixTarget:none:rail-volume";
  const monitorValue = getDraftValue(monitorDraftKey, PROTOTYPE_MONITOR_LEVEL);
  const masterGlow = Math.max(viewModel.activeMixReadout.meterLeft, viewModel.activeMixReadout.meterRight);

  return (
    <aside className={styles.audioRail}>
      <div
        className={`${styles.railPanel} ${styles.railMonitorCard}`}
        data-testid="audio-rail-monitor-card"
        style={{ "--master-glow": masterGlow.toFixed(3) } as CSSProperties}
      >
        <span className={styles.masterHalo} data-testid="audio-master-halo" aria-hidden="true" />
        <div className={styles.monitorCardStatus}>
          <span className={styles.statusDot} />
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
          {viewModel.mixTargets.map((mixTarget) => (
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
              <span
                className={styles.mixTargetMiniMeter}
                data-simulated-meter={viewModel.meterSimulationActive}
                aria-hidden="true"
              >
                <i style={{ width: `${Math.max(8, Math.round(mixTarget.volume * 100))}%` }} />
                <i style={{ width: `${Math.max(8, Math.round(mixTarget.volume * 86))}%` }} />
              </span>
              <span className={styles.mixTargetFlags}>
                {mixTarget.mute ? <span>Mute</span> : null}
                {mixTarget.dim ? <span>Dim</span> : null}
                {mixTarget.talkback ? <span>TB</span> : null}
              </span>
            </button>
          ))}
        </div>

        <label className={styles.monitorLevel}>
          <span>Monitor level</span>
          <strong>{formatAudioDb(monitorValue)}</strong>
          <AudioSliderControl
            disabled={!selectedMixTarget || !viewModel.actionsAllowed}
            label="Rail monitor level"
            onCommit={(value) => {
              if (!selectedMixTarget) return;
              setDraftValue(monitorDraftKey, value);
              commitMixTargetContinuous({ mixTargetId: selectedMixTarget.id, volume: value });
              window.setTimeout(() => clearDraftValue(monitorDraftKey), 250);
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
          <button aria-label="Sync" disabled={!viewModel.actionsAllowed} onClick={onSync} type="button">
            <RefreshCw size={13} strokeWidth={1.8} aria-hidden="true" />
            Sync
          </button>
          <button disabled title="Audio setup is managed by the Setup workspace" type="button">
            <Settings size={13} strokeWidth={1.8} aria-hidden="true" />
            Setup
          </button>
          <button disabled title="Level test is not exposed by the audio engine yet" type="button">
            <SlidersVertical size={13} strokeWidth={1.8} aria-hidden="true" />
            Levels
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
    </aside>
  );
}
