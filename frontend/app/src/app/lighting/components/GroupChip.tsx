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
}: GroupChipProps) {
  const className = on ? `${styles.groupChip} ${styles.groupChipOn}` : styles.groupChip;
  const levelClass = drifted ? `${styles.groupChipLevel} ${styles.groupChipLevelDrifted}` : styles.groupChipLevel;
  // Surface direction + magnitude when the live level diverges from the
  // active scene's saved level by ≥ 1 % point. ▲ for above, ▼ for below.
  const meaningfulDelta = drifted && Math.abs(levelDelta) >= 1;
  const arrow = levelDelta > 0 ? "▲" : "▼";
  const deltaLabel = meaningfulDelta
    ? ` ${arrow} ${levelDelta > 0 ? "+" : ""}${Math.round(levelDelta)}`
    : drifted
      ? " ▲"
      : "";
  return (
    <button
      type="button"
      className={className}
      onClick={() => onTogglePower(id, !on)}
      aria-pressed={on}
      aria-label={`${name} group power ${on ? "on" : "off"}`}
      title={`${fixtureCount} fixture${fixtureCount === 1 ? "" : "s"}`}
    >
      <StatusDot state={on ? "ok" : "info"} size="sm" glow={on} />
      <span className={styles.groupChipName}>{name}</span>
      {on ? (
        <span className={levelClass}>
          {level}%{deltaLabel ? <span aria-hidden="true">{deltaLabel}</span> : null}
        </span>
      ) : null}
    </button>
  );
}
