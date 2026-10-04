import { useEffect, useRef, useState } from "react";

import {
  ControlRow,
  InlineRename,
  Key,
  MenuButton,
  NumberEntryDialog,
  PlateHead,
  Popover,
  Readouts,
  Section,
  Slider,
  Tooltip,
  type InlineRenameHandle,
  type MenuContent,
  type SliderMark,
} from "@sse/design-system";
import type {
  LightingFixtureCatalogSnapshot,
  LightingFixtureSnapshot,
  LightingSceneSnapshot,
} from "@sse/engine-client";

import { deriveMounting, type FixtureMounting } from "../fixtureMounting";
import { getFixtureDefinition, getFixtureMode, fixtureDefinitionLabel } from "../fixtureCatalog";
import { defaultLightingBeamAngle, lightingFixtureCctRange } from "../lightingHelpers";
import type { LightingMenu } from "../lightingMenus";
import { STUDIO_LAYOUT } from "../studioLayout";

import { IdentifyBurstButton } from "./IdentifyBurstButton";
import styles from "./LightingInspector.module.css";

// The visual overhaul's Lighting page (2026-10-04): one fixture on the plate.
// The Dark Green title plate (its name, what it is, its ⋯: the same menu as a
// right-click on it on the plot, with Delete fixture… last, arming in place);
// Turn off and Identify; where it is patched; its levels, each with a ▲ under
// the slider where the scene on the rig keeps it (Yellow while the rig has
// left the scene); where it hangs, in one row, the fields behind Edit. Every
// section shows at once and the plate never scrolls.

const RIG_HEIGHT_MAX_METERS = 8;
const BEAM_ANGLE_MIN_DEGREES = 1;
const BEAM_ANGLE_MAX_DEGREES = 180;
type FixtureValuePreviewPhase = "editing" | "committing";
type SpatialField = "spatialX" | "spatialY" | "rigZ" | "spatialRotation" | "beamAngleDegrees";
interface SpatialPartial {
  spatialX?: number | null;
  spatialY?: number | null;
  rigZ?: number | null;
  beamAngleDegrees?: number | null;
  spatialRotation?: number;
}

/** One field's change, as the hardware link takes it: an empty field clears
 *  the value, and the rotation goes back to 0°. */
function spatialChange(field: SpatialField, value: number | null): SpatialPartial {
  if (field === "spatialRotation") return { spatialRotation: value ?? 0 };
  return { [field]: value } as SpatialPartial;
}

export interface InspectorFixtureProps {
  fixture: LightingFixtureSnapshot;
  catalog?: LightingFixtureCatalogSnapshot | null;
  groupName?: string;
  bridgeReachable?: boolean;
  /** The scene the rig holds (or the preview's), for the saved ticks. */
  scene: LightingSceneSnapshot | null;
  /** The hardware link says the rig has left that scene: a tick that differs is Yellow. */
  drifting: boolean;
  /** `U1 · 001–002`, and a word when it overlaps another fixture. */
  patchRange: string;
  overlapNote?: string | null;
  menu: LightingMenu;
  arm: MenuContent["arm"];
  onTogglePower: (fixtureId: string, on: boolean) => void;
  onIntensityCommit: (fixtureId: string, intensity: number) => void;
  onIntensityPreview?: (fixtureId: string, intensity: number, phase: FixtureValuePreviewPhase) => void;
  onCctCommit: (fixtureId: string, cct: number) => void;
  onCctPreview?: (fixtureId: string, cct: number, phase: FixtureValuePreviewPhase) => void;
  onControlValuesCommit?: (fixtureId: string, controlValues: Record<string, number>) => void;
  onIdentifyBurst: (fixtureId: string, fixtureName: string) => void;
  /** Absent in preview: a fixture's place is not staged. */
  onSpatialCommit?: (fixtureId: string, partial: SpatialPartial) => void;
  onRenameFixture?: (fixtureId: string, newName: string) => void | Promise<void>;
  powerBusy?: boolean;
  renameBusy?: boolean;
  /** When this nonce changes the title's inline rename opens (the menu's Rename…). */
  pendingInlineRenameNonce?: number | null;
  /** When this nonce changes the placement fields open (the menu's Edit placement…). */
  placementRequestNonce?: number | null;
}

const MOUNTING_LABEL: Record<FixtureMounting, string> = {
  bar: "bar",
  "control-node": "control node",
  fresnel: "fresnel",
  mat: "mat",
  panel: "panel",
};

function metres(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `${(Math.round(value * 100) / 100).toString()} m`;
}

function draftOf(value: number | null | undefined) {
  if (value === null || value === undefined) return "";
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}

function normalizeDegrees(value: number): number {
  return ((Math.round(value) % 360) + 360) % 360;
}

export function InspectorFixture({
  fixture,
  catalog = null,
  groupName,
  bridgeReachable = true,
  scene,
  drifting,
  patchRange,
  overlapNote = null,
  menu,
  arm,
  onTogglePower,
  onIntensityCommit,
  onIntensityPreview,
  onCctCommit,
  onCctPreview,
  onControlValuesCommit,
  onIdentifyBurst,
  onSpatialCommit,
  onRenameFixture,
  powerBusy = false,
  renameBusy = false,
  pendingInlineRenameNonce = null,
  placementRequestNonce = null,
}: InspectorFixtureProps) {
  const definition = getFixtureDefinition(catalog, fixture);
  const mode = getFixtureMode(definition, fixture.modeId);
  const cctRange = lightingFixtureCctRange(fixture, catalog);
  const cctSpan = Math.max(1, cctRange.max - cctRange.min);
  const hasCct = mode ? mode.channels.some((channel) => channel.controlId === "cct") : true;
  const cctDefault = Math.round((cctRange.min + cctRange.max) / 2 / 100) * 100;
  const [intensityDraft, setIntensityDraft] = useState(fixture.intensity);
  const [cctDraft, setCctDraft] = useState(fixture.cct);
  const [controlDrafts, setControlDrafts] = useState<Record<string, number>>(fixture.controlValues);
  const [numberDialog, setNumberDialog] = useState<
    null | { kind: "intensity" } | { kind: "cct" } | { kind: "control"; controlId: string }
  >(null);
  const renameRef = useRef<InlineRenameHandle | null>(null);
  const placementRef = useRef<HTMLDivElement | null>(null);
  const [placementOpen, setPlacementOpen] = useState(false);

  useEffect(() => setIntensityDraft(fixture.intensity), [fixture.id, fixture.intensity]);
  useEffect(() => setCctDraft(fixture.cct), [fixture.id, fixture.cct]);
  useEffect(() => setControlDrafts(fixture.controlValues), [fixture.id, fixture.controlValues]);
  useEffect(() => setPlacementOpen(false), [fixture.id]);
  useEffect(() => {
    if (pendingInlineRenameNonce === null) return;
    renameRef.current?.beginEdit();
  }, [pendingInlineRenameNonce]);
  useEffect(() => {
    if (placementRequestNonce === null || !onSpatialCommit) return;
    setPlacementOpen(true);
  }, [onSpatialCommit, placementRequestNonce]);

  const handleIntensityChange = (next: number) => {
    const target = Math.max(0, Math.min(100, Math.round(next)));
    setIntensityDraft(target);
    onIntensityPreview?.(fixture.id, target, "editing");
  };
  const commitIntensity = (next?: number) => {
    const target = Math.max(0, Math.min(100, Math.round(next ?? intensityDraft)));
    onIntensityPreview?.(fixture.id, target, "committing");
    if (target !== fixture.intensity) onIntensityCommit(fixture.id, target);
  };
  const handleCctChange = (next: number) => {
    const target = Math.max(cctRange.min, Math.min(cctRange.max, Math.round(next / 100) * 100));
    setCctDraft(target);
    onCctPreview?.(fixture.id, target, "editing");
  };
  const commitCct = (next?: number) => {
    const target = Math.max(cctRange.min, Math.min(cctRange.max, Math.round(next ?? cctDraft)));
    onCctPreview?.(fixture.id, target, "committing");
    if (target !== fixture.cct) onCctCommit(fixture.id, target);
  };

  // The scene's saved state of this fixture, for the ticks.
  const saved = scene?.fixtureStates.find((state) => state.fixtureId === fixture.id) ?? null;
  const intensityMark: SliderMark[] =
    saved && saved.on
      ? [
          {
            at: saved.intensity / 100,
            tone: drifting && Math.abs(saved.intensity - fixture.intensity) > 0.5 ? "attention" : undefined,
            testId: "lighting-saved-intensity",
          },
        ]
      : [];
  const cctMark: SliderMark[] =
    saved && saved.on && hasCct
      ? [
          {
            at: (saved.cct - cctRange.min) / cctSpan,
            tone: drifting && Math.abs(saved.cct - fixture.cct) > 25 ? "attention" : undefined,
            testId: "lighting-saved-cct",
          },
        ]
      : [];
  const levelsDetail = scene
    ? saved
      ? saved.on
        ? `▲ saved in ${scene.name}`
        : `off in ${scene.name}`
      : `not in ${scene.name}`
    : "no scene on the rig";

  const otherControls = mode?.controls.filter((control) => !["intensity", "cct"].includes(control.id)) ?? [];
  const numberDialogControl =
    numberDialog?.kind === "control"
      ? (otherControls.find((entry) => entry.id === numberDialog.controlId) ?? null)
      : null;

  return (
    <>
      <PlateHead
        title={
          onRenameFixture ? (
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
          )
        }
        sub={`${fixtureDefinitionLabel(definition) || fixture.type} · ${MOUNTING_LABEL[deriveMounting(fixture, catalog)]} · ${
          mode ? `${mode.channelCount} ch` : "not in the catalog"
        }`}
        action={
          <MenuButton buttonLabel={`${fixture.name} menu`} buttonTestId="lighting-plate-menu" menu={{ ...menu, arm }} />
        }
        testId="lighting-plate-head"
      />

      <div className={styles.keyRow}>
        <Key
          mode="toggle"
          size="large"
          live={fixture.on}
          aria-pressed={fixture.on}
          disabled={powerBusy}
          onClick={() => onTogglePower(fixture.id, !fixture.on)}
        >
          {fixture.on ? "Turn off" : "Turn on"}
        </Key>
        <IdentifyBurstButton
          fixtureId={fixture.id}
          fixtureName={fixture.name}
          onTrigger={onIdentifyBurst}
          bridgeReachable={bridgeReachable}
          size="large"
        />
      </div>

      <Readouts
        data-testid="lighting-plate-patch-facts"
        rows={[
          {
            id: "universe",
            label: "Universe",
            value: `U${fixture.universe}`,
          },
          {
            id: "dmx",
            label: "DMX start",
            value: patchRange,
            tone: overlapNote ? "attention" : undefined,
          },
          ...(overlapNote ? [{ id: "overlap", label: "Overlap", value: overlapNote, tone: "attention" as const }] : []),
          { id: "group", label: "Group", value: groupName ?? "none" },
        ]}
      />

      <Section title="Levels" detail={levelsDetail} data-plate-section="levels" testId="lighting-plate-scene-values">
        <ControlRow label="Intensity" value={Math.round(intensityDraft)} unit="%">
          <Slider
            label="Fixture intensity"
            value={intensityDraft / 100}
            valueText={`${Math.round(intensityDraft)} %${saved?.on ? `, saved ${Math.round(saved.intensity)} %` : ""}`}
            ariaValue={{ min: 0, max: 100, now: Math.round(intensityDraft) }}
            locked={!fixture.on}
            marks={intensityMark}
            onChange={(value) => handleIntensityChange(value * 100)}
            onCommit={(value) => commitIntensity(value * 100)}
            onRequestTypedEntry={() => setNumberDialog({ kind: "intensity" })}
          />
        </ControlRow>
        {hasCct ? (
          <ControlRow label="Colour temperature" value={Math.round(cctDraft)} unit="K">
            <Slider
              label="Fixture CCT"
              cct
              value={(cctDraft - cctRange.min) / cctSpan}
              step={100 / cctSpan}
              valueText={`${Math.round(cctDraft)} K${saved?.on ? `, saved ${Math.round(saved.cct)} K` : ""}`}
              ariaValue={{ min: cctRange.min, max: cctRange.max, now: Math.round(cctDraft) }}
              marks={cctMark}
              onChange={(value) => handleCctChange(cctRange.min + value * cctSpan)}
              onCommit={(value) => commitCct(Math.round((cctRange.min + value * cctSpan) / 100) * 100)}
              onRequestTypedEntry={() => setNumberDialog({ kind: "cct" })}
            />
          </ControlRow>
        ) : null}
        {otherControls.map((control) => {
          const value = controlDrafts[control.id] ?? control.defaultValue;
          const span = Math.max(1, control.max - control.min);
          const savedValue = saved?.controlValues?.[control.id];
          return (
            <ControlRow
              key={control.id}
              label={control.label}
              value={Math.round(value)}
              unit={control.unit ?? undefined}
            >
              <Slider
                label={control.label}
                value={(value - control.min) / span}
                step={control.step / span}
                valueText={`${Math.round(value)}${control.unit ? ` ${control.unit}` : ""}`}
                ariaValue={{ min: control.min, max: control.max, now: Math.round(value) }}
                locked={!fixture.on && control.id !== "fan"}
                marks={
                  typeof savedValue === "number"
                    ? [
                        {
                          at: (savedValue - control.min) / span,
                          tone: drifting && Math.abs(savedValue - value) > 0.5 ? "attention" : undefined,
                        },
                      ]
                    : []
                }
                onChange={(next) =>
                  setControlDrafts((current) => ({ ...current, [control.id]: Math.round(control.min + next * span) }))
                }
                onCommit={(next) => {
                  const rounded = Math.round(control.min + next * span);
                  setControlDrafts((current) => ({ ...current, [control.id]: rounded }));
                  onControlValuesCommit?.(fixture.id, { [control.id]: rounded });
                }}
                onRequestTypedEntry={() => setNumberDialog({ kind: "control", controlId: control.id })}
              />
            </ControlRow>
          );
        })}
      </Section>

      <div ref={placementRef}>
        <Section
          title={
            <Tooltip content="Where it hangs, for the plot. The rig takes none of it.">
              <span>Placement</span>
            </Tooltip>
          }
          data-plate-section="placement"
          testId="lighting-plate-placement"
          actions={
            onSpatialCommit ? (
              <Key
                size="small"
                aria-haspopup="true"
                aria-expanded={placementOpen}
                testId="lighting-placement-edit"
                onClick={() => setPlacementOpen((open) => !open)}
              >
                Edit…
              </Key>
            ) : null
          }
        >
          <dl className={styles.placementRow}>
            <div>
              <dt>Stage X</dt>
              <dd>{metres(fixture.spatialX)}</dd>
            </div>
            <div>
              <dt>Stage Y</dt>
              <dd>{metres(fixture.spatialY)}</dd>
            </div>
            <div>
              <dt>Height</dt>
              <dd>{metres(fixture.rigZ)}</dd>
            </div>
            <div>
              <dt>Rotation</dt>
              <dd>{normalizeDegrees(fixture.spatialRotation)}°</dd>
            </div>
            <div>
              <dt>Beam</dt>
              <dd>{Math.round(fixture.beamAngleDegrees ?? defaultLightingBeamAngle(fixture.type))}°</dd>
            </div>
          </dl>
        </Section>
      </div>

      {onSpatialCommit ? (
        <Popover
          open={placementOpen}
          anchor={placementRef.current}
          onClose={() => setPlacementOpen(false)}
          title={`Placement of ${fixture.name}`}
          placement="left-start"
          width={407}
          ignoreOutside={[placementRef]}
          initialFocus="first"
          testId="lighting-placement-popover"
        >
          <PlacementFields fixture={fixture} onSpatialCommit={onSpatialCommit} />
        </Popover>
      ) : null}

      {numberDialog?.kind === "intensity" ? (
        <NumberEntryDialog
          title="Set fixture intensity"
          fieldLabel="Intensity"
          initialValue={Math.round(intensityDraft)}
          min={0}
          max={100}
          step={1}
          suffix="%"
          resetValue={100}
          onConfirm={(value) => {
            handleIntensityChange(value);
            commitIntensity(value);
            setNumberDialog(null);
          }}
          onCancel={() => setNumberDialog(null)}
        />
      ) : null}
      {numberDialog?.kind === "cct" ? (
        <NumberEntryDialog
          title="Set fixture CCT"
          fieldLabel="Colour temperature"
          initialValue={Math.round(cctDraft)}
          min={cctRange.min}
          max={cctRange.max}
          step={100}
          suffix="K"
          resetValue={cctDefault}
          onConfirm={(value) => {
            handleCctChange(value);
            commitCct(value);
            setNumberDialog(null);
          }}
          onCancel={() => setNumberDialog(null)}
        />
      ) : null}
      {numberDialogControl ? (
        <NumberEntryDialog
          title={`Set ${numberDialogControl.label}`}
          fieldLabel={numberDialogControl.label}
          initialValue={Math.round(controlDrafts[numberDialogControl.id] ?? numberDialogControl.defaultValue)}
          min={numberDialogControl.min}
          max={numberDialogControl.max}
          step={numberDialogControl.step}
          suffix={numberDialogControl.unit ?? undefined}
          resetValue={numberDialogControl.defaultValue}
          onConfirm={(value) => {
            const rounded = Math.round(value);
            setControlDrafts((draft) => ({ ...draft, [numberDialogControl.id]: rounded }));
            onControlValuesCommit?.(fixture.id, { [numberDialogControl.id]: rounded });
            setNumberDialog(null);
          }}
          onCancel={() => setNumberDialog(null)}
        />
      ) : null}
    </>
  );
}

interface PlacementFieldsProps {
  fixture: LightingFixtureSnapshot;
  onSpatialCommit: (fixtureId: string, partial: SpatialPartial) => void;
}

/** The placement's fields: each commits on Enter or when it loses the focus;
 *  an empty field clears the value (rotation goes back to 0°). */
function PlacementFields({ fixture, onSpatialCommit }: PlacementFieldsProps) {
  const [drafts, setDrafts] = useState<Record<SpatialField, string>>(() => ({
    spatialX: draftOf(fixture.spatialX),
    spatialY: draftOf(fixture.spatialY),
    rigZ: draftOf(fixture.rigZ),
    spatialRotation: String(normalizeDegrees(fixture.spatialRotation)),
    beamAngleDegrees: fixture.beamAngleDegrees === null ? "" : String(fixture.beamAngleDegrees),
  }));
  useEffect(() => {
    setDrafts({
      spatialX: draftOf(fixture.spatialX),
      spatialY: draftOf(fixture.spatialY),
      rigZ: draftOf(fixture.rigZ),
      spatialRotation: String(normalizeDegrees(fixture.spatialRotation)),
      beamAngleDegrees: fixture.beamAngleDegrees === null ? "" : String(fixture.beamAngleDegrees),
    });
  }, [fixture.id, fixture.spatialX, fixture.spatialY, fixture.rigZ, fixture.spatialRotation, fixture.beamAngleDegrees]);

  const clamp = (field: SpatialField, raw: number) => {
    switch (field) {
      case "spatialX":
        return Math.max(0, Math.min(STUDIO_LAYOUT.roomWidthMeters, raw));
      case "spatialY":
        return Math.max(0, Math.min(STUDIO_LAYOUT.roomDepthMeters, raw));
      case "rigZ":
        return Math.max(0, Math.min(RIG_HEIGHT_MAX_METERS, raw));
      case "spatialRotation":
        return normalizeDegrees(raw);
      case "beamAngleDegrees":
        return Math.max(BEAM_ANGLE_MIN_DEGREES, Math.min(BEAM_ANGLE_MAX_DEGREES, raw));
    }
  };
  const commit = (field: SpatialField) => {
    const trimmed = drafts[field].trim();
    if (trimmed === "") {
      onSpatialCommit(fixture.id, spatialChange(field, null));
      return;
    }
    const parsed = Number.parseFloat(trimmed);
    if (!Number.isFinite(parsed)) return;
    const clamped = clamp(field, parsed);
    if (clamped === (fixture[field] ?? null)) return;
    onSpatialCommit(fixture.id, spatialChange(field, clamped));
  };

  const fields: ReadonlyArray<{ field: SpatialField; label: string; aria: string; unit: string }> = [
    { field: "spatialX", label: "Stage X", aria: "Stage X position in metres", unit: "m" },
    { field: "spatialY", label: "Stage Y", aria: "Stage Y position in metres", unit: "m" },
    { field: "rigZ", label: "Rig height", aria: "Rig height in metres", unit: "m" },
    { field: "spatialRotation", label: "Rotation", aria: "Fixture rotation in degrees", unit: "°" },
    { field: "beamAngleDegrees", label: "Beam angle", aria: "Beam angle in degrees", unit: "°" },
  ];

  return (
    <div className={styles.placementFields}>
      {fields.map(({ field, label, aria, unit }) => (
        <label key={field} className={styles.field}>
          <span className={styles.fieldLabel}>
            {label} ({unit})
          </span>
          <input
            aria-label={aria}
            className={styles.fieldInput}
            inputMode="decimal"
            type="text"
            value={drafts[field]}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setDrafts((current) => ({ ...current, [field]: value }));
            }}
            onBlur={() => commit(field)}
            onKeyDown={(event) => {
              // Enter commits and keeps the focus in the fields, so Esc still
              // closes them.
              if (event.key === "Enter") commit(field);
            }}
          />
        </label>
      ))}
      <Key
        size="small"
        className={styles.fieldsKey}
        disabled={normalizeDegrees(fixture.spatialRotation) === 0}
        onClick={() => onSpatialCommit(fixture.id, { spatialRotation: 0 })}
      >
        Reset rotation
      </Key>
    </div>
  );
}
