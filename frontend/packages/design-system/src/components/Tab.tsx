import type { ReactNode } from "react";

import styles from "./Tab.module.css";

// Visual overhaul A, Slice 2 (system §7): a workspace tab in the shell
// header. The active tab is a machined key; a locked tab (startup, recovery,
// commissioning not published) is a dashed outline at 55 % with
// `aria-disabled` (plan D7), never opacity alone. The keyboard hint is
// `aria-hidden` so the tab's accessible name stays the workspace's name.
export interface TabProps {
  id: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}

export const Tab = ({ id, label, hint, icon, active = false, disabled = false, onClick, className }: TabProps) => {
  const classes = [styles.tab, active ? styles.active : "", className].filter(Boolean).join(" ");
  return (
    <button
      type="button"
      data-nav-id={id}
      data-material={active ? "key" : undefined}
      className={classes}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-disabled={disabled ? "true" : undefined}
      aria-current={active ? "page" : undefined}
    >
      {icon ? <span className={styles.icon}>{icon}</span> : null}
      <span>{label}</span>
      {hint ? (
        <kbd className={styles.hint} aria-hidden="true">
          {hint}
        </kbd>
      ) : null}
    </button>
  );
};
