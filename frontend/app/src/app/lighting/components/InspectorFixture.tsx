import { type ChangeEvent, useEffect, useId, useRef, useState } from "react";
import { Pencil, Plus, Power, Trash2 } from "lucide-react";

import {
  Button,
  ConfirmDialog,
  IconButton,
  InlineRename,
  InspectorSection,
  StatusDot,
  type InlineRenameHandle,
} from "@sse/design-system";
import type { LightingFixtureSnapshot, LightingGroupSnapshot } from "@sse/engine-client";

import { deriveMounting, type FixtureMounting } from "../fixtureMounting";
import { defaultLightingBeamAngle, isLightingRangeCommitKey, lightingFixtureCctRange } from "../lightingHelpers";
import { STUDIO_LAYOUT } from "../studioLayout";

import { IdentifyBurstButton } from "./IdentifyBurstButton";
import styles from "./LightingInspector.module.css";

const RIG_HEIGHT_MAX_METERS = 8;
const BEAM_ANGLE_MIN_DEGREES = 1;
const BEAM_ANGLE_MAX_DEGREES = 180;

export interface InspectorFixtureProps {
  fixture: LightingFixtureSnapshot;
  groupName?: string;
  groups?: readonly LightingGroupSnapshot[];
  bridgeReachable?: boolean;
  onTogglePower: (fixtureId: string, on: boolean) => void;
  onIntensityCommit: (fixtureId: string, intensity: number) => void;
  onCctCommit: (fixtureId: string, cct: number) => void;
  onIdentifyBurst: (fixtureId: string, fixtureName: string) => void;
  onDeleteFixture?: (fixtureId: string) => void;
  onSpatialCommit?: (
    fixtureId: string,
    partial: {
      spatialX?: number | null;
      spatialY?: number | null;
      rigZ?: number | null;
      beamAngleDegrees?: number | null;
    }
  ) => void;
  /** Inline-rename commit handler. Receives the trimmed new name. */
  onRenameFixture?: (fixtureId: string, newName: string) => void | Promise<void>;
  onAssignFixtureGroup?: (fixtureId: string, groupId: string | null) => void;
  onCreateGroup?: () => void;
  busy?: boolean;
  deleteBusy?: boolean;
  renameBusy?: boolean;
  assignGroupBusy?: boolean;
}

const ASSIGN_NEW_GROUP_VALUE = "__create_group__";

const MOUNTING_LABEL: Record<FixtureMounting, string> = {
  "grid-panel": "Grid · panel",
  "grid-soft": "Grid · soft",
  stand: "Stand",
  "wall-bar": "Wall bar",
};

function formatMaybeMeters(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}

function formatMaybeNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

export function InspectorFixture({
  fixture,
  groupName,
  groups = [],
  bridgeReachable = true,
  onTogglePower,
  onIntensityCommit,
  onCctCommit,
  onIdentifyBurst,
  onDeleteFixture,
  onSpatialCommit,
  onRenameFixture,
  onAssignFixtureGroup,
  onCreateGroup,
  busy = false,
  deleteBusy = false,
  renameBusy = false,
  assignGroupBusy = false,
}: InspectorFixtureProps) {
  const cctRange = lightingFixtureCctRange(fixture.type);
  const cctScaleId = useId();
  const [intensityDraft, setIntensityDraft] = useState(fixture.intensity);
  const [cctDraft, setCctDraft] = useState(fixture.cct);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const renameRef = useRef<InlineRenameHandle | null>(null);

  // Position-field drafts. Strings (not numbers) so the user can type
  // intermediate values like "5." without the input clobbering them.
  const [spatialXDraft, setSpatialXDraft] = useState(() => formatMaybeMeters(fixture.spatialX));
  const [spatialYDraft, setSpatialYDraft] = useState(() => formatMaybeMeters(fixture.spatialY));
  const [rigZDraft, setRigZDraft] = useState(() => formatMaybeMeters(fixture.rigZ));
  const [beamAngleDraft, setBeamAngleDraft] = useState(() => formatMaybeNumber(fixture.beamAngleDegrees));

  useEffect(() => {
    setConfirmingDelete(false);
    setSpatialXDraft(formatMaybeMeters(fixture.spatialX));
    setSpatialYDraft(formatMaybeMeters(fixture.spatialY));
    setRigZDraft(formatMaybeMeters(fixture.rigZ));
    setBeamAngleDraft(formatMaybeNumber(fixture.beamAngleDegrees));
  }, [fixture.id, fixture.spatialX, fixture.spatialY, fixture.rigZ, fixture.beamAngleDegrees]);

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

  const clampSpatial = (field: "spatialX" | "spatialY" | "rigZ" | "beamAngleDegrees", raw: number): number => {
    switch (field) {
      case "spatialX":
        return Math.max(0, Math.min(STUDIO_LAYOUT.roomWidthMeters, raw));
      case "spatialY":
        return Math.max(0, Math.min(STUDIO_LAYOUT.roomDepthMeters, raw));
      case "rigZ":
        return Math.max(0, Math.min(RIG_HEIGHT_MAX_METERS, raw));
      case "beamAngleDegrees":
        return Math.max(BEAM_ANGLE_MIN_DEGREES, Math.min(BEAM_ANGLE_MAX_DEGREES, raw));
    }
  };

  const commitSpatial = (field: "spatialX" | "spatialY" | "rigZ" | "beamAngleDegrees", rawDraft: string) => {
    if (!onSpatialCommit) return;
    const trimmed = rawDraft.trim();
    if (trimmed === "") {
      // Clearing a field maps to null on nullable engine fields.
      onSpatialCommit(fixture.id, { [field]: null });
      return;
    }
    const parsed = Number.parseFloat(trimmed);
    if (!Number.isFinite(parsed)) return;
    const clamped = clampSpatial(field, parsed);
    const current = fixture[field] ?? null;
    if (clamped === current) return;
    onSpatialCommit(fixture.id, { [field]: clamped });
  };

  return (
    <>
      <InspectorSection title="Fixture">
        <div className={styles.fixtureHeader}>
          <div className={styles.fixtureNameStack}>
            <div className={styles.fixtureNameRow}>
              <div className={styles.fixtureName}>
                {onRenameFixture ? (
                  <InlineRename
                    ref={renameRef}
                    value={fixture.name}
                    onCommit={(next) => onRenameFixture(fixture.id, next)}
                    busy={renameBusy}
                    inputAriaLabel={`Rename fixture ${fixture.name}`}
                    maxLength={120}
                  />
                ) : (
                  fixture.name
                )}
              </div>
              {onRenameFixture ? (
                <IconButton
                  tone="ghost"
                  size="sm"
                  icon={Pencil}
                  label={`Rename fixture ${fixture.name}`}
                  onClick={() => renameRef.current?.beginEdit()}
                  disabled={renameBusy}
                />
              ) : null}
            </div>
            <div className={styles.fixtureSubline}>
              <StatusDot state={fixture.on ? "ok" : "info"} size="sm" />
              {fixture.on ? "Live" : "Standby"} · {MOUNTING_LABEL[deriveMounting(fixture.type)]}
            </div>
          </div>
          <Button
            onClick={() => onTogglePower(fixture.id, !fixture.on)}
            loading={busy}
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
            <dt className={styles.factLabel}>Kind</dt>
            <dd className={styles.factValue}>{fixture.kind}</dd>
          </div>
        </dl>
        {onAssignFixtureGroup ? (
          <label className={styles.groupAssignField}>
            <span className={styles.factLabel}>Group</span>
            <select
              className={styles.groupAssignSelect}
              value={fixture.groupId ?? ""}
              disabled={assignGroupBusy}
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (value === ASSIGN_NEW_GROUP_VALUE) {
                  onCreateGroup?.();
                  return;
                }
                onAssignFixtureGroup(fixture.id, value === "" ? null : value);
              }}
            >
              <option value="">Ungrouped</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
              {onCreateGroup ? <option disabled>──────────</option> : null}
              {onCreateGroup ? <option value={ASSIGN_NEW_GROUP_VALUE}>+ Create new group…</option> : null}
            </select>
          </label>
        ) : (
          <dl className={styles.factGrid}>
            <div className={styles.fact}>
              <dt className={styles.factLabel}>Group</dt>
              <dd className={styles.factValue}>{groupName ?? "Ungrouped"}</dd>
            </div>
          </dl>
        )}
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
            aria-describedby={cctScaleId}
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
        <div id={cctScaleId} className={styles.cctScale}>
          <span>{cctRange.min}K · warm</span>
          <span>{cctRange.max}K · cool</span>
        </div>
      </InspectorSection>

      <InspectorSection title="Identify">
        <div className={styles.actionRow}>
          <IdentifyBurstButton
            fixtureId={fixture.id}
            fixtureName={fixture.name}
            onTrigger={onIdentifyBurst}
            disabled={busy}
            bridgeReachable={bridgeReachable}
          />
          <span className={styles.helpText}>
            Sends a 1.2 s burst of full intensity through the bridge so you can spot the fixture on stage.
          </span>
        </div>
      </InspectorSection>

      {onSpatialCommit ? (
        <InspectorSection title="Position">
          <div className={styles.positionGrid}>
            <label className={styles.positionField}>
              <span className={styles.positionLabel}>Stage X (m)</span>
              <input
                aria-label="Stage X position in metres"
                className={styles.positionInput}
                disabled={busy}
                inputMode="decimal"
                type="text"
                value={spatialXDraft}
                onChange={(event) => setSpatialXDraft(event.currentTarget.value)}
                onBlur={() => commitSpatial("spatialX", spatialXDraft)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  }
                }}
              />
            </label>
            <label className={styles.positionField}>
              <span className={styles.positionLabel}>Stage Y (m)</span>
              <input
                aria-label="Stage Y position in metres"
                className={styles.positionInput}
                disabled={busy}
                inputMode="decimal"
                type="text"
                value={spatialYDraft}
                onChange={(event) => setSpatialYDraft(event.currentTarget.value)}
                onBlur={() => commitSpatial("spatialY", spatialYDraft)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  }
                }}
              />
            </label>
            <label className={styles.positionField}>
              <span className={styles.positionLabel}>Rig height (m)</span>
              <input
                aria-label="Rig height in metres"
                className={styles.positionInput}
                disabled={busy}
                inputMode="decimal"
                type="text"
                value={rigZDraft}
                onChange={(event) => setRigZDraft(event.currentTarget.value)}
                onBlur={() => commitSpatial("rigZ", rigZDraft)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  }
                }}
              />
            </label>
            <label className={styles.positionField}>
              <span className={styles.positionLabel}>Beam angle (°)</span>
              <input
                aria-label="Beam angle in degrees"
                className={styles.positionInput}
                disabled={busy}
                inputMode="decimal"
                type="text"
                value={beamAngleDraft}
                onChange={(event) => setBeamAngleDraft(event.currentTarget.value)}
                onBlur={() => commitSpatial("beamAngleDegrees", beamAngleDraft)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  }
                }}
              />
            </label>
          </div>
          <span className={styles.helpText}>
            Drag the marker on the plot, hold ⌥ to free-position, or use the arrow keys (Shift = 0.5 m steps) when the
            fixture is selected. Stage X clamps to 0–{STUDIO_LAYOUT.roomWidthMeters} m, Y to 0–
            {STUDIO_LAYOUT.roomDepthMeters} m, rig height to 0–{RIG_HEIGHT_MAX_METERS} m, beam angle to{" "}
            {BEAM_ANGLE_MIN_DEGREES}°–{BEAM_ANGLE_MAX_DEGREES}° (default for {fixture.type}:{" "}
            {defaultLightingBeamAngle(fixture.type)}°).
          </span>
        </InspectorSection>
      ) : null}

      {onDeleteFixture ? (
        <InspectorSection title="Danger zone">
          <div className={styles.actionRow}>
            <Button
              onClick={() => setConfirmingDelete(true)}
              loading={deleteBusy}
              variant="danger"
              size="compact"
              leadingVisual={<Trash2 aria-hidden="true" size={13} strokeWidth={1.75} />}
            >
              Delete fixture
            </Button>
            <span className={styles.helpText}>
              Removes the fixture from the rig. Saved scenes that referenced it lose this fixture's saved state.
            </span>
          </div>
        </InspectorSection>
      ) : null}

      {confirmingDelete && onDeleteFixture ? (
        <ConfirmDialog
          title="Delete fixture?"
          body={
            <>
              This permanently removes <strong>{fixture.name}</strong> from the rig and frees its DMX address (
              {fixture.dmxStartAddress > 0 ? fixture.dmxStartAddress : "unpatched"}).
            </>
          }
          confirmLabel="Delete fixture"
          danger
          busy={deleteBusy}
          onConfirm={() => {
            setConfirmingDelete(false);
            onDeleteFixture(fixture.id);
          }}
          onCancel={() => setConfirmingDelete(false)}
        />
      ) : null}
    </>
  );
}
