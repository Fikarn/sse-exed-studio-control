import { useEffect, useRef, useState, type CSSProperties } from "react";

import {
  ColorPicker,
  InlineRename,
  Key,
  LampWord,
  MenuButton,
  PlateHead,
  Readouts,
  Section,
  type InlineRenameHandle,
  type MenuContent,
} from "@sse/design-system";
import type { LightingFixtureSnapshot, LightingSceneSnapshot } from "@sse/engine-client";

import { formatLightingRelativeTime, lightingFixtureColor } from "../lightingHelpers";
import { LIGHTING_COLOR_TAG_PALETTE } from "../lightingColorTags";
import type { LightingMenu } from "../lightingMenus";
import type { SceneRowWord } from "./SceneRow";

import styles from "./LightingInspector.module.css";

// The visual overhaul's Lighting page (2026-10-04): a scene on the plate. Its
// title plate (its name, its word on the rig, its ⋯: the same menu as its row
// in the cluster, Delete scene… last, arming in place); Recall, and Save
// changes while the rig has left it; what it holds; and the fixtures it holds,
// each a row that opens the fixture. There is no Save as new here: a new
// scene is the Save row's, in the cluster.

const TONE = { "on rig": "ok", unsaved: "attention", preview: "info" } as const;
const FIXTURE_ROWS = 10;

export interface InspectorSceneProps {
  scene: LightingSceneSnapshot | null;
  fixtures: readonly LightingFixtureSnapshot[];
  /** Its word on the rig, as the deck's RECALL says it; null when it is not the rig's. */
  word: SceneRowWord | null;
  isHoverPreview?: boolean;
  isPreviewMode?: boolean;
  /** Why a recall is refused (Patch, the bridge), or null. */
  recallReason?: string | null;
  menu: LightingMenu | null;
  arm: MenuContent["arm"];
  onRecallScene?: (sceneId: string) => void;
  onResaveScene?: (sceneId: string) => void;
  onRenameScene?: (sceneId: string, newName: string) => void | Promise<void>;
  onSetSceneColor?: (sceneId: string, colorIndex: number | null) => void;
  onSelectFixture?: (fixtureId: string) => void;
  recallBusy?: boolean;
  resaveBusy?: boolean;
  renameBusy?: boolean;
  /** The menu's Rename… and Colour…, as nonces. */
  renameRequest?: number;
  colourRequest?: number;
}

export function InspectorScene({
  scene,
  fixtures,
  word,
  isHoverPreview = false,
  isPreviewMode = false,
  recallReason = null,
  menu,
  arm,
  onRecallScene,
  onResaveScene,
  onRenameScene,
  onSetSceneColor,
  onSelectFixture,
  recallBusy = false,
  resaveBusy = false,
  renameBusy = false,
  renameRequest = 0,
  colourRequest = 0,
}: InspectorSceneProps) {
  const renameRef = useRef<InlineRenameHandle | null>(null);
  const headRef = useRef<HTMLDivElement | null>(null);
  const [colourAt, setColourAt] = useState<{ x: number; y: number } | null>(null);
  const seenRename = useRef(renameRequest);
  useEffect(() => {
    if (renameRequest === seenRename.current) return;
    seenRename.current = renameRequest;
    renameRef.current?.beginEdit();
  }, [renameRequest]);
  const seenColour = useRef(colourRequest);
  useEffect(() => {
    if (colourRequest === seenColour.current) return;
    seenColour.current = colourRequest;
    const box = headRef.current?.getBoundingClientRect();
    if (box) setColourAt({ x: box.left + 16, y: box.bottom });
  }, [colourRequest]);

  if (!scene) {
    return (
      <PlateHead
        title="No scene"
        sub="Set the rig, then save it with Save as a new scene in the Scenes list."
        testId="lighting-plate-head"
      />
    );
  }

  const lit = scene.fixtureStates.filter((state) => state.on);
  const avgIntensity =
    lit.length > 0 ? Math.round(lit.reduce((sum, state) => sum + state.intensity, 0) / lit.length) : 0;
  const avgCct = lit.length > 0 ? Math.round(lit.reduce((sum, state) => sum + state.cct, 0) / lit.length) : 0;
  const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const held = scene.fixtureStates
    .map((state) => ({ state, fixture: byId.get(state.fixtureId) ?? null }))
    .filter((entry): entry is { state: (typeof scene.fixtureStates)[number]; fixture: LightingFixtureSnapshot } =>
      Boolean(entry.fixture)
    );
  const shown = held.slice(0, FIXTURE_ROWS);
  const unsaved = word === "unsaved" || (isPreviewMode && word === "preview");
  const sub = isHoverPreview
    ? "the scene under the pointer"
    : word
      ? word
      : isPreviewMode
        ? "not the preview's"
        : "not on the rig";

  return (
    <>
      <div ref={headRef}>
        <PlateHead
          title={
            onRenameScene ? (
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
            )
          }
          sub={
            word && !isHoverPreview ? (
              <LampWord tone={TONE[word]} testId="lighting-plate-scene-word">
                {word}
              </LampWord>
            ) : (
              sub
            )
          }
          action={
            menu ? (
              <MenuButton
                buttonLabel={`${scene.name} menu`}
                buttonTestId="lighting-plate-menu"
                menu={{ ...menu, arm }}
              />
            ) : null
          }
          testId="lighting-plate-head"
        />
      </div>

      <div className={styles.keyRow}>
        <Key
          mode="primary"
          size="large"
          take
          locked={Boolean(recallReason)}
          reason={recallReason ?? undefined}
          disabled={recallBusy}
          onClick={() => onRecallScene?.(scene.id)}
        >
          {isPreviewMode ? "Load into preview" : "Recall scene"}
        </Key>
        <Key
          size="large"
          locked={!unsaved}
          reason={isPreviewMode ? "Nothing in the preview to save yet." : "The rig holds this scene as it was saved."}
          disabled={resaveBusy}
          onClick={() => onResaveScene?.(scene.id)}
        >
          {isPreviewMode ? "Save preview" : "Save changes"}
        </Key>
      </div>

      <Readouts
        data-testid="lighting-plate-scene-facts"
        rows={[
          { id: "fixtures", label: "Fixtures on", value: `${lit.length} of ${scene.fixtureStates.length}` },
          { id: "intensity", label: "Average level", value: lit.length > 0 ? `${avgIntensity} %` : "all off" },
          { id: "cct", label: "Average colour", value: lit.length > 0 ? `${avgCct} K` : "—" },
          {
            id: "recalled",
            label: "Last recalled",
            value: scene.lastRecalledAt ? formatLightingRelativeTime(scene.lastRecalledAt) : "not yet",
          },
        ]}
      />

      <Section title="In the scene" detail={`${held.length} fixture${held.length === 1 ? "" : "s"}`}>
        <ul className={styles.memberList} aria-label={`Fixtures in ${scene.name}`}>
          {shown.map(({ state, fixture }) => (
            <li key={fixture.id}>
              <button
                type="button"
                className={styles.memberRow}
                aria-label={`Open fixture settings for ${fixture.name}`}
                onClick={() => onSelectFixture?.(fixture.id)}
              >
                <span
                  aria-hidden="true"
                  className={styles.memberLamp}
                  style={{ background: lightingFixtureColor(state.cct, state.on) } as CSSProperties}
                />
                <span className={styles.memberName}>{fixture.name}</span>
                <span className={styles.memberValue}>
                  {state.on ? `${Math.round(state.intensity)} % · ${Math.round(state.cct)} K` : "off"}
                </span>
              </button>
            </li>
          ))}
          {held.length > shown.length ? (
            <li className={styles.memberMore}>and {held.length - shown.length} more</li>
          ) : null}
        </ul>
      </Section>

      {colourAt && onSetSceneColor ? (
        <ColorPicker
          x={colourAt.x}
          y={colourAt.y}
          swatches={LIGHTING_COLOR_TAG_PALETTE}
          selectedIndex={scene.colorIndex ?? null}
          onSelect={(next) => onSetSceneColor(scene.id, next)}
          onClose={() => setColourAt(null)}
          ariaLabel={`Pick a colour for scene ${scene.name}`}
        />
      ) : null}
    </>
  );
}
