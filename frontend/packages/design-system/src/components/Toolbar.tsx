import type { HTMLAttributes, ReactNode } from "react";

import styles from "./Toolbar.module.css";

const TOOLBAR_FOCUSABLE = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export type ToolbarDensity = "regular" | "compact";

export interface ToolbarProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  density?: ToolbarDensity;
  label: string;
}

export function Toolbar({ children, className, density = "regular", label, onKeyDown, ...props }: ToolbarProps) {
  return (
    <div
      aria-label={label}
      className={[styles.toolbar, styles[density], className].filter(Boolean).join(" ")}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
          return;
        }

        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(TOOLBAR_FOCUSABLE)).filter(
          (control) => control.offsetParent !== null || control === document.activeElement
        );
        const currentIndex = controls.indexOf(document.activeElement as HTMLElement);
        if (controls.length === 0 || currentIndex < 0) {
          return;
        }

        let nextIndex: number;
        if (event.key === "ArrowRight") {
          nextIndex = (currentIndex + 1) % controls.length;
        } else if (event.key === "ArrowLeft") {
          nextIndex = (currentIndex - 1 + controls.length) % controls.length;
        } else if (event.key === "Home") {
          nextIndex = 0;
        } else {
          nextIndex = controls.length - 1;
        }

        event.preventDefault();
        controls[nextIndex]?.focus();
      }}
      role="toolbar"
      {...props}
    >
      {children}
    </div>
  );
}

export interface ToolbarGroupProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  label?: string;
}

export function ToolbarGroup({ children, className, label, ...props }: ToolbarGroupProps) {
  return (
    <div
      aria-label={label}
      className={[styles.group, className].filter(Boolean).join(" ")}
      role={label ? "group" : undefined}
      {...props}
    >
      {children}
    </div>
  );
}
