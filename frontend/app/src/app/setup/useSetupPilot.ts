import type { SetupSupportPilotProps } from "./setupPilotModel";
import { useSetupPilotState } from "./pilot/useSetupPilotState";
import { useSetupPilotActions } from "./pilot/useSetupPilotActions";
import { useSetupPilotShortcuts } from "./pilot/useSetupPilotShortcuts";
import { useSetupPilotChrome } from "./pilot/useSetupPilotChrome";

/** Everything Setup / Support knows and can do: what the snapshots and the
 *  forms hold (state), what the operator can run (actions), the keyboard, and
 *  the pieces every screen shares (chrome). The runner steps under `steps/` and
 *  the support surfaces under `support/` draw it; none of them owns state. */
export function useSetupPilot(props: SetupSupportPilotProps) {
  const state = useSetupPilotState({ props });
  const actions = useSetupPilotActions({ props, state });
  useSetupPilotShortcuts({ state, actions });
  const chrome = useSetupPilotChrome({ props, state, actions });
  return { props, state, actions, chrome };
}

export type SetupPilot = ReturnType<typeof useSetupPilot>;
