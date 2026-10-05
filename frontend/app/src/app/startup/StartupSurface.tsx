import { Lamp, Section } from "@sse/design-system";
import type { ShellState } from "@sse/engine-client";

import { formatLifecycleLabel } from "../shellData";
import { PreReadyState } from "./PreReadyState";
import stepStyles from "./StartupSteps.module.css";
import { buildStartupSteps, stepStatusLabel } from "./startupHelpers";

// The cold boot on the same skeleton as every page: the state first, the
// hardware link's handshake under it, in the cluster (the shell, overhaul 3). The display has no key; there is
// nothing to do but wait. One screen for every page since 2026-09-28: Setup
// had a copy of its own, which differed by a sentence.

export function StartupSurface({ lifecycle }: { lifecycle: ShellState["lifecycle"] }) {
  const steps = buildStartupSteps(lifecycle);
  const done = steps.filter((step) => step.tone !== "neutral").length;

  return (
    <PreReadyState
      tone={lifecycle === "ready" ? "ok" : "info"}
      word={lifecycle === "ready" ? "READY" : "STARTING UP…"}
      // The shell (overhaul 3): the display is the cluster's 376 px, so the
      // sentence is what is happening, the meta line what comes next, and the
      // stage with the steps' count heads the steps under it.
      sentence="Connecting to the desk, the rig and the deck."
      // Which page opens is not known until the start is done (D1: the page
      // last used); the line said "Setup opens" on every start.
      meta="The page last used opens once Studio Control is ready."
      testId="startup-surface"
      cluster={
        <Section
          title="Start-up"
          detail={`${done} of ${steps.length} done · ${formatLifecycleLabel(lifecycle)}`}
          testId="startup-steps-section"
        >
          <div className={stepStyles.steps} data-testid="startup-steps">
            {steps.map((step) => (
              <div key={step.label} className={stepStyles.step}>
                <Lamp tone={step.tone === "neutral" ? "off" : step.tone} />
                <span className={stepStyles.stepLabel}>{step.label}</span>
                <span className={stepStyles.stepDetail}>{step.description}</span>
                <span className={stepStyles.stepStanding}>{stepStatusLabel(step.tone)}</span>
              </div>
            ))}
          </div>
        </Section>
      }
    />
  );
}
