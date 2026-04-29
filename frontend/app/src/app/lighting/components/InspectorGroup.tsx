import { Pencil, Power } from "lucide-react";

import { Button, IconButton, InspectorSection, StatusDot } from "@sse/design-system";
import type { LightingFixtureSnapshot } from "@sse/engine-client";

import { formatLightingValueRange } from "../lightingHelpers";

import styles from "./LightingInspector.module.css";

export interface InspectorGroupProps {
  groupId: string;
  groupName: string;
  fixtures: readonly LightingFixtureSnapshot[];
  onTogglePower: (groupId: string, on: boolean) => void;
  onSelectFixture: (fixtureId: string) => void;
  onRenameGroup?: (groupId: string, currentName: string) => void;
  busy?: boolean;
  renameBusy?: boolean;
}

export function InspectorGroup({
  groupId,
  groupName,
  fixtures,
  onTogglePower,
  onSelectFixture,
  onRenameGroup,
  busy = false,
  renameBusy = false,
}: InspectorGroupProps) {
  const onCount = fixtures.filter((fixture) => fixture.on).length;
  const allOn = fixtures.length > 0 && onCount === fixtures.length;

  const intensities = fixtures.map((fixture) => fixture.intensity);
  const ccts = fixtures.map((fixture) => fixture.cct);
  const intensityMin = intensities.length > 0 ? Math.min(...intensities) : 0;
  const intensityMax = intensities.length > 0 ? Math.max(...intensities) : 0;
  const cctMin = ccts.length > 0 ? Math.min(...ccts) : 0;
  const cctMax = ccts.length > 0 ? Math.max(...ccts) : 0;

  const dotState = allOn ? "ok" : "info";

  return (
    <>
      <InspectorSection title="Group">
        <div className={styles.fixtureHeader}>
          <div className={styles.fixtureNameStack}>
            <div className={styles.fixtureNameRow}>
              <div className={styles.fixtureName}>{groupName}</div>
              {onRenameGroup ? (
                <IconButton
                  tone="ghost"
                  size="sm"
                  icon={Pencil}
                  label={`Rename group ${groupName}`}
                  onClick={() => onRenameGroup(groupId, groupName)}
                  disabled={renameBusy}
                />
              ) : null}
            </div>
            <div className={styles.fixtureSubline}>
              <StatusDot state={dotState} size="sm" />
              {onCount}/{fixtures.length} on
            </div>
          </div>
          <Button
            onClick={() => onTogglePower(groupId, !allOn)}
            disabled={busy || fixtures.length === 0}
            variant={allOn ? "secondary" : "primary"}
            size="compact"
            leadingVisual={<Power aria-hidden="true" size={13} strokeWidth={1.75} />}
          >
            {allOn ? "Turn group off" : "Turn group on"}
          </Button>
        </div>
        <dl className={styles.factGrid}>
          <div className={styles.fact}>
            <dt className={styles.factLabel}>Intensity</dt>
            <dd className={styles.factValue}>
              {fixtures.length > 0 ? formatLightingValueRange(intensityMin, intensityMax, "%") : "—"}
            </dd>
          </div>
          <div className={styles.fact}>
            <dt className={styles.factLabel}>CCT</dt>
            <dd className={styles.factValue}>
              {fixtures.length > 0 ? formatLightingValueRange(cctMin, cctMax, "K") : "—"}
            </dd>
          </div>
        </dl>
      </InspectorSection>

      <InspectorSection title="Members">
        {fixtures.length === 0 ? (
          <p className={styles.empty}>This group has no fixtures yet.</p>
        ) : (
          <ul className={styles.memberList}>
            {fixtures.map((fixture) => (
              <li key={fixture.id}>
                <button type="button" className={styles.memberRow} onClick={() => onSelectFixture(fixture.id)}>
                  <span className={styles.memberName}>{fixture.name}</span>
                  <span className={styles.memberMeta}>
                    {fixture.on ? `${fixture.intensity}% · ${fixture.cct}K` : "off"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </InspectorSection>
    </>
  );
}
