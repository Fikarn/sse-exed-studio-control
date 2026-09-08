import type { ReactNode } from "react";

import { StateDisplay, type StateDisplayTone } from "@sse/design-system";

import styles from "./PreReadyState.module.css";

// Visual overhaul A, Slice 7 (plan D1, D12; system §2): the surfaces the
// operator sees before the engine is ready use the same skeleton as every
// workspace — the state first and fixed, with the engine's own sentence, its
// code printed small in the display's code slot, and the one key that gets the
// operator out of the state. Below it, whatever the surface has to show sits on
// the bay's material, so a cold boot and a failed one look like the rest of the
// program rather than two more designs.

export interface PreReadyStateProps {
  tone: StateDisplayTone;
  /** `STARTING`, `PROTOCOL MISMATCH`, `ENGINE BOOTSTRAP FAILED`. */
  word: string;
  /** The engine's sentence, verbatim. */
  sentence: ReactNode;
  /** The raw failure code, printed small and never first. */
  code?: ReactNode;
  /** Counts and stage, on one line. */
  meta?: ReactNode;
  /** The way out: retry, open the log, show the shortcuts. */
  actions?: ReactNode;
  children?: ReactNode;
  testId?: string;
}

export function PreReadyState({ tone, word, sentence, code, meta, actions, children, testId }: PreReadyStateProps) {
  return (
    <div className={styles.shell} data-pre-ready="" data-testid={testId}>
      <div className={styles.column}>
        <StateDisplay
          className={styles.display}
          tone={tone}
          word={word}
          sentence={sentence}
          code={code}
          meta={meta}
          actions={actions}
          data-toolbar-primary="title"
          testId={testId ? `${testId}-state-display` : undefined}
        />
        {children ? <div className={styles.body}>{children}</div> : null}
      </div>
    </div>
  );
}
