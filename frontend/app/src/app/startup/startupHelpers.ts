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
  // A stage is the wait for its step: a step is done once the stage after it
  // has begun (the visual overhaul, 2026-10-05; each step read done one stage
  // early, Handshake while the handshake was still awaited).
  const done = (step: number) => currentIndex > step;
  // STA-08: reserve the success-green tone for the fully-ready lifecycle.
  // Mid-boot, reached steps read as neutral, not healthy green, so an
  // in-progress boot no longer paints predominantly green. Slice 11: the
  // shared vocabulary, so the surfaces no longer translate at the call site.
  const reachedTone: StatusTone = lifecycle === "ready" ? "ok" : "info";

  // The visual overhaul's polish (2026-10-05): the steps in the screen's words
  // (DESIGN §9): the hardware link, not "Studio Control" or "both halves";
  // no "Handshake", "Health", "Workspaces" or "commissioning". The plate lists
  // the three checks beside them, so the Diagnostics step does not name them.
  return [
    {
      description: "The part of Studio Control that talks to the desk, the rig and the deck.",
      label: "Start the hardware link",
      tone: done(0) ? reachedTone : "neutral",
    },
    {
      description: "The hardware link and the app confirm they are the same version.",
      label: "Version check",
      tone: done(1) ? reachedTone : "neutral",
    },
    {
      description: "Read what the hardware reports.",
      label: "Diagnostics",
      tone: done(2) ? reachedTone : "neutral",
    },
    {
      description: "Load whether Setup is published: the Overview opens, or Setup until it is.",
      label: "Pages",
      tone: done(3) ? reachedTone : "neutral",
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
  // humanize to "Engine …", a word operator copy does not use. The visual
  // overhaul's polish (2026-10-05): nor "Bootstrap".
  if (code === "ENGINE_STARTUP_FAILED" || code === "BOOTSTRAP_FAILED") {
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
  // 2026-09 production readiness, Slice 5 (F09, F19): the link that stopped
  // during a session, and the second copy of the app that was refused.
  if (code === "ENGINE_EXITED") {
    return "Hardware link stopped";
  }
  if (code === "ENGINE_ALREADY_RUNNING") {
    return "Already open";
  }
  return code
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/^./, (character) => character.toUpperCase());
}

// Visual overhaul A, Slice 8 (system §9): the stage the engine reports is a
// token ("frontend-bootstrap", "ready-event", "protocol-negotiation"); the
// recovery display names the step in the operator's words and never invents
// one the engine did not report. The visual overhaul's polish (2026-10-05):
// `startup`, one spelling with STARTUP FAILED and Retry startup.
export function formatFailureStage(stage: string): string {
  switch (stage) {
    case "bootstrap":
    case "frontend-bootstrap":
      return "startup";
    case "ready-event":
      return "ready";
    case "protocol-negotiation":
      return "the version check";
    // Slice 5: the engine was up and stopped during the session.
    case "runtime":
      return "running";
    default:
      return stage.replace(/[_-]+/g, " ");
  }
}

/**
 * The recovery display's meta line: the one fact the word above it does not
 * say, in at most 30 characters, the room beside Retry startup.
 *
 * The visual overhaul's polish (2026-10-05): it read `<code> · at <stage>`,
 * which repeated the word (`Protocol mismatch · at version check` under
 * PROTOCOL MISMATCH; the bay prints the code as well) and ran past the room.
 * The code's words stand where they say more than the word (which saved-data
 * step failed, a start that timed out); the stage stands where it is not the
 * start itself, which the word and the key already say.
 */
export function formatFailureMeta(failure: StartupFailure | null): string | undefined {
  if (!failure) {
    return undefined;
  }
  if (
    failure.code === "STORAGE_CORRUPT" ||
    failure.code === "STORAGE_MIGRATION_FAILED" ||
    failure.code === "ENGINE_READY_TIMEOUT"
  ) {
    return formatFailureCode(failure);
  }
  switch (failure.stage) {
    case "bootstrap":
    case "frontend-bootstrap":
      return undefined;
    case "runtime":
      return `While ${formatFailureStage(failure.stage)}`;
    default:
      return `At ${formatFailureStage(failure.stage)}`;
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
    return "Saved data damaged";
  }

  // 2026-09 production readiness, Slice 5 (F09): the hardware link stopped
  // during the session; the sentence says whether Studio Control restarts
  // it on its own or is waiting for the operator.
  if (startupFailure?.code === "ENGINE_EXITED") {
    return "Link stopped";
  }

  // Slice 5 (F19): a second copy of the app was refused; the first one is
  // the one to use.
  if (startupFailure?.code === "ENGINE_ALREADY_RUNNING") {
    return "Already open";
  }

  // The visual overhaul (2026-10-05, the owner's answer): every word fits the
  // 440 px display at its 28 px size (`SAVED DATA NEEDS ATTENTION`, `THE
  // HARDWARE LINK STOPPED` and `STUDIO CONTROL IS ALREADY OPEN` were cut); the
  // sentence says it whole.
  //
  // Slice 8 gave every non-protocol failure the same word, so the stage no
  // longer branches: what failed is the startup, whichever step it stopped
  // at, and the display's meta line names the step (formatFailureMeta).
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

/**
 * The health snapshot's log excerpt as lines. The hardware link sends one
 * string (the last lines of its log, `native/protocol/v1.md`). A list is
 * still read, for a reply from an older build.
 */
export function readLogExcerpt(value: unknown): string[] {
  const lines = typeof value === "string" ? value.split(/\r?\n/) : Array.isArray(value) ? value : [];
  return lines.flatMap((line) => (typeof line === "string" && line.trim().length > 0 ? [line] : []));
}

export function formatPathLabel(key: string) {
  switch (key) {
    case "appDataDir":
      return "App data";
    case "backupDir":
      return "Backups folder";
    case "exportsDir":
      return "Exports";
    case "dbPath":
      return "Database path";
    case "logFilePath":
      return "Log file";
    case "logsDir":
      return "Logs";
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
