import { useEffect, useState } from "react";

import { HealthBar, type HealthBarItemData } from "@sse/design-system";
import type { LightingDmxMonitorSnapshot, LightingSnapshot } from "@sse/engine-client";

// TODO: drive APP_VERSION from frontend/app/package.json via a Vite define
// once the release flow needs it. Manual bump until then.
const APP_VERSION = "v2.2.2";

const SESSION_STARTED_AT =
  typeof performance !== "undefined" && Number.isFinite(performance.timeOrigin) ? performance.timeOrigin : Date.now();

const SESSION_TICK_MS = 30_000;

const DMX_UNIVERSE_TOTAL_CHANNELS = 512;

function formatSessionDuration(milliseconds: number): string {
  if (milliseconds < 0 || !Number.isFinite(milliseconds)) {
    return "—";
  }
  const totalMinutes = Math.floor(milliseconds / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) {
    return `${minutes}m`;
  }
  return `${hours}h ${minutes}m`;
}

export interface LightingHealthBarProps {
  lightingSnapshot: LightingSnapshot | null;
  lightingDmxMonitorSnapshot: LightingDmxMonitorSnapshot | null;
  fixturesPatched: number;
  fixturesTotal: number;
  driftDetected: boolean;
  lastSavedLabel?: string;
}

export function LightingHealthBar({
  lightingSnapshot,
  lightingDmxMonitorSnapshot,
  fixturesPatched,
  fixturesTotal,
  driftDetected,
  lastSavedLabel,
}: LightingHealthBarProps) {
  const [sessionMs, setSessionMs] = useState(() => Date.now() - SESSION_STARTED_AT);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setSessionMs(Date.now() - SESSION_STARTED_AT);
    }, SESSION_TICK_MS);
    return () => window.clearInterval(interval);
  }, []);

  const reachable = lightingSnapshot?.reachable ?? false;
  const universe = lightingSnapshot?.universe ?? 1;
  const bridgeIp = lightingSnapshot?.bridgeIp ?? "";
  const channelCount = lightingDmxMonitorSnapshot?.channels.length ?? 0;

  const items: HealthBarItemData[] = [
    {
      label: "Bridge",
      dot: reachable ? "ok" : "err",
      value: bridgeIp ? `DMX U${universe} · ${bridgeIp}` : `DMX U${universe} · —`,
      suffix: reachable ? "reachable" : "unreachable",
    },
    {
      label: "Universe",
      dot: "ok",
      value: `${channelCount} / ${DMX_UNIVERSE_TOTAL_CHANNELS} ch`,
    },
    {
      label: "Fixtures",
      dot: fixturesTotal === 0 ? "info" : fixturesPatched === fixturesTotal ? "ok" : "attn",
      value: `${fixturesPatched} / ${fixturesTotal} patched`,
    },
    {
      label: "Auto-save",
      dot: driftDetected ? "attn" : "ok",
      value: driftDetected ? "Unsaved changes" : "Saved",
      suffix: !driftDetected && lastSavedLabel ? `· last ${lastSavedLabel}` : undefined,
    },
    {
      label: "Session",
      value: formatSessionDuration(sessionMs),
    },
    {
      label: "App",
      value: APP_VERSION,
    },
  ];

  return <HealthBar items={items} hint={{ kbd: "⌘ M", label: "full DMX monitor" }} />;
}
