import type {
  AudioSnapshot,
  CamerasSnapshot,
  JsonObject,
  LightingSnapshot,
  PicturesLink,
  PrompterGlassSnapshot,
  PrompterSnapshot,
  ShellStore,
} from "@sse/engine-client";

import type { HeaderItem } from "../shellData";

// The Overview (D47, board 3: `docs/design/boards/overview-3.html`, with
// `docs/design/overview-3.md` and `overview-2.md`): the landing page, every
// page's key facts at once, in four rooms with four jobs: THE TAKE (act),
// THE PICTURE (watch), THE SCRIPT (read) and THE SOUND (listen).

export interface OverviewWorkspaceProps {
  appSnapshot: JsonObject | null;
  audioSnapshot: AudioSnapshot | null;
  camerasSnapshot: CamerasSnapshot | null;
  healthSnapshot: JsonObject | null;
  /** The header's lamps, chips and latches before the header leaves any out
   *  (`buildMonitorItems`): the Overview ranks them for the worst page. */
  lamps: readonly HeaderItem[];
  lightingSnapshot: LightingSnapshot | null;
  /** How the pictures reach the page; `null` in a window with none. */
  pictures?: PicturesLink | null;
  prompterGlassSnapshot: PrompterGlassSnapshot | null;
  prompterSnapshot: PrompterSnapshot | null;
  store: ShellStore;
  supportSnapshot: JsonObject | null;
}

export function OverviewWorkspace(_props: OverviewWorkspaceProps) {
  return (
    <div data-testid="overview-workspace" data-workspace="overview">
      <div data-testid="overview-bay" />
    </div>
  );
}
