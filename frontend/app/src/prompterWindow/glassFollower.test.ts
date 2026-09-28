import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EngineRequestError,
  type EventEnvelope,
  type EventName,
  type GlassLink,
  type JsonObject,
  type PrompterAnchor,
  type PrompterGlassSnapshot,
} from "@sse/engine-client";

import { paragraph, standardLook, storyAnchor } from "../app/teleprompter/glass/glassStoryScript";
import { CANNOT_HEAR, followGlass, type GlassView } from "./glassFollower";

// The prompter's window follows the hardware link: what it reads, what it
// hears, and what it does when the hardware link is gone.

function glass(overrides: Partial<PrompterGlassSnapshot> = {}): PrompterGlassSnapshot {
  return {
    scriptId: "script-1",
    name: "Interview intro",
    layoutKey: "g1-l0",
    paragraphs: [paragraph("Welcome to the studio."), paragraph("")],
    look: standardLook(),
    sizePx: 88,
    anchor: anchor(),
    ...overrides,
  };
}

function anchor(overrides: Partial<PrompterAnchor> = {}): PrompterAnchor {
  return storyAnchor({ layoutKey: "g1-l0", place: { paragraph: 0, word: 0 }, wordOffset: 0, ...overrides });
}

const NOTHING_ON: PrompterGlassSnapshot = {
  scriptId: null,
  name: null,
  layoutKey: null,
  paragraphs: [],
  look: standardLook(),
  sizePx: 88,
  anchor: null,
};

/** A link whose reads answer what the test last gave it, in order. */
function fakeLink(first: PrompterGlassSnapshot | Error) {
  let answer: PrompterGlassSnapshot | Error = first;
  let listener: ((event: EventEnvelope<EventName>) => void) | null = null;
  const held: Array<() => void> = [];
  let hold = false;
  const link: GlassLink = {
    listen: vi.fn(async (heard) => {
      listener = heard;
      return () => {
        listener = null;
      };
    }),
    readGlass: vi.fn(async () => {
      const answered = answer;
      if (hold) await new Promise<void>((resolve) => held.push(resolve));
      if (answered instanceof Error) throw answered;
      return answered;
    }),
    reportLayout: vi.fn(async () => ({ accepted: true })),
    alive: vi.fn(async () => {}),
  };
  return {
    link,
    answers: (next: PrompterGlassSnapshot | Error) => {
      answer = next;
    },
    /** Reads wait from now on, until `release` lets them answer. */
    holdReads: () => {
      hold = true;
    },
    release: () => {
      hold = false;
      held.splice(0).forEach((resolve) => resolve());
    },
    says: (event: EventName, payload: JsonObject = {}) => listener?.({ type: "event", event, payload }),
    listening: () => listener !== null,
    reads: () => (link.readGlass as ReturnType<typeof vi.fn>).mock.calls.length,
  };
}

function changed(reason: string, withAnchor: PrompterAnchor | null): JsonObject {
  return { reason, anchor: withAnchor as unknown as JsonObject };
}

/** Lets every promise that is ready run. */
async function settle() {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
}

describe("followGlass", () => {
  let now = 0;
  let views: GlassView[] = [];
  const last = () => views[views.length - 1];
  const follow = (link: GlassLink) => followGlass(link, (view) => views.push(view), { now: () => now });

  beforeEach(() => {
    vi.useFakeTimers();
    now = 10_000;
    views = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads the glass at once, and again once it listens", async () => {
    const hardware = fakeLink(glass());
    follow(hardware.link);
    await settle();
    expect(hardware.listening()).toBe(true);
    expect(hardware.reads()).toBe(2);
    expect(last().text).toMatchObject({ layoutKey: "g1-l0", sizePx: 88 });
    expect(last().text?.paragraphs).toHaveLength(2);
    expect(last().anchor).toEqual(anchor());
    expect(last().stoppedAfterMs).toBeNull();
    expect(last().problem).toBeNull();
  });

  it("is black while nothing is on the prompter", async () => {
    const hardware = fakeLink(NOTHING_ON);
    follow(hardware.link);
    await settle();
    expect(last()).toEqual({ text: null, anchor: null, stoppedAfterMs: null, problem: null });
  });

  it("moves the text by a take's event alone, and reads nothing", async () => {
    const hardware = fakeLink(glass());
    follow(hardware.link);
    await settle();
    const reads = hardware.reads();
    for (const reason of ["played", "speed", "jumped", "paused", "at-end", "laid-out"]) {
      const moved = anchor({ playing: reason === "played", wordOffset: 3, position: 120 });
      hardware.says("prompter.changed", changed(reason, moved));
      expect(last().anchor, reason).toEqual(moved);
    }
    await settle();
    expect(hardware.reads()).toBe(reads);
  });

  it("reads the glass again when what is drawn may have changed", async () => {
    const hardware = fakeLink(glass());
    follow(hardware.link);
    await settle();

    // A colour: the same key, another look.
    hardware.answers(glass({ look: standardLook({ textColour: "yellow" }) }));
    hardware.says("prompter.changed", changed("look", anchor()));
    await settle();
    expect(last().text?.look.textColour).toBe("yellow");

    // Another size: another key, and its anchor is not this text's.
    const resized = glass({ layoutKey: "g1-l1", sizePx: 92, anchor: anchor({ layoutKey: "g1-l1" }) });
    hardware.answers(resized);
    hardware.says("prompter.changed", changed("size", anchor({ layoutKey: "g1-l1" })));
    expect(last().text?.layoutKey, "not before it is read").toBe("g1-l0");
    await settle();
    expect(last().text).toMatchObject({ layoutKey: "g1-l1", sizePx: 92 });
    expect(last().anchor?.layoutKey).toBe("g1-l1");

    // Cleared: no anchor.
    hardware.answers(NOTHING_ON);
    hardware.says("prompter.changed", changed("cleared", null));
    await settle();
    expect(last().text).toBeNull();
    expect(last().anchor).toBeNull();

    // A script is put on.
    hardware.answers(glass({ layoutKey: "g2-l1" }));
    hardware.says("prompter.changed", changed("put-on", anchor({ layoutKey: "g2-l1" })));
    await settle();
    expect(last().text?.layoutKey).toBe("g2-l1");
  });

  it("keeps the anchor of an event that came while the glass was read", async () => {
    const hardware = fakeLink(glass());
    follow(hardware.link);
    await settle();

    hardware.holdReads();
    hardware.answers(glass({ look: standardLook({ dimReadText: false }), anchor: anchor({ wordOffset: 1 }) }));
    hardware.says("prompter.changed", changed("look", anchor({ wordOffset: 1 })));
    await settle();
    // The take goes on while the read waits.
    const newer = anchor({ wordOffset: 9, playing: true });
    hardware.says("prompter.changed", changed("played", newer));
    hardware.release();
    await settle();
    expect(last().text?.look.dimReadText).toBe(false);
    expect(last().anchor).toEqual(newer);
  });

  it("stops the text where it stands when the hardware link is gone, and reads again when it is back", async () => {
    const hardware = fakeLink(glass());
    follow(hardware.link);
    await settle();
    const playing = anchor({ playing: true, fromWpm: 140, toWpm: 140, position: 0, pxPerReadWord: 10 });
    hardware.says("prompter.changed", changed("played", playing));

    now += 7_250;
    hardware.answers(new Error("Engine is not running"));
    hardware.says("engine.exited", { graceful: false });
    expect(last().stoppedAfterMs).toBe(7_250);
    expect(last().anchor).toEqual(playing);
    expect(last().text?.layoutKey).toBe("g1-l0");

    // It asks once a second, and the text stands meanwhile.
    const reads = hardware.reads();
    now += 3_000;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(hardware.reads()).toBe(reads + 3);
    expect(last().stoppedAfterMs).toBe(7_250);
    expect(last().problem).toBeNull();

    // Back, paused at the saved place.
    const saved = anchor({ wordOffset: 16 });
    hardware.answers(glass({ anchor: saved }));
    hardware.says("engine.ready", {});
    await settle();
    expect(last().stoppedAfterMs).toBeNull();
    expect(last().anchor).toEqual(saved);
    // Nothing is read any more once it answered.
    const after = hardware.reads();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(hardware.reads()).toBe(after);
  });

  it("says what the hardware link refused, and reads again", async () => {
    const hardware = fakeLink(new EngineRequestError("INTERNAL", "The prompter's state could not be read."));
    follow(hardware.link);
    await settle();
    expect(last().problem).toBe("The prompter's state could not be read.");
    expect(last().text).toBeNull();

    hardware.answers(glass());
    await vi.advanceTimersByTimeAsync(1_000);
    expect(last().problem).toBeNull();
    expect(last().text?.layoutKey).toBe("g1-l0");
  });

  it("says that it cannot follow the take when it cannot listen, whatever a read says", async () => {
    const failures: string[] = [];
    const hardware = fakeLink(new EngineRequestError("INTERNAL", "The prompter's state could not be read."));
    vi.mocked(hardware.link.listen).mockRejectedValueOnce(new Error("event.listen not allowed"));
    followGlass(hardware.link, (view) => views.push(view), {
      now: () => now,
      onFailure: (_error, doing) => failures.push(doing),
    });
    await settle();
    expect(failures).toContain("listening to the hardware link");
    expect(hardware.listening()).toBe(false);

    // The read that is tried again answers: the glass it read is drawn (the
    // shell decides what is shown), and the problem stays.
    hardware.answers(glass());
    await vi.advanceTimersByTimeAsync(1_000);
    expect(last().text?.layoutKey).toBe("g1-l0");
    expect(last().problem).toBe(CANNOT_HEAR);
  });

  it("takes a hardware link that does not answer for one that is not there yet", async () => {
    const failures: string[] = [];
    const hardware = fakeLink(new Error("Engine is not running"));
    followGlass(hardware.link, (view) => views.push(view), {
      now: () => now,
      onFailure: (_error, doing) => failures.push(doing),
    });
    await settle();
    expect(views.every((view) => view.problem === null)).toBe(true);
    expect(failures).toContain("reading the glass");

    // An end told by the hardware link's own answer is no refusal either.
    hardware.answers(new EngineRequestError("ENGINE_EXITED", "The hardware link stopped."));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(views.every((view) => view.problem === null)).toBe(true);

    hardware.answers(glass());
    await vi.advanceTimersByTimeAsync(1_000);
    expect(last().text?.layoutKey).toBe("g1-l0");
  });

  it("hears nothing and reads nothing once it is stopped", async () => {
    const hardware = fakeLink(new Error("Engine is not running"));
    const stop = follow(hardware.link);
    await settle();
    stop();
    expect(hardware.listening()).toBe(false);
    const reads = hardware.reads();
    const drawn = views.length;
    await vi.advanceTimersByTimeAsync(5_000);
    hardware.says("prompter.changed", changed("played", anchor()));
    expect(hardware.reads()).toBe(reads);
    expect(views).toHaveLength(drawn);
  });

  it("hears only what is the prompter's", async () => {
    const hardware = fakeLink(glass());
    follow(hardware.link);
    await settle();
    const reads = hardware.reads();
    const drawn = views.length;
    for (const event of ["audio.meters", "lighting.changed", "app.changed", "cameras.changed"] as const) {
      hardware.says(event, { reason: "played" });
    }
    await settle();
    expect(hardware.reads()).toBe(reads);
    expect(views).toHaveLength(drawn);
  });
});
