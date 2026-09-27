import type { Meta, StoryObj } from "@storybook/react-vite";

import { INTERVIEW_INTRO, standardLook, storyAnchor } from "./glassStoryScript";
import { PrompterGlass } from "./PrompterGlass";

// The glass (new pages program, Slice 5a) at the Prompter XL's own 1920×1080,
// one story per state the ledger names: paused mid-script, playing, at END,
// yellow text, the largest size with no margins and the line across, the
// paragraph numbers, and blank. Each is a still: the anchor is drawn at its own
// moment and nothing animates, so the captures (made on the studio workstation)
// hold still. The anchors carry no pixels, as a hardware link's anchor for a
// layout the glass has not reported yet, so the glass places the text from the
// words through the layout it measured.

const meta = {
  component: PrompterGlass,
  title: "Teleprompter/Glass",
  parameters: {
    layout: "fullscreen",
  },
  args: {
    width: 1920,
    still: true,
    anchor: storyAnchor(),
    text: { layoutKey: "story-text", paragraphs: INTERVIEW_INTRO, look: standardLook(), sizePx: 88 },
  },
} satisfies Meta<typeof PrompterGlass>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Paused at ¶ 8, the ninth word ("with"): text already read dimmed above the reading line. */
export const PausedMidScript: Story = {};

/** Playing at 140 words a minute, three seconds after the anchor: seven words on. */
export const Playing: Story = {
  args: { anchor: storyAnchor({ playing: true, fromWpm: 140, toWpm: 140, ageMs: 3000 }) },
};

/** At the end: `END` at the reading line, every line above it read. */
export const AtTheEnd: Story = {
  args: { anchor: storyAnchor({ place: { paragraph: INTERVIEW_INTRO.length, word: 0 }, wordOffset: 0, atEnd: true }) },
};

/** The look's other colour: yellow text; the cues keep theirs. */
export const YellowText: Story = {
  args: {
    text: {
      layoutKey: "story-yellow",
      paragraphs: INTERVIEW_INTRO,
      look: standardLook({ textColour: "yellow" }),
      sizePx: 88,
    },
  },
};

/** The largest size, 160 px, with no margins and the thin line across at the reading line. */
export const LargestSizeNoMargins: Story = {
  args: {
    text: {
      layoutKey: "story-largest",
      paragraphs: INTERVIEW_INTRO,
      look: standardLook({ marginPercent: 0, readingLineAcross: true }),
      sizePx: 160,
    },
    anchor: storyAnchor({ place: { paragraph: 8, word: 0 }, wordOffset: 0 }),
  },
};

/** Paragraph numbers on the glass, hung in the margin; the cue line of ¶ 9 at the reading line. */
export const ParagraphNumbers: Story = {
  args: {
    text: {
      layoutKey: "story-numbers",
      paragraphs: INTERVIEW_INTRO,
      look: standardLook({ paragraphNumbers: true }),
      sizePx: 88,
    },
    anchor: storyAnchor({ place: { paragraph: 8, word: 0 }, wordOffset: 0 }),
  },
};

/** Nothing on the prompter: the glass is black, with no arrow. */
export const Blank: Story = {
  args: { text: null, anchor: null },
};
