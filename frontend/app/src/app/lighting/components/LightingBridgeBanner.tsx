import { StatusBand } from "@sse/design-system";

export interface LightingBridgeBannerProps {
  /** Reachable === false renders the banner; otherwise nothing renders. */
  reachable: boolean;
  /** Bridge IP for the operator to gut-check. Empty string when not configured. */
  bridgeIp: string;
  /** DMX universe id for context in the banner. */
  universe: number;
}

/**
 * Top-of-canvas warning when the configured DMX bridge stops responding.
 * Lighting commands continue to mutate the engine state but no light will
 * actually change on the rig until the bridge comes back. The banner uses
 * the existing StatusBand primitive so it shares vocabulary with the
 * Setup workspace's degraded-state warnings.
 */
export function LightingBridgeBanner({ reachable, bridgeIp, universe }: LightingBridgeBannerProps) {
  if (reachable) return null;
  const target = bridgeIp.trim() ? `${bridgeIp} on universe u${universe}` : `universe u${universe}`;
  return (
    <StatusBand
      tone="error"
      title="DMX bridge unreachable"
      summary={`Lighting commands won't reach the rig until the bridge at ${target} comes back online. Check the network connection or run the bridge probe in Setup.`}
    />
  );
}
