import {
  ArmKey,
  type ArmedKey,
  Key,
  LampWord,
  LatchSlot,
  MenuButton,
  type MenuEntry,
  Section,
  Segmented,
  StateDisplay,
  Tooltip,
  type UseArmResult,
} from "@sse/design-system";

import type { CommissioningCheck } from "../../shellData";
import { isUnpublishArm, RUN_PROBES_ARM_KEY, setupArmKey } from "../setupArming";
import { type SetupMode, UNPUBLISH_ARMED_SENTENCE } from "../setupPilotModel";
import { probeTone, probeWord, type SetupState } from "../setupState";
import styles from "./SetupCluster.module.css";

// Setup's cluster (the visual overhaul, 2026-10-05; DESIGN.md §2, §7): what the
// setup is, first and fixed, with the one key that gets the operator out of
// it; then Runner, Support or Cameras, the five steps in the order they are
// done, and the three probes with what each one reports. The steps are keys,
// not tabs of a panel: a step is a place the operator goes, and a probe is a
// thing the hardware says. The standing commands live in the page's ⋯.
//
// On a published setup a press that moves the runner unpublishes it, so it
// arms first (the one armed form, Burgundy with its countdown, in the key's
// own height) and says so at rest: `press twice`.

export interface SetupClusterStep {
  id: string;
  label: string;
  hint: string;
  /** `done`, `current`, `pending` or `failed`: the lamp and the word read off it. */
  standing: "done" | "current" | "pending" | "failed";
  /** The step the runner shows, while the bay shows the runner: the Beige selection. */
  shown: boolean;
  /** A press on it arms first: the setup is published and the press would move it. */
  armsFirst: boolean;
}

export interface SetupClusterProps {
  /** The page's arm: the menu takes it, so two keys are never armed at once. */
  arm: UseArmResult;
  /** What the armed key's second press does, in the page's words; `null` with nothing armed. */
  armedWords: string | null;
  busy?: boolean;
  /** The way back (the page's ⋯) is open: the setup is published. */
  canReturnToConsole: boolean;
  checks: readonly CommissioningCheck[];
  mode: SetupMode;
  /** The step the saved setup stands at: the key out of `SETUP REQUIRED` goes
   *  there. */
  nextStepId: string;
  /** The setup is published: a press that moves the runner arms first. */
  published: boolean;
  state: SetupState;
  steps: readonly SetupClusterStep[];
  onExportBackup: () => void;
  onOpenEngineLog: () => void;
  /** Back to the Overview (D47; its name is from when it went to the Console). */
  onReturnToConsole: () => void;
  onRunAllProbes: () => void;
  onSelectMode: (mode: SetupMode) => void;
  onSelectStep: (stepId: string) => void;
  onStartRunner: () => void;
}

const MODES: { mode: SetupMode; label: string }[] = [
  { mode: "runner", label: "Runner" },
  { mode: "support", label: "Support" },
  { mode: "cameras", label: "Cameras" },
  { mode: "console", label: "Console" },
];

function stepTone(standing: SetupClusterStep["standing"]) {
  if (standing === "done") return "ok" as const;
  if (standing === "failed") return "error" as const;
  if (standing === "current") return "attention" as const;
  return "off" as const;
}

/** `Run all probes`, which arms first on a published setup, in its one armed form. */
function RunProbesKey({
  armed,
  published,
  busy,
  testId,
  onClick,
}: {
  armed: ArmedKey | null;
  published: boolean;
  busy: boolean;
  testId: string;
  onClick: () => void;
}) {
  const isArmed = armed?.key === RUN_PROBES_ARM_KEY;
  return (
    <ArmKey
      armed={isArmed}
      timeoutMs={armed?.timeoutMs ?? 0}
      size="small"
      disabled={busy}
      className={styles.armRow}
      countdownTestId={`${testId}-countdown`}
      testId={testId}
      onClick={onClick}
    >
      {published && !isArmed ? "Run all probes · press twice" : "Run all probes"}
    </ArmKey>
  );
}

export function SetupCluster({
  arm,
  armedWords,
  busy = false,
  canReturnToConsole,
  checks,
  mode,
  nextStepId,
  published,
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
  const armed = arm.armed;
  // The key out of `SETUP REQUIRED` goes to the step the saved setup stands
  // at, and names it (Found, to check, 2026-09-29): it read `Start with Import
  // profile` on every step, and its press moved the saved setup back to step 1.
  const nextStep = steps.find((step) => step.id === nextStepId) ?? steps[0];
  const nextStepVerb = nextStep === steps[0] ? "Start with" : "Continue with";
  const probesArmed = armed?.key === RUN_PROBES_ARM_KEY;
  const unpublishArmed = isUnpublishArm(armed?.key);

  // The way out of the state the setup is in, as a key on the display.
  const stateActions =
    state.wayOut === "run-probes" ? (
      <RunProbesKey
        armed={armed}
        published={published}
        busy={busy}
        testId="setup-state-run-probes"
        onClick={onRunAllProbes}
      />
    ) : state.wayOut === "start-runner" && nextStep ? (
      <Key size="small" mode="primary" testId="setup-state-start" onClick={onStartRunner}>
        {nextStepVerb} {nextStep.label}
      </Key>
    ) : null;

  // The page's ⋯ on the state display: the standing commands, with the test
  // ids their keys had. None of them arms.
  const busyReason = busy ? "another action is running" : undefined;
  const pageMenu: MenuEntry[] = [
    {
      id: "export-backup",
      label: "Export backup",
      onSelect: onExportBackup,
      disabledReason: busyReason,
      testId: "setup-export-backup",
    },
    {
      id: "engine-log",
      label: "Open the log",
      onSelect: onOpenEngineLog,
      disabledReason: busyReason,
      testId: "setup-engine-log",
    },
    { kind: "divider", id: "divider" },
    // D47: the way back is to the Overview, the page the app opens on (the
    // Console until then); the test id is the key's, as it was.
    {
      id: "overview",
      label: "Back to the Overview",
      onSelect: onReturnToConsole,
      disabledReason: canReturnToConsole ? undefined : "the setup is not published",
      testId: "setup-back-to-console",
    },
  ];

  // The way out's own key says it is armed; the armed row is for the others
  // (the Teleprompter's rule). While the row shows, it takes the display's
  // foot whole and the way-out key gives way: beside the key the row's words
  // were cut. A press on the hidden key would only have armed it instead.
  const armedRow =
    armed && armedWords && !(probesArmed && state.wayOut === "run-probes")
      ? { text: `${armedWords} · press again`, timeoutMs: armed.timeoutMs, armedAt: armed.armedAt }
      : null;

  return (
    <div className={styles.cluster} data-setup-cluster="" data-testid="setup-cluster">
      <StateDisplay
        tone={state.tone}
        word={state.word}
        // While a press to unpublish is armed the sentence says what it locks;
        // the armed row says what the second press does.
        sentence={unpublishArmed ? UNPUBLISH_ARMED_SENTENCE : state.sentence}
        meta={armed ? undefined : (state.meta ?? undefined)}
        armed={armedRow}
        actions={armedRow ? undefined : stateActions}
        data-toolbar-primary="title"
        testId="setup-state-display"
        menu={
          <MenuButton
            buttonLabel="Setup menu"
            buttonTestId="setup-page-menu"
            menu={{ head: { title: "Setup / Support" }, items: pageMenu, arm }}
          />
        }
      />

      {/* The shell (overhaul 3): the latch slot, the same on every page. */}
      <LatchSlot testId="setup-latch-slot" />

      {/* What the bay shows: a setting of the page, so its choice is the Beige
          selection, not a lit fill. */}
      <Segmented label="Setup mode" className={styles.modeSwitch} testId="setup-mode-switch">
        {MODES.map(({ mode: each, label }) => (
          <Key
            key={each}
            mode="segmented"
            selected={mode === each}
            aria-pressed={mode === each}
            testId={`setup-mode-${each}`}
            onClick={() => onSelectMode(each)}
          >
            {label}
          </Key>
        ))}
      </Segmented>

      <Section
        className={styles.section}
        title={
          <Tooltip content="Done in order; a step ahead of the setup asks first." placement="right">
            <span>Steps</span>
          </Tooltip>
        }
        detail={`${steps.filter((step) => step.standing === "done").length} of ${steps.length} done`}
        testId="setup-steps-section"
      >
        <div className={styles.steps} role="tablist" aria-label="Commissioning runner">
          {steps.map((step, index) => {
            const stepArmed = armed?.key === setupArmKey.step(step.id);
            return (
              <div key={step.id} className={styles.stepCell}>
                <Tooltip content={step.hint} placement="right">
                  <ArmKey
                    armed={stepArmed}
                    timeoutMs={armed?.timeoutMs ?? 0}
                    selected={step.shown}
                    role="tab"
                    aria-selected={step.shown}
                    aria-label={`Step ${index + 1} ${step.label}`}
                    className={[styles.step, styles.armRow].join(" ")}
                    data-current={step.shown}
                    data-standing={step.standing}
                    countdownTestId={`setup-step-${step.id}-countdown`}
                    testId={`setup-step-${step.id}`}
                    onClick={() => onSelectStep(step.id)}
                  >
                    {stepArmed ? (
                      step.label
                    ) : (
                      <span className={styles.stepFace}>
                        <span className={styles.stepNumber}>{index + 1}</span>
                        <span className={styles.stepName}>{step.label}</span>
                        {step.armsFirst ? <span className={styles.stepTwice}>press twice</span> : null}
                        <LampWord tone={stepTone(step.standing)} className={styles.stepStanding}>
                          {step.standing}
                        </LampWord>
                      </span>
                    )}
                  </ArmKey>
                </Tooltip>
              </div>
            );
          })}
        </div>
      </Section>

      <Section
        className={styles.section}
        title={
          <Tooltip
            content="What the deck, the bridge and the desk answered when they were last asked."
            placement="right"
          >
            <span>Probes</span>
          </Tooltip>
        }
        detail={`${state.passedProbeCount} of ${state.probeCount} passed`}
        testId="setup-probes-section"
      >
        <ul className={styles.probes}>
          {checks.map((check) => (
            <li key={check.id} className={styles.probe} data-testid={`setup-probe-${check.id}`}>
              <span className={styles.probeName}>{check.label}</span>
              <LampWord tone={probeTone(check.status)} className={styles.probeStanding}>
                {probeWord(check.status)}
              </LampWord>
              <span className={styles.probeDetail}>{check.detail}</span>
            </li>
          ))}
        </ul>
        {/* Across the column at the section's foot, so its armed form has the
            room it needs and moves nothing. While the display offers Run all
            probes as its way out, the section leaves it there: one key, one arm. */}
        {state.wayOut === "run-probes" ? null : (
          <div className={styles.probesKey}>
            <RunProbesKey
              armed={armed}
              published={published}
              busy={busy}
              testId="setup-run-all-probes"
              onClick={onRunAllProbes}
            />
          </div>
        )}
      </Section>
    </div>
  );
}
