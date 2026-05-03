import { useId, useRef, useState, type ReactNode } from "react";

import styles from "./Tooltip.module.css";

export type TooltipPlacement = "top" | "bottom";

export interface TooltipProps {
  /** Trigger element. Tooltip attaches to this single child. */
  children: ReactNode;
  /** Tooltip body. Kept short — full sentences read fine but no paragraphs. */
  content: ReactNode;
  placement?: TooltipPlacement;
  /** Optional override for the tooltip's max width in px. */
  maxWidth?: number;
}

/**
 * Lightweight tooltip with hover + focus reveal. Pure CSS positioning
 * (parent has position: relative, child is absolute), no portal — keeps
 * markup co-located with the trigger and avoids portal lifecycle bugs in
 * tabbed inspectors. ARIA-described via aria-describedby.
 */
export function Tooltip({ children, content, placement = "top", maxWidth }: TooltipProps) {
  const tooltipId = useId();
  const [visible, setVisible] = useState(false);
  const suppressUntilLeaveRef = useRef(false);

  return (
    <span
      className={styles.wrapper}
      onPointerEnter={() => {
        if (!suppressUntilLeaveRef.current) {
          setVisible(true);
        }
      }}
      onPointerLeave={() => {
        suppressUntilLeaveRef.current = false;
        setVisible(false);
      }}
      onPointerDownCapture={() => {
        suppressUntilLeaveRef.current = true;
        setVisible(false);
      }}
      onFocusCapture={() => {
        if (!suppressUntilLeaveRef.current) {
          setVisible(true);
        }
      }}
      onBlurCapture={() => setVisible(false)}
    >
      <span aria-describedby={tooltipId} className={styles.trigger}>
        {children}
      </span>
      <span
        id={tooltipId}
        role="tooltip"
        className={`${styles.bubble} ${placement === "bottom" ? styles.bubbleBottom : styles.bubbleTop}`}
        data-visible={visible || undefined}
        style={maxWidth ? { maxWidth } : undefined}
      >
        {content}
      </span>
    </span>
  );
}
