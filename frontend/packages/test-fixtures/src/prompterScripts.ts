// The Teleprompter's scripts for the fixture double's scenarios (new pages program,
// Slice 6a): board 1's (`docs/redesign/assets/concepts/A-teleprompter-1.html`) six, as
// its scripts list shows them, and two in Removed. "02 Interview intro", "03 Panel
// questions" and "04 Outro" are the board's own text, word for word, with their cues
// on a line of their own (a Word heading's cue too) and never read aloud, so their read
// words are the board's: 581, 671 and 171. The board draws no text for the other
// three, only their length: these are written to it (152, 108 and 64 words).
//
// The shapes are the double's (`FixturePrompterScriptSeed` in `@sse/engine-client`),
// written out here because the engine client reads this package, and this package
// does not read it back.

/** One run of text with the emphasis it keeps (`PrompterRun`). */
export type FixtureRun = { text: string; bold: boolean; italic: boolean; underline: boolean };

/** One paragraph (`PrompterParagraph`); a line break inside it is a `\n`. */
export type FixtureParagraph = { runs: FixtureRun[] };

/** A place in a script, both from 0 (`PrompterPlace`). */
export type FixturePlace = { paragraph: number; word: number };

/** A script a scenario starts with (`FixturePrompterScriptSeed`). */
export type FixtureScriptSeed = {
  name: string;
  paragraphs: FixtureParagraph[];
  speedWpm?: number;
  place?: FixturePlace;
  sourceFileName?: string | null;
  removed?: boolean;
  versions?: number;
};

/** Any of the look's fields (`Partial<PrompterLook>`). */
export type FixtureLookSeed = {
  standardSizePx?: number;
  lineSpacingPercent?: number;
  marginPercent?: number;
  textColour?: "white" | "yellow";
  readingLinePercent?: number;
  readingLineAcross?: boolean;
  dimReadText?: boolean;
  paragraphNumbers?: boolean;
};

/** The prompter a scenario starts with (`FixturePrompterSeed`). */
export type FixturePrompterSeedRecord = {
  scripts?: FixtureScriptSeed[];
  onGlass?: string;
  notUpdated?: boolean;
  look?: FixtureLookSeed;
  sizePx?: number;
};

type Segment = string | Partial<FixtureRun>;

function run(segment: Segment): FixtureRun {
  return typeof segment === "string"
    ? { text: segment, bold: false, italic: false, underline: false }
    : { text: "", bold: false, italic: false, underline: false, ...segment };
}

/** A paragraph of runs: a string is plain text, an object a run with its emphasis. */
export function paragraph(...segments: Segment[]): FixtureParagraph {
  return { runs: segments.map(run) };
}

/**
 * Board 1's "02 Interview intro" as it went on the prompter, before the edits of its
 * not-updated state: 18 paragraphs, 581 read words, three cues (¶ 9's on a line of its
 * own, ¶ 12's from a Word heading, ¶ 14's), italic, bold and underline.
 */
export const INTERVIEW_INTRO: FixtureParagraph[] = [
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
    "You went to the plant floor before you went to the board. Why that order? And what did the people on the line already know that the spreadsheets did not?"
  ),
  paragraph(
    "[Part 2 · The pilot]\nLet us talk about the pilot. Six months, one line, twelve volunteers and a product that did not exist yet. Where did the idea come from, and how did you protect it while it was fragile?"
  ),
  paragraph(
    "Some of those twelve had worked on the old line for twenty years. What did you ask of them, and what did you promise in return? Which of those promises was the hardest to keep?"
  ),
  paragraph(
    "[slide 3]\nOn the screen you can see the first year in numbers. Output fell before it rose. Quality complaints doubled in the second quarter. And yet the board extended the pilot. What convinced them?"
  ),
  paragraph(
    "If someone in this programme is facing their own version of that year right now, what is the one thing you would tell them to do on Monday morning, and the one thing to stop?"
  ),
  paragraph(
    "Thank you. That is a good place to pause. After the break we look at the people who did not join the pilot, and why theirs turned out to be the more important story."
  ),
  paragraph(
    "For those of you following along, the case material for this part is in module three of the portal. The exercise asks you to map your own organisation's old line and new one."
  ),
  paragraph("Stay with us. We will be back in a moment."),
];

/** Board 1's "03 Panel questions": 36 paragraphs, 671 read words, five cues from Word headings. */
const PANEL_QUESTIONS: FixtureParagraph[] = [
  "Welcome back. For the second half of today's session we have three guests with us, and the questions come from you, the participants.",
  "We collected them in the portal over the last two weeks. There were more than eighty, so we grouped them and chose the ones that came up most often.",
  "Our guests are Maria, who runs a hospital's operations, Lars, who leads a logistics company, and Priya, who advises boards on risk.",
  "Each of them will answer in about two minutes. If a question is for all three, I will say so.",
  "[Part 1 · Seeing it early]\nMaria, the first question is for you. How do you know that a change is needed before the numbers tell you?",
  "Several of you asked a version of this: what is the first conversation you have when you suspect something is wrong?",
  "Lars, the same question to you. In logistics the numbers arrive every hour. Does that make the early signal easier or harder to hear?",
  "Priya, you sit with boards. When does a board first hear about a problem, and is that usually too late?",
  "One participant wrote: my manager says wait for the data. How long should you wait, and how do you argue against waiting?",
  "A question for all three. Name one sign that tells you a team has stopped telling you the truth.",
  "[Part 2 · People]\nLet us turn to people. Maria, how do you keep the ones who are exhausted by the last change?",
  "Lars, you closed two depots last year. How did you tell the people who were staying, not only the ones who were leaving?",
  "Priya, what do you look for in the leader of a change, and what makes you worried?",
  "Several of you asked about middle managers. They carry the change and often hear about it last. What should they be told, and when?",
  "One participant asked: how do I lead a change I did not choose and do not agree with?",
  "Maria, a follow-up for you. What do you do when your best people disagree with the plan in public?",
  "[Part 3 · Money and risk]\nNow the money. Lars, how do you fund a change while the old business still has to pay the bills?",
  "Priya, how much risk should a board accept in the first year of a change, and who decides?",
  "Maria, in a hospital the risk is to patients. How does that change how fast you are allowed to move?",
  "A question for all three. What is the most expensive mistake you have seen in a change, and what would have prevented it?",
  "Lars, when did you last stop a project that was already under way? How did you know it was time?",
  "Priya, what should a board ask for in the first report after a change begins?",
  "One participant wrote: our change has no budget line. Is that a warning sign or a normal start?",
  "[Part 4 · Measuring]\nLet us talk about measuring. Maria, which number do you look at first on a Monday morning?",
  "Lars, what did you stop measuring when the change began, and did anyone miss it?",
  "Priya, how do you tell progress from activity in a report?",
  "Several of you asked how long a change takes before it shows in the results. Is there an honest answer?",
  "[Part 5 · Closing]\nWe are close to time. One last question for each of you, and a short answer, please.",
  "Maria, what do you wish you had known when you started?",
  "Lars, what would you do differently if you could run last year again?",
  "Priya, what is the one question every participant should ask their own board next week?",
  "Thank you all three. Those were honest answers, and that is rarer than it should be.",
  "The questions we did not have time for are in the portal, with written answers from our guests by Friday.",
  "The exercise for this module asks you to write down the early signal you are ignoring right now.",
  "Bring it to your group session next week. We will start there.",
  "Thank you for watching, and see you in the next session.",
].map((text) => paragraph(text));

/** Board 1's "04 Outro": 5 paragraphs, 171 read words, one cue. */
const OUTRO: FixtureParagraph[] = [
  paragraph(
    "That brings us to the end of this session of ",
    { text: "Leading Through Change", italic: true },
    ". Thank you for staying with us, and thank you to our guest for her honesty about a year that did not go to plan."
  ),
  paragraph(
    "If you take one thing from today, let it be the question we started with: what did you have to unlearn? Write your own answer down before the week is over, while the conversation is still fresh."
  ),
  paragraph(
    "[look at CAM 2]\nThe case material, the reading list and this week's exercise are in the programme portal under module three. Your group session is on Thursday, and your coach will open it with the exercise, so please bring your notes."
  ),
  paragraph(
    "Next time we look at the other side of change: the people who said no. Why they resisted, what they saw that the leaders did not, and how the organisation was better for listening to them in the end."
  ),
  paragraph(
    "Until then, from all of us at SSE Executive Education, thank you for watching, and good luck on Monday morning."
  ),
];

/** "01 Welcome": 152 read words, to board 1's length. */
const WELCOME: FixtureParagraph[] = [
  paragraph(
    "Good morning, and welcome to ",
    { text: "Leading Through Change", italic: true },
    ", the executive programme from SSE Executive Education. Whether you are with us in the studio or following along from your own office, we are glad you are here."
  ),
  paragraph(
    "Over the next six weeks we will meet leaders who have taken their organisations through a real change: a new market, a new technology, a merger, or a crisis that nobody saw coming."
  ),
  paragraph(
    "Each session has the same shape. We start with a story, told by the person who lived it. Then we ask the questions you sent us, and we end with an exercise for you and your own team."
  ),
  paragraph(
    "Before we begin, please make sure you can see the programme portal in another window. There are no right answers here. What we want are honest ones, and the courage to test them against your own work on Monday morning."
  ),
  paragraph("So let us get started."),
];

/** "Retake lines": 108 read words, each pickup under a cue that names it. */
const RETAKE_LINES: FixtureParagraph[] = [
  "[pickup · the opening]\nWelcome to Leading Through Change, a series from SSE Executive Education about the decisions that shape an organisation.",
  "[pickup · after the break]\nWelcome back, everyone. Before the break we heard how the pilot began. Now we look at what it cost, and who paid for it.",
  "[pickup · the numbers]\nOutput fell by a fifth before it rose, and quality complaints doubled in the second quarter. And yet the board extended the pilot.",
  "[pickup · the close]\nThank you for watching. The case material and this week's exercise are waiting for you in the programme portal, under module three.",
  "[pickup · the credits]\nLeading Through Change is made in the studio at SSE Executive Education in Stockholm, with thanks to all of our guests.",
].map((text) => paragraph(text));

/** "Sound check": 64 read words. */
const SOUND_CHECK: FixtureParagraph[] = [
  "This is a sound check for the studio. I am speaking at the level I will use for the recording, sitting where I will sit.",
  "Testing, one, two, three, four. The quick brown fox jumps over the lazy dog.",
  "Now a little louder, as if I were answering a question with some energy. And now quietly again, as at the end of a take.",
].map((text) => paragraph(text));

/** "Draft intro", in Removed: the interview's first draft. */
const DRAFT_INTRO: FixtureParagraph[] = [
  "Welcome to Leading Through Change. In this episode we visit a supplier to the car industry that had to rethink almost everything it made.",
  "Our guest ran its operations when the orders fell. She will tell us what the board decided, and what it cost the people on the line.",
  "Let us begin.",
].map((text) => paragraph(text));

/** "Old outro", in Removed: last season's close. */
const OLD_OUTRO: FixtureParagraph[] = [
  "That is all for this session of Leading Through Change. Thank you for watching.",
  "The reading list and the exercises are in the programme portal. See you next week.",
].map((text) => paragraph(text));

/**
 * Every script a scenario may name, by name: board 1's speeds, files and versions
 * (4, 3 and 2 for the three it draws), and "03 Panel questions" at its own place, ¶ 21's
 * sixth word. A scenario's `onGlass` script takes the scenario's `place`.
 */
export const PROMPTER_SCRIPTS: Readonly<Record<string, FixtureScriptSeed>> = {
  "01 Welcome": { name: "01 Welcome", paragraphs: WELCOME, speedWpm: 150, sourceFileName: "Welcome.docx" },
  "02 Interview intro": {
    name: "02 Interview intro",
    paragraphs: INTERVIEW_INTRO,
    speedWpm: 140,
    sourceFileName: "Interview intro.docx",
    versions: 4,
  },
  "03 Panel questions": {
    name: "03 Panel questions",
    paragraphs: PANEL_QUESTIONS,
    speedWpm: 140,
    place: { paragraph: 20, word: 5 },
    sourceFileName: "Panel questions.docx",
    versions: 3,
  },
  "04 Outro": { name: "04 Outro", paragraphs: OUTRO, speedWpm: 140, sourceFileName: "Outro.docx", versions: 2 },
  "Retake lines": { name: "Retake lines", paragraphs: RETAKE_LINES, speedWpm: 130, sourceFileName: null },
  "Sound check": { name: "Sound check", paragraphs: SOUND_CHECK, speedWpm: 140, sourceFileName: null },
  "Draft intro": {
    name: "Draft intro",
    paragraphs: DRAFT_INTRO,
    speedWpm: 140,
    sourceFileName: "Interview draft.docx",
  },
  "Old outro": { name: "Old outro", paragraphs: OLD_OUTRO, speedWpm: 140, sourceFileName: "Outro 2025.docx" },
};

/**
 * A scenario's `prompter` as `fixtures.json` writes it: the scripts by name, the ones in
 * Removed by name (newest first), the script on the glass and its place, NOT UPDATED,
 * and the look and the take's size as the double's seed takes them.
 */
export type CompactPrompterRecord = {
  scripts?: string[];
  removed?: string[];
  onGlass?: string;
  place?: FixturePlace;
  notUpdated?: boolean;
  look?: FixtureLookSeed;
  sizePx?: number;
};

function namedScript(scenario: string, name: string): FixtureScriptSeed {
  const script = Object.hasOwn(PROMPTER_SCRIPTS, name) ? PROMPTER_SCRIPTS[name] : undefined;
  if (!script) {
    throw new Error(
      `Fixture '${scenario}': prompter names the script "${name}", which prompterScripts.ts does not have (${Object.keys(PROMPTER_SCRIPTS).join(", ")}).`
    );
  }
  return script;
}

/** A scenario's compact `prompter` made the double's seed: each name its script, `place` the glass script's. */
export function expandPrompterRecord(scenario: string, compact: CompactPrompterRecord): FixturePrompterSeedRecord {
  const onGlass = compact.onGlass;
  if (compact.place !== undefined && onGlass === undefined) {
    throw new Error(`Fixture '${scenario}': prompter.place is the glass script's place, and nothing is on the glass.`);
  }
  const scripts = [
    ...(compact.scripts ?? []).map((name) => {
      const script = namedScript(scenario, name);
      return name === onGlass && compact.place !== undefined ? { ...script, place: { ...compact.place } } : script;
    }),
    ...(compact.removed ?? []).map((name) => ({ ...namedScript(scenario, name), removed: true })),
  ];
  const seed: FixturePrompterSeedRecord = { scripts };
  if (onGlass !== undefined) seed.onGlass = onGlass;
  if (compact.notUpdated !== undefined) seed.notUpdated = compact.notUpdated;
  if (compact.look !== undefined) seed.look = compact.look;
  if (compact.sizePx !== undefined) seed.sizePx = compact.sizePx;
  return seed;
}
