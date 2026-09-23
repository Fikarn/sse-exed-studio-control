import type { LightingPaletteSnapshot } from "@sse/engine-client";
import styles from "../LightingWorkspace.module.css";
import { lightingColorTagHex } from "../lightingColorTags";
import { formatLightingPaletteQuickValue } from "../lightingWorkspaceModel";
import type { LightingEditor } from "../useLightingEditor";

/** The quick palette panel (Ctrl+Shift+P): apply a palette to the selection. */
export function LightingPaletteQuickPanel({ editor }: { editor: LightingEditor }) {
  const {
    paletteQuickDisabled,
    setPaletteQuickOpen,
    handleApplyPalette,
    paletteQuickOpen,
    paletteQuickStatus,
    paletteQuickQuery,
    setPaletteQuickQuery,
    recentQuickPalettes,
    quickIntensityPalettes,
    quickCctPalettes,
    filteredQuickPalettes,
  } = editor.rigControls;
  const { busyActions } = editor.session;
  const { selectedFixtureIds } = editor.fixtureEditor;
  const renderQuickPaletteButton = (entry: LightingPaletteSnapshot) => {
    const valueLabel = formatLightingPaletteQuickValue(entry);
    return (
      <button
        key={entry.id}
        type="button"
        className={styles.paletteQuickTile}
        aria-label={`Apply palette ${entry.name} ${valueLabel}`}
        disabled={paletteQuickDisabled || busyActions.has(`palette-apply:${entry.id}`)}
        onClick={() => {
          setPaletteQuickOpen(false);
          void handleApplyPalette(entry.id, Array.from(selectedFixtureIds));
        }}
      >
        <span
          className={styles.paletteQuickAccent}
          style={{ background: lightingColorTagHex(entry.colorIndex) ?? "transparent" }}
          aria-hidden="true"
        />
        <span>{entry.name}</span>
        <small>{valueLabel}</small>
      </button>
    );
  };
  const renderQuickPaletteSection = (label: string, entries: readonly LightingPaletteSnapshot[]) =>
    entries.length > 0 ? (
      <section className={styles.paletteQuickSection} aria-label={`${label} palettes`}>
        <h3 className={styles.paletteQuickSectionTitle}>{label}</h3>
        <div className={styles.paletteQuickGrid}>{entries.map(renderQuickPaletteButton)}</div>
      </section>
    ) : null;
  return (
    <>
      {paletteQuickOpen ? (
        <div className={styles.paletteQuickOverlay} role="presentation" onMouseDown={() => setPaletteQuickOpen(false)}>
          <div
            className={styles.paletteQuickPanel}
            role="dialog"
            aria-modal="true"
            aria-label="Lighting palettes"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className={styles.paletteQuickHeader}>
              <strong>Palettes</strong>
              <span>{paletteQuickStatus}</span>
            </div>
            <div className={styles.paletteQuickSearch}>
              <input
                type="search"
                autoFocus
                aria-label="Search palettes"
                placeholder="Search palettes"
                value={paletteQuickQuery}
                onChange={(event) => setPaletteQuickQuery(event.currentTarget.value)}
              />
            </div>
            {paletteQuickDisabled ? <p className={styles.paletteQuickHint}>{paletteQuickStatus}.</p> : null}
            {recentQuickPalettes.length > 0 ? renderQuickPaletteSection("Recent", recentQuickPalettes) : null}
            {renderQuickPaletteSection("Intensity", quickIntensityPalettes)}
            {renderQuickPaletteSection("CCT", quickCctPalettes)}
            {filteredQuickPalettes.length === 0 ? (
              <p className={styles.paletteQuickEmpty}>No palettes match the search.</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
