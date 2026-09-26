import type { SetupClusterStep } from "../components/SetupCluster";
import { deriveSetupState } from "../setupState";
import { formatBackupTimestamp } from "../../shellData";
import { Key } from "@sse/design-system";
import styles from "../SetupSupportPilot.module.css";
import { probeChecks, runnerStepOrder, type SetupSupportPilotProps } from "../setupPilotModel";
import type { SetupPilotState } from "./useSetupPilotState";
import type { SetupPilotActions } from "./useSetupPilotActions";

/** The pieces every screen of the pilot shares: the cluster's steps, the setup
 *  state word, the primary and back keys, the bay's head, and which probes have
 *  not passed. Derivations only. */
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
  } = state;
  const { performAction, openReferencePath, invokePrimaryAction, primaryActionLabel, moveStepSelection } = actions;
  // Visual overhaul A, Slice 7: the runner's steps as the cluster prints them —
  // done, current or pending, with a probe failure showing on the step that
  // runs the probes.
  const clusterSteps: SetupClusterStep[] = runnerSteps.map((step, index) => ({
    hint: step.hint,
    id: step.id,
    label: step.label,
    standing:
      step.id === "probe" && probeHasError
        ? "failed"
        : step.id === activeStepId
          ? "current"
          : index < stepIndex || (step.id === "publish" && isReady)
            ? "done"
            : "pending",
  }));

  const setupState = deriveSetupState({
    checks: probeChecks(checks),
    commissioningSummary: typeof commissioningSnapshot?.summary === "string" ? commissioningSnapshot.summary : null,
    healthSummary: degradedSummary,
    healthTone: healthTone === "error" ? "error" : healthTone === "attention" ? "attention" : "ok",
    lastBackupLabel: lastBackup ? formatBackupTimestamp(lastBackup.modifiedAt) : null,
    published: isReady,
    stepLabel: runnerSteps[stepIndex]?.label ?? "Import profile",
    stepNumber: stepIndex + 1,
    stepTotal: runnerStepOrder.length,
  });

  const engineLogPath = String(runtimePaths?.logFilePath ?? "");
  const openEngineLog = () => {
    void performAction("open-engine-log", () => openReferencePath("Engine log", engineLogPath));
  };

  const primaryKey = (
    <Key
      mode="primary"
      take
      disabled={busyAction !== null}
      testId="setup-step-primary"
      onClick={() => invokePrimaryAction()}
    >
      {busyAction ? "Working…" : primaryActionLabel}
    </Key>
  );

  const backKey =
    stepIndex > 0 ? (
      <Key take testId="setup-step-back" onClick={() => moveStepSelection(-1)}>
        Back to {runnerSteps[stepIndex - 1]?.label ?? "the previous step"}
      </Key>
    ) : null;

  const bayHead = (
    <>
      <span className={styles.bayTitle}>{mode === "runner" ? "Commissioning runner" : "Support dashboard"}</span>
      <span className={styles.bayDetail}>
        {mode === "runner"
          ? `step ${stepIndex + 1} of ${runnerStepOrder.length} · ${
              activeStepId === "publish"
                ? "the last step commits everything above it"
                : "each step is finished before the next one opens"
            }`
          : "what to do when something is wrong, and the archives to do it from"}
      </span>
    </>
  );

  const publishOverrideRecorded =
    typeof commissioningSnapshot?.publishOverrideAt === "string" && commissioningSnapshot.publishOverrideAt
      ? formatBackupTimestamp(commissioningSnapshot.publishOverrideAt)
      : null;
  const notPassedProbes = probeChecks(checks).filter((check) => check.status !== "ok");
  return {
    clusterSteps,
    setupState,
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
