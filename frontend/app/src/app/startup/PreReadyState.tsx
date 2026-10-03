import type { ReactNode } from "react";

import { ShellRegion, StateDisplay, useShellRegion, type StateDisplayTone } from "@sse/design-system";

import styles from "./PreReadyState.module.css";

// Visual overhaul A, Slice 7 (plan D1, D12; system §2): the surfaces the
// operator sees before the engine is ready use the same skeleton as every
// workspace — the state first and fixed, with the engine's own sentence, its
// code printed small in the display's code slot, and the one key that gets the
// operator out of the state. The shell (overhaul 3): the state display stands
// in the shell's cluster, where every page's does, with what belongs beside it
// under it; what the surface has to show fills the bay; what it has to tell
// about the hardware goes on the shell's plate. A surface drawn without the
// shell (the root boundary, when the shell itself stopped) draws the same two
// columns itself.

export interface PreReadyStateProps {
  tone: StateDisplayTone;
  /** `STARTING UP…`, `PROTOCOL MISMATCH`, `STARTUP FAILED`. */
  word: string;
  /** The engine's sentence, verbatim. */
  sentence: ReactNode;
  /** The raw failure code, printed small and never first. */
  code?: ReactNode;
  /** Counts and stage, on one line. */
  meta?: ReactNode;
  /** The way out: retry startup, reset the window layout. None while starting. */
  actions?: ReactNode;
  /** Under the state display, in the cluster. */
  cluster?: ReactNode;
  /** On the shell's plate. */
  plate?: ReactNode;
  /** The bay. */
  children?: ReactNode;
  testId?: string;
}

export function PreReadyState({
  tone,
  word,
  sentence,
  code,
  meta,
  actions,
  cluster,
  plate,
  children,
  testId,
}: PreReadyStateProps) {
  const inShell = useShellRegion("cluster") !== null;
  // In the shell the surface's own test id is the cluster's column, which holds
  // its state display; the bay is `<testId>-bay`.
  const column = (
    <div className={styles.cluster} data-testid={inShell ? testId : testId ? `${testId}-cluster` : undefined}>
      <StateDisplay
        tone={tone}
        word={word}
        sentence={sentence}
        code={code}
        meta={meta}
        actions={actions}
        testId={testId ? `${testId}-state-display` : undefined}
      />
      {cluster}
    </div>
  );
  if (!inShell) {
    return (
      <div className={styles.frame} data-plate={plate ? "" : undefined} data-pre-ready="" data-testid={testId}>
        {column}
        <div className={styles.bay} data-testid={testId ? `${testId}-bay` : undefined}>
          {children}
        </div>
        {plate ? (
          <div className={styles.plate} data-testid={testId ? `${testId}-plate` : undefined}>
            {plate}
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <>
      <ShellRegion region="cluster">{column}</ShellRegion>
      {plate ? (
        <ShellRegion region="plate">
          <div className={styles.plate} data-testid={testId ? `${testId}-plate` : undefined}>
            {plate}
          </div>
        </ShellRegion>
      ) : null}
      <div className={styles.bay} data-pre-ready="" data-testid={testId ? `${testId}-bay` : undefined}>
        {children}
      </div>
    </>
  );
}
