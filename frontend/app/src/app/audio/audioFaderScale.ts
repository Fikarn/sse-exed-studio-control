import { faderDbToNormalized, MINUS } from "./audioFormatting";

// The desk's fader scale (what a fader is set to), not the meter's dBFS scale
// (what is coming back). The visual overhaul's Console pull request prints it
// once per tier, in the gutter beside the tier's first strip, and leaves the
// short ticks in every groove. The polish (2026-10-05): the marks below unity
// print the real minus (DESIGN.md §3).
export const AUDIO_FADER_SCALE_MARKS: readonly (readonly [number, string])[] = [
  [6, "+6"],
  [0, "0"],
  [-6, `${MINUS}6`],
  [-12, `${MINUS}12`],
  [-20, `${MINUS}20`],
  [-30, `${MINUS}30`],
  [-40, `${MINUS}40`],
  [-60, `${MINUS}60`],
];

/** The marks as the groove's ticks, 0..1 from the bottom; unity draws its own. */
export const AUDIO_FADER_TICKS: readonly number[] = AUDIO_FADER_SCALE_MARKS.filter(([db]) => db !== 0).map(([db]) =>
  faderDbToNormalized(db)
);
