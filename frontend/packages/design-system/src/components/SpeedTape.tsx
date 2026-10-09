import { useMemo } from "react";

import styles from "./SpeedTape.module.css";

// The Overview (D47; docs/design/overview-2.md §3): the prompter's speed as an
// instrument, for the owner's example of turning the deck's SPEED dial during
// a take while watching the picture. A black well; a tape with one tick a
// detent (5 words a minute) and a label every 20, which slides one tick a
// click of the knob, so the screen moves in step with the hand; the value in
// the pointer at the display size, the one number on the page read from a
// metre away; the selection keyline on the pointer while the deck has just
// turned it; the range of this take as a bar beside the labels; and the
// deck's four dials at the foot with the one it is on lit.
//
// A display only: it takes no wheel, no key and no pointer. The speed is the
// hardware link's; the page passes it, the caption's words and the moments
// the keyline shows.

/** The tape's pitch: one detent, 13 px. */
const TICK_PX = 13;

const DIALS = ["Speed", "Line", "Paragraph", "Size"] as const;

export interface SpeedTapeProps {
  /** Words a minute; outside min..max it stands at the end of the tape. */
  value: number;
  min?: number;
  max?: number;
  /** One detent of the dial. */
  step?: number;
  /** A long tick and its number every so many words a minute. */
  labelEvery?: number;
  /** The range of this take, drawn as a bar beside the labels. */
  range?: readonly [number, number] | null;
  /** The deck has just turned it: the selection keyline round the pointer
   *  and the caption in the Beige accent. */
  turned?: boolean;
  /** The line under the pointer (`turned on the deck`, `this take 140 to
   *  150`, `the script's own speed`): the page chooses the words. */
  caption: string;
  /** The deck's dials, left to right as they sit on it. */
  dials?: readonly string[];
  /** The dial this tape follows. */
  litDial?: number;
  testId?: string;
  className?: string;
}

export function SpeedTape({
  value,
  min = 40,
  max = 300,
  step = 5,
  labelEvery = 20,
  range = null,
  turned = false,
  caption,
  dials = DIALS,
  litDial = 0,
  testId,
  className,
}: SpeedTapeProps) {
  const clamp = (speed: number) => Math.min(max, Math.max(min, speed));
  /** A speed's place on the strip, from the top (the fastest at 0). */
  const at = (speed: number) => ((max - clamp(speed)) / step) * TICK_PX;
  const shown = clamp(value);

  const ticks = useMemo(() => {
    const count = Math.floor((max - min) / step);
    return Array.from({ length: count + 1 }, (_, index) => {
      const speed = min + index * step;
      return { speed, top: ((max - speed) / step) * TICK_PX, major: speed % labelEvery === 0 };
    });
  }, [min, max, step, labelEvery]);

  const bar = range
    ? (() => {
        const fast = at(Math.max(range[0], range[1]));
        const slow = at(Math.min(range[0], range[1]));
        return { top: fast, height: Math.max(3, slow - fast + 1) };
      })()
    : null;

  return (
    <div
      role="meter"
      aria-label={`Speed ${Math.round(shown)} words a minute`}
      aria-valuenow={shown}
      aria-valuemin={min}
      aria-valuemax={max}
      className={[styles.tape, turned ? styles.turned : "", className].filter(Boolean).join(" ")}
      data-speed-tape=""
      data-value={shown}
      data-turned={turned ? "" : undefined}
      data-caption={caption}
      data-testid={testId}
    >
      <div className={styles.head}>
        <span className={styles.kick}>Speed</span>
        <span className={styles.headNote}>words a minute</span>
      </div>
      <div className={styles.window}>
        {/* The strip hangs from the window's middle and slides up by the
            value's place, so the value stands on the centre line; it moves
            only when the value changes. */}
        <div
          className={styles.strip}
          data-tape-strip=""
          style={{ height: at(min) + 1, transform: `translateY(${-at(shown)}px)` }}
        >
          {ticks.map(({ speed, top, major }) => (
            <i key={speed} className={major ? styles.major : styles.minor} style={{ top }} />
          ))}
          {ticks
            .filter(({ major }) => major)
            .map(({ speed, top }) => (
              <span key={`label-${speed}`} className={styles.label} style={{ top: top - 8 }}>
                {speed}
              </span>
            ))}
          {bar ? <i className={styles.range} data-tape-range="" style={bar} /> : null}
        </div>
      </div>
      <i className={styles.centre} />
      <div className={styles.pointer} data-tape-pointer="">
        <span className={styles.number}>{Math.round(shown)}</span>
        <span className={styles.unit}>words/min</span>
      </div>
      <p className={styles.caption}>{caption}</p>
      <div className={styles.dials}>
        {dials.map((name, index) => (
          <span key={name} className={styles.dial} data-dial={name} data-on={index === litDial ? "" : undefined}>
            <i className={styles.knob} />
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}
