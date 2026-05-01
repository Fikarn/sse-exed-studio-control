import { useEffect, useState } from "react";

import { HealthBar, type HealthBarItemData } from "@sse/design-system";
import type { LightingDmxMonitorSnapshot, LightingSnapshot } from "@sse/engine-client";

import styles from "./LightingHealthBar.module.css";

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
  /** Wave 31 — P4 toggle button rendered in the actions slot. The actual
   *  DMX strip is rendered separately in `<LightingWorkspace>`'s overlay
   *  container so it can float over the body without forcing layout
   *  shifts. The toggle just flips the parent's `dmxStripOn` state. */
  dmxStripOn?: boolean;
  onToggleDmxStrip?: () => void;
  bridgeReachable?: boolean;
  bridgeUniverse?: number;
}

export function LightingHealthBar({
  lightingSnapshot,
  lightingDmxMonitorSnapshot,
  fixturesPatched,
  fixturesTotal,
  driftDetected,
  lastSavedLabel,
  dmxStripOn = false,
  onToggleDmxStrip,
  bridgeReachable: bridgeReachableOverride,
  bridgeUniverse,
}: LightingHealthBarProps) {
  const [sessionMs, setSessionMs] = useState(() => Date.now() - SESSION_STARTED_AT);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setSessionMs(Date.now() - SESSION_STARTED_AT);
    }, SESSION_TICK_MS);
    return () => window.clearInterval(interval);
  }, []);

  const reachable = bridgeReachableOverride ?? lightingSnapshot?.reachable ?? false;
  const universe = bridgeUniverse ?? lightingSnapshot?.universe ?? 1;
  const bridgeIp = lightingSnapshot?.bridgeIp ?? "";
  const channelCount = lightingDmxMonitorSnapshot?.channels.length ?? 0;

  const items: HealthBarItemData[] = [
    {
      label: "Bridge",
      dot: reachable ? "ok" : "err",
      value: bridgeIp ? `${bridgeIp} · U${universe}` : `U${universe} · no IP`,
      suffix: reachable ? undefined : "unreachable",
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

  // Wave 31 — DMX strip toggle action. Renders only when the consumer
  // wires the toggle; otherwise the actions slot stays empty and the bar
  // matches its pre-31 look.
  const dmxToggleAction = onToggleDmxStrip ? (
    <button
      type="button"
      className={`${styles.toggle} ${dmxStripOn ? styles.toggleOn : ""}`}
      onClick={onToggleDmxStrip}
      aria-pressed={dmxStripOn}
      aria-label={dmxStripOn ? "Hide DMX strip" : "Show DMX strip"}
    >
      DMX strip
      <span className={styles.toggleDot} aria-hidden="true" />
    </button>
  ) : null;

  return (
    <HealthBar
      items={items}
      hints={[
        { kbd: "⌘ K", label: "command palette" },
        { kbd: "?", label: "shortcuts" },
        { kbd: "⌘ ⇧ M", label: "full DMX monitor" },
      ]}
      actions={dmxToggleAction}
    />
  );
}
