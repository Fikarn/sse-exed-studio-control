import { Lamp, type LampTone } from "./Lamp";
import type { SharedStatusTone } from "./statusTone";
import styles from "./LampChip.module.css";

// Visual overhaul A, Slice 2 (system §7); Atrium: the header chip — the
// subsystem's name in the quiet ink, then the lamp and its state word in SSE
// Adelia in the tone's colour, within 8 px. No box at rest; a clickable chip
// shows its edge under the pointer. A latch (Solo, Scene unsaved) is a chip
// that names a latched state rather than a subsystem (`data-latch`), and a
// green one (Prompter playing, new pages program Slice 6a) names something
// running.
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
      <b className={styles.label}>{label}</b>
      <Lamp tone={lampToneFor(tone)} />
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
