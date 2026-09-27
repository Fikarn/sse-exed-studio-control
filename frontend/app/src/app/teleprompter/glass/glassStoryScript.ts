import type { PrompterAnchor, PrompterLook } from "@sse/engine-client";

// A script for the glass's stories and tests (new pages program, Slice 5a):
// board 1's "02 Interview intro" (`docs/redesign/assets/concepts/
// A-teleprompter-1.html`), with its emphasis and its three cues, each on a line
// of its own (¶ 12's from a Word heading). Since Slice 6a the text lives in
// `@sse/test-fixtures` (`prompterScripts.ts`), whole as the board has it (18
// paragraphs, 581 read words), where the fixture double's scenarios put it on
// the prompter too; it is re-exported here for the stories and tests that read it.

export { INTERVIEW_INTRO, paragraph } from "@sse/test-fixtures";

export function standardLook(overrides: Partial<PrompterLook> = {}): PrompterLook {
  return {
    standardSizePx: 88,
    lineSpacingPercent: 140,
    marginPercent: 12,
    textColour: "white",
    readingLinePercent: 35,
    readingLineAcross: false,
    dimReadText: true,
    paragraphNumbers: false,
    ...overrides,
  };
}

/**
 * An anchor as the hardware link sends it, for a layout the story's glass has
 * not reported (`position: null`), so the glass places the text from the words.
 */
export function storyAnchor(overrides: Partial<PrompterAnchor> = {}): PrompterAnchor {
  return {
    layoutKey: "story",
    place: { paragraph: 7, word: 8 },
    wordOffset: 8,
    position: null,
    endPosition: null,
    pxPerReadWord: null,
    playing: false,
    atEnd: false,
    fromWpm: 0,
    toWpm: 0,
    rampMs: 0,
    moveFromPosition: null,
    moveMs: 0,
    ageMs: 0,
    ...overrides,
  };
}
