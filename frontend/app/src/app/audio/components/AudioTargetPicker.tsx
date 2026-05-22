import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

import styles from "./AudioTargetPicker.module.css";
import { formatAudioDb, formatAudioRole } from "../audioFormatting";
import type { AudioMixTargetEntry } from "../../shellData";

export function AudioTargetPicker({
  mixTargets,
  onSelectMixTarget,
  selectionLabel,
  selectedMixTargetId,
}: {
  mixTargets: AudioMixTargetEntry[];
  selectedMixTargetId: string | null;
  selectionLabel?: string;
  onSelectMixTarget: (mixTargetId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedMixTarget = mixTargets.find((entry) => entry.id === selectedMixTargetId) ?? mixTargets[0] ?? null;

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.targetPicker} ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`${selectedMixTarget?.name ?? "No output"} selected output target`}
        className={styles.targetPickerButton}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className={styles.targetPickerSwatch} data-role={selectedMixTarget?.role ?? "main-out"} />
        <strong>{selectedMixTarget?.name ?? "No output"}</strong>
        {selectionLabel ? <small>{selectionLabel}</small> : null}
        <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" />
      </button>

      {open ? (
        <div aria-label="Audio output targets" className={styles.targetPickerMenu} role="menu">
          {mixTargets.map((mixTarget) => (
            <button
              className={styles.targetPickerItem}
              data-role={mixTarget.role}
              data-selected={mixTarget.id === selectedMixTarget?.id}
              key={mixTarget.id}
              onClick={() => {
                onSelectMixTarget(mixTarget.id);
                setOpen(false);
              }}
              role="menuitem"
              type="button"
            >
              <span className={styles.targetPickerSwatch} data-role={mixTarget.role} />
              <span>
                <strong>{mixTarget.name}</strong>
                <small>
                  {formatAudioRole(mixTarget.role)} · {mixTarget.shortName}
                </small>
              </span>
              <em>{formatAudioDb(mixTarget.volume)}</em>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
