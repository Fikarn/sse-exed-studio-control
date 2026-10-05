import type { SetupClusterStep } from "../components/SetupCluster";
import { deriveSetupState } from "../setupState";
import { formatBackupTimestamp, formatShortTimestamp } from "../../shellData";
import { ArmKey, Key, Tooltip } from "@sse/design-system";
import styles from "../SetupSupportPilot.module.css";
import { BACK_ARM_KEY, setupArmedWords } from "../setupArming";
import { probeChecks, runnerStepOrder, type SetupSupportPilotProps } from "../setupPilotModel";
import type { SetupPilotState } from "./useSetupPilotState";
import type { SetupPilotActions } from "./useSetupPilotActions";

/** The pieces every screen of the pilot shares: the cluster's steps, the setup
 *  state word, the armed row's words, the primary and back keys, the bay's
 *  head, and which probes have not passed. Derivations only. */
export function useSetupPilotChrome({
  props,
  state,
  actions,
}: {
  props: SetupSupportPilotProps;
  state: SetupPilotState;
  actions: SetupPilotActions;
}) {
  const { commissioningSnapshot } = props;
  const {
    runnerSteps,
    probeHasError,
    activeStepId,
    stepIndex,
    isReady,
    checks,
    degradedSummary,
    healthTone,
    lastBackup,
    runtimePaths,
    busyAction,
    mode,
    arm,
  } = state;
  const { performAction, openReferencePath, invokePrimaryAction, primaryActionLabel, moveStepSelection } = actions;
  // The runner's steps as the cluster prints them: done, current (the step the
  // setup is at and has not done), pending or failed, with a probe failure on
  // the step that runs the probes. The step shown is the Beige selection, and
  // on a published setup every step before it arms first (a forward step asks
  // in "Skip ahead?", and Publish, where a published setup stands, goes
  // nowhere).
  const clusterSteps: SetupClusterStep[] = runnerSteps.map((step, index) => ({
    hint: step.hint,
    id: step.id,
    label: step.label,
    standing:
      step.id === "probe" && probeHasError
        ? "failed"
        : index < stepIndex || (step.id === "publish" && isReady)
          ? "done"
          : step.id === activeStepId
            ? "current"
            : "pending",
    shown: step.id === activeStepId,
    armsFirst: isReady && index < stepIndex,
  }));

  const setupState = deriveSetupState({
    checks: probeChecks(checks),
    commissioningSummary: typeof commissioningSnapshot?.summary === "string" ? commissioningSnapshot.summary : null,
    healthSummary: degradedSummary,
    healthTone: healthTone === "error" ? "error" : healthTone === "attention" ? "attention" : "ok",
    lastBackupLabel: lastBackup ? formatShortTimestamp(lastBackup.modifiedAt) : null,
    published: isReady,
    stepLabel: runnerSteps[stepIndex]?.label ?? "Import profile",
    stepNumber: stepIndex + 1,
    stepTotal: runnerStepOrder.length,
  });

  const engineLogPath = String(runtimePaths?.logFilePath ?? "");
  const openEngineLog = () => {
    void performAction("open-engine-log", () => openReferencePath("The log", engineLogPath));
  };

  const previousStep = runnerSteps[stepIndex - 1] ?? null;
  // What the armed key's second press does, for the state display's armed row.
  const armedWords = arm.armed
    ? setupArmedWords(arm.armed, {
        step: (stepId) => runnerSteps.find((step) => step.id === stepId)?.label ?? null,
        back: previousStep?.label ?? null,
      })
    : null;

  const primaryKey = (
    <Key
      mode="primary"
      size="large"
      disabled={busyAction !== null}
      testId="setup-step-primary"
      onClick={() => invokePrimaryAction()}
    >
      {busyAction ? "Working…" : primaryActionLabel}
    </Key>
  );

  // On a published setup the key arms first, and says so: going back
  // unpublishes it. It is the one armed form in the key's own height.
  const backArmed = arm.armed?.key === BACK_ARM_KEY;
  const backLabel = `Back to ${previousStep?.label ?? "the previous step"}`;
  const backKey =
    stepIndex > 0 ? (
      <ArmKey
        armed={backArmed}
        timeoutMs={arm.armed?.timeoutMs ?? 0}
        size="large"
        className={styles.armRow}
        countdownTestId="setup-step-back-countdown"
        testId="setup-step-back"
        onClick={() => moveStepSelection(-1)}
      >
        {isReady && !backArmed ? `${backLabel} · press twice` : backLabel}
      </ArmKey>
    ) : null;

  // The bay's head: what the bay shows, its sentence in the tooltip.
  const bayHead = (
    <Tooltip
      content={
        mode === "runner"
          ? `Step ${stepIndex + 1} of ${runnerStepOrder.length}. Each step is finished before the next one opens; the last commits everything above it.`
          : mode === "cameras"
            ? "What Studio Control holds for each camera. Not a step of the runner."
            : "What to do when something is wrong, and the backups to do it from."
      }
      placement="bottom"
    >
      <span className={styles.bayTitle}>
        {mode === "runner" ? "Commissioning runner" : mode === "cameras" ? "Camera setup" : "Support"}
      </span>
    </Tooltip>
  );

  const publishOverrideRecorded =
    typeof commissioningSnapshot?.publishOverrideAt === "string" && commissioningSnapshot.publishOverrideAt
      ? formatBackupTimestamp(commissioningSnapshot.publishOverrideAt)
      : null;
  const notPassedProbes = probeChecks(checks).filter((check) => check.status !== "ok");
  return {
    clusterSteps,
    setupState,
    armedWords,
    engineLogPath,
    openEngineLog,
    primaryKey,
    backKey,
    bayHead,
    publishOverrideRecorded,
    notPassedProbes,
  };
}

export type SetupPilotChrome = ReturnType<typeof useSetupPilotChrome>;
