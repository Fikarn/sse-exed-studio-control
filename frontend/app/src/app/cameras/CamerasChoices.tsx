import { useEffect, useRef, type ReactNode, type RefObject } from "react";

import { ArmKey, Key, Popover, Segmented, type ArmedKey } from "@sse/design-system";
import type { CameraChoice } from "@sse/engine-client";

import { unavailableReason } from "./camerasModel";
import styles from "./CamerasChoices.module.css";

// The format and the look of the selected camera (D11: press twice), in a
// popover beside the plate (the visual overhaul, 2026-10-05). The key the
// camera reports is the selection (the Beige keyline); the first press on
// another arms it in place, as the one armed form with its countdown, and the
// second sets it. The armed key stays in view as long as it is armed: closing
// the popover, by a press outside, by Esc or by its key, drops the arm (one
// Esc, one layer: the popover keeps its Esc and the plate cancels the arm).
// A choice the camera refuses now is locked, and the reason stands under the
// row.

export interface ChoiceGroup {
  /** The setting, as the test ids name it (`frameRate`). */
  setting: string;
  label: string;
  choice: CameraChoice;
  /** The unit after a value in a sentence (`p` for a frame rate). */
  unit: string;
  /** The key each option arms with. */
  armKey: (option: string) => string;
  onPress: (option: string) => void;
  /** The options are long and take two lines (the display LUT). */
  tall?: boolean;
  /** Why the whole row is locked (the camera is not held). */
  lock: string | null;
}

export interface OnOffGroup {
  setting: string;
  label: string;
  value: boolean | null;
  armKey: (on: boolean) => string;
  onPress: (on: boolean) => void;
  lock: string | null;
}

/**
 * Keeps the focus on a row's key while it arms and disarms. A key that arms is
 * drawn anew in the armed form, and the one it was is gone with the focus; so
 * the focus goes to the armed key, and back to the row's chosen key once the
 * page holds no arm. With the focus in the popover, Esc reaches the popover,
 * which closes and drops the arm (one Esc, one layer).
 */
function useFocusFollowsArm(armedHere: string | null, anyArmed: boolean) {
  const row = useRef<HTMLDivElement>(null);
  const was = useRef(armedHere);
  // On every change of the key armed here: another key of the same row taking
  // the arm is a change too, and its old key is gone with the focus as well.
  useEffect(() => {
    const changed = was.current !== armedHere;
    was.current = armedHere;
    if (!changed || (armedHere === null && anyArmed)) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    row.current
      ?.querySelector<HTMLElement>(armedHere !== null ? '[data-armed="true"]' : 'button[aria-pressed="true"]')
      ?.focus({ preventScroll: true });
  }, [armedHere, anyArmed]);
  return row;
}

/** One press-twice row: its label, its keys, and why a key is locked. */
export function ChoiceRow({ group, armed }: { group: ChoiceGroup; armed: ArmedKey | null }) {
  const { choice, setting, label, unit, lock } = group;
  const refused = choice.unavailable.map((entry) => `${entry.value}${unit} ${entry.reason}`).join(" · ");
  const row = useFocusFollowsArm(
    choice.options.map((option) => group.armKey(option)).find((key) => key === armed?.key) ?? null,
    armed !== null
  );
  return (
    <div ref={row} className={styles.group}>
      <div className={styles.label}>{label}</div>
      <Segmented
        label={label}
        className={[styles.choices, group.tall ? styles.tall : ""].filter(Boolean).join(" ")}
        testId={`cameras-${setting}`}
      >
        {choice.options.map((option) => {
          const key = group.armKey(option);
          const unavailable = unavailableReason(choice, option);
          const reason = lock ?? (unavailable ? `${option}${unit}: ${unavailable}` : null);
          const current = choice.value === option;
          return armed?.key === key ? (
            <ArmKey
              key={option}
              armed
              timeoutMs={armed.timeoutMs}
              countdownTestId={`cameras-${setting}-countdown`}
              armedWord="ARMED"
              className={styles.armedChoice}
              testId={`cameras-${setting}-${option}`}
              onClick={() => group.onPress(option)}
            >
              {option}
            </ArmKey>
          ) : (
            <Key
              key={option}
              mode="segmented"
              selected={current}
              aria-pressed={current}
              locked={reason !== null}
              reason={reason ?? undefined}
              testId={`cameras-${setting}-${option}`}
              onClick={() => group.onPress(option)}
            >
              {option}
            </Key>
          );
        })}
      </Segmented>
      {refused ? (
        <div className={styles.refused} data-testid={`cameras-${setting}-refused`}>
          {refused}
        </div>
      ) : null}
    </div>
  );
}

/** The display LUT's On and Off, press twice like the LUT itself. */
export function OnOffRow({ group, armed }: { group: OnOffGroup; armed: ArmedKey | null }) {
  const { setting, label, value, lock } = group;
  const row = useFocusFollowsArm(
    [true, false].map((on) => group.armKey(on)).find((key) => key === armed?.key) ?? null,
    armed !== null
  );
  return (
    <div ref={row} className={styles.group}>
      <div className={styles.label}>{label}</div>
      <Segmented label={label} className={styles.choices} testId={`cameras-${setting}`}>
        {[true, false].map((on) => {
          const key = group.armKey(on);
          const word = on ? "On" : "Off";
          const testId = `cameras-${setting}-${on ? "on" : "off"}`;
          return armed?.key === key ? (
            <ArmKey
              key={word}
              armed
              timeoutMs={armed.timeoutMs}
              countdownTestId={`cameras-${setting}-countdown`}
              armedWord="ARMED"
              className={styles.armedChoice}
              testId={testId}
              onClick={() => group.onPress(on)}
            >
              {word}
            </ArmKey>
          ) : (
            <Key
              key={word}
              mode="segmented"
              selected={value === on}
              aria-pressed={value === on}
              locked={lock !== null}
              reason={lock ?? undefined}
              testId={testId}
              onClick={() => group.onPress(on)}
            >
              {word}
            </Key>
          );
        })}
      </Segmented>
    </div>
  );
}

export interface CamerasChoicesProps {
  title: string;
  /** The section it stands beside. */
  anchor: RefObject<HTMLElement | null>;
  /** The plate's key that opened it: a press on it closes the popover, and a press anywhere else too. */
  opener: RefObject<HTMLElement | null>;
  onClose: () => void;
  testId: string;
  children: ReactNode;
}

/** The popover the format's and the look's rows stand in. */
export function CamerasChoices({ title, anchor, opener, onClose, testId, children }: CamerasChoicesProps) {
  return (
    <Popover
      open
      anchor={anchor.current}
      onClose={onClose}
      title={title}
      placement="left-start"
      width={407}
      ignoreOutside={[opener]}
      initialFocus="first"
      testId={testId}
    >
      <div className={styles.body}>{children}</div>
    </Popover>
  );
}
