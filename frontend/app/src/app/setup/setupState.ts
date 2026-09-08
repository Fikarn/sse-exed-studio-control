import type { StateDisplayTone } from "@sse/design-system";

import type { CommissioningCheck } from "../shellData";

// Visual overhaul A, Slice 7 (plan D1, D12; A-setup.html): what commissioning
// is, in one word, the engine's own sentence, and one line of facts. Nothing
// here is inferred: the word comes from whether the engine says setup is
// published and what its three probes report, and the sentence is printed
// verbatim from the snapshot that carries it.

export type SetupStateWord = "READY" | "DEGRADED" | "SETUP REQUIRED";

export type SetupWayOut = "run-probes" | "start-runner" | null;

export interface SetupStateInput {
  /** The engine's three commissioning probes. */
  checks: readonly CommissioningCheck[];
  /** `Commissioning complete and operator mode unlocked.` */
  commissioningSummary: string | null;
  /** `22 Apr 2026 · 09:12`, or null when nothing has been exported. */
  lastBackupLabel: string | null;
  /** The engine's health sentence, which is what a degraded desk has to say. */
  healthSummary: string | null;
  healthTone: StateDisplayTone;
  /** True once the engine reports commissioning published. */
  published: boolean;
  /** 1-based position of the step the runner is on, and its name. */
  stepNumber: number;
  stepLabel: string;
  stepTotal: number;
}

export interface SetupState {
  word: SetupStateWord;
  tone: StateDisplayTone;
  /** The engine's sentence, verbatim. */
  sentence: string;
  /** Step · probes · backup. */
  meta: string;
  /** The one key that gets the operator out of this state. */
  wayOut: SetupWayOut;
  passedProbeCount: number;
  probeCount: number;
}

export function setupProbeCounts(checks: readonly CommissioningCheck[]) {
  return {
    passed: checks.filter((check) => check.status === "ok").length,
    total: checks.length,
  };
}

/** The probes that are not green, named — for the meta line and the dialog. */
export function setupUnverifiedProbeNames(checks: readonly CommissioningCheck[]) {
  return checks.filter((check) => check.status !== "ok").map((check) => check.label.toLowerCase());
}

export function deriveSetupState({
  checks,
  commissioningSummary,
  lastBackupLabel,
  healthSummary,
  healthTone,
  published,
  stepNumber,
  stepLabel,
  stepTotal,
}: SetupStateInput): SetupState {
  const { passed, total } = setupProbeCounts(checks);
  const allGreen = total > 0 && passed === total;
  const step = `Step ${stepNumber} of ${stepTotal} · ${stepLabel}`;
  const probes = total > 0 ? `${passed} of ${total} probes passed` : "no probes run yet";

  if (!published) {
    const unverified = setupUnverifiedProbeNames(checks);
    const tail = unverified.length > 0 ? `${unverified.join(" and ")} not yet verified` : "nothing verified yet";
    return {
      meta: `${step} · ${tail}`,
      passedProbeCount: passed,
      probeCount: total,
      sentence: commissioningSummary ?? "Complete commissioning to unlock operator mode.",
      tone: "attention",
      wayOut: "start-runner",
      word: "SETUP REQUIRED",
    };
  }

  if (!allGreen) {
    return {
      meta: `${step} · ${probes} · re-verify before publishing`,
      passedProbeCount: passed,
      probeCount: total,
      sentence: healthSummary ?? "Operator mode is available, but one of the commissioning probes needs attention.",
      tone: healthTone === "error" ? "error" : "attention",
      wayOut: "run-probes",
      word: "DEGRADED",
    };
  }

  return {
    meta: `${step} · ${probes}${lastBackupLabel ? ` · Backup ${lastBackupLabel}` : " · no backup exported yet"}`,
    passedProbeCount: passed,
    probeCount: total,
    sentence: commissioningSummary ?? "Commissioning complete and operator mode unlocked.",
    tone: "ok",
    wayOut: null,
    word: "READY",
  };
}
