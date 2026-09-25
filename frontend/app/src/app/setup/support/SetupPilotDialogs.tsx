import { ConfirmDialog, Surface, Button } from "@sse/design-system";
import styles from "../SetupSupportPilot.module.css";
import type { SetupPilot } from "../useSetupPilot";

/** The pilot's confirmations: publishing over probes that are not green, and
 *  leaving a step. */
export function SetupPilotDialogs({ editor }: { editor: SetupPilot }) {
  const { publishOverridePrompt, setPublishOverridePrompt, pendingStepId, setPendingStepId } = editor.state;
  const { performAction, publishSetup, activateStep } = editor.actions;
  return (
    <>
      {publishOverridePrompt ? (
        <ConfirmDialog
          body={
            <>
              <p>These probes are not green:</p>
              <ul>
                {publishOverridePrompt.map((entry) => (
                  <li key={entry}>{entry}</li>
                ))}
              </ul>
              <p>
                Publishing anyway unlocks operator mode with unverified hardware. The override is recorded in the setup
                summary and the Engine log.
              </p>
            </>
          }
          cancelLabel="Cancel"
          confirmLabel="Publish anyway"
          danger
          onCancel={() => setPublishOverridePrompt(null)}
          onConfirm={() => {
            setPublishOverridePrompt(null);
            void performAction("publish-setup", () => publishSetup(true));
          }}
          title="Publish with failing probes?"
        />
      ) : null}

      {pendingStepId ? (
        <div className={styles.jumpScrim} role="presentation">
          <Surface
            aria-labelledby="setup-jump-title"
            aria-modal="true"
            className={styles.jumpSurface}
            padding="lg"
            role="dialog"
            tone="raised"
          >
            <div className={styles.dialogTitle} id="setup-jump-title">
              Skip ahead?
            </div>
            <p className={styles.dialogBody}>
              Preceding steps haven&apos;t been confirmed. Skipping may leave the commissioning incomplete.
            </p>
            <div className={styles.dialogActions}>
              <Button variant="ghost" onClick={() => setPendingStepId(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  void activateStep(pendingStepId);
                  setPendingStepId(null);
                }}
              >
                Skip ahead
              </Button>
            </div>
          </Surface>
        </div>
      ) : null}
    </>
  );
}
