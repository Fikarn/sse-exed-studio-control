import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { useAudioMeterFrame, type AudioMeterEntry, type ShellStore } from "@sse/engine-client";

import styles from "./AudioLiveMeterReadout.module.css";
import railStyles from "./AudioRail.module.css";
import { INSPECTOR_DB_HYSTERESIS, INSPECTOR_READOUT_INTERVAL_MS } from "../audioConstants";
import { formatMeterDb, formatMeterPercent } from "../audioFormatting";
import {
  clampMeterDbfs,
  METER_FLOOR_DBFS,
  meterDisplayTargetFromEntry,
  meterDisplayTargetFromNormalized,
  type MeterDisplayState,
  updateMeterDisplayState,
} from "../audioMeterDisplayModel";

type MeterKind = "channel" | "mixTarget";
type StableMeterMode = "level" | "peakHold";

interface MeterReadoutSlot {
  text: string;
  value: number | null;
}

interface MeterReadoutPair {
  left: MeterReadoutSlot;
  right: MeterReadoutSlot;
}

function liveEntry(store: ShellStore, kind: MeterKind, meterId: string | null): AudioMeterEntry | null {
  const frame = store.getAudioMeterFrame();
  if (!meterId) return null;
  return kind === "channel" ? (frame.channels[meterId] ?? null) : (frame.mixTargets[meterId] ?? null);
}

function useLiveEntry(store: ShellStore, kind: MeterKind, meterId: string | null) {
  const frame = useAudioMeterFrame(store);
  if (!meterId) return null;
  return kind === "channel" ? (frame.channels[meterId] ?? null) : (frame.mixTargets[meterId] ?? null);
}

function meterPair(entry: AudioMeterEntry | null, fallbackLeft: number, fallbackRight: number) {
  return {
    left: entry?.meterLeft ?? fallbackLeft,
    right: entry?.meterRight ?? fallbackRight,
  };
}

function emptyReadoutPair(): MeterReadoutPair {
  return {
    left: { text: "-∞", value: null },
    right: { text: "-∞", value: null },
  };
}

function formatQuantizedDbfs(dbfs: number, exactSilence: boolean, previous: MeterReadoutSlot): MeterReadoutSlot {
  const clampedDbfs = clampMeterDbfs(dbfs);
  if (!Number.isFinite(dbfs) || (exactSilence && clampedDbfs <= METER_FLOOR_DBFS)) {
    return { text: "-∞", value: null };
  }

  if (previous.value !== null && Math.abs(clampedDbfs - previous.value) < INSPECTOR_DB_HYSTERESIS) {
    return previous;
  }

  const value = Math.round(clampedDbfs);
  return { text: String(value), value };
}

function levelIsExactlySilent(
  entry: AudioMeterEntry | null,
  side: "left" | "right",
  fallbackLeft: number,
  fallbackRight: number,
  mirrorRight: boolean
) {
  if (entry) {
    if (side === "left" || mirrorRight) return entry.meterLeft <= 0;
    return entry.meterRight <= 0;
  }
  if (side === "left" || mirrorRight) return fallbackLeft <= 0;
  return fallbackRight <= 0;
}

function peakHoldIsExactlySilent(
  entry: AudioMeterEntry | null,
  side: "left" | "right",
  fallbackLeft: number,
  fallbackRight: number,
  mirrorRight: boolean
) {
  if (entry) {
    if (side === "left" || mirrorRight) {
      return entry.meterLeft <= 0 && entry.peakHoldLeft <= 0;
    }
    return entry.meterRight <= 0 && entry.peakHoldRight <= 0;
  }
  if (side === "left" || mirrorRight) return fallbackLeft <= 0;
  return fallbackRight <= 0;
}

function textPairChanged(current: MeterReadoutPair, next: MeterReadoutPair) {
  return current.left.text !== next.left.text || current.right.text !== next.right.text;
}

export function AudioStableMeterDbPair({
  fallbackLeft,
  fallbackRight,
  kind,
  mirrorRight = false,
  meterId,
  mode,
  peakHoldEnabled,
  peakHoldResetToken,
  store,
  testId,
}: {
  fallbackLeft: number;
  fallbackRight: number;
  kind: MeterKind;
  mirrorRight?: boolean;
  meterId: string | null;
  mode: StableMeterMode;
  peakHoldEnabled: boolean;
  peakHoldResetToken: number;
  store: ShellStore;
  testId: string;
}) {
  const latestEntryRef = useRef<AudioMeterEntry | null>(liveEntry(store, kind, meterId));
  const displayStateRef = useRef<MeterDisplayState | undefined>(undefined);
  const lastPaintedAtRef = useRef(0);
  const quantizedRef = useRef<MeterReadoutPair>(emptyReadoutPair());
  const [readout, setReadout] = useState<MeterReadoutPair>(() => emptyReadoutPair());

  useEffect(() => {
    const updateLatestEntry = () => {
      latestEntryRef.current = liveEntry(store, kind, meterId);
    };
    updateLatestEntry();
    return store.subscribeAudioMeters(updateLatestEntry);
  }, [kind, meterId, store]);

  useEffect(() => {
    const resetReadoutState = () => {
      displayStateRef.current = undefined;
      quantizedRef.current = emptyReadoutPair();
      lastPaintedAtRef.current = performance.now();
    };

    const publishReadout = () => {
      const nowMs = performance.now();
      const deltaSeconds = Math.min(0.1, Math.max(0.001, (nowMs - lastPaintedAtRef.current) / 1000));
      lastPaintedAtRef.current = nowMs;

      const entry = latestEntryRef.current;
      const target = entry
        ? meterDisplayTargetFromEntry(entry, mirrorRight)
        : meterDisplayTargetFromNormalized(fallbackLeft, fallbackRight, mirrorRight);
      const displayState = updateMeterDisplayState({
        deltaSeconds,
        nowMs,
        peakHoldEnabled,
        previous: displayStateRef.current,
        target,
      });
      displayStateRef.current = displayState;

      const usePeakHold = mode === "peakHold" && peakHoldEnabled;
      const leftDbfs = usePeakHold ? displayState.peakLeftDbfs : displayState.bodyLeftDbfs;
      const rightDbfs = usePeakHold ? displayState.peakRightDbfs : displayState.bodyRightDbfs;
      const leftExactSilence = usePeakHold
        ? peakHoldIsExactlySilent(entry, "left", fallbackLeft, fallbackRight, mirrorRight)
        : levelIsExactlySilent(entry, "left", fallbackLeft, fallbackRight, mirrorRight);
      const rightExactSilence = usePeakHold
        ? peakHoldIsExactlySilent(entry, "right", fallbackLeft, fallbackRight, mirrorRight)
        : levelIsExactlySilent(entry, "right", fallbackLeft, fallbackRight, mirrorRight);
      const nextReadout = {
        left: formatQuantizedDbfs(leftDbfs, leftExactSilence, quantizedRef.current.left),
        right: formatQuantizedDbfs(rightDbfs, rightExactSilence, quantizedRef.current.right),
      };
      quantizedRef.current = nextReadout;
      setReadout((current) => (textPairChanged(current, nextReadout) ? nextReadout : current));
    };

    resetReadoutState();
    publishReadout();
    const interval = window.setInterval(publishReadout, INSPECTOR_READOUT_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [fallbackLeft, fallbackRight, kind, meterId, mirrorRight, mode, peakHoldEnabled, peakHoldResetToken, store]);

  return (
    <span
      className={styles.meterValuePair}
      data-meter-peak-hold-enabled={peakHoldEnabled ? "true" : "false"}
      data-meter-peak-hold-reset-token={peakHoldResetToken}
      data-meter-readout-mode={mode}
      data-testid={testId}
    >
      <span data-meter-readout-side="left">{readout.left.text}</span>
      <i>/</i>
      <span data-meter-readout-side="right">{readout.right.text}</span>
    </span>
  );
}

export function AudioLiveMasterHalo({
  fallbackLeft,
  fallbackRight,
  mixTargetId,
  store,
}: {
  fallbackLeft: number;
  fallbackRight: number;
  mixTargetId: string | null;
  store: ShellStore;
}) {
  const entry = useLiveEntry(store, "mixTarget", mixTargetId);
  const { left, right } = meterPair(entry, fallbackLeft, fallbackRight);
  const masterGlow = Math.max(left, right);
  return (
    <span
      className={railStyles.masterHalo}
      data-testid="audio-master-halo"
      aria-hidden="true"
      style={{ "--master-glow": masterGlow.toFixed(3) } as CSSProperties}
    />
  );
}

export function AudioLiveActiveMixMeter({
  fallbackLeft,
  fallbackRight,
  selectedMixTargetId,
  store,
}: {
  fallbackLeft: number;
  fallbackRight: number;
  selectedMixTargetId: string | null;
  store: ShellStore;
}) {
  const entry = useLiveEntry(store, "mixTarget", selectedMixTargetId);
  const { left, right } = meterPair(entry, fallbackLeft, fallbackRight);
  return (
    <div className={styles.canvasActiveMixMeter} aria-label="Active mix level" data-testid="audio-active-mix-meter">
      <span>Active mix</span>
      <i
        data-mini-meter-id={selectedMixTargetId ?? ""}
        data-mini-meter-kind="mixTarget"
        data-mini-meter-side="left"
        style={{ "--meter-level": formatMeterPercent(left) } as CSSProperties}
      />
      <i
        data-mini-meter-id={selectedMixTargetId ?? ""}
        data-mini-meter-kind="mixTarget"
        data-mini-meter-side="right"
        style={{ "--meter-level": formatMeterPercent(right) } as CSSProperties}
      />
      <strong>{formatMeterDb(Math.max(left, right))}</strong>
    </div>
  );
}

export function AudioLiveMeterSnapshotText({
  children,
  fallback,
  kind,
  meterId,
  store,
}: {
  children: (entry: AudioMeterEntry | null) => ReactNode;
  fallback?: ReactNode;
  kind: MeterKind;
  meterId: string | null;
  store: ShellStore;
}) {
  useAudioMeterFrame(store);
  return <>{children(liveEntry(store, kind, meterId)) ?? fallback ?? null}</>;
}
