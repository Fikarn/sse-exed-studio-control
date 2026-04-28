import { useState } from "react";
import { Pencil, Play, Save, Trash2 } from "lucide-react";

import { Button, ConfirmDialog } from "@sse/design-system";
import type { LightingFixtureSnapshot, LightingGroupSnapshot, LightingSceneSnapshot } from "@sse/engine-client";

import { lightingFixtureColor } from "../lightingHelpers";

import styles from "./LightingInspector.module.css";

export interface InspectorSceneProps {
  scene: LightingSceneSnapshot | null;
  fixtures: readonly LightingFixtureSnapshot[];
  groups: readonly LightingGroupSnapshot[];
  isModified: boolean;
  bridgeReachable: boolean;
  onSaveScene?: () => void;
  onRecallScene?: (sceneId: string) => void;
  onResaveScene?: () => void;
  onDeleteScene?: () => void;
  saveBusy?: boolean;
  recallBusy?: boolean;
  resaveBusy?: boolean;
  deleteBusy?: boolean;
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

function formatRelativeTime(iso: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return "—";
  const elapsedMs = Date.now() - parsed;
  if (elapsedMs < 60_000) return "just now";
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function InspectorScene({
  scene,
  fixtures,
  groups,
  isModified,
  bridgeReachable,
  onSaveScene,
  onRecallScene,
  onResaveScene,
  onDeleteScene,
  saveBusy = false,
  recallBusy = false,
  resaveBusy = false,
  deleteBusy = false,
}: InspectorSceneProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (!scene) {
    return (
      <div className={styles.scenePane}>
        <div className={styles.sceneEmpty}>
          <span className={styles.sceneEyebrow}>Active scene</span>
          <h2 className={styles.sceneTitle}>No scene</h2>
          <p className={styles.sceneSub}>
            No scene is active. Press <kbd className={styles.kbd}>S</kbd> after editing fixtures to save the current rig
            state as a new scene.
          </p>
          {onSaveScene ? (
            <div className={styles.sceneActions}>
              <Button
                onClick={onSaveScene}
                disabled={saveBusy || fixtures.length === 0}
                variant="primary"
                size="compact"
                leadingVisual={<Save aria-hidden="true" size={13} strokeWidth={1.75} />}
              >
                Save scene
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  const stats = computeSceneStats(scene, fixtures, groups);
  const onStateById = new Map(scene.fixtureStates.filter((state) => state.on).map((state) => [state.fixtureId, state]));

  return (
    <div className={styles.scenePane}>
      <span className={styles.sceneEyebrow}>{isModified ? "Active scene · modified" : "Active scene"}</span>
      <h2 className={styles.sceneTitle}>{scene.name}</h2>
      <p className={styles.sceneSub}>
        {stats.onCount} of {stats.totalCount} fixture{stats.totalCount === 1 ? "" : "s"} emitting at an average of{" "}
        {stats.avgIntensity > 0 ? `${stats.avgIntensity}% / ${stats.avgCct} K` : "rest"}.
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
          <dt className={styles.sceneStatLabel}>Avg intensity</dt>
          <dd className={styles.sceneStatValue}>
            {stats.avgIntensity}
            <small> %</small>
          </dd>
        </div>
        <div className={styles.sceneStat}>
          <dt className={styles.sceneStatLabel}>CCT mean</dt>
          <dd className={styles.sceneStatValue}>
            {stats.avgCct || "—"}
            <small>{stats.avgCct ? " K" : ""}</small>
          </dd>
        </div>
        <div className={styles.sceneStat}>
          <dt className={styles.sceneStatLabel}>Groups on</dt>
          <dd className={styles.sceneStatValue}>
            {stats.groupsOn}
            <small> / {stats.groupsTotal}</small>
          </dd>
        </div>
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

      <section className={styles.sceneSection}>
        <h3 className={styles.sceneSectionHead}>Provenance</h3>
        <p className={styles.sceneProvenance}>
          {scene.lastRecalledAt ? (
            <>
              Last recalled <b>{formatRelativeTime(scene.lastRecalledAt)}</b>
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
            disabled={!bridgeReachable}
            variant="primary"
            size="compact"
            leadingVisual={<Play aria-hidden="true" size={13} strokeWidth={1.75} />}
          >
            Recall again
          </Button>
        ) : null}
        {onResaveScene ? (
          <Button
            onClick={onResaveScene}
            loading={resaveBusy}
            disabled={!isModified || !bridgeReachable}
            variant="secondary"
            size="compact"
            leadingVisual={<Pencil aria-hidden="true" size={13} strokeWidth={1.75} />}
          >
            Save changes
          </Button>
        ) : null}
        {onSaveScene ? (
          <Button
            onClick={onSaveScene}
            loading={saveBusy}
            disabled={fixtures.length === 0}
            variant="ghost"
            size="compact"
            leadingVisual={<Save aria-hidden="true" size={13} strokeWidth={1.75} />}
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
    </div>
  );
}
