import type { PrompterLayoutLine } from "../generated/snapshots/PrompterLayoutLine";

/**
 * The pace's pixels per read word, as the hardware link works it out
 * (`native/rust-engine/src/prompter/clock.rs`, `pace_pixels`): from the full
 * lines of running text, a line another line of its paragraph follows (so it
 * wrapped), holding a read word; their heights over their read words. A full
 * line then passes the reading line in its words' time at the pace, and the
 * paragraph gaps, the cue lines and a paragraph's short last line pass at that
 * speed too, so a script takes a little longer than its words at the pace and
 * the time left, from the pixels to `END`, says so. Until 2026-10-08 the whole
 * height was spread over the read words, and running text read 22 to 29 %
 * faster than the number (the walk of 2026-10-07, finding 13; the owner's
 * choice). Without a full line, the lines that hold a read word serve; a
 * script of cues alone is paced by all its words over the whole height
 * (review of 2026-09-27), so it does not run through in one word's time.
 *
 * `wordCounts` are each paragraph's words, cues included; `readFlags` say for
 * each of those words whether the presenter reads it; `textHeight` runs from
 * the first line's top to the last line's bottom.
 */
export function pacePixels(
  lines: readonly PrompterLayoutLine[],
  wordCounts: readonly number[],
  readFlags: readonly (readonly boolean[])[],
  textHeight: number
): number {
  const readWordsOn = (index: number) => {
    const line = lines[index]!;
    const next = lines[index + 1];
    const until = next && next.paragraph === line.paragraph ? next.word : (wordCounts[line.paragraph] ?? line.word);
    let count = 0;
    for (let word = line.word; word < until; word += 1) {
      if (readFlags[line.paragraph]?.[word]) count += 1;
    }
    return count;
  };
  const wraps = (index: number) => lines[index + 1]?.paragraph === lines[index]!.paragraph;
  const sum = (fullOnly: boolean) => {
    let height = 0;
    let words = 0;
    lines.forEach((line, index) => {
      if (fullOnly && !wraps(index)) return;
      const read = readWordsOn(index);
      if (read > 0) {
        height += line.height;
        words += read;
      }
    });
    return { height, words };
  };
  const full = sum(true);
  const { height, words } = full.words > 0 ? full : sum(false);
  if (words > 0) return height / words;
  const allWords = wordCounts.reduce((total, count) => total + count, 0);
  return textHeight / Math.max(allWords, 1);
}
