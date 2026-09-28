import { ArmKey, type ArmedKey, Key, Lamp, Section, Segmented, StateDisplay, Well } from "@sse/design-system";

import type { CommissioningCheck } from "../../shellData";
import { type SetupMode, UNPUBLISH_ARMED_SENTENCE } from "../setupPilotModel";
import type { SetupState } from "../setupState";
import styles from "./SetupCluster.module.css";

// Visual overhaul A, Slice 7 (system §2, §7; A-setup.html): Setup's cluster.
// What commissioning is, first and fixed, with the one key that gets the
// operator out of it; then Runner, Support or Cameras, the five steps in the order they
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
  /** The press that would unpublish the setup, armed: `step:<id>`, `back` or
   *  `run-all-probes` (owner's decision, 2026-09-28). */
  armed?: ArmedKey | null;
  busy?: boolean;
  canReturnToConsole: boolean;
  checks: readonly CommissioningCheck[];
  mode: SetupMode;
  state: SetupState;
  steps: readonly SetupClusterStep[];
  onExportBackup: () => void;
  onOpenEngineLog: () => void;
  onReturnToConsole: () => void;
  onRunAllProbes: () => void;
  onSelectMode: (mode: SetupMode) => void;
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
  armed = null,
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
  const probesArmed = armed?.key === "run-all-probes";

  // The way out of the state commissioning is in, as a key on the display.
  const stateActions =
    state.wayOut === "run-probes" ? (
      probesArmed && armed ? (
        <ArmKey
          armed
          timeoutMs={armed.timeoutMs}
          size="small"
          disabled={busy}
          countdownTestId="setup-state-run-probes-countdown"
          testId="setup-state-run-probes"
          onClick={onRunAllProbes}
        >
          Run all probes
        </ArmKey>
      ) : (
        <Key size="small" mode="primary" disabled={busy} testId="setup-state-run-probes" onClick={onRunAllProbes}>
          Run all probes
        </Key>
      )
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
        // While a press to unpublish is armed the sentence says what it locks.
        // The way out's own key says it is armed; the armed row is for the
        // others (the Teleprompter's rule), so everything fits the display.
        sentence={armed ? UNPUBLISH_ARMED_SENTENCE : state.sentence}
        // Its three lines take the meta line's room for the 3 s.
        meta={armed ? undefined : state.meta}
        armed={
          armed && !(probesArmed && state.wayOut === "run-probes")
            ? { text: `${armed.label} · press again`, timeoutMs: armed.timeoutMs }
            : null
        }
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
        <Key
          mode="segmented"
          cap="Cameras"
          take
          engaged={mode === "cameras"}
          aria-pressed={mode === "cameras"}
          testId="setup-mode-cameras"
          onClick={() => onSelectMode("cameras")}
        />
      </Segmented>

      <Section
        className={styles.section}
        title="Steps"
        detail={`${steps.length} · done in order`}
        testId="setup-steps-section"
      >
        <div className={styles.steps} role="tablist" aria-label="Commissioning runner">
          {steps.map((step, index) => {
            const stepArmed = armed?.key === `step:${step.id}`;
            return (
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
                data-armed={stepArmed ? "true" : "false"}
                data-testid={`setup-step-${step.id}`}
                onClick={() => onSelectStep(step.id)}
              >
                <span className={styles.stepNumber}>{index + 1}</span>
                <span className={styles.stepName}>{step.label}</span>
                <span className={styles.stepHint}>{step.hint}</span>
                <span className={styles.stepStanding}>
                  <Lamp tone={stepArmed ? "attention" : stepLampTone(step.standing)} />
                  {stepArmed ? "press again" : STANDING_WORD[step.standing]}
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section
        className={styles.section}
        title="Probes"
        detail={`${state.passedProbeCount} of ${state.probeCount} passed`}
        testId="setup-probes-section"
        actions={
          probesArmed && armed ? (
            <ArmKey
              armed
              timeoutMs={armed.timeoutMs}
              size="small"
              disabled={busy}
              countdownTestId="setup-run-all-probes-countdown"
              testId="setup-run-all-probes"
              onClick={onRunAllProbes}
            >
              Run all probes
            </ArmKey>
          ) : (
            <Key size="small" disabled={busy} testId="setup-run-all-probes" onClick={onRunAllProbes}>
              Run all probes
            </Key>
          )
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
          {/* New pages program, Slice 3 (D6): the key stays; its small print,
              the key that did the same, went with that key. */}
          <Key
            size="small"
            cap="Console"
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
