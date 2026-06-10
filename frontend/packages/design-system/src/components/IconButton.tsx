import type { ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";

import styles from "./IconButton.module.css";

/* R2-D (round-2 audit, R2-ICO-02): the app's lucide size/strokeWidth
 * convention, documented where wrapped icons are minted. The tiers are
 * deliberate — pick the row that matches the icon's ROLE; don't invent a
 * new pair:
 *
 *   13px / 1.75  — standard inline action (the Lighting inspector/toolbar
 *                  house pair: Save, Play, Pencil, Trash2, Power, Palette…)
 *   13–15px / 1.8 — Audio chrome pair (top bar, health bar telemetry)
 *   18px / 1.8   — THIS component (wrapped icon actions; size via CSS)
 *   11–14px / 2.0 — emphasis tier: close/destructive/micro controls
 *                  (X, Plus-as-primary-action, Pin, Power, zoom ±) — the
 *                  heavier stroke is intentional at micro sizes
 *   16px / 2.0   — workspace navigation tabs (lucide default weight)
 *   18px / 1.6   — large structural/wayfinding icons (AudioTieredMixer tier
 *                  headers + lane connectors): rendered stroke 1.2px sits
 *                  between the 13px standard (~0.95px) and this component
 *                  (1.35px) for optical-weight parity at the largest inline
 *                  size
 *   24px / 1.75  — empty-state hero icon (AudioEmptyInspector)
 *
 * Same-icon size divergence that is layout-driven is fine (SceneRail's add
 * Plus at 18 on large tiles vs GroupRail's at 13 in the compact rail).
 * Deliberately NOT extended with size/strokeWidth props: no consumer needs
 * the override today, and the S8e precedent rejects additive-but-unconsumed
 * API widening. */

export type IconButtonTone = "default" | "primary" | "danger" | "ghost";
export type IconButtonSize = "sm" | "md";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  badge?: string;
  icon: LucideIcon;
  label: string;
  pressed?: boolean;
  size?: IconButtonSize;
  tone?: IconButtonTone;
}

export function IconButton({
  badge,
  className,
  icon: Icon,
  label,
  pressed,
  size = "md",
  tone = "default",
  type = "button",
  ...props
}: IconButtonProps) {
  const classes = [styles.button, styles[tone], styles[size], className].filter(Boolean).join(" ");

  return (
    <button
      aria-label={label}
      aria-pressed={typeof pressed === "boolean" ? pressed : undefined}
      className={classes}
      title={label}
      type={type}
      {...props}
    >
      <Icon aria-hidden="true" className={styles.icon} strokeWidth={1.8} />
      {badge ? <span className={styles.badge}>{badge}</span> : null}
    </button>
  );
}
