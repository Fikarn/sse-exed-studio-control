import type { CSSProperties } from "react";

import styles from "./LevelBar.module.css";

// The Session page's step 2 (D52; board 3, `docs/design/session-3.md`): how
// full a drive is. A 6 px well in the pill's shape, filled from the left for
// the share used: quiet while there is room, the brand's yellow when the drive
// reads low, coral when it is nearly full. It is a level, not a signal: the
// meters' colours stay the meters' (D50). It says its share in words to a
// screen reader; its row says the rest, the free space and the level's word.
export type LevelBarTone = "quiet" | "attention" | "error";

export interface LevelBarProps {
  /** The share used, 0 to 1: a drive's `1 - freeBytes / totalBytes`. */
  used: number;
  /** Quiet while there is room; attention when it reads low, error when nearly full. */
  tone?: LevelBarTone;
  /** What it measures, as its row names it: `Storage 1 (D:)`. */
  label: string;
  testId?: string;
  className?: string;
}

const share = (used: number) => Math.max(0, Math.min(1, Number.isFinite(used) ? used : 0));

/** The share in whole per cent, which says `100` only when full and `0` only when empty. */
export function usedPercent(used: number) {
  const filled = share(used);
  if (filled === 0 || filled === 1) return filled * 100;
  return Math.min(99, Math.max(1, Math.round(filled * 100)));
}

export function LevelBar({ used, tone = "quiet", label, testId, className }: LevelBarProps) {
  const percent = usedPercent(used);
  return (
    <div
      className={[styles.levelBar, styles[tone], className].filter(Boolean).join(" ")}
      role="meter"
      aria-label={`${label}: ${percent} % used`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      data-tone={tone}
      data-testid={testId}
      style={{ "--level-bar-used": share(used) } as CSSProperties}
    >
      <span className={styles.fill} />
    </div>
  );
}
