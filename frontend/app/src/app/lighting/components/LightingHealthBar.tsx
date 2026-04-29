import { useEffect, useState } from "react";

import { HealthBar, type HealthBarItemData } from "@sse/design-system";
import type { LightingDmxMonitorSnapshot, LightingSnapshot } from "@sse/engine-client";

// Driven by Vite's `define` from frontend/app/package.json. Bump the package
// version and the health bar tracks it on next dev/build.
const APP_VERSION = `v${__APP_VERSION__}`;

const SESSION_STORAGE_KEY = "app.session.startedAt";
const SESSION_FRESHNESS_MS = 24 * 60 * 60 * 1_000;
const SESSION_TICK_MS = 30_000;

function readSessionStartedAt(): number {
  const now = Date.now();
  if (typeof window === "undefined") return now;
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    if (Number.isFinite(parsed) && now - parsed < SESSION_FRESHNESS_MS) {
      return parsed;
    }
  } catch {
    // localStorage unavailable (e.g. private mode) — fall through.
  }
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, String(now));
  } catch {
    // Best-effort write — duration is still meaningful within this load.
  }
  return now;
}

const SESSION_STARTED_AT = readSessionStartedAt();

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
      dot: reachable ? "ok" : "info",
      value: `${channelCount} / ${DMX_UNIVERSE_TOTAL_CHANNELS} ch`,
      suffix: reachable ? undefined : "stale",
    },
    {
      label: "Fixtures",
      dot: fixturesTotal === 0 ? "info" : fixturesPatched === fixturesTotal ? "ok" : "attn",
      value: `${fixturesPatched} / ${fixturesTotal} patched`,
    },
    {
      label: "Scene state",
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

  return <HealthBar items={items} hint={{ kbd: "⌘ ⇧ M", label: "full DMX monitor" }} />;
}
