import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { Button, Dialog } from "@sse/design-system";

import styles from "./RenameDialog.module.css";

export interface RenameDialogProps {
  /** Dialog title — verb form, e.g. "Rename scene" or "New group". */
  title: string;
  /** Current value to pre-fill (for renames). Empty string for creates. */
  initialValue: string;
  /** Label rendered above the text input. */
  fieldLabel: string;
  /** Placeholder when the input is empty. */
  placeholder?: string;
  /** Submit button label. Defaults to "Save". */
  confirmLabel?: string;
  /** Cancel button label. Defaults to "Cancel". */
  cancelLabel?: string;
  /** Disable the submit button while a request is in flight. */
  busy?: boolean;
  /** Called with the trimmed name. Empty submissions are blocked. */
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function RenameDialog({
  title,
  initialValue,
  fieldLabel,
  placeholder,
  confirmLabel = "Save",
  cancelLabel = "Cancel",
  busy = false,
  onConfirm,
  onCancel,
}: RenameDialogProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState(initialValue);

  useEffect(() => {
    // Select the existing text on mount so renames are one-keystroke.
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  const trimmed = draft.trim();
  const canSubmit = trimmed.length > 0 && !busy;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
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
            {cancelLabel}
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
      <form onSubmit={handleSubmit} className={styles.form}>
        <label htmlFor={inputId} className={styles.label}>
          {fieldLabel}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          className={styles.input}
          type="text"
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.currentTarget.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </form>
    </Dialog>
  );
}
