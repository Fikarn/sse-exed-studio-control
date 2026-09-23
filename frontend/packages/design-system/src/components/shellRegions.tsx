import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Visual overhaul A, Slice 4 (plan D1): the shell owns the grid, the workspace
// fills it. `AppShellFrame` renders the cluster, the plate and the footer as
// empty regions when the host passes `"slot"`, and publishes their elements
// here; a workspace renders `<ShellRegion region="cluster">…` and its content
// portals into the shell's own region — one React tree, so state, context and
// events flow normally, and the frame keeps the D4 geometry.

export type ShellRegionName = "cluster" | "plate" | "footer";

export type ShellRegionElements = Record<ShellRegionName, HTMLElement | null>;

const EMPTY: ShellRegionElements = { cluster: null, plate: null, footer: null };

export const ShellRegionsContext = createContext<ShellRegionElements>(EMPTY);

export function useShellRegion(region: ShellRegionName): HTMLElement | null {
  return useContext(ShellRegionsContext)[region];
}

export interface ShellRegionProps {
  region: ShellRegionName;
  children: ReactNode;
}

/** Renders `children` into the shell's region; nothing until the shell mounts it. */
export function ShellRegion({ region, children }: ShellRegionProps) {
  const element = useShellRegion(region);
  if (!element) return null;
  return createPortal(children, element);
}
