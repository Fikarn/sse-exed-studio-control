import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ShellStore } from "@sse/engine-client";

import styles from "./AudioMonitorBar.module.css";
import { AUDIO_DRAFT_CLEAR_MS } from "../audioConstants";
import { type AudioControlDraftStore, useAudioControlDraftValue } from "../audioControlDraftStore";
import { AUDIO_FADER_UNITY, formatAudioDb, formatMeterPercent, snapFaderValue } from "../audioFormatting";
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

// C15: keyboard step on the normalized 0..1 monitor value. Mirrors the
// AudioSliderControl default (0.01 fine / ×5 coarse) so the master shares the
// faders' keyboard feel.
const MONITOR_KEY_STEP = 0.01;
const MONITOR_KEY_COARSE = MONITOR_KEY_STEP * 5;

function clampNormalized(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

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

  const controlDisabled = !selectedMixTarget || !actionsAllowed;

  // C15: route every committed monitor value through snapFaderValue so the
  // master shares the lanes' unity-snap normalized curve instead of writing a
  // raw linear ratio.
  const commitMonitorValue = (nextValue: number) => {
    if (!selectedMixTarget) return;
    const snapped = snapFaderValue(clampNormalized(nextValue));
    setDraftValue(monitorDraftKey, snapped);
    commitMixTargetContinuous({ mixTargetId: selectedMixTarget.id, volume: snapped });
  };

  // C15: relative drag (was absolute-on-press). A bare tap to read the meter no
  // longer jumps the gain — the value only moves by the pointer delta from the
  // press point, scaled to the band width.
  const onVolumePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (controlDisabled) return;
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const width = Math.max(1, target.getBoundingClientRect().width);
    const startX = event.clientX;
    const startValue = clampNormalized(monitorValue);
    const move = (ev: PointerEvent) => {
      const delta = (ev.clientX - startX) / width;
      commitMonitorValue(startValue + delta);
    };
    const up = () => {
      target.releasePointerCapture(event.pointerId);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      clearDraftValueLater(monitorDraftKey);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // C15: keyboard access (Arrow = step, Shift/Page = coarse, Home/End).
  const onVolumeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (controlDisabled) return;
    const current = clampNormalized(monitorValue);
    const coarse = event.shiftKey ? MONITOR_KEY_COARSE : MONITOR_KEY_STEP;
    let nextValue: number;
    switch (event.key) {
      case "ArrowUp":
      case "ArrowRight":
        nextValue = current + coarse;
        break;
      case "ArrowDown":
      case "ArrowLeft":
        nextValue = current - coarse;
        break;
      case "PageUp":
        nextValue = current + MONITOR_KEY_COARSE;
        break;
      case "PageDown":
        nextValue = current - MONITOR_KEY_COARSE;
        break;
      case "Home":
        nextValue = 0;
        break;
      case "End":
        nextValue = 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    commitMonitorValue(nextValue);
    clearDraftValueLater(monitorDraftKey, AUDIO_DRAFT_CLEAR_MS);
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
          aria-disabled={controlDisabled ? true : undefined}
          aria-label={`Monitor level — ${activeName}`}
          aria-orientation="horizontal"
          aria-valuemax={1}
          aria-valuemin={0}
          aria-valuenow={selectedMixTarget ? Number(clampNormalized(monitorValue).toFixed(5)) : undefined}
          aria-valuetext={selectedMixTarget ? masterDb : undefined}
          className={styles.masterMeter}
          data-testid="audio-monitor-master-meter"
          data-unity={selectedMixTarget && monitorValue === AUDIO_FADER_UNITY ? "true" : undefined}
          onKeyDown={onVolumeKeyDown}
          onPointerDown={onVolumePointerDown}
          role="slider"
          tabIndex={controlDisabled ? -1 : 0}
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
