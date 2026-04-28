import type { ReactNode } from "react";

import { Button } from "./Button";
import { Dialog } from "./Dialog";

export interface ConfirmDialogProps {
  title: ReactNode;
  body?: ReactNode;
  /** Defaults to "Confirm". */
  confirmLabel?: string;
  /** Defaults to "Cancel". */
  cancelLabel?: string;
  /** Renders the confirm button as a danger variant for destructive ops. */
  danger?: boolean;
  /** Disables both buttons (e.g. while a confirm is in flight). */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog
      title={title}
      body={body}
      onClose={onCancel}
      actions={
        <>
          <Button onClick={onCancel} disabled={busy} variant="ghost" size="compact">
            {cancelLabel}
          </Button>
          <Button onClick={onConfirm} disabled={busy} variant={danger ? "danger" : "primary"} size="compact">
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
