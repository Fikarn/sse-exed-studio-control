import { useState, type Ref } from "react";

import type { PrompterGlassSnapshot, PrompterScriptSummary, PrompterSnapshot, ShellStore } from "@sse/engine-client";

import { ScriptEditor, type ScriptEditorHandle, type ScriptEditorMarks } from "./editor/ScriptEditor";
import { PrompterGlass, type PrompterGlassLayoutReport, type PrompterGlassText } from "./glass/PrompterGlass";
import styles from "./TeleprompterEditView.module.css";

// The bay's editor view (new pages program, Slice 6b; board 1's Edit script,
// the proposal §6.3): the selected script's editor, and beside it what the
// glass shows now, a quarter of its size — the same glass component, never a
// second layout — with what the edits change on it. The selected script is
// not necessarily the one on the prompter.

/** The quarter-size copy: a quarter of the Prompter XL's 1,920 px. */
const QUARTER_WIDTH = 480;

const QUARTER =
  "While you edit, the glass shows here at a quarter of its size; Live copy brings back the full-size copy.";

export interface TeleprompterEditViewProps {
  script: PrompterScriptSummary;
  snapshot: PrompterSnapshot;
  glassSnapshot: PrompterGlassSnapshot | null;
  glassText: PrompterGlassText | null;
  place: string | null;
  store: ShellStore;
  editor: Ref<ScriptEditorHandle>;
  onLayout: (report: PrompterGlassLayoutReport) => void;
  onNotice: (tone: "ok" | "attention", message: string) => void;
}

export function TeleprompterEditView({
  script,
  snapshot,
  glassSnapshot,
  glassText,
  place,
  store,
  editor,
  onLayout,
  onNotice,
}: TeleprompterEditViewProps) {
  const glass = snapshot.glass;
  const onGlass = glass?.scriptId === script.id;
  const [marks, setMarks] = useState<ScriptEditorMarks>({ edited: [], readingLine: null });
  const glassParagraphs = onGlass && glassSnapshot ? glassSnapshot.paragraphs : null;

  const note = !glass
    ? `Put on the prompter puts ${script.name} on the glass, at its own place. ${QUARTER}`
    : onGlass && glass.notUpdated
      ? `The presenter reads the text that went on the glass until you update the prompter. On Update, the same words stay at the reading line. ${QUARTER}`
      : onGlass
        ? `Edits change Studio Control's copy first; the glass keeps its text until you update the prompter. ${QUARTER}`
        : `Edits to ${script.name} change nothing on the glass. Replace on the prompter puts it on, at its own place. ${QUARTER}`;

  const editedList =
    marks.edited.length === 0
      ? "nothing"
      : marks.edited.length <= 6
        ? marks.edited.map((index) => `¶ ${index + 1}`).join(" · ")
        : `${marks.edited.length} paragraphs`;

  return (
    <div className={styles.view} data-testid="teleprompter-edit-view">
      <ScriptEditor
        key={script.id}
        ref={editor}
        script={script}
        store={store}
        onGlass={onGlass}
        glassText={glassParagraphs}
        glassPlace={onGlass && glass && !glass.atEnd ? glass.place.paragraph : null}
        onNotice={onNotice}
        onMarks={setMarks}
      />
      <aside className={styles.glassNow} aria-label="On the glass now" data-testid="teleprompter-glass-now">
        <div className={styles.head}>
          <span className={styles.label}>On the glass now</span>
          <span className={styles.detail}>{glass ? glass.name : "nothing"}</span>
        </div>
        <div className={styles.quarter} data-on-glass={snapshot.screen.draws ? "" : undefined}>
          <PrompterGlass
            text={glassText}
            anchor={glass?.anchor ?? null}
            width={QUARTER_WIDTH}
            onLayout={onLayout}
            label="The Prompter XL's screen, a quarter of its size"
            testId="teleprompter-quarter-copy"
          />
        </div>
        {glass ? (
          <dl className={styles.readouts} data-well="">
            <dt>Place</dt>
            <dd>
              {place ?? "—"} · {glass.playing ? "playing" : glass.atEnd ? "at the end" : "paused"}
            </dd>
            {onGlass ? (
              <>
                <dt>Edited since it went on</dt>
                <dd data-edited={marks.edited.length > 0 ? "" : undefined} data-testid="teleprompter-edited-list">
                  {editedList}
                </dd>
                <dt>At the reading line</dt>
                <dd>
                  {marks.readingLine !== null && marks.edited.includes(marks.readingLine) ? "edited" : "unchanged"}
                </dd>
              </>
            ) : (
              <>
                <dt>You are editing</dt>
                <dd>{script.name}</dd>
              </>
            )}
          </dl>
        ) : (
          <p className={styles.nothing}>Nothing on the prompter</p>
        )}
        <p className={styles.note} data-testid="teleprompter-edit-note">
          {note}
        </p>
      </aside>
    </div>
  );
}
