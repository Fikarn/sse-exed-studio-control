import { Button, StatusBadge } from "@sse/design-system";
import type { ShellState } from "@sse/engine-client";

import { asRecord, type SnapshotRecord } from "../shellData";
import styles from "../OperatorShell.module.css";
import { buildStartupSteps, stepStatusLabel } from "./startupHelpers";

export function SetupStartupSurface({
  appSnapshot,
  lifecycle,
  onShowShortcuts,
}: {
  appSnapshot: SnapshotRecord | null;
  lifecycle: ShellState["lifecycle"];
  onShowShortcuts: () => void;
}) {
  const shell = asRecord(appSnapshot?.shell);
  const setup = asRecord(shell?.setup);
  const startup = asRecord(appSnapshot?.startup);
  const canReturnToConsole = String(startup?.targetSurface ?? "commissioning") === "dashboard";
  const activeSection = setup?.activeSection === "support" ? "support" : "commissioning";

  return (
    <div className={styles.setupLoadingShell}>
      <div className={styles.setupUtilityRow}>
        <div className={styles.setupUtilityActions}>
          <Button disabled={!canReturnToConsole} variant="ghost">
            Back to Console
          </Button>
        </div>
        <div className={styles.setupUtilityMeta}>
          <div className={styles.setupUtilityEyebrow}>Setup / Support</div>
          <div className={styles.setupUtilityTitle}>Commissioning runner</div>
        </div>
        <div className={styles.setupUtilityActions}>
          <Button disabled size="compact" variant={activeSection === "commissioning" ? "primary" : "secondary"}>
            Runner
          </Button>
          <Button disabled size="compact" variant={activeSection === "support" ? "primary" : "secondary"}>
            Support
          </Button>
          <Button onClick={onShowShortcuts} size="compact" variant="ghost">
            Shortcuts
          </Button>
        </div>
      </div>
      <div aria-live="polite" className={styles.setupLoadingState} role="status">
        <div className={styles.setupLoadingLabel}>STARTING ENGINE…</div>
        <div aria-hidden="true" className={styles.setupLoadingPulse} />
        {/* STA-05: surface the engine-handshake progress on the primary cold-boot
            screen (was just the label + pulse), reusing the shared startup steps. */}
        <div className={styles.setupLoadingSteps}>
          <div className={styles.stepList}>
            {buildStartupSteps(lifecycle).map((step) => (
              <div key={step.label} className={styles.stepItem}>
                <div>
                  <div className={styles.stepLabel}>{step.label}</div>
                  <div className={styles.stepDetail}>{step.description}</div>
                </div>
                <StatusBadge label={stepStatusLabel(step.tone)} tone={step.tone} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
