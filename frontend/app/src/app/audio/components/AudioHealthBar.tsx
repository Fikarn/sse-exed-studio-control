import { Clock3, TimerReset } from "lucide-react";

import { HealthBar, type HealthBarHint, type HealthBarItemData } from "@sse/design-system";

import { formatShortcut } from "../../shared/shortcutGlyphs";
import styles from "./AudioHealthBar.module.css";
import { formatAudioTimestamp } from "../audioFormatting";
import type { AudioWorkspaceViewModel } from "../audioViewModel";

export function AudioHealthBar({ viewModel }: { viewModel: AudioWorkspaceViewModel }) {
  const snapshot = viewModel.audioSnapshot;

  // Why: the Trust panel in the rail is the canonical surface for OSC,
  // Endpoint, and Metering telemetry. The health bar previously duplicated
  // those rows, which made small state divergences (eg. metering chip vs rail
  // chip) read as bugs. The footer keeps the temporal facts (clock, last
  // sync) and the keyboard shortcut hints — the rail keeps the trust facts.
  //
  // The footer now renders through the shared DS HealthBar (caption variant).
  // The `.audioFooter` class only remaps the primitive's --hb-* theming hooks
  // onto Audio's private theme tokens, so the strip stays byte-identical to
  // the bespoke footer it replaced (CHROME-02 / Slice 5).
  const items: HealthBarItemData[] = [
    {
      icon: <Clock3 size={15} strokeWidth={1.8} aria-hidden="true" />,
      label: "Clock",
      value: viewModel.footerTelemetry.clock ?? "—",
    },
    {
      icon: <TimerReset size={15} strokeWidth={1.8} aria-hidden="true" />,
      label: "Last sync",
      value: formatAudioTimestamp(snapshot.lastConsoleSyncAt),
    },
  ];

  const shortcuts: HealthBarHint[] = [
    { kbd: formatShortcut(["mod", "K"]), label: "Command palette" },
    { kbd: "?", label: "Shortcuts" },
    { kbd: "[", label: "Bank prev" },
    { kbd: "]", label: "Bank next", kbdAfter: true },
  ];

  return (
    <HealthBar
      variant="caption"
      className={styles.audioFooter}
      items={items}
      hints={shortcuts}
      testId="audio-health-bar"
      itemsTestId="audio-footer-telemetry"
      hintsTestId="audio-footer-shortcuts"
    />
  );
}
