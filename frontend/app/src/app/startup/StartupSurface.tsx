import { Button, MetricCard, StatusBadge, Surface } from "@sse/design-system";
import type { ShellState } from "@sse/engine-client";

import { formatLifecycleLabel } from "../shellData";
import styles from "../OperatorShell.module.css";
import { buildStartupSteps } from "./startupHelpers";

export function StartupSurface({
  lifecycle,
  onShowShortcuts,
}: {
  lifecycle: ShellState["lifecycle"];
  onShowShortcuts: () => void;
}) {
  const steps = buildStartupSteps(lifecycle);

  return (
    <div className={styles.stateShell}>
      <Surface className={styles.stateSurface} padding="lg" tone="raised">
        <div className={styles.stateHeader}>
          <div>
            <div className={styles.stateEyebrow}>Frontend foundation</div>
            <h1 className={styles.stateTitle}>Starting operator shell</h1>
            <p className={styles.stateSubtitle}>
              The replacement shell waits for the engine handshake before operator UI is allowed to render.
            </p>
          </div>
          <StatusBadge label={formatLifecycleLabel(lifecycle)} tone="connected" />
        </div>
        <div className={styles.metricGrid}>
          <MetricCard caption="Lifecycle" tone="connected" value={formatLifecycleLabel(lifecycle)} />
          <MetricCard caption="Target surface" tone="idle" value="Setup / Support" />
          <MetricCard caption="Render mode" tone="ready" value="Native webview shell" />
        </div>
        <div className={styles.stepList}>
          {steps.map((step) => (
            <div key={step.label} className={styles.stepItem}>
              <div>
                <div className={styles.stepLabel}>{step.label}</div>
                <div className={styles.stepDetail}>{step.description}</div>
              </div>
              <StatusBadge label={step.tone} tone={step.tone} />
            </div>
          ))}
        </div>
        <div className={styles.actionRow}>
          <Button variant="ghost" onClick={onShowShortcuts}>
            Keyboard shortcuts
          </Button>
        </div>
      </Surface>
    </div>
  );
}
