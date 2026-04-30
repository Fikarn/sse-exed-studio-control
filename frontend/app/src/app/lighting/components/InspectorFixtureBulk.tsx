import { Power } from "lucide-react";

import { Button, InspectorSection, MultiValueSlider } from "@sse/design-system";
import type { LightingFixtureSnapshot } from "@sse/engine-client";

import { lightingFixtureCctRange } from "../lightingHelpers";

import styles from "./LightingInspector.module.css";

export interface BulkFixtureValue {
  fixtureId: string;
  value: number;
}

export interface InspectorFixtureBulkProps {
  fixtures: readonly LightingFixtureSnapshot[];
  onClearSelection: () => void;
  onBulkTogglePower: (fixtureIds: readonly string[], on: boolean) => void;
  /** Per-fixture intensity update (Wave 27). Drag-shift preserves spread;
   *  delta-input ("+5", "+10%", "65") applies per-fixture math via
   *  MultiValueSlider's parser. */
  onBulkIntensityValues: (values: ReadonlyArray<BulkFixtureValue>) => void;
  /** Per-fixture CCT update (Wave 27). Same semantics as intensity. */
  onBulkCctValues: (values: ReadonlyArray<BulkFixtureValue>) => void;
  /**
   * Click → focus this fixture as the single primary selection.
   * Shift-click → toggle the fixture out of the bulk extras (cannot remove
   * the persisted primary; click another fixture first to swap primaries).
   * Optional — when omitted the chips render non-interactive.
   */
  onSelectFixture?: (fixtureId: string, options?: { additive?: boolean }) => void;
}

function intersectCctRange(fixtures: readonly LightingFixtureSnapshot[]): { min: number; max: number } {
  // Bulk slider stays inside every selected fixture's supported range so a
  // commit can never push a fixture out of bounds.
  let min = -Infinity;
  let max = Infinity;
  for (const fixture of fixtures) {
    const range = lightingFixtureCctRange(fixture.type);
    if (range.min > min) min = range.min;
    if (range.max < max) max = range.max;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
    // Fallback when types disagree wildly — surface the union and let the
    // single-fixture commits clamp.
    return { min: 2_000, max: 10_000 };
  }
  return { min, max };
}

export function InspectorFixtureBulk({
  fixtures,
  onClearSelection,
  onBulkTogglePower,
  onBulkIntensityValues,
  onBulkCctValues,
  onSelectFixture,
}: InspectorFixtureBulkProps) {
  const ids = fixtures.map((fixture) => fixture.id);
  const allOn = fixtures.every((fixture) => fixture.on);
  const anyOn = fixtures.some((fixture) => fixture.on);
  const cctRange = intersectCctRange(fixtures);

  // Drag-shift + delta-input both flow through MultiValueSlider; the slider
  // returns a per-value array which we zip with the fixture id list and
  // forward to the bulk-IPC handler.
  const intensityValues = fixtures.map((fixture) => fixture.intensity);
  const cctValues = fixtures.map((fixture) => fixture.cct);

  const handleIntensityValues = (next: number[]) => {
    onBulkIntensityValues(next.map((value, index) => ({ fixtureId: ids[index]!, value: Math.round(value) })));
  };
  const handleCctValues = (next: number[]) => {
    onBulkCctValues(next.map((value, index) => ({ fixtureId: ids[index]!, value: Math.round(value / 100) * 100 })));
  };

  return (
    <>
      <InspectorSection title="Bulk selection">
        <div className={styles.fixtureHeader}>
          <div>
            <div className={styles.fixtureName}>{fixtures.length} fixtures selected</div>
            <div className={styles.fixtureSubline}>
              Edits apply to every selected fixture · Click any marker to focus one.
            </div>
          </div>
          <Button
            onClick={() => onBulkTogglePower(ids, !anyOn)}
            variant={allOn ? "secondary" : "primary"}
            size="compact"
            leadingVisual={<Power aria-hidden="true" size={13} strokeWidth={1.75} />}
          >
            {anyOn ? "Turn all off" : "Turn all on"}
          </Button>
        </div>
        <ul className={styles.sceneFixtureChips}>
          {fixtures.map((fixture) => {
            if (!onSelectFixture) {
              return (
                <li key={fixture.id} className={styles.sceneFixtureChip}>
                  <span className={styles.sceneFixtureName}>{fixture.name}</span>
                  <span className={styles.sceneFixtureLevel}>
                    {fixture.on ? `${Math.round(fixture.intensity)}%` : "off"}
                  </span>
                </li>
              );
            }
            return (
              <li key={fixture.id}>
                <button
                  type="button"
                  className={`${styles.sceneFixtureChip} ${styles.sceneFixtureChipButton}`}
                  onClick={(event) => onSelectFixture(fixture.id, { additive: event.shiftKey })}
                  aria-label={`${fixture.name} — click to focus, shift-click to remove from selection`}
                >
                  <span className={styles.sceneFixtureName}>{fixture.name}</span>
                  <span className={styles.sceneFixtureLevel}>
                    {fixture.on ? `${Math.round(fixture.intensity)}%` : "off"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <span className={styles.helpText}>
          Click a chip to focus that fixture · Shift-click to remove it from the selection.
        </span>
      </InspectorSection>

      <InspectorSection title="Bulk intensity">
        <MultiValueSlider
          ariaLabel="Bulk intensity"
          values={intensityValues}
          min={0}
          max={100}
          step={1}
          // onValuesChange is intentionally a no-op so the slider's internal
          // draftAvg drives the thumb during drag without firing N IPCs per
          // pointermove (was 720+ IPCs/sec at 60 Hz × 12 fixtures). The
          // onValuesCommit handler fires once on pointerup with the final
          // delta-shifted values; the delta-input field also routes through
          // onValuesCommit on Enter.
          onValuesChange={() => undefined}
          onValuesCommit={handleIntensityValues}
          // No disable on busy — bulk-IPCs commit in <1ms, so the brief
          // disabled state was perceived as a release-blink. Slider stays
          // responsive across back-to-back commits.
          disabled={!anyOn}
          unit="%"
        />
      </InspectorSection>

      <InspectorSection title="Bulk colour temperature">
        <MultiValueSlider
          ariaLabel="Bulk CCT"
          values={cctValues}
          min={cctRange.min}
          max={cctRange.max}
          step={100}
          onValuesChange={() => undefined}
          onValuesCommit={handleCctValues}
          unit="K"
        />
        <div className={styles.helpText}>
          Range narrowed to {cctRange.min}–{cctRange.max}K — the intersection of every selected fixture's supported
          range.
        </div>
      </InspectorSection>

      <InspectorSection title="Selection">
        <div className={styles.actionRow}>
          <Button onClick={onClearSelection} variant="ghost" size="compact">
            Clear selection
          </Button>
          <span className={styles.helpText}>Press Esc or click empty plot to clear.</span>
        </div>
      </InspectorSection>
    </>
  );
}
