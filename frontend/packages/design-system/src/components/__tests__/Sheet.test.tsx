import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Sheet, type SheetProps } from "../Sheet";

// The sheet (D51): the Session page's window. Modal, on the floating layer
// under the header, closed by Esc and a press on the dimmed page, opening
// from its Room and closing back into it, and only fading under reduced
// motion. JSDOM draws nothing and runs no animation, so the motion is read
// from a stand-in for `Element.animate` and the boxes are given.

const here = path.dirname(fileURLToPath(import.meta.url));
const rulesOf = (name: string) => readFileSync(path.join(here, "..", name), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

interface Played {
  target: Element;
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
  cancel: ReturnType<typeof vi.fn>;
  finish: () => void;
}

/** A stand-in for the Web Animations API: each animation finishes when the test says. */
function standInAnimations() {
  const played: Played[] = [];
  const animate = vi.fn(function (this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    let finish = () => undefined as void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const cancel = vi.fn();
    played.push({ target: this, keyframes, options, cancel, finish });
    return { finished, cancel } as unknown as Animation;
  });
  Object.defineProperty(Element.prototype, "animate", { value: animate, configurable: true, writable: true });
  return played;
}

const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }) as DOMRect;

/** The boxes as the page draws them: the window centred in the bay, the podcast Room on the page. */
function giveBoxes() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.getAttribute("role") === "dialog") return rect(680, 434, 1200, 620);
    if (this.id === "room") return rect(980, 342, 600, 880);
    return rect(0, 0, 0, 0);
  });
}

function reducedMotion(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({ matches: matches && query.includes("reduce"), media: query })),
  });
}

const ORIGINAL_ANIMATE = Object.getOwnPropertyDescriptor(Element.prototype, "animate");
const ORIGINAL_MATCH_MEDIA = Object.getOwnPropertyDescriptor(window, "matchMedia");

/** Puts back what a test stood in for (JSDOM has neither). */
function putBack(owner: object, name: string, original: PropertyDescriptor | undefined) {
  if (original) Object.defineProperty(owner, name, original);
  else delete (owner as Record<string, unknown>)[name];
}

afterEach(() => {
  vi.restoreAllMocks();
  putBack(Element.prototype, "animate", ORIGINAL_ANIMATE);
  putBack(window, "matchMedia", ORIGINAL_MATCH_MEDIA);
});

function Room() {
  return (
    <button type="button" id="room">
      Podcast Recording
    </button>
  );
}

function renderSheet(props: Partial<SheetProps> = {}) {
  const room = () => document.getElementById("room");
  const base: SheetProps = {
    open: true,
    title: "New session",
    width: 1200,
    height: 620,
    art: <div data-testid="art">the Room</div>,
    artWidth: 423,
    from: room,
    onClose: vi.fn(),
    onClosed: vi.fn(),
    testId: "session-window",
    children: (
      <>
        <input aria-label="Name this session" data-autofocus="" />
        <button type="button">Begin session</button>
      </>
    ),
  };
  const all = { ...base, ...props };
  const view = render(
    <>
      <Room />
      <Sheet {...all} />
    </>
  );
  const rerender = (next: Partial<SheetProps>) =>
    view.rerender(
      <>
        <Room />
        <Sheet {...all} {...next} />
      </>
    );
  return { ...view, props: all, rerender };
}

describe("Sheet", () => {
  it("is a modal dialog on the floating layer, with the dimmed page beside it", () => {
    renderSheet();
    const sheet = screen.getByRole("dialog", { name: "New session" });
    expect(sheet).toHaveAttribute("aria-modal", "true");
    expect(sheet).toHaveAttribute("data-level", "float");
    expect(sheet).toHaveAttribute("data-material", "plate");
    expect(sheet).toHaveAttribute("tabindex", "-1");
    expect(sheet).toBe(screen.getByTestId("session-window"));
    expect(sheet.parentElement).toBe(document.body);
    const scrim = screen.getByTestId("session-window-scrim");
    expect(scrim).toHaveAttribute("data-sheet-scrim", "");
    expect(sheet.contains(scrim)).toBe(false);
    expect(sheet.querySelector("[data-sheet-art]")).toContainElement(screen.getByTestId("art"));
    expect(sheet.querySelector("[data-sheet-body]")).toHaveTextContent("Begin session");
    expect(sheet.style.getPropertyValue("--sheet-width")).toBe("1200px");
    expect(sheet.style.getPropertyValue("--sheet-height")).toBe("620px");
    expect(sheet.style.getPropertyValue("--sheet-art-width")).toBe("423px");
  });

  it("is named by what its owner points at", () => {
    render(
      <Sheet open labelledBy="kicker" width={1200} height={620} onClose={vi.fn()}>
        <span id="kicker">New session</span>
      </Sheet>
    );
    const sheet = screen.getByRole("dialog", { name: "New session" });
    expect(sheet).toHaveAttribute("aria-labelledby", "kicker");
    expect(sheet).not.toHaveAttribute("aria-label");
    expect(sheet.style.getPropertyValue("--sheet-art-width")).toBe("0px");
    expect(sheet.querySelector("[data-sheet-art]")).toBeNull();
  });

  it("dims the page from under the header, which stays live, and stands with the drawer", () => {
    const css = rulesOf("Sheet.module.css");
    expect(css).toMatch(
      /\.scrim \{[^}]*position: fixed;\s*top: var\(--operator-shell-height, var\(--chrome-studio-header\)\);\s*right: 0;\s*bottom: 0;\s*left: 0;\s*z-index: var\(--z-overlay\);\s*background: var\(--material-scrim\);/
    );
    expect(css).toMatch(/\.sheet \{[^}]*position: fixed;[^}]*z-index: var\(--z-overlay\);/);
    expect(css).toMatch(
      /\.face \{[^}]*border: 1px solid var\(--material-line2\);\s*border-radius: var\(--radius-panel\);\s*background: var\(--material-raise\);\s*box-shadow: var\(--elevation-edge-light\), var\(--elevation-float\);/
    );
    expect(css).toMatch(
      /\.art \{[^}]*overflow: hidden;\s*border-radius: var\(--radius-panel\) 0 0 var\(--radius-panel\);/
    );
    expect(css).not.toMatch(/backdrop-filter|gradient\(/);
  });

  it("moves the focus in to the field it marks, and gives it back to the Room when it has closed", () => {
    const room = () => document.getElementById("room");
    const view = renderSheet({ open: false });
    const roomKey = room()!;
    roomKey.focus();
    view.rerender({ open: true, returnFocusTo: roomKey });
    expect(screen.getByRole("textbox", { name: "Name this session" })).toHaveFocus();
    view.rerender({ open: false, returnFocusTo: roomKey });
    // No motion to run here: it leaves at once.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(view.props.onClosed).toHaveBeenCalledTimes(1);
    expect(roomKey).toHaveFocus();
  });

  it("keeps Tab inside", async () => {
    const user = userEvent.setup();
    renderSheet({ children: <button type="button">Begin session</button> });
    const sheet = screen.getByRole("dialog");
    await user.tab();
    await user.tab();
    expect(sheet.contains(document.activeElement)).toBe(true);
  });

  it("asks to close on Esc wherever the focus is, unless a layer above took it, and on a press on the dimmed page", () => {
    const { props } = renderSheet();
    document.getElementById("room")!.focus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledWith("escape");
    expect(props.onClose).toHaveBeenCalledTimes(1);
    // A menu in the sheet that took the Esc keeps it.
    const taken = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    taken.preventDefault();
    window.dispatchEvent(taken);
    expect(props.onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Begin session" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("session-window-scrim"));
    expect(props.onClose).toHaveBeenLastCalledWith("scrim");
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  it("opens from its Room: the face grows from the Room's outline, the art travels in, the body fades in", () => {
    const played = standInAnimations();
    giveBoxes();
    renderSheet();
    const sheet = screen.getByRole("dialog");
    const of = (part: string) => played.find((animation) => animation.target === sheet.querySelector(part));
    const face = of("[data-sheet-face]")!;
    expect(face.keyframes).toEqual([
      { left: "300px", top: "-92px", width: "600px", height: "880px" },
      { left: "0px", top: "0px", width: "1200px", height: "620px" },
    ]);
    expect(face.options).toMatchObject({ duration: 340, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
    const art = of("[data-sheet-art]")!;
    expect(art.keyframes[0]!.transform).toBe(`translate(300px, -92px) scale(${880 / 620})`);
    expect(art.keyframes[1]).toEqual({ transform: "none" });
    expect(art.options).toMatchObject({ duration: 340 });
    const body = of("[data-sheet-body]")!;
    expect(body.keyframes[0]).toEqual({ opacity: 0, transform: "translateX(-16px)" });
    expect(body.options).toMatchObject({ duration: 200, delay: 210, fill: "backwards" });
    const scrim = played.find((animation) => animation.target === screen.getByTestId("session-window-scrim"))!;
    expect(scrim.options).toMatchObject({ duration: 260 });
    expect(played).toHaveLength(4);
  });

  it("stays drawn through its close, back into the Room, and leaves when the close has run", async () => {
    const played = standInAnimations();
    giveBoxes();
    const { props, rerender } = renderSheet();
    const opened = played.length;
    rerender({ open: false });
    const sheet = screen.getByRole("dialog");
    expect(sheet).toHaveAttribute("data-closing", "");
    const closes = played.slice(opened);
    const of = (target: Element | null) => closes.find((animation) => animation.target === target)!;
    expect(of(sheet.querySelector("[data-sheet-face]")).keyframes).toEqual([
      { left: "0px", top: "0px", width: "1200px", height: "620px" },
      { left: "300px", top: "-92px", width: "600px", height: "880px" },
    ]);
    expect(of(sheet.querySelector("[data-sheet-face]")).options).toMatchObject({ duration: 260, fill: "forwards" });
    expect(of(sheet.querySelector("[data-sheet-art]")).options).toMatchObject({ duration: 260, fill: "forwards" });
    expect(of(sheet.querySelector("[data-sheet-body]")).options).toMatchObject({ duration: 100, fill: "forwards" });
    expect(of(screen.getByTestId("session-window-scrim")).options).toMatchObject({ duration: 240, fill: "forwards" });
    // Esc and the dimmed page ask nothing while it closes.
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByTestId("session-window-scrim"));
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onClosed).not.toHaveBeenCalled();
    await act(async () => {
      for (const animation of closes) animation.finish();
    });
    expect(props.onClosed).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByTestId("session-window-scrim")).toBeNull();
    for (const animation of closes) expect(animation.cancel).toHaveBeenCalled();
  });

  it("only fades under reduced motion", async () => {
    reducedMotion(true);
    const played = standInAnimations();
    giveBoxes();
    const { props, rerender } = renderSheet();
    const sheet = screen.getByRole("dialog");
    const scrim = screen.getByTestId("session-window-scrim");
    expect(played.map((animation) => animation.target)).toEqual([sheet, scrim]);
    for (const animation of played) {
      expect(animation.keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
      expect(animation.options).toMatchObject({ duration: 200 });
    }
    rerender({ open: false });
    const closes = played.slice(2);
    expect(closes.map((animation) => animation.target)).toEqual([sheet, scrim]);
    for (const animation of closes) {
      expect(animation.keyframes).toEqual([{ opacity: 1 }, { opacity: 0 }]);
      expect(animation.options).toMatchObject({ duration: 120, fill: "forwards" });
    }
    await act(async () => {
      for (const animation of closes) animation.finish();
    });
    expect(props.onClosed).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("only fades when it has nothing to open from", () => {
    reducedMotion(false);
    const played = standInAnimations();
    giveBoxes();
    renderSheet({ from: undefined });
    expect(played.map((animation) => animation.keyframes)).toEqual([
      [{ opacity: 0 }, { opacity: 1 }],
      [{ opacity: 0 }, { opacity: 1 }],
    ]);
  });
});
