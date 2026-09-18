import type { LightingWorkspaceSurfaceProps } from "./lightingWorkspaceModel";
import { useLightingRig } from "./editor/useLightingRig";
import { useLightingSession } from "./editor/useLightingSession";
import { useLightingSceneEditor } from "./editor/useLightingSceneEditor";
import { useLightingFixtureEditor } from "./editor/useLightingFixtureEditor";
import { useLightingRigControls } from "./editor/useLightingRigControls";
import { useLightingCommands } from "./editor/useLightingCommands";

/** Everything the Lighting workspace knows and can do, assembled in dependency
 *  order: what the snapshots say (rig), what this sitting has open (session),
 *  the scene editor, the fixture editor, the rig-wide controls, and the
 *  command-palette and keyboard wiring that reach all of them. The region
 *  components under `regions/` read it; none of them owns state. */
export function useLightingEditor(props: LightingWorkspaceSurfaceProps) {
  const rig = useLightingRig({ props });
  const session = useLightingSession({ props, rig });
  const sceneEditor = useLightingSceneEditor({ props, rig, session });
  const fixtureEditor = useLightingFixtureEditor({ props, rig, session, sceneEditor });
  const rigControls = useLightingRigControls({ props, rig, session, sceneEditor, fixtureEditor });
  useLightingCommands({ props, rig, session, sceneEditor, fixtureEditor, rigControls });
  return { props, rig, session, sceneEditor, fixtureEditor, rigControls };
}

export type LightingEditor = ReturnType<typeof useLightingEditor>;
