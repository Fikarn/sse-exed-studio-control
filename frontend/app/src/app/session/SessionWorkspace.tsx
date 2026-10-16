import { memo, useEffect, useMemo, useState, type MouseEvent } from "react";

import { Key, LampWord, SessionRoom, ShellRegion } from "@sse/design-system";
import type {
  AudioSnapshot,
  CamerasSnapshot,
  JsonObject,
  JsonValue,
  LightingSnapshot,
  PrompterSnapshot,
  SessionKind,
  SessionSnapshot,
  ShellStore,
} from "@sse/engine-client";

import { buildAudioViewModel, type AudioChannelGroupSelections } from "../audio/audioViewModel";
import { OverviewFooter } from "../overview/OverviewFooter";
import { overviewState, studioLinks, type OverviewWayOut } from "../overview/overviewModel";
import { useToast } from "../shared/toastContext";
import { useLiveCallback } from "../shared/useLiveCallback";
import { formatShortTimestamp, getSupportBackups, type HeaderItem } from "../shellData";
import { SESSION_KINDS } from "./kinds";
import { dayWord, kindName, lastOf, noteOf, runningOf, sinceWord, trimmedName } from "./sessionModel";
import { SessionWindow, type SessionWindowView } from "./SessionWindow";
import styles from "./SessionWorkspace.module.css";

// The Session page (D51; docs/design/session.md, board 2): the start of
// every session, and the page the app opens on. One question, three Rooms,
// one window: the operator chooses what this session makes (Green Screen
// Recording, Podcast Recording or Webinar), and the Room pressed opens its
// window with the session's options and Begin, which opens the Overview.
//
// It is the one page without the frame's cluster, plate and state display
// (the frame draws the bay alone and the footer). The header's lamps carry
// the studio's state here as on every page, and the window says what needs
// the operator before a session begins, the worst page's note as the
// Overview's state display mirrors it. No page waits for a session.
//
// The hardware link keeps the session (`session.snapshot`): while one runs,
// its Room stays lit and a platter under the question says since when, with
// Continue to the Overview. The deck stays where it is while the page is
// open, as on Setup (D5); Begin opens the Overview, which turns it to
// PROMPTER (D49). In step 1 Begin changes nothing in the studio: it notes
// the session and opens the Overview.

export interface SessionWorkspaceProps {
  appSnapshot: JsonObject | null;
  audioSnapshot: AudioSnapshot | null;
  camerasSnapshot: CamerasSnapshot | null;
  healthSnapshot: JsonObject | null;
  /** The header's lamps, chips and latches before the header leaves any out
   *  (`buildMonitorItems`): the window's note ranks them as the Overview does. */
  lamps: readonly HeaderItem[];
  lightingSnapshot: LightingSnapshot | null;
  prompterSnapshot: PrompterSnapshot | null;
  /** The session; `null` until it is read. */
  sessionSnapshot: SessionSnapshot | null;
  store: ShellStore;
  supportSnapshot: JsonObject | null;
}

const NO_CHIPS: AudioChannelGroupSelections = { "hardware-inputs": [], "software-playback": [] };

/** The Rooms come in once after a start of the app, not at every return to the page. */
let enteredSinceStart = false;

/** What an action answers: the hardware link's sentence, when it gives one. */
function sentenceOf(result: JsonValue): string | null {
  return result && typeof result === "object" && !Array.isArray(result) && typeof result.sentence === "string"
    ? result.sentence
    : null;
}

/** The page's clock: the day and the times move on as the shell's clock does, every 15 s. */
function usePageClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function SessionWorkspaceRoot({
  appSnapshot,
  audioSnapshot,
  camerasSnapshot,
  healthSnapshot,
  lamps,
  lightingSnapshot,
  prompterSnapshot,
  sessionSnapshot,
  store,
  supportSnapshot,
}: SessionWorkspaceProps) {
  const toast = useToast();
  const now = usePageClock();
  const [entering, setEntering] = useState(() => !enteredSinceStart);
  useEffect(() => {
    enteredSinceStart = true;
  }, []);

  // The window: the kind whose window is drawn, while it is open and while
  // it closes back into its Room; the name typed in each kind's window.
  const [view, setView] = useState<SessionWindowView | null>(null);
  const [open, setOpen] = useState(false);
  const [names, setNames] = useState<Partial<Record<SessionKind, string>>>({});
  const [busy, setBusy] = useState(false);

  const running = runningOf(sessionSnapshot);

  // The worst page's note, as the Overview's state display mirrors it.
  const audio = useMemo(
    () =>
      audioSnapshot
        ? buildAudioViewModel({ activeChannelGroups: NO_CHIPS, appSnapshot, audioSnapshot, bankIndex: 0 })
        : null,
    [appSnapshot, audioSnapshot]
  );
  const note = noteOf(
    overviewState(
      {
        lamps,
        audio,
        cameras: camerasSnapshot,
        health: healthSnapshot,
        lighting: lightingSnapshot,
        prompter: prompterSnapshot,
      },
      studioLinks(lamps, camerasSnapshot)
    )
  );

  /** Sends one request; a refusal is the hardware link's sentence, as a notice. */
  const perform = useLiveCallback(async (action: () => Promise<JsonValue>, announce = false) => {
    try {
      const result = await action();
      const sentence = announce ? sentenceOf(result) : null;
      if (sentence) toast.push({ tone: "ok", message: sentence });
      return result;
    } catch (error) {
      toast.push({
        tone: "attention",
        message:
          error instanceof Error
            ? error.message
            : "The hardware link did not answer. Look at the page before pressing again.",
      });
      return null;
    }
  });

  const openWindow = (kind: SessionKind, event: MouseEvent<HTMLButtonElement>) => {
    if (view) return;
    setView({
      kind,
      room: event.currentTarget,
      running: running?.kind === kind ? running : null,
      other: running && running.kind !== kind ? running : null,
    });
    setOpen(true);
  };
  const close = useLiveCallback(() => setOpen(false));
  const toOverview = useLiveCallback(() => void perform(() => store.setWorkspace("overview")));

  // Begin: the session begins and the Overview opens; the page leaves, and
  // the window with it. A refusal keeps the window open and says why.
  const begin = useLiveCallback(async () => {
    if (!view || busy) return;
    setBusy(true);
    const begun = await perform(() => store.beginSession(view.kind, trimmedName(names[view.kind] ?? "")));
    if (begun === null) {
      setBusy(false);
      return;
    }
    setNames((typed) => ({ ...typed, [view.kind]: "" }));
    const left = await perform(() => store.setWorkspace("overview"));
    if (left === null) {
      // The session runs; the page stays where it is, and the window closes.
      setBusy(false);
      setOpen(false);
    }
  });

  // End session: the running session ends and the window closes; the Room's
  // light goes off and the platter goes.
  const end = useLiveCallback(async () => {
    if (busy) return;
    setBusy(true);
    const ended = await perform(() => store.endSession());
    setBusy(false);
    if (ended !== null) setOpen(false);
  });

  const wayOut = useLiveCallback((way: OverviewWayOut) => {
    if (way.kind === "sync") void perform(() => store.syncAudio(), true);
    else void perform(() => store.setWorkspace(way.page));
  });

  const since = running ? sinceWord(running.begunAt, now) : null;
  const latestBackup = getSupportBackups(supportSnapshot)[0] ?? null;

  return (
    <div
      className={styles.workspace}
      data-entering={entering ? "" : undefined}
      data-running={running ? "" : undefined}
      data-testid="session-workspace"
      data-workspace="session"
    >
      <div className={styles.question} data-testid="session-question">
        <p className={styles.day}>{dayWord(now)}</p>
        <h1 className={styles.ask}>What are we making today?</h1>
        {running ? (
          <div className={styles.platter} data-testid="session-running">
            <span className={styles.bodyWord}>
              <LampWord tone="ok">In session</LampWord>
            </span>
            <span data-testid="session-running-line">
              {kindName(running.kind)} · <span className={styles.platterName}>{running.name || "no name"}</span>
              {since ? ` · ${since}` : null}
            </span>
            <Key mode="primary" testId="session-running-continue" onClick={toOverview}>
              Continue
            </Key>
          </div>
        ) : null}
      </div>

      <div
        className={styles.rooms}
        data-testid="session-rooms"
        onAnimationEnd={(event) => {
          // The entrance has run once the last Room has come in.
          if (event.target === event.currentTarget.lastElementChild) setEntering(false);
        }}
      >
        {SESSION_KINDS.map((kind) => {
          const lit = running?.kind === kind.id;
          return (
            <SessionRoom
              key={kind.id}
              tone={kind.tone}
              name={kind.name}
              line={kind.line}
              lit={lit}
              caption={
                lit ? (
                  <>
                    <LampWord tone="ok">In session</LampWord>
                    {since ? <span className={styles.since}>· {since}</span> : null}
                  </>
                ) : undefined
              }
              away={view?.kind === kind.id}
              className={styles.room}
              testId={`session-room-${kind.id}`}
              onClick={(event) => openWindow(kind.id, event)}
            >
              {kind.drawing}
            </SessionRoom>
          );
        })}
      </div>

      <ShellRegion region="footer">
        <OverviewFooter
          audio={audioSnapshot}
          backup={latestBackup ? formatShortTimestamp(latestBackup.modifiedAt) : null}
          now={now}
          takesToday={camerasSnapshot?.takesToday}
          testId="session-footer"
        />
      </ShellRegion>

      {view ? (
        <SessionWindow
          view={view}
          open={open}
          last={lastOf(sessionSnapshot, view.kind)}
          note={note}
          name={names[view.kind] ?? ""}
          now={now}
          onName={(name) => setNames((typed) => ({ ...typed, [view.kind]: name }))}
          onBegin={() => void begin()}
          onEnd={() => void end()}
          onContinue={toOverview}
          onWayOut={wayOut}
          onClose={close}
          onClosed={() => setView(null)}
        />
      ) : null}
    </div>
  );
}

// The page root is memoised, as every page's is (the audit of 2026-10-12):
// the shell renders at every store change, and a page whose props have not
// changed is left alone.
export const SessionWorkspace = memo(SessionWorkspaceRoot);
