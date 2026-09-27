import { useMemo, useRef, useState, type ChangeEvent } from "react";

import { ArmKey, ARM_TIMEOUT_MS, Button, Dialog, Key, Section, StateDisplay, type ArmedKey } from "@sse/design-system";
import type {
  JsonValue,
  PrompterJumpRequest,
  PrompterScriptSummary,
  PrompterSnapshot,
  ShellStore,
} from "@sse/engine-client";

import type { GlassParagraph } from "./glass/glassText";
import {
  paragraphRows,
  paragraphWindow,
  playLockReason,
  runLockReason,
  SPEED_RANGE,
  stepLocks,
  type PrompterStateView,
} from "./teleprompterModel";
import { TAKE, type PerformAction } from "./perform";
import styles from "./TeleprompterCluster.module.css";

// The Teleprompter's cluster (new pages program, Slice 6a; board 1's left
// column, the proposal §2 and §5): the state display with its armed row, the
// take — PLAY, BACK, TOP, the speed, the line, paragraph and cue steps — the
// paragraph list, and the standing actions. Every take key is one press and
// none but PLAY starts the scroll; Clear is armed (D11).

/** The paragraph list's rows: as many as board 1 draws; a longer script shows a window around the place. */
const PARAGRAPH_ROOM = 18;

export interface TeleprompterClusterProps {
  snapshot: PrompterSnapshot;
  state: PrompterStateView;
  cut: readonly GlassParagraph[];
  selected: PrompterScriptSummary | null;
  /** Where `BACK` goes from the place (`backParagraph`), from 0. */
  backTo: number;
  armed: ArmedKey | null;
  store: ShellStore;
  perform: PerformAction;
  onPutOn: () => void;
  onUpdate: () => void;
  onClear: () => void;
  /** The scripts kept, for a file opened before (§3.3). */
  scripts: readonly PrompterScriptSummary[];
  onNewScript: () => void;
  onPasteScript: () => void;
  /** What an import answered: the page selects the script. */
  onImported: (result: JsonValue | null) => void;
}

/** A file whose name was opened before, waiting for the operator's choice (§3.3). */
interface Reopened {
  file: File;
  script: PrompterScriptSummary;
}

/** The largest file the hardware link opens (`MAX_IMPORT_BYTES`): a larger one is not read at all. */
const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** A file the page's own picker read, as the hardware link takes it: its bytes in base64. */
async function fileAsBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

export function TeleprompterCluster({
  snapshot,
  state,
  cut,
  selected,
  backTo,
  armed,
  store,
  perform,
  onPutOn,
  onUpdate,
  onClear,
  scripts,
  onNewScript,
  onPasteScript,
  onImported,
}: TeleprompterClusterProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [reopened, setReopened] = useState<Reopened | null>(null);
  const glass = snapshot.glass;
  const runLock = runLockReason(snapshot);
  const playLock = playLockReason(snapshot);
  const layoutLock = glass && !glass.laidOut ? "The text is being laid out on the glass." : null;
  const jump = (request: PrompterJumpRequest) => void perform(() => store.jumpPrompter(request), false, TAKE);
  const placeParagraph = glass ? Math.min(glass.place.paragraph, Math.max(glass.paragraphCount - 1, 0)) : 0;
  const speedWpm = glass?.speedWpm ?? 0;
  const rows = useMemo(() => paragraphRows(cut, speedWpm), [cut, speedWpm]);
  const steps = stepLocks(glass);
  const slowest =
    glass && glass.speedWpm <= SPEED_RANGE.min
      ? `The pace is at its slowest, ${SPEED_RANGE.min} words a minute.`
      : null;
  const fastest =
    glass && glass.speedWpm >= SPEED_RANGE.max
      ? `The pace is at its fastest, ${SPEED_RANGE.max} words a minute.`
      : null;
  const shown = paragraphWindow(rows.length, placeParagraph, PARAGRAPH_ROOM);

  /** Sends a file the page read, as a new script or as `updateScriptId`'s new text. */
  const sendFile = async (file: File, updateScriptId?: string) => {
    const result = await perform(async () => {
      // The hardware link's own sentence for a file over its limit, said
      // before the file is read into memory to be sent.
      if (file.size > MAX_FILE_BYTES) {
        throw new Error(
          `${file.name} is ${Math.ceil(file.size / (1024 * 1024))} MB; Studio Control opens files up to ${MAX_FILE_BYTES / (1024 * 1024)} MB.`
        );
      }
      let contentBase64: string;
      try {
        contentBase64 = await fileAsBase64(file);
      } catch {
        throw new Error(`${file.name} could not be read. Open it again, or save a copy and open that.`);
      }
      return store.importPrompterScript({
        fileName: file.name,
        contentBase64,
        ...(updateScriptId ? { updateScriptId } : {}),
      });
    }, true);
    onImported(result);
  };

  const importFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    // A file opened before: update that script from it, or add it (§3.3).
    const script = scripts.find((candidate) => candidate.sourceFileName === file.name);
    if (script) setReopened({ file, script });
    else void sendFile(file);
  };

  const wayOut =
    state.wayOut === "update" ? (
      <ArmKey
        armed={armed?.key === "update"}
        timeoutMs={ARM_TIMEOUT_MS}
        countdownTestId="teleprompter-update-countdown"
        size="small"
        testId="teleprompter-state-update"
        onClick={onUpdate}
      >
        {armed?.key === "update" ? "Update the prompter" : "Update the prompter · press twice"}
      </ArmKey>
    ) : state.wayOut === "put-on" && selected ? (
      <Key size="small" testId="teleprompter-state-put-on" onClick={onPutOn}>
        Put {selected.name} on the prompter
      </Key>
    ) : undefined;

  return (
    <div className={styles.cluster} data-testid="teleprompter-cluster">
      <StateDisplay
        tone={state.tone}
        word={state.word}
        sentence={state.sentence}
        meta={state.meta ?? undefined}
        actions={wayOut}
        // The way out's own key says it is armed; the armed row is for the others.
        armed={
          armed && !(armed.key === "update" && state.wayOut === "update")
            ? { text: `${armed.label} · press again`, timeoutMs: armed.timeoutMs }
            : null
        }
        testId="teleprompter-state-display"
      />

      <div className={styles.take}>
        <Key
          cap="Play"
          hint={
            glass?.playing
              ? "playing · press to pause"
              : glass && !glass.atEnd
                ? `paused at ¶ ${placeParagraph + 1} · press to play`
                : "press to play"
          }
          layout="stack"
          size="tall"
          live={glass?.playing ?? false}
          locked={playLock !== null}
          reason={playLock ?? undefined}
          take
          testId="teleprompter-play"
          className={styles.play}
          aria-pressed={glass?.playing ?? false}
          onClick={() =>
            void perform(() => (glass?.playing ? store.pausePrompter() : store.playPrompter()), false, TAKE)
          }
        />
        <Key
          cap="Back"
          hint={glass ? `to the start of ¶ ${backTo + 1}` : undefined}
          layout="stack"
          locked={runLock !== null}
          reason={runLock ?? undefined}
          take
          testId="teleprompter-back"
          onClick={() => jump({ to: "back" })}
        />
        <Key
          cap="Top"
          hint="pauses · to ¶ 1"
          layout="stack"
          locked={runLock !== null}
          reason={runLock ?? undefined}
          take
          testId="teleprompter-top"
          onClick={() => jump({ to: "top" })}
        />
      </div>

      <Section title="Speed" detail="this script's own · 5 words/min a press · 40–300" testId="teleprompter-speed">
        <div className={styles.speed}>
          <Key
            cap="− 5"
            locked={(runLock ?? slowest) !== null}
            reason={runLock ?? slowest ?? undefined}
            take
            testId="teleprompter-speed-down"
            aria-label="Slower by 5 words a minute"
            onClick={() => void perform(() => store.setPrompterSpeed({ step: -1 }), false, TAKE)}
          />
          <output className={styles.speedReadout} data-well="" data-testid="teleprompter-speed-readout">
            <b>{glass ? glass.speedWpm : "—"}</b> words/min
          </output>
          <Key
            cap="+ 5"
            locked={(runLock ?? fastest) !== null}
            reason={runLock ?? fastest ?? undefined}
            take
            testId="teleprompter-speed-up"
            aria-label="Faster by 5 words a minute"
            onClick={() => void perform(() => store.setPrompterSpeed({ step: 1 }), false, TAKE)}
          />
        </div>
      </Section>

      <div className={styles.steps}>
        <Key
          locked={(runLock ?? layoutLock) !== null}
          reason={runLock ?? layoutLock ?? undefined}
          take
          testId="teleprompter-line-back"
          onClick={() => jump({ to: "previousLine" })}
        >
          ◂ Line
        </Key>
        <Key
          locked={(runLock ?? layoutLock) !== null}
          reason={runLock ?? layoutLock ?? undefined}
          take
          testId="teleprompter-line-on"
          onClick={() => jump({ to: "nextLine" })}
        >
          Line ▸
        </Key>
        <Key
          locked={runLock !== null}
          reason={runLock ?? undefined}
          take
          testId="teleprompter-paragraph-back"
          onClick={() => jump({ to: "previousParagraph" })}
        >
          ◂ Paragraph
        </Key>
        <Key
          locked={(runLock ?? steps.nextParagraph) !== null}
          reason={runLock ?? steps.nextParagraph ?? undefined}
          take
          testId="teleprompter-paragraph-on"
          onClick={() => jump({ to: "nextParagraph" })}
        >
          Paragraph ▸
        </Key>
        <Key
          locked={(runLock ?? steps.previousCue) !== null}
          reason={runLock ?? steps.previousCue ?? undefined}
          take
          testId="teleprompter-cue-back"
          onClick={() => jump({ to: "previousCue" })}
        >
          ◂ Cue
        </Key>
        <Key
          locked={(runLock ?? steps.nextCue) !== null}
          reason={runLock ?? steps.nextCue ?? undefined}
          take
          testId="teleprompter-cue-on"
          onClick={() => jump({ to: "nextCue" })}
        >
          Cue ▸
        </Key>
      </div>

      <Section
        title="Paragraphs"
        detail={
          glass
            ? shown.from === 0 && shown.to === rows.length
              ? `${rows.length} · all shown`
              : `¶ ${shown.from + 1}–${shown.to} of ${rows.length}`
            : "nothing on the prompter"
        }
        className={styles.paragraphs}
        testId="teleprompter-paragraphs"
      >
        {glass ? (
          <ol className={styles.paragraphList} data-well="">
            {rows.slice(shown.from, shown.to).map((row) => (
              <li key={row.index}>
                <button
                  type="button"
                  className={styles.paragraphRow}
                  data-current={row.index === placeParagraph && !glass.atEnd ? "" : undefined}
                  aria-current={row.index === placeParagraph && !glass.atEnd ? "true" : undefined}
                  data-testid={`teleprompter-paragraph-${row.index + 1}`}
                  onClick={() => jump({ to: "paragraph", paragraph: row.index })}
                >
                  <span className={styles.paragraphNumber}>{row.index + 1}</span>
                  <span className={styles.paragraphText}>
                    {row.cue ? <i className={styles.paragraphCue}>{row.cue}</i> : null}
                    {row.cue && row.text ? " " : null}
                    {row.text}
                  </span>
                  <span className={styles.paragraphLength}>{row.length}</span>
                </button>
              </li>
            ))}
          </ol>
        ) : null}
      </Section>

      <div className={styles.standing}>
        <input
          ref={fileInput}
          className={styles.fileInput}
          type="file"
          accept=".docx,.txt"
          tabIndex={-1}
          aria-hidden="true"
          data-testid="teleprompter-file-input"
          onChange={importFile}
        />
        <div className={styles.standingRow}>
          <Key size="small" testId="teleprompter-open-file" onClick={() => fileInput.current?.click()}>
            Open file…
          </Key>
          <Key size="small" testId="teleprompter-paste-script" onClick={onPasteScript}>
            Paste as a new script
          </Key>
          <Key size="small" testId="teleprompter-new-script" onClick={onNewScript}>
            New script
          </Key>
        </div>
        <ArmKey
          armed={armed?.key === "clear"}
          timeoutMs={ARM_TIMEOUT_MS}
          countdownTestId="teleprompter-clear-countdown"
          size="small"
          locked={runLock !== null}
          reason={runLock ?? undefined}
          testId="teleprompter-clear"
          onClick={onClear}
        >
          Clear the prompter · press twice
        </ArmKey>
        {reopened ? (
          <Dialog
            title={`${reopened.file.name} was opened before`}
            onClose={() => setReopened(null)}
            actions={
              <>
                <Button variant="ghost" size="compact" onClick={() => setReopened(null)}>
                  Cancel
                </Button>
                <Button
                  variant="secondary"
                  size="compact"
                  data-testid="teleprompter-reopen-add"
                  onClick={() => {
                    setReopened(null);
                    void sendFile(reopened.file);
                  }}
                >
                  Add as a new script
                </Button>
                <Button
                  variant="primary"
                  size="compact"
                  data-testid="teleprompter-reopen-update"
                  onClick={() => {
                    setReopened(null);
                    void sendFile(reopened.file, reopened.script.id);
                  }}
                >
                  Update {reopened.script.name}
                </Button>
              </>
            }
          >
            <p className={styles.reopened} data-testid="teleprompter-reopen">
              {reopened.script.name} came from this file. Update it from the file — its text now is kept as an earlier
              version — or add the file as a new script.
            </p>
          </Dialog>
        ) : null}
      </div>
    </div>
  );
}
