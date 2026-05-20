/**
 * Shared types for the audio arm-then-apply safety pattern.
 *
 * Operator actions that can change the desk irreversibly (48V phantom,
 * snapshot recall, snapshot overwrite) arm first and apply only when the same
 * action target is activated a second time inside the timeout window. The
 * shape lives here so the workspace, signal canvas and snapshot deck can read
 * the same definition without crossing component boundaries.
 */
export type AudioArmedActionKind = "phantom" | "snapshot-recall" | "snapshot-save";

export interface AudioArmedAction {
  // Why: monotonic `performance.now()` reading at the moment the action was
  // armed. The CSS arm countdown reads `armedAt + timeoutMs - now` only as a
  // fallback if needed; the canonical countdown is the CSS animation keyed by
  // `timeoutMs`. Stored here so the UI can derive remaining time accurately
  // when a tile mounts mid-window.
  armedAt: number;
  key: string;
  label: string;
  targetId: string;
  targetKind: AudioArmedActionKind;
  timeoutMs: number;
}
