import { Pencil, Plus, Save, Trash2 } from "lucide-react";
import { IconButton } from "@sse/design-system";

import styles from "../AudioWorkspace.module.css";
import type { AudioArmedAction } from "../audioArming";
import { SNAPSHOT_PLACEHOLDER_LEVELS, SNAPSHOT_THUMB_BAR_COUNT } from "../audioConstants";
import { formatAudioDb } from "../audioFormatting";
import type { AudioChannelEntry, AudioMixTargetEntry, AudioSnapshotEntry } from "../../shellData";
import { AudioArmCountdown } from "./AudioArmCountdown";

function formatSnapshotTime(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString([], { hour: "2-digit", hour12: false, minute: "2-digit" });
}

function clampSnapshotLevel(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function snapshotChannelLevel(
  channel: { fader: number; mixLevels: Record<string, number> },
  selectedMixTargetId: string | null
) {
  if (selectedMixTargetId && typeof channel.mixLevels[selectedMixTargetId] === "number") {
    return clampSnapshotLevel(channel.mixLevels[selectedMixTargetId]);
  }
  return clampSnapshotLevel(channel.fader);
}

function snapshotThumbLevels(snapshot: AudioSnapshotEntry, selectedMixTargetId: string | null) {
  const channels = snapshot.contents?.channels ? Object.values(snapshot.contents.channels) : [];
  if (!channels.length) return null;
  const levels = channels.map((channel) => snapshotChannelLevel(channel, selectedMixTargetId));
  return Array.from({ length: SNAPSHOT_THUMB_BAR_COUNT }, (_, barIndex) => {
    const sourceIndex = Math.min(levels.length - 1, Math.floor((barIndex / SNAPSHOT_THUMB_BAR_COUNT) * levels.length));
    return levels[sourceIndex] ?? 0;
  });
}

const SNAPSHOT_DIFF_SHOWN_LIMIT = 2;

interface SnapshotDiffSummary {
  shown: Array<{ after: number; before: number; label: string }>;
  total: number;
}

function snapshotPreviewDiffs({
  channels,
  mixTargets,
  selectedMixTargetId,
  snapshot,
}: {
  channels: AudioChannelEntry[];
  mixTargets: AudioMixTargetEntry[];
  selectedMixTargetId: string | null;
  snapshot: AudioSnapshotEntry;
}): SnapshotDiffSummary {
  if (!snapshot.contents) return { shown: [], total: 0 };
  const channelDiffs = channels.flatMap((channel) => {
    const stored = snapshot.contents?.channels[channel.id];
    if (!stored) return [];
    const current = snapshotChannelLevel(channel, selectedMixTargetId);
    const next = snapshotChannelLevel(stored, selectedMixTargetId);
    if (Math.abs(current - next) < 0.005) return [];
    return [{ after: next, before: current, label: channel.name }];
  });
  const mixTargetDiffs = mixTargets.flatMap((mixTarget) => {
    const stored = snapshot.contents?.mixTargets[mixTarget.id];
    if (!stored) return [];
    const current = clampSnapshotLevel(mixTarget.volume);
    const next = clampSnapshotLevel(stored.volume);
    if (Math.abs(current - next) < 0.005) return [];
    return [{ after: next, before: current, label: mixTarget.name }];
  });
  const combined = [...channelDiffs, ...mixTargetDiffs];
  return { shown: combined.slice(0, SNAPSHOT_DIFF_SHOWN_LIMIT), total: combined.length };
}

export function AudioSnapshotDeck({
  actionsAllowed,
  armedAction,
  busyAction,
  channels,
  mixTargets,
  onCaptureSnapshot,
  onDeleteSnapshot,
  onRecallSnapshot,
  onRenameSnapshot,
  onSaveSnapshot,
  recentlyRecalledSnapshotId,
  selectedMixTargetId,
  snapshots,
}: {
  actionsAllowed: boolean;
  armedAction: AudioArmedAction | null;
  busyAction: string | null;
  channels: AudioChannelEntry[];
  mixTargets: AudioMixTargetEntry[];
  onCaptureSnapshot: () => void;
  onDeleteSnapshot: (snapshotId: string, snapshotName: string) => void;
  onRecallSnapshot: (snapshotId: string) => void;
  onRenameSnapshot: (snapshotId: string, snapshotName: string) => void;
  onSaveSnapshot: (snapshotId: string) => void;
  recentlyRecalledSnapshotId: string | null;
  selectedMixTargetId: string | null;
  snapshots: AudioSnapshotEntry[];
}) {
  const slots = Array.from({ length: 8 }, (_, index) => {
    const oscIndex = index;
    return snapshots.find((snapshot) => snapshot.oscIndex === oscIndex) ?? null;
  });
  const currentSnapshot = snapshots.find((snapshot) => snapshot.lastRecalled) ?? null;

  return (
    <section className={styles.snapshotDeck} data-testid="audio-snapshot-deck">
      <div className={styles.snapshotDeckHeader}>
        <div>
          <h2>Snapshots</h2>
        </div>
        <span className={styles.snapshotShortcut}>Shift 1-8</span>
        <span className={styles.visuallyHidden} data-testid="audio-toolbar-current-snapshot">
          {currentSnapshot ? `Recalled ${currentSnapshot.name}` : "No recall yet"}
        </span>
      </div>
      <div className={styles.snapshotGrid}>
        <button
          className={styles.snapshotCapture}
          aria-label="New snapshot"
          data-testid="audio-snapshot-capture"
          disabled={!actionsAllowed || busyAction === "audio-snapshot-capture"}
          onClick={onCaptureSnapshot}
          title={actionsAllowed ? "Capture current mix into the first empty slot" : "Snapshot capture unavailable"}
          type="button"
        >
          <span className={styles.snapshotSlot}>
            <Plus size={14} strokeWidth={1.8} aria-hidden="true" />
          </span>
          <span className={styles.snapshotName} data-kind="capture">
            New
          </span>
          <span className={styles.snapshotMeta}>Shift +</span>
        </button>
        {slots.map((snapshot, index) => {
          if (!snapshot) {
            return (
              <button
                className={`${styles.snapshotTile} ${styles.snapshotEmpty}`}
                data-current="false"
                data-snapshot-slot={index + 1}
                data-slot-state="empty"
                data-testid={`audio-snapshot-empty-${index + 1}`}
                disabled
                key={`snapshot-empty-${index + 1}`}
                type="button"
              >
                <span className={styles.snapshotSlot}>Slot {index + 1}</span>
                <span className={styles.snapshotName}>Empty</span>
                <span className={styles.snapshotThumb} aria-hidden="true" data-has-contents="false">
                  {SNAPSHOT_PLACEHOLDER_LEVELS.map((level, barIndex) => (
                    <i key={`empty-${index}-${barIndex}`} style={{ height: `${Math.max(6, level * 100)}%` }} />
                  ))}
                </span>
                <span className={styles.snapshotMeta}>-</span>
              </button>
            );
          }

          const thumbLevels = snapshotThumbLevels(snapshot, selectedMixTargetId);
          const previewDiffs = snapshotPreviewDiffs({ channels, mixTargets, selectedMixTargetId, snapshot });
          const hasContents = Boolean(snapshot.contents && thumbLevels);
          const recallActionKey = `snapshot-recall:${snapshot.id}`;
          const saveActionKey = `snapshot-save:${snapshot.id}`;
          const armedKey = armedAction?.key ?? null;
          const recallArmed = armedKey === recallActionKey;
          const saveArmed = armedKey === saveActionKey;
          const tileArmed = recallArmed || saveArmed;
          const tileArmedTimeoutMs = tileArmed ? (armedAction?.timeoutMs ?? null) : null;

          return (
            <div
              className={styles.snapshotTile}
              data-armed={recallArmed}
              data-current={snapshot.lastRecalled}
              data-flash={recentlyRecalledSnapshotId === snapshot.id}
              data-snapshot-slot={index + 1}
              data-slot-state="populated"
              data-testid={`audio-snapshot-${snapshot.id}`}
              key={snapshot.id}
            >
              <button
                aria-label={`${recallArmed ? "Apply recall" : "Arm recall"} ${snapshot.name}`}
                className={styles.snapshotRecallSurface}
                data-armed={recallArmed}
                data-testid={`audio-snapshot-recall-${snapshot.id}`}
                disabled={!actionsAllowed || busyAction === `audio-snapshot-${snapshot.id}`}
                onClick={() => onRecallSnapshot(snapshot.id)}
                type="button"
              >
                <span className={styles.snapshotSlot}>Slot {snapshot.oscIndex + 1}</span>
                <span className={styles.snapshotName} data-testid={`audio-snapshot-name-${snapshot.id}`}>
                  {snapshot.name}
                </span>
                <span
                  className={styles.snapshotThumb}
                  data-has-contents={hasContents}
                  data-testid={`audio-snapshot-thumb-${snapshot.id}`}
                  title={hasContents ? "Captured mix-shape thumbnail" : "No captured contents"}
                >
                  {(thumbLevels ?? SNAPSHOT_PLACEHOLDER_LEVELS).map((level, barIndex) => (
                    <i
                      key={`${snapshot.id}-thumb-${barIndex}`}
                      style={{ height: `${Math.max(6, Math.round(level * 100))}%` }}
                    />
                  ))}
                </span>
                <span className={styles.snapshotMeta} data-testid={`audio-snapshot-meta-${snapshot.id}`}>
                  {recallArmed ? "armed" : snapshot.lastRecalledAt ? formatSnapshotTime(snapshot.lastRecalledAt) : "-"}
                </span>
                <span className={styles.snapshotPreview}>
                  {snapshot.lastRecalled ? (
                    <>
                      <strong>Currently loaded</strong>
                      <small>Captured {formatSnapshotTime(snapshot.lastRecalledAt)}</small>
                      <small>
                        {snapshot.preview.hasContents
                          ? `${snapshot.preview.channelCount} sources saved`
                          : "Console slot only"}
                      </small>
                      {hasContents ? (
                        previewDiffs.total > 0 ? (
                          <>
                            {previewDiffs.shown.map((diff) => (
                              <small className={styles.snapshotPreviewLine} key={`${snapshot.id}-${diff.label}`}>
                                <span>{diff.label}</span>
                                <strong>
                                  {formatAudioDb(diff.before)} -&gt; {formatAudioDb(diff.after)}
                                </strong>
                              </small>
                            ))}
                            {previewDiffs.total > previewDiffs.shown.length ? (
                              <small
                                className={styles.snapshotPreviewOverflow}
                                data-testid={`audio-snapshot-diff-overflow-${snapshot.id}`}
                              >
                                +{previewDiffs.total - previewDiffs.shown.length} more changes
                              </small>
                            ) : null}
                          </>
                        ) : (
                          <small>No diff from current mix</small>
                        )
                      ) : null}
                    </>
                  ) : (
                    <>
                      <strong>If you load this</strong>
                      <small>
                        {snapshot.preview.hasContents
                          ? `${snapshot.preview.changedChannels.length + snapshot.preview.changedMixTargets.length} changes`
                          : "Console slot recall"}
                      </small>
                      <small>
                        {hasContents ? `${snapshot.preview.channelCount} sources saved` : "No captured contents"}
                      </small>
                      {hasContents ? (
                        previewDiffs.total > 0 ? (
                          <>
                            {previewDiffs.shown.map((diff) => (
                              <small className={styles.snapshotPreviewLine} key={`${snapshot.id}-${diff.label}`}>
                                <span>{diff.label}</span>
                                <strong>
                                  {formatAudioDb(diff.before)} -&gt; {formatAudioDb(diff.after)}
                                </strong>
                              </small>
                            ))}
                            {previewDiffs.total > previewDiffs.shown.length ? (
                              <small
                                className={styles.snapshotPreviewOverflow}
                                data-testid={`audio-snapshot-diff-overflow-${snapshot.id}`}
                              >
                                +{previewDiffs.total - previewDiffs.shown.length} more changes
                              </small>
                            ) : null}
                          </>
                        ) : (
                          <small>No diff from current mix</small>
                        )
                      ) : null}
                    </>
                  )}
                </span>
              </button>
              <span className={styles.snapshotTileActions} data-testid={`audio-snapshot-actions-${snapshot.id}`}>
                <IconButton
                  className={styles.snapshotActionButton}
                  data-armed={saveArmed}
                  disabled={!actionsAllowed || busyAction === `audio-snapshot-save-${snapshot.id}`}
                  icon={Save}
                  label={`${saveArmed ? "Apply save" : "Arm save"} ${snapshot.name}`}
                  onClick={() => onSaveSnapshot(snapshot.id)}
                  size="sm"
                />
                <IconButton
                  className={styles.snapshotActionButton}
                  disabled={!actionsAllowed || busyAction === `audio-snapshot-rename-${snapshot.id}`}
                  icon={Pencil}
                  label={`Rename ${snapshot.name}`}
                  onClick={() => onRenameSnapshot(snapshot.id, snapshot.name)}
                  size="sm"
                />
                <IconButton
                  className={styles.snapshotActionButton}
                  disabled={!actionsAllowed || busyAction === `audio-snapshot-delete-${snapshot.id}`}
                  icon={Trash2}
                  label={`Delete ${snapshot.name}`}
                  onClick={() => onDeleteSnapshot(snapshot.id, snapshot.name)}
                  size="sm"
                  tone="danger"
                />
              </span>
              {tileArmedTimeoutMs !== null ? (
                <AudioArmCountdown
                  durationMs={tileArmedTimeoutMs}
                  key={`${snapshot.id}-${armedAction?.armedAt ?? 0}`}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
