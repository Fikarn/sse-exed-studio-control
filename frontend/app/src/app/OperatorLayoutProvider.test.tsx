import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OperatorLayoutProvider, useOperatorLayout } from "./OperatorLayoutProvider";

// New pages program, Slice SW (D22): Studio Control runs at 2560 × 1440 only,
// so the provider measures nothing (jsdom has no ResizeObserver or matchMedia,
// and none is stubbed here). What it keeps is the operator's UI scale and
// theme: remembered across starts, and stamped where the tokens read them —
// the root, body (for overlays that portal there) and <html>.

function Preferences() {
  const { setTheme, setUiScale, theme, uiScale } = useOperatorLayout();
  return (
    <>
      <p>{`${uiScale} ${theme}`}</p>
      <button type="button" onClick={() => setUiScale(90)}>
        90 %
      </button>
      <button type="button" onClick={() => setTheme("graphite")}>
        Graphite
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
  document.documentElement.removeAttribute("data-theme");
});

describe("OperatorLayoutProvider", () => {
  it("starts from the remembered UI scale and theme and stamps them on the root, body and <html>", () => {
    window.localStorage.setItem("app.operator.uiScale", "125");
    window.localStorage.setItem("app.operator.theme", "bone");
    renderProvider();

    expect(screen.getByText("125 bone")).toBeTruthy();
    expect(document.querySelector("[data-operator-layout-root]")?.getAttribute("data-ui-scale")).toBe("125");
    expect(document.body.hasAttribute("data-operator-scale-host")).toBe(true);
    expect(document.body.getAttribute("data-ui-scale")).toBe("125");
    expect(document.documentElement.getAttribute("data-theme")).toBe("bone");
  });

  it("reads an unknown UI scale as 100 %, and the address's theme before the remembered one", () => {
    window.localStorage.setItem("app.operator.uiScale", "150");
    window.localStorage.setItem("app.operator.theme", "bone");
    window.history.replaceState(null, "", "/?theme=graphite");
    renderProvider();

    expect(screen.getByText("100 graphite")).toBeTruthy();
  });

  it("remembers a new choice, stamps it, and takes the body stamp away when it unmounts", () => {
    const { unmount } = renderProvider();
    fireEvent.click(screen.getByRole("button", { name: "90 %" }));
    fireEvent.click(screen.getByRole("button", { name: "Graphite" }));

    expect(screen.getByText("90 graphite")).toBeTruthy();
    expect(window.localStorage.getItem("app.operator.uiScale")).toBe("90");
    expect(window.localStorage.getItem("app.operator.theme")).toBe("graphite");
    expect(document.body.getAttribute("data-ui-scale")).toBe("90");
    expect(document.documentElement.getAttribute("data-theme")).toBe("graphite");

    unmount();
    expect(document.body.hasAttribute("data-operator-scale-host")).toBe(false);
    expect(document.body.hasAttribute("data-ui-scale")).toBe(false);
  });
});
