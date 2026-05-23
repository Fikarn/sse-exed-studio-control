import type { ReactNode } from "react";

import styles from "./AudioHardwareReadout.module.css";

/**
 * Subtle hardware-display wrapper for "trusted level" readouts on the audio
 * page (Outputs Bus level, Rail Monitor level, inspector Send-to-<bus>,
 * inspector small preamp). Renders a thin inset border with a faint amber
 * LED-style backlight across the lower half so the wrapped value reads as a
 * recessed digital display instead of a flat number on a card.
 *
 * Two variants:
 *   - `readout` (default) — padded inline-flex wrapper for short dB badges.
 *   - `display` — block wrapper without padding; for graph canvases that
 *     need to fill their parent (EQ and Dynamics tabs consume this in slice 6).
 *
 * The wrapper deliberately does NOT change the foreground digit color or
 * font of the wrapped child. Each consumer keeps its existing typography;
 * the bezel only adds the surrounding hardware vocabulary.
 */
export function AudioHardwareReadout({
  children,
  className,
  variant = "readout",
}: {
  children: ReactNode;
  className?: string;
  variant?: "readout" | "display";
}) {
  return (
    <span className={`${styles.hardwareReadout} ${className ?? ""}`.trim()} data-variant={variant}>
      <span aria-hidden="true" className={styles.hardwareReadoutBacklight} />
      <span className={styles.hardwareReadoutContent}>{children}</span>
    </span>
  );
}
