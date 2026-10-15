import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { SessionRoom } from "../SessionRoom";
import { GreenScreenDrawing, PodcastDrawing, WebinarDrawing } from "../SessionRoomDrawings";

// The Session page's Room (D51; board 2): a key on the page, the window's
// picture in the window, in one of three tones. The name and the line are text
// the page tests measure, so the Room is never a `data-picture`; the drawing
// is the SVG's, coloured by the Room's stylesheet from the tokens.

const here = path.dirname(fileURLToPath(import.meta.url));
const rulesOf = (name: string) => readFileSync(path.join(here, "..", name), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const TONES = ["green", "umber", "slate"] as const;
const PARTS = ["back", "ceil", "lit", "shade", "floor", "draw", "obj", "obj2", "accent", "accent2", "light"];

describe("SessionRoom", () => {
  it("is a key on the page, named by its name and its line, and no picture", () => {
    const onClick = vi.fn();
    render(
      <SessionRoom
        tone="umber"
        name="Podcast Recording"
        line="Voices around the table, a camera on each."
        onClick={onClick}
        testId="session-room-podcast"
      >
        <PodcastDrawing />
      </SessionRoom>
    );
    const room = screen.getByRole("button", { name: /Podcast Recording\s*Voices around the table/ });
    expect(room).toBe(screen.getByTestId("session-room-podcast"));
    expect(room).toHaveAttribute("type", "button");
    expect(room).toHaveAttribute("data-session-room", "umber");
    expect(room).toHaveAttribute("data-size", "page");
    expect(room).not.toHaveAttribute("data-picture");
    expect(room.querySelector("[data-picture]")).toBeNull();
    expect(room).not.toHaveAttribute("data-lit");
    expect(room).not.toHaveAttribute("data-away");
    expect(room.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    fireEvent.click(room);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("stays lit with its caption while its session runs, and stands empty while its window is open", () => {
    const { rerender } = render(
      <SessionRoom
        tone="umber"
        name="Podcast Recording"
        line="Voices around the table, a camera on each."
        lit
        caption={<span>In session · since 09:16</span>}
        testId="room"
      />
    );
    const room = screen.getByTestId("room");
    expect(room).toHaveAttribute("data-lit", "");
    expect(room).toHaveTextContent("In session · since 09:16");
    expect(room).not.toHaveTextContent("Voices around the table");
    rerender(
      <SessionRoom
        tone="umber"
        name="Podcast Recording"
        line="Voices around the table, a camera on each."
        away
        testId="room"
      />
    );
    expect(room).toHaveAttribute("data-away", "");
    expect(room).not.toHaveAttribute("data-lit");
    expect(room).toHaveTextContent("Voices around the table");
  });

  it("is the window's picture at the window's size: not a key, and always its line", () => {
    render(
      <SessionRoom
        tone="slate"
        name="Webinar"
        line="Live, to an audience online."
        size="window"
        caption="In session"
        testId="window-room"
      >
        <WebinarDrawing />
      </SessionRoom>
    );
    const room = screen.getByTestId("window-room");
    expect(room.tagName).toBe("DIV");
    expect(screen.queryByRole("button")).toBeNull();
    expect(room).toHaveAttribute("data-size", "window");
    expect(room).toHaveTextContent("Live, to an audience online.");
    expect(room).not.toHaveTextContent("In session");
    expect(room).not.toHaveAttribute("data-picture");
  });

  it("names its filters and gradients for itself, so two Rooms on one page never share one", () => {
    const { container } = render(
      <>
        <SessionRoom tone="green" name="Green Screen Recording" line="A presenter at the screen, with the prompter.">
          <GreenScreenDrawing />
        </SessionRoom>
        <SessionRoom tone="green" name="Green Screen Recording" line="" size="window">
          <GreenScreenDrawing />
        </SessionRoom>
        <SessionRoom tone="umber" name="Podcast Recording" line="">
          <PodcastDrawing />
        </SessionRoom>
      </>
    );
    const ids = Array.from(container.querySelectorAll("[id]")).map((element) => element.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-zA-Z0-9_-]+$/);
    // Every reference finds its definition in its own picture.
    for (const svg of Array.from(container.querySelectorAll("svg"))) {
      const references = Array.from(svg.querySelectorAll("[fill], [filter]"))
        .map((element) => element.getAttribute("fill") ?? element.getAttribute("filter") ?? "")
        .filter((value) => value.startsWith("url("))
        .map((value) => value.replace(/^url\(#(.+)\)$/, "$1"));
      expect(references.length).toBeGreaterThan(2);
      for (const reference of references) expect(svg.querySelector(`[id="${reference}"]`)).not.toBeNull();
    }
  });

  it("holds drawings with no text, in the Room's inks only, with lights that come on", () => {
    const { container } = render(
      <svg>
        <GreenScreenDrawing />
        <PodcastDrawing />
        <WebinarDrawing />
      </svg>
    );
    expect(container.textContent).toBe("");
    const inks = new Set(
      Array.from(container.querySelectorAll("[data-ink]")).flatMap((element) =>
        element.getAttribute("data-ink")!.split(" ")
      )
    );
    expect([...inks].sort()).toEqual(
      ["accent", "accent2", "dot", "fine", "heavy", "light", "line", "obj", "obj2", "shadow"].sort()
    );
    for (const drawing of ["green-screen", "podcast", "webinar"]) {
      expect(container.querySelector(`[data-drawing="${drawing}"] [data-light]`)).not.toBeNull();
    }
    // No colour is written into the drawing: the Room's stylesheet colours it.
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });

  it("re-points every part of its tone to the tokens, and draws at its two sizes with its own type steps", () => {
    const css = rulesOf("SessionRoom.module.css");
    for (const tone of TONES) {
      const block = css.match(new RegExp(`\\.${tone} \\{([^}]*)\\}`))?.[1] ?? "";
      for (const part of PARTS) {
        expect(block, `${tone} ${part}`).toContain(`--session-${part}: var(--session-${tone}-${part});`);
      }
    }
    expect(css).toMatch(/\.page \{[^}]*width: 600px;[^}]*height: 880px;[^}]*border-radius: var\(--radius-panel\);/);
    expect(css).toMatch(
      /\.window \{[^}]*width: 423px;[^}]*height: 620px;[^}]*border-radius: var\(--radius-panel\) 0 0 var\(--radius-panel\);/
    );
    expect(css).toMatch(/\.name \{[^}]*var\(--font-size-readout\)[^}]*letter-spacing: var\(--font-tracking-room\);/);
    expect(css).toMatch(
      /\.line \{[^}]*italic var\(--font-weight-regular\) var\(--font-size-word\)[^}]*var\(--text-text2\)/
    );
    expect(css).toMatch(/\.window \.name \{[^}]*font-size: var\(--font-size-word\);/);
    expect(css).toMatch(/\.window \.line \{[^}]*font-size: var\(--font-size-label\);/);
  });

  it("lights up by opacity and its edge only, and keeps the hero picture's focus ring", () => {
    const css = rulesOf("SessionRoom.module.css");
    expect(css).toMatch(/\.room \{[^}]*box-shadow: var\(--elevation-edge-light\);/);
    expect(css).toMatch(/\.page:hover:not\(:disabled\) \{\s*box-shadow: var\(--elevation-edge-hover\);\s*\}/);
    expect(css).toMatch(/\.art \[data-light\] \{\s*opacity: 0\.4;\s*transition: opacity var\(--motion-duration-move\)/);
    expect(css).toMatch(/\.art \[data-light="sky"\] \{\s*opacity: 0\.55;\s*\}/);
    expect(css).toMatch(
      /\.page:hover:not\(:disabled\) \.art \[data-light\],\s*\.page\[data-lit\] \.art \[data-light\],\s*\.window \.art \[data-light\] \{\s*opacity: 1;\s*\}/
    );
    expect(css).toMatch(/\.page:focus-visible \{\s*outline: 2px solid var\(--accent\);\s*outline-offset: 2px;\s*\}/);
    expect(css).not.toMatch(/gradient\(|backdrop-filter|data-picture/);
  });
});
