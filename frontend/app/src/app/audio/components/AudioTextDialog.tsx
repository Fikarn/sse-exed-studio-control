import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button, Dialog } from "@sse/design-system";

import styles from "./AudioDialog.module.css";

export function AudioTextDialog({
  busy = false,
  confirmLabel = "Save",
  fieldLabel,
  initialValue,
  onCancel,
  onConfirm,
  title,
}: {
  busy?: boolean;
  confirmLabel?: string;
  fieldLabel: string;
  initialValue: string;
  onCancel: () => void;
  onConfirm: (value: string) => void;
  title: string;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState(initialValue);
  const trimmed = draft.trim();
  const canSubmit = trimmed.length > 0 && trimmed !== initialValue.trim() && !busy;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    onConfirm(trimmed);
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
            onClick={() => onConfirm(trimmed)}
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
        <input
          id={inputId}
          ref={inputRef}
          autoComplete="off"
          maxLength={50}
          spellCheck={false}
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
      </form>
    </Dialog>
  );
}
