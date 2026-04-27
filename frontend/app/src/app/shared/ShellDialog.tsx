import { Button, Surface } from "@sse/design-system";

import styles from "../OperatorShell.module.css";

export function ShellDialog({
  body,
  confirmLabel,
  onCancel,
  onConfirm,
  title,
}: {
  body: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}) {
  return (
    <div className={styles.overlay} role="presentation">
      <Surface
        aria-labelledby="shell-dialog-title"
        aria-modal="true"
        className={styles.dialog}
        padding="lg"
        role="dialog"
        tone="raised"
      >
        <div className={styles.dialogTitle} id="shell-dialog-title">
          {title}
        </div>
        <p className={styles.dialogBody}>{body}</p>
        <div className={styles.dialogActions}>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </Surface>
    </div>
  );
}
