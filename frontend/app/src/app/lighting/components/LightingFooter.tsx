import { Footer, Key } from "@sse/design-system";
import type { LightingDmxMonitorSnapshot, LightingSnapshot } from "@sse/engine-client";

const DMX_UNIVERSE_TOTAL_CHANNELS = 512;

// Visual overhaul A, Slice 5 (system §2): Lighting's footer is the shell's. It
// carries what the rig's health bar carried — the bridge, the universe, how
// many fixtures are patched and whether the scene on the rig is the scene that
// was saved — and keeps the health bar's test ids on their new home. New pages
// program, Slice 3 (D6): it prints no key hints; the DMX strip key stays at the
// right edge.

export interface LightingFooterProps {
  bridgeReachable: boolean;
  bridgeUniverse?: number | null;
  dmxStripOn?: boolean;
  driftDetected: boolean;
  fixturesPatched: number;
  fixturesTotal: number;
  lastSavedLabel?: string | null;
  lightingDmxMonitorSnapshot?: LightingDmxMonitorSnapshot | null;
  lightingSnapshot?: LightingSnapshot | null;
  onToggleDmxStrip?: () => void;
  previewMode: boolean;
}

export function LightingFooter({
  bridgeReachable,
  bridgeUniverse,
  dmxStripOn = false,
  driftDetected,
  fixturesPatched,
  fixturesTotal,
  lastSavedLabel,
  lightingDmxMonitorSnapshot,
  lightingSnapshot,
  onToggleDmxStrip,
  previewMode,
}: LightingFooterProps) {
  const universe = bridgeUniverse ?? lightingSnapshot?.universe ?? 1;
  const bridgeIp = lightingSnapshot?.bridgeIp ?? "";
  const channelCount = lightingDmxMonitorSnapshot?.channels.length ?? 0;

  const sceneState = previewMode
    ? driftDetected
      ? "offline edits"
      : "no offline edits"
    : driftDetected
      ? "unsaved changes"
      : lastSavedLabel
        ? `saved · last ${lastSavedLabel}`
        : "saved";

  return (
    <Footer
      items={[
        {
          id: "bridge",
          label: "Bridge",
          value: bridgeIp
            ? `${bridgeIp} · U${universe}${bridgeReachable ? "" : " · unreachable"}`
            : `U${universe} · no address`,
        },
        {
          id: "universe",
          label: "Universe",
          value: `${channelCount} / ${DMX_UNIVERSE_TOTAL_CHANNELS} ch${bridgeReachable ? "" : " · stale"}`,
        },
        { id: "fixtures", label: "Fixtures", value: `${fixturesPatched} / ${fixturesTotal} patched` },
        { id: "scene", label: previewMode ? "Preview" : "Scene", value: sceneState },
      ]}
      action={
        onToggleDmxStrip ? (
          <Key
            size="small"
            mode="toggle"
            engaged={dmxStripOn}
            aria-pressed={dmxStripOn}
            aria-label={dmxStripOn ? "Hide DMX strip" : "Show DMX strip"}
            testId="lighting-dmx-strip-toggle"
            onClick={onToggleDmxStrip}
          >
            DMX strip
          </Key>
        ) : null
      }
      testId="lighting-health-bar"
      itemsTestId="lighting-footer-telemetry"
    />
  );
}
