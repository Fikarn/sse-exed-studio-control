import type { StatusTone } from "@sse/design-system";
import type { ShellState, StartupFailure } from "@sse/engine-client";

// Type vocabulary shared across the startup, recovery, and setup-incident
// surfaces. Pre-Phase-2 these types had per-file copies; centralising them
// keeps the `feedback.tone` discriminator identical wherever it appears.
export type ShellExperience = "ready" | "recovery" | "startup";

export type FeedbackTone = "error" | "info" | "ok";

export interface ActionFeedback {
  message: string;
  tone: FeedbackTone;
}

export interface StartupStep {
  description: string;
  label: string;
  tone: StatusTone;
}

export function deriveShellExperience(shellState: ShellState): ShellExperience {
  if (shellState.lifecycle === "failed" || shellState.startupFailure) {
    return "recovery";
  }

  if (shellState.lifecycle !== "ready") {
    return "startup";
  }

  return "ready";
}

export function buildStartupSteps(lifecycle: ShellState["lifecycle"]): StartupStep[] {
  const stages = [
    "launching-process",
    "waiting-for-ready-event",
    "waiting-for-health-snapshot",
    "waiting-for-app-snapshot",
    "ready",
  ] as const;
  const currentIndex = stages.indexOf(lifecycle as (typeof stages)[number]);
  // STA-08: reserve the success-green tone for the fully-ready lifecycle.
  // Mid-boot, reached steps read as neutral, not healthy green, so an
  // in-progress boot no longer paints predominantly green. Slice 11: the
  // shared vocabulary, so the surfaces no longer translate at the call site.
  const reachedTone: StatusTone = lifecycle === "ready" ? "ok" : "info";

  return [
    {
      description: "Start the part of Studio Control that talks to the desk, the rig and the deck.",
      label: "Start up",
      tone: currentIndex >= 0 ? reachedTone : "neutral",
    },
    {
      description: "Wait for Studio Control to confirm both halves of this install are the same version.",
      label: "Handshake",
      tone: currentIndex >= 1 ? reachedTone : "neutral",
    },
    {
      description: "Load what the desk, the rig and the deck report about themselves.",
      label: "Health",
      tone: currentIndex >= 2 ? reachedTone : "neutral",
    },
    {
      description: "Load where you were and whether commissioning has published.",
      label: "Workspaces",
      tone: currentIndex >= 3 ? reachedTone : "neutral",
    },
  ];
}

// Human label for a startup-step tone (STA-09) — the raw StatusTone enum
// ("connected"/"idle") must not surface as operator-facing badge text.
export function stepStatusLabel(tone: StatusTone): string {
  return tone === "neutral" ? "Pending" : "Done";
}

// Short, human-readable failure-code label for the recovery badges (COPY-04),
// so SCREAMING_SNAKE / kebab codes (PROTOCOL_MISMATCH / startup-failed) don't
// surface verbatim as the prominent status tag.
export function formatFailureCode(failure: StartupFailure | null): string {
  const code = failure?.code;
  if (!code) {
    return "Startup failed";
  }
  if (code === "PROTOCOL_MISMATCH") {
    return "Protocol mismatch";
  }
  // Slice 8 (system §9): the two codes Studio Control raises about itself
  // humanize to "Engine …", a word operator copy does not use.
  if (code === "ENGINE_STARTUP_FAILED") {
    return "Startup failed";
  }
  if (code === "ENGINE_READY_TIMEOUT") {
    return "Startup timed out";
  }
  // 2026-09 production readiness, Slice 3 (F02, F13): the saved-data codes
  // name the data, not the start-up; the engine's sentence says which file
  // and which backup.
  if (code === "STORAGE_CORRUPT") {
    return "Saved data check failed";
  }
  if (code === "STORAGE_MIGRATION_FAILED") {
    return "Saved data upgrade failed";
  }
  return code
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/^./, (character) => character.toUpperCase());
}

// Visual overhaul A, Slice 8 (system §9): the stage the engine reports is a
// token ("frontend-bootstrap", "ready-event", "protocol-negotiation"); the
// recovery display names the step in the operator's words and never invents
// one the engine did not report.
export function formatFailureStage(stage: string): string {
  switch (stage) {
    case "bootstrap":
    case "frontend-bootstrap":
      return "start-up";
    case "ready-event":
      return "ready";
    case "protocol-negotiation":
      return "version check";
    default:
      return stage.replace(/[_-]+/g, " ");
  }
}

export function getFailureTitle(startupFailure: StartupFailure | null) {
  if (startupFailure?.code === "PROTOCOL_MISMATCH") {
    return "Protocol mismatch";
  }

  // 2026-09 production readiness, Slice 3: a database that failed its
  // integrity check, or one a migration could not upgrade, is the operator's
  // data asking for attention — restore a backup from Setup / Support.
  if (startupFailure?.code === "STORAGE_CORRUPT" || startupFailure?.code === "STORAGE_MIGRATION_FAILED") {
    return "Saved data needs attention";
  }

  // Slice 8 gave every non-protocol failure the same word, so the stage no
  // longer branches: what failed is the start-up, whichever step it stopped
  // at, and the display's meta line names the step.
  return "Startup failed";
}

export function formatFileSize(sizeBytes: number) {
  if (sizeBytes <= 0) {
    return "size not reported";
  }

  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatPathLabel(key: string) {
  switch (key) {
    case "appDataDir":
      return "App data";
    case "backupDir":
      return "Backup archive";
    case "dbPath":
      return "Database path";
    case "logFilePath":
      return "Engine log";
    case "logsDir":
      return "Logs";
    case "updateRepositoryPath":
      return "Update folder";
    default:
      return key
        .replace(/([A-Z])/g, " $1")
        .toLowerCase()
        .replace(/^./, (value) => value.toUpperCase());
  }
}

export function feedbackBadgeTone(tone: FeedbackTone): StatusTone {
  if (tone === "ok") {
    return "ok";
  }

  if (tone === "error") {
    return "error";
  }

  return "neutral";
}
