import { useEffect, useMemo, useRef, useState } from "react";

import { ShellRegion, useArm } from "@sse/design-system";
import type {
  JsonObject,
  JsonValue,
  PrompterGlassSnapshot,
  PrompterHealthCheck,
  PrompterSnapshot,
  ShellStore,
} from "@sse/engine-client";

import { useToast } from "../shared/toastContext";
import { useLiveCallback } from "../shared/useLiveCallback";
import { ClipboardError, readClipboard } from "./clipboard";
import type { ScriptEditorHandle } from "./editor/ScriptEditor";
import type { PrompterGlassLayoutReport } from "./glass/PrompterGlass";
import { TAKE } from "./perform";
import { usePrompterTimeLeft } from "./prompterTime";
import { TeleprompterBay, type BayView } from "./TeleprompterBay";
import { TeleprompterCluster } from "./TeleprompterCluster";
import { TeleprompterEditView } from "./TeleprompterEditView";
import { TeleprompterFooter } from "./TeleprompterFooter";
import { TeleprompterPlate } from "./TeleprompterPlate";
import {
  backParagraph,
  cutGlassText,
  glassTextOf,
  placeView,
  prompterStateView,
  type ReportedLines,
} from "./teleprompterModel";
import styles from "./TeleprompterWorkspace.module.css";

// The Teleprompter page (new pages program, Slice 6a; board 1, "Live mirror",
// `docs/design/boards/A-teleprompter-1.html`, and the proposal,
// `docs/design/teleprompter.md`). The cluster runs the take, the bay
// shows the page's copy of the glass with the whole script under it, and the
// plate holds the scripts and the look. Everything it shows is the hardware
// link's (`teleprompterModel.ts`); it holds only what the operator is looking
// at: the selected script, the plate's lists and the one armed key.
//
// Replace, Update and Clear are armed (D11, the proposal §10); everything else
// is one press. A refusal comes back as the hardware link's sentence, shown as
// a notice. Slice 6b brings Edit script (the bay's second view), Rename, New
// script and Paste as a new script; the editor saves what was typed before
// any request, so an Update or a Put on takes the text as the operator sees it.

export interface TeleprompterWorkspaceProps {
  healthSnapshot: JsonObject | null;
  prompterSnapshot: PrompterSnapshot | null;
  prompterGlassSnapshot: PrompterGlassSnapshot | null;
  store: ShellStore;
}

/** What an action answers: the hardware link's sentence, when it gives one. */
function sentenceOf(result: JsonValue): string | null {
  return result && typeof result === "object" && !Array.isArray(result) && typeof result.sentence === "string"
    ? result.sentence
    : null;
}

/** A script's name in the armed row, cut so `· press again` stays in view. */
function armName(name: string): string {
  return name.length > ARM_NAME_ROOM ? `${name.slice(0, ARM_NAME_ROOM - 1)}…` : name;
}

/** The characters of a name the state display's armed row has room for beside its words. */
const ARM_NAME_ROOM = 20;

/** `checks.prompter` from the health snapshot; `null` while it is absent or could not be read. */
function prompterCheckOf(healthSnapshot: JsonObject | null): PrompterHealthCheck | null {
  const checks = healthSnapshot?.checks;
  if (!checks || typeof checks !== "object" || Array.isArray(checks)) return null;
  const check = (checks as JsonObject).prompter;
  return check && typeof check === "object" && !Array.isArray(check) ? (check as unknown as PrompterHealthCheck) : null;
}

export function TeleprompterWorkspace({
  healthSnapshot,
  prompterSnapshot,
  prompterGlassSnapshot,
  store,
}: TeleprompterWorkspaceProps) {
  const toast = useToast();
  const arm = useArm();
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [bayView, setBayView] = useState<BayView>("live");
  const editor = useRef<ScriptEditorHandle>(null);
  /** Saves what was typed in the editor, if it is open; false when the hardware link would not save it. */
  const flushEditor = async () => (editor.current ? editor.current.flush() : true);

  const glass = prompterSnapshot?.glass ?? null;
  const scripts = useMemo(() => prompterSnapshot?.scripts ?? [], [prompterSnapshot]);
  const removed = useMemo(() => prompterSnapshot?.removed ?? [], [prompterSnapshot]);
  // The script last on the prompter, kept after a Clear, so the selection
  // does not move to another script under the operator's next press.
  const onGlassId = glass?.scriptId ?? null;
  const [lastOnGlassId, setLastOnGlassId] = useState(onGlassId);
  if (onGlassId !== null && onGlassId !== lastOnGlassId) setLastOnGlassId(onGlassId);
  // The selected script: the operator's choice while it is in the list, else
  // the one on the prompter or last on it, else the first.
  const selected =
    scripts.find((script) => script.id === chosenId) ??
    scripts.find((script) => script.id === (onGlassId ?? lastOnGlassId)) ??
    scripts[0] ??
    null;

  const glassText = useMemo(
    () => glassTextOf(prompterSnapshot, prompterGlassSnapshot),
    [prompterSnapshot, prompterGlassSnapshot]
  );
  const cut = useMemo(() => cutGlassText(prompterGlassSnapshot), [prompterGlassSnapshot]);
  const check = useMemo(() => prompterCheckOf(healthSnapshot), [healthSnapshot]);
  const state = useMemo(
    () => (prompterSnapshot ? prompterStateView(prompterSnapshot, check, scripts.length > 0) : null),
    [check, prompterSnapshot, scripts.length]
  );
  const timeLeft = usePrompterTimeLeft(glass);
  // The layout the page's copy last reported: where its lines break, which
  // `BACK`'s hint reads (the hardware link works from the same layout).
  const [reported, setReported] = useState<ReportedLines | null>(null);
  // Both copies of the glass report their layout (the live copy and the
  // editor's quarter-size one): the same text laid out at the same 1,920 px.
  // A report the hardware link could not take is logged, never shown: the
  // glass reports again when the hardware link asks (`PrompterGlass`).
  const reportLayout = useLiveCallback((report: PrompterGlassLayoutReport) => {
    setReported(report);
    store.reportPrompterLayout(report).catch((error: unknown) => {
      store.reportBackgroundFailure(error, "the page's copy of the glass");
    });
  });

  // While the text scrolls the hardware link moves the place about once a
  // second and says nothing (it saves it; a take has no event a second), so
  // the page reads the prompter's state once a second to follow it: the place,
  // the paragraph at the reading line, the time left. It reads as often while
  // it waits: for the prompter's state when the start could not read it, and
  // while the text is not laid out, so a read of the glass's text that failed
  // is tried again (the store reads the text whenever its key has moved).
  const following = (glass?.playing ?? false) || !prompterSnapshot || (glass !== null && !glass.laidOut);
  useEffect(() => {
    if (!following) return undefined;
    const id = window.setInterval(() => {
      store
        .refreshPrompterSnapshot()
        .catch((error: unknown) => store.reportBackgroundFailure(error, "the prompter's place"));
    }, 1000);
    return () => window.clearInterval(id);
  }, [following, store]);

  /**
   * Sends one request; a refusal or a failure is the hardware link's
   * sentence, as a notice. What was typed is saved first, and an action does
   * not go ahead from text the hardware link would not save (the editor has
   * said why). The take's own controls (`TAKE`: play and pause, the jumps,
   * the speed, the look, Clear) neither wait for the save nor stop for it.
   */
  const perform = useLiveCallback(async (action: () => Promise<JsonValue>, announce = false, kind?: typeof TAKE) => {
    if (kind !== TAKE && !(await flushEditor())) return null;
    try {
      const result = await action();
      const sentence = announce ? sentenceOf(result) : null;
      if (sentence) toast.push({ tone: "ok", message: sentence });
      return result;
    } catch (error) {
      // The hardware link's refusals are sentences; anything else (the
      // request never answered) gets the page's own.
      toast.push({
        tone: "attention",
        message:
          error instanceof Error
            ? error.message
            : "The prompter did not answer. Look at what the page shows before pressing again.",
      });
      return null;
    }
  });

  const putOn = useLiveCallback(() => {
    if (!selected) return;
    if (!glass) {
      void perform(() => store.putOnPrompter(selected.id), true);
      return;
    }
    arm.armOrApply(
      `replace:${selected.id}`,
      `Replace with ${armName(selected.name)}`,
      () => void perform(() => store.putOnPrompter(selected.id, true), true)
    );
  });
  // Choosing another script drops an armed Replace: it named the script chosen
  // before. The editor closes on another script, so what was typed is saved
  // first, and a text that could not be saved keeps the editor open on it.
  const choose = useLiveCallback((scriptId: string) => {
    setChosenId(scriptId);
    if (arm.armed?.key.startsWith("replace:")) arm.clear();
  });
  const select = useLiveCallback(async (scriptId: string) => {
    if (scriptId !== selected?.id && !(await flushEditor())) return;
    choose(scriptId);
  });
  // Live copy closes the editor: the same.
  const showView = useLiveCallback(async (view: BayView) => {
    if (view !== bayView && view === "live" && !(await flushEditor())) return;
    setBayView(view);
  });
  const update = useLiveCallback(() => {
    if (!glass) return;
    arm.armOrApply("update", `Update ${armName(glass.name)}`, () => void perform(() => store.updatePrompter(), true));
  });
  const clear = useLiveCallback(() => {
    if (!glass) return;
    arm.armOrApply("clear", "Clear the prompter", () => void perform(() => store.clearPrompter(), true, TAKE));
  });
  const notice = useLiveCallback((tone: "ok" | "attention", message: string) => toast.push({ tone, message }));
  /** Selects the script a request answered with (a new one, a pasted one, an import). */
  const selectAnswered = (result: JsonValue | null) => {
    const scriptId =
      result && typeof result === "object" && !Array.isArray(result) && typeof result.scriptId === "string"
        ? result.scriptId
        : null;
    // The request's own `perform` saved what was typed first.
    if (scriptId) choose(scriptId);
    return scriptId;
  };
  // New script opens an empty script in the editor (§3.1).
  const newScript = useLiveCallback(async () => {
    if (selectAnswered(await perform(() => store.createPrompterScript()))) setBayView("edit");
  });
  // Paste as a new script: the clipboard as the page reads it, read by the hardware link (§3.1).
  const pasteScript = useLiveCallback(async () => {
    let content;
    try {
      content = await readClipboard();
    } catch (error) {
      notice("attention", error instanceof ClipboardError ? error.message : String(error));
      return;
    }
    selectAnswered(await perform(() => store.pastePrompterScript(content), true));
  });

  if (!prompterSnapshot || !state) {
    return (
      <div className={styles.waiting} data-testid="teleprompter-workspace" data-workspace="teleprompter">
        <p className={styles.waitingText}>Reading the prompter's state…</p>
      </div>
    );
  }

  return (
    <div className={styles.workspace} data-testid="teleprompter-workspace" data-workspace="teleprompter">
      <ShellRegion region="cluster">
        <TeleprompterCluster
          armed={arm.armed}
          cut={cut}
          onClear={clear}
          onUpdate={update}
          onPutOn={putOn}
          perform={perform}
          selected={selected}
          backTo={glass ? backParagraph(glass, reported) : 0}
          onNewScript={() => void newScript()}
          onPasteScript={() => void pasteScript()}
          onImported={selectAnswered}
          scripts={scripts}
          snapshot={prompterSnapshot}
          state={state}
          store={store}
        />
      </ShellRegion>
      <TeleprompterBay
        cut={cut}
        editLock={selected ? null : "There is no script to edit. Open a file, paste one or make a new script."}
        editView={
          selected ? (
            <TeleprompterEditView
              editor={editor}
              glassSnapshot={prompterGlassSnapshot}
              glassText={glassText}
              onLayout={reportLayout}
              onNotice={notice}
              place={glass && cut.length > 0 ? placeView(glass, cut).text : null}
              script={selected}
              snapshot={prompterSnapshot}
              store={store}
            />
          ) : null
        }
        glassText={glassText}
        onLayout={reportLayout}
        onView={(view) => void showView(view)}
        perform={perform}
        snapshot={prompterSnapshot}
        store={store}
        timeLeft={timeLeft}
        view={selected ? bayView : "live"}
      />
      <ShellRegion region="plate">
        <TeleprompterPlate
          armed={arm.armed}
          onPutOn={putOn}
          onSelect={select}
          onUpdate={update}
          perform={perform}
          removed={removed}
          scripts={scripts}
          selected={selected}
          snapshot={prompterSnapshot}
          store={store}
        />
      </ShellRegion>
      <ShellRegion region="footer">
        <TeleprompterFooter cut={cut} snapshot={prompterSnapshot} timeLeft={timeLeft} />
      </ShellRegion>
    </div>
  );
}
