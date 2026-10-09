import { LampWord, Section } from "@sse/design-system";
import type { ShellState } from "@sse/engine-client";

import { formatLifecycleLabel, type SnapshotRecord } from "../shellData";
import { HardwareChecks } from "./HardwareChecks";
import { PreReadyState } from "./PreReadyState";
import stepStyles from "./StartupSteps.module.css";
import { buildStartupSteps, stepStatusLabel } from "./startupHelpers";

// The cold boot on the same skeleton as every page: the state first, in the
// cluster (the shell, overhaul 3). The display has no key; there is nothing to
// do but wait. One screen for every page since 2026-09-28: Setup had a copy of
// its own, which differed by a sentence. The visual overhaul's polish
// (2026-10-05): the frame of the recovery screen that may follow it (DESIGN
// §2): the steps in the bay, one line each, and the hardware's three checks on
// the plate, pending until the hardware link reports them. The bay and the
// plate stood empty, the steps squeezed into the cluster.

export function StartupSurface({
  lifecycle,
  healthSnapshot = null,
}: {
  lifecycle: ShellState["lifecycle"];
  /** The hardware link's health snapshot, once it has reported. */
  healthSnapshot?: SnapshotRecord | null;
}) {
  const steps = buildStartupSteps(lifecycle);
  const done = steps.filter((step) => step.tone !== "neutral").length;

  return (
    <PreReadyState
      tone={lifecycle === "ready" ? "ok" : "info"}
      word={lifecycle === "ready" ? "READY" : "STARTING UP…"}
      // The shell (overhaul 3): the display is the cluster's 376 px, so the
      // sentence is what is happening, the meta line what comes next, and the
      // stage with the steps' count heads the steps.
      sentence="Connecting to the desk, the rig and the deck."
      // The app opens on the Overview (D47, D1 amended); on Setup only while
      // the setup is not published, which the start knows only once it is
      // done. The line said "Setup opens" on every start, then "the page last
      // used" until 2026-10-09.
      meta="The Overview opens once Studio Control is ready."
      testId="startup-surface"
      // No key on the plate either: the start-up screen has none (S3).
      plate={
        <Section title="Diagnostics">
          <HardwareChecks healthSnapshot={healthSnapshot} failed={false} testId="startup-checks" />
        </Section>
      }
    >
      <Section
        title="Startup"
        detail={`${done} of ${steps.length} done · ${formatLifecycleLabel(lifecycle)}`}
        testId="startup-steps-section"
      >
        <div className={stepStyles.steps} data-testid="startup-steps">
          {steps.map((step) => (
            // A step is a row like the plate's checks (F45): its name, what it
            // does, and its word with the lamp beside it, never a lamp alone.
            <div key={step.label} className={stepStyles.step}>
              <span className={stepStyles.stepLabel}>{step.label}</span>
              <span className={stepStyles.stepDetail}>{step.description}</span>
              <LampWord tone={step.tone === "neutral" ? "off" : step.tone}>{stepStatusLabel(step.tone)}</LampWord>
            </div>
          ))}
        </div>
      </Section>
    </PreReadyState>
  );
}
