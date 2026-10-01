import { ArmKey, Section } from "@sse/design-system";

import styles from "./AudioSnapshotKeys.module.css";
import { audioSnapshotLoadKey } from "../audioArming";
import { AUDIO_ARM_TIMEOUT_MS } from "../audioConstants";
import type { AudioConsoleSnapshotEntry } from "../../shellData";

// Visual overhaul A, Slice 4: the eight snapshot slots as arm-then-apply keys
// in the cluster. One press arms and the key itself carries the tag and the
// countdown; a second press applies (the Console's dwell and window).
// 2026-10-01 (the owner's decision, after the studio walk): the slots are
// TotalMix's own eight, under the names TotalMix saved. The app keeps no
// snapshots, so nothing here captures, saves, renames or deletes one, and no
// key previews what a load would change: a press twice loads the slot in
// TotalMix, and the card says what TotalMix reports of it.

export interface AudioSnapshotKeysProps {
  /** `capabilities.canRecallConsoleSnapshot`: a load is a console write. */
  actionsAllowed: boolean;
  /**
   * Why the slots are locked, in the desk's own words. Slice 8 (system §9):
   * the keys used to name the audio probe whatever the real cause was.
   */
  lockedReason?: string;
  armedActionKey: string | null;
  busyAction: string | null;
  onLoadSnapshot: (slot: number) => void;
  slots: readonly AudioConsoleSnapshotEntry[];
  /** Where the names come from; nothing under the grid when null. */
  source: string | null;
}

// What the card says of a slot: TotalMix's own word while it holds the slot's
// mix, a dash while it does not or has not said.
function slotStateWord(state: AudioConsoleSnapshotEntry["state"]) {
  return state === "active" || state === "changed" ? state : "–";
}

export function AudioSnapshotKeys({
  actionsAllowed,
  lockedReason,
  armedActionKey,
  busyAction,
  onLoadSnapshot,
  slots,
  source,
}: AudioSnapshotKeysProps) {
  return (
    <Section title="Snapshots" detail="in TotalMix" className={styles.deck} testId="audio-snapshot-deck">
      <div className={styles.grid}>
        {slots.map((entry) => {
          const armed = armedActionKey === audioSnapshotLoadKey(entry.slot);
          const current = entry.state === "active" || entry.state === "changed";
          return (
            <div
              key={entry.slot}
              className={styles.slot}
              data-armed={armed}
              data-current={current}
              data-slot-state={entry.state}
              data-snapshot-slot={entry.slot}
              data-testid={`audio-snapshot-slot-${entry.slot}`}
            >
              <ArmKey
                armed={armed}
                armedWord="LOAD?"
                timeoutMs={AUDIO_ARM_TIMEOUT_MS}
                cap={String(entry.slot)}
                className={styles.slotKey}
                locked={!actionsAllowed}
                reason={actionsAllowed ? undefined : (lockedReason ?? "The snapshot slots are locked.")}
                take
                testId={`audio-snapshot-load-${entry.slot}`}
                aria-label={armed ? `Confirm load of ${entry.name} in TotalMix` : `Load ${entry.name} in TotalMix`}
                title="Press twice to load in TotalMix"
                disabled={busyAction === `audio-snapshot-load-${entry.slot}`}
                onClick={() => onLoadSnapshot(entry.slot)}
              >
                {/* The key's label is one column: the name on its own line so it
                    is readable at a glance, then what TotalMix reports of the
                    slot. Armed, the state line gives way to the LOAD? tag
                    before the name, and the key's fixed height keeps it the
                    same size. */}
                <span className={styles.slotBody}>
                  <span className={styles.slotName} data-testid={`audio-snapshot-name-${entry.slot}`}>
                    {entry.name}
                  </span>
                  {armed ? null : (
                    <span
                      className={styles.slotState}
                      data-state={entry.state}
                      data-testid={`audio-snapshot-state-${entry.slot}`}
                    >
                      {slotStateWord(entry.state)}
                    </span>
                  )}
                </span>
              </ArmKey>
            </div>
          );
        })}
      </div>
      {source ? (
        <span className={styles.source} data-testid="audio-snapshot-source">
          {source}
        </span>
      ) : null}
    </Section>
  );
}
