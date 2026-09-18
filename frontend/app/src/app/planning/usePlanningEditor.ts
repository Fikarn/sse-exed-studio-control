import type { PlanningWorkspaceSurfaceProps } from "./planningWorkspaceModel";
import { usePlanningView } from "./editor/usePlanningView";
import { usePlanningActions } from "./editor/usePlanningActions";
import { usePlanningShortcuts } from "./editor/usePlanningShortcuts";

/** Everything the Planning workspace knows and can do: the day in view and what
 *  is derived from it (view), what the operator can do to it (actions), and the
 *  keyboard. The bays under `bays/` and the regions beside them draw it; none of
 *  them owns state. */
export function usePlanningEditor(props: PlanningWorkspaceSurfaceProps) {
  const view = usePlanningView({ props });
  const actions = usePlanningActions({ props, view });
  usePlanningShortcuts({ view, actions });
  return { props, view, actions };
}

export type PlanningEditor = ReturnType<typeof usePlanningEditor>;
