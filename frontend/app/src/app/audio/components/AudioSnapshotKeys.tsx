import { ArmKey, Section, Tooltip } from "@sse/design-system";

import styles from "./AudioSnapshotKeys.module.css";
import { audioSnapshotLoadKey } from "../audioArming";
import { AUDIO_ARM_TIMEOUT_MS } from "../audioConstants";
import type { AudioConsoleSnapshotEntry } from "../../shellData";

// The eight snapshot slots as arm-then-apply keys in the cluster. One press
// arms and the key itself carries the one armed form (Burgundy, LOAD?, the
// countdown); a second press applies (the Console's dwell and window).
// 2026-10-01 (the owner's decision, after the studio walk): the slots are
// TotalMix's own eight, under the names TotalMix saved. The app keeps no
// snapshots, so nothing here captures, saves, renames or deletes one, and no
// key previews what a load would change: a press twice loads the slot in
// TotalMix, and the key says what TotalMix reports of it. Visual overhaul, the
// Console: where the names come from is the head's tooltip, and a slot with
// no name of its own is printed quieter.

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
  /** Where the names come from; the head says nothing more when null. */
  source: string | null;
}

// What the key says of a slot: TotalMix's own word while it holds the slot's
// mix, nothing while it does not or has not said.
function slotStateWord(state: AudioConsoleSnapshotEntry["state"]) {
  return state === "active" || state === "changed" ? state : "";
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
    <Section
      title="Snapshots"
      detail={
        source ? (
          <Tooltip content={<span data-testid="audio-snapshot-source">{source}</span>} placement="right">
            <span className={styles.detail}>in TotalMix</span>
          </Tooltip>
        ) : (
          "in TotalMix"
        )
      }
      className={styles.deck}
      testId="audio-snapshot-deck"
    >
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
              data-named={entry.named}
              data-slot-state={entry.state}
              data-snapshot-slot={entry.slot}
              data-testid={`audio-snapshot-slot-${entry.slot}`}
            >
              <ArmKey
                armed={armed}
                armedWord="LOAD?"
                timeoutMs={AUDIO_ARM_TIMEOUT_MS}
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
                {/* One column: the slot's number and TotalMix's word on the
                    first line, the name under them. Armed, the LOAD? tag
                    stands before the name and the first line goes, so the key
                    keeps its size and nothing in the grid moves. */}
                <span className={styles.slotBody}>
                  {armed ? null : (
                    <span className={styles.slotHead}>
                      <span className={styles.slotNumber} aria-hidden="true">
                        {entry.slot}
                      </span>
                      <span
                        className={styles.slotState}
                        data-state={entry.state}
                        data-testid={`audio-snapshot-state-${entry.slot}`}
                      >
                        {slotStateWord(entry.state)}
                      </span>
                    </span>
                  )}
                  <span className={styles.slotName} data-testid={`audio-snapshot-name-${entry.slot}`}>
                    {entry.name}
                  </span>
                </span>
              </ArmKey>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
