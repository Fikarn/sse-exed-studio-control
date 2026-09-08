import { Footer, type FooterHint, type FooterItem } from "@sse/design-system";

import { formatShortcut } from "../../shared/shortcutGlyphs";
import { formatAudioTimestamp } from "../audioFormatting";
import type { AudioWorkspaceViewModel } from "../audioViewModel";

// Visual overhaul A, Slice 4: the Console's telemetry on the shell's footer —
// the console link, the metering source, the last sync and the bank, then the
// shortcut hints. The old audio health bar's test ids stay on their new home.

export function AudioFooter({ viewModel }: { viewModel: AudioWorkspaceViewModel }) {
  const snapshot = viewModel.audioSnapshot;
  const bank =
    viewModel.totalBanks > 1
      ? `${viewModel.clampedBankIndex + 1} of ${viewModel.totalBanks}`
      : `all ${viewModel.visibleStripCount} strips`;

  const items: FooterItem[] = [
    { id: "console", label: "Console", value: viewModel.footerTelemetry.osc },
    { id: "metering", label: "Metering", value: viewModel.footerTelemetry.metering },
    { id: "last-sync", label: "Last sync", value: formatAudioTimestamp(snapshot.lastConsoleSyncAt) },
    { id: "bank", label: "Bank", value: bank },
  ];

  const hints: FooterHint[] = [
    { kbd: formatShortcut(["mod", "K"]), label: "Command palette" },
    { kbd: "?", label: "Shortcuts" },
    { kbd: ["[", "]"], label: "Bank" },
    { kbd: "T", label: "hold to talk" },
  ];

  return (
    <Footer
      items={items}
      hints={hints}
      testId="audio-health-bar"
      itemsTestId="audio-footer-telemetry"
      hintsTestId="audio-footer-shortcuts"
    />
  );
}
