import { Lamp } from "@sse/design-system";
import type { ShellState } from "@sse/engine-client";

import { asRecord, formatLifecycleLabel, type SnapshotRecord } from "../shellData";
import { PreReadyState } from "./PreReadyState";
import stepStyles from "./StartupSteps.module.css";
import { buildStartupSteps, stepStatusLabel } from "./startupHelpers";

// Visual overhaul A, Slice 7: the cold boot on the Setup tab. The state display
// says the engine is starting and how far the handshake has got; the runner
// itself opens as soon as the engine answers. New pages program, Slice 3 (D6):
// its one key showed the keyboard shortcuts, which are gone, so the display
// has no key.

export function SetupStartupSurface({
  appSnapshot,
  lifecycle,
}: {
  appSnapshot: SnapshotRecord | null;
  lifecycle: ShellState["lifecycle"];
}) {
  const shell = asRecord(appSnapshot?.shell);
  const setup = asRecord(shell?.setup);
  const activeSection = setup?.activeSection === "support" ? "support" : "commissioning";
  const steps = buildStartupSteps(lifecycle);
  const done = steps.filter((step) => step.tone !== "neutral").length;

  return (
    <PreReadyState
      tone="info"
      word="STARTING UP…"
      sentence="The commissioning runner opens as soon as Studio Control is ready."
      meta={`${formatLifecycleLabel(lifecycle)} · ${done} of ${steps.length} startup steps done · ${
        activeSection === "support" ? "Support" : "Runner"
      } is where you were`}
      testId="setup-startup-surface"
    >
      <div className={stepStyles.steps} data-testid="startup-steps">
        {steps.map((step) => (
          <div key={step.label} className={stepStyles.step} data-material="key">
            <Lamp tone={step.tone === "neutral" ? "off" : step.tone} />
            <span className={stepStyles.stepLabel}>{step.label}</span>
            <span className={stepStyles.stepDetail}>{step.description}</span>
            <span className={stepStyles.stepStanding}>{stepStatusLabel(step.tone)}</span>
          </div>
        ))}
      </div>
    </PreReadyState>
  );
}
