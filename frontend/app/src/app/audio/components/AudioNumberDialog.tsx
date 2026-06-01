import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button, Dialog } from "@sse/design-system";

import styles from "./AudioDialog.module.css";

export function AudioNumberDialog({
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
}: {
  busy?: boolean;
  confirmLabel?: string;
  fieldLabel: string;
  initialValue: number;
  max: number;
  min: number;
  onCancel: () => void;
  onConfirm: (value: number) => void;
  step?: number;
  suffix?: string;
  title: string;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState(() => (Number.isFinite(initialValue) ? String(initialValue) : String(min)));
  const parsed = Number(draft);
  const valid = Number.isFinite(parsed) && parsed >= min && parsed <= max;
  const canSubmit = valid && !busy;
  // Snap the typed value to the field's step so e.g. an integer-step gain field
  // never emits a fractional value (the engine rejects non-integer preamp gain).
  // Clamp in case rounding nudges past an edge.
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
      <form className={styles.audioDialogForm} onSubmit={submit}>
        <label htmlFor={inputId}>{fieldLabel}</label>
        <div className={styles.audioDialogNumberField}>
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
