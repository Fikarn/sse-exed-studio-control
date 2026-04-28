import { StatusDot } from "@sse/design-system";

import styles from "./LightingRail.module.css";

export interface GroupChipProps {
  id: string;
  name: string;
  fixtureCount: number;
  on: boolean;
  onTogglePower: (id: string, on: boolean) => void;
}

export function GroupChip({ id, name, fixtureCount, on, onTogglePower }: GroupChipProps) {
  const className = on ? `${styles.groupChip} ${styles.groupChipOn}` : styles.groupChip;
  return (
    <button
      type="button"
      className={className}
      onClick={() => onTogglePower(id, !on)}
      aria-pressed={on}
      aria-label={`${name} group power ${on ? "on" : "off"}`}
    >
      <StatusDot state={on ? "ok" : "info"} size="sm" glow={on} />
      <span className={styles.groupChipName}>{name}</span>
      <span className={styles.groupChipCount}>{fixtureCount}</span>
    </button>
  );
}
