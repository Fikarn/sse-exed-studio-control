import type { LightingWorkspaceSurfaceProps } from "./lightingWorkspaceModel";
import { useLightingRig } from "./editor/useLightingRig";
import { useLightingSession } from "./editor/useLightingSession";
import { useLightingSceneEditor } from "./editor/useLightingSceneEditor";
import { useLightingFixtureEditor } from "./editor/useLightingFixtureEditor";
import { useLightingRigControls } from "./editor/useLightingRigControls";
import { useLightingArming } from "./editor/useLightingArming";

/** Everything the Lighting workspace knows and can do, assembled in dependency
 *  order: what the snapshots say (rig), what this sitting has open (session),
 *  the scene editor, the fixture editor, and the rig-wide controls. The region
 *  components under `regions/` read it; none of them owns state. New pages
 *  program, Slice 3 (D6): the workspace binds no key of its own, so there is no
 *  keyboard or command-palette wiring here — every action is a control on screen. */
export function useLightingEditor(props: LightingWorkspaceSurfaceProps) {
  const rig = useLightingRig({ props });
  const session = useLightingSession({ props, rig });
  const sceneEditor = useLightingSceneEditor({ props, rig, session });
  const fixtureEditor = useLightingFixtureEditor({ props, rig, session, sceneEditor });
  const rigControls = useLightingRigControls({ props, rig, session, sceneEditor });
  // The page's one arm: the Save row, CUT ALL and every menu's "Delete …".
  const arm = useLightingArming();
  return { props, rig, session, sceneEditor, fixtureEditor, rigControls, arm };
}

export type LightingEditor = ReturnType<typeof useLightingEditor>;
