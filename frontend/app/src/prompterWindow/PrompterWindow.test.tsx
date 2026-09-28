import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  EventEnvelope,
  EventName,
  GlassLink,
  PrompterGlassSnapshot,
  PrompterLayoutReportRequest,
} from "@sse/engine-client";

import { paragraph, standardLook, storyAnchor } from "../app/teleprompter/glass/glassStoryScript";
import { glassWidthIn, PrompterWindow, STOPPED_BY_AN_ERROR } from "./PrompterWindow";

// The glass, as it is, unless a test breaks it.
const glassBreaks = vi.hoisted(() => ({ now: false }));
vi.mock("../app/teleprompter/glass/PrompterGlass", async (importOriginal) => {
  const real = await importOriginal<typeof import("../app/teleprompter/glass/PrompterGlass")>();
  return {
    ...real,
    PrompterGlass: (props: Parameters<typeof real.PrompterGlass>[0]) => {
      if (glassBreaks.now) throw new Error("Cannot read properties of undefined (reading 'lines')");
      return <real.PrompterGlass {...props} />;
    },
  };
});

// The prompter's window's page: the glass and nothing else. jsdom lays
// nothing out, so what the page draws is proven here by what it holds, and
// its size and its colours by the page tests (`prompter-window.spec.ts`).

function glass(overrides: Partial<PrompterGlassSnapshot> = {}): PrompterGlassSnapshot {
  return {
    scriptId: "script-1",
    name: "Interview intro",
    layoutKey: "g1-l0",
    paragraphs: [paragraph("[INTRO]\nWelcome to the studio."), paragraph("")],
    look: standardLook(),
    sizePx: 88,
    anchor: storyAnchor({ layoutKey: "g1-l0", place: { paragraph: 0, word: 0 }, wordOffset: 0 }),
    ...overrides,
  };
}

function linkTo(read: () => Promise<PrompterGlassSnapshot>) {
  let listener: ((event: EventEnvelope<EventName>) => void) | null = null;
  const alive = vi.fn(async (_problem?: string) => {});
  const reportLayout = vi.fn(async (_report: PrompterLayoutReportRequest) => ({ accepted: true }));
  const link: GlassLink = {
    listen: async (heard) => {
      listener = heard;
      return () => {
        listener = null;
      };
    },
    readGlass: read,
    reportLayout,
    alive,
  };
  return { link, alive, reportLayout, says: (event: EventEnvelope<EventName>) => listener?.(event) };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  glassBreaks.now = false;
});

describe("PrompterWindow", () => {
  it("draws the glass as large as the window lets it, at 16:9", () => {
    expect(glassWidthIn(1920, 1080)).toBe(1920);
    // Windows scales the Prompter XL: fewer of the page's pixels, the same screen.
    expect(glassWidthIn(1536, 864)).toBe(1536);
    expect(glassWidthIn(1280, 720)).toBe(1280);
    // Another shape: all of the glass, and black beside or under it.
    expect(glassWidthIn(1920, 1200)).toBe(1920);
    expect(glassWidthIn(2560, 1080)).toBe(1920);
    expect(glassWidthIn(960, 540)).toBe(960);
    expect(glassWidthIn(0, 0)).toBe(0);
  });

  it("is black, with nothing of its own, until the glass is read and while nothing is on the prompter", async () => {
    const hardware = linkTo(async () => glass({ layoutKey: null, paragraphs: [], anchor: null, scriptId: null }));
    const { container } = render(<PrompterWindow link={hardware.link} />);
    const page = screen.getByTestId("prompter-window");
    expect(page.textContent).toBe("");
    await waitFor(() => expect(hardware.alive).toHaveBeenCalled());
    expect(page.textContent).toBe("");
    expect(container.querySelectorAll("button, a, input, [role='button']")).toHaveLength(0);
    expect(screen.getByTestId("prompter-window-glass").getAttribute("data-picture")).toBe("prompter-glass");
  });

  it("draws the script's words and no others", async () => {
    const hardware = linkTo(async () => glass());
    render(<PrompterWindow link={hardware.link} />);
    const page = screen.getByTestId("prompter-window");
    await waitFor(() => expect(page.textContent).toBe("[INTRO]Welcome to the studio.END"));
    expect(screen.getByTestId("prompter-window-glass").getAttribute("data-layout-key")).toBe("g1-l0");
  });

  it("tells the shell that it draws, once a second", async () => {
    vi.useFakeTimers();
    const hardware = linkTo(async () => glass());
    render(<PrompterWindow link={hardware.link} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hardware.alive).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(hardware.alive).toHaveBeenCalledTimes(4);
    for (const call of hardware.alive.mock.calls) {
      expect(call[0]).toBeUndefined();
    }
  });

  it("tells the shell that an error stopped it, in words of its own", async () => {
    vi.useFakeTimers();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const stop of [
      () => new ErrorEvent("error", { error: new Error("Cannot read properties of undefined (reading 'paragraphs')") }),
      () =>
        Object.assign(new Event("unhandledrejection"), { reason: new Error("The command was refused"), promise: null }),
    ]) {
      const hardware = linkTo(async () => glass());
      const { unmount } = render(<PrompterWindow link={hardware.link} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(hardware.alive).toHaveBeenLastCalledWith(undefined);
      act(() => {
        window.dispatchEvent(stop());
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      // The Teleprompter page shows the shell's sentence: the error's own
      // words go to the console.
      expect(hardware.alive).toHaveBeenLastCalledWith(STOPPED_BY_AN_ERROR);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      expect(hardware.alive).toHaveBeenLastCalledWith(STOPPED_BY_AN_ERROR);
      unmount();
    }
    expect(logged).toHaveBeenCalled();
  });

  it("leaves the window black when the glass cannot be drawn, and says so in words of its own", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    glassBreaks.now = true;
    const hardware = linkTo(async () => glass());
    render(<PrompterWindow link={hardware.link} />);
    await waitFor(() => expect(hardware.alive).toHaveBeenLastCalledWith(STOPPED_BY_AN_ERROR));
    expect(screen.getByTestId("prompter-window").textContent).toBe("");
  });

  it("stands when the hardware link is gone", async () => {
    const hardware = linkTo(async () => glass());
    render(<PrompterWindow link={hardware.link} />);
    const page = screen.getByTestId("prompter-window");
    await waitFor(() => expect(page.textContent).toContain("Welcome"));
    expect(page.hasAttribute("data-stands")).toBe(false);
    act(() => hardware.says({ type: "event", event: "engine.exited", payload: { graceful: false } }));
    expect(page.hasAttribute("data-stands")).toBe(true);
    // The text is still there.
    expect(page.textContent).toContain("Welcome");
  });

  it("shows no menu of the browser's", async () => {
    const hardware = linkTo(async () => glass());
    render(<PrompterWindow link={hardware.link} />);
    const pressed = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    screen.getByTestId("prompter-window-glass").dispatchEvent(pressed);
    expect(pressed.defaultPrevented).toBe(true);
  });
});
