import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";

import {
  COVERING_LAYER_SELECTOR,
  ContextMenu,
  Dialog,
  Drawer,
  Menu,
  MenuButton,
  Popover,
  Toast,
  Tooltip,
  floatingLayers,
} from "@sse/design-system";

import { measurePlaces } from "./picturePlaces";

// The Cameras rule (visual overhaul B, DESIGN.md §7): every overlay the design
// system draws over a picture is a floating layer the native picture layer
// leaves a hole for — a menu, a list, a tooltip or an element of the floating
// layer, counted once — and none is a dialog, which would hide every picture.

afterEach(cleanup);

function Bay() {
  return <div data-testid="bay" />;
}

function holesNow(): { holes: number; covered: boolean } {
  const bay = document.querySelector<HTMLElement>("[data-testid='bay']")!;
  const measured = measurePlaces(bay);
  return { holes: measured.floating.length, covered: measured.covered };
}

function MenuButtonOpen() {
  const ref = useRef<HTMLDivElement | null>(null);
  return (
    <div ref={ref}>
      <MenuButton
        buttonLabel="CAM 1 menu"
        contextTarget={ref}
        menu={{
          head: { title: "CAM 1" },
          items: [{ id: "release", label: "Release", onSelect: () => undefined }],
          destructive: { id: "forget", label: "Forget CAM 1…", onConfirm: () => undefined },
        }}
      />
    </div>
  );
}

describe("every overlay over a picture is a hole, once, and never a dialog", () => {
  it("a menu at the pointer", () => {
    render(
      <>
        <Bay />
        <Menu
          open
          anchor={{ x: 600, y: 300 }}
          onClose={() => undefined}
          head={{ title: "CAM 1" }}
          items={[{ id: "a", label: "Release", onSelect: () => undefined }]}
        />
      </>
    );
    expect(holesNow()).toEqual({ holes: 1, covered: false });
  });

  it("the ⋯ key's menu, opened", () => {
    const { getByRole } = render(
      <>
        <Bay />
        <MenuButtonOpen />
      </>
    );
    fireEvent.click(getByRole("button", { name: "CAM 1 menu" }));
    expect(holesNow()).toEqual({ holes: 1, covered: false });
  });

  it("the context menu", () => {
    render(
      <>
        <Bay />
        <ContextMenu
          x={600}
          y={300}
          onClose={() => undefined}
          items={[{ id: "a", label: "Release", onSelect: () => undefined }]}
        />
      </>
    );
    expect(holesNow()).toEqual({ holes: 1, covered: false });
  });

  it("a popover, with a list of values in it", () => {
    function Open() {
      const anchor = useRef<HTMLButtonElement | null>(null);
      return (
        <>
          <button ref={anchor} type="button">
            ISO
          </button>
          <Popover open anchor={anchor.current ?? { x: 10, y: 10 }} onClose={() => undefined} label="ISO">
            <div role="listbox" aria-label="ISO values">
              <div role="option" aria-selected="true">
                400
              </div>
            </div>
          </Popover>
        </>
      );
    }
    render(
      <>
        <Bay />
        <Open />
      </>
    );
    expect(document.querySelector("[data-popover]")?.getAttribute("role")).not.toBe("dialog");
    expect(holesNow()).toEqual({ holes: 1, covered: false });
  });

  it("a tooltip while it is shown, and nothing while it is not", () => {
    const { getByText } = render(
      <>
        <Bay />
        <Tooltip content="Shows the zebras over the picture" delayMs={0}>
          <button type="button">Zebras</button>
        </Tooltip>
      </>
    );
    expect(holesNow()).toEqual({ holes: 0, covered: false });
    act(() => {
      fireEvent.pointerEnter(getByText("Zebras").parentElement!.parentElement!);
    });
    expect(holesNow()).toEqual({ holes: 1, covered: false });
  });

  it("a message", () => {
    render(
      <>
        <Bay />
        <Toast
          tone="ok"
          title="CAM 1 released"
          message="It may be taken by another program."
          onDismiss={() => undefined}
        />
      </>
    );
    expect(holesNow()).toEqual({ holes: 1, covered: false });
  });

  it("a dialog and a drawer hide every picture instead", () => {
    const { rerender } = render(
      <>
        <Bay />
        <Dialog title="Set the ISO" onClose={() => undefined}>
          <p>Body</p>
        </Dialog>
      </>
    );
    expect(document.querySelector(COVERING_LAYER_SELECTOR)).not.toBeNull();
    expect(holesNow().covered).toBe(true);
    rerender(
      <>
        <Bay />
        <Drawer open title="Look" onClose={() => undefined}>
          <p>Body</p>
        </Drawer>
      </>
    );
    expect(holesNow().covered).toBe(true);
  });

  it("counts a list inside a floating panel once", () => {
    render(
      <div data-level="float">
        <div role="listbox" aria-label="values" />
        <div role="menu" aria-label="more" />
      </div>
    );
    expect(floatingLayers(document)).toHaveLength(1);
  });
});
