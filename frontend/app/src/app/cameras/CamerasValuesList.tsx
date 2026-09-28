import { useEffect, useRef } from "react";

import { Key } from "@sse/design-system";
import type { CameraSnapshot } from "@sse/engine-client";

import type { ChoiceRowView } from "./camerasModel";
import styles from "./CamerasValuesList.module.css";

// The values a camera allows for one setting, opened from its readout (board
// 2's ISO list): one press sets the value, the list closes and the camera
// answers (D11). It floats beside the plate, at the drawer's level. Esc and
// Close leave it without a change, and the focus goes back where it was.

export interface CamerasValuesListProps {
  camera: CameraSnapshot;
  row: ChoiceRowView;
  onPick: (value: string) => void;
  onClose: () => void;
}

export function CamerasValuesList({ camera, row, onPick, onClose }: CamerasValuesListProps) {
  const panel = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const current = panel.current?.querySelector<HTMLElement>("[aria-pressed='true']");
    (current ?? panel.current)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      before?.focus();
    };
  }, []);

  return (
    <aside
      ref={panel}
      className={styles.list}
      data-level="float"
      data-material="plate"
      role="dialog"
      aria-modal="false"
      aria-label={`${row.label} values ${camera.tag} allows`}
      tabIndex={-1}
      data-testid="cameras-values-list"
    >
      <header className={styles.head}>
        <span className={styles.title}>
          <b>{row.label}</b> · {camera.tag}
        </span>
        <span className={styles.detail}>the values {camera.tag} allows</span>
      </header>
      <div className={styles.grid} data-well="" role="group" aria-label={row.label}>
        {row.choice.options.map((option) => {
          const current = option === row.choice.value;
          return (
            <Key
              key={option}
              mode="segmented"
              cap={option}
              take
              engaged={current}
              aria-pressed={current}
              testId={`cameras-value-${option}`}
              onClick={() => onPick(option)}
            />
          );
        })}
      </div>
      <footer className={styles.foot}>
        <span className={styles.detail}>One press sets it; the list closes and {camera.tag} answers.</span>
        <Key size="small" testId="cameras-values-close" onClick={onClose}>
          Close
        </Key>
      </footer>
    </aside>
  );
}
