import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { INTERVIEW_INTRO, paragraph, standardLook, storyAnchor } from "./glassStoryScript";
import { PrompterGlass, type PrompterGlassText } from "./PrompterGlass";

// The glass as a component (new pages program, Slice 5a). jsdom lays nothing
// out, so the layout's numbers are the helpers' to prove (`glassLayout.test.ts`);
// here: what it draws, and that it reports its layout once for each key.

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
