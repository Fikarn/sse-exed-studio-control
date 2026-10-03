import { Lamp } from "./Lamp";
import styles from "./Tally.module.css";

// The shell (visual overhaul 3; the reviewers' agreed fix): the header's REC
// tally, a slot of its own on every page, at the same place whether or not
// anything records, so the lamps beside it never move and the eye always
// knows where to look. At rest it is a hollow lamp and the quiet name. Lit, it
// is the latch form: a keyline, the lamp and the name
// in the tone's colour (coral while CAM 1 records), the detail in PT Sans; a
// last known state is a doubt, so its keyline is dashed.

export interface TallyState {
  /** What the tally says beside its name: `CAM 1`, `last known`. */
  detail: string;
  tone: "error" | "attention";
  /** A state no longer read: a dashed keyline (system §4). */
  doubt?: boolean;
}

export interface TallyProps {
  /** The tally's name, an SSE Adelia word: `REC`. */
  name: string;
  /** `null` at rest. */
  state: TallyState | null;
  onClick?: () => void;
  title?: string;
  ariaLabel?: string;
  /** The slot's own test id. */
  testId?: string;
  /** The lit tally's test id. */
  litTestId?: string;
}

export const Tally = ({ name, state, onClick, title, ariaLabel, testId, litTestId }: TallyProps) => (
  <div className={styles.slot} data-tally="" data-testid={testId}>
    {state ? (
      <button
        type="button"
        className={[styles.lit, styles[state.tone]].join(" ")}
        data-tone={state.tone}
        data-doubt={state.doubt ? "" : undefined}
        data-latch=""
        data-testid={litTestId}
        onClick={onClick}
        title={title}
        aria-label={ariaLabel}
      >
        <Lamp tone={state.tone} />
        <span className={styles.name}>{name}</span>
        <span className={styles.detail}>{state.detail}</span>
      </button>
    ) : (
      <span className={styles.rest}>
        <Lamp tone="off" />
        <span className={styles.name}>{name}</span>
      </span>
    )}
  </div>
);
