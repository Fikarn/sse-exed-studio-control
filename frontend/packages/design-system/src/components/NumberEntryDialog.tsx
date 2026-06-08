import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { Button } from "./Button";
import { Dialog } from "./Dialog";
import styles from "./NumberEntryDialog.module.css";

export interface NumberEntryDialogProps {
  /** Disables the form while a commit is in flight. */
  busy?: boolean;
  /** Confirm-button label. Defaults to "Set". */
  confirmLabel?: string;
  /** Visible label for the number field. */
  fieldLabel: string;
  /** Value the field opens with. */
  initialValue: number;
  /** Inclusive bounds. */
  max: number;
  min: number;
  /** Fired on Escape / Cancel / backdrop dismiss. */
  onCancel: () => void;
  /** Fired with the snapped, clamped value on confirm. */
  onConfirm: (value: number) => void;
  /** Field step. Typed values snap to it. Defaults to 1. */
  step?: number;
  /** Optional unit shown after the field (e.g. "%", "K", "dB"). */
  suffix?: string;
  /** Dialog title (e.g. "Set Fixture intensity"). */
  title: string;
}

/**
 * Shared typed-numeric-entry dialog. Opened from a slider's double-click / Enter
 * (the consumer owns the open state; see ScrubSlider / AudioSliderControl
 * `onRequestNumericValue`). Snaps + clamps the typed value to the field's step
 * before confirming, so an integer-step field never emits a fractional value.
 *
 * Styled on global DS tokens, so it themes correctly anywhere it portals
 * (the DS `Dialog` portals to `document.body`, outside any workspace shell).
 */
export function NumberEntryDialog({
  busy = false,
  confirmLabel = "Set",
  fieldLabel,
  initialValue,
  max,
  min,
  onCancel,
  onConfirm,
  step = 1,
  suffix,
  title,
}: NumberEntryDialogProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState(() => (Number.isFinite(initialValue) ? String(initialValue) : String(min)));
  const parsed = Number(draft);
  const valid = Number.isFinite(parsed) && parsed >= min && parsed <= max;
  const canSubmit = valid && !busy;
  // Snap the typed value to the field's step so e.g. an integer-step field never
  // emits a fractional value. Clamp in case rounding nudges past an edge.
  const commitValue =
    Number.isFinite(parsed) && Number.isFinite(step) && step > 0
      ? Math.max(min, Math.min(max, Number((Math.round((parsed - min) / step) * step + min).toFixed(5))))
      : parsed;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    onConfirm(commitValue);
  };

  return (
    <Dialog
      title={title}
      onClose={onCancel}
      actions={
        <>
          <Button onClick={onCancel} disabled={busy} variant="ghost" size="compact">
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm(commitValue)}
            disabled={!canSubmit}
            loading={busy}
            variant="primary"
            size="compact"
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form className={styles.form} onSubmit={submit}>
        <label htmlFor={inputId}>{fieldLabel}</label>
        <div className={styles.numberField}>
          <input
            id={inputId}
            ref={inputRef}
            inputMode="decimal"
            max={max}
            min={min}
            step={step}
            type="number"
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
          />
          {suffix ? <span>{suffix}</span> : null}
        </div>
        <small>
          {min} to {max}
        </small>
      </form>
    </Dialog>
  );
}
