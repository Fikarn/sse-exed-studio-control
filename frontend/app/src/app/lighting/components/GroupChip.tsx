import { ChevronRight, TrendingDown, TrendingUp } from "lucide-react";

import { StatusDot } from "@sse/design-system";

import styles from "./LightingRail.module.css";

export interface GroupChipProps {
  id: string;
  name: string;
  fixtureCount: number;
  on: boolean;
  level: number;
  drifted: boolean;
  /** Signed delta vs. the active scene's saved level for this group (% points). */
  levelDelta?: number;
  onTogglePower: (id: string, on: boolean) => void;
  /** When provided, exposes a chevron button that selects the group for inspection. */
  onInspect?: (id: string) => void;
}

export function GroupChip({
  id,
  name,
  fixtureCount,
  on,
  level,
  drifted,
  levelDelta = 0,
  onTogglePower,
  onInspect,
}: GroupChipProps) {
  const className = on ? `${styles.groupChip} ${styles.groupChipOn}` : styles.groupChip;
  const levelClass = drifted ? `${styles.groupChipLevel} ${styles.groupChipLevelDrifted}` : styles.groupChipLevel;
  const meaningfulDelta = drifted && Math.abs(levelDelta) >= 1;
  const TrendIcon = levelDelta > 0 ? TrendingUp : TrendingDown;
  const deltaText = meaningfulDelta ? `${levelDelta > 0 ? "+" : ""}${Math.round(levelDelta)}` : "";
  const fixtureLabel = `${fixtureCount} fixture${fixtureCount === 1 ? "" : "s"}`;
  const driftSuffix = drifted ? ", drifted" : "";
  const powerAriaLabel = `${name} — ${fixtureLabel}${on ? `, ${level}%` : ""}${driftSuffix}, currently ${
    on ? "on" : "off"
  }. Click to turn ${on ? "off" : "on"}.`;

  return (
    <div className={styles.groupChipRow}>
      <button
        type="button"
        className={className}
        onClick={() => onTogglePower(id, !on)}
        aria-pressed={on}
        aria-label={powerAriaLabel}
      >
        <StatusDot state={on ? "ok" : "info"} size="sm" glow={on} />
        <span className={styles.groupChipName}>{name}</span>
        <span className={styles.groupChipCount}>{fixtureCount}F</span>
        {on ? (
          <span className={levelClass}>
            {level}%
            {meaningfulDelta || drifted ? (
              <span className={styles.groupChipDelta} aria-hidden="true">
                <TrendIcon size={11} strokeWidth={2.5} />
                {deltaText ? <span>{deltaText}</span> : null}
              </span>
            ) : null}
          </span>
        ) : null}
      </button>
      {onInspect ? (
        <button
          type="button"
          className={styles.groupChipInspect}
          onClick={() => onInspect(id)}
          aria-label={`Inspect ${name} group`}
        >
          <ChevronRight aria-hidden="true" size={14} strokeWidth={1.75} />
        </button>
      ) : null}
    </div>
  );
}
