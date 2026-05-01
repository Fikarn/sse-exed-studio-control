import { useMemo } from "react";
import { X } from "lucide-react";

import { ChipStrip, type ChipStripChip } from "@sse/design-system";
import type { LightingFixtureSnapshot } from "@sse/engine-client";

import { lightingFixtureColorHex } from "../lightingHelpers";

import styles from "./SelectionChipStrip.module.css";

export interface SelectionChipStripProps {
  /** Full selection set (persisted primary ∪ extras). The strip pulls
   *  fixture snapshots in `fixtures` order so the chip ordering is stable
   *  across re-renders. */
  selectedFixtures: readonly LightingFixtureSnapshot[];
  /** Click chip = additive toggle out of the selection set. Mirrors the
   *  bulk inspector's shift-click semantic. */
  onRemoveFromSelection: (fixtureId: string) => void;
  /** Clear the entire selection. Renders an explicit "Clear" affordance at
   *  the strip's right edge. */
  onClearAll: () => void;
  /** Hover signal — fires with the fixture id (or null on leave). The
   *  workspace propagates this to StagePlot for a brief pulse on the
   *  matching marker. */
  onChipHover?: (fixtureId: string | null) => void;
}

/**
 * Wave 31 — I9 always-visible selection bar. Renders as a 32 px horizontal
 * strip above the health bar when any fixture is selected. Each chip shows
 * the fixture's name + a CCT-tinted intensity dot reflecting its on-state.
 * Click a chip to remove the fixture from the selection; hover to pulse
 * its marker on the stage plot.
 */
export function SelectionChipStrip({
  selectedFixtures,
  onRemoveFromSelection,
  onClearAll,
  onChipHover,
}: SelectionChipStripProps) {
  const chips = useMemo<readonly ChipStripChip[]>(() => {
    return selectedFixtures.map((fixture, index) => ({
      id: fixture.id,
      label: fixture.name,
      // Accent dot: CCT-tinted color when on, neutral when off.
      accentColor: lightingFixtureColorHex(fixture.cct, fixture.on),
      leadingBadge: index + 1,
      ariaLabel: `${fixture.name}${fixture.on ? `, ${fixture.intensity}%, ${fixture.cct}K` : ", off"}. Click to remove from selection.`,
      trailing: (
        <button
          type="button"
          className={styles.chipRemove}
          onClick={(event) => {
            event.stopPropagation();
            onRemoveFromSelection(fixture.id);
          }}
          aria-label={`Remove ${fixture.name} from selection`}
        >
          <X aria-hidden="true" size={11} strokeWidth={2} />
        </button>
      ),
    }));
  }, [selectedFixtures, onRemoveFromSelection]);

  // Always mount the wrapper so the height transition has somewhere to go;
  // collapse to 0 px when the selection is empty so the body grows back
  // smoothly. Inner content is gated on having selection so the empty
  // state doesn't bloat the DOM with hidden chips.
  const isOpen = selectedFixtures.length > 0;

  return (
    <div
      className={`${styles.shell} ${isOpen ? styles.shellOpen : ""}`}
      role="region"
      aria-label="Selected fixtures"
      aria-hidden={!isOpen}
    >
      {isOpen ? (
        <div className={styles.inner}>
          <span className={styles.summary}>
            <strong>{selectedFixtures.length}</strong>{" "}
            {selectedFixtures.length === 1 ? "fixture selected" : "fixtures selected"}
          </span>
          <ChipStrip
            chips={chips}
            ariaLabel={`${selectedFixtures.length} selected fixture${selectedFixtures.length === 1 ? "" : "s"}`}
            className={styles.chipStrip}
            onChipClick={onRemoveFromSelection}
            onChipHover={onChipHover}
          />
          <button type="button" className={styles.clearAll} onClick={onClearAll} aria-label="Clear all selection">
            Clear
          </button>
        </div>
      ) : null}
    </div>
  );
}
