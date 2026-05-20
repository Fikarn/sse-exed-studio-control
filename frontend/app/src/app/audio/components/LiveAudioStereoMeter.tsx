import { useEffect, useRef, type CSSProperties } from "react";

import styles from "../AudioWorkspace.module.css";
import { normalizedToDbfs } from "../audioFormatting";
import {
  applyBallistics,
  applyBallisticsReducedMotion,
  DEFAULT_PRESET,
  INITIAL_METER_STATE,
  isClipLatched,
} from "../meters/ballistics";
import type { MeterChannelKind, MeterSample, MeterState } from "../meters/types";
import { useMeterStore } from "./meterStoreContext";

const ARIA_THROTTLE_MS = 500;

interface CommonProps {
  label: string;
  stereo?: boolean;
  showPeakReadout?: boolean;
  showReadout?: boolean;
  showScale?: boolean;
}

interface ChannelProps extends CommonProps {
  channelId: string;
  mixTargetId?: undefined;
}

interface MixTargetProps extends CommonProps {
  mixTargetId: string;
  channelId?: undefined;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function formatLevelForAria(value: number) {
  const db = normalizedToDbfs(value);
  if (!Number.isFinite(db)) return "minus infinity dBFS";
  return `${db.toFixed(1)} dBFS`;
}

function formatPeakDbForReadout(value: number) {
  const db = normalizedToDbfs(value);
  if (!Number.isFinite(db)) return "-∞";
  return db.toFixed(1);
}

function meterPercent(value: number) {
  return `${Math.max(0, Math.min(1, value)) * 100}%`;
}

export function LiveAudioStereoMeter(props: ChannelProps | MixTargetProps) {
  const store = useMeterStore();
  const id = props.channelId ?? props.mixTargetId;
  const kind: MeterChannelKind = props.channelId ? "channel" : "mixTarget";
  const stereo = props.stereo ?? true;

  const meterRef = useRef<HTMLDivElement | null>(null);
  const ariaRef = useRef<HTMLDivElement | null>(null);
  const readoutRef = useRef<HTMLDivElement | null>(null);
  const peakReadoutLeftRef = useRef<HTMLSpanElement | null>(null);
  const peakReadoutRightRef = useRef<HTMLSpanElement | null>(null);

  // Per-side ballistics state retained across data ticks. Updated synchronously
  // on every meterStore notification; CSS transitions smooth the visual between ticks.
  const stateRef = useRef<{ left: MeterState; right: MeterState | null; lastTickMs: number }>({
    left: { ...INITIAL_METER_STATE },
    right: stereo ? { ...INITIAL_METER_STATE } : null,
    lastTickMs: 0,
  });
  const reducedMotionRef = useRef(prefersReducedMotion());

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    let mq: MediaQueryList;
    try {
      mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    } catch {
      return;
    }
    reducedMotionRef.current = mq.matches;
    const onChange = (event: MediaQueryListEvent) => {
      reducedMotionRef.current = event.matches;
    };
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }
    return undefined;
  }, []);

  useEffect(() => {
    const apply = () => {
      const root = meterRef.current;
      if (!root) return;
      const state = store.getState();
      const sample = kind === "channel" ? state.channels.get(id) : state.mixTargets.get(id);
      if (!sample) return;

      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      const dtMs = stateRef.current.lastTickMs ? Math.min(100, Math.max(0, now - stateRef.current.lastTickMs)) : 33;
      stateRef.current.lastTickMs = now;

      const ballistics = reducedMotionRef.current ? applyBallisticsReducedMotion : applyBallistics;

      const leftSample: MeterSample = { ...sample, l: sample.l, r: sample.l };
      stateRef.current.left = ballistics(stateRef.current.left, leftSample, dtMs, DEFAULT_PRESET, now);
      if (stereo) {
        const rightSample: MeterSample = { ...sample, l: sample.r, r: sample.r };
        const prevRight = stateRef.current.right ?? { ...INITIAL_METER_STATE };
        stateRef.current.right = ballistics(prevRight, rightSample, dtMs, DEFAULT_PRESET, now);
      } else {
        stateRef.current.right = null;
      }

      const left = stateRef.current.left;
      const right = stateRef.current.right ?? left;
      root.style.setProperty("--audio-meter-left", meterPercent(left.level));
      root.style.setProperty("--audio-meter-right", meterPercent(right.level));
      root.style.setProperty("--audio-meter-peak-left", meterPercent(left.peakHold));
      root.style.setProperty("--audio-meter-peak-right", meterPercent(right.peakHold));

      const clipLatched = isClipLatched(left, now) || (stereo && isClipLatched(right, now));
      const currentClipAttr = root.getAttribute("data-clip");
      const nextClipAttr = clipLatched ? "true" : "false";
      if (currentClipAttr !== nextClipAttr) root.setAttribute("data-clip", nextClipAttr);

      if (peakReadoutLeftRef.current) {
        peakReadoutLeftRef.current.textContent = formatPeakDbForReadout(left.peakHold);
      }
      if (peakReadoutRightRef.current) {
        peakReadoutRightRef.current.textContent = formatPeakDbForReadout(right.peakHold);
      }
      if (readoutRef.current) {
        const display = Math.max(left.level, right.level);
        readoutRef.current.textContent = clipLatched ? "CLIP" : formatPeakDbForReadout(display);
      }
    };

    apply();
    const unsubscribe = store.subscribe(apply);
    return unsubscribe;
  }, [store, id, kind, stereo]);

  // ARIA updates throttled to 2 Hz; decoupled from data-tick loop so they don't
  // invalidate layout on every meter sample.
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const node = ariaRef.current;
      if (!node) return;
      const left = stateRef.current.left;
      const right = stateRef.current.right ?? left;
      const displayLevel = Math.max(left.level, right.level);
      const peak = Math.max(left.peakHold, right.peakHold);
      const db = normalizedToDbfs(displayLevel);
      const ariaValueNow = Number.isFinite(db) ? Math.max(-60, Math.min(0, db)).toFixed(1) : "-60";
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      const clipLatched = isClipLatched(left, now) || isClipLatched(right, now);
      node.setAttribute("aria-valuenow", ariaValueNow);
      const text = stereo
        ? `Left ${formatLevelForAria(left.level)}, right ${formatLevelForAria(right.level)}, held peak ${formatLevelForAria(peak)}${clipLatched ? ", clip" : ""}`
        : `${formatLevelForAria(left.level)}, held peak ${formatLevelForAria(peak)}${clipLatched ? ", clip" : ""}`;
      node.setAttribute("aria-valuetext", text);
    }, ARIA_THROTTLE_MS);
    return () => window.clearInterval(intervalId);
  }, [stereo]);

  const initialStyle: CSSProperties = {
    "--audio-meter-left": "0%",
    "--audio-meter-right": "0%",
    "--audio-meter-peak-left": "0%",
    "--audio-meter-peak-right": "0%",
  } as CSSProperties;

  return (
    <div
      ref={meterRef}
      className={styles.stereoMeter}
      data-meter-component="stereo"
      data-readout={props.showReadout ? "true" : "false"}
      data-peak-readout={props.showPeakReadout ? "true" : "false"}
      data-show-scale={props.showScale ? "true" : "false"}
      data-clip="false"
      data-stereo={stereo ? "true" : "false"}
      style={initialStyle}
    >
      {props.showPeakReadout ? (
        <div className={styles.meterPeakReadout} aria-hidden="true">
          <span ref={peakReadoutLeftRef}>-∞</span>
          <span ref={peakReadoutRightRef}>-∞</span>
        </div>
      ) : null}
      {props.showScale ? (
        <div className={styles.meterScale} aria-hidden="true">
          <span data-meter-scale-pos="0">0</span>
          <span data-meter-scale-pos="-6">-6</span>
          <span data-meter-scale-pos="-12">-12</span>
          <span data-meter-scale-pos="-24">-24</span>
          <span data-meter-scale-pos="-48">-48</span>
          <span data-meter-scale-pos="-inf">-∞</span>
        </div>
      ) : null}
      <div className={styles.meterPair}>
        <span className={styles.meterTrack} data-side="left">
          <span className={styles.meterFill} data-meter-fill="left" data-side="left" />
          <span className={styles.meterCover} data-meter-cover="left" data-side="left" />
          <span className={styles.meterPeakWrap} data-meter-peak="left" data-side="left">
            <span className={styles.meterPeak} />
          </span>
        </span>
        <span className={styles.meterTrack} data-side="right" data-mono={stereo ? undefined : "true"}>
          <span className={styles.meterFill} data-meter-fill="right" data-side="right" />
          <span className={styles.meterCover} data-meter-cover="right" data-side="right" />
          <span className={styles.meterPeakWrap} data-meter-peak="right" data-side="right">
            <span className={styles.meterPeak} />
          </span>
        </span>
      </div>
      <span className={styles.meterClipPip} data-meter-clip="true" aria-hidden="true" />
      {props.showReadout ? (
        <div ref={readoutRef} className={styles.meterReadout}>
          -∞
        </div>
      ) : null}
      <div
        ref={ariaRef}
        role="meter"
        aria-valuemin={-60}
        aria-valuemax={0}
        aria-valuenow={-60}
        aria-label={props.label}
        className={styles.meterAriaMirror}
      />
    </div>
  );
}
