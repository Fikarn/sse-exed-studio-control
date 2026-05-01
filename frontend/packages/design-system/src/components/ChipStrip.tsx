import type { CSSProperties, ReactNode } from "react";

import styles from "./ChipStrip.module.css";

export interface ChipStripChip {
  /** Stable id used for the React key + as the argument to onClick / onHover. */
  id: string;
  /** Primary text shown on the chip. Truncates with ellipsis when narrow. */
  label: ReactNode;
  /** Optional accent dot rendered before the label. Pass a CSS color string
   *  (hex / var()) — the strip doesn't enforce a palette so consumers can
   *  feed contextual tints (e.g. CCT-derived colors for fixture chips). */
  accentColor?: string;
  /** Optional small numeric / glyph prefix rendered inside a slot before the
   *  label (e.g. position numbers, group abbreviations). */
  leadingBadge?: ReactNode;
  /** Trailing element — typically a close-icon button. The strip doesn't
   *  wire its own click semantics for trailing content; consumers attach
   *  onClick on the rendered node. */
  trailing?: ReactNode;
  /** Per-chip aria-label override; otherwise label is read out. */
  ariaLabel?: string;
}

export interface ChipStripProps {
  chips: readonly ChipStripChip[];
  /** Primary click handler — fires when the chip body (everything except a
   *  consumer-rendered trailing slot) is clicked. */
  onChipClick?: (id: string) => void;
  /** Hover signal — fires on pointerenter / pointerleave with the chip id
   *  (or null on leave). Useful for cross-component highlight pulses. */
  onChipHover?: (id: string | null) => void;
  /** Container aria-label. */
  ariaLabel?: string;
  /** Optional className passed onto the root for layout-side composition. */
  className?: string;
  /** Optional inline style on the root. */
  style?: CSSProperties;
}

/**
 * Generic horizontal scrollable chip list. Composable surface for selection
 * indicators, breadcrumb-style chips, and other small horizontally-laid-out
 * tag rows. Wave 31 ships this with one consumer (lighting selection chip
 * strip — I9); broader use cases will extend the primitive when their needs
 * become concrete.
 */
export function ChipStrip({ chips, onChipClick, onChipHover, ariaLabel, className, style }: ChipStripProps) {
  if (chips.length === 0) return null;
  const rootClass = [styles.strip, className].filter(Boolean).join(" ");
  return (
    <div className={rootClass} style={style} role="list" aria-label={ariaLabel}>
      {chips.map((chip) => (
        <div
          key={chip.id}
          role="listitem"
          className={styles.chip}
          onPointerEnter={onChipHover ? () => onChipHover(chip.id) : undefined}
          onPointerLeave={onChipHover ? () => onChipHover(null) : undefined}
        >
          <button
            type="button"
            className={styles.chipBody}
            onClick={onChipClick ? () => onChipClick(chip.id) : undefined}
            aria-label={chip.ariaLabel}
          >
            {chip.leadingBadge !== undefined ? <span className={styles.chipBadge}>{chip.leadingBadge}</span> : null}
            {chip.accentColor ? (
              <span aria-hidden="true" className={styles.chipAccent} style={{ background: chip.accentColor }} />
            ) : null}
            <span className={styles.chipLabel}>{chip.label}</span>
          </button>
          {chip.trailing ? <span className={styles.chipTrailing}>{chip.trailing}</span> : null}
        </div>
      ))}
    </div>
  );
}
