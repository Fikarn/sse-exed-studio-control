import { useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";

import { Lamp } from "./Lamp";
import styles from "./StateDisplay.module.css";
import { Tooltip } from "./Tooltip";

// Visual overhaul A, Slice 3 (plan D1; system §2, §8); Atrium: the first
// element of every cluster — a black well of fixed height carrying the lamp
// and the state word in SSE Adelia, the engine's sentence verbatim in PT Serif
// italic (the hardware link's voice), the raw code small beneath it, and at
// the foot the meta line with the way-out keys. Nothing below it ever moves;
// arming renders as the one armed form (Burgundy, Beige ink) in the meta
// line's place (finding C1). The shell (overhaul 3): the page's ⋯ stands at
// the display's top right (`menu`, a `MenuButton`), in the same place on
// every page.
//
// The polish (2026-10-05, the owner's rule): the sentence keeps two lines and
// is written to fit them, and the meta fits beside the way-out key. Should a
// name ever make either longer, the display says the whole of it on hover
// (the Tooltip), so nothing is lost; the page tests hold that no fixture's
// sentence or meta is cut.
export type StateDisplayTone = "ok" | "attention" | "error" | "info";

/** A word longer than this drops from the display size to the readout size. */
const LONG_WORD = 10;

export interface StateDisplayArmed {
  /** The armed word, PT Sans bold (`ARMED`). */
  word?: string;
  /** What is armed and how to apply (`Load Interview · press again to apply`). */
  text: ReactNode;
  /** Seconds left, PT Sans bold with tabular digits (`3.9 s`). */
  secondsLeft?: number;
  /** 0..1 of the window left, drawn as the bar (a still bar). */
  progress?: number;
  /** The arm window: the bar runs its own countdown, so no ticking state. */
  timeoutMs?: number;
  /**
   * When the arm began. A new arm (another key armed while one was) restarts
   * the bar: it is keyed on this, as the menu's armed item's bar is.
   */
  armedAt?: number;
}

export interface StateDisplayProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  tone: StateDisplayTone;
  /** The engine's word: VERIFIED, NOT VERIFIED, OFFLINE, REACHABLE, READY … */
  word: string;
  /** The engine's sentence, verbatim. */
  sentence?: ReactNode;
  /** The raw code, printed small and never first. */
  code?: ReactNode;
  /** The meta line: counts, last sync. */
  meta?: ReactNode;
  /** The way-out keys. */
  actions?: ReactNode;
  /** The page's ⋯ (a `MenuButton`), at the top right. */
  menu?: ReactNode;
  armed?: StateDisplayArmed | null;
  /** `<workspace>-state-display`. */
  testId?: string;
  className?: string;
}

export function StateDisplay({
  tone,
  word,
  sentence,
  code,
  meta,
  actions,
  menu,
  armed,
  testId,
  className,
  ...rest
}: StateDisplayProps) {
  const sentenceRef = useRef<HTMLDivElement | null>(null);
  const metaRef = useRef<HTMLDivElement | null>(null);
  const [cut, setCut] = useState({ sentence: false, meta: false });
  const showsMeta = !armed && Boolean(meta);
  useLayoutEffect(() => {
    const measure = () => {
      const sentenceElement = sentenceRef.current;
      const metaElement = metaRef.current;
      const next = {
        sentence: Boolean(sentenceElement && sentenceElement.scrollHeight > sentenceElement.clientHeight + 1),
        meta: Boolean(metaElement && metaElement.scrollWidth > metaElement.clientWidth + 1),
      };
      setCut((last) => (last.sentence === next.sentence && last.meta === next.meta ? last : next));
    };
    measure();
    // The faces load after the first draw; measure again once they have.
    let live = true;
    void document.fonts?.ready.then(() => {
      if (live) measure();
    });
    return () => {
      live = false;
    };
  }, [sentence, meta, showsMeta, actions]);

  const sentenceNode = sentence ? (
    <div ref={sentenceRef} className={styles.sentence} data-state-sentence="">
      {sentence}
    </div>
  ) : null;
  const metaNode = showsMeta ? (
    <div ref={metaRef} className={styles.meta} data-state-meta="">
      {meta}
    </div>
  ) : null;

  return (
    <section
      className={[styles.display, styles[tone], className].filter(Boolean).join(" ")}
      data-region="state-display"
      data-material="well"
      data-well=""
      data-tone={tone}
      data-testid={testId}
      aria-live="polite"
      {...rest}
    >
      <div className={styles.top}>
        <Lamp tone={tone} className={styles.lamp} />
        <span className={styles.word} data-long={word.length > LONG_WORD ? "" : undefined}>
          {word}
        </span>
        {menu ? <span className={styles.menu}>{menu}</span> : null}
      </div>
      {/* The sentence and the code share the room between the word and the
          foot. The sentence keeps at most two lines; the code shows whole
          when it fits under them and gives way when it does not. */}
      <div className={styles.story}>
        {sentenceNode && cut.sentence ? (
          <div className={styles.tip}>
            <Tooltip content={sentence} placement="right" maxWidth={440}>
              {sentenceNode}
            </Tooltip>
          </div>
        ) : (
          sentenceNode
        )}
        {/* data-state-code: the one place a raw fault code is allowed to
            stand on its own — it is the code slot, never the first thing the
            sentence says. The operator-copy census keys on this marker. */}
        {code ? (
          <span className={styles.code} data-state-code="">
            {code}
          </span>
        ) : null}
      </div>
      <div className={styles.foot}>
        {armed ? (
          <div className={styles.armedRow} data-armed-row="">
            <span className={styles.armedWord}>{armed.word ?? "ARMED"}</span>
            <span className={styles.armedText}>{armed.text}</span>
            {armed.secondsLeft !== undefined ? (
              <span className={styles.armedSeconds}>{armed.secondsLeft.toFixed(1)} s</span>
            ) : (
              <span />
            )}
            <span className={styles.bar} aria-hidden="true">
              <i
                key={armed.armedAt}
                className={armed.timeoutMs ? styles.barCountdown : undefined}
                style={
                  {
                    "--arm-progress": String(Math.max(0, Math.min(1, armed.progress ?? 1))),
                    "--arm-duration": armed.timeoutMs ? `${armed.timeoutMs}ms` : undefined,
                  } as CSSProperties
                }
              />
            </span>
          </div>
        ) : metaNode && cut.meta ? (
          <div className={[styles.tip, styles.metaTip].join(" ")}>
            <Tooltip content={meta} placement="right">
              {metaNode}
            </Tooltip>
          </div>
        ) : (
          metaNode
        )}
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </div>
    </section>
  );
}
