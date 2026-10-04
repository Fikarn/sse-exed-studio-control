import { useId, useState, type FormEvent, type RefObject } from "react";

import { Key, Popover } from "@sse/design-system";
import type { CameraSnapshot } from "@sse/engine-client";

import type { LevelRowView } from "./camerasModel";
import styles from "./CamerasTypedEntry.module.css";

// A level typed in (white balance, tint), opened from its readout. The visual
// overhaul (2026-10-05): a popover with a field beside the plate, not a
// dialog, so the pictures stay drawn while a value is typed (a dialog hides
// every picture). Enter or Set value sets it, snapped to the camera's step
// and held to its range, as the typed entry everywhere does; a press outside
// or Esc closes it without a change.

export interface CamerasTypedEntryProps {
  camera: CameraSnapshot;
  row: LevelRowView;
  /** The row it stands beside. */
  anchor: RefObject<HTMLElement | null>;
  /** The readout that opened it: a press on it closes the entry, and a press anywhere else too. */
  opener: RefObject<HTMLElement | null>;
  onSet: (value: number) => void;
  onClose: () => void;
}

/** The typed value on the camera's step, inside its range (`NumberEntryDialog`'s rule). */
export function snapToLevel(value: number, min: number, max: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return Math.max(min, Math.min(max, value));
  return Math.max(min, Math.min(max, Number((Math.round((value - min) / step) * step + min).toFixed(5))));
}

export function CamerasTypedEntry({ camera, row, anchor, opener, onSet, onClose }: CamerasTypedEntryProps) {
  const id = useId();
  const { level } = row;
  const [draft, setDraft] = useState(() => String(level.value ?? level.min));
  const parsed = Number(draft);
  const valid = draft.trim() !== "" && Number.isFinite(parsed) && parsed >= level.min && parsed <= level.max;
  const unit = level.unit ? ` ${level.unit}` : "";

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!valid) return;
    onSet(snapToLevel(parsed, level.min, level.max, level.step));
  };

  return (
    <Popover
      open
      anchor={anchor.current}
      onClose={onClose}
      title={`${row.label} · ${camera.tag}`}
      placement="left-start"
      width={407}
      ignoreOutside={[opener]}
      initialFocus="first"
      testId="cameras-typed-entry"
    >
      {/* The value is snapped to the step and held to the range here, so the
          browser's own check (which refuses 4320 on a step of 50) stays out. */}
      <form className={styles.form} noValidate onSubmit={submit}>
        <label className={styles.label} htmlFor={id}>
          {row.label}
        </label>
        <div className={styles.field} data-well="">
          <input
            id={id}
            className={styles.input}
            type="number"
            inputMode="decimal"
            min={level.min}
            max={level.max}
            step={level.step}
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onFocus={(event) => event.currentTarget.select()}
          />
          {level.unit ? <span className={styles.unit}>{level.unit}</span> : null}
        </div>
        <span className={styles.range}>
          {level.min} to {level.max}
          {unit}, in steps of {level.step}
        </span>
        <Key
          type="submit"
          mode="primary"
          locked={!valid}
          reason={valid ? undefined : `${level.min} to ${level.max}${unit}`}
          testId="cameras-typed-set"
        >
          Set value
        </Key>
      </form>
    </Popover>
  );
}
