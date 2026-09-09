import { AUDIO_FADER_UNITY, faderDbToLin, faderLinToDb, type AudioSnapshot } from "@sse/engine-client";

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
// desktop: operator root 2200 px and wider (the 2560×1440 studio surface);
// compact: narrower roots such as the 1920×1080 fallback (2026-09 audit
// Slice 9); touch: the legacy toolbar mode with no live caller.
export type AudioDensityMode = "compact" | "desktop" | "touch";
export type AudioFeedbackTone = "error" | "info" | "ok";

export interface AudioStatusDescriptor {
  label: string;
  tone: StatusToneLike;
  warningBody: string | null;
  /**
   * The desk's raw fault code, when it reported one. Slice 8 (system §9): the
   * code is a field of its own so nothing has to lead a sentence with it — the
   * state display prints it in its own small slot, and every tooltip and
   * locked reason reads `warningBody` alone.
   */
  warningCode: string | null;
  warningTitle: string | null;
  /**
   * Whether this status warrants a full-width warning banner. False means
   * the status is real but not critical enough to consume banner real
   * estate (e.g. OSC has never been sync'd because the operator hasn't
   * pressed Sync yet — that's a "pre-flight reminder", not a fault).
   * AudioSignalCanvas renders the banner only when `true`. The small
   * attention dot that used to render next to the Sync button otherwise went
   * away with AudioToolbar / AudioRail on 2026-09-09 (GS-AUD-44 posture
   * closed); no live host draws that dot today.
   *
   * Slice 7 of the Phase 3 polish — prevents stacking two yellow banners
   * (OSC + SOLO) simultaneously when the OSC state isn't actually
   * operationally critical.
   */
  bannerEligible: boolean;
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

// Unity (0 dB) is RME's fader step 836 of 1023 (0.8172). The curve itself
// lives in @sse/engine-client (audio/faderCurve.ts) so the fixture transport
// and the app share one implementation; the engine mirrors it in
// audio/fader_curve.rs, and the Stream Deck LCD (audio_fader_db_label in
// native/rust-engine/src/control_surface_audio.rs) prints through that copy,
// so the deck and the on-screen fader always show the same dB for the same
// position. 2026-09 audit remediation, Slice 5 (operator decision 3).
export { AUDIO_FADER_UNITY };
export const AUDIO_FADER_UNITY_SNAP = 0.02;

/** Fader position (0..1) to the dB TotalMix shows; -Infinity when off. */
export function normalizedToFaderDb(value: number) {
  return faderLinToDb(clamp01(value));
}

/** dB to fader position (0..1); off (-65 dB and below, -Infinity, NaN) is 0. */
export function faderDbToNormalized(db: number) {
  return faderDbToLin(db);
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

// How much of a meter's well a level fills: the dBFS scale the desk reads, not
// the raw amplitude. `formatMeterPercent` prints the same number for the CSS
// custom properties the tall meters use.
export function meterFill(value: number) {
  return dbfsToMeterPercent(normalizedToDbfs(value)) / 100;
}

// A snapshot slot says when it was last recalled, and the desk reads the clock,
// not the calendar — the tile is one line wide.
export function formatAudioRecallTime(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(parsed);
}

// Visual overhaul A, Slice 4b: what a locked bay says on each tier header —
// the short phrase, in the operator's words, that names the lock and its way
// out. The sentence itself stays in the state display and on each refused
// control; a tier header has room for a phrase, not a paragraph.
export function audioLockNote(label: string): string {
  switch (label) {
    case "NOT VERIFIED":
      return "locked · run the audio probe";
    case "OFFLINE":
      return "locked · desk unreachable";
    case "DISCONNECTED":
      return "locked · UFX III disconnected";
    case "DISABLED":
      return "read-only · OSC control is off in Setup";
    default:
      return "locked";
  }
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
      bannerEligible: true,
      label: "DISABLED",
      tone: "attention" satisfies StatusToneLike,
      warningBody: "OSC control is switched off in Setup. The Console is read-only until it is switched back on.",
      warningCode: null,
      warningTitle: "OSC DISABLED",
    };
  }

  if (snapshot?.consoleLink?.connection === "disconnected") {
    // 2026-09 audit remediation, Slice 2: TotalMix itself reports over the
    // Global OSC link that the interface is gone (`/status/connection 0`).
    // Nothing the app sends reaches hardware in that state.
    return {
      bannerEligible: true,
      label: "DISCONNECTED",
      tone: "error" satisfies StatusToneLike,
      warningBody: "TotalMix reports the UFX III is disconnected. Check the interface's USB link and power.",
      warningCode: null,
      warningTitle: "CONSOLE DISCONNECTED",
    };
  }

  if (String(snapshot?.status ?? "not-verified") === "attention") {
    return {
      bannerEligible: true,
      label: "OFFLINE",
      tone: "error" satisfies StatusToneLike,
      warningBody:
        typeof snapshot?.lastActionMessage === "string" && snapshot.lastActionMessage.trim().length > 0
          ? snapshot.lastActionMessage
          : "Audio may still pass, but the app cannot see or change the desk right now. Run the audio probe to check the link.",
      warningCode: null,
      warningTitle: "CONSOLE UNREACHABLE",
    };
  }

  if (String(snapshot?.status ?? "not-verified") !== "ready" || snapshot?.verified !== true) {
    // Why (2026-09 audit remediation, Slice 1): while the audio probe has not
    // passed, every console write is refused by the engine and disabled on
    // screen. That state must explain itself and offer the way out, so it is
    // always a full banner carrying the "Run audio probe" action. (The earlier
    // Phase 3 demotion to an inline dot predates the gate.)
    return {
      bannerEligible: true,
      label: "NOT VERIFIED",
      tone: "attention" satisfies StatusToneLike,
      warningBody: "Console controls stay locked until the audio probe passes.",
      warningCode: null,
      warningTitle: "AUDIO NOT VERIFIED",
    };
  }

  if (meteringSource === "rme-totalmix-osc" && meteringState === "stale") {
    return {
      bannerEligible: true,
      label: "STALE",
      tone: "attention" satisfies StatusToneLike,
      warningBody: "No meter data has arrived from TotalMix for a few seconds. Run the audio probe to check the link.",
      warningCode: null,
      warningTitle: "RME METERING STALE",
    };
  }

  if (meteringSource === "rme-totalmix-osc" && meteringState === "offline") {
    return {
      bannerEligible: true,
      label: "OFFLINE",
      tone: "error" satisfies StatusToneLike,
      warningBody:
        "TotalMix is not sending meter data. In TotalMix Options › Settings › OSC, turn on Send Peak Level Data, then run the audio probe again.",
      warningCode: null,
      warningTitle: "RME METERING OFFLINE",
    };
  }

  if (String(snapshot?.consoleStateConfidence ?? "unknown") === "assumed") {
    return {
      bannerEligible: true,
      label: "ASSUMED",
      tone: "attention" satisfies StatusToneLike,
      warningBody:
        "Showing the last state the desk confirmed. Press Sync from TotalMix to pull the current state before trusting faders or recall.",
      warningCode: null,
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
      String(
        snapshot?.lastActionMessage ?? "The last action failed. Press Sync from TotalMix to pull the current state."
      ) || "The last action failed. Press Sync from TotalMix to pull the current state.";
    return {
      bannerEligible: true,
      label: "ACTION FAILED",
      tone: "error" satisfies StatusToneLike,
      warningBody: actionMessage,
      warningCode: actionCode,
      warningTitle,
    };
  }

  if (meteringSource === "simulated" || meteringSource === "fixture") {
    return {
      bannerEligible: false,
      label: "SIMULATED",
      tone: "attention" satisfies StatusToneLike,
      warningBody: null,
      warningCode: null,
      warningTitle: null,
    };
  }

  return {
    bannerEligible: false,
    label: "VERIFIED",
    tone: "ok" satisfies StatusToneLike,
    warningBody: null,
    warningCode: null,
    warningTitle: null,
  };
}
