import type { HTMLAttributes, ReactNode } from "react";

import styles from "./CueRail.module.css";

export type CueRailState = "ready" | "active" | "complete" | "blocked";

export interface CueRailItem {
  detail?: ReactNode;
  id: string;
  label: ReactNode;
  meta?: ReactNode;
  state?: CueRailState;
}

export interface CueRailProps extends Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> {
  activeId?: string;
  cues: CueRailItem[];
  label: string;
  onSelect?: (id: string) => void;
}

export function CueRail({ activeId, className, cues, label, onSelect, ...props }: CueRailProps) {
  return (
    <div aria-label={label} className={[styles.rail, className].filter(Boolean).join(" ")} role="list" {...props}>
      {cues.map((cue, index) => {
        const active = cue.id === activeId || cue.state === "active";
        const state = cue.state ?? (active ? "active" : "ready");
        return (
          <div className={styles.item} key={cue.id} role="listitem">
            <button
              aria-current={active ? "step" : undefined}
              className={[styles.cue, styles[state]].join(" ")}
              disabled={state === "blocked"}
              onClick={() => onSelect?.(cue.id)}
              type="button"
            >
              <span className={styles.index}>{String(index + 1).padStart(2, "0")}</span>
              <span className={styles.copy}>
                <span className={styles.label}>{cue.label}</span>
                {cue.detail ? <span className={styles.detail}>{cue.detail}</span> : null}
              </span>
              {cue.meta ? <span className={styles.meta}>{cue.meta}</span> : null}
            </button>
          </div>
        );
      })}
    </div>
  );
}
