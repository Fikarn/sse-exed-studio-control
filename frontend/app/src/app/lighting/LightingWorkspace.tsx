import { memo, useEffect } from "react";

import styles from "./LightingWorkspace.module.css";
import { LightingClusterRegion } from "./regions/LightingClusterRegion";
import { LightingBayRegion } from "./regions/LightingBayRegion";
import { LightingPlatePanel } from "./regions/LightingPlatePanel";
import { ShellRegion } from "@sse/design-system";
import { LightingFooter } from "./components/LightingFooter";
import { LightingDialogs } from "./regions/LightingDialogs";
import type { LightingWorkspaceSurfaceProps } from "./lightingWorkspaceModel";
import { useLightingEditor } from "./useLightingEditor";
import { countRender } from "../shared/renderCounts";

/** The Lighting workspace. It assembles; it owns nothing. State and handlers
 *  live in `useLightingEditor`, the regions under `regions/` draw them. */
function LightingWorkspaceSurfaceRoot(props: LightingWorkspaceSurfaceProps) {
  const editor = useLightingEditor(props);
  useEffect(() => countRender("lightingWorkspace"));
  const { lightingSnapshot, lightingDmxMonitorSnapshot } = props;
  const { bridgeUniverse, fixturesPatched, liveFixtureEntries, previewMode } = editor.rig;
  const { effectiveSceneModified, lastSavedLabel } = editor.sceneEditor;
  if (!lightingSnapshot) {
    return (
      <div className={styles.shell}>
        <div className={styles.connectingState} role="status" aria-live="polite">
          <p className={styles.connectingTitle}>Loading the rig…</p>
          <p className={styles.connectingHint}>
            Reading what the bridge and the fixtures report. This usually takes a fraction of a second.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.shell} data-testid="lighting-workspace">
      {/* The cluster and the plate are the shell's regions; the bay is the
          plot's well and the bar under it. */}
      <LightingClusterRegion editor={editor} />
      <LightingBayRegion editor={editor} />
      {/* The shell (overhaul 3): one plate mechanism for every page. */}
      <ShellRegion region="plate">
        <LightingPlatePanel editor={editor} />
      </ShellRegion>
      <ShellRegion region="footer">
        <LightingFooter
          bridgeUniverse={bridgeUniverse}
          driftDetected={effectiveSceneModified}
          fixturesPatched={fixturesPatched}
          fixturesTotal={liveFixtureEntries.length}
          lastSavedLabel={lastSavedLabel}
          lightingDmxMonitorSnapshot={lightingDmxMonitorSnapshot}
          previewMode={previewMode}
        />
      </ShellRegion>
      <LightingDialogs editor={editor} />
    </div>
  );
}

// The page root is memoised (the audit of 2026-10-12): the shell renders at
// every store change, and a page whose props have not changed is left alone.
export const LightingWorkspaceSurface = memo(LightingWorkspaceSurfaceRoot);
