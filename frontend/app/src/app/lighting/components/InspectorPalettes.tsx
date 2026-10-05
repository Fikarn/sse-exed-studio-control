import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { ColorPicker, Key, MenuButton, Popover, type MenuContent } from "@sse/design-system";
import type { LightingPaletteKind, LightingPaletteSnapshot } from "@sse/engine-client";

import { LIGHTING_COLOR_TAG_PALETTE, lightingColorTagHex } from "../lightingColorTags";
import { lightingFixtureColor } from "../lightingHelpers";
import { buildPaletteMenu } from "../lightingMenus";

import styles from "./LightingInspector.module.css";

// The visual overhaul's Lighting page (2026-10-04): the palettes as tiles, four
// to a row. A press on a tile applies it to the selection; its ⋯ (and a
// right-click on it) holds Edit…, Move earlier, Move later, Colour… (an
// intensity palette's alone) and Delete palette…, which arms in place (until
// then the browser's own confirm asked). A new palette and an edit open the
// same small form beside the pool.

interface PaletteDraft {
  id: string | null;
  kind: LightingPaletteKind;
  name: string;
  value: string;
}

export interface InspectorPalettesProps {
  palettes: readonly LightingPaletteSnapshot[];
  selectedFixtureIds: readonly string[];
  patchMode: boolean;
  /** Kept for the host; the section's head says it (`paletteStatus`). */
  previewMode?: boolean;
  busyActions: ReadonlySet<string>;
  arm: MenuContent["arm"];
  onApplyPalette: (paletteId: string) => void;
  onCreatePalette: (request: {
    name: string;
    kind: LightingPaletteKind;
    value: number;
    colorIndex: number | null;
  }) => void;
  onUpdatePalette: (request: {
    paletteId: string;
    name?: string;
    value?: number;
    colorIndex?: number | null;
    beforePaletteId?: string | null;
  }) => void;
  onDeletePalette: (paletteId: string) => void;
}

const KIND_LABEL: Record<LightingPaletteKind, string> = {
  intensity: "Intensity",
  cct: "CCT",
};

const KIND_UNIT: Record<LightingPaletteKind, string> = {
  intensity: "%",
  cct: "K",
};

function defaultDraft(kind: LightingPaletteKind): PaletteDraft {
  return {
    id: null,
    kind,
    name: kind === "intensity" ? "New level" : "New white",
    value: kind === "intensity" ? "50" : "4300",
  };
}

/** The words for the section's head: how many fixtures it applies to, and how. */
export function paletteStatus(selectedCount: number, patchMode: boolean, previewMode: boolean) {
  return `${selectedCount} selected · ${patchMode ? "patch locked" : previewMode ? "preview" : "live"}`;
}

export function InspectorPalettes({
  palettes,
  selectedFixtureIds,
  patchMode,
  busyActions,
  arm,
  onApplyPalette,
  onCreatePalette,
  onUpdatePalette,
  onDeletePalette,
}: InspectorPalettesProps) {
  const [draft, setDraft] = useState<PaletteDraft | null>(null);
  const intensityPalettes = useMemo(() => palettes.filter((palette) => palette.kind === "intensity"), [palettes]);
  const cctPalettes = useMemo(() => palettes.filter((palette) => palette.kind === "cct"), [palettes]);
  const selectedCount = selectedFixtureIds.length;
  const editReason = patchMode ? "leave Patch first" : null;
  const applyReason = patchMode
    ? "Leave Patch to apply palettes."
    : selectedCount === 0
      ? "Select fixtures to apply a palette."
      : undefined;

  useEffect(() => {
    if (patchMode) setDraft(null);
  }, [patchMode]);

  const saveDraft = () => {
    if (!draft) return;
    const name = draft.name.trim();
    const value = Number(draft.value);
    if (!name || !Number.isFinite(value)) return;
    if (draft.id) onUpdatePalette({ paletteId: draft.id, name, value });
    else onCreatePalette({ name, kind: draft.kind, value, colorIndex: null });
    setDraft(null);
  };

  const move = (pool: readonly LightingPaletteSnapshot[], index: number, direction: -1 | 1) => {
    const palette = pool[index];
    if (!palette) return;
    if (direction === -1) {
      const before = pool[index - 1];
      if (before) onUpdatePalette({ paletteId: palette.id, beforePaletteId: before.id });
      return;
    }
    if (!pool[index + 1]) return;
    onUpdatePalette({ paletteId: palette.id, beforePaletteId: pool[index + 2]?.id ?? null });
  };

  const pool = (kind: LightingPaletteKind, entries: readonly LightingPaletteSnapshot[]) => (
    <PalettePool
      key={kind}
      kind={kind}
      entries={entries}
      draft={draft?.kind === kind ? draft : null}
      setDraft={setDraft}
      saveDraft={saveDraft}
      applyReason={applyReason}
      editReason={editReason}
      busyActions={busyActions}
      arm={arm}
      onApply={onApplyPalette}
      onMove={(index, direction) => move(entries, index, direction)}
      onSetColour={(paletteId, colorIndex) => onUpdatePalette({ paletteId, colorIndex })}
      onDelete={onDeletePalette}
    />
  );

  return (
    <div className={styles.palettePane}>
      {pool("intensity", intensityPalettes)}
      {pool("cct", cctPalettes)}
    </div>
  );
}

interface PalettePoolProps {
  kind: LightingPaletteKind;
  entries: readonly LightingPaletteSnapshot[];
  draft: PaletteDraft | null;
  setDraft: (draft: PaletteDraft | null) => void;
  saveDraft: () => void;
  applyReason: string | undefined;
  editReason: string | null;
  busyActions: ReadonlySet<string>;
  arm: MenuContent["arm"];
  onApply: (paletteId: string) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onSetColour: (paletteId: string, colorIndex: number | null) => void;
  onDelete: (paletteId: string) => void;
}

function PalettePool({
  kind,
  entries,
  draft,
  setDraft,
  saveDraft,
  applyReason,
  editReason,
  busyActions,
  arm,
  onApply,
  onMove,
  onSetColour,
  onDelete,
}: PalettePoolProps) {
  const poolRef = useRef<HTMLElement | null>(null);
  const [colourFor, setColourFor] = useState<{ id: string; x: number; y: number } | null>(null);
  const colourPalette = colourFor ? (entries.find((entry) => entry.id === colourFor.id) ?? null) : null;

  return (
    <section ref={poolRef} className={styles.palettePool} aria-label={`${KIND_LABEL[kind]} palettes`}>
      <div className={styles.palettePoolHeader}>
        <h3>{KIND_LABEL[kind]}</h3>
        <Key
          size="small"
          aria-label={`Create ${KIND_LABEL[kind]} palette`}
          disabled={Boolean(editReason)}
          title={editReason ? "Leave Patch to make a palette." : undefined}
          onClick={() => setDraft(defaultDraft(kind))}
        >
          ＋
        </Key>
      </div>
      <div className={styles.paletteGrid}>
        {entries.map((palette, index) => (
          <PaletteTile
            key={palette.id}
            palette={palette}
            first={index === 0}
            last={index === entries.length - 1}
            applyReason={applyReason}
            editReason={editReason}
            busy={busyActions.has(`palette-apply:${palette.id}`)}
            arm={arm}
            onApply={() => onApply(palette.id)}
            onEdit={() =>
              setDraft({ id: palette.id, kind, name: palette.name, value: String(Math.round(palette.value)) })
            }
            onMoveEarlier={() => onMove(index, -1)}
            onMoveLater={() => onMove(index, 1)}
            onColour={(at) => setColourFor({ id: palette.id, ...at })}
            onDelete={() => onDelete(palette.id)}
          />
        ))}
      </div>
      <Popover
        open={draft !== null}
        anchor={poolRef.current}
        onClose={() => setDraft(null)}
        title={
          draft?.id
            ? `Edit ${entries.find((entry) => entry.id === draft.id)?.name ?? "palette"}`
            : `New ${KIND_LABEL[kind].toLowerCase()} palette`
        }
        placement="left-start"
        width={407}
        ignoreOutside={[poolRef]}
        initialFocus="first"
        testId={`lighting-palette-form-${kind}`}
      >
        {draft ? (
          <form
            className={styles.paletteForm}
            onSubmit={(event) => {
              event.preventDefault();
              saveDraft();
            }}
          >
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Name</span>
              <input
                className={styles.fieldInput}
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
                maxLength={50}
                aria-label="Palette name"
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Value ({KIND_UNIT[kind]})</span>
              <input
                className={styles.fieldInput}
                value={draft.value}
                onChange={(event) => setDraft({ ...draft, value: event.currentTarget.value })}
                inputMode="numeric"
                aria-label="Palette value"
              />
            </label>
            <div className={styles.formKeys}>
              <Key size="small" onClick={() => setDraft(null)}>
                Cancel
              </Key>
              <Key size="small" mode="primary" type="submit">
                Save
              </Key>
            </div>
          </form>
        ) : null}
      </Popover>
      {colourFor && colourPalette ? (
        <ColorPicker
          x={colourFor.x}
          y={colourFor.y}
          swatches={LIGHTING_COLOR_TAG_PALETTE}
          selectedIndex={colourPalette.colorIndex ?? null}
          onSelect={(next) => onSetColour(colourPalette.id, next)}
          onClose={() => setColourFor(null)}
          ariaLabel={`Pick a colour for palette ${colourPalette.name}`}
        />
      ) : null}
    </section>
  );
}

interface PaletteTileProps {
  palette: LightingPaletteSnapshot;
  first: boolean;
  last: boolean;
  applyReason: string | undefined;
  editReason: string | null;
  busy: boolean;
  arm: MenuContent["arm"];
  onApply: () => void;
  onEdit: () => void;
  onMoveEarlier: () => void;
  onMoveLater: () => void;
  onColour: (at: { x: number; y: number }) => void;
  onDelete: () => void;
}

function PaletteTile({
  palette,
  first,
  last,
  applyReason,
  editReason,
  busy,
  arm,
  onApply,
  onEdit,
  onMoveEarlier,
  onMoveLater,
  onColour,
  onDelete,
}: PaletteTileProps) {
  const tileRef = useRef<HTMLDivElement | null>(null);
  // The visual overhaul's polish (2026-10-05): a colour-temperature palette
  // shows no tag; its temperature's dot already gives it a colour, and its
  // menu offers no Colour… (a stored tag stays, unseen).
  const tag = palette.kind === "cct" ? null : lightingColorTagHex(palette.colorIndex);
  const value = `${Math.round(palette.value)} ${KIND_UNIT[palette.kind]}`;
  const menu = buildPaletteMenu({
    palette,
    detail: value,
    first,
    last,
    lockedReason: editReason,
    onEdit,
    onMoveEarlier,
    onMoveLater,
    onColour: () => {
      const box = tileRef.current?.getBoundingClientRect();
      onColour({ x: box?.left ?? 0, y: box?.bottom ?? 0 });
    },
    onDelete,
    testIdPrefix: `lighting-palette-menu-${palette.id}`,
  });
  return (
    <div ref={tileRef} className={styles.paletteTile} data-palette-id={palette.id}>
      <Key
        className={styles.paletteApply}
        aria-label={`Apply ${palette.name}`}
        locked={Boolean(applyReason)}
        reason={applyReason}
        disabled={busy}
        onClick={onApply}
        style={tag ? ({ "--palette-colour": tag } as CSSProperties) : undefined}
        data-tagged={tag ? "" : undefined}
      >
        <span className={styles.paletteName}>{palette.name}</span>
        <span className={styles.paletteValue}>
          {palette.kind === "cct" ? (
            <span
              aria-hidden="true"
              className={styles.paletteCct}
              style={{ background: lightingFixtureColor(palette.value, true) }}
            />
          ) : null}
          {value}
        </span>
      </Key>
      <span className={styles.paletteMenu}>
        <MenuButton
          buttonLabel={`${palette.name} palette menu`}
          buttonTestId={`lighting-palette-menu-${palette.id}`}
          contextTarget={tileRef}
          size="sm"
          menu={{ ...menu, arm }}
        />
      </span>
    </div>
  );
}
