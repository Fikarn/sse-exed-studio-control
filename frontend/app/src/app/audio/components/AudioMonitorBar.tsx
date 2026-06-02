import type { CSSProperties } from "react";
import type { ShellStore } from "@sse/engine-client";

import styles from "./AudioMonitorBar.module.css";
import { type AudioControlDraftStore, useAudioControlDraftValue } from "../audioControlDraftStore";
import { formatAudioDb, formatMeterPercent } from "../audioFormatting";
import type { AudioWorkspaceViewModel } from "../audioViewModel";

type AudioMixTargetUpdate = Parameters<ShellStore["updateAudioMixTarget"]>[0];

interface AudioMonitorBarProps {
  clearDraftValueLater: (key: string, delayMs?: number) => void;
  commitMixTargetContinuous: (request: AudioMixTargetUpdate) => void;
  draftStore: AudioControlDraftStore;
  getDraftValue: (key: string, fallback: number) => number;
  onUpdateMixTarget: (request: AudioMixTargetUpdate) => void;
  setDraftValue: (key: string, value: number) => void;
  store: ShellStore;
  viewModel: AudioWorkspaceViewModel;
}

function percentNumber(value: number) {
  const raw = Number(formatMeterPercent(value).replace("%", ""));
  return Math.round(Math.min(100, Math.max(0, Number.isFinite(raw) ? raw : 0)));
}

const SCALE_TICKS: { db: number; pct: number; label: string }[] = [
  { db: -60, pct: 0, label: "−∞" },
  { db: -40, pct: 25, label: "−40" },
  { db: -20, pct: 50, label: "−20" },
  { db: -12, pct: 65, label: "−12" },
  { db: -6, pct: 82, label: "−6" },
  { db: 0, pct: 100, label: "0" },
];

export function AudioMonitorBar({
  clearDraftValueLater,
  commitMixTargetContinuous,
  draftStore,
  getDraftValue,
  onUpdateMixTarget,
  setDraftValue,
  viewModel,
}: AudioMonitorBarProps) {
  const selectedMixTarget = viewModel.selectedMixTarget ?? viewModel.mixTargets[0] ?? null;
  const monitorDraftKey = selectedMixTarget
    ? `mixTarget:${selectedMixTarget.id}:rail-volume`
    : "mixTarget:none:rail-volume";
  const monitorValue = useAudioControlDraftValue(
    draftStore,
    monitorDraftKey,
    getDraftValue(monitorDraftKey, selectedMixTarget?.volume ?? 0)
  );

  const meterLeftPct = selectedMixTarget ? percentNumber(selectedMixTarget.meterLeft) : 0;
  const meterRightPct = selectedMixTarget
    ? percentNumber(selectedMixTarget.mono ? selectedMixTarget.meterLeft : selectedMixTarget.meterRight)
    : 0;
  const peakLeftPct = selectedMixTarget ? percentNumber(selectedMixTarget.peakHoldLeft) : 0;
  const peakRightPct = selectedMixTarget
    ? percentNumber(selectedMixTarget.mono ? selectedMixTarget.peakHoldLeft : selectedMixTarget.peakHoldRight)
    : 0;

  const activeName = selectedMixTarget?.name ?? "Main Out";
  const activePair = selectedMixTarget?.shortName ?? "";
  const masterDb = selectedMixTarget ? formatAudioDb(monitorValue) : "—";
  const actionsAllowed = viewModel.actionsAllowed;

  const setControl = (control: "talkback" | "dim" | "mono") => () => {
    if (!selectedMixTarget) return;
    if (control === "talkback") {
      onUpdateMixTarget({ mixTargetId: selectedMixTarget.id, talkback: !selectedMixTarget.talkback });
      return;
    }
    if (control === "dim") {
      onUpdateMixTarget({ mixTargetId: selectedMixTarget.id, dim: !selectedMixTarget.dim });
      return;
    }
    if (control === "mono") {
      onUpdateMixTarget({ mixTargetId: selectedMixTarget.id, mono: !selectedMixTarget.mono });
    }
  };

  const onVolumePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!selectedMixTarget) return;
    if (!actionsAllowed) return;
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const apply = (clientX: number) => {
      const rect = target.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      setDraftValue(monitorDraftKey, ratio);
      commitMixTargetContinuous({ mixTargetId: selectedMixTarget.id, volume: ratio });
    };
    apply(event.clientX);
    const move = (ev: PointerEvent) => apply(ev.clientX);
    const up = () => {
      target.releasePointerCapture(event.pointerId);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      clearDraftValueLater(monitorDraftKey);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const talkbackOn = selectedMixTarget?.talkback ?? false;
  const dimOn = selectedMixTarget?.dim ?? false;
  const monoOn = selectedMixTarget?.mono ?? false;

  return (
    <footer className={styles.monitorBar} data-testid="audio-monitor-bar">
      <div className={styles.talkbackCell}>
        <button
          aria-pressed={talkbackOn}
          className={styles.talkbackButton}
          data-active={talkbackOn}
          data-control="talk"
          data-testid="audio-monitor-talkback"
          disabled={!selectedMixTarget || !actionsAllowed}
          onClick={setControl("talkback")}
          type="button"
        >
          <span className={styles.talkbackGlyph} aria-hidden="true">
            <svg width="10" height="13" viewBox="0 0 10 13" fill="none">
              <rect x="3" y="1" width="4" height="7" rx="2" fill="currentColor" />
              <path d="M1 6.5a4 4 0 0 0 8 0M5 10.5v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </span>
          <span>
            <span className={styles.talkbackName}>Talkback</span>
            <span className={styles.talkbackCap}>Press · Hold M</span>
          </span>
        </button>
      </div>

      <div className={styles.masterCell}>
        <div className={styles.masterHead}>
          <div className={styles.masterTitle}>
            <span className={styles.masterEyebrow}>Monitor</span>
            <span className={styles.masterArrow}>→</span>
            <span className={styles.masterName}>{activeName}</span>
          </div>
          <div className={styles.masterMeta}>
            {activePair ? <span>{activePair}</span> : null}
            <span className={styles.masterDb}>{masterDb}</span>
          </div>
        </div>

        <div
          className={styles.masterMeter}
          onPointerDown={onVolumePointerDown}
          data-testid="audio-monitor-master-meter"
        >
          <div className={styles.masterMeterRow}>
            <span className={styles.masterChLabel}>L</span>
            <div className={styles.masterTrack}>
              <div className={styles.masterFill} style={{ "--level": `${meterLeftPct}%` } as CSSProperties} />
              {peakLeftPct > 1 ? (
                <div className={styles.masterPeak} style={{ left: `calc(${peakLeftPct}% - 1px)` }} />
              ) : null}
            </div>
            <span className={styles.masterReadout}>
              {selectedMixTarget ? formatAudioDb(selectedMixTarget.meterLeft) : ""}
            </span>
          </div>
          <div className={styles.masterMeterRow}>
            <span className={styles.masterChLabel}>R</span>
            <div className={styles.masterTrack}>
              <div className={styles.masterFill} style={{ "--level": `${meterRightPct}%` } as CSSProperties} />
              {peakRightPct > 1 ? (
                <div className={styles.masterPeak} style={{ left: `calc(${peakRightPct}% - 1px)` }} />
              ) : null}
            </div>
            <span className={styles.masterReadout}>
              {selectedMixTarget
                ? formatAudioDb(selectedMixTarget.mono ? selectedMixTarget.meterLeft : selectedMixTarget.meterRight)
                : ""}
            </span>
          </div>
          <div className={styles.masterScaleLine}>
            <span className={styles.masterChLabel} aria-hidden="true">
              &nbsp;
            </span>
            <div className={styles.masterScale}>
              {SCALE_TICKS.map((tick) => (
                <span
                  className={styles.masterTick}
                  data-zero={tick.db === 0}
                  key={tick.db}
                  style={{ left: `${tick.pct}%` }}
                >
                  <span className={styles.masterTickMark} />
                  <span className={styles.masterTickLabel}>{tick.label}</span>
                </span>
              ))}
            </div>
            <span className={styles.masterReadout} style={{ visibility: "hidden" }}>
              −00.0 dB
            </span>
          </div>
        </div>
      </div>

      <div className={styles.controlCluster}>
        <button
          aria-pressed={dimOn}
          className={`${styles.controlButton} ${styles.controlWarn}`}
          data-active={dimOn}
          data-control="dim"
          data-testid="audio-monitor-dim"
          disabled={!selectedMixTarget || !actionsAllowed}
          onClick={setControl("dim")}
          type="button"
        >
          Dim
          <span className={styles.controlSub}>−20</span>
        </button>
        <button
          aria-pressed={monoOn}
          className={styles.controlButton}
          data-active={monoOn}
          data-control="mono"
          data-testid="audio-monitor-mono"
          disabled={!selectedMixTarget || !actionsAllowed}
          onClick={setControl("mono")}
          type="button"
        >
          Mono
          <span className={styles.controlSub}>L+R</span>
        </button>
      </div>
    </footer>
  );
}
