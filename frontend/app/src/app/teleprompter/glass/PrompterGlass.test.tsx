import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { INTERVIEW_INTRO, paragraph, standardLook, storyAnchor } from "./glassStoryScript";
import { PrompterGlass, type PrompterGlassText } from "./PrompterGlass";

// The glass as a component (new pages program, Slice 5a). jsdom lays nothing
// out, so the layout's numbers are the helpers' to prove (`glassLayout.test.ts`);
// here: what it draws, and when it reports its layout. Where a test needs a
// layout, `layOut` stands in for the browser: each paragraph 400 px below the
// last, its words on its first line, `END` far below.

/** Lays the glass out as a browser would, as far as the glass measures it; answers how often a top was read. */
function layOut(): { reads: () => number } {
  let reads = 0;
  vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (this: HTMLElement) {
    reads += 1;
    const paragraph = this.getAttribute("data-p");
    if (paragraph !== null) return Number(paragraph) * 400;
    return this.hasAttribute("data-end") ? 10_000 : 0;
  });
  return { reads: () => reads };
}

afterEach(() => {
  vi.restoreAllMocks();
});

function text(overrides: Partial<PrompterGlassText> = {}): PrompterGlassText {
  return {
    layoutKey: "g1-l0",
    paragraphs: [paragraph("[INTRO]\nWelcome to ", { text: "the studio", bold: true }, "."), paragraph("")],
    look: standardLook(),
    sizePx: 88,
    ...overrides,
  };
}

describe("PrompterGlass", () => {
  it("is black with no arrow while nothing is on the prompter", () => {
    const { container } = render(<PrompterGlass text={null} anchor={null} width={960} testId="glass" />);
    const glass = screen.getByTestId("glass");
    expect(glass.getAttribute("role")).toBe("img");
    expect(glass.getAttribute("data-picture")).toBe("prompter-glass");
    expect(glass.style.width).toBe("960px");
    expect(glass.style.height).toBe("540px");
    expect(container.querySelector("[data-p]")).toBeNull();
    expect(container.querySelector("[data-end]")).toBeNull();
  });

  it("draws every paragraph, its words by the hardware link's count, the cue line and END", () => {
    const { container } = render(<PrompterGlass text={text()} anchor={storyAnchor()} width={1920} still />);
    const paragraphs = container.querySelectorAll("[data-p]");
    expect(paragraphs).toHaveLength(2);
    const words = [...paragraphs[0].querySelectorAll("[data-w]")].map((word) => [
      word.getAttribute("data-w"),
      word.textContent,
    ]);
    expect(words).toEqual([
      ["0", "[INTRO]"],
      ["1", "Welcome"],
      ["2", "to"],
      ["3", "the"],
      ["4", "studio."],
    ]);
    expect([...paragraphs[0].querySelectorAll("b")].map((bold) => bold.textContent)).toEqual(["the", "studio"]);
    expect(paragraphs[0].querySelectorAll("br")).toHaveLength(1);
    expect(paragraphs[1].querySelectorAll("[data-w]")).toHaveLength(0);
    expect(container.querySelector("[data-end]")?.textContent).toBe("END");
    // Unmirrored and scaled: the glass draws nothing the presenter does not read.
    expect(container.textContent).toBe("[INTRO]Welcome to the studio.END");
  });

  it("hangs paragraph numbers in the margin only when the look shows them", () => {
    const { container, rerender } = render(<PrompterGlass text={text()} anchor={null} width={1920} still />);
    expect(container.querySelectorAll("[aria-hidden='true']")).toHaveLength(0);
    rerender(
      <PrompterGlass text={text({ look: standardLook({ paragraphNumbers: true }) })} anchor={null} width={1920} still />
    );
    expect([...container.querySelectorAll("[aria-hidden='true']")].map((node) => node.textContent)).toEqual(["1", "2"]);
  });

  it("reports its layout once for each key, every paragraph with a line", async () => {
    layOut();
    const onLayout = vi.fn();
    const { rerender } = render(
      <PrompterGlass text={text()} anchor={storyAnchor()} width={1920} onLayout={onLayout} />
    );
    await waitFor(() => expect(onLayout).toHaveBeenCalledTimes(1));
    const report = onLayout.mock.calls[0][0];
    expect(report.layoutKey).toBe("g1-l0");
    expect(report.lines.map((line: { paragraph: number }) => line.paragraph)).toEqual([0, 1]);
    expect(report.lines.every((line: { height: number }) => line.height > 0)).toBe(true);

    // A new anchor for the same text is not a new layout.
    rerender(<PrompterGlass text={text()} anchor={storyAnchor({ playing: true })} width={1920} onLayout={onLayout} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onLayout).toHaveBeenCalledTimes(1);

    rerender(
      <PrompterGlass
        text={text({ layoutKey: "g1-l1", sizePx: 92 })}
        anchor={storyAnchor()}
        width={1920}
        onLayout={onLayout}
      />
    );
    await waitFor(() => expect(onLayout).toHaveBeenCalledTimes(2));
    expect(onLayout.mock.calls[1][0].layoutKey).toBe("g1-l1");
  });

  it("reports no layout the hardware link would refuse: one measured while the glass is not drawn", async () => {
    const onLayout = vi.fn();
    render(<PrompterGlass text={text()} anchor={storyAnchor()} width={1920} onLayout={onLayout} />);
    // jsdom draws nothing: every top is 0.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onLayout).not.toHaveBeenCalled();
  });

  it("reports again, at most once a second, when an anchor says the hardware link has no layout for its key", async () => {
    layOut();
    const onLayout = vi.fn();
    const laidOut = storyAnchor({ layoutKey: "g1-l0", position: 0, place: { paragraph: 0, word: 0 }, wordOffset: 0 });
    const { rerender } = render(<PrompterGlass text={text()} anchor={laidOut} width={1920} onLayout={onLayout} />);
    await waitFor(() => expect(onLayout).toHaveBeenCalledTimes(1));

    // The hardware link restarted: the same key, and no layout for it.
    rerender(<PrompterGlass text={text()} anchor={{ ...laidOut, position: null }} width={1920} onLayout={onLayout} />);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(onLayout).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onLayout).toHaveBeenCalledTimes(2), { timeout: 2000 });
    expect(onLayout.mock.calls[1][0]).toEqual(onLayout.mock.calls[0][0]);

    // Laid out again: nothing more is sent.
    rerender(<PrompterGlass text={text()} anchor={{ ...laidOut }} width={1920} onLayout={onLayout} />);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(onLayout).toHaveBeenCalledTimes(2);
  });

  it("measures again only when the key or the geometry changes, never for a new object of the same look", async () => {
    const { reads } = layOut();
    const onLayout = vi.fn();
    const { rerender } = render(<PrompterGlass text={text()} anchor={null} width={1920} onLayout={onLayout} />);
    await waitFor(() => expect(onLayout).toHaveBeenCalledTimes(1));
    const measured = reads();
    // A fresh text of the same paragraphs and look, then the reading line and the colour: the same key.
    rerender(<PrompterGlass text={text()} anchor={null} width={1920} onLayout={onLayout} />);
    rerender(
      <PrompterGlass
        text={text({ look: standardLook({ readingLinePercent: 40, textColour: "yellow", dimReadText: false }) })}
        anchor={null}
        width={1920}
        onLayout={onLayout}
      />
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(reads()).toBe(measured);
    expect(onLayout).toHaveBeenCalledTimes(1);
  });

  it("reports again for a key that comes back with other text, as after a restore of the saved data", async () => {
    layOut();
    const onLayout = vi.fn();
    const { rerender } = render(<PrompterGlass text={text()} anchor={null} width={1920} onLayout={onLayout} />);
    await waitFor(() => expect(onLayout).toHaveBeenCalledTimes(1));
    rerender(
      <PrompterGlass
        text={text({ paragraphs: [paragraph("One."), paragraph("Two."), paragraph("Three.")] })}
        anchor={null}
        width={1920}
        onLayout={onLayout}
      />
    );
    await waitFor(() => expect(onLayout).toHaveBeenCalledTimes(2));
    expect(onLayout.mock.calls[1][0].lines.map((line: { paragraph: number }) => line.paragraph)).toEqual([0, 1, 2]);
  });

  it("keeps an anchor's moment when only the dimming changes", () => {
    layOut();
    let now = 1_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    // Playing at 60 words a minute, 10 px a word, from the top of this layout.
    const playing = storyAnchor({
      layoutKey: "g1-l0",
      place: { paragraph: 0, word: 0 },
      wordOffset: 0,
      position: 0,
      endPosition: 5_000,
      pxPerReadWord: 10,
      playing: true,
      fromWpm: 60,
      toWpm: 60,
    });
    const { container, rerender } = render(<PrompterGlass text={text()} anchor={playing} width={1920} />);
    const column = container.querySelector<HTMLElement>("[data-p]")!.parentElement!;
    const shiftAt = () => Number(/translate3d\(0, (-?[\d.]+)px, 0\)/.exec(column.style.transform)?.[1]);
    const start = shiftAt();
    now += 4_000;
    rerender(
      <PrompterGlass text={text({ look: standardLook({ dimReadText: false }) })} anchor={playing} width={1920} />
    );
    // Four words on: 40 px further up, not back at the anchor's own place.
    expect(start - shiftAt()).toBeCloseTo(40);
  });

  // The Prompter XL's window: the hardware link is gone while the text
  // scrolls. Nothing scrolls by itself (D12), so the text stands where it
  // stood at that moment: not back at the anchor's own place, and no further.
  it("stands where the text stood when it is stopped, and moves no more", () => {
    layOut();
    let now = 1_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const frames = vi.spyOn(window, "requestAnimationFrame");
    const playing = storyAnchor({
      layoutKey: "g1-l0",
      place: { paragraph: 0, word: 0 },
      wordOffset: 0,
      position: 0,
      endPosition: 5_000,
      pxPerReadWord: 10,
      playing: true,
      fromWpm: 60,
      toWpm: 60,
    });
    const { container, rerender } = render(<PrompterGlass text={text()} anchor={playing} width={1920} />);
    const column = container.querySelector<HTMLElement>("[data-p]")!.parentElement!;
    const shiftAt = () => Number(/translate3d\(0, (-?[\d.]+)px, 0\)/.exec(column.style.transform)?.[1]);
    const start = shiftAt();

    // Stopped four seconds after the anchor came: four words on.
    now += 4_000;
    frames.mockClear();
    rerender(<PrompterGlass text={text()} anchor={playing} width={1920} stoppedAfterMs={4_000} />);
    expect(start - shiftAt()).toBeCloseTo(40);
    expect(frames).not.toHaveBeenCalled();

    // A minute on, and drawn again for another reason, it stands there still.
    now += 60_000;
    rerender(
      <PrompterGlass
        text={text({ look: standardLook({ dimReadText: false }) })}
        anchor={playing}
        width={1920}
        stoppedAfterMs={4_000}
      />
    );
    expect(start - shiftAt()).toBeCloseTo(40);
    expect(frames).not.toHaveBeenCalled();
  });

  it("stands a word that wraps on the line of its first piece", async () => {
    layOut();
    // The word's box spans two lines; its first piece is on the first.
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute("data-w") ? 250 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
      const rects = this.hasAttribute("data-w") ? [new DOMRect(0, 10, 1400, 100), new DOMRect(0, 133, 300, 100)] : [];
      return Object.assign(rects, { item: (index: number) => rects[index] ?? null }) as unknown as DOMRectList;
    });
    const onLayout = vi.fn();
    render(
      <PrompterGlass
        text={text({ paragraphs: [paragraph("Arbetsmarknadsdepartementet"), paragraph("")] })}
        anchor={null}
        width={1920}
        onLayout={onLayout}
      />
    );
    await waitFor(() => expect(onLayout).toHaveBeenCalledTimes(1));
    expect(onLayout.mock.calls[0][0].lines[0]).toMatchObject({ paragraph: 0, word: 0, top: 0 });
  });

  it("draws a cue in the cue colour where it stands, inside a word too", () => {
    const { container } = render(
      <PrompterGlass
        text={text({ paragraphs: [paragraph("Hello [smile]. Welcome.")] })}
        anchor={null}
        width={1920}
        still
      />
    );
    const cued = [...container.querySelectorAll("[data-w] span")].map((node) => node.textContent);
    expect(cued).toEqual(["[smile]"]);
  });

  it("draws the place from the anchor with a transform, and dims the read text only when the look says so", () => {
    const { container, rerender } = render(
      <PrompterGlass
        text={text({ paragraphs: INTERVIEW_INTRO })}
        anchor={storyAnchor({ place: { paragraph: 1, word: 0 }, wordOffset: 0 })}
        width={1920}
        still
      />
    );
    const column = container.querySelector<HTMLElement>("[data-p]")!.parentElement!;
    expect(column.style.transform).toMatch(/^translate3d\(0, -?[\d.]+px, 0\)$/);
    expect(container.innerHTML).toContain("height:");
    rerender(
      <PrompterGlass
        text={text({ paragraphs: INTERVIEW_INTRO, look: standardLook({ dimReadText: false }) })}
        anchor={storyAnchor()}
        width={1920}
        still
      />
    );
    expect(column.parentElement!.children).toHaveLength(2);
  });
});
