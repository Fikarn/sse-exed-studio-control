import { Lamp, type LampTone } from "./Lamp";
import type { SharedStatusTone } from "./statusTone";
import styles from "./LampChip.module.css";

// Visual overhaul A, Slice 2 (system §7): the header chip — a lamp, the
// subsystem's name and its state word within 8 px. `attention` chips are
// amber-keylined, `error` chips red; a latch (Solo, Scene unsaved) is an
// attention chip that names a latched state rather than a subsystem.
export interface LampChipProps {
  label: string;
  word?: string;
  tone: SharedStatusTone;
  latch?: boolean;
  onClick?: () => void;
  title?: string;
  ariaLabel?: string;
  testId?: string;
  className?: string;
}

function lampToneFor(tone: SharedStatusTone): LampTone {
  return tone === "neutral" ? "off" : tone;
}

export const LampChip = ({ label, word, tone, latch, onClick, title, ariaLabel, testId, className }: LampChipProps) => {
  const classes = [styles.chip, styles[tone], className].filter(Boolean).join(" ");
  const content = (
    <>
      <Lamp tone={lampToneFor(tone)} />
      <b className={styles.label}>{label}</b>
      {word ? <span className={styles.word}>{word}</span> : null}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        className={classes}
        data-tone={tone}
        data-latch={latch ? "" : undefined}
        data-testid={testId}
        onClick={onClick}
        title={title}
        aria-label={ariaLabel}
      >
        {content}
      </button>
    );
  }
  return (
    <div className={classes} data-tone={tone} data-latch={latch ? "" : undefined} data-testid={testId} title={title}>
      {content}
    </div>
  );
};
