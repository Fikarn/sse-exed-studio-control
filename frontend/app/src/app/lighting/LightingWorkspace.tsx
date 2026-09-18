import styles from "./LightingWorkspace.module.css";
import { LightingClusterRegion } from "./regions/LightingClusterRegion";
import { LightingBayRegion } from "./regions/LightingBayRegion";
import { LightingPaletteQuickPanel } from "./regions/LightingPaletteQuickPanel";
import { LightingBottomStrips } from "./regions/LightingBottomStrips";
import { ShellRegion } from "@sse/design-system";
import { LightingFooter } from "./components/LightingFooter";
import { LightingDialogs } from "./regions/LightingDialogs";
import type { LightingWorkspaceSurfaceProps } from "./lightingWorkspaceModel";
import { useLightingEditor } from "./useLightingEditor";

/** The Lighting workspace. It assembles; it owns nothing. State and handlers
 *  live in `useLightingEditor`, the regions under `regions/` draw them. */
export function LightingWorkspaceSurface(props: LightingWorkspaceSurfaceProps) {
  const editor = useLightingEditor(props);
  const { lightingSnapshot, lightingDmxMonitorSnapshot } = props;
  const { operatorLayout, dmxStripOn, setDmxStripOn } = editor.session;
  const { bridgeReachable, bridgeUniverse, fixturesPatched, liveFixtureEntries, previewMode } = editor.rig;
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
    <div className={styles.shell} data-testid="lighting-workspace" data-layout-mode={operatorLayout.layoutMode}>
      {/* Visual overhaul A, Slice 5: the toolbar, the bridge banner and the
          preview banner are gone. What they carried is the cluster's — the
          rig's state and its way out at the top, the keys and the rig's
          sections under it — and the cluster is the shell's region, so it is in
          the same place in every workspace. */}
      <LightingClusterRegion editor={editor} />
      <LightingBayRegion editor={editor} />
      <LightingPaletteQuickPanel editor={editor} />
      <LightingBottomStrips editor={editor} />
      <ShellRegion region="footer">
        <LightingFooter
          bridgeReachable={bridgeReachable}
          bridgeUniverse={bridgeUniverse}
          dmxStripOn={dmxStripOn}
          driftDetected={effectiveSceneModified}
          fixturesPatched={fixturesPatched}
          fixturesTotal={liveFixtureEntries.length}
          lastSavedLabel={lastSavedLabel}
          lightingDmxMonitorSnapshot={lightingDmxMonitorSnapshot}
          lightingSnapshot={lightingSnapshot}
          previewMode={previewMode}
          onToggleDmxStrip={() => setDmxStripOn((current) => !current)}
        />
      </ShellRegion>
      <LightingDialogs editor={editor} />
    </div>
  );
}
