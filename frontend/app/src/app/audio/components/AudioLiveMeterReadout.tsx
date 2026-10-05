import { useEffect, useRef, useState } from "react";
import type { AudioMeterEntry, ShellStore } from "@sse/engine-client";

import styles from "./AudioLiveMeterReadout.module.css";
import { INSPECTOR_DB_HYSTERESIS, INSPECTOR_READOUT_INTERVAL_MS } from "../audioConstants";
import { AUDIO_METER_NEG_INFINITY, METER_OVER_DBFS, METER_PEAK_WARNING_DBFS, MINUS } from "../audioFormatting";
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

// The visual overhaul's polish (2026-10-05): the plate's readouts print the
// real minus (DESIGN.md §3), as every other level on the Console does.
function emptyReadoutPair(): MeterReadoutPair {
  return {
    left: { text: AUDIO_METER_NEG_INFINITY, value: null },
    right: { text: AUDIO_METER_NEG_INFINITY, value: null },
  };
}

function formatQuantizedDbfs(dbfs: number, exactSilence: boolean, previous: MeterReadoutSlot): MeterReadoutSlot {
  const clampedDbfs = clampMeterDbfs(dbfs);
  if (!Number.isFinite(dbfs) || (exactSilence && clampedDbfs <= METER_FLOOR_DBFS)) {
    return { text: AUDIO_METER_NEG_INFINITY, value: null };
  }

  if (previous.value !== null && Math.abs(clampedDbfs - previous.value) < INSPECTOR_DB_HYSTERESIS) {
    return previous;
  }

  const value = Math.round(clampedDbfs);
  return { text: value < 0 ? `${MINUS}${Math.abs(value)}` : String(Math.abs(value)), value };
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

type MeterZone = "calm" | "warn" | "clip";

// Why: the safe-zone "calm" tone for peak-hold readouts (item D14) was
// deferred during the Phase 3 Slice 4 commit with the rationale that the
// channel snapshot's peakHold values can be stale. This component already
// owns a live displayState — derive the zone from the worst (highest) of
// the two stabilised peak-hold dBFS values. Threshold: METER_PEAK_WARNING_DBFS
// (-3 dBFS) per the shared constant in audioFormatting.ts; over 0 dBFS is
// treated as clip even if the upstream `clip` flag hasn't propagated yet.
function meterZoneFromDbfs(leftDbfs: number, rightDbfs: number): MeterZone {
  const worst = Math.max(leftDbfs, rightDbfs);
  if (worst >= METER_OVER_DBFS) return "clip";
  if (worst >= METER_PEAK_WARNING_DBFS) return "warn";
  return "calm";
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
  const [zone, setZone] = useState<MeterZone>("calm");

  useEffect(() => {
    const updateLatestEntry = () => {
      latestEntryRef.current = liveEntry(store, kind, meterId);
    };
    updateLatestEntry();
    return store.subscribeAudioMeters(updateLatestEntry);
  }, [kind, meterId, store]);

  useEffect(() => {
    // R2-MOT-01: same snap contract as the canvas overlay — the readout keeps
    // publishing live values, only the eased approach is bypassed.
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

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
        snap: reduceMotion.matches,
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

      // Why (D14): emit the zone so the consumer can switch the readout color
      // from warn yellow to peakHold.calm grey when we're in the safe zone.
      // Only meaningful for peak-hold mode; level mode keeps `calm` as a
      // benign default since level readouts don't share the warn yellow.
      const nextZone = mode === "peakHold" && peakHoldEnabled ? meterZoneFromDbfs(leftDbfs, rightDbfs) : "calm";
      setZone((current) => (current === nextZone ? current : nextZone));
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
      data-meter-zone={zone}
      data-testid={testId}
    >
      <span data-meter-readout-side="left">{readout.left.text}</span>
      <i>/</i>
      <span data-meter-readout-side="right">{readout.right.text}</span>
    </span>
  );
}
