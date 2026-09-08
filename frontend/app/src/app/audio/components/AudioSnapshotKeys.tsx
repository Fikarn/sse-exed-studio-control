import { Pencil, Plus, Save, Trash2 } from "lucide-react";
import { ArmKey, Key, Section } from "@sse/design-system";

import styles from "./AudioSnapshotKeys.module.css";
import { AUDIO_ARM_TIMEOUT_MS } from "../audioConstants";
import { formatAudioDb, formatAudioRecallTime } from "../audioFormatting";
import { SNAPSHOT_PLACEHOLDER_LEVELS, snapshotPreviewDiffs, snapshotThumbLevels } from "../audioSnapshotPreview";
import type { AudioChannelEntry, AudioMixTargetEntry, AudioSnapshotEntry } from "../../shellData";

// Visual overhaul A, Slice 4: the eight snapshot slots as arm-then-apply keys
// in the cluster. One press arms and the key itself carries the tag and the
// countdown; a second press applies (the Console's dwell and window). The
// slot keeps the mix-shape thumbnail, the "what changes if you load this"
// preview and the save / rename / delete keys the retired deck carried.

export interface AudioSnapshotKeysProps {
  actionsAllowed: boolean;
  armedActionKey: string | null;
  busyAction: string | null;
  channels: readonly AudioChannelEntry[];
  mixTargets: readonly AudioMixTargetEntry[];
  onCaptureSnapshot: () => void;
  onDeleteSnapshot: (snapshotId: string, snapshotName: string) => void;
  onRecallSnapshot: (snapshotId: string) => void;
  onRenameSnapshot: (snapshotId: string, snapshotName: string) => void;
  onSaveSnapshot: (snapshotId: string) => void;
  recentlyRecalledSnapshotId: string | null;
  selectedMixTargetId: string | null;
  snapshots: readonly AudioSnapshotEntry[];
}

export function AudioSnapshotKeys({
  actionsAllowed,
  armedActionKey,
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
}: AudioSnapshotKeysProps) {
  const slots = Array.from({ length: 8 }, (_, index) => snapshots.find((entry) => entry.oscIndex === index) ?? null);
  const currentSnapshot = snapshots.find((entry) => entry.lastRecalled) ?? null;

  return (
    <Section
      title="Snapshots"
      detail="Shift 1–8"
      className={styles.deck}
      testId="audio-snapshot-deck"
      actions={
        <Key
          size="small"
          testId="audio-snapshot-capture"
          aria-label="New snapshot"
          disabled={!actionsAllowed || busyAction === "audio-snapshot-capture"}
          onClick={onCaptureSnapshot}
          title={actionsAllowed ? "Capture the current mix into the first empty slot" : "Snapshot capture unavailable"}
        >
          <Plus size={13} strokeWidth={2} aria-hidden="true" />
          Capture
        </Key>
      }
    >
      <span className={styles.visuallyHidden} data-testid="audio-toolbar-current-snapshot">
        {currentSnapshot ? `Recalled ${currentSnapshot.name}` : "No recall yet"}
      </span>
      <div className={styles.grid}>
        {slots.map((snapshot, index) => {
          if (!snapshot) {
            return (
              <div
                key={`empty-${index}`}
                className={styles.empty}
                data-slot-state="empty"
                data-snapshot-slot={index + 1}
                data-testid={`audio-snapshot-empty-${index + 1}`}
              >
                <span className={styles.emptySlot}>{index + 1}</span>
                <span className={styles.emptyWord}>Empty</span>
              </div>
            );
          }
          const recallArmed = armedActionKey === `snapshot-recall:${snapshot.id}`;
          const saveArmed = armedActionKey === `snapshot-save:${snapshot.id}`;
          const hasContents = snapshot.preview.hasContents;
          const thumbLevels = snapshotThumbLevels(snapshot, selectedMixTargetId);
          const previewDiffs = snapshotPreviewDiffs({ channels, mixTargets, selectedMixTargetId, snapshot });
          const recallTime = formatAudioRecallTime(snapshot.lastRecalledAt);
          return (
            <div
              key={snapshot.id}
              className={styles.slot}
              data-armed={recallArmed}
              data-current={snapshot.lastRecalled}
              data-flash={recentlyRecalledSnapshotId === snapshot.id}
              data-slot-state="populated"
              data-snapshot-slot={index + 1}
              data-testid={`audio-snapshot-${snapshot.id}`}
            >
              <ArmKey
                armed={recallArmed}
                timeoutMs={AUDIO_ARM_TIMEOUT_MS}
                cap={String(index + 1)}
                className={styles.slotKey}
                locked={!actionsAllowed}
                reason={actionsAllowed ? undefined : "Console controls stay locked until the audio probe passes."}
                take
                testId={`audio-snapshot-recall-${snapshot.id}`}
                aria-label={`${recallArmed ? "Apply recall" : "Arm recall"} ${snapshot.name}`}
                disabled={busyAction === `audio-snapshot-${snapshot.id}`}
                onClick={() => onRecallSnapshot(snapshot.id)}
              >
                {/* The key's label is one column: the name on its own line so it
                    is readable at a glance, the mix-shape thumbnail under it,
                    then when the slot was last recalled. */}
                <span className={styles.slotBody}>
                  <span className={styles.slotName} data-testid={`audio-snapshot-name-${snapshot.id}`}>
                    {snapshot.name}
                  </span>
                  <span
                    className={styles.slotThumb}
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
                  <span className={styles.slotMeta} data-testid={`audio-snapshot-meta-${snapshot.id}`}>
                    {recallTime
                      ? snapshot.lastRecalled
                        ? `current · ${recallTime}`
                        : `recalled ${recallTime}`
                      : "not recalled yet"}
                  </span>
                </span>
              </ArmKey>

              {/* What this slot holds against the mix on the desk right now —
                  the deck's preview, kept on the key. */}
              <span className={styles.slotPreview} data-level="float" data-material="plate">
                <strong>{snapshot.lastRecalled ? "Currently loaded" : "If you load this"}</strong>
                {snapshot.lastRecalled ? null : (
                  <small>
                    {hasContents
                      ? `${snapshot.preview.changedChannels.length + snapshot.preview.changedMixTargets.length} changes`
                      : "Console slot recall"}
                  </small>
                )}
                <small>
                  {hasContents
                    ? `${snapshot.preview.channelCount} sources saved`
                    : snapshot.lastRecalled
                      ? "Console slot only"
                      : "No captured contents"}
                </small>
                {hasContents ? (
                  previewDiffs.total > 0 ? (
                    <>
                      {previewDiffs.shown.map((diff) => (
                        <small className={styles.slotPreviewLine} key={`${snapshot.id}-${diff.label}`}>
                          <span>{diff.label}</span>
                          <strong>
                            {formatAudioDb(diff.before)} -&gt; {formatAudioDb(diff.after)}
                          </strong>
                        </small>
                      ))}
                      {previewDiffs.total > previewDiffs.shown.length ? (
                        <small
                          className={styles.slotPreviewOverflow}
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
                <span className={styles.slotActions} data-testid={`audio-snapshot-actions-${snapshot.id}`}>
                  <Key
                    size="small"
                    className={styles.slotAction}
                    data-armed={saveArmed ? "true" : "false"}
                    disabled={!actionsAllowed || busyAction === `audio-snapshot-save-${snapshot.id}`}
                    aria-label={`${saveArmed ? "Apply save" : "Arm save"} ${snapshot.name}`}
                    onClick={() => onSaveSnapshot(snapshot.id)}
                  >
                    <Save size={13} strokeWidth={1.8} aria-hidden="true" />
                  </Key>
                  <Key
                    size="small"
                    className={styles.slotAction}
                    disabled={!actionsAllowed || busyAction === `audio-snapshot-rename-${snapshot.id}`}
                    aria-label={`Rename ${snapshot.name}`}
                    onClick={() => onRenameSnapshot(snapshot.id, snapshot.name)}
                  >
                    <Pencil size={13} strokeWidth={1.8} aria-hidden="true" />
                  </Key>
                  <Key
                    size="small"
                    className={styles.slotAction}
                    disabled={!actionsAllowed || busyAction === `audio-snapshot-delete-${snapshot.id}`}
                    aria-label={`Delete ${snapshot.name}`}
                    onClick={() => onDeleteSnapshot(snapshot.id, snapshot.name)}
                  >
                    <Trash2 size={13} strokeWidth={1.8} aria-hidden="true" />
                  </Key>
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
