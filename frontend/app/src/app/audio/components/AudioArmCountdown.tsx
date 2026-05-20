import type { CSSProperties } from "react";

import styles from "../AudioWorkspace.module.css";

interface AudioArmCountdownProps {
  durationMs: number;
}

/**
 * Visual countdown bar shown on armed snapshot tiles for the duration of the
 * arm-then-apply window. Purely decorative — the canonical announce path is
 * the polite aria-live toast on the workspace. The bar is `aria-hidden` so
 * screen-readers do not read it as another live region.
 *
 * Reduced-motion variant lives in `AudioWorkspace.module.css`; this component
 * never inspects the user preference itself.
 */
export function AudioArmCountdown({ durationMs }: AudioArmCountdownProps) {
  return (
    <span
      aria-hidden="true"
      className={styles.armCountdownBar}
      data-testid="audio-arm-countdown"
      style={{ "--audio-arm-duration": `${durationMs}ms` } as CSSProperties}
    />
  );
}
