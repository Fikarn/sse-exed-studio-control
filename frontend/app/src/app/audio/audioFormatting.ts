import type { AudioSnapshot } from "@sse/engine-client";

import { formatBackupTimestamp, type StatusToneLike } from "../shellData";

export type AudioDensityMode = "desktop" | "touch";
export type AudioFeedbackTone = "error" | "info" | "ok";

export interface AudioStatusDescriptor {
  label: string;
  tone: StatusToneLike;
  warningBody: string | null;
  warningTitle: string | null;
}

const METER_DB_RANGE = 60;
const METER_AMBER_DBFS = -12;
const METER_RED_DBFS = -1;

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
  return normalized * METER_DB_RANGE - METER_DB_RANGE;
}

export function dbfsToMeterPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, ((value + METER_DB_RANGE) / METER_DB_RANGE) * 100));
}

export function formatAudioDb(value: number) {
  const db = normalizedToFaderDb(value);
  if (!Number.isFinite(db)) {
    return "-inf dB";
  }
  const rounded = Number(db.toFixed(1));
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded.toFixed(1)} dB`;
}

export function formatMeterDb(value: number) {
  const db = normalizedToDbfs(value);
  if (!Number.isFinite(db)) {
    return "-∞";
  }
  return `${db.toFixed(0)}`;
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
  if (clip || normalizedToDbfs(value) >= METER_RED_DBFS) return "red";
  if (normalizedToDbfs(value) >= METER_AMBER_DBFS) return "amber";
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

  if (snapshot?.oscEnabled === false) {
    return {
      label: "DISABLED",
      tone: "attention" satisfies StatusToneLike,
      warningBody: "OSC DISABLED - page is read-only until transport is re-enabled.",
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
          : "CONSOLE UNREACHABLE - audio may still be passing, but control state is not current.",
      warningTitle: "CONSOLE UNREACHABLE",
    };
  }

  if (String(snapshot?.status ?? "not-verified") !== "ready" || snapshot?.verified !== true) {
    return {
      label: "NOT VERIFIED",
      tone: "attention" satisfies StatusToneLike,
      warningBody: "OSC NOT VERIFIED - run Sync before trusting recall or current fader state.",
      warningTitle: "OSC NOT VERIFIED",
    };
  }

  if (String(snapshot?.consoleStateConfidence ?? "unknown") === "assumed") {
    return {
      label: "ASSUMED",
      tone: "attention" satisfies StatusToneLike,
      warningBody:
        "STATE ASSUMED - using last synced console state. Run Sync before trusting recall or current fader state.",
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

  return {
    label: "VERIFIED",
    tone: "ok" satisfies StatusToneLike,
    warningBody: null,
    warningTitle: null,
  };
}
