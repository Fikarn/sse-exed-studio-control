import styles from "../LightingWorkspace.module.css";
import { SelectionChipStrip } from "../components/SelectionChipStrip";
import { DMXCompactStrip } from "../components/DMXCompactStrip";
import type { LightingEditor } from "../useLightingEditor";

/** Above the footer: the selection chips and the compact DMX strip. */
export function LightingBottomStrips({ editor }: { editor: LightingEditor }) {
  const { lightingDmxMonitorSnapshot, lightingFixtureCatalogSnapshot } = editor.props;
  const { selectedFixtureSnapshots, handleRemoveFromSelection, handleSelectFixture, setChipHoverFixtureId } =
    editor.fixtureEditor;
  const { dmxStripOn, renderDmxStrip, setDmxMonitorOpen, setDmxStripOn } = editor.session;
  const { liveFixtures, bridgeReachable, bridgeUniverse } = editor.rig;
  return (
    <div className={styles.bottomStripStack}>
      <SelectionChipStrip
        selectedFixtures={selectedFixtureSnapshots}
        onRemoveFromSelection={(fixtureId) => void handleRemoveFromSelection(fixtureId)}
        onClearAll={() => void handleSelectFixture(null)}
        onChipHover={setChipHoverFixtureId}
      />
      <div
        className={`${styles.dmxStripWrapper} ${dmxStripOn ? styles.dmxStripWrapperOpen : ""}`}
        aria-hidden={!dmxStripOn}
      >
        {renderDmxStrip ? (
          <div className={styles.dmxStripContent}>
            <DMXCompactStrip
              snapshot={lightingDmxMonitorSnapshot}
              fixtures={liveFixtures}
              catalog={lightingFixtureCatalogSnapshot}
              bridgeReachable={bridgeReachable}
              universe={bridgeUniverse}
              onOpenMonitor={() => setDmxMonitorOpen(true)}
              onClose={() => setDmxStripOn(false)}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
