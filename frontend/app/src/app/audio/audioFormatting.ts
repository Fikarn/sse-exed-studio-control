import type { AudioSnapshot } from "@sse/engine-client";

import { formatBackupTimestamp, type StatusToneLike } from "../shellData";

/**
 * Audio-page level vocabulary — three labels, three meanings, one home each:
 *
 *   - "Monitor level"   → rail Main Out monitor card (rail-local monitor send)
 *   - "Bus level"       → workspace Output card BUS LEVEL readout (the bus's own level)
 *   - "Send to <bus>"   → inspector send slider (the per-channel send level INTO a bus)
 *
 * They look related but are three different values. Keep the labels distinct
 * so an operator never has to ask "which level am I looking at?". If a future
 * polish pass wants to unify any pair, do it intentionally — don't drift.
 */
export type AudioDensityMode = "desktop" | "touch";
export type AudioFeedbackTone = "error" | "info" | "ok";

export interface AudioStatusDescriptor {
  label: string;
  tone: StatusToneLike;
  warningBody: string | null;
  warningTitle: string | null;
}

export const METER_FLOOR_DBFS = -60;
export const METER_NOMINAL_DBFS = -18;
export const METER_HOT_DBFS = -6;
export const METER_PEAK_WARNING_DBFS = -3;
export const METER_OVER_DBFS = 0;

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export const AUDIO_FADER_UNITY = 0.8;
export const AUDIO_FADER_UNITY_SNAP = 0.02;

export function normalizedToFaderDb(value: number) {
  const normalized = clamp01(value);
  if (normalized <= 0) return Number.NEGATIVE_INFINITY;
  if (normalized >= 1) return 6;
  if (normalized <= 0.7) return -60 + (normalized / 0.7) * 50;
  if (normalized <= AUDIO_FADER_UNITY) return -10 + ((normalized - 0.7) / 0.1) * 10;
  return ((normalized - AUDIO_FADER_UNITY) / 0.2) * 6;
}

export function faderDbToNormalized(db: number) {
  if (!Number.isFinite(db)) return 0;
  const clamped = Math.max(-60, Math.min(6, db));
  if (clamped <= -10) return ((clamped + 60) / 50) * 0.7;
  if (clamped <= 0) return 0.7 + ((clamped + 10) / 10) * 0.1;
  return AUDIO_FADER_UNITY + (clamped / 6) * 0.2;
}

export function snapFaderValue(value: number) {
  const normalized = clamp01(value);
  return Math.abs(normalized - AUDIO_FADER_UNITY) < AUDIO_FADER_UNITY_SNAP ? AUDIO_FADER_UNITY : normalized;
}

export function normalizedToDbfs(value: number) {
  const normalized = clamp01(value);
  if (normalized <= 0) return Number.NEGATIVE_INFINITY;
  return 20 * Math.log10(normalized);
}

export function dbfsToMeterPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, ((value - METER_FLOOR_DBFS) / Math.abs(METER_FLOOR_DBFS)) * 100));
}

export function formatMeterPercent(value: number) {
  return `${dbfsToMeterPercent(normalizedToDbfs(value)).toFixed(1)}%`;
}

// Why: shared infinity glyph so fader-style readouts and meter-style readouts
// agree on the typography. Previously `formatAudioDb` returned the literal
// `-inf dB` string while `formatMeterDb` returned `-∞`; the mixer lane patched
// the divergence with a `.replace("-inf", "-∞")` shim, which broke any reader
// that bypassed the shim.
export const AUDIO_DB_NEG_INFINITY = "-∞ dB";
export const AUDIO_METER_NEG_INFINITY = "-∞";

export function formatAudioDb(value: number) {
  const db = normalizedToFaderDb(value);
  if (!Number.isFinite(db)) {
    return AUDIO_DB_NEG_INFINITY;
  }
  const rounded = Number(db.toFixed(1));
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded.toFixed(1)} dB`;
}

export function formatMeterDb(value: number) {
  const db = normalizedToDbfs(value);
  if (!Number.isFinite(db)) {
    return AUDIO_METER_NEG_INFINITY;
  }
  return `${db.toFixed(0)}`;
}

export interface SendStatusInput {
  isActive: boolean;
  noSend: boolean;
  sendMuted: boolean;
}

/**
 * Single source of truth for the inspector send-card status label.
 *
 * `isActive` means the send routes to the currently selected mix target —
 * its copy uses the "Active mix" prefix to reinforce that this send IS the
 * monitor mix. The remaining states (`Muted`, `No send`, `Send`) match the
 * existing ergonomic plain-language pattern.
 */
export function deriveSendStatusLabel({ isActive, noSend, sendMuted }: SendStatusInput): string {
  if (isActive) {
    if (sendMuted) return "Active mix muted";
    if (noSend) return "Active mix no send";
    return "Active mix";
  }
  if (sendMuted) return "Muted";
  if (noSend) return "No send";
  return "Send";
}

export function formatAudioRole(role: string) {
  switch (role) {
    case "front-preamp":
      return "Mic pre";
    case "rear-line":
      return "Rear line";
    case "playback-pair":
      return "Playback";
    case "main-out":
      return "Main out";
    case "phones-a":
      return "Phones A";
    case "phones-b":
      return "Phones B";
    default:
      return role.replace(/-/g, " ");
  }
}

export function formatAudioTimestamp(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "not yet";
  }
  return formatBackupTimestamp(value);
}

export function meterTone(value: number, clip = false) {
  const dbfs = normalizedToDbfs(value);
  const roundedDbfs = Number.isFinite(dbfs) ? Number(dbfs.toFixed(3)) : dbfs;
  if (clip || roundedDbfs >= METER_PEAK_WARNING_DBFS) return "red";
  if (roundedDbfs >= METER_HOT_DBFS) return "hot";
  if (roundedDbfs >= METER_NOMINAL_DBFS) return "amber";
  return "green";
}

function formatAudioActionFailureTitle(snapshot: AudioSnapshot | null) {
  const lastActionCode =
    typeof snapshot?.lastActionCode === "string" && snapshot.lastActionCode.trim().length > 0
      ? snapshot.lastActionCode
      : null;

  if (!lastActionCode) {
    return "ACTION FAILED";
  }

  return lastActionCode
    .replace(/^AUDIO_/, "")
    .replace(/_/g, " ")
    .trim();
}

export function describeAudioStatus(snapshot: AudioSnapshot | null): AudioStatusDescriptor {
  const lastActionFailed = String(snapshot?.lastActionStatus ?? "idle") === "failed";
  const meteringSource = String(snapshot?.meteringSource ?? snapshot?.adapterMode ?? "").toLowerCase();
  const meteringState = String(snapshot?.meteringState ?? "unknown").toLowerCase();

  if (snapshot?.oscEnabled === false) {
    return {
      label: "DISABLED",
      tone: "attention" satisfies StatusToneLike,
      warningBody: "Page is read-only until transport is re-enabled.",
      warningTitle: "OSC DISABLED",
    };
  }

  if (String(snapshot?.status ?? "not-verified") === "attention") {
    return {
      label: "OFFLINE",
      tone: "error" satisfies StatusToneLike,
      warningBody:
        typeof snapshot?.lastActionMessage === "string" && snapshot.lastActionMessage.trim().length > 0
          ? snapshot.lastActionMessage
          : "Audio may still be passing, but control state is not current.",
      warningTitle: "CONSOLE UNREACHABLE",
    };
  }

  if (String(snapshot?.status ?? "not-verified") !== "ready" || snapshot?.verified !== true) {
    return {
      label: "NOT VERIFIED",
      tone: "attention" satisfies StatusToneLike,
      warningBody: "Run Sync before trusting recall or current fader state.",
      warningTitle: "OSC NOT VERIFIED",
    };
  }

  if (meteringSource === "rme-totalmix-osc" && meteringState === "stale") {
    return {
      label: "STALE",
      tone: "attention" satisfies StatusToneLike,
      warningBody: "No recent TotalMix OSC meter packets are arriving.",
      warningTitle: "RME METERING STALE",
    };
  }

  if (meteringSource === "rme-totalmix-osc" && meteringState === "offline") {
    return {
      label: "OFFLINE",
      tone: "error" satisfies StatusToneLike,
      warningBody: "Configure TotalMix OSC Send Peak Level and rerun the audio probe.",
      warningTitle: "RME METERING OFFLINE",
    };
  }

  if (String(snapshot?.consoleStateConfidence ?? "unknown") === "assumed") {
    return {
      label: "ASSUMED",
      tone: "attention" satisfies StatusToneLike,
      warningBody: "Using last synced console state. Run Sync before trusting recall or current fader state.",
      warningTitle: "STATE ASSUMED",
    };
  }

  if (lastActionFailed) {
    const warningTitle = formatAudioActionFailureTitle(snapshot);
    const actionCode =
      typeof snapshot?.lastActionCode === "string" && snapshot.lastActionCode.trim().length > 0
        ? snapshot.lastActionCode
        : null;
    const actionMessage =
      String(snapshot?.lastActionMessage ?? "The last audio action failed.") || "The last audio action failed.";
    return {
      label: "ACTION FAILED",
      tone: "error" satisfies StatusToneLike,
      warningBody: actionCode ? `${actionCode} · ${actionMessage}` : actionMessage,
      warningTitle,
    };
  }

  if (meteringSource === "simulated" || meteringSource === "fixture") {
    return {
      label: "SIMULATED",
      tone: "attention" satisfies StatusToneLike,
      warningBody: null,
      warningTitle: null,
    };
  }

  return {
    label: "VERIFIED",
    tone: "ok" satisfies StatusToneLike,
    warningBody: null,
    warningTitle: null,
  };
}
