import { ArmKey, Key } from "@sse/design-system";
import type { CameraSnapshot } from "@sse/engine-client";

import { recKeyView } from "./camerasModel";
import { STOP_WINDOW_MS } from "./perform";
import styles from "./RecKey.module.css";

// REC, CAM 1's take-time key (D14), in its four forms (`recKeyView`): one
// press starts; while CAM 1 records the first press arms and a second within
// the window stops (D11); last known while CAM 1 does not answer, STOP locked;
// locked while CAM 1 is not held. The Cameras page and the Overview (D47)
// draw the same key; each passes its own test ids.

export interface RecKeyProps {
  /** CAM 1, whose key it is whichever camera is selected; `null` before it is read. */
  main: CameraSnapshot | null;
  /** The page's stop arm is on this key. */
  stopArmed: boolean;
  onRecord: () => void;
  testId: string;
  countdownTestId: string;
  className?: string;
}

export function RecKey({ main, stopArmed, onRecord, testId, countdownTestId, className }: RecKeyProps) {
  const rec = recKeyView(main);
  const classes = (...more: string[]) => [styles.rec, ...more, className].filter(Boolean).join(" ");
  if (rec.kind === "recording") {
    return (
      <ArmKey
        hazard
        armed={stopArmed}
        timeoutMs={STOP_WINDOW_MS}
        countdownTestId={countdownTestId}
        cap={stopArmed ? "Stop?" : "Rec"}
        hint={rec.hint}
        layout="stack"
        size="tall"
        take
        className={classes()}
        data-rec="recording"
        aria-label={
          stopArmed ? "Stop armed. Press again to stop CAM 1." : "CAM 1 reports recording. Press twice to stop."
        }
        testId={testId}
        onClick={onRecord}
      />
    );
  }
  if (rec.kind === "start") {
    return (
      <Key
        cap="Rec"
        hint={rec.hint}
        layout="stack"
        size="tall"
        take
        className={classes()}
        data-rec="stopped"
        aria-label="Start recording on CAM 1"
        testId={testId}
        onClick={onRecord}
      />
    );
  }
  return (
    <Key
      cap="Rec"
      hint={rec.hint}
      layout="stack"
      size="tall"
      take
      locked
      reason={rec.reason}
      className={classes(rec.kind === "last-known" ? styles.recDoubt : "")}
      data-rec={rec.kind}
      data-doubt={rec.kind === "last-known" ? "" : undefined}
      testId={testId}
    />
  );
}
