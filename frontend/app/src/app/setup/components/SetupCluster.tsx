import { Key, Lamp, Section, Segmented, StateDisplay, Well } from "@sse/design-system";

import { formatShortcut } from "../../shared/shortcutGlyphs";

import type { CommissioningCheck } from "../../shellData";
import type { SetupState } from "../setupState";
import styles from "./SetupCluster.module.css";

// Visual overhaul A, Slice 7 (system §2, §7; A-setup.html): Setup's cluster.
// What commissioning is, first and fixed, with the one key that gets the
// operator out of it; then Runner or Support, the five steps in the order they
// are done, the three probes with what each one reports, and the standing
// actions at the foot. The steps and the probes are keys, not tabs: a step is a
// place the operator goes, and a probe is a thing the desk says.

export interface SetupClusterStep {
  id: string;
  label: string;
  hint: string;
  /** `done`, `current` or `pending` — the lamp and the word both read off it. */
  standing: "done" | "current" | "pending" | "failed";
}

export interface SetupClusterProps {
  busy?: boolean;
  canReturnToConsole: boolean;
  checks: readonly CommissioningCheck[];
  mode: "runner" | "support";
  state: SetupState;
  steps: readonly SetupClusterStep[];
  onExportBackup: () => void;
  onOpenEngineLog: () => void;
  onReturnToConsole: () => void;
  onRunAllProbes: () => void;
  onSelectMode: (mode: "runner" | "support") => void;
  onSelectStep: (stepId: string) => void;
  onStartRunner: () => void;
}

const STANDING_WORD: Record<SetupClusterStep["standing"], string> = {
  current: "current",
  done: "done",
  failed: "failed",
  pending: "pending",
};

function stepLampTone(standing: SetupClusterStep["standing"]) {
  if (standing === "done") return "ok" as const;
  if (standing === "failed") return "error" as const;
  if (standing === "current") return "attention" as const;
  return "off" as const;
}

function probeLampTone(status: CommissioningCheck["status"]) {
  if (status === "ok") return "ok" as const;
  if (status === "error") return "error" as const;
  return "attention" as const;
}

function probeWord(status: CommissioningCheck["status"]) {
  if (status === "ok") return "passed";
  if (status === "error") return "failed";
  return "attention";
}

export function SetupCluster({
  busy = false,
  canReturnToConsole,
  checks,
  mode,
  state,
  steps,
  onExportBackup,
  onOpenEngineLog,
  onReturnToConsole,
  onRunAllProbes,
  onSelectMode,
  onSelectStep,
  onStartRunner,
}: SetupClusterProps) {
  const firstStep = steps[0];

  // The way out of the state commissioning is in, as a key on the display.
  const stateActions =
    state.wayOut === "run-probes" ? (
      <Key size="small" mode="primary" disabled={busy} testId="setup-state-run-probes" onClick={onRunAllProbes}>
        Run all probes
      </Key>
    ) : state.wayOut === "start-runner" && firstStep ? (
      <Key size="small" mode="primary" testId="setup-state-start" onClick={onStartRunner}>
        Start with {firstStep.label}
      </Key>
    ) : null;

  return (
    <div className={styles.cluster} data-setup-cluster="" data-testid="setup-cluster">
      <StateDisplay
        tone={state.tone}
        word={state.word}
        sentence={state.sentence}
        meta={state.meta}
        actions={stateActions}
        data-toolbar-primary="title"
        testId="setup-state-display"
      />

      <Segmented label="Setup mode" className={styles.modeSwitch} testId="setup-mode-switch">
        <Key
          mode="segmented"
          cap="Runner"
          take
          engaged={mode === "runner"}
          aria-pressed={mode === "runner"}
          testId="setup-mode-runner"
          onClick={() => onSelectMode("runner")}
        />
        <Key
          mode="segmented"
          cap="Support"
          take
          engaged={mode === "support"}
          aria-pressed={mode === "support"}
          testId="setup-mode-support"
          onClick={() => onSelectMode("support")}
        />
      </Segmented>

      <Section
        className={styles.section}
        title="Steps"
        detail={`${steps.length} · done in order`}
        testId="setup-steps-section"
      >
        <div className={styles.steps} role="tablist" aria-label="Commissioning runner">
          {steps.map((step, index) => (
            <button
              key={step.id}
              type="button"
              role="tab"
              aria-selected={step.standing === "current"}
              aria-label={`Step ${index + 1} ${step.label}`}
              className={styles.step}
              data-material="key"
              data-current={step.standing === "current"}
              data-standing={step.standing}
              data-testid={`setup-step-${step.id}`}
              onClick={() => onSelectStep(step.id)}
            >
              <span className={styles.stepNumber}>{index + 1}</span>
              <span className={styles.stepName}>{step.label}</span>
              <span className={styles.stepHint}>{step.hint}</span>
              <span className={styles.stepStanding}>
                <Lamp tone={stepLampTone(step.standing)} />
                {STANDING_WORD[step.standing]}
              </span>
            </button>
          ))}
        </div>
      </Section>

      <Section
        className={styles.section}
        title="Probes"
        detail={`${state.passedProbeCount} of ${state.probeCount} passed`}
        testId="setup-probes-section"
        actions={
          <Key size="small" disabled={busy} testId="setup-run-all-probes" onClick={onRunAllProbes}>
            Run all probes
          </Key>
        }
      >
        <div className={styles.probes}>
          {checks.map((check) => (
            <Well key={check.id} className={styles.probe} data-testid={`setup-probe-${check.id}`}>
              <Lamp tone={probeLampTone(check.status)} />
              <span className={styles.probeName}>{check.label}</span>
              <span className={styles.probeDetail}>{check.detail}</span>
              <span className={styles.probeStanding} data-status={check.status}>
                {probeWord(check.status)}
              </span>
            </Well>
          ))}
        </div>
      </Section>

      <Section className={styles.actions} title="Workstation" testId="setup-standing-actions">
        <div className={styles.actionRow}>
          <Key size="small" disabled={busy} testId="setup-export-backup" onClick={onExportBackup}>
            Export backup
          </Key>
          <Key size="small" disabled={busy} testId="setup-engine-log" onClick={onOpenEngineLog}>
            Engine log
          </Key>
          <Key
            size="small"
            cap="Console"
            hint={formatShortcut(["mod", "3"])}
            disabled={!canReturnToConsole}
            aria-label="Back to the console"
            testId="setup-back-to-console"
            onClick={onReturnToConsole}
          />
        </div>
      </Section>
    </div>
  );
}
