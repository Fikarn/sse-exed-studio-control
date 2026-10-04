import { useRef, useState, type KeyboardEvent, type RefObject } from "react";

import { Popover } from "@sse/design-system";
import type { CameraSnapshot } from "@sse/engine-client";

import type { ChoiceRowView } from "./camerasModel";
import styles from "./CamerasValuesList.module.css";

// The values a camera allows for one setting, opened from its readout (board
// 2's ISO list): one press sets the value, the list closes and the camera
// answers (D11). The visual overhaul (2026-10-05): a popover beside the plate
// holding a `listbox`, never a dialog, so the pictures stay drawn while it is
// open (it is one hole in their layer). A press outside or Esc closes it
// without a change, and the focus goes back to the readout. The value the
// camera reports is the selected option.

/** Options a row: the list is laid out as a grid, and the arrows move over it. */
const COLUMNS = 5;

export interface CamerasValuesListProps {
  camera: CameraSnapshot;
  row: ChoiceRowView;
  /** The row it stands beside. */
  anchor: RefObject<HTMLElement | null>;
  /** The readout that opened it: a press on it closes the list, and a press anywhere else too. */
  opener: RefObject<HTMLElement | null>;
  onPick: (value: string) => void;
  onClose: () => void;
}

export function CamerasValuesList({ camera, row, anchor, opener, onPick, onClose }: CamerasValuesListProps) {
  const options = row.choice.options;
  const list = useRef<HTMLDivElement>(null);
  const current = row.choice.value !== null && options.includes(row.choice.value) ? row.choice.value : null;
  // The option the arrows stand on; the one the camera reports to begin with.
  const [active, setActive] = useState<string | null>(current ?? options[0] ?? null);

  const focusOption = (option: string) => {
    setActive(option);
    list.current?.querySelector<HTMLElement>(`[data-option="${CSS.escape(option)}"]`)?.focus({ preventScroll: true });
  };

  // The arrows, Home and End move over the options; Enter or Space picks one.
  // Esc is the popover's: it closes the list.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (options.length === 0) return;
    const at = active === null ? 0 : Math.max(0, options.indexOf(active));
    const move = (to: number) => {
      event.preventDefault();
      event.stopPropagation();
      focusOption(options[Math.min(options.length - 1, Math.max(0, to))]!);
    };
    switch (event.key) {
      case "ArrowRight":
        move(at + 1);
        return;
      case "ArrowLeft":
        move(at - 1);
        return;
      case "ArrowDown":
        move(at + COLUMNS);
        return;
      case "ArrowUp":
        move(at - COLUMNS);
        return;
      case "Home":
        move(0);
        return;
      case "End":
        move(options.length - 1);
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        event.stopPropagation();
        if (active !== null) onPick(active);
        return;
      default:
    }
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
      testId="cameras-values-list"
    >
      <div
        ref={list}
        role="listbox"
        aria-label={`${row.label}: the values ${camera.tag} allows`}
        className={styles.grid}
        onKeyDown={onKeyDown}
      >
        {options.map((option) => {
          const selected = option === current;
          return (
            <div
              key={option}
              role="option"
              aria-selected={selected}
              tabIndex={option === active ? 0 : -1}
              className={styles.option}
              data-option={option}
              data-autofocus={selected ? "" : undefined}
              data-take=""
              data-testid={`cameras-value-${option}`}
              onClick={() => onPick(option)}
              onFocus={() => setActive(option)}
            >
              {option}
            </div>
          );
        })}
      </div>
    </Popover>
  );
}
