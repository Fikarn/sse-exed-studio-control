import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { InspectorSection } from "../InspectorSection";

// InspectorSection is layout only. The tests cover it with and without a
// title, a class of the caller's, and attributes passed through.

describe("InspectorSection", () => {
  it("renders children inside a <section>", () => {
    render(
      <InspectorSection>
        <p>contents</p>
      </InspectorSection>
    );
    const section = screen.getByText("contents").closest("section");
    expect(section).not.toBeNull();
    expect(section?.className).toMatch(/section/);
  });

  it("renders the optional title as an <h3>", () => {
    render(
      <InspectorSection title="Identity">
        <p>x</p>
      </InspectorSection>
    );
    const heading = screen.getByRole("heading", { level: 3, name: "Identity" });
    expect(heading).toBeInTheDocument();
  });

  it("omits the heading when no title is supplied", () => {
    render(
      <InspectorSection>
        <p>x</p>
      </InspectorSection>
    );
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
  });

  it("merges a caller-supplied className", () => {
    const { container } = render(
      <InspectorSection className="extra-class">
        <p>x</p>
      </InspectorSection>
    );
    const section = container.querySelector("section");
    expect(section?.className).toMatch(/extra-class/);
  });

  it("forwards arbitrary HTML attributes (e.g. data-*)", () => {
    const { container } = render(
      <InspectorSection data-testid="ident-section">
        <p>x</p>
      </InspectorSection>
    );
    expect(container.querySelector('[data-testid="ident-section"]')).not.toBeNull();
  });
});
