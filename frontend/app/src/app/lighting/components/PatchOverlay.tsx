import type { ReactNode } from "react";

export interface PatchOverlayProps {
  active: boolean;
  children: ReactNode;
}

export function PatchOverlay({ active, children }: PatchOverlayProps) {
  return (
    <g
      style={{
        opacity: active ? 1 : 0,
        transition: "opacity 180ms ease",
        pointerEvents: active ? "auto" : "none",
      }}
      aria-hidden={!active}
    >
      {children}
    </g>
  );
}
