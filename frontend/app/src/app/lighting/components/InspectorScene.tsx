import { useRef, useState } from "react";
import { Palette, Pencil, Play, Plus, Save, Trash2, X } from "lucide-react";

import {
  Button,
  ColorPicker,
  ConfirmDialog,
  IconButton,
  InlineRename,
  type InlineRenameHandle,
} from "@sse/design-system";
import type { LightingFixtureSnapshot, LightingGroupSnapshot, LightingSceneSnapshot } from "@sse/engine-client";

import { formatLightingRelativeTime, lightingFixtureColor } from "../lightingHelpers";
import { LIGHTING_COLOR_TAG_PALETTE, lightingColorTagHex, lightingColorTagName } from "../lightingColorTags";

import styles from "./LightingInspector.module.css";

export interface InspectorSceneProps {
  scene: LightingSceneSnapshot | null;
  fixtures: readonly LightingFixtureSnapshot[];
  groups: readonly LightingGroupSnapshot[];
  isModified: boolean;
  isPreviewMode?: boolean;
  /** Wave 30b — when true, the displayed scene is a hover-preview, not the
   *  active recalled scene. Eyebrow flips to "Hover preview" to make the
   *  transient state explicit; modified treatment is suppressed (the parent
   *  passes `isModified={false}` in this mode anyway). */
  isHoverPreview?: boolean;
  bridgeReachable: boolean;
  onSaveScene?: () => void;
  onSaveSceneAs?: () => void;
  onRecallScene?: (sceneId: string) => void;
  onResaveScene?: () => void;
  onDeleteScene?: () => void;
  /** Inline-rename commit handler. Receives the trimmed new name. */
  onRenameScene?: (sceneId: string, newName: string) => void | Promise<void>;
  /** Set color tag handler. Receives `null` (clear) or `0..7` (set). */
  onSetSceneColor?: (sceneId: string, colorIndex: number | null) => void;
  saveBusy?: boolean;
  recallBusy?: boolean;
  resaveBusy?: boolean;
  deleteBusy?: boolean;
  renameBusy?: boolean;
  /** When true, marks the scene's color update as in-flight. */
  colorBusy?: boolean;
}

interface SceneStats {
  onCount: number;
  totalCount: number;
  fixturesPatched: number;
  avgIntensity: number;
  avgCct: number;
  groupsOn: number;
  groupsTotal: number;
}

function computeSceneStats(
  scene: LightingSceneSnapshot,
  fixtures: readonly LightingFixtureSnapshot[],
  groups: readonly LightingGroupSnapshot[]
): SceneStats {
  const onStates = scene.fixtureStates.filter((state) => state.on);
  const intensitySum = onStates.reduce((sum, state) => sum + state.intensity, 0);
  const cctSum = onStates.reduce((sum, state) => sum + state.cct, 0);
  const fixturesPatched = fixtures.filter((fixture) => fixture.dmxStartAddress > 0).length;

  // Groups-on: a group is "on" if any of its fixtures has on=true in the
  // scene's saved state. Approximate count for the inspector header card.
  const sceneStateById = new Map(scene.fixtureStates.map((state) => [state.fixtureId, state]));
  const groupsOn = groups.filter((group) => {
    const groupFixtures = fixtures.filter((fixture) => fixture.groupId === group.id);
    return groupFixtures.some((fixture) => sceneStateById.get(fixture.id)?.on === true);
  }).length;

  return {
    onCount: onStates.length,
    totalCount: scene.fixtureStates.length,
    fixturesPatched,
    avgIntensity: onStates.length > 0 ? Math.round(intensitySum / onStates.length) : 0,
    avgCct: onStates.length > 0 ? Math.round(cctSum / onStates.length) : 0,
    groupsOn,
    groupsTotal: groups.length,
  };
}

export function InspectorScene({
  scene,
  fixtures,
  groups,
  isModified,
  isPreviewMode = false,
  isHoverPreview = false,
  bridgeReachable,
  onSaveScene,
  onSaveSceneAs,
  onRecallScene,
  onResaveScene,
  onDeleteScene,
  onRenameScene,
  onSetSceneColor,
  saveBusy = false,
  recallBusy = false,
  resaveBusy = false,
  deleteBusy = false,
  renameBusy = false,
  colorBusy = false,
}: InspectorSceneProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [colorPickerPos, setColorPickerPos] = useState<{ x: number; y: number } | null>(null);
  const renameRef = useRef<InlineRenameHandle | null>(null);

  if (!scene) {
    return (
      <div className={styles.scenePane}>
        <div className={styles.sceneEmpty}>
          <span className={styles.sceneEyebrow}>Active scene</span>
          <h2 className={styles.sceneTitle}>No scene</h2>
          <p className={styles.sceneSub}>
            No scene is active. Press <kbd className={styles.kbd}>S</kbd> after editing fixtures to save the current rig
            state as a new scene, or use <strong>Save as new</strong> to name it explicitly.
          </p>
          <div className={styles.sceneActions}>
            {onSaveScene ? (
              <Button
                onClick={onSaveScene}
                disabled={saveBusy || fixtures.length === 0}
                variant="primary"
                size="compact"
                leadingVisual={<Save aria-hidden="true" size={13} strokeWidth={1.75} />}
              >
                Save scene
              </Button>
            ) : null}
            {onSaveSceneAs ? (
              <Button
                onClick={onSaveSceneAs}
                disabled={saveBusy || fixtures.length === 0}
                variant="ghost"
                size="compact"
                leadingVisual={<Plus aria-hidden="true" size={13} strokeWidth={1.75} />}
              >
                Save as new…
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  const stats = computeSceneStats(scene, fixtures, groups);
  const onStateById = new Map(scene.fixtureStates.filter((state) => state.on).map((state) => [state.fixtureId, state]));

  return (
    <div className={styles.scenePane}>
      <span className={styles.sceneEyebrow}>
        {isPreviewMode
          ? isModified
            ? "Preview target · offline edits"
            : "Preview target"
          : isHoverPreview
            ? "Hover preview"
            : isModified
              ? "Active scene · modified"
              : "Active scene"}
      </span>
      <div className={styles.sceneTitleRow}>
        <h2 className={styles.sceneTitle}>
          {onRenameScene ? (
            <InlineRename
              ref={renameRef}
              value={scene.name}
              onCommit={(next) => onRenameScene(scene.id, next)}
              busy={renameBusy}
              inputAriaLabel={`Rename scene ${scene.name}`}
              maxLength={120}
            />
          ) : (
            scene.name
          )}
        </h2>
        {onRenameScene ? (
          <IconButton
            tone="ghost"
            size="sm"
            icon={Pencil}
            label={`Rename scene ${scene.name}`}
            onClick={() => renameRef.current?.beginEdit()}
            disabled={renameBusy}
          />
        ) : null}
      </div>
      <p className={styles.sceneSub}>
        {stats.onCount > 0
          ? `${stats.onCount} of ${stats.totalCount} fixture${stats.totalCount === 1 ? "" : "s"} on at ${stats.avgIntensity}% / ${stats.avgCct} K average.`
          : `All ${stats.totalCount} fixture${stats.totalCount === 1 ? "" : "s"} dark in this scene.`}
      </p>

      <dl className={styles.sceneStatGrid}>
        <div className={styles.sceneStat}>
          <dt className={styles.sceneStatLabel}>Fixtures</dt>
          <dd className={styles.sceneStatValue}>
            {stats.totalCount}
            <small> / {stats.fixturesPatched} patched</small>
          </dd>
        </div>
        <div className={styles.sceneStat}>
          <dt className={styles.sceneStatLabel}>Groups on</dt>
          <dd className={styles.sceneStatValue}>
            {stats.groupsOn}
            <small> / {stats.groupsTotal}</small>
          </dd>
        </div>
        {stats.onCount > 0 ? (
          <>
            <div className={styles.sceneStat}>
              <dt className={styles.sceneStatLabel}>Avg intensity</dt>
              <dd className={styles.sceneStatValue}>
                {stats.avgIntensity}
                <small> %</small>
              </dd>
            </div>
            <div className={styles.sceneStat}>
              <dt className={styles.sceneStatLabel}>CCT mean</dt>
              <dd className={styles.sceneStatValue}>
                {stats.avgCct}
                <small> K</small>
              </dd>
            </div>
          </>
        ) : (
          <div className={`${styles.sceneStat} ${styles.sceneStatSpan}`}>
            <dt className={styles.sceneStatLabel}>State</dt>
            <dd className={styles.sceneStatValue}>
              All dark
              <small> · no levels</small>
            </dd>
          </div>
        )}
      </dl>

      {stats.onCount > 0 ? (
        <section className={styles.sceneSection}>
          <h3 className={styles.sceneSectionHead}>Fixtures used</h3>
          <ul className={styles.sceneFixtureChips}>
            {fixtures.map((fixture) => {
              const state = onStateById.get(fixture.id);
              if (!state) return null;
              const swatch = lightingFixtureColor(state.cct, true);
              return (
                <li key={fixture.id} className={styles.sceneFixtureChip}>
                  <span className={styles.sceneFixtureSwatch} style={{ background: swatch }} aria-hidden="true" />
                  <span className={styles.sceneFixtureName}>{fixture.name}</span>
                  <span className={styles.sceneFixtureLevel}>{state.intensity}%</span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {onSetSceneColor ? (
        <section className={styles.sceneSection}>
          <h3 className={styles.sceneSectionHead}>Color tag</h3>
          <div className={styles.colorRow}>
            <button
              type="button"
              className={styles.colorPickerTrigger}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setColorPickerPos({ x: rect.left, y: rect.bottom + 6 });
              }}
              disabled={colorBusy}
              aria-label={
                lightingColorTagName(scene.colorIndex)
                  ? `Change color tag (currently ${lightingColorTagName(scene.colorIndex)})`
                  : "Set a color tag"
              }
            >
              <span
                aria-hidden="true"
                className={styles.colorSwatch}
                style={{ background: lightingColorTagHex(scene.colorIndex) ?? "transparent" }}
              />
              <span className={styles.colorLabel}>{lightingColorTagName(scene.colorIndex) ?? "None"}</span>
              <Palette aria-hidden="true" size={12} strokeWidth={1.75} />
            </button>
            {scene.colorIndex !== null ? (
              <IconButton
                tone="ghost"
                size="sm"
                icon={X}
                label="Clear color tag"
                onClick={() => onSetSceneColor(scene.id, null)}
                disabled={colorBusy}
              />
            ) : null}
          </div>
        </section>
      ) : null}

      <section className={styles.sceneSection}>
        <h3 className={styles.sceneSectionHead}>Last activity</h3>
        <p className={styles.sceneProvenance}>
          {scene.lastRecalledAt ? (
            <>
              Last recalled <b>{formatLightingRelativeTime(scene.lastRecalledAt)}</b>
            </>
          ) : (
            <>Not yet recalled</>
          )}
        </p>
      </section>

      <div className={styles.sceneActions}>
        {onRecallScene ? (
          <Button
            onClick={() => onRecallScene(scene.id)}
            loading={recallBusy}
            disabled={!bridgeReachable && !isPreviewMode}
            variant="primary"
            size="compact"
            leadingVisual={<Play aria-hidden="true" size={13} strokeWidth={1.75} />}
          >
            {isPreviewMode ? "Load into preview" : "Recall scene"}
          </Button>
        ) : null}
        {onResaveScene ? (
          <Button
            onClick={onResaveScene}
            loading={resaveBusy}
            disabled={!isModified || (!bridgeReachable && !isPreviewMode)}
            variant="secondary"
            size="compact"
            leadingVisual={<Pencil aria-hidden="true" size={13} strokeWidth={1.75} />}
          >
            {isPreviewMode ? "Save preview" : "Save changes"}
          </Button>
        ) : null}
        {onSaveSceneAs ? (
          <Button
            onClick={onSaveSceneAs}
            loading={saveBusy}
            disabled={fixtures.length === 0}
            variant="ghost"
            size="compact"
            leadingVisual={<Plus aria-hidden="true" size={13} strokeWidth={1.75} />}
          >
            Save as new
          </Button>
        ) : null}
        {onDeleteScene ? (
          <Button
            onClick={() => setConfirmingDelete(true)}
            loading={deleteBusy}
            variant="danger"
            size="compact"
            leadingVisual={<Trash2 aria-hidden="true" size={13} strokeWidth={1.75} />}
          >
            Delete
          </Button>
        ) : null}
      </div>

      {confirmingDelete && onDeleteScene ? (
        <ConfirmDialog
          title="Delete scene?"
          body={
            <>
              This permanently removes <strong>{scene.name}</strong>. Other scenes are unaffected and the live rig state
              stays as it is.
            </>
          }
          confirmLabel="Delete scene"
          danger
          busy={deleteBusy}
          onConfirm={() => {
            setConfirmingDelete(false);
            onDeleteScene();
          }}
          onCancel={() => setConfirmingDelete(false)}
        />
      ) : null}
      {colorPickerPos && onSetSceneColor ? (
        <ColorPicker
          x={colorPickerPos.x}
          y={colorPickerPos.y}
          swatches={LIGHTING_COLOR_TAG_PALETTE}
          selectedIndex={scene.colorIndex}
          onSelect={(next) => onSetSceneColor(scene.id, next)}
          onClose={() => setColorPickerPos(null)}
          ariaLabel={`Pick a color tag for scene ${scene.name}`}
        />
      ) : null}
    </div>
  );
}
