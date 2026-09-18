import type { SnapshotRecord } from "../shellData";
import type { PlanningSnapshot, ShellStore } from "@sse/engine-client";

// Visual overhaul A, Slice 6 (A-planning.html): the screen's geometry. The
// label column and the card box are fixed px — a card is a box pinned to a
// start time, not a bar whose width is its duration — and they step down with
// the axis exactly as the mock's three viewports do.
export const PLANNING_LABEL_WIDTH = 176;
export const PLANNING_CARD_TOP = 22;

export function planningCardSize(axisWidth: number) {
  if (axisWidth >= 1200) return { height: 78, width: 268 };
  if (axisWidth >= 900) return { height: 64, width: 210 };
  return { height: 52, width: 180 };
}

export const boardColumns = [
  { id: "todo", label: "Todo" },
  { id: "in-progress", label: "In progress" },
  { id: "blocked", label: "Blocked" },
  { id: "done", label: "Done" },
] as const;

export const planningFilters = [
  { label: "All", value: "all" },
  { label: "To do", value: "todo" },
  { label: "In progress", value: "in-progress" },
  { label: "Blocked", value: "blocked" },
  { label: "Done", value: "done" },
] as const;

export interface PlanningWorkspaceSurfaceProps {
  appSnapshot: SnapshotRecord | null;
  planningSnapshot: PlanningSnapshot | null;
  store: ShellStore;
}
