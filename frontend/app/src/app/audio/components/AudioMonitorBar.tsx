import type { CSSProperties } from "react";
import type { ShellStore } from "@sse/engine-client";

import styles from "./AudioMonitorBar.module.css";
import { formatAudioDb, formatMeterPercent } from "../audioFormatting";
import type { AudioWorkspaceViewModel } from "../audioViewModel";
import { useMomentaryTalkback } from "../hooks/useMomentaryTalkback";

type AudioMixTargetUpdate = Parameters<ShellStore["updateAudioMixTarget"]>[0];
type AudioTalkbackHold = Parameters<ShellStore["holdAudioTalkback"]>[0];

interface AudioMonitorBarProps {
  onHoldTalkback: (request: AudioTalkbackHold) => void;
  onUpdateMixTarget: (request: AudioMixTargetUpdate) => void;
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

export function AudioMonitorBar({ onHoldTalkback, onUpdateMixTarget, viewModel }: AudioMonitorBarProps) {
  const selectedMixTarget = viewModel.selectedMixTarget ?? viewModel.mixTargets[0] ?? null;

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
  // View-only readout of the monitor output level. Operator note (2026-06-02):
  // this is a meter, not a control — the prior C15 work that made it a draggable
  // slider was removed. Monitor level is set on the RME hardware / engine, so
  // there is no pointer/keyboard write-path here; the bar only reflects state.
  const masterDb = selectedMixTarget ? formatAudioDb(selectedMixTarget.volume) : "—";
  const actionsAllowed = viewModel.actionsAllowed;

  // Talkback is a hold, never a toggle (2026-09 audit Slice 6): the hook owns
  // engage / heartbeat / release for the button and for the page-wide T key.
  const talkback = useMomentaryTalkback({
    enabled: Boolean(selectedMixTarget) && actionsAllowed,
    hold: (engaged) => {
      if (selectedMixTarget) onHoldTalkback({ mixTargetId: selectedMixTarget.id, engaged });
    },
  });

  const setControl = (control: "dim" | "mono") => () => {
    if (!selectedMixTarget) return;
    if (control === "dim") {
      onUpdateMixTarget({ mixTargetId: selectedMixTarget.id, dim: !selectedMixTarget.dim });
      return;
    }
    if (control === "mono") {
      onUpdateMixTarget({ mixTargetId: selectedMixTarget.id, mono: !selectedMixTarget.mono });
    }
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
          data-holding={talkback.holding ? "true" : undefined}
          data-testid="audio-monitor-talkback"
          disabled={!selectedMixTarget || !actionsAllowed}
          title="Hold to talk to the monitor output; release to stop. Or hold T."
          type="button"
          {...talkback.buttonProps}
        >
          <span className={styles.talkbackGlyph} aria-hidden="true">
            <svg width="10" height="13" viewBox="0 0 10 13" fill="none">
              <rect x="3" y="1" width="4" height="7" rx="2" fill="currentColor" />
              <path d="M1 6.5a4 4 0 0 0 8 0M5 10.5v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </span>
          <span>
            <span className={styles.talkbackName}>Talkback</span>
            <span className={styles.talkbackCap}>Hold · T</span>
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

        {/* View-only output meter (role="meter", not "slider"): no pointer/keyboard
            write-path. The L/R tracks carry data-mini-meter-* so the shared canvas
            overlay paints them live from the meter frame (frame.mixTargets) — the
            same live source as the strip + inspector meters, so the bar tracks Main
            Out in realtime. (The #111 monitor-bar rebuild dropped this wiring,
            leaving the bar on a static snapshot fill.) The clip-path CSS fill stays
            as the pre-paint fallback. aria-valuenow tracks the louder channel. */}
        <div
          aria-label={`Monitor output meter — ${activeName}`}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={Math.max(meterLeftPct, meterRightPct)}
          aria-valuetext={
            selectedMixTarget
              ? formatAudioDb(Math.max(selectedMixTarget.meterLeft, selectedMixTarget.meterRight))
              : undefined
          }
          className={styles.masterMeter}
          data-testid="audio-monitor-master-meter"
          role="meter"
        >
          <div className={styles.masterMeterRow}>
            <span className={styles.masterChLabel}>L</span>
            <div
              className={styles.masterTrack}
              data-mini-meter-id={selectedMixTarget?.id ?? ""}
              data-mini-meter-kind="mixTarget"
              data-mini-meter-side="left"
            >
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
            <div
              className={styles.masterTrack}
              data-mini-meter-id={selectedMixTarget?.id ?? ""}
              data-mini-meter-kind="mixTarget"
              data-mini-meter-side="right"
            >
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
