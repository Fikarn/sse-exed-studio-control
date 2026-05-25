import { render, screen } from "@testing-library/react";
import type { RefObject } from "react";
import { describe, expect, it } from "vitest";

import { Surface } from "../Surface";

// plan PR 6 / workstream D2: Surface is a non-interactive layout primitive
// (7 imports). Tests cover render, every padding + tone variant, and ref
// forwarding. No keyboard / focus assertions — purely visual.

describe("Surface", () => {
  it("renders children inside a <section>", () => {
    render(
      <Surface>
        <p>contents</p>
      </Surface>
    );
    const section = screen.getByText("contents").closest("section");
    expect(section).not.toBeNull();
    expect(section).toBeInTheDocument();
  });

  it("applies every documented padding", () => {
    for (const padding of ["sm", "md", "lg"] as const) {
      const { unmount, container } = render(<Surface padding={padding}>{padding}</Surface>);
      const section = container.querySelector("section");
      expect(section?.className).toMatch(new RegExp(padding));
      unmount();
    }
  });

  it("applies every documented tone", () => {
    for (const tone of ["default", "raised", "soft"] as const) {
      const { unmount, container } = render(<Surface tone={tone}>{tone}</Surface>);
      const section = container.querySelector("section");
      expect(section?.className).toMatch(new RegExp(tone));
      unmount();
    }
  });

  it("merges a caller-supplied className", () => {
    const { container } = render(<Surface className="extra-class">x</Surface>);
    const section = container.querySelector("section");
    expect(section?.className).toMatch(/extra-class/);
  });

  it("forwards ref to the underlying <section>", () => {
    // Plain ref object rather than `createRef` — the latter is for class
    // components and the repo's eslint config flags it.
    const ref: RefObject<HTMLElement | null> = { current: null };
    render(
      <Surface ref={ref}>
        <span>ref target</span>
      </Surface>
    );
    expect(ref.current).toBeInstanceOf(HTMLElement);
    expect(ref.current?.tagName).toBe("SECTION");
  });
});
