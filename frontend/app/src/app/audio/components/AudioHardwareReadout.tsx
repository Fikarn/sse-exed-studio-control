import type { ReactNode } from "react";

import styles from "./AudioHardwareReadout.module.css";

/**
 * Subtle hardware-display wrapper for "trusted level" readouts on the audio
 * page (Outputs Bus level, Rail Monitor level, inspector Send-to-<bus>).
 * Renders a thin inset border with a faint amber LED-style backlight across
 * the lower half so the wrapped value reads as a recessed digital display
 * instead of a flat number on a card.
 *
 * The wrapper deliberately does NOT change the foreground digit color or
 * font of the wrapped child. Each consumer keeps its existing typography;
 * the bezel only adds the surrounding hardware vocabulary.
 *
 * Phase 3 follow-up note (F21 + I33): the Slice 6 plan called for a
 * `variant="display"` block layout and a `...rest` HTML-attribute
 * pass-through so the EQ and Dynamics full-graph canvases could consume
 * this wrapper. On inspection (Group G of the follow-up audit) that
 * approach paints a bezel-in-bezel against the graph canvases' own grid
 * background — same problem the inspector preamp re-skin (F22) was
 * skipped for. The amber backlight was instead applied at the CSS level
 * directly to `.eqGraphFull` and `.dynamicsGraphFull` (matching the
 * Slice 6 mini-graph pattern in AudioInspector.module.css). Variant and
 * pass-through removed here because they had no consumer.
 */
export function AudioHardwareReadout({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={`${styles.hardwareReadout} ${className ?? ""}`.trim()}>
      <span aria-hidden="true" className={styles.hardwareReadoutBacklight} />
      <span className={styles.hardwareReadoutContent}>{children}</span>
    </span>
  );
}
