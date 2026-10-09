import { useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";

import { EmptyLine, Key, LampWord, Segmented, Tooltip, Well } from "@sse/design-system";
import type { PrompterJumpRequest, PrompterSnapshot, ShellStore } from "@sse/engine-client";

import type { GlassParagraph } from "./glass/glassText";
import { PrompterGlass, type PrompterGlassLayoutReport, type PrompterGlassText } from "./glass/PrompterGlass";
import { barStart, cueKeys, paragraphAt, placeView, runStateWord, scriptBar, timeLeftParts } from "./teleprompterModel";
import { TAKE, type PerformAction } from "./perform";
import styles from "./TeleprompterBay.module.css";

// The Teleprompter's bay (new pages program, Slice 6a; board 1's centre, the
// proposal §6.1–6.2): what is on the glass, the place and the time left over
// the page's copy of the glass, the copy itself — the glass component scaled
// to the bay, the same lines, never a second layout — and under it the whole
// script at one width, the cue keys and Go to paragraph. The copy is a picture:
// nothing is drawn on it that the presenter does not see, and the mouse wheel
// never moves it. It reports its layout to the hardware link, which runs the
// clock on it (Slice 4).
//
// The visual overhaul (2026-10-05): the view shown is the Beige selection, the
// run state and Not on the glass are state words in capitals, the bar's
// sentence is a tooltip on its word, and the bar and Go are marked take-time.
// The copy itself, the glass's props and its layout report are as they were.
//
// The polish (2026-10-05): the strip says what is on the prompter, which stays
// true while the Prompter XL draws nothing (NOT ON THE GLASS completes it),
// and its three readouts share one baseline, an empty time a small dash like
// the place's. The bar's head leaves the share read to the strip. The cue
// keys, the Go to paragraph field and Go are one 36 px row, the field's label
// before it; the cues are upright (PT Sans has no italic). Nothing on the
// prompter is the design system's empty line.

/** The copy across the bay, 1,680 × 945: 87.5 % of the Prompter XL's pixels (the proposal §6.1;
 *  the shell, overhaul 3, made the bay 1,680 wide). */
export const COPY_WIDTH = 1680;

export interface TeleprompterBayProps {
  snapshot: PrompterSnapshot;
  glassText: PrompterGlassText | null;
  cut: readonly GlassParagraph[];
  timeLeft: number | null;
  store: ShellStore;
  perform: PerformAction;
  /** Reports the copy's layout to the hardware link (and keeps it for `BACK`'s hint). */
  onLayout: (report: PrompterGlassLayoutReport) => void;
  /** What the bay shows: the live copy, or the selected script's editor (Slice 6b). */
  view: BayView;
  onView: (view: BayView) => void;
  /** Why Edit script is locked (no script to edit), or `null`. */
  editLock: string | null;
  /** The editor's view, drawn in place of the copy while `view` is `edit`. */
  editView: ReactNode;
}

export type BayView = "live" | "edit";

/** `1 cue`, `3 cues`. */
function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Three rows of 36 px cue keys, 8 px apart (`.cues`' height in the CSS). */
const CUE_ROWS_HEIGHT = 124;

/** The most paragraphs the script bar draws one by one: about 14 px each across the bay. */
const BAR_SEGMENT_ROOM = 120;

export function TeleprompterBay({
  snapshot,
  glassText,
  cut,
  timeLeft,
  store,
  perform,
  onLayout,
  view,
  onView,
  editLock,
  editView,
}: TeleprompterBayProps) {
  const glass = snapshot.glass;
  const draws = snapshot.screen.draws;
  const [goTo, setGoTo] = useState("");
  const jump = (request: PrompterJumpRequest) => void perform(() => store.jumpPrompter(request), false, TAKE);
  const place = glass && cut.length > 0 ? placeView(glass, cut) : null;
  const segments = useMemo(() => scriptBar(cut), [cut]);
  const track = useRef<HTMLSpanElement>(null);
  // Already read: the paragraphs before the one at the reading line.
  const readUpTo = glass ? (glass.atEnd ? glass.paragraphCount : glass.place.paragraph) : 0;
  // Past a paragraph for every 14 px the bar has, the segments are drawn as
  // the part read and the part to read (the shares, the ticks and a press stay the same).
  const dense = segments.length > BAR_SEGMENT_ROOM;
  const time = glass && timeLeft !== null ? timeLeftParts(glass, timeLeft, new Date()) : null;

  const pressBar = (event: MouseEvent<HTMLButtonElement>) => {
    if (!glass || segments.length === 0) return;
    const bar = track.current?.getBoundingClientRect();
    // A press made with a key has no position: it goes to the start of the paragraph at the reading line.
    const paragraph =
      event.detail === 0 || !bar || bar.width <= 0
        ? Math.min(glass.place.paragraph, segments.length - 1)
        : paragraphAt(segments, Math.min(Math.max((event.clientX - bar.left) / bar.width, 0), 0.999999));
    jump({ to: "paragraph", paragraph });
  };

  // Only the Go key jumps: the field is not a form, so Enter in it does
  // nothing (D6: Studio Control binds no key).
  const goToNumber = Number.parseInt(goTo, 10);
  const goToProblem = !glass
    ? null
    : !Number.isInteger(goToNumber)
      ? "Type a paragraph number first."
      : goToNumber < 1 || goToNumber > glass.paragraphCount
        ? `The script has paragraphs 1–${glass.paragraphCount}.`
        : null;
  const goToParagraph = () => {
    if (!glass || goToProblem !== null) return;
    setGoTo("");
    jump({ to: "paragraph", paragraph: goToNumber - 1 });
  };

  const cues = useMemo(() => (glass ? cueKeys(glass.cues) : []), [glass]);
  // The cue keys take three rows at most; the ones that would not fit are not
  // drawn (a clipped key could still take a press or the focus). Measured
  // once for each list of cues, drawn whole first.
  const cueRow = useRef<HTMLDivElement>(null);
  const cueSignature = cues.map((cue) => `${cue.paragraph}:${cue.word}:${cue.text}`).join("|");
  const [cueFit, setCueFit] = useState<{ signature: string; count: number } | null>(null);
  const shownCues = cueFit?.signature === cueSignature ? cues.slice(0, cueFit.count) : cues;
  useLayoutEffect(() => {
    if (cueFit?.signature === cueSignature) return;
    const row = cueRow.current;
    if (!row) return;
    const bottom = row.getBoundingClientRect().top + CUE_ROWS_HEIGHT;
    const keys = [...row.querySelectorAll<HTMLElement>("[data-cue-key]")];
    const fits = keys.findIndex((key) => key.getBoundingClientRect().bottom > bottom + 0.5);
    setCueFit({ signature: cueSignature, count: fits === -1 ? keys.length : fits });
  }, [cueFit, cueSignature]);
  const readWords =
    cut.length > 0 && glass
      ? `${counted(glass.paragraphCount, "paragraph", "paragraphs")} · ${counted(glass.cues.length, "cue", "cues")}`
      : "";

  return (
    <section className={styles.bay} data-testid="teleprompter-bay" aria-label="The prompter's glass">
      <div className={styles.bayHead}>
        <Segmented label="The bay shows" className={styles.views} testId="teleprompter-bay-view">
          <Key
            mode="segmented"
            selected={view === "live"}
            aria-pressed={view === "live"}
            testId="teleprompter-bay-live"
            onClick={() => onView("live")}
          >
            Live copy
          </Key>
          <Key
            mode="segmented"
            selected={view === "edit"}
            aria-pressed={view === "edit"}
            locked={editLock !== null}
            reason={editLock ?? undefined}
            testId="teleprompter-bay-edit"
            onClick={() => onView("edit")}
          >
            Edit script
          </Key>
        </Segmented>
        <header className={styles.head} data-well="" data-testid="teleprompter-glass-strip">
          {/* The three readouts on the time's baseline; the run state centred apart. */}
          <span className={styles.readouts}>
            <span className={styles.stripItem}>
              <span className={styles.stripLabel}>On the prompter</span>
              <b className={styles.stripValue} data-testid="teleprompter-on-glass">
                {glass ? glass.name : "Nothing"}
              </b>
            </span>
            <span className={styles.stripItem}>
              <span className={styles.stripLabel}>Place</span>
              <b className={styles.stripValue} data-testid="teleprompter-place">
                {place ? place.text : "—"}
              </b>
            </span>
            <span className={styles.stripItem}>
              <span className={styles.stripLabel}>Left</span>
              {/* An empty time keeps the hero's line, so the baseline stays when a time arrives. */}
              <b className={styles.stripHero} data-testid="teleprompter-time-left">
                {time ? time.left : <span className={styles.stripValue}>—</span>}
              </b>
              {time ? (
                <span className={styles.stripDetail}>
                  {time.of}
                  {time.ends ? ` · ${time.ends}` : ""}
                  {glass?.estimated ? " · estimated" : ""}
                </span>
              ) : null}
            </span>
          </span>
          {glass ? (
            <LampWord tone={glass.playing ? "ok" : "off"} className={styles.runState} testId="teleprompter-run-state">
              {runStateWord(glass)}
            </LampWord>
          ) : null}
        </header>
      </div>

      {view === "edit" ? (
        editView
      ) : (
        <>
          <div className={styles.copy} data-on-glass={draws ? "" : undefined}>
            <PrompterGlass
              text={glassText}
              anchor={glass?.anchor ?? null}
              width={COPY_WIDTH}
              onLayout={onLayout}
              label={glass ? `The prompter's glass: ${glass.name}` : "The prompter's glass: nothing on it"}
              testId="teleprompter-copy"
            />
            {!draws && glass ? (
              <span className={styles.notOnGlass}>
                <LampWord tone="error" testId="teleprompter-not-on-glass">
                  Not on the glass
                </LampWord>
              </span>
            ) : null}
          </div>

          {glass ? (
            <>
              <div className={styles.barHead}>
                <Tooltip
                  content="Press anywhere on it to go to the start of that paragraph. The scroll stays as it was."
                  placement="top"
                >
                  <span className={styles.barWord}>The whole script</span>
                </Tooltip>
                <span>{readWords}</span>
              </div>
              <button
                type="button"
                className={styles.bar}
                data-well=""
                data-take=""
                aria-label="The whole script: press to go to the start of a paragraph"
                data-testid="teleprompter-script-bar"
                onClick={pressBar}
              >
                <span ref={track} className={styles.track}>
                  {dense ? (
                    <>
                      <span
                        className={styles.segment}
                        data-read=""
                        style={{ left: 0, width: `${barStart(segments, readUpTo) * 100}%` }}
                      />
                      <span
                        className={styles.segment}
                        style={{
                          left: `${barStart(segments, readUpTo) * 100}%`,
                          width: `${(1 - barStart(segments, readUpTo)) * 100}%`,
                        }}
                      />
                    </>
                  ) : (
                    segments.map((segment) => (
                      <span
                        key={segment.index}
                        className={styles.segment}
                        data-read={segment.index < readUpTo ? "" : undefined}
                        style={{ left: `${segment.start * 100}%`, width: `calc(${segment.share * 100}% - 2px)` }}
                      >
                        {segments.length <= 40 ? (
                          <span className={styles.segmentNumber}>{segment.index + 1}</span>
                        ) : null}
                      </span>
                    ))
                  )}
                  {glass.cues.map((cue, index) => (
                    <i
                      key={`${cue.paragraph}:${cue.word}:${index}`}
                      className={styles.cueTick}
                      style={{ left: `${barStart(segments, cue.paragraph) * 100}%` }}
                    />
                  ))}
                  {place ? <i className={styles.placeMark} style={{ left: `${place.share * 100}%` }} /> : null}
                </span>
              </button>
              <div className={styles.under}>
                <div ref={cueRow} className={styles.cues} data-testid="teleprompter-cue-keys">
                  <span className={styles.cuesLabel}>Cues</span>
                  {cues.length === 0 ? <span className={styles.cuesNone}>none in this script</span> : null}
                  {shownCues.map((cue, index) => (
                    <Key
                      key={`${cue.paragraph}:${cue.word}:${index}`}
                      take
                      data-cue-key=""
                      testId={`teleprompter-cue-${index + 1}`}
                      onClick={() => jump({ to: "place", paragraph: cue.paragraph, word: cue.word })}
                    >
                      <span className={styles.cueParagraph}>¶ {cue.paragraph + 1}</span>{" "}
                      <span className={styles.cueText}>{cue.text}</span>
                    </Key>
                  ))}
                </div>
                <div className={styles.goTo} role="group" data-testid="teleprompter-go-to">
                  {/* The label before the well, so the field is one 36 px line beside Go. */}
                  <label className={styles.goToLabel} htmlFor="teleprompter-go-to-paragraph">
                    Go to paragraph
                  </label>
                  <Well className={styles.goToWell}>
                    <input
                      id="teleprompter-go-to-paragraph"
                      className={styles.goToField}
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder={`1–${glass.paragraphCount}`}
                      value={goTo}
                      onChange={(event) => setGoTo(event.target.value.replace(/[^0-9]/g, ""))}
                      data-testid="teleprompter-go-to-field"
                    />
                  </Well>
                  <Key
                    take
                    locked={goToProblem !== null}
                    reason={goToProblem ?? undefined}
                    testId="teleprompter-go-to-key"
                    onClick={goToParagraph}
                  >
                    Go
                  </Key>
                </div>
              </div>
            </>
          ) : (
            <EmptyLine lamp testId="teleprompter-nothing-on" className={styles.nothing}>
              Nothing on the prompter
            </EmptyLine>
          )}
        </>
      )}
    </section>
  );
}
