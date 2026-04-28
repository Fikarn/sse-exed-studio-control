import type { ReactNode } from "react";

import styles from "./NavItem.module.css";

export interface NavItemProps {
  id: string;
  label: string;
  icon?: ReactNode;
  active?: boolean;
  onClick?: () => void;
  className?: string;
}

export const NavItem = ({ id, label, icon, active = false, onClick, className }: NavItemProps) => {
  const classes = [styles.item, active ? styles.active : "", className].filter(Boolean).join(" ");
  return (
    <button
      type="button"
      data-nav-id={id}
      className={classes}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
    >
      {icon ? <span className={styles.icon}>{icon}</span> : null}
      <span>{label}</span>
    </button>
  );
};
