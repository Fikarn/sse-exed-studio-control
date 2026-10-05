import type { CSSProperties } from "react";

import { Key, MultiValueSlider, PlateHead, Section, Tooltip } from "@sse/design-system";
import type { LightingFixtureSnapshot } from "@sse/engine-client";

import { lightingFixtureCctRange, lightingFixtureColor } from "../lightingHelpers";

import styles from "./LightingInspector.module.css";

// The visual overhaul's Lighting page (2026-10-04): several fixtures on the
// plate. Their title plate; the Selection key (lit while any is on) and Clear
// the selection; one slider for their levels and one for their colour (a drag
// moves them all and keeps their spread); and the fixtures, each a row that
// opens it alone.

export interface BulkFixtureValue {
  fixtureId: string;
  value: number;
}

type FixtureValuePreviewPhase = "editing" | "committing";

const MEMBER_ROWS = 12;

export interface InspectorFixtureBulkProps {
  fixtures: readonly LightingFixtureSnapshot[];
  onClearSelection: () => void;
  onBulkTogglePower: (fixtureIds: readonly string[], on: boolean) => void;
  onBulkIntensityValues: (values: ReadonlyArray<BulkFixtureValue>) => void;
  onBulkIntensityPreview?: (values: ReadonlyArray<BulkFixtureValue>, phase: FixtureValuePreviewPhase) => void;
  onBulkCctValues: (values: ReadonlyArray<BulkFixtureValue>) => void;
  onBulkCctPreview?: (values: ReadonlyArray<BulkFixtureValue>, phase: FixtureValuePreviewPhase) => void;
  onSelectFixture?: (fixtureId: string) => void;
}

function intersectCctRange(fixtures: readonly LightingFixtureSnapshot[]): { min: number; max: number } {
  // The slider stays inside every selected fixture's range, so a commit can
  // never push one out of it.
  let min = -Infinity;
  let max = Infinity;
  for (const fixture of fixtures) {
    const range = lightingFixtureCctRange(fixture.type);
    if (range.min > min) min = range.min;
    if (range.max < max) max = range.max;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return { min: 2_000, max: 10_000 };
  return { min, max };
}

export function InspectorFixtureBulk({
  fixtures,
  onClearSelection,
  onBulkTogglePower,
  onBulkIntensityValues,
  onBulkIntensityPreview,
  onBulkCctValues,
  onBulkCctPreview,
  onSelectFixture,
}: InspectorFixtureBulkProps) {
  const ids = fixtures.map((fixture) => fixture.id);
  const anyOn = fixtures.some((fixture) => fixture.on);
  const cctRange = intersectCctRange(fixtures);
  const buildIntensityValues = (next: readonly number[]): BulkFixtureValue[] =>
    next.map((value, index) => ({ fixtureId: ids[index]!, value: Math.round(value) }));
  const buildCctValues = (next: readonly number[]): BulkFixtureValue[] =>
    next.map((value, index) => ({ fixtureId: ids[index]!, value: Math.round(value / 100) * 100 }));
  const shown = fixtures.slice(0, MEMBER_ROWS);
  const onCount = fixtures.filter((fixture) => fixture.on).length;

  return (
    <>
      {/* The visual overhaul's polish (2026-10-05): the helper sentence is the
          title's tooltip (DESIGN.md §9); until then it was the sub-line. */}
      <PlateHead
        title={
          <Tooltip content="A change here applies to every one of them." placement="left">
            <span>{`${fixtures.length} fixtures selected`}</span>
          </Tooltip>
        }
        testId="lighting-plate-head"
      />

      <div className={styles.keyRow}>
        {/* The visual overhaul's polish (2026-10-05): a toggle keeps one name
            and its fill and hint say the state, in the LIGHTING key's words;
            until then a lit key read "Turn all off". */}
        <Key
          mode="toggle"
          size="large"
          live={anyOn}
          aria-pressed={anyOn}
          hint={anyOn ? `on · ${onCount} of ${fixtures.length} lit` : "off · nothing lit"}
          testId="lighting-plate-bulk-power"
          onClick={() => onBulkTogglePower(ids, !anyOn)}
        >
          Selection
        </Key>
        <Key size="large" onClick={onClearSelection}>
          Clear selection
        </Key>
      </div>

      <Section title="Levels" detail="moves them together" data-plate-section="levels">
        <div className={styles.bulkRow}>
          <span className={styles.bulkLabel}>Intensity</span>
          <MultiValueSlider
            ariaLabel="Bulk intensity"
            values={fixtures.map((fixture) => fixture.intensity)}
            min={0}
            max={100}
            step={1}
            onValuesChange={(next) => onBulkIntensityPreview?.(buildIntensityValues(next), "editing")}
            onValuesCommit={(next) => {
              const values = buildIntensityValues(next);
              onBulkIntensityPreview?.(values, "committing");
              onBulkIntensityValues(values);
            }}
            disabled={!anyOn}
            unit="%"
          />
        </div>
        <div className={styles.bulkRow}>
          <Tooltip content={`Within ${cctRange.min}–${cctRange.max} K: the range every selected fixture has.`}>
            <span className={styles.bulkLabel}>Colour temperature</span>
          </Tooltip>
          <MultiValueSlider
            ariaLabel="Bulk CCT"
            values={fixtures.map((fixture) => fixture.cct)}
            min={cctRange.min}
            max={cctRange.max}
            step={100}
            onValuesChange={(next) => onBulkCctPreview?.(buildCctValues(next), "editing")}
            onValuesCommit={(next) => {
              const values = buildCctValues(next);
              onBulkCctPreview?.(values, "committing");
              onBulkCctValues(values);
            }}
            unit="K"
          />
        </div>
      </Section>

      <Section title="Selected" detail={`${fixtures.length} fixtures`}>
        <ul className={styles.memberList} aria-label="The selected fixtures">
          {shown.map((fixture) => (
            <li key={fixture.id}>
              <button
                type="button"
                className={styles.memberRow}
                aria-label={`${fixture.name} — show it alone`}
                disabled={!onSelectFixture}
                onClick={() => onSelectFixture?.(fixture.id)}
              >
                <span
                  aria-hidden="true"
                  className={styles.memberLamp}
                  style={{ background: lightingFixtureColor(fixture.cct, fixture.on) } as CSSProperties}
                />
                <span className={styles.memberName}>{fixture.name}</span>
                <span className={styles.memberValue}>
                  {fixture.on ? `${Math.round(fixture.intensity)} % · ${Math.round(fixture.cct)} K` : "off"}
                </span>
              </button>
            </li>
          ))}
          {fixtures.length > shown.length ? (
            <li className={styles.memberMore}>and {fixtures.length - shown.length} more</li>
          ) : null}
        </ul>
      </Section>
    </>
  );
}
