import styles from "./SetupSupportPilot.module.css";
import { LampWord, ShellRegion } from "@sse/design-system";
import { SetupCluster } from "./components/SetupCluster";
import { SetupImportStep } from "./steps/SetupImportStep";
import { SetupProbeStep } from "./steps/SetupProbeStep";
import { SetupMapVerifyStep } from "./steps/SetupMapVerifyStep";
import { SetupPublishStep } from "./steps/SetupPublishStep";
import { SetupCamerasScreen } from "./support/SetupCamerasScreen";
import { SetupSupportScreen } from "./support/SetupSupportScreen";
import { SetupWorkstationPlate } from "./support/SetupWorkstationPlate";
import { SetupFooter } from "./components/SetupFooter";
import { SetupPilotDialogs } from "./support/SetupPilotDialogs";
import {
  probeChecks,
  type RunnerStepId,
  APP_VERSION,
  runnerStepOrder,
  type SetupSupportPilotProps,
} from "./setupPilotModel";
import { useSetupPilot } from "./useSetupPilot";

/** Setup / Support. It assembles; it owns nothing. State and handlers live in
 *  `useSetupPilot`; the runner's steps are under `steps/`, Support's and the
 *  cameras' screens under `support/`. */
export function SetupSupportPilot(props: SetupSupportPilotProps) {
  const editor = useSetupPilot(props);
  const { store } = props;
  const { busyAction, canReturnToConsole, checks, mode, feedback, recommendedStepId, runnerSteps, stepIndex, isReady } =
    editor.state;
  const { setupState, clusterSteps, openEngineLog, armedWords } = editor.chrome;
  const { arm } = editor.state;
  const {
    performAction,
    exportSupportBackup,
    persistMode,
    activateStep,
    runAllProbesFromCluster,
    requestStepSelection,
  } = editor.actions;
  return (
    <div className={styles.workspaceStack} data-testid="setup-workspace">
      <ShellRegion region="cluster">
        <SetupCluster
          arm={arm}
          armedWords={armedWords}
          busy={busyAction !== null}
          canReturnToConsole={canReturnToConsole}
          checks={probeChecks(checks)}
          mode={mode}
          nextStepId={recommendedStepId}
          published={isReady}
          state={setupState}
          steps={clusterSteps}
          onExportBackup={() => void performAction("support-export", exportSupportBackup)}
          onOpenEngineLog={openEngineLog}
          onReturnToConsole={() => void store.setWorkspace("audio")}
          onRunAllProbes={runAllProbesFromCluster}
          onSelectMode={persistMode}
          onSelectStep={(stepId) => requestStepSelection(stepId as RunnerStepId)}
          onStartRunner={() => {
            persistMode("runner");
            void activateStep(recommendedStepId);
          }}
        />
      </ShellRegion>

      <div className={styles.body}>
        <main className={styles.bay} data-region={mode === "runner" ? "runner" : "support"} data-mode={mode}>
          {mode === "runner" ? (
            <>
              <SetupImportStep editor={editor} />
              <SetupProbeStep editor={editor} />
              <SetupMapVerifyStep editor={editor} />
              <SetupPublishStep editor={editor} />
            </>
          ) : mode === "cameras" ? (
            <SetupCamerasScreen editor={editor} camerasSnapshot={props.camerasSnapshot} />
          ) : (
            <SetupSupportScreen editor={editor} />
          )}

          {/* The last result, in one place at the bay's foot, whatever the
              screen above it is. */}
          {feedback ? (
            <div className={styles.feedback} data-testid="setup-feedback" data-tone={feedback.tone} role="status">
              <LampWord
                tone={feedback.tone === "ok" ? "ok" : feedback.tone === "error" ? "error" : "info"}
                cap={false}
                className={styles.feedbackWords}
              >
                {feedback.message}
              </LampWord>
            </div>
          ) : null}
        </main>
      </div>

      {/* The shell (overhaul 3): one plate mechanism for every page. */}
      <ShellRegion region="plate">
        <SetupWorkstationPlate editor={editor} />
      </ShellRegion>

      <ShellRegion region="footer">
        <SetupFooter
          appVersion={APP_VERSION}
          commissioningWord={
            setupState.word === "READY"
              ? "published"
              : setupState.word === "DEGRADED"
                ? "needs re-verification"
                : "setup required"
          }
          passedProbeCount={setupState.passedProbeCount}
          probeCount={setupState.probeCount}
          stepLabel={runnerSteps[stepIndex]?.label ?? ""}
          stepNumber={stepIndex + 1}
          stepTotal={runnerStepOrder.length}
        />
      </ShellRegion>

      <SetupPilotDialogs editor={editor} />
    </div>
  );
}
