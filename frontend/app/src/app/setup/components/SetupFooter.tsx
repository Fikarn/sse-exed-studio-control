import { Footer } from "@sse/design-system";

// Visual overhaul A, Slice 7 (system §2): Setup's footer is the shell's: which
// step the runner is on and how the probes came back. New pages program,
// Slice 3 (D6): it prints no key hints — Studio Control binds no key of its
// own. The visual overhaul's polish (2026-10-05): the counts read as the
// cluster reads them (`5 of 5`, `3 of 3 passed`), and Commissioning and App
// went: the state word and the plate's About say them.

export interface SetupFooterProps {
  passedProbeCount: number;
  probeCount: number;
  stepLabel: string;
  stepNumber: number;
  stepTotal: number;
}

export function SetupFooter({ passedProbeCount, probeCount, stepLabel, stepNumber, stepTotal }: SetupFooterProps) {
  return (
    <Footer
      items={[
        { id: "step", label: "Step", value: `${stepNumber} of ${stepTotal} · ${stepLabel}` },
        {
          id: "probes",
          label: "Probes",
          value: probeCount > 0 ? `${passedProbeCount} of ${probeCount} passed` : "none run",
        },
      ]}
      testId="setup-health-bar"
      itemsTestId="setup-footer-telemetry"
    />
  );
}
