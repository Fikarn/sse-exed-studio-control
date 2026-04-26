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

  return [
    {
      description: "Start the isolated Rust engine process.",
      label: "Launch engine",
      tone: currentIndex >= 0 ? "connected" : "idle",
    },
    {
      description: "Wait for the engine to confirm protocol compatibility.",
      label: "Ready event",
      tone: currentIndex >= 1 ? "connected" : "idle",
    },
    {
      description: "Load health, diagnostics, and degraded-state posture.",
      label: "Health snapshot",
      tone: currentIndex >= 2 ? "connected" : "idle",
    },
    {
      description: "Load shell routing and commissioning state.",
      label: "App snapshot",
      tone: currentIndex >= 3 ? "connected" : "idle",
    },
  ];
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
