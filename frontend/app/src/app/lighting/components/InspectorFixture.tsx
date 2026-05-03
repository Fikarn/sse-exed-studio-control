import { useEffect, useId, useRef, useState } from "react";
import { Pencil, Power, Trash2 } from "lucide-react";

import {
  Button,
  ConfirmDialog,
  IconButton,
  InlineRename,
  InspectorSection,
  ScrubLabel,
  ScrubSlider,
  StatusDot,
  type InlineRenameHandle,
} from "@sse/design-system";
import type {
  LightingFixtureCatalogSnapshot,
  LightingFixtureSnapshot,
  LightingGroupSnapshot,
} from "@sse/engine-client";

import { deriveMounting, type FixtureMounting } from "../fixtureMounting";
import { getFixtureDefinition, getFixtureMode, fixtureDefinitionLabel } from "../fixtureCatalog";
import { defaultLightingBeamAngle, lightingFixtureCctRange } from "../lightingHelpers";
import { STUDIO_LAYOUT } from "../studioLayout";

import { IdentifyBurstButton } from "./IdentifyBurstButton";
import styles from "./LightingInspector.module.css";

const RIG_HEIGHT_MAX_METERS = 8;
const BEAM_ANGLE_MIN_DEGREES = 1;
const BEAM_ANGLE_MAX_DEGREES = 180;

export interface InspectorFixtureProps {
  fixture: LightingFixtureSnapshot;
  catalog?: LightingFixtureCatalogSnapshot | null;
  groupName?: string;
  groups?: readonly LightingGroupSnapshot[];
  bridgeReachable?: boolean;
  onTogglePower: (fixtureId: string, on: boolean) => void;
  onIntensityCommit: (fixtureId: string, intensity: number) => void;
  onCctCommit: (fixtureId: string, cct: number) => void;
  onControlValuesCommit?: (fixtureId: string, controlValues: Record<string, number>) => void;
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
  /** Power-toggle in-flight indicator. Drives the loading spinner on the
   *  Turn on/off button; intentionally narrow so unrelated commits (rename,
   *  position, identify) don't flicker the button into a loading state. */
  powerBusy?: boolean;
  deleteBusy?: boolean;
  renameBusy?: boolean;
  assignGroupBusy?: boolean;
  /** When this nonce changes (and is non-null), the inspector triggers
   *  beginEdit() on the inline rename. Driven by marker context-menu "Rename". */
  pendingInlineRenameNonce?: number | null;
}

const ASSIGN_NEW_GROUP_VALUE = "__create_group__";

const MOUNTING_LABEL: Record<FixtureMounting, string> = {
  bar: "Bar",
  "control-node": "Control node",
  fresnel: "Fresnel",
  mat: "Mat",
  panel: "Panel",
};

function formatMaybeMeters(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}

function formatMaybeNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function parseDraft(draft: string, fallback: number): number {
  const trimmed = draft.trim();
  if (!trimmed) return fallback;
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatScrubMeters(value: number): string {
  // ScrubLabel writes back into the draft string. Round to 1 decimal so the
  // input field doesn't fill with floating-point noise.
  return (Math.round(value * 10) / 10).toFixed(1);
}

function formatScrubDegrees(value: number): string {
  return String(Math.round(value));
}

export function InspectorFixture({
  fixture,
  catalog = null,
  groupName,
  groups = [],
  bridgeReachable = true,
  onTogglePower,
  onIntensityCommit,
  onCctCommit,
  onControlValuesCommit,
  onIdentifyBurst,
  onDeleteFixture,
  onSpatialCommit,
  onRenameFixture,
  onAssignFixtureGroup,
  onCreateGroup,
  powerBusy = false,
  deleteBusy = false,
  renameBusy = false,
  assignGroupBusy = false,
  pendingInlineRenameNonce = null,
}: InspectorFixtureProps) {
  const definition = getFixtureDefinition(catalog, fixture);
  const mode = getFixtureMode(definition, fixture.modeId);
  const cctRange = lightingFixtureCctRange(fixture, catalog);
  const cctScaleId = useId();
  const [intensityDraft, setIntensityDraft] = useState(fixture.intensity);
  const [cctDraft, setCctDraft] = useState(fixture.cct);
  const [controlDrafts, setControlDrafts] = useState<Record<string, number>>(fixture.controlValues);
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

  useEffect(() => {
    setControlDrafts(fixture.controlValues);
  }, [fixture.id, fixture.controlValues]);

  // Open the inline rename when the parent signals a one-shot request (marker
  // context-menu "Rename"). Effect runs after mount, so the renameRef is
  // wired before beginEdit fires.
  useEffect(() => {
    if (pendingInlineRenameNonce === null) return;
    renameRef.current?.beginEdit();
  }, [pendingInlineRenameNonce]);

  const handleIntensityChange = (next: number) => {
    setIntensityDraft(Math.max(0, Math.min(100, Math.round(next))));
  };

  const commitIntensity = (next?: number) => {
    const target = next ?? intensityDraft;
    if (target !== fixture.intensity) {
      onIntensityCommit(fixture.id, target);
    }
  };

  const handleCctChange = (next: number) => {
    setCctDraft(Math.max(cctRange.min, Math.min(cctRange.max, Math.round(next))));
  };

  const commitCct = (next?: number) => {
    const target = next ?? cctDraft;
    if (target !== fixture.cct) {
      onCctCommit(fixture.id, target);
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
      <InspectorSection title="Fixture" className={styles.compactSection}>
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
              {fixture.on ? "Live" : "Standby"} · {MOUNTING_LABEL[deriveMounting(fixture, catalog)]}
            </div>
          </div>
          <div className={styles.fixtureHeaderActions}>
            <IdentifyBurstButton
              fixtureId={fixture.id}
              fixtureName={fixture.name}
              onTrigger={onIdentifyBurst}
              bridgeReachable={bridgeReachable}
            />
            <Button
              onClick={() => onTogglePower(fixture.id, !fixture.on)}
              loading={powerBusy}
              variant={fixture.on ? "secondary" : "primary"}
              size="compact"
              leadingVisual={<Power aria-hidden="true" size={13} strokeWidth={1.75} />}
            >
              {fixture.on ? "Turn off" : "Turn on"}
            </Button>
          </div>
        </div>
        <dl className={styles.factGrid}>
          <div className={styles.fact}>
            <dt className={styles.factLabel}>Type</dt>
            <dd className={styles.factValue}>{fixtureDefinitionLabel(definition) || fixture.type}</dd>
          </div>
          <div className={styles.fact}>
            <dt className={styles.factLabel}>Mode</dt>
            <dd className={styles.factValue}>{mode ? `${mode.channelCount} ch` : fixture.modeId}</dd>
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

      {mode && mode.controls.some((control) => !["intensity", "cct"].includes(control.id)) ? (
        <InspectorSection title="Catalog controls" className={styles.compactSection}>
          <div className={styles.levelStack}>
            {mode.controls
              .filter((control) => !["intensity", "cct"].includes(control.id))
              .map((control) => {
                const value = controlDrafts[control.id] ?? control.defaultValue;
                return (
                  <div className={styles.levelBlock} key={control.id}>
                    <div className={styles.levelHeader}>
                      <span className={styles.levelLabel}>{control.label}</span>
                      <span className={styles.levelValue}>
                        {Math.round(value)}
                        {control.unit ?? ""}
                      </span>
                    </div>
                    <ScrubSlider
                      ariaLabel={control.label}
                      min={control.min}
                      max={control.max}
                      step={control.step}
                      value={value}
                      onChange={(next) =>
                        setControlDrafts((current) => ({ ...current, [control.id]: Math.round(next) }))
                      }
                      onCommit={(next) => {
                        const rounded = Math.round(next ?? value);
                        setControlDrafts((current) => ({ ...current, [control.id]: rounded }));
                        onControlValuesCommit?.(fixture.id, { [control.id]: rounded });
                      }}
                      resetValue={control.defaultValue}
                      disabled={!fixture.on && control.id !== "fan"}
                      formatValue={(next) => `${Math.round(next)}${control.unit ?? ""}`}
                    />
                  </div>
                );
              })}
          </div>
        </InspectorSection>
      ) : null}

      <InspectorSection title="Levels" className={styles.compactSection}>
        <div className={styles.levelStack}>
          <div className={styles.levelBlock}>
            <div className={styles.levelHeader}>
              <span className={styles.levelLabel}>Intensity</span>
              <span className={styles.levelValue}>{Math.round(intensityDraft)}%</span>
            </div>
            <ScrubSlider
              ariaLabel="Fixture intensity"
              min={0}
              max={100}
              step={1}
              value={intensityDraft}
              onChange={handleIntensityChange}
              onCommit={commitIntensity}
              resetValue={100}
              // Only gate on power state — IPC commits are sub-millisecond and
              // idempotent, so a busy-flag disable would just flicker the slider
              // chrome on every release without preventing anything real.
              disabled={!fixture.on}
              formatValue={(v) => `${Math.round(v)}%`}
            />
          </div>
          <div className={styles.levelBlock}>
            <div className={styles.levelHeader}>
              <span className={styles.levelLabel}>Colour temperature</span>
              <span className={styles.levelValue}>{Math.round(cctDraft)}K</span>
            </div>
            <ScrubSlider
              ariaLabel="Fixture CCT"
              min={cctRange.min}
              max={cctRange.max}
              step={100}
              value={cctDraft}
              onChange={handleCctChange}
              onCommit={commitCct}
              resetValue={Math.round((cctRange.min + cctRange.max) / 2 / 100) * 100}
              formatValue={(v) => `${Math.round(v)}K`}
            />
            <div id={cctScaleId} className={styles.cctScale}>
              <span>{cctRange.min}K · warm</span>
              <span>{cctRange.max}K · cool</span>
            </div>
          </div>
        </div>
      </InspectorSection>

      {onSpatialCommit ? (
        <InspectorSection title="Position" className={styles.compactSection}>
          <div className={styles.positionGrid}>
            <label className={styles.positionField}>
              <ScrubLabel
                value={parseDraft(spatialXDraft, fixture.spatialX ?? 0)}
                onChange={(next) => setSpatialXDraft(formatScrubMeters(next))}
                onCommit={(next) => commitSpatial("spatialX", formatScrubMeters(next))}
                min={0}
                max={STUDIO_LAYOUT.roomWidthMeters}
                pixelsPerStep={0.05}
                step={0.1}
                className={styles.positionLabel}
              >
                Stage X (m)
              </ScrubLabel>
              <input
                aria-label="Stage X position in metres"
                className={styles.positionInput}
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
              <ScrubLabel
                value={parseDraft(spatialYDraft, fixture.spatialY ?? 0)}
                onChange={(next) => setSpatialYDraft(formatScrubMeters(next))}
                onCommit={(next) => commitSpatial("spatialY", formatScrubMeters(next))}
                min={0}
                max={STUDIO_LAYOUT.roomDepthMeters}
                pixelsPerStep={0.05}
                step={0.1}
                className={styles.positionLabel}
              >
                Stage Y (m)
              </ScrubLabel>
              <input
                aria-label="Stage Y position in metres"
                className={styles.positionInput}
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
              <ScrubLabel
                value={parseDraft(rigZDraft, fixture.rigZ ?? 0)}
                onChange={(next) => setRigZDraft(formatScrubMeters(next))}
                onCommit={(next) => commitSpatial("rigZ", formatScrubMeters(next))}
                min={0}
                max={RIG_HEIGHT_MAX_METERS}
                pixelsPerStep={0.05}
                step={0.1}
                className={styles.positionLabel}
              >
                Rig height (m)
              </ScrubLabel>
              <input
                aria-label="Rig height in metres"
                className={styles.positionInput}
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
              <ScrubLabel
                value={parseDraft(beamAngleDraft, fixture.beamAngleDegrees ?? defaultLightingBeamAngle(fixture.type))}
                onChange={(next) => setBeamAngleDraft(formatScrubDegrees(next))}
                onCommit={(next) => commitSpatial("beamAngleDegrees", formatScrubDegrees(next))}
                min={BEAM_ANGLE_MIN_DEGREES}
                max={BEAM_ANGLE_MAX_DEGREES}
                pixelsPerStep={0.5}
                step={1}
                className={styles.positionLabel}
              >
                Beam angle (°)
              </ScrubLabel>
              <input
                aria-label="Beam angle in degrees"
                className={styles.positionInput}
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
        </InspectorSection>
      ) : null}

      {onDeleteFixture ? (
        <InspectorSection title="Danger zone" className={styles.compactSection}>
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
