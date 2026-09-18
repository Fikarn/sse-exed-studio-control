import styles from "./SetupSupportPilot.module.css";
import { ShellRegion, StatusPill } from "@sse/design-system";
import { SetupCluster } from "./components/SetupCluster";
import { SetupImportStep } from "./steps/SetupImportStep";
import { SetupProbeStep } from "./steps/SetupProbeStep";
import { SetupMapVerifyStep } from "./steps/SetupMapVerifyStep";
import { SetupPublishStep } from "./steps/SetupPublishStep";
import { SetupSupportScreen } from "./support/SetupSupportScreen";
import { SetupWorkstationPlate } from "./support/SetupWorkstationPlate";
import { SetupFooter } from "./components/SetupFooter";
import { SetupPilotDialogs } from "./support/SetupPilotDialogs";
import {
  probeChecks,
  type RunnerStepId,
  feedbackStatus,
  APP_VERSION,
  runnerStepOrder,
  type SetupSupportPilotProps,
} from "./setupPilotModel";
import { useSetupPilot } from "./useSetupPilot";

/** Setup / Support. It assembles; it owns nothing. State and handlers live in
 *  `useSetupPilot`; the runner's steps are under `steps/`, the support surfaces
 *  under `support/`. */
export function SetupSupportPilot(props: SetupSupportPilotProps) {
  const editor = useSetupPilot(props);
  const { store } = props;
  const { busyAction, canReturnToConsole, checks, mode, feedback, runnerSteps, stepIndex } = editor.state;
  const { setupState, clusterSteps, openEngineLog } = editor.chrome;
  const { performAction, exportSupportBackup, persistMode, activateStep, runAllProbes, requestStepSelection } =
    editor.actions;
  return (
    <div className={styles.workspaceStack} data-testid="setup-workspace">
      <ShellRegion region="cluster">
        <SetupCluster
          busy={busyAction !== null}
          canReturnToConsole={canReturnToConsole}
          checks={probeChecks(checks)}
          mode={mode}
          state={setupState}
          steps={clusterSteps}
          onExportBackup={() => void performAction("support-export", exportSupportBackup)}
          onOpenEngineLog={openEngineLog}
          onReturnToConsole={() => void store.setWorkspace("planning")}
          onRunAllProbes={() => {
            persistMode("runner");
            void activateStep("probe");
            void performAction("run-all-probes", () => runAllProbes(true));
          }}
          onSelectMode={persistMode}
          onSelectStep={(stepId) => requestStepSelection(stepId as RunnerStepId)}
          onStartRunner={() => {
            persistMode("runner");
            void activateStep("import");
          }}
        />
      </ShellRegion>

      <div className={styles.body}>
        <main className={styles.bay} data-region={mode === "runner" ? "runner" : "support"}>
          {mode === "runner" ? (
            <>
              <SetupImportStep editor={editor} />
              <SetupProbeStep editor={editor} />
              <SetupMapVerifyStep editor={editor} />
              <SetupPublishStep editor={editor} />
            </>
          ) : (
            <SetupSupportScreen editor={editor} />
          )}

          {feedback ? (
            <div className={styles.feedbackBanner} data-testid="setup-feedback" data-tone={feedback.tone} role="status">
              <StatusPill
                label={feedback.tone === "ok" ? "Updated" : feedback.tone === "error" ? "Attention" : "Info"}
                tone={feedbackStatus(feedback) ?? "info"}
              />
              <span>{feedback.message}</span>
            </div>
          ) : null}
        </main>

        <aside className={styles.plateColumn} data-material="plate" data-region="support">
          <SetupWorkstationPlate editor={editor} />
        </aside>
      </div>

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
