import { Footer } from "@sse/design-system";

// Visual overhaul A, Slice 7 (system §2): Setup's footer is the shell's. It
// says where commissioning stands without the operator leaving the step they
// are on: which step, how the probes came back, what commissioning is, and what
// version of the app is running. New pages program, Slice 3 (D6): it prints no
// key hints — Studio Control binds no key of its own.

export interface SetupFooterProps {
  appVersion: string;
  commissioningWord: string;
  passedProbeCount: number;
  probeCount: number;
  stepLabel: string;
  stepNumber: number;
  stepTotal: number;
}

export function SetupFooter({
  appVersion,
  commissioningWord,
  passedProbeCount,
  probeCount,
  stepLabel,
  stepNumber,
  stepTotal,
}: SetupFooterProps) {
  return (
    <Footer
      items={[
        { id: "step", label: "Step", value: `${stepNumber} / ${stepTotal} · ${stepLabel}` },
        {
          id: "probes",
          label: "Probes",
          value: probeCount > 0 ? `${passedProbeCount} / ${probeCount} ok` : "none run",
        },
        { id: "commissioning", label: "Commissioning", value: commissioningWord },
        { id: "app", label: "App", value: appVersion },
      ]}
      testId="setup-health-bar"
      itemsTestId="setup-footer-telemetry"
    />
  );
}
