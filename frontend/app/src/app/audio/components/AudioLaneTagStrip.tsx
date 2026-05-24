import styles from "./AudioLaneTagStrip.module.css";

/**
 * Slot for the vertical space inside a channel lane where Inputs render the
 * skeuomorphic preamp module. Playback strips have no preamp, so the same
 * space previously read as "hollow" — three findings in the Phase 3 visual
 * review traced back to that gap (E17/E18 in
 * docs/plans/audio-ui-phase-3-followup-fixes.md).
 *
 * The strip renders two compact rows of group/format identity facts (e.g.
 * `BED · STEREO`, `FX · MONO`) so the operator can name the source without
 * reading the channel-name typography. CSS-only component; the group color
 * comes from the existing `--audio-group-*` token family via the lane's
 * `data-group` ancestor.
 */
export function AudioLaneTagStrip({ group, stereo }: { group: string; stereo: boolean }) {
  return (
    <div className={styles.laneTagStrip} data-testid="audio-lane-tag-strip">
      <span className={styles.laneTagGroup}>{group}</span>
      <span className={styles.laneTagFormat}>{stereo ? "STEREO" : "MONO"}</span>
    </div>
  );
}
