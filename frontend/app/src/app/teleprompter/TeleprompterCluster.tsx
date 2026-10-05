import { useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";

import {
  ArmKey,
  ARM_TIMEOUT_MS,
  Dialog,
  Key,
  LatchSlot,
  MenuButton,
  Readout,
  Section,
  StateDisplay,
  Tooltip,
  type ArmedKey,
  type MenuEntry,
  type UseArmResult,
} from "@sse/design-system";
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
  SIZE_RANGE,
  SPEED_RANGE,
  stepLocks,
  type PrompterStateView,
} from "./teleprompterModel";
import { TAKE, type PerformAction } from "./perform";
import { CLEAR_ARM_KEY, UPDATE_ARM_KEY } from "./useTeleprompterArming";
import styles from "./TeleprompterCluster.module.css";

// The Teleprompter's cluster (new pages program, Slice 6a; board 1's left
// column, the proposal §2 and §5): the state display with its armed row, the
// take — PLAY, BACK, TOP, the speed and the text size, the line, paragraph and
// cue steps — the paragraph list, and Clear. Every take key is one press and
// none but PLAY starts the scroll; Clear is armed (D11).
//
// The visual overhaul (2026-10-05): every take key has one fixed home here.
// The text size moved in from the plate's look, beside the speed, as the
// deck's SPEED and SIZE dials stand side by side; the size works while
// nothing is on the prompter, as the hardware link allows. Open file…, Paste
// as a new script and New script are the page's ⋯ only (the state display's
// top right), which leaves the paragraph list its 16 rows. The helper
// sentences are tooltips on the words; press twice, the countdowns and the
// lock reasons stay on screen.

/** The paragraph list's rows: as many as the cluster holds under the steps and over Clear
 *  (`teleprompter.spec.ts` holds that the last one ends inside the cluster); a longer
 *  script shows a window around the place. */
const PARAGRAPH_ROOM = 16;

export interface TeleprompterClusterProps {
  snapshot: PrompterSnapshot;
  state: PrompterStateView;
  cut: readonly GlassParagraph[];
  /** Where `BACK` goes from the place (`backParagraph`), from 0. */
  backTo: number;
  armed: ArmedKey | null;
  /** What the state display's armed row says, before "· press again". */
  armedWords: string | null;
  arm: UseArmResult;
  store: ShellStore;
  perform: PerformAction;
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

/** A dial's word (the deck's, SSE Adelia) over its value, the helper sentence on hover. */
function DialCell({ word, tip, children }: { word: string; tip: string; children: ReactNode }) {
  return (
    <div className={styles.cell} data-well="">
      <Tooltip content={tip} placement="right">
        <span className={styles.cellWord}>{word}</span>
      </Tooltip>
      {children}
    </div>
  );
}

export function TeleprompterCluster({
  snapshot,
  state,
  cut,
  backTo,
  armed,
  armedWords,
  arm,
  store,
  perform,
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
  // The size is the glass's, not the script's: it is set while nothing is on
  // the prompter too (the screen's look sets it at any time; only the deck's
  // dial waits for a script), so only its ends lock it.
  const { sizePx, look } = snapshot;
  const atStandard = sizePx === look.standardSizePx;
  const smallest = sizePx <= SIZE_RANGE.min ? `The text is at its smallest, ${SIZE_RANGE.min} px.` : null;
  const largest = sizePx >= SIZE_RANGE.max ? `The text is at its largest, ${SIZE_RANGE.max} px.` : null;
  const size = (request: { step: 1 | -1 } | { standard: true }) =>
    void perform(() => store.setPrompterTextSize(request), false, TAKE);
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
  const openFile = () => fileInput.current?.click();

  // The way out (§8): Update while NOT UPDATED, which the display holds in its
  // own foot, armed in place; or Open file… while no script is kept. Put on
  // the prompter is the plate's key, under the script it puts on.
  const updateArmed = armed?.key === UPDATE_ARM_KEY;
  const wayOut =
    state.wayOut === "update" ? (
      <ArmKey
        armed={updateArmed}
        timeoutMs={armed?.timeoutMs ?? ARM_TIMEOUT_MS}
        countdownTestId="teleprompter-update-countdown"
        size="small"
        take
        className={styles.armRow}
        testId="teleprompter-state-update"
        onClick={onUpdate}
      >
        {updateArmed ? "Update the prompter" : "Update the prompter · press twice"}
      </ArmKey>
    ) : state.wayOut === "open-file" ? (
      <Key size="small" mode="primary" testId="teleprompter-state-open-file" onClick={openFile}>
        Open file…
      </Key>
    ) : undefined;

  // The shell (overhaul 3): the page's ⋯ on the state display. The visual
  // overhaul (2026-10-05): it is the one home of the standing commands, none
  // of which arms; they keep the standing keys' test ids.
  const pageMenu: MenuEntry[] = [
    {
      id: "open-file",
      label: "Open file…",
      value: ".docx or .txt",
      onSelect: openFile,
      testId: "teleprompter-open-file",
    },
    {
      id: "paste-script",
      label: "Paste as a new script",
      onSelect: onPasteScript,
      testId: "teleprompter-paste-script",
    },
    { id: "new-script", label: "New script", onSelect: onNewScript, testId: "teleprompter-new-script" },
  ];

  return (
    <div className={styles.cluster} data-testid="teleprompter-cluster">
      <StateDisplay
        tone={state.tone}
        word={state.word}
        sentence={state.sentence}
        // Beside the Update key the screen's mode would be cut: NOT UPDATED
        // says what matters, and the footer keeps the mode.
        meta={state.wayOut === "update" ? undefined : (state.meta ?? undefined)}
        actions={wayOut}
        // The way out's own key says it is armed, in the display's foot; the
        // armed row says what the second press of any other key does.
        armed={
          armed && !(updateArmed && state.wayOut === "update")
            ? { text: `${armedWords ?? armed.label} · press again`, timeoutMs: armed.timeoutMs }
            : null
        }
        testId="teleprompter-state-display"
        menu={
          <MenuButton
            buttonLabel="Teleprompter menu"
            buttonTestId="teleprompter-page-menu"
            menu={{ head: { title: "Teleprompter", detail: "Scripts" }, items: pageMenu, arm }}
          />
        }
      />

      {/* The shell (overhaul 3): the latch slot, the same on every page. */}
      <LatchSlot testId="teleprompter-latch-slot" />

      <div className={styles.take}>
        <Key
          cap="Play"
          // What a press does; a locked PLAY says nothing here, the state
          // display says why.
          hint={playLock !== null ? undefined : glass?.playing ? "press to pause" : `from ¶ ${placeParagraph + 1}`}
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

      <div className={styles.dials}>
        <div className={styles.dial} data-testid="teleprompter-speed">
          <DialCell word="Speed" tip="This script's own pace: 5 words a minute a press, from 40 to 300.">
            <Readout
              className={styles.cellValue}
              value={glass ? glass.speedWpm : undefined}
              unit="words/min"
              empty={!glass}
              testId="teleprompter-speed-readout"
            />
          </DialCell>
          <div className={styles.dialKeys}>
            <Key
              locked={(runLock ?? slowest) !== null}
              reason={runLock ?? slowest ?? undefined}
              take
              testId="teleprompter-speed-down"
              aria-label="Slower by 5 words a minute"
              onClick={() => void perform(() => store.setPrompterSpeed({ step: -1 }), false, TAKE)}
            >
              − 5
            </Key>
            <Key
              locked={(runLock ?? fastest) !== null}
              reason={runLock ?? fastest ?? undefined}
              take
              testId="teleprompter-speed-up"
              aria-label="Faster by 5 words a minute"
              onClick={() => void perform(() => store.setPrompterSpeed({ step: 1 }), false, TAKE)}
            >
              + 5
            </Key>
          </div>
        </div>
        <div className={styles.dial} data-testid="teleprompter-size">
          <DialCell
            word="Size"
            tip={`The glass's text size: 4 px a press, from ${SIZE_RANGE.min} to ${SIZE_RANGE.max} px. Standard returns to ${look.standardSizePx} px.`}
          >
            <span className={styles.cellValue} data-testid="teleprompter-text-size">
              <b>{sizePx}</b> <span className={styles.cellUnit}>px</span>{" "}
              <span>{atStandard ? "standard" : `standard ${look.standardSizePx}`}</span>
            </span>
          </DialCell>
          <div className={styles.sizeKeys}>
            <Key
              take
              testId="teleprompter-size-down"
              locked={smallest !== null}
              reason={smallest ?? undefined}
              aria-label="Smaller by 4 px"
              onClick={() => size({ step: -1 })}
            >
              − 4
            </Key>
            <Key
              take
              testId="teleprompter-size-up"
              locked={largest !== null}
              reason={largest ?? undefined}
              aria-label="Larger by 4 px"
              onClick={() => size({ step: 1 })}
            >
              + 4
            </Key>
            <Key
              take
              testId="teleprompter-size-standard"
              locked={atStandard}
              reason="The text is at the standard size."
              onClick={() => size({ standard: true })}
            >
              Standard
            </Key>
          </div>
        </div>
      </div>

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
        title={
          <Tooltip content="Press a paragraph to go to its start. The scroll stays as it was." placement="right">
            <span>Paragraphs</span>
          </Tooltip>
        }
        detail={
          glass
            ? shown.from === 0 && shown.to === rows.length
              ? `${rows.length}`
              : `¶ ${shown.from + 1}–${shown.to} of ${rows.length}`
            : undefined
        }
        className={styles.paragraphs}
        testId="teleprompter-paragraphs"
      >
        {glass ? (
          <ol className={styles.paragraphList} data-well="">
            {rows.slice(shown.from, shown.to).map((row) => {
              const current = row.index === placeParagraph && !glass.atEnd;
              return (
                <li key={row.index}>
                  <button
                    type="button"
                    className={styles.paragraphRow}
                    data-take=""
                    data-current={current ? "" : undefined}
                    aria-current={current ? "true" : undefined}
                    data-testid={`teleprompter-paragraph-${row.index + 1}`}
                    onClick={() => jump({ to: "paragraph", paragraph: row.index })}
                  >
                    <span className={styles.paragraphNumber}>{row.index + 1}</span>
                    <span className={styles.paragraphText} data-paragraph-text="">
                      {row.cue ? <i className={styles.paragraphCue}>{row.cue}</i> : null}
                      {row.cue && row.text ? " " : null}
                      {row.text}
                    </span>
                    <span className={styles.paragraphLength}>{row.length}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className={styles.none}>Nothing on the prompter</p>
        )}
      </Section>

      <ArmKey
        armed={armed?.key === CLEAR_ARM_KEY}
        timeoutMs={armed?.timeoutMs ?? ARM_TIMEOUT_MS}
        countdownTestId="teleprompter-clear-countdown"
        locked={runLock !== null}
        reason={runLock ?? undefined}
        take
        className={[styles.clear, styles.armRow].join(" ")}
        testId="teleprompter-clear"
        onClick={onClear}
      >
        {armed?.key === CLEAR_ARM_KEY ? "Clear the prompter" : "Clear the prompter · press twice"}
      </ArmKey>

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
      {reopened ? (
        <Dialog
          title={`${reopened.file.name} was opened before`}
          onClose={() => setReopened(null)}
          actions={
            <>
              <Key size="small" onClick={() => setReopened(null)}>
                Cancel
              </Key>
              <Key
                size="small"
                testId="teleprompter-reopen-add"
                onClick={() => {
                  setReopened(null);
                  void sendFile(reopened.file);
                }}
              >
                Add as a new script
              </Key>
              <Key
                size="small"
                mode="primary"
                testId="teleprompter-reopen-update"
                onClick={() => {
                  setReopened(null);
                  void sendFile(reopened.file, reopened.script.id);
                }}
              >
                Update {reopened.script.name}
              </Key>
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
  );
}
