import { Camera, Pencil, Save, Trash2 } from "lucide-react";

import { Button, InspectorSection, StatusDot } from "@sse/design-system";
import type { LightingSceneSnapshot } from "@sse/engine-client";

import styles from "./LightingInspector.module.css";

export interface InspectorSceneProps {
  scene: LightingSceneSnapshot | null;
  thumbDataUri?: string;
  isModified: boolean;
  fixtureCount: number;
  bridgeReachable: boolean;
  onSaveScene?: () => void;
  onResaveScene?: () => void;
  onDeleteScene?: () => void;
  saveBusy?: boolean;
  resaveBusy?: boolean;
  deleteBusy?: boolean;
}

export function InspectorScene({
  scene,
  thumbDataUri,
  isModified,
  fixtureCount,
  bridgeReachable,
  onSaveScene,
  onResaveScene,
  onDeleteScene,
  saveBusy = false,
  resaveBusy = false,
  deleteBusy = false,
}: InspectorSceneProps) {
  if (!scene) {
    return (
      <InspectorSection title="No scene">
        <p className={styles.empty}>
          No scene is active. Press <kbd className={styles.kbd}>S</kbd> after editing fixtures to save the
          current rig state as a new scene.
        </p>
        {onSaveScene ? (
          <div className={styles.actionRow}>
            <Button
              onClick={onSaveScene}
              disabled={saveBusy || fixtureCount === 0}
              variant="primary"
              size="compact"
              leadingVisual={<Save aria-hidden="true" size={13} strokeWidth={1.75} />}
            >
              Save scene
            </Button>
          </div>
        ) : null}
      </InspectorSection>
    );
  }

  return (
    <>
      <InspectorSection title="Active scene">
        <div className={styles.scenePreview}>
          {thumbDataUri ? (
            <img alt="" className={styles.scenePreviewImage} src={thumbDataUri} />
          ) : (
            <div className={styles.scenePreviewPlaceholder} aria-hidden="true">
              <Camera size={20} strokeWidth={1.5} />
            </div>
          )}
          <div className={styles.sceneMeta}>
            <div className={styles.sceneName}>{scene.name}</div>
            <div className={styles.sceneSubline}>
              <StatusDot state={isModified ? "attn" : "ok"} size="sm" />
              {isModified ? "Modified — drift from saved state" : "On scene"}
            </div>
            <div className={styles.sceneFooter}>
              {scene.fixtureCount} fixture{scene.fixtureCount === 1 ? "" : "s"}
              {scene.lastRecalledAt ? ` · recalled ${formatRelativeTime(scene.lastRecalledAt)}` : ""}
            </div>
          </div>
        </div>
      </InspectorSection>

      <InspectorSection title="Scene actions">
        <div className={styles.actionRow}>
          {onResaveScene ? (
            <Button
              onClick={onResaveScene}
              disabled={resaveBusy || !isModified || !bridgeReachable}
              variant="secondary"
              size="compact"
              leadingVisual={<Pencil aria-hidden="true" size={13} strokeWidth={1.75} />}
            >
              Re-save scene
            </Button>
          ) : null}
          {onSaveScene ? (
            <Button
              onClick={onSaveScene}
              disabled={saveBusy || fixtureCount === 0}
              variant="ghost"
              size="compact"
              leadingVisual={<Save aria-hidden="true" size={13} strokeWidth={1.75} />}
            >
              Save as new
            </Button>
          ) : null}
          {onDeleteScene ? (
            <Button
              onClick={onDeleteScene}
              disabled={deleteBusy}
              variant="danger"
              size="compact"
              leadingVisual={<Trash2 aria-hidden="true" size={13} strokeWidth={1.75} />}
            >
              Delete
            </Button>
          ) : null}
        </div>
        <p className={styles.helpText}>
          Re-save updates the active scene to match the current rig. Save as new captures the current state
          as a new scene without overwriting.
        </p>
      </InspectorSection>
    </>
  );
}

function formatRelativeTime(iso: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) {
    return "—";
  }
  const elapsedMs = Date.now() - parsed;
  if (elapsedMs < 60_000) {
    return "just now";
  }
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
