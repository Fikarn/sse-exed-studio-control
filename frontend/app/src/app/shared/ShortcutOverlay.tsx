import { Button, Surface } from "@sse/design-system";

import styles from "../OperatorShell.module.css";

export function ShortcutOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className={styles.overlay} role="presentation">
      <Surface
        aria-labelledby="shortcut-dialog-title"
        aria-modal="true"
        className={styles.dialog}
        padding="lg"
        role="dialog"
        tone="raised"
      >
        <div className={styles.dialogTitle} id="shortcut-dialog-title">
          Keyboard model
        </div>
        <div className={styles.shortcutList}>
          <div className={styles.shortcutItem}>
            <span className={styles.shortcutKeys}>Shift + S</span>
            <span>Enter Setup, or toggle Runner and Support inside Setup</span>
          </div>
          <div className={styles.shortcutItem}>
            <span className={styles.shortcutKeys}>Cmd/Ctrl + 1-4</span>
            <span>Switch workspaces</span>
          </div>
          <div className={styles.shortcutItem}>
            <span className={styles.shortcutKeys}>Tab / Shift + Tab</span>
            <span>Move between runner steps</span>
          </div>
          <div className={styles.shortcutItem}>
            <span className={styles.shortcutKeys}>Enter</span>
            <span>Invoke the runner footer primary action</span>
          </div>
          <div className={styles.shortcutItem}>
            <span className={styles.shortcutKeys}>J / K</span>
            <span>Move through binding details in Map and Verify</span>
          </div>
          <div className={styles.shortcutItem}>
            <span className={styles.shortcutKeys}>Space</span>
            <span>Fire the next lighting cue from the cue rail</span>
          </div>
          <div className={styles.shortcutItem}>
            <span className={styles.shortcutKeys}>A / [ ] / 1-8 / Shift + 1-8</span>
            <span>Open Audio, page banks, select strips, and recall snapshots</span>
          </div>
          <div className={styles.shortcutItem}>
            <span className={styles.shortcutKeys}>← / → / M / S / V</span>
            <span>Move mix targets, mute or solo the selected strip, and change Audio density</span>
          </div>
          <div className={styles.shortcutItem}>
            <span className={styles.shortcutKeys}>Shift + B / Shift + T</span>
            <span>Toggle Planning between Board and Timeline</span>
          </div>
          <div className={styles.shortcutItem}>
            <span className={styles.shortcutKeys}>[ / ] / 0</span>
            <span>Move the Planning time window or snap the view back to now</span>
          </div>
          <div className={styles.shortcutItem}>
            <span className={styles.shortcutKeys}>Shift + [ / ] / ← / →</span>
            <span>Change the Planning day or nudge the selected schedule block</span>
          </div>
          <div className={styles.shortcutItem}>
            <span className={styles.shortcutKeys}>0-4</span>
            <span>Filter Planning board columns, or jump pages while mapping Setup bindings</span>
          </div>
          <div className={styles.shortcutItem}>
            <span className={styles.shortcutKeys}>1-4 (Setup Map)</span>
            <span>Jump to a page in Map</span>
          </div>
          <div className={styles.shortcutItem}>
            <span className={styles.shortcutKeys}>Cmd/Ctrl + Shift + R</span>
            <span>Open restart confirmation</span>
          </div>
          <div className={styles.shortcutItem}>
            <span className={styles.shortcutKeys}>?</span>
            <span>Toggle shortcut guide</span>
          </div>
          <div className={styles.shortcutItem}>
            <span className={styles.shortcutKeys}>Esc</span>
            <span>Close the current shell overlay</span>
          </div>
        </div>
        <div className={styles.dialogActions}>
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </div>
      </Surface>
    </div>
  );
}
