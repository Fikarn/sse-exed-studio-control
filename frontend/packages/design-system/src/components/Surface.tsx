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
    <section
      className={[styles.surface, styles[padding], styles[tone], className].filter(Boolean).join(" ")}
      ref={ref}
      {...props}
    >
      {children}
    </section>
  );
});
