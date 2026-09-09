import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import styles from "./Surface.module.css";

export interface SurfaceProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  padding?: "sm" | "md" | "lg";
  tone?: "default" | "raised" | "soft";
}

export const Surface = forwardRef<HTMLElement, SurfaceProps>(function Surface(
  { children, className, padding = "md", tone = "default", ...props },
  ref
) {
  return (
    // Slice 9 (system §5): Surface is the drawer level — dialogs and overlays.
    <section
      className={[styles.surface, styles[padding], styles[tone], className].filter(Boolean).join(" ")}
      data-material="plate"
      data-level="float"
      ref={ref}
      {...props}
    >
      {children}
    </section>
  );
});
