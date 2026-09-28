import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OperatorLayoutProvider, useOperatorLayout } from "./OperatorLayoutProvider";

// New pages program, Slice SW (D22): Studio Control runs at 2560 × 1440 only,
// so the provider measures nothing (jsdom has no ResizeObserver or matchMedia,
// and none is stubbed here). What it keeps is the operator's UI scale:
// remembered across starts, and stamped where the tokens read it — the root
// and body (for overlays that portal there). One theme, Studio (D25): a theme
// an older build remembered, or one an address names, changes nothing.

function Preferences() {
  const { setUiScale, uiScale } = useOperatorLayout();
  return (
    <>
      <p>{`scale ${uiScale}`}</p>
      <button type="button" onClick={() => setUiScale(90)}>
        90 %
      </button>
    </>
  );
}

function renderProvider() {
  return render(
    <OperatorLayoutProvider>
      <Preferences />
    </OperatorLayoutProvider>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("OperatorLayoutProvider", () => {
  it("starts from the remembered UI scale and stamps it on the root and body", () => {
    window.localStorage.setItem("app.operator.uiScale", "125");
    renderProvider();

    expect(screen.getByText("scale 125")).toBeTruthy();
    expect(document.querySelector("[data-operator-layout-root]")?.getAttribute("data-ui-scale")).toBe("125");
    expect(document.body.hasAttribute("data-operator-scale-host")).toBe(true);
    expect(document.body.getAttribute("data-ui-scale")).toBe("125");
  });

  it("reads an unknown UI scale as 100 %", () => {
    window.localStorage.setItem("app.operator.uiScale", "150");
    renderProvider();

    expect(screen.getByText("scale 100")).toBeTruthy();
  });

  it("leaves a theme an older build remembered, or an address names, unread", () => {
    window.localStorage.setItem("app.operator.theme", "bone");
    window.history.replaceState(null, "", "/?theme=graphite");
    renderProvider();

    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(window.localStorage.getItem("app.operator.theme")).toBe("bone");
  });

  it("remembers a new choice, stamps it, and takes the body stamp away when it unmounts", () => {
    const { unmount } = renderProvider();
    fireEvent.click(screen.getByRole("button", { name: "90 %" }));

    expect(screen.getByText("scale 90")).toBeTruthy();
    expect(window.localStorage.getItem("app.operator.uiScale")).toBe("90");
    expect(document.body.getAttribute("data-ui-scale")).toBe("90");

    unmount();
    expect(document.body.hasAttribute("data-operator-scale-host")).toBe(false);
    expect(document.body.hasAttribute("data-ui-scale")).toBe(false);
  });
});
