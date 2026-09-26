import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LightingSearchField } from "./LightingSearchField";

// New pages program, Slice 3 (decision 11): in the empty search field the arrows
// walk the Recent list and Enter recalls the scene lit in it — a focused list.
// Enter used to recall that scene even after Esc had closed the list: a live
// recall with nothing on screen to say which scene it would be. Now Enter
// recalls only while the list is open.

afterEach(() => {
  cleanup();
});

const recentScenes = [
  { id: "scene-warm-wash", name: "Warm wash" },
  { id: "scene-interview", name: "Interview" },
];

function renderField() {
  const onRecallRecentScene = vi.fn();
  render(
    <LightingSearchField
      recentScenes={recentScenes}
      searchQuery=""
      onRecallRecentScene={onRecallRecentScene}
      onSearchChange={() => {}}
    />
  );
  const field = screen.getByLabelText("Search fixtures, scenes and groups");
  return { field, onRecallRecentScene };
}

describe("LightingSearchField", () => {
  it("recalls from the Recent list only while it is open", () => {
    const { field, onRecallRecentScene } = renderField();
    act(() => {
      field.focus();
    });
    expect(document.activeElement).toBe(field);
    expect(screen.getByRole("listbox", { name: "Recent scenes" })).toBeTruthy();

    // Light the second scene, close the list with Esc, then press Enter.
    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "Interview" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "Recent scenes" })).toBeNull();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onRecallRecentScene).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(field);

    // The arrows open the list again; Enter then recalls the lit scene.
    fireEvent.keyDown(field, { key: "ArrowUp" });
    expect(screen.getByRole("listbox", { name: "Recent scenes" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Warm wash" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onRecallRecentScene).toHaveBeenCalledTimes(1);
    expect(onRecallRecentScene).toHaveBeenCalledWith("scene-warm-wash");
    expect(screen.queryByRole("listbox", { name: "Recent scenes" })).toBeNull();
  });

  it("keeps a list Esc closed closed when a refresh hands it the same scenes", () => {
    const onRecallRecentScene = vi.fn();
    const view = render(
      <LightingSearchField
        recentScenes={recentScenes}
        searchQuery=""
        onRecallRecentScene={onRecallRecentScene}
        onSearchChange={() => {}}
      />
    );
    const field = screen.getByLabelText("Search fixtures, scenes and groups");
    act(() => {
      field.focus();
    });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "Recent scenes" })).toBeNull();

    // Every lighting refresh builds the list again: the same scenes, a new array.
    view.rerender(
      <LightingSearchField
        recentScenes={recentScenes.map((scene) => ({ ...scene }))}
        searchQuery=""
        onRecallRecentScene={onRecallRecentScene}
        onSearchChange={() => {}}
      />
    );
    expect(screen.queryByRole("listbox", { name: "Recent scenes" })).toBeNull();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onRecallRecentScene).not.toHaveBeenCalled();
  });
});
