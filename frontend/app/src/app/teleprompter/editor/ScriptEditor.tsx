import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type Ref,
} from "react";

import { Key } from "@sse/design-system";
import type { PrompterParagraph, PrompterScriptSummary, ShellStore } from "@sse/engine-client";

import { ClipboardError, pastedContent, readClipboard } from "../clipboard";
import { glassParagraphs } from "../glass/glassText";
import { formatDuration } from "../prompterTime";
import { clockTime, readWordsOf } from "../teleprompterModel";
import {
  cueHighlightRanges,
  isParagraphElement,
  PARAGRAPH_ATTRIBUTE,
  paragraphsMarkup,
  readParagraph,
  renderParagraph,
} from "./editorDom";
import { editedParagraphs, readingLineIn, withAParagraph, type Paragraph } from "./editorModel";
import styles from "./ScriptEditor.module.css";

// The script editor (new pages program, Slice 6b; the proposal §6.3, board 1's
// Edit script): the app's own rich-text field over the script's paragraphs of
// runs (Slice 6's first step 4), on the browser's editable text. It adds no
// key of its own (D6): typing, Enter, the arrows, selecting, copy, cut and the
// browser's own undo and redo are a text field's (first step 2), and the bar's
// Undo and Redo are the same undo. The browser makes the edits, so its undo
// covers them; the editor reads the script back from the page after each one.
// The browser's formatting keys are cancelled (formatting comes from the
// bar), a drop is cancelled, and a paste is read by the hardware link's own
// reader (`prompter.paste.convert`, first step 3 of Slice 6b) before it goes
// in. The text is saved as the operator types (§3.3), a moment after the last
// change; a script on the prompter keeps its glass text until Update.

/** How long after the last change the text is saved. */
const SAVE_AFTER_MS = 600;
/** The name the cues' highlight goes by (`::highlight()` in the stylesheet). */
const CUE_HIGHLIGHT = "teleprompter-cue";
/** What the browser may not do to the text: its formatting, lists, links and drops. */
const CANCELLED_INPUT =
  /^(format|insertFromDrop|deleteByDrag|insert(Ordered|Unordered)List|insertHorizontalRule|insertLink)/;

type SaveState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "saving" }
  | { kind: "saved"; at: string }
  | { kind: "unsaved"; sentence: string };

interface Counts {
  words: number;
  paragraphs: number;
  cues: number;
}

export interface ScriptEditorMarks {
  /** The editor's paragraphs the glass does not show as they are (from 0). */
  edited: number[];
  /** The editor's paragraph at the reading line, while the script is on the glass. */
  readingLine: number | null;
}

/** What the page asks of the editor: to save what was typed now, before an action reads the script's text. */
export interface ScriptEditorHandle {
  flush(): Promise<void>;
}

export interface ScriptEditorProps {
  ref?: Ref<ScriptEditorHandle>;
  script: PrompterScriptSummary;
  store: ShellStore;
  /** This script is on the prompter. */
  onGlass: boolean;
  /** The text the glass shows, while this script is on it (for the gutter's marks). */
  glassText: readonly PrompterParagraph[] | null;
  /** The glass's paragraph at the reading line, in the glass's text. */
  glassPlace: number | null;
  /** A refusal or a sentence to show as a notice. */
  onNotice: (tone: "ok" | "attention", message: string) => void;
  onMarks?: (marks: ScriptEditorMarks) => void;
}

function countsOf(paragraphs: readonly Paragraph[]): Counts {
  const cut = glassParagraphs(paragraphs);
  const words = readWordsOf(cut).reduce((sum, count) => sum + count, 0);
  const cues = cut.reduce((sum, paragraph) => sum + paragraph.lines.filter((line) => line.cueLine).length, 0);
  return { words, paragraphs: paragraphs.length, cues };
}

function errorSentence(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** The browser's own editing command (its undo, its bold): the one route for the bar's keys. */
function command(name: string, value?: string): boolean {
  return typeof document.execCommand === "function" ? document.execCommand(name, false, value) : false;
}

function commandState(name: string): boolean {
  try {
    return typeof document.queryCommandState === "function" ? document.queryCommandState(name) : false;
  } catch {
    return false;
  }
}

function commandEnabled(name: string): boolean {
  try {
    return typeof document.queryCommandEnabled === "function" ? document.queryCommandEnabled(name) : false;
  } catch {
    return false;
  }
}

/** The element of the editor's text a node is in (a paragraph, or text left outside one). */
function blockOf(root: HTMLElement, node: Node | null): Node | null {
  let block = node;
  while (block && block.parentNode !== root) block = block.parentNode;
  return block;
}

export function ScriptEditor({
  ref,
  script,
  store,
  onGlass,
  glassText,
  glassPlace,
  onNotice,
  onMarks,
}: ScriptEditorProps) {
  const field = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLDivElement>(null);
  /** The script as the editor last read it from the page. */
  const model = useRef<Paragraph[] | null>(null);
  /** Each paragraph element's reading, until the browser changes it. */
  const read = useRef(new WeakMap<Node, Paragraph>());
  /** Where the caret was in the text, for the bar's keys after the focus left it. */
  const caret = useRef<Range | null>(null);
  const dirty = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const saving = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);
  /** The script's `changedAt` the editor opened or saved last: another value means it changed elsewhere. */
  const ownChangedAt = useRef<string | null>(null);
  const decorateFrame = useRef<number | null>(null);
  /** A fresh editable element for each text read in, so the browser's undo never reaches across. */
  const [generation, setGeneration] = useState(0);
  const [loaded, setLoaded] = useState<"loading" | "ready" | "failed">("loading");
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [counts, setCounts] = useState<Counts | null>(null);
  const [format, setFormat] = useState({ bold: false, italic: false, underline: false });
  const [history, setHistory] = useState({ undo: false, redo: false });

  const glass = useRef({ glassText, glassPlace, onGlass, onMarks });
  glass.current = { glassText, glassPlace, onGlass, onMarks };

  // ---- the text on the page ------------------------------------------------

  /** The marks in the gutter and the cues' highlight, after a change or a new glass text. */
  const decorate = useCallback(() => {
    const root = text.current;
    const paragraphs = model.current;
    if (!root || !paragraphs) return;
    const { glassText: shown, glassPlace: place, onGlass: isOn, onMarks: report } = glass.current;
    const edited = isOn && shown ? editedParagraphs(paragraphs, shown) : new Set<number>();
    const readingLine = isOn && shown && place !== null ? readingLineIn(paragraphs, shown, place) : null;
    let index = 0;
    for (const child of root.childNodes) {
      if (!isParagraphElement(child)) continue;
      const mark = index === readingLine ? "reading line" : edited.has(index) ? "edited" : null;
      if (mark) child.setAttribute("data-mark", mark);
      else child.removeAttribute("data-mark");
      if (edited.has(index)) child.setAttribute("data-edited", "");
      else child.removeAttribute("data-edited");
      index += 1;
    }
    if (typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight === "function") {
      CSS.highlights.set(CUE_HIGHLIGHT, new Highlight(...cueHighlightRanges(root)));
    }
    report?.({ edited: [...edited], readingLine });
  }, []);

  /** Marks and highlights once a frame, however fast the typing. */
  const decorateSoon = useCallback(() => {
    if (decorateFrame.current !== null) return;
    decorateFrame.current = window.requestAnimationFrame(() => {
      decorateFrame.current = null;
      decorate();
    });
  }, [decorate]);

  /** Reads the script back from the page: each paragraph element read once until it changes. */
  const readBack = useCallback(() => {
    const root = text.current;
    if (!root) return;
    const paragraphs: Paragraph[] = [];
    let loose: Node[] = [];
    const flushLoose = () => {
      if (loose.length === 0) return;
      const holder = document.createElement("span");
      for (const node of loose) holder.appendChild(node.cloneNode(true));
      paragraphs.push(readParagraph(holder));
      loose = [];
    };
    for (const child of root.childNodes) {
      if (!isParagraphElement(child)) {
        loose.push(child);
        continue;
      }
      flushLoose();
      // A paragraph the browser made (Enter, a paste) takes the editor's own look.
      if (!child.hasAttribute(PARAGRAPH_ATTRIBUTE)) child.setAttribute(PARAGRAPH_ATTRIBUTE, "");
      if (!child.classList.contains(styles.paragraph!)) child.classList.add(styles.paragraph!);
      let paragraph = read.current.get(child);
      if (!paragraph) {
        paragraph = readParagraph(child);
        read.current.set(child, paragraph);
      }
      paragraphs.push(paragraph);
    }
    flushLoose();
    model.current = withAParagraph(paragraphs);
  }, []);

  const showCommands = useCallback(() => {
    setFormat({ bold: commandState("bold"), italic: commandState("italic"), underline: commandState("underline") });
    setHistory({ undo: commandEnabled("undo"), redo: commandEnabled("redo") });
  }, []);

  // ---- saving --------------------------------------------------------------

  const saveNow = useCallback(async () => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (saving.current) await saving.current;
    const paragraphs = model.current;
    if (!dirty.current || !paragraphs) return;
    dirty.current = false;
    if (mounted.current) {
      setSave({ kind: "saving" });
      setCounts(countsOf(paragraphs));
    }
    const pending = store
      .editPrompterScript(script.id, paragraphs)
      .then((answer) => {
        const changedAt =
          answer && typeof answer === "object" && !Array.isArray(answer) && typeof answer.changedAt === "string"
            ? answer.changedAt
            : new Date().toISOString();
        ownChangedAt.current = changedAt;
        if (mounted.current && !dirty.current) setSave({ kind: "saved", at: changedAt });
      })
      .catch((error: unknown) => {
        dirty.current = true;
        const sentence = errorSentence(error, "The script could not be saved. Your text is still here.");
        if (mounted.current) {
          setSave({ kind: "unsaved", sentence });
          onNotice("attention", sentence);
        }
      })
      .finally(() => {
        saving.current = null;
      });
    saving.current = pending;
    await pending;
  }, [onNotice, script.id, store]);

  useImperativeHandle(ref, () => ({ flush: saveNow }), [saveNow]);

  const scheduleSave = useCallback(() => {
    dirty.current = true;
    setSave({ kind: "pending" });
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      void saveNow();
    }, SAVE_AFTER_MS);
  }, [saveNow]);

  // ---- the browser's input -------------------------------------------------

  /** Puts the caret back in the text where it was, for a key of the bar or a paste. */
  const refocus = useCallback((at: Range | null = caret.current) => {
    const root = text.current;
    const page = window.getSelection();
    if (!root || !page) return;
    if (document.activeElement !== root) root.focus({ preventScroll: true });
    if (at && root.contains(at.startContainer) && root.contains(at.endContainer)) {
      page.removeAllRanges();
      page.addRange(at);
    }
  }, []);

  /** Inserts what was pasted, read by the hardware link, where `at` is. */
  const pasteInto = useCallback(
    async (content: { html?: string; text?: string }, at: Range | null) => {
      try {
        const converted = await store.convertPrompterPaste(content);
        if (!mounted.current || !text.current) return;
        refocus(at);
        command("insertHTML", paragraphsMarkup(converted.paragraphs));
        // The reader's sentence only when it left something out (a picture, a comment).
        if (converted.sentence.includes("Left out")) onNotice("ok", converted.sentence);
      } catch (error) {
        onNotice("attention", errorSentence(error, "The pasted text could not be read."));
      }
    },
    [onNotice, refocus, store]
  );

  useEffect(() => {
    const root = text.current;
    if (!root || loaded !== "ready") return undefined;
    // The browser's own paragraphs are `<p>`, and its bold is `<b>` (not a style).
    command("defaultParagraphSeparator", "p");
    command("styleWithCSS", "false");

    const forget = (records: MutationRecord[]) => {
      for (const record of records) {
        const block = blockOf(root, record.target);
        if (block) read.current.delete(block);
      }
    };
    const observer = new MutationObserver(forget);
    observer.observe(root, { childList: true, characterData: true, subtree: true });

    const onBeforeInput = (event: InputEvent) => {
      const type = event.inputType;
      if (type === "insertFromPaste" || type === "insertFromPasteAsQuotation") {
        event.preventDefault();
        const content = pastedContent(event.dataTransfer);
        const page = window.getSelection();
        const at = page && page.rangeCount > 0 ? page.getRangeAt(0).cloneRange() : null;
        if (content) void pasteInto(content, at);
        return;
      }
      // The browser's formatting keys, lists, links and drops: cancelled.
      // Typing, deleting, Enter and the browser's undo and redo are the text
      // field's own (D6; Slice 6's first step 2).
      if (CANCELLED_INPUT.test(type)) event.preventDefault();
    };
    const onInput = (event: Event) => {
      if ((event as InputEvent).isComposing) return; // read back when the composing ends
      forget(observer.takeRecords());
      readBack();
      decorateSoon();
      scheduleSave();
      showCommands();
    };
    const onCompositionEnd = () => onInput(new Event("input"));
    const onSelectionChange = () => {
      const page = window.getSelection();
      if (!page || page.rangeCount === 0) return;
      const range = page.getRangeAt(0);
      if (!root.contains(range.startContainer)) return;
      caret.current = range.cloneRange();
      showCommands();
    };

    root.addEventListener("beforeinput", onBeforeInput);
    root.addEventListener("input", onInput);
    root.addEventListener("compositionend", onCompositionEnd);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      observer.disconnect();
      root.removeEventListener("beforeinput", onBeforeInput);
      root.removeEventListener("input", onInput);
      root.removeEventListener("compositionend", onCompositionEnd);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [decorateSoon, generation, loaded, pasteInto, readBack, scheduleSave, showCommands]);

  // ---- opening and closing -------------------------------------------------

  const open = useCallback(
    (isCurrent: () => boolean) =>
      store.readPrompterScript(script.id).then(
        (answer) => {
          if (!isCurrent()) return;
          model.current = withAParagraph(answer.paragraphs);
          ownChangedAt.current = answer.script.changedAt;
          setCounts(countsOf(model.current));
          setGeneration((value) => value + 1);
          setLoaded("ready");
        },
        (error: unknown) => {
          if (!isCurrent()) return;
          setLoaded("failed");
          onNotice("attention", errorSentence(error, "The script could not be opened."));
        }
      ),
    [onNotice, script.id, store]
  );

  useEffect(() => {
    mounted.current = true;
    let current = true;
    void open(() => current);
    return () => {
      current = false;
      mounted.current = false;
      if (decorateFrame.current !== null) window.cancelAnimationFrame(decorateFrame.current);
      if (typeof CSS !== "undefined" && "highlights" in CSS) CSS.highlights.delete(CUE_HIGHLIGHT);
      // Whatever was typed is saved when the editor closes.
      if (saveTimer.current !== null || dirty.current) void saveNow();
    };
    // The editor is keyed by the script; opening is once a script.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The text changed elsewhere (a version brought back, the file opened
  // again, a backup restored): read it again, unless the operator's own
  // typing is still to be saved — the page saves it before any such request.
  useEffect(() => {
    if (loaded !== "ready" || ownChangedAt.current === null) return undefined;
    if (script.changedAt === ownChangedAt.current) return undefined;
    if (dirty.current || saving.current) return undefined;
    let current = true;
    void open(() => current && mounted.current);
    return () => {
      current = false;
    };
  }, [loaded, open, script.changedAt]);

  // The text drawn in a fresh element; opened at the reading line for the script on the prompter.
  useLayoutEffect(() => {
    const root = text.current;
    const paragraphs = model.current;
    if (loaded !== "ready" || !root || !paragraphs) return;
    read.current = new WeakMap();
    root.replaceChildren(
      ...paragraphs.map((paragraph) => {
        const element = renderParagraph(document, paragraph, styles.paragraph!);
        read.current.set(element, paragraph);
        return element;
      })
    );
    decorate();
    const line = root.querySelector<HTMLElement>('[data-mark="reading line"]');
    const scroller = field.current;
    if (line && scroller) scroller.scrollTop = Math.max(line.offsetTop - scroller.clientHeight / 3, 0);
  }, [decorate, generation, loaded]);

  // The gutter's marks follow the glass: its text on Update, its place.
  useEffect(() => {
    if (loaded === "ready") decorate();
  }, [decorate, glassPlace, glassText, loaded, onGlass]);

  // ---- the bar -------------------------------------------------------------

  const keepFocus = { onMouseDown: (event: MouseEvent) => event.preventDefault() };

  /** One of the browser's own editing commands, on the text where the caret was. */
  const run = (name: string) => {
    if (loaded !== "ready") return;
    refocus();
    command(name);
  };

  const addCue = () => {
    if (loaded !== "ready") return;
    refocus();
    const page = window.getSelection();
    if (!page || page.rangeCount === 0) return;
    if (page.isCollapsed) {
      command("insertText", "[]");
      page.modify("move", "backward", "character");
    } else {
      // A selection becomes the cue's words.
      command("insertText", `[${page.toString()}]`);
    }
  };

  const pasteFromClipboard = async () => {
    const at = caret.current?.cloneRange() ?? null;
    try {
      await pasteInto(await readClipboard(), at);
    } catch (error) {
      onNotice("attention", error instanceof ClipboardError ? error.message : errorSentence(error, ""));
    }
  };

  const status =
    save.kind === "saving"
      ? "Saving…"
      : save.kind === "pending"
        ? "Edited"
        : save.kind === "unsaved"
          ? "Not saved"
          : save.kind === "saved"
            ? `Saved ${clockTime(save.at)}`
            : `Saved ${clockTime(script.changedAt)}`;
  const length = counts && script.speedWpm > 0 ? formatDuration((counts.words * 60) / script.speedWpm) : null;

  return (
    <div className={styles.editor} data-testid="teleprompter-editor">
      <div className={styles.bar} role="toolbar" aria-label="The script's text">
        <Key
          size="small"
          engaged={format.bold}
          testId="teleprompter-editor-bold"
          {...keepFocus}
          onClick={() => run("bold")}
        >
          Bold
        </Key>
        <Key
          size="small"
          engaged={format.italic}
          testId="teleprompter-editor-italic"
          {...keepFocus}
          onClick={() => run("italic")}
        >
          Italic
        </Key>
        <Key
          size="small"
          engaged={format.underline}
          testId="teleprompter-editor-underline"
          {...keepFocus}
          onClick={() => run("underline")}
        >
          Underline
        </Key>
        <Key size="small" testId="teleprompter-editor-cue" {...keepFocus} onClick={addCue}>
          Add cue
        </Key>
        <Key
          size="small"
          locked={!history.undo}
          reason="Nothing to undo."
          testId="teleprompter-editor-undo"
          {...keepFocus}
          onClick={() => run("undo")}
        >
          Undo
        </Key>
        <Key
          size="small"
          locked={!history.redo}
          reason="Nothing to redo."
          testId="teleprompter-editor-redo"
          {...keepFocus}
          onClick={() => run("redo")}
        >
          Redo
        </Key>
        <Key size="small" testId="teleprompter-editor-paste" {...keepFocus} onClick={() => void pasteFromClipboard()}>
          Paste
        </Key>
      </div>
      <div ref={field} className={styles.field} data-well="">
        {loaded === "loading" ? <p className={styles.opening}>Opening {script.name}…</p> : null}
        {loaded === "failed" ? <p className={styles.opening}>{script.name} could not be opened.</p> : null}
        <div
          key={generation}
          ref={text}
          className={styles.text}
          contentEditable={loaded === "ready"}
          suppressContentEditableWarning
          spellCheck={false}
          role="textbox"
          aria-multiline="true"
          aria-label={`The text of ${script.name}`}
          data-testid="teleprompter-editor-text"
        />
      </div>
      <div className={styles.status} data-testid="teleprompter-editor-status">
        {counts ? (
          <>
            <span>
              <b>{counts.words.toLocaleString("en-GB")}</b> words
            </span>
            <span>
              <b>{counts.paragraphs}</b> {counts.paragraphs === 1 ? "paragraph" : "paragraphs"}
            </span>
            <span>
              <b>{counts.cues}</b> {counts.cues === 1 ? "cue" : "cues"}
            </span>
            {length ? (
              <span>
                <b>{length}</b> at {script.speedWpm} words/min
              </span>
            ) : null}
          </>
        ) : null}
        <span data-testid="teleprompter-editor-saved" data-save={save.kind}>
          {status}
        </span>
        <span className={styles.note}>
          {onGlass ? "Studio Control's copy · the glass changes only on Update" : "Not on the prompter"}
        </span>
      </div>
    </div>
  );
}
