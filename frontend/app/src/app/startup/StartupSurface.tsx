import { Lamp } from "@sse/design-system";
import type { ShellState } from "@sse/engine-client";

import { formatLifecycleLabel } from "../shellData";
import { PreReadyState } from "./PreReadyState";
import stepStyles from "./StartupSteps.module.css";
import { buildStartupSteps, stepStatusLabel } from "./startupHelpers";

// Visual overhaul A, Slice 7: the cold boot on the same skeleton as every
// workspace — the state first, the engine's handshake under it. New pages
// program, Slice 3 (D6): its one key showed the keyboard shortcuts, which are
// gone, so the display has no key; there is nothing to do but wait.

export function StartupSurface({ lifecycle }: { lifecycle: ShellState["lifecycle"] }) {
  const steps = buildStartupSteps(lifecycle);
  const done = steps.filter((step) => step.tone !== "neutral").length;

  return (
    <PreReadyState
      tone={lifecycle === "ready" ? "ok" : "info"}
      word={lifecycle === "ready" ? "READY" : "STARTING UP…"}
      sentence="Connecting to the desk, the rig and the deck. The Console opens once Studio Control is ready."
      meta={`${formatLifecycleLabel(lifecycle)} · ${done} of ${steps.length} startup steps done`}
      testId="startup-surface"
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
