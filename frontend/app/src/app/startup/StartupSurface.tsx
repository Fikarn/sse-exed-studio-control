import { Button, MetricCard, StatusBadge, Surface } from "@sse/design-system";
import type { ShellState } from "@sse/engine-client";

import { formatLifecycleLabel } from "../shellData";
import styles from "../OperatorShell.module.css";
import { buildStartupSteps, stepStatusLabel } from "./startupHelpers";

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
            <div className={styles.stateEyebrow}>Startup</div>
            <h1 className={styles.stateTitle}>Starting operator shell</h1>
            <p className={styles.stateSubtitle}>
              Connecting to the studio engine. The console opens once the engine confirms it is ready.
            </p>
          </div>
          <StatusBadge label={formatLifecycleLabel(lifecycle)} tone={lifecycle === "ready" ? "healthy" : "idle"} />
        </div>
        <div className={styles.metricGrid}>
          <MetricCard
            caption="Lifecycle"
            label={lifecycle === "ready" ? "Ready" : "Loading"}
            tone={lifecycle === "ready" ? "healthy" : "idle"}
            value={formatLifecycleLabel(lifecycle)}
          />
          <MetricCard caption="Target surface" label="Pending" tone="idle" value="Setup / Support" />
          <MetricCard caption="Render mode" label="Active" tone="ready" value="Native webview shell" />
        </div>
        <div className={styles.stepList}>
          {steps.map((step) => (
            <div key={step.label} className={styles.stepItem}>
              <div>
                <div className={styles.stepLabel}>{step.label}</div>
                <div className={styles.stepDetail}>{step.description}</div>
              </div>
              <StatusBadge label={stepStatusLabel(step.tone)} tone={step.tone} />
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
