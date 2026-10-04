import { Footer } from "@sse/design-system";
import type { LightingDmxMonitorSnapshot } from "@sse/engine-client";

const DMX_UNIVERSE_TOTAL_CHANNELS = 512;

// The visual overhaul's Lighting page (2026-10-04): the footer is telemetry
// only (DESIGN.md §2): the channels in use, how many fixtures are patched, and
// whether the scene on the rig is the one that was saved, in the deck's words.
// The bridge's address is the state display's sentence; the DMX strip's key
// is in the page's ⋯.

export interface LightingFooterProps {
  bridgeUniverse: number;
  driftDetected: boolean;
  fixturesPatched: number;
  fixturesTotal: number;
  lastSavedLabel?: string | null;
  lightingDmxMonitorSnapshot?: LightingDmxMonitorSnapshot | null;
  previewMode: boolean;
}

export function LightingFooter({
  bridgeUniverse,
  driftDetected,
  fixturesPatched,
  fixturesTotal,
  lastSavedLabel,
  lightingDmxMonitorSnapshot,
  previewMode,
}: LightingFooterProps) {
  const channelCount = lightingDmxMonitorSnapshot?.channels.length ?? 0;
  const sceneState = previewMode
    ? driftDetected
      ? "offline edits"
      : "no offline edits"
    : driftDetected
      ? "unsaved"
      : lastSavedLabel
        ? `saved · last ${lastSavedLabel}`
        : "saved";

  return (
    <Footer
      items={[
        {
          id: "channels",
          label: `Universe ${bridgeUniverse}`,
          value: `${channelCount} / ${DMX_UNIVERSE_TOTAL_CHANNELS} channels`,
        },
        { id: "fixtures", label: "Fixtures", value: `${fixturesPatched} / ${fixturesTotal} patched` },
        { id: "scene", label: previewMode ? "Preview" : "Scene", value: sceneState },
      ]}
      testId="lighting-health-bar"
      itemsTestId="lighting-footer-telemetry"
    />
  );
}
