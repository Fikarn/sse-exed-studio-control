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
  // Mid-boot, reached steps read as neutral "connected", not "healthy" green,
  // so an in-progress boot no longer paints predominantly green.
  const reachedTone: StatusTone = lifecycle === "ready" ? "healthy" : "connected";

  return [
    {
      description: "Start the isolated Rust engine process.",
      label: "Launch engine",
      tone: currentIndex >= 0 ? reachedTone : "idle",
    },
    {
      description: "Wait for the engine to confirm protocol compatibility.",
      label: "Ready event",
      tone: currentIndex >= 1 ? reachedTone : "idle",
    },
    {
      description: "Load health, diagnostics, and degraded-state posture.",
      label: "Health snapshot",
      tone: currentIndex >= 2 ? reachedTone : "idle",
    },
    {
      description: "Load shell routing and commissioning state.",
      label: "App snapshot",
      tone: currentIndex >= 3 ? reachedTone : "idle",
    },
  ];
}

// Human label for a startup-step tone (STA-09) — the raw StatusTone enum
// ("connected"/"idle") must not surface as operator-facing badge text.
export function stepStatusLabel(tone: StatusTone): string {
  return tone === "idle" ? "Pending" : "Done";
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
  return code
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/^./, (character) => character.toUpperCase());
}

export function getFailureTitle(startupFailure: StartupFailure | null) {
  if (startupFailure?.code === "PROTOCOL_MISMATCH") {
    return "Protocol mismatch";
  }

  if (startupFailure?.stage === "bootstrap") {
    return "Engine bootstrap failed";
  }

  return "Startup recovery required";
}

export function formatFileSize(sizeBytes: number) {
  if (sizeBytes <= 0) {
    return "fixture";
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
      return "Update repo";
    default:
      return key.replace(/([A-Z])/g, " $1").replace(/^./, (value) => value.toUpperCase());
  }
}

export function feedbackBadgeTone(tone: FeedbackTone): StatusTone {
  if (tone === "ok") {
    return "healthy";
  }

  if (tone === "error") {
    return "error";
  }

  return "idle";
}
