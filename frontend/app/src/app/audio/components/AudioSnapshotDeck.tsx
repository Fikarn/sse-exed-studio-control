import { Plus } from "lucide-react";

import styles from "../AudioWorkspace.module.css";
import { formatAudioDb } from "../audioFormatting";
import type { AudioChannelEntry, AudioMixTargetEntry, AudioSnapshotEntry } from "../../shellData";

const SNAPSHOT_THUMB_BAR_COUNT = 12;
const SNAPSHOT_PLACEHOLDER_LEVELS = [0.26, 0.2, 0.32, 0.18, 0.28, 0.22, 0.3, 0.16, 0.24, 0.2, 0.28, 0.18];

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
}) {
  if (!snapshot.contents) return [];
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
  return [...channelDiffs, ...mixTargetDiffs].slice(0, 2);
}

export function AudioSnapshotDeck({
  actionsAllowed,
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

          return (
            <div
              className={styles.snapshotTile}
              data-current={snapshot.lastRecalled}
              data-flash={recentlyRecalledSnapshotId === snapshot.id}
              data-snapshot-slot={index + 1}
              data-slot-state="populated"
              data-testid={`audio-snapshot-${snapshot.id}`}
              key={snapshot.id}
            >
              <button
                className={styles.snapshotRecallSurface}
                disabled={!actionsAllowed || busyAction === `audio-snapshot-${snapshot.id}`}
                onClick={() => onRecallSnapshot(snapshot.id)}
                type="button"
              >
                <span className={styles.snapshotSlot}>Slot {snapshot.oscIndex + 1}</span>
                <span className={styles.snapshotName}>{snapshot.name}</span>
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
                <span className={styles.snapshotMeta}>
                  {snapshot.lastRecalledAt ? formatSnapshotTime(snapshot.lastRecalledAt) : "-"}
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
                        previewDiffs.length > 0 ? (
                          previewDiffs.map((diff) => (
                            <small className={styles.snapshotPreviewLine} key={`${snapshot.id}-${diff.label}`}>
                              <span>{diff.label}</span>
                              <strong>
                                {formatAudioDb(diff.before)} -&gt; {formatAudioDb(diff.after)}
                              </strong>
                            </small>
                          ))
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
                        previewDiffs.length > 0 ? (
                          previewDiffs.map((diff) => (
                            <small className={styles.snapshotPreviewLine} key={`${snapshot.id}-${diff.label}`}>
                              <span>{diff.label}</span>
                              <strong>
                                {formatAudioDb(diff.before)} -&gt; {formatAudioDb(diff.after)}
                              </strong>
                            </small>
                          ))
                        ) : (
                          <small>No diff from current mix</small>
                        )
                      ) : null}
                    </>
                  )}
                </span>
              </button>
              <span className={styles.snapshotTileActions}>
                <button
                  disabled={!actionsAllowed || busyAction === `audio-snapshot-save-${snapshot.id}`}
                  onClick={() => onSaveSnapshot(snapshot.id)}
                  type="button"
                >
                  Save
                </button>
                <button
                  disabled={!actionsAllowed || busyAction === `audio-snapshot-rename-${snapshot.id}`}
                  onClick={() => onRenameSnapshot(snapshot.id, snapshot.name)}
                  type="button"
                >
                  Rename
                </button>
                <button
                  disabled={!actionsAllowed || busyAction === `audio-snapshot-delete-${snapshot.id}`}
                  onClick={() => onDeleteSnapshot(snapshot.id, snapshot.name)}
                  type="button"
                >
                  Delete
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
