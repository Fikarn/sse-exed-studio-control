import { useId, type ReactNode } from "react";

import { Lamp, type LampTone } from "./Lamp";
import type { SharedStatusTone } from "./statusTone";
import styles from "./Tab.module.css";

// Visual overhaul A, Slice 2 (system §7): a workspace tab in the shell
// header. The skylight (D48, 2026-10-09): a segment of the header's platter,
// its name bold at rest; the open tab is the one Dark Green segment (it keeps
// `data-material="key"` as its hook); a locked tab (startup, recovery,
// commissioning not published) is a dashed outline at 55 % with
// `aria-disabled` (plan D7), never opacity alone. New pages program, Slice 3
// (D6): the tab prints its name and icon only — no key hint. The shell
// (overhaul 3): a tab carries its page's lamp and state word, so the header
// names each device once; the active tab carries none, because the page's own
// state display says it. The tab's name stays the page's name alone: the word
// describes the tab and is never part of its name.
//
// The polish (2026-10-05): the open tab keeps the room its word takes when
// it is not open (`reserve`, drawn invisible after its name), so no tab
// moves when the page changes and the tab just pressed stays under the
// pointer (system §1: controls never move).
export interface TabProps {
  id: string;
  label: string;
  icon?: ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  /** The page's state word, beside its lamp (`unreachable`, `ready`). */
  word?: string;
  /** A value after the word that changes, in PT Sans (`2:31 left`). */
  value?: string;
  tone?: SharedStatusTone;
  /** The word's test id (the header's lamp ids, `shell-lamp-<page>`). */
  wordTestId?: string;
  /**
   * The open tab's word and value, never shown: they hold the tab's width so
   * the tabs after it stay where they were. No lamp, test id or description.
   */
  reserve?: { word: string; value?: string };
  className?: string;
}

function lampToneFor(tone: SharedStatusTone): LampTone {
  return tone === "neutral" ? "off" : tone;
}

export const Tab = ({
  id,
  label,
  icon,
  active = false,
  disabled = false,
  onClick,
  word,
  value,
  tone = "neutral",
  wordTestId,
  reserve,
  className,
}: TabProps) => {
  const wordId = useId();
  const classes = [styles.tab, active ? styles.active : "", className].filter(Boolean).join(" ");
  const button = (
    <button
      type="button"
      data-nav-id={id}
      data-material={active ? "key" : undefined}
      className={classes}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-disabled={disabled ? "true" : undefined}
      aria-current={active ? "page" : undefined}
      aria-label={word ? label : undefined}
      aria-describedby={word ? wordId : undefined}
    >
      {icon ? <span className={styles.icon}>{icon}</span> : null}
      <span className={styles.name} data-label={label}>
        {label}
      </span>
      {word ? (
        <span id={wordId} className={[styles.state, styles[tone]].join(" ")} data-tone={tone} data-testid={wordTestId}>
          <Lamp tone={lampToneFor(tone)} />
          <span className={styles.word}>{word}</span>
          {value ? <span className={styles.value}>{value}</span> : null}
        </span>
      ) : null}
    </button>
  );
  if (!active || !reserve) return button;
  return (
    <span className={styles.slot}>
      {button}
      <span className={styles.reserve} aria-hidden="true" data-tab-reserve="">
        <span className={styles.reserveLamp} />
        <span className={styles.word}>{reserve.word}</span>
        {reserve.value ? <span className={styles.value}>{reserve.value}</span> : null}
      </span>
    </span>
  );
};
