import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Play, Plus, Save, Trash2, X } from "lucide-react";

import { Button, IconButton } from "@sse/design-system";
import type { LightingPaletteKind, LightingPaletteSnapshot } from "@sse/engine-client";

import { LIGHTING_COLOR_TAG_PALETTE, lightingColorTagHex } from "../lightingColorTags";

import styles from "./LightingInspector.module.css";

interface PaletteDraft {
  id: string | null;
  kind: LightingPaletteKind;
  name: string;
  value: string;
  colorIndex: number | null;
}

export interface InspectorPalettesProps {
  palettes: readonly LightingPaletteSnapshot[];
  selectedFixtureIds: readonly string[];
  patchMode: boolean;
  previewMode: boolean;
  busyActions: ReadonlySet<string>;
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

function formatPaletteValue(palette: LightingPaletteSnapshot) {
  return `${Math.round(palette.value)}${KIND_UNIT[palette.kind]}`;
}

function defaultDraft(kind: LightingPaletteKind): PaletteDraft {
  return {
    id: null,
    kind,
    name: kind === "intensity" ? "New level" : "New white",
    value: kind === "intensity" ? "50" : "4300",
    colorIndex: null,
  };
}

function draftFromPalette(palette: LightingPaletteSnapshot): PaletteDraft {
  return {
    id: palette.id,
    kind: palette.kind,
    name: palette.name,
    value: String(Math.round(palette.value)),
    colorIndex: palette.colorIndex ?? null,
  };
}

export function InspectorPalettes({
  palettes,
  selectedFixtureIds,
  patchMode,
  previewMode,
  busyActions,
  onApplyPalette,
  onCreatePalette,
  onUpdatePalette,
  onDeletePalette,
}: InspectorPalettesProps) {
  const [draft, setDraft] = useState<PaletteDraft | null>(null);
  const intensityPalettes = useMemo(() => palettes.filter((palette) => palette.kind === "intensity"), [palettes]);
  const cctPalettes = useMemo(() => palettes.filter((palette) => palette.kind === "cct"), [palettes]);
  const selectedCount = selectedFixtureIds.length;
  const applyDisabled = patchMode || selectedCount === 0;

  const saveDraft = () => {
    if (!draft) return;
    const name = draft.name.trim();
    const value = Number(draft.value);
    if (!name || !Number.isFinite(value)) return;

    if (draft.id) {
      onUpdatePalette({
        paletteId: draft.id,
        name,
        value,
        colorIndex: draft.colorIndex,
      });
    } else {
      onCreatePalette({
        name,
        kind: draft.kind,
        value,
        colorIndex: draft.colorIndex,
      });
    }
    setDraft(null);
  };

  const movePalette = (pool: readonly LightingPaletteSnapshot[], index: number, direction: -1 | 1) => {
    const palette = pool[index];
    if (!palette) return;
    if (direction === -1) {
      const beforePalette = pool[index - 1];
      if (!beforePalette) return;
      onUpdatePalette({ paletteId: palette.id, beforePaletteId: beforePalette.id });
      return;
    }
    const afterNext = pool[index + 2] ?? null;
    if (!pool[index + 1]) return;
    onUpdatePalette({ paletteId: palette.id, beforePaletteId: afterNext?.id ?? null });
  };

  return (
    <div className={styles.palettePane}>
      <div className={styles.paletteStatus} data-preview-mode={previewMode || undefined}>
        <span>{selectedCount} selected</span>
        <span>{previewMode ? "Preview" : "Live"}</span>
      </div>
      {renderPool("intensity", intensityPalettes, draft, setDraft, saveDraft, applyDisabled, busyActions, {
        movePalette,
        onApplyPalette,
        onDeletePalette,
      })}
      {renderPool("cct", cctPalettes, draft, setDraft, saveDraft, applyDisabled, busyActions, {
        movePalette,
        onApplyPalette,
        onDeletePalette,
      })}
    </div>
  );
}

function renderPool(
  kind: LightingPaletteKind,
  pool: readonly LightingPaletteSnapshot[],
  draft: PaletteDraft | null,
  setDraft: (draft: PaletteDraft | null) => void,
  saveDraft: () => void,
  applyDisabled: boolean,
  busyActions: ReadonlySet<string>,
  handlers: {
    movePalette: (pool: readonly LightingPaletteSnapshot[], index: number, direction: -1 | 1) => void;
    onApplyPalette: (paletteId: string) => void;
    onDeletePalette: (paletteId: string) => void;
  }
) {
  return (
    <section className={styles.palettePool} aria-label={`${KIND_LABEL[kind]} palettes`}>
      <div className={styles.palettePoolHeader}>
        <h3>{KIND_LABEL[kind]}</h3>
        <IconButton
          tone="ghost"
          size="sm"
          icon={Plus}
          label={`Create ${KIND_LABEL[kind]} palette`}
          onClick={() => setDraft(defaultDraft(kind))}
        />
      </div>
      <div className={styles.paletteGrid}>
        {pool.map((palette, index) => (
          <article key={palette.id} className={styles.paletteTile}>
            <span
              className={styles.paletteAccent}
              style={{ background: lightingColorTagHex(palette.colorIndex) ?? "transparent" }}
              aria-hidden="true"
            />
            <div className={styles.paletteTileMain}>
              <strong>{palette.name}</strong>
              <span>{formatPaletteValue(palette)}</span>
            </div>
            <div className={styles.paletteTileActions}>
              <IconButton
                tone="ghost"
                size="sm"
                icon={Play}
                label={`Apply ${palette.name}`}
                disabled={applyDisabled || busyActions.has(`palette-apply:${palette.id}`)}
                onClick={() => handlers.onApplyPalette(palette.id)}
              />
              <IconButton
                tone="ghost"
                size="sm"
                icon={Pencil}
                label={`Edit ${palette.name}`}
                disabled={busyActions.has(`palette-update:${palette.id}`)}
                onClick={() => setDraft(draftFromPalette(palette))}
              />
              <IconButton
                tone="ghost"
                size="sm"
                icon={ArrowUp}
                label={`Move ${palette.name} earlier`}
                disabled={index === 0 || busyActions.has(`palette-update:${palette.id}`)}
                onClick={() => handlers.movePalette(pool, index, -1)}
              />
              <IconButton
                tone="ghost"
                size="sm"
                icon={ArrowDown}
                label={`Move ${palette.name} later`}
                disabled={index === pool.length - 1 || busyActions.has(`palette-update:${palette.id}`)}
                onClick={() => handlers.movePalette(pool, index, 1)}
              />
              <IconButton
                tone="danger"
                size="sm"
                icon={Trash2}
                label={`Delete ${palette.name}`}
                disabled={busyActions.has(`palette-delete:${palette.id}`)}
                onClick={() => {
                  if (window.confirm(`Delete palette "${palette.name}"?`)) handlers.onDeletePalette(palette.id);
                }}
              />
            </div>
          </article>
        ))}
        {draft?.kind === kind ? renderDraftForm(draft, setDraft, saveDraft) : null}
      </div>
    </section>
  );
}

function renderDraftForm(draft: PaletteDraft, setDraft: (draft: PaletteDraft | null) => void, saveDraft: () => void) {
  return (
    <form
      className={styles.paletteForm}
      onSubmit={(event) => {
        event.preventDefault();
        saveDraft();
      }}
    >
      <input
        value={draft.name}
        onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
        maxLength={50}
        aria-label="Palette name"
      />
      <div className={styles.paletteValueInput}>
        <input
          value={draft.value}
          onChange={(event) => setDraft({ ...draft, value: event.currentTarget.value })}
          inputMode="numeric"
          aria-label="Palette value"
        />
        <span>{KIND_UNIT[draft.kind]}</span>
      </div>
      <div className={styles.paletteSwatches} aria-label="Color tag">
        {LIGHTING_COLOR_TAG_PALETTE.map((swatch) => (
          <button
            key={swatch.index}
            type="button"
            className={styles.paletteSwatchButton}
            data-active={draft.colorIndex === swatch.index}
            style={{ background: swatch.hex }}
            aria-label={swatch.name}
            onClick={() => setDraft({ ...draft, colorIndex: swatch.index })}
          />
        ))}
      </div>
      <div className={styles.paletteFormActions}>
        <Button type="submit" variant="primary" size="compact" leadingVisual={<Save size={13} aria-hidden="true" />}>
          Save
        </Button>
        <IconButton tone="ghost" size="sm" icon={X} label="Cancel palette edit" onClick={() => setDraft(null)} />
      </div>
    </form>
  );
}
