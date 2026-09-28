import { Lamp } from "@sse/design-system";
import type { ShellState } from "@sse/engine-client";

import { formatLifecycleLabel } from "../shellData";
import { PreReadyState } from "./PreReadyState";
import stepStyles from "./StartupSteps.module.css";
import { buildStartupSteps, stepStatusLabel } from "./startupHelpers";

// The cold boot on the same skeleton as every page: the state first, the
// hardware link's handshake under it. The display has no key; there is
// nothing to do but wait. One screen for every page since 2026-09-28: Setup
// had a copy of its own, which differed by a sentence.

export function StartupSurface({
  lifecycle,
  opensSetup = false,
}: {
  lifecycle: ShellState["lifecycle"];
  /** Setup is the page that opens, not the Console. */
  opensSetup?: boolean;
}) {
  const steps = buildStartupSteps(lifecycle);
  const done = steps.filter((step) => step.tone !== "neutral").length;

  return (
    <PreReadyState
      tone={lifecycle === "ready" ? "ok" : "info"}
      word={lifecycle === "ready" ? "READY" : "STARTING UP…"}
      sentence={
        opensSetup
          ? "Connecting to the desk, the rig and the deck. Setup opens once Studio Control is ready."
          : "Connecting to the desk, the rig and the deck. The Console opens once Studio Control is ready."
      }
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
