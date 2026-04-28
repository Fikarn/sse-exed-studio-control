import { StatusDot } from "@sse/design-system";

import styles from "./LightingRail.module.css";

export interface GroupChipProps {
  id: string;
  name: string;
  fixtureCount: number;
  on: boolean;
  level: number;
  drifted: boolean;
  onTogglePower: (id: string, on: boolean) => void;
}

export function GroupChip({ id, name, fixtureCount, on, level, drifted, onTogglePower }: GroupChipProps) {
  const className = on ? `${styles.groupChip} ${styles.groupChipOn}` : styles.groupChip;
  const levelClass = drifted ? `${styles.groupChipLevel} ${styles.groupChipLevelDrifted}` : styles.groupChipLevel;
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
          {level}%{drifted ? <span aria-hidden="true">{` ▲`}</span> : null}
        </span>
      ) : null}
    </button>
  );
}
