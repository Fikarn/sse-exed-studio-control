import { useId, useRef } from "react";

import { Key, LampWord, SessionRoom, Sheet } from "@sse/design-system";
import type { Session, SessionKind } from "@sse/engine-client";

import type { OverviewWayOut } from "../overview/overviewModel";
import { kindOf } from "./kinds";
import {
  NAME_MAX_CHARACTERS,
  begunWord,
  beginHint,
  dayWord,
  lastTimeWord,
  runningNote,
  sinceTodayWord,
  type SessionNote,
} from "./sessionModel";
import styles from "./SessionWorkspace.module.css";

// A Room's window (D51; board 2, step 1): the sheet opens from the Room
// pressed, with the Room's picture at its left and the options at its right.
// Two forms:
//
// - a new session: its name (optional, at most 80 characters), the last
//   session of this kind with `Use this name` for a series, what needs the
//   operator first if anything (the worst page's note and its way out, the
//   running session Begin would end), then `Cancel` and `Begin session`;
// - the running session's own: its name and when it began, `End session` at
//   the left, `Close` and `Continue` at the right.
//
// What the window shows is taken when it opens (`SessionWindowView`), so a
// Begin or an End does not turn it into the other form while it leaves.

/** What a window shows, as it was when its Room was pressed. */
export interface SessionWindowView {
  kind: SessionKind;
  /** The Room pressed: the window opens from it and gives the focus back to it. */
  room: HTMLButtonElement | null;
  /** This kind's running session: the window is that session's own. */
  running: Session | null;
  /** Another kind's running session, which Begin ends. */
  other: Session | null;
}

export interface SessionWindowProps {
  view: SessionWindowView;
  /** Open, or closing back into its Room. */
  open: boolean;
  /** The last session of this kind; `null` for a kind never used. */
  last: Session | null;
  note: SessionNote | null;
  /** The name as typed so far. */
  name: string;
  now: number;
  onName: (name: string) => void;
  onBegin: () => void;
  onEnd: () => void;
  onContinue: () => void;
  onWayOut: (wayOut: OverviewWayOut) => void;
  /** Cancel, Close, Esc and a press on the dimmed page. */
  onClose: () => void;
  /** The close has run: the Room stands on the page again. */
  onClosed: () => void;
}

/** Board 2's step-1 window and the window's picture at its left. */
const WIDTH = 1200;
const HEIGHT = 620;
const ART_WIDTH = 423;

export function SessionWindow({
  view,
  open,
  last,
  note,
  name,
  now,
  onName,
  onBegin,
  onEnd,
  onContinue,
  onWayOut,
  onClose,
  onClosed,
}: SessionWindowProps) {
  const kind = kindOf(view.kind);
  const nameId = useId();
  const field = useRef<HTMLInputElement | null>(null);
  if (!kind) return null;

  // The last name into the field, and the focus back to it: setting the value
  // puts the caret after it, so typing goes on from there.
  const takeLastName = (lastName: string) => {
    onName(lastName);
    field.current?.focus();
  };

  const wayOut = note?.wayOut ?? null;
  const running = view.running;
  const since = running ? sinceTodayWord(running.begunAt, now) : null;
  const begun = running ? begunWord(running.begunAt, now) : null;

  return (
    <Sheet
      open={open}
      title={running ? `In session: ${kind.name}` : `New session: ${kind.name}`}
      width={WIDTH}
      height={HEIGHT}
      art={
        <SessionRoom tone={kind.tone} name={kind.name} line={kind.line} size="window">
          {kind.drawing}
        </SessionRoom>
      }
      artWidth={ART_WIDTH}
      from={() => view.room}
      returnFocusTo={view.room}
      onClose={onClose}
      onClosed={onClosed}
      testId="session-window"
    >
      {running ? (
        <div className={styles.form} data-testid="session-window-running">
          <div className={styles.kicker}>
            <span className={styles.kickerLamp}>
              <LampWord tone="ok">In session</LampWord>
            </span>
            {since ? <span className={styles.kickerDay}>{since}</span> : null}
          </div>
          <div className={styles.runningName} data-testid="session-window-name">
            {running.name || "No name given"}
          </div>
          {begun ? <div className={styles.runningFacts}>{begun}</div> : null}
          <span className={styles.spacer} />
          <div className={styles.keys}>
            <Key size="tall" className={styles.end} testId="session-end" onClick={onEnd}>
              End session
            </Key>
            <Key size="tall" className={styles.close} testId="session-close" onClick={onClose}>
              Close
            </Key>
            {/* The focus moves in to Continue: End session stands first in the window's order. */}
            <Key
              mode="primary"
              size="tall"
              layout="stack"
              cap="Continue"
              hint="on the Overview"
              className={styles.continue}
              data-autofocus=""
              testId="session-continue"
              onClick={onContinue}
            />
          </div>
        </div>
      ) : (
        <div className={styles.form} data-testid="session-window-new">
          <div className={styles.kicker}>
            <span className={styles.kickerWord}>New session</span>
            <span className={styles.kickerDay}>{dayWord(now)}</span>
          </div>
          <label className={styles.label} htmlFor={nameId}>
            Name this session
          </label>
          <input
            ref={field}
            id={nameId}
            className={styles.field}
            type="text"
            value={name}
            maxLength={NAME_MAX_CHARACTERS}
            placeholder="A name, optional"
            autoComplete="off"
            spellCheck={false}
            data-autofocus=""
            data-testid="session-name"
            onChange={(event) => onName(event.target.value)}
          />
          <div className={styles.last} data-none={last ? undefined : ""} data-testid="session-last">
            {last ? (
              <>
                <span className={styles.lastFacts}>
                  <span className={styles.lastDay}>{lastTimeWord(last, now)}</span>
                  <span className={styles.lastName}>{last.name || "No name given"}</span>
                </span>
                {last.name ? (
                  <Key size="small" testId="session-use-last" onClick={() => takeLastName(last.name)}>
                    Use this name
                  </Key>
                ) : null}
              </>
            ) : (
              <span className={styles.lastDay}>No session of this kind yet</span>
            )}
          </div>
          {note || view.other ? (
            <div className={styles.notes}>
              {note ? (
                <div className={styles.note} data-testid="session-note">
                  <span className={styles.bodyWord}>
                    <LampWord tone={note.tone}>{note.word}</LampWord>
                  </span>
                  <span className={styles.noteSay}>{note.sentence}</span>
                  {wayOut ? (
                    <Key
                      className={styles.noteKey}
                      testId={wayOut.kind === "sync" ? "session-note-sync" : `session-note-open-${wayOut.page}`}
                      onClick={() => onWayOut(wayOut)}
                    >
                      {wayOut.label}
                    </Key>
                  ) : null}
                </div>
              ) : null}
              {view.other ? (
                <div className={styles.note} data-testid="session-note-running">
                  <span className={styles.bodyWord}>
                    <LampWord tone="ok">In session</LampWord>
                  </span>
                  <span className={styles.noteSay}>{runningNote(view.other, now)}</span>
                </div>
              ) : null}
            </div>
          ) : null}
          <span className={styles.spacer} />
          <div className={styles.keys}>
            <Key size="tall" className={styles.cancel} testId="session-cancel" onClick={onClose}>
              Cancel
            </Key>
            <Key
              mode="primary"
              size="tall"
              layout="stack"
              cap={view.other ? "Begin instead" : "Begin session"}
              hint={beginHint(view.other)}
              className={styles.begin}
              testId="session-begin"
              onClick={onBegin}
            />
          </div>
        </div>
      )}
    </Sheet>
  );
}
