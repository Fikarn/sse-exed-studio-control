import { type ChangeEvent, useEffect, useState } from "react";
import { Power } from "lucide-react";

import { Button, InspectorSection, StatusDot } from "@sse/design-system";
import type { LightingFixtureSnapshot } from "@sse/engine-client";

import { deriveMounting, type FixtureMounting } from "../fixtureMounting";
import { lightingFixtureCctRange, isLightingRangeCommitKey } from "../lightingHelpers";

import { IdentifyBurstButton } from "./IdentifyBurstButton";
import styles from "./LightingInspector.module.css";

export interface InspectorFixtureProps {
  fixture: LightingFixtureSnapshot;
  groupName?: string;
  onTogglePower: (fixtureId: string, on: boolean) => void;
  onIntensityCommit: (fixtureId: string, intensity: number) => void;
  onCctCommit: (fixtureId: string, cct: number) => void;
  onIdentifyBurst: (fixtureId: string, fixtureName: string) => void;
  busy?: boolean;
}

const MOUNTING_LABEL: Record<FixtureMounting, string> = {
  "grid-panel": "Grid · panel",
  "grid-soft": "Grid · soft",
  stand: "Stand",
  "wall-bar": "Wall bar",
};

export function InspectorFixture({
  fixture,
  groupName,
  onTogglePower,
  onIntensityCommit,
  onCctCommit,
  onIdentifyBurst,
  busy = false,
}: InspectorFixtureProps) {
  const cctRange = lightingFixtureCctRange(fixture.type);
  const [intensityDraft, setIntensityDraft] = useState(fixture.intensity);
  const [cctDraft, setCctDraft] = useState(fixture.cct);

  useEffect(() => {
    setIntensityDraft(fixture.intensity);
  }, [fixture.id, fixture.intensity]);

  useEffect(() => {
    setCctDraft(fixture.cct);
  }, [fixture.id, fixture.cct]);

  const handleIntensityChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.currentTarget.value);
    if (Number.isFinite(value)) {
      setIntensityDraft(Math.max(0, Math.min(100, Math.round(value))));
    }
  };

  const commitIntensity = () => {
    if (intensityDraft !== fixture.intensity) {
      onIntensityCommit(fixture.id, intensityDraft);
    }
  };

  const handleCctChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.currentTarget.value);
    if (Number.isFinite(value)) {
      setCctDraft(Math.max(cctRange.min, Math.min(cctRange.max, Math.round(value))));
    }
  };

  const commitCct = () => {
    if (cctDraft !== fixture.cct) {
      onCctCommit(fixture.id, cctDraft);
    }
  };

  return (
    <>
      <InspectorSection title="Fixture">
        <div className={styles.fixtureHeader}>
          <div>
            <div className={styles.fixtureName}>{fixture.name}</div>
            <div className={styles.fixtureSubline}>
              <StatusDot state={fixture.on ? "ok" : "info"} size="sm" />
              {fixture.on ? "Live" : "Standby"} · {MOUNTING_LABEL[deriveMounting(fixture.type)]}
            </div>
          </div>
          <Button
            onClick={() => onTogglePower(fixture.id, !fixture.on)}
            disabled={busy}
            variant={fixture.on ? "secondary" : "primary"}
            size="compact"
            leadingVisual={<Power aria-hidden="true" size={13} strokeWidth={1.75} />}
          >
            {fixture.on ? "Turn off" : "Turn on"}
          </Button>
        </div>
        <dl className={styles.factGrid}>
          <div className={styles.fact}>
            <dt className={styles.factLabel}>Type</dt>
            <dd className={styles.factValue}>{fixture.type}</dd>
          </div>
          <div className={styles.fact}>
            <dt className={styles.factLabel}>Group</dt>
            <dd className={styles.factValue}>{groupName ?? "Ungrouped"}</dd>
          </div>
          <div className={styles.fact}>
            <dt className={styles.factLabel}>Kind</dt>
            <dd className={styles.factValue}>{fixture.kind}</dd>
          </div>
        </dl>
      </InspectorSection>

      <InspectorSection title="Intensity">
        <div className={styles.sliderRow}>
          <input
            aria-label="Fixture intensity"
            className={styles.slider}
            disabled={busy || !fixture.on}
            type="range"
            min={0}
            max={100}
            step={1}
            value={intensityDraft}
            onChange={handleIntensityChange}
            onPointerUp={commitIntensity}
            onBlur={commitIntensity}
            onKeyUp={(event) => {
              if (isLightingRangeCommitKey(event.key)) {
                commitIntensity();
              }
            }}
          />
          <span className={styles.sliderValue}>{intensityDraft}%</span>
        </div>
      </InspectorSection>

      <InspectorSection title="Colour temperature">
        <div className={styles.sliderRow}>
          <input
            aria-label="Fixture CCT"
            className={`${styles.slider} ${styles.sliderCct}`}
            disabled={busy}
            type="range"
            min={cctRange.min}
            max={cctRange.max}
            step={100}
            value={cctDraft}
            onChange={handleCctChange}
            onPointerUp={commitCct}
            onBlur={commitCct}
            onKeyUp={(event) => {
              if (isLightingRangeCommitKey(event.key)) {
                commitCct();
              }
            }}
          />
          <span className={styles.sliderValue}>{cctDraft}K</span>
        </div>
        <div className={styles.helpText}>
          Range {cctRange.min}–{cctRange.max}K for {fixture.type}.
        </div>
      </InspectorSection>

      <InspectorSection title="Identify">
        <div className={styles.actionRow}>
          <IdentifyBurstButton
            fixtureId={fixture.id}
            fixtureName={fixture.name}
            onTrigger={onIdentifyBurst}
            disabled={busy}
          />
          <span className={styles.helpText}>
            Sends a 1.2 s burst of full intensity through the bridge so you can spot the fixture on stage.
          </span>
        </div>
      </InspectorSection>
    </>
  );
}
