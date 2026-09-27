import { useMemo, useState, type FormEvent, type MouseEvent } from "react";

import { Key, Lamp } from "@sse/design-system";
import type { PrompterJumpRequest, PrompterSnapshot, ShellStore } from "@sse/engine-client";

import type { GlassParagraph } from "./glass/glassText";
import { PrompterGlass, type PrompterGlassLayoutReport, type PrompterGlassText } from "./glass/PrompterGlass";
import { barStart, cueKeys, paragraphAt, placeView, scriptBar, timeLeftParts } from "./teleprompterModel";
import type { PerformAction } from "./TeleprompterWorkspace";
import styles from "./TeleprompterBay.module.css";

// The Teleprompter's bay (new pages program, Slice 6a; board 1's centre, the
// proposal §6.1–6.2): what is on the glass, the place and the time left over
// the page's copy of the glass, the copy itself — the glass component scaled
// to the bay, the same lines, never a second layout — and under it the whole
// script at one width, the cue keys and Go to paragraph. The copy is a picture:
// nothing is drawn on it that the presenter does not see, and the mouse wheel
// never moves it. It reports its layout to the hardware link, which runs the
// clock on it (Slice 4).

/** The copy across the bay, 1,688 × 950: 88 % of the Prompter XL's pixels (the proposal §6.1). */
export const COPY_WIDTH = 1688;

export interface TeleprompterBayProps {
  snapshot: PrompterSnapshot;
  glassText: PrompterGlassText | null;
  cut: readonly GlassParagraph[];
  timeLeft: number | null;
  store: ShellStore;
  perform: PerformAction;
}

export function TeleprompterBay({ snapshot, glassText, cut, timeLeft, store, perform }: TeleprompterBayProps) {
  const glass = snapshot.glass;
  const draws = snapshot.screen.draws;
  const [goTo, setGoTo] = useState("");
  const jump = (request: PrompterJumpRequest) => void perform(() => store.jumpPrompter(request));
  const place = glass && cut.length > 0 ? placeView(glass, cut) : null;
  const segments = useMemo(
    () => (glass ? scriptBar(cut, glass.atEnd ? glass.paragraphCount : glass.place.paragraph) : []),
    [cut, glass]
  );
  const time = glass && timeLeft !== null ? timeLeftParts(glass, timeLeft, new Date()) : null;

  // A report the hardware link could not take is logged, never shown: the
  // glass reports again when the hardware link asks (`PrompterGlass`).
  const reportLayout = (report: PrompterGlassLayoutReport) => {
    store.reportPrompterLayout(report).catch((error: unknown) => {
      store.reportBackgroundFailure(error, "the page's copy of the glass");
    });
  };

  const pressBar = (event: MouseEvent<HTMLButtonElement>) => {
    if (!glass || segments.length === 0) return;
    const bar = event.currentTarget.getBoundingClientRect();
    // A press made with a key has no position: it goes to the start of the paragraph at the reading line.
    const paragraph =
      event.detail === 0 || bar.width <= 0
        ? Math.min(glass.place.paragraph, segments.length - 1)
        : paragraphAt(segments, (event.clientX - bar.left) / bar.width);
    jump({ to: "paragraph", paragraph });
  };

  const submitGoTo = (event: FormEvent) => {
    event.preventDefault();
    if (!glass) return;
    const number = Number.parseInt(goTo, 10);
    if (!Number.isInteger(number) || number < 1 || number > glass.paragraphCount) return;
    setGoTo("");
    jump({ to: "paragraph", paragraph: number - 1 });
  };

  const cues = glass ? cueKeys(glass.cues) : [];
  const readWords = cut.length > 0 && glass ? `${glass.paragraphCount} paragraphs · ${glass.cues.length} cues` : "";

  return (
    <section className={styles.bay} data-testid="teleprompter-bay" aria-label="The prompter's glass">
      <header className={styles.head} data-well="" data-testid="teleprompter-glass-strip">
        <span className={styles.stripItem}>
          <span className={styles.stripLabel}>On the glass</span>
          <b className={styles.stripValue} data-testid="teleprompter-on-glass">
            {glass ? glass.name : "Nothing"}
          </b>
        </span>
        <span className={styles.stripItem}>
          <span className={styles.stripLabel}>Place</span>
          <b className={styles.stripMono} data-testid="teleprompter-place">
            {place ? place.text : "—"}
          </b>
        </span>
        <span className={styles.stripItem}>
          <span className={styles.stripLabel}>Left</span>
          <b className={styles.stripHero} data-testid="teleprompter-time-left">
            {time ? time.left : "—"}
          </b>
          {time ? (
            <span className={styles.stripDetail}>
              {time.of}
              {time.ends ? ` · ${time.ends}` : ""}
              {glass?.estimated ? " · estimated" : ""}
            </span>
          ) : null}
        </span>
        {glass ? (
          <span className={styles.runState} data-testid="teleprompter-run-state">
            <Lamp tone={glass.playing ? "ok" : "off"} />
            {glass.playing ? "Playing" : glass.atEnd ? "At the end" : "Paused"}
          </span>
        ) : null}
      </header>

      <div className={styles.copy} data-on-glass={draws ? "" : undefined}>
        <PrompterGlass
          text={glassText}
          anchor={glass?.anchor ?? null}
          width={COPY_WIDTH}
          onLayout={reportLayout}
          label={glass ? `The prompter's glass: ${glass.name}` : "The prompter's glass: nothing on it"}
          testId="teleprompter-copy"
        />
        {!draws && glass ? (
          <span className={styles.notOnGlass} data-testid="teleprompter-not-on-glass">
            Not on the glass
          </span>
        ) : null}
      </div>

      {glass ? (
        <>
          <div className={styles.barHead}>
            <span>The whole script · press anywhere on it to go to the start of that paragraph</span>
            <span>
              {readWords}
              {place ? ` · ${Math.round(place.share * 100)} % read` : ""}
            </span>
          </div>
          <button
            type="button"
            className={styles.bar}
            data-well=""
            aria-label="The whole script: press to go to the start of a paragraph"
            data-testid="teleprompter-script-bar"
            onClick={pressBar}
          >
            {segments.map((segment) => (
              <span
                key={segment.index}
                className={styles.segment}
                data-read={segment.read ? "" : undefined}
                style={{ flexGrow: segment.share }}
              >
                {segments.length <= 40 ? <span className={styles.segmentNumber}>{segment.index + 1}</span> : null}
              </span>
            ))}
            {glass.cues.map((cue, index) => (
              <i
                key={`${cue.paragraph}:${cue.word}:${index}`}
                className={styles.cueTick}
                style={{ left: `${barStart(segments, cue.paragraph) * 100}%` }}
              />
            ))}
            {place ? <i className={styles.placeMark} style={{ left: `${place.share * 100}%` }} /> : null}
          </button>
          <div className={styles.under}>
            <div className={styles.cues} data-testid="teleprompter-cue-keys">
              <span className={styles.cuesLabel}>Cues</span>
              {cues.length === 0 ? <span className={styles.cuesNone}>none in this script</span> : null}
              {cues.map((cue, index) => (
                <Key
                  key={`${cue.paragraph}:${cue.word}:${index}`}
                  size="small"
                  take
                  testId={`teleprompter-cue-${index + 1}`}
                  onClick={() => jump({ to: "place", paragraph: cue.paragraph, word: cue.word })}
                >
                  <span className={styles.cueParagraph}>¶ {cue.paragraph + 1}</span>{" "}
                  <i className={styles.cueText}>{cue.text}</i>
                </Key>
              ))}
            </div>
            <form className={styles.goTo} onSubmit={submitGoTo} data-testid="teleprompter-go-to">
              <label className={styles.goToLabel} htmlFor="teleprompter-go-to-paragraph">
                Go to paragraph
              </label>
              <input
                id="teleprompter-go-to-paragraph"
                className={styles.goToField}
                data-well=""
                inputMode="numeric"
                autoComplete="off"
                placeholder={`1–${glass.paragraphCount}`}
                value={goTo}
                onChange={(event) => setGoTo(event.target.value.replace(/[^0-9]/g, ""))}
                data-testid="teleprompter-go-to-field"
              />
              <Key size="small" type="submit" testId="teleprompter-go-to-key">
                Go
              </Key>
            </form>
          </div>
        </>
      ) : (
        <p className={styles.nothing} data-testid="teleprompter-nothing-on">
          Nothing on the prompter
        </p>
      )}
    </section>
  );
}
