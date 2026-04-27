import { Button } from "@sse/design-system";

import { asRecord, type SnapshotRecord } from "../shellData";
import styles from "../OperatorShell.module.css";

export function SetupStartupSurface({
  appSnapshot,
  onShowShortcuts,
}: {
  appSnapshot: SnapshotRecord | null;
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
      </div>
    </div>
  );
}
