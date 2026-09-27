import type { PrompterAnchor, PrompterLook, PrompterParagraph, PrompterRun } from "@sse/engine-client";

// A script for the glass's stories and tests (new pages program, Slice 5a):
// board 1's "02 Interview intro" (`docs/redesign/assets/concepts/
// A-teleprompter-1.html`), with its emphasis, a cue on a line of its own, a
// Word heading's cue and a cue inside a sentence.

type Segment = string | Partial<PrompterRun>;

function run(segment: Segment): PrompterRun {
  return typeof segment === "string"
    ? { text: segment, bold: false, italic: false, underline: false }
    : { text: "", bold: false, italic: false, underline: false, ...segment };
}

export function paragraph(...segments: Segment[]): PrompterParagraph {
  return { runs: segments.map(run) };
}

export const INTERVIEW_INTRO: PrompterParagraph[] = [
  paragraph(
    "Welcome to ",
    { text: "Leading Through Change", italic: true },
    ", a series from SSE Executive Education about the decisions that shape an organisation when the ground moves under it."
  ),
  paragraph(
    "Every episode starts with one question: what did you have to ",
    { text: "unlearn", bold: true },
    "? It sounds simple. In our experience it is the hardest question a leader can be asked, because the honest answer is rarely the one on the slides."
  ),
  paragraph(
    "Today we look at a company that had to unlearn almost everything at once: a supplier to the car industry, with three plants, two thousand people and customers who changed their minds about what a car runs on in less than five years."
  ),
  paragraph(
    "When the orders for its oldest product line fell by a third in a single year, the board had two options on the table. Close the plant that made it, or turn it into something nobody in the company had built before."
  ),
  paragraph(
    "They chose the second. What follows is the story of that choice, told by the person who had to carry it out, and who admits she was not sure it would work."
  ),
  paragraph(
    "Before we meet her, a word on how this conversation works. There is no script for the guest. The questions are mine, the answers are hers, and nothing has been rehearsed beyond a cup of coffee this morning."
  ),
  paragraph(
    "We will talk for about twenty minutes. Afterwards you will find the reading list, the case material and the exercises for your own team in the programme portal."
  ),
  paragraph(
    "So let us begin where every change begins: with a morning when the numbers on the screen ",
    { text: "no longer", italic: true },
    " matched the story everyone was telling."
  ),
  paragraph(
    "[turn to the guest]\nWelcome to the studio. You were head of operations when the orders fell. Take us back to that morning. What did you see ",
    { text: "first", underline: true },
    ", and who was the first person you called?"
  ),
  paragraph(
    "Many leaders describe that moment as a kind of silence. The plan still exists, the meetings still happen, but nobody quite believes the numbers any more. Was it like that for you?"
  ),
  paragraph(
    "You went to the plant floor before you went to the board. Why that order? And what did the people on the line already know, months before the spreadsheets did?"
  ),
  paragraph(
    "[Part 2 · The pilot]\nLet us talk about the pilot. Six months, one line, twelve volunteers and a product that did not exist yet. Where did the idea come from, and how did you protect it while it was fragile?"
  ),
  paragraph(
    "Some of those twelve had worked on the old line for twenty years. What did you ask of them, and what did you promise in return? Which of those promises was the hardest to keep?"
  ),
  paragraph(
    "On the screen [slide 3] you can see the first year in numbers. Output fell by a fifth before it rose. Quality complaints doubled in the second quarter. And yet the board extended the pilot by a year. What convinced them?"
  ),
  paragraph("Thank you. That is a good place to pause."),
];

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
