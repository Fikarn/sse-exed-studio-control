import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import type { PrompterAnchor, PrompterLayoutLine, PrompterLook, PrompterParagraph } from "@sse/engine-client";

import { useLiveCallback } from "../../shared/useLiveCallback";

import {
  CUE_SCALE,
  GLASS_HEIGHT,
  GLASS_WIDTH,
  glassMetrics,
  layoutFromMeasure,
  layoutProblem,
  type GlassLayout,
  type GlassMetrics,
  type MeasuredParagraph,
} from "./glassLayout";
import { GLASS_ITALIC_FAMILY, registerGlassItalic } from "./glassFont";
import { glassFrame, glassPosition, glassSettled } from "./glassMotion";
import { glassParagraphs, type GlassParagraph, type GlassWord } from "./glassText";
import styles from "./PrompterGlass.module.css";

// The glass (new pages program, Slice 5a): what the Prompter XL shows, drawn
// from the hardware link's state — the text on the glass, the look and the
// take's size, and the scroll from the prompter's clock (the anchor). One
// component for the Prompter XL's window (Slice 5b) and the Teleprompter page's
// copy of it (Slice 6), laid out at the Prompter XL's own 1,920 px and scaled
// to the width it is given, so both break every line alike.
//
// Unmirrored: the Prompter XL flips what it shows. Nothing is drawn on it that
// the presenter does not read — no clock, no message, no logo; the operator's
// marks sit around the page's copy, never on it (the proposal §4.2, §6.1).
//
// It reports its layout for each `layoutKey` once the fonts are ready
// (`prompter.layout.report`; the first report for a key is the one the clock
// runs on), and again when an anchor says the hardware link has none for that
// key (after it restarts, or when a report was lost), at most once a second.
// It reports only a layout the hardware link would take (`layoutProblem`): one
// measured while the glass was not drawn is measured again once it is. The
// text is cut again only when it says something else, and the layout is
// measured again only when the key, the text or the look's geometry changes,
// so a new object of the same paragraphs or look, or a colour, costs no
// measure. (A key can come back with other text after a restore of the saved
// data, so the text is compared, not only the key.)
//
// It holds no prompter state: the place, the pace and playing are the
// hardware link's, and the glass only draws the last anchor it was given with
// the time since it came. Between frames it touches no React state: each frame
// moves the text column with a transform.

/** What is on the glass: the text as it went on, the look and the take's size. */
export interface PrompterGlassText {
  layoutKey: string;
  paragraphs: readonly PrompterParagraph[];
  look: PrompterLook;
  sizePx: number;
}

/** What `prompter.layout.report` sends. */
export interface PrompterGlassLayoutReport {
  layoutKey: string;
  lines: PrompterLayoutLine[];
  endTop: number;
}

export interface PrompterGlassProps {
  /** `null` while nothing is on the prompter: the glass is black. */
  text: PrompterGlassText | null;
  /** The prompter's clock as last reported; `null` draws the text from its top. */
  anchor: PrompterAnchor | null;
  /** The width it is drawn at, in the page's pixels; the height keeps 16:9. */
  width: number;
  /** Called for each `layoutKey` when the fonts are ready, and again when the anchor says the hardware link has no layout for it. */
  onLayout?: (report: PrompterGlassLayoutReport) => void;
  /** Draws the anchor at its own moment and never animates: a still, for Storybook and the tests. */
  still?: boolean;
  label?: string;
  testId?: string;
}

/** A report again for a key the hardware link has no layout for waits at least this long after the last. */
const REPORT_AGAIN_MS = 1000;

/** A word's pieces; a cue in it is drawn in the cue colour where it stands, unless the whole line is the cue. */
function wordContent(word: GlassWord, cueLine: boolean): ReactNode {
  return word.pieces.map((piece, index) => {
    let node: ReactNode = piece.text;
    if (piece.underline) node = <u>{node}</u>;
    if (piece.italic) node = <i>{node}</i>;
    if (piece.bold) node = <b>{node}</b>;
    if (piece.cue && !cueLine) node = <span className={styles.cue}>{node}</span>;
    return <Fragment key={index}>{node}</Fragment>;
  });
}

function paragraphNodes(text: readonly GlassParagraph[], numbers: boolean): ReactNode {
  return text.map((paragraph) => (
    <p key={paragraph.index} className={styles.paragraph} data-p={paragraph.index}>
      {numbers ? (
        <span className={styles.number} aria-hidden="true">
          {paragraph.index + 1}
        </span>
      ) : null}
      {paragraph.lines.map((line, lineIndex) => (
        <Fragment key={lineIndex}>
          {lineIndex > 0 ? <br /> : null}
          <span className={line.cueLine ? styles.cueLine : undefined}>
            {line.tokens.map((token, tokenIndex) =>
              token.kind === "space" ? (
                " "
              ) : (
                <span key={tokenIndex} data-w={token.word.index}>
                  {wordContent(token.word, line.cueLine)}
                </span>
              )
            )}
          </span>
        </Fragment>
      ))}
    </p>
  ));
}

/** The glass's sizes as custom properties for its stylesheet. */
function metricVariables(metrics: GlassMetrics): CSSProperties {
  const size = metrics.sizePx;
  return {
    "--glass-size": `${size}px`,
    "--glass-cue-size": `${size * CUE_SCALE}px`,
    "--glass-line": `${metrics.lineHeight}px`,
    "--glass-gap": `${metrics.paragraphGap}px`,
    "--glass-end-gap": `${metrics.endGap - metrics.paragraphGap}px`,
    "--glass-margin": `${metrics.marginPx}px`,
    "--glass-column-left": `${metrics.columnLeft}px`,
    "--glass-reading": `${metrics.readingY}px`,
    // The line across sits under the reading line's baseline, where it can meet the descenders (the proposal §4.1).
    "--glass-across": `${metrics.readingY + size * 0.45}px`,
    "--glass-arrow-left": `${metrics.arrowLeft}px`,
    "--glass-number-size": `${metrics.numberSize}px`,
    "--glass-number-gap": `${metrics.numberGap}px`,
    "--glass-underline": `${Math.max(2, size * 0.057)}px`,
    "--glass-underline-offset": `${size * 0.114}px`,
  } as CSSProperties;
}

/**
 * Measures the laid-out column: each paragraph's top and each word's centre,
 * and `END`'s top. A word that wraps stands on the line of its first piece, so
 * it is measured from its first box on the screen, brought back to the glass's
 * pixels (the glass is drawn scaled).
 */
function measureColumn(
  column: HTMLElement,
  key: string,
  metrics: GlassMetrics,
  text: readonly GlassParagraph[]
): GlassLayout {
  const box = column.getBoundingClientRect();
  const scale = column.offsetWidth > 0 && box.width > 0 ? box.width / column.offsetWidth : 1;
  const measured: MeasuredParagraph[] = [];
  column.querySelectorAll<HTMLElement>("[data-p]").forEach((paragraph) => {
    const top = paragraph.offsetTop;
    const paragraphTop = paragraph.getBoundingClientRect().top;
    const wordCentres: number[] = [];
    paragraph.querySelectorAll<HTMLElement>("[data-w]").forEach((word) => {
      const first = word.getClientRects()[0];
      // Without a box on the screen, a word's `offsetTop` is from its paragraph, which is positioned.
      wordCentres.push(
        first
          ? top + (first.top + first.height / 2 - paragraphTop) / scale
          : top + word.offsetTop + word.offsetHeight / 2
      );
    });
    measured.push({ top, wordCentres });
  });
  const end = column.querySelector<HTMLElement>("[data-end]");
  const last = measured[measured.length - 1];
  const endTop = end ? end.offsetTop : (last?.top ?? 0) + metrics.lineHeight;
  return layoutFromMeasure(key, measured, endTop, metrics.lineHeight, text);
}

registerGlassItalic();

/** Resolves when the faces the glass draws with are loaded, so its layout is final. */
async function fontsReady(sizePx: number): Promise<void> {
  const fonts = typeof document === "undefined" ? undefined : document.fonts;
  if (!fonts) return;
  const size = `${sizePx}px`;
  const cue = `${sizePx * CUE_SCALE}px`;
  try {
    await Promise.all([
      fonts.load(`500 ${size} "Inter Variable"`),
      fonts.load(`600 ${size} "Inter Variable"`),
      fonts.load(`italic 500 ${size} "${GLASS_ITALIC_FAMILY}"`),
      fonts.load(`italic 500 ${cue} "${GLASS_ITALIC_FAMILY}"`),
    ]);
    await fonts.ready;
  } catch {
    // Measure with what is there: a face that will not load stays missing.
  }
}

export function PrompterGlass({ text, anchor, width, onLayout, still = false, label, testId }: PrompterGlassProps) {
  const layoutKey = text?.layoutKey ?? null;
  const look = text?.look;
  const sizePx = text?.sizePx;
  // The text, cut again only when it says something else: a new array of the
  // same paragraphs (a snapshot fetched again) costs a comparison, not a measure.
  const paragraphs = text?.paragraphs;
  const said = useMemo(() => JSON.stringify(paragraphs ?? []), [paragraphs]);
  const [cut, setCut] = useState(() => ({ said, text: glassParagraphs(paragraphs ?? []) }));
  if (cut.said !== said) setCut({ said, text: glassParagraphs(paragraphs ?? []) });
  const glassText = cut.text;
  const paragraphCount = glassText.length;

  // The look's geometry, from its values rather than the object that carries them.
  const spacing = look?.lineSpacingPercent;
  const margin = look?.marginPercent;
  const numbers = look?.paragraphNumbers ?? false;
  const reading = look?.readingLinePercent;
  const dim = look?.dimReadText ?? false;
  const metrics = useMemo(
    () =>
      spacing !== undefined && margin !== undefined && reading !== undefined && sizePx
        ? glassMetrics(
            {
              lineSpacingPercent: spacing,
              marginPercent: margin,
              paragraphNumbers: numbers,
              readingLinePercent: reading,
            },
            sizePx,
            paragraphCount
          )
        : null,
    [spacing, margin, numbers, reading, sizePx, paragraphCount]
  );
  // What the layout depends on; the reading line, the colours and the dimming do not.
  const geometry = metrics
    ? [metrics.sizePx, metrics.lineHeight, metrics.marginPx, metrics.columnLeft, numbers].join(" ")
    : null;
  const column = useMemo(() => paragraphNodes(glassText, numbers), [glassText, numbers]);

  const frameElementRef = useRef<HTMLDivElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  const readRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<GlassLayout | null>(null);
  const anchorRef = useRef<{ anchor: PrompterAnchor | null; receivedAt: number }>({ anchor: null, receivedAt: 0 });
  /** The key whose fonts are ready, so its measure is final. */
  const readyRef = useRef<string | null>(null);
  /** The last report: its key, the text it laid out and when. */
  const reportedRef = useRef<{ key: string | null; text: readonly GlassParagraph[] | null; at: number }>({
    key: null,
    text: null,
    at: 0,
  });
  const againRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);

  const report = useLiveCallback((layout: PrompterGlassLayoutReport) => onLayout?.(layout));

  // One frame: where the anchor puts the text now, drawn by a transform. It
  // answers whether the text has come to rest.
  const draw = useLiveCallback((): boolean => {
    const layout = layoutRef.current;
    const columnElement = columnRef.current;
    if (!layout || !metrics || !columnElement) return true;
    const { anchor: current, receivedAt } = anchorRef.current;
    const elapsed = current && !still ? performance.now() - receivedAt : 0;
    const position = current ? glassPosition(current, layout, elapsed) : (layout.lines[0]?.top ?? 0);
    const frame = glassFrame(layout, metrics, position);
    columnElement.style.transform = `translate3d(0, ${frame.shift}px, 0)`;
    if (readRef.current) readRef.current.style.height = `${frame.readHeight}px`;
    return still || !current || glassSettled(current, elapsed);
  });

  // Draws now, and on every frame after it until the text rests; nothing runs
  // while the text stands still (system §6: nothing animates at rest).
  const run = useLiveCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    const step = () => {
      frameRef.current = null;
      if (!draw()) frameRef.current = requestAnimationFrame(step);
    };
    if (!draw()) frameRef.current = requestAnimationFrame(step);
  });

  const measure = useLiveCallback((): GlassLayout | null => {
    const columnElement = columnRef.current;
    if (!layoutKey || !metrics || !columnElement) {
      layoutRef.current = null;
      return null;
    }
    const layout = measureColumn(columnElement, layoutKey, metrics, glassText);
    layoutRef.current = layout;
    run();
    return layout;
  });

  // Measures and reports a layout the hardware link would take: `again` sends
  // it even when this key was reported before.
  const measureAndReport = useLiveCallback((again: boolean) => {
    const layout = measure();
    if (!layout || !layoutKey || layoutProblem(layout) !== null) return;
    if (reportedRef.current.key === layoutKey && reportedRef.current.text === glassText && !again) return;
    reportedRef.current = { key: layoutKey, text: glassText, at: performance.now() };
    report({ layoutKey, lines: layout.lines, endTop: layout.endTop });
  });

  // An anchor for this key with no position: the hardware link has no layout
  // for it (it restarted, or a report was lost). Once the fonts are ready, the
  // layout is measured and reported again, at most once a second.
  const reportAgainIfAsked = useLiveCallback(() => {
    const current = anchorRef.current.anchor;
    if (!current || current.position !== null || current.layoutKey !== layoutKey) return;
    if (readyRef.current !== layoutKey || againRef.current !== null) return;
    const wait = Math.max(reportedRef.current.at + REPORT_AGAIN_MS - performance.now(), 0);
    againRef.current = window.setTimeout(() => {
      againRef.current = null;
      const latest = anchorRef.current.anchor;
      if (latest && latest.position === null && latest.layoutKey === layoutKey) measureAndReport(true);
    }, wait);
  });

  // The layout: measured before the first paint so the text is drawn in
  // place, and again, then reported, once the fonts are ready.
  useLayoutEffect(() => {
    readyRef.current = null;
    measure();
    if (!layoutKey || geometry === null || !sizePx) return;
    let cancelled = false;
    void fontsReady(sizePx).then(() => {
      if (cancelled) return;
      readyRef.current = layoutKey;
      measureAndReport(false);
      reportAgainIfAsked();
    });
    return () => {
      cancelled = true;
    };
  }, [layoutKey, glassText, geometry, sizePx, measure, measureAndReport, reportAgainIfAsked]);

  // A new anchor: drawn from the moment it came.
  useLayoutEffect(() => {
    anchorRef.current = { anchor, receivedAt: performance.now() };
    run();
    reportAgainIfAsked();
  }, [anchor, run, reportAgainIfAsked]);

  // The reading line, the dimming or a still: drawn again, the anchor's moment kept.
  useLayoutEffect(() => {
    run();
  }, [metrics, dim, still, run]);

  // A glass that was not drawn when it was measured (in a hidden view) is
  // measured, and reported, once it is.
  const measureIfUnreported = useLiveCallback(() => {
    const reported = reportedRef.current;
    if (layoutKey && readyRef.current === layoutKey && (reported.key !== layoutKey || reported.text !== glassText)) {
      measureAndReport(false);
    }
  });
  useEffect(() => {
    const frameElement = frameElementRef.current;
    if (!frameElement || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measureIfUnreported());
    observer.observe(frameElement);
    return () => observer.disconnect();
  }, [measureIfUnreported]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      if (againRef.current !== null) window.clearTimeout(againRef.current);
    },
    []
  );

  const scale = width / GLASS_WIDTH;
  const yellow = look?.textColour === "yellow";
  return (
    <div
      ref={frameElementRef}
      className={styles.frame}
      style={{ width, height: (width * GLASS_HEIGHT) / GLASS_WIDTH }}
      role="img"
      aria-label={label ?? "The prompter's glass"}
      data-picture="prompter-glass"
      data-testid={testId}
      data-layout-key={layoutKey ?? undefined}
    >
      <div
        className={yellow ? `${styles.screen} ${styles.yellow}` : styles.screen}
        style={{ transform: `scale(${scale})`, ...(metrics ? metricVariables(metrics) : {}) }}
      >
        {text && metrics ? (
          <>
            <div ref={columnRef} className={styles.column}>
              {column}
              <div className={styles.end} data-end="">
                END
              </div>
            </div>
            {dim ? <div ref={readRef} className={styles.read} /> : null}
            {look?.readingLineAcross ? <i className={styles.across} /> : null}
            <i className={styles.arrow} />
          </>
        ) : null}
      </div>
    </div>
  );
}
