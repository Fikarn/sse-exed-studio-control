import { Footer, type FooterItem } from "@sse/design-system";

import { formatAudioTimestamp } from "../audioFormatting";
import type { AudioWorkspaceViewModel } from "../audioViewModel";

// Visual overhaul A, Slice 4: the Console's telemetry on the shell's footer —
// the console link, the metering source, the last sync and the bank. The old
// audio health bar's test ids stay on their new home. New pages program,
// Slice 3 (D6): the footer prints no key hints; the bank is paged with the keys
// on the Inputs heading.

export function AudioFooter({ viewModel }: { viewModel: AudioWorkspaceViewModel }) {
  const snapshot = viewModel.audioSnapshot;
  const bank =
    viewModel.totalBanks > 1
      ? `${viewModel.clampedBankIndex + 1} of ${viewModel.totalBanks}`
      : `all ${viewModel.visibleStripCount} strips`;

  const items: FooterItem[] = [
    { id: "console", label: "OSC control", value: viewModel.footerTelemetry.osc },
    { id: "metering", label: "Metering", value: viewModel.footerTelemetry.metering },
    { id: "last-sync", label: "Last sync", value: formatAudioTimestamp(snapshot.lastConsoleSyncAt) },
    { id: "bank", label: "Bank", value: bank },
  ];

  return <Footer items={items} testId="audio-health-bar" itemsTestId="audio-footer-telemetry" />;
}
