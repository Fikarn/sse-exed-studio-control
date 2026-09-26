import { useCallback } from "react";

import { ConfirmDialog } from "@sse/design-system";
import type { SetupPilot } from "../useSetupPilot";

/** The pilot's confirmations: publishing over probes that are not green, and
 *  leaving a step. */
export function SetupPilotDialogs({ editor }: { editor: SetupPilot }) {
  const { publishOverridePrompt, setPublishOverridePrompt, pendingStepId, setPendingStepId } = editor.state;
  const { performAction, publishSetup, activateStep } = editor.actions;
  // A dialog moves focus in again whenever its close handler changes, so the
  // handlers keep one identity while the dialog is open: the Verify step asks
  // the deck twice a second, and every answer draws the pilot again.
  const cancelPublishOverride = useCallback(() => setPublishOverridePrompt(null), [setPublishOverridePrompt]);
  const cancelSkipAhead = useCallback(() => setPendingStepId(null), [setPendingStepId]);
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
          onCancel={cancelPublishOverride}
          onConfirm={() => {
            setPublishOverridePrompt(null);
            void performAction("publish-setup", () => publishSetup(true));
          }}
          title="Publish with failing probes?"
        />
      ) : null}

      {/* New pages program, Slice 3 (decision 11): a standard confirm, like the
          one above. It takes focus when it opens, Cancel or Esc closes it
          without skipping, and focus goes back to the step key that asked. */}
      {pendingStepId ? (
        <ConfirmDialog
          body="Preceding steps haven't been confirmed. Skipping may leave the commissioning incomplete."
          cancelLabel="Cancel"
          confirmLabel="Skip ahead"
          onCancel={cancelSkipAhead}
          onConfirm={() => {
            void activateStep(pendingStepId);
            setPendingStepId(null);
          }}
          title="Skip ahead?"
        />
      ) : null}
    </>
  );
}
