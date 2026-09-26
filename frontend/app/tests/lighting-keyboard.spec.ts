import { expect, test } from "@playwright/test";

import { expectWorkspaceMounted, openFixture } from "./helpers/openFixture";

// 2026-09-23, after the production readiness program (a finding of 2026-09-22,
// recorded under `7413b53`). A scene tile and a group chip are dnd-kit sortable
// items, and dnd-kit's `listeners` carry an `onKeyDown` of their own. Spread
// after the item's own handler, it replaced it: Enter on a focused scene tile
// picked the tile up for a drag instead of recalling the scene, and Enter on a
// focused group chip picked the chip up instead of switching the group on or
// off, as its label says it does. Space still picks an item up for a keyboard
// drag (`lighting-rig-actions.spec.ts`).
//
// New pages program, Slice 3: these are plain keyboard operation and stay —
// Enter presses the focused tile or chip (D8), and the tile and chip reorder is
// a focused list (decision 11). F2 no longer opens a scene's rename (D8): a
// double-click on its name does, or Rename in its right-click menu. In the
// search field, Enter recalls a scene only while the Recent list is open
// (decision 11).

test.beforeEach(async ({ page }) => {
  await openFixture(page, "lighting-populated");
  await expectWorkspaceMounted(page, "lighting");
});

test("Enter on a focused scene tile recalls the scene instead of picking the tile up", async ({ page }) => {
  const interview = page.getByRole("button", { name: "Recall scene Interview", exact: true });
  await expect(interview).not.toHaveAttribute("aria-current", "true");

  await interview.focus();
  await page.keyboard.press("Enter");

  const recalled = page.getByLabel("Saved scenes").getByRole("button", { name: /^Recall scene Interview\b/ });
  await expect(recalled).toHaveAttribute("aria-current", "true");
  await expect(recalled).not.toHaveAttribute("data-dragging", "true");
});

test("Enter on a focused group chip switches the group, as its label says", async ({ page }) => {
  const back = page
    .getByRole("list", { name: "Lighting groups" })
    .getByRole("button", { name: /\. Toggle (on|off)\.$/ })
    .filter({ hasText: "Back" });
  const wasOn = (await back.getAttribute("aria-pressed")) === "true";

  await back.focus();
  await page.keyboard.press("Enter");

  await expect(back).toHaveAttribute("aria-pressed", wasOn ? "false" : "true");
  await expect(back).not.toHaveAttribute("data-dragging", "true");
});

// The same day's review of the fix: while an item is being dragged, every key
// is the drag's. dnd-kit hears them on the document, and Enter is one of the
// keys that drop an item. A first version of the fix ran the item's own Enter
// during a drag too, so Enter recalled the dragged scene or switched the
// dragged group (and, on a group chip, stopped the drop). And a key typed
// inside a tile, in its rename, is the rename's: a space there picked the tile
// up.

// dnd-kit's keyboard sensor starts listening on a timer after the pick-up
// (`lighting-rig-actions.spec.ts`, `keyboardDragOnto`).
async function sensorListening(page: import("@playwright/test").Page) {
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

test("Enter drops a scene tile picked up with Space, and recalls nothing", async ({ page }) => {
  const interview = page.getByRole("button", { name: "Recall scene Interview", exact: true });
  await interview.focus();
  await page.keyboard.press("Space");
  await expect(interview).toHaveAttribute("data-dragging", "true");
  await sensorListening(page);

  await page.keyboard.press("Enter");
  await expect(interview).not.toHaveAttribute("data-dragging", "true");
  await expect(interview).not.toHaveAttribute("aria-current", "true");
});

test("Enter drops a group chip picked up with Space, and leaves the group as it was", async ({ page }) => {
  const back = page
    .getByRole("list", { name: "Lighting groups" })
    .getByRole("button", { name: /\. Toggle (on|off)\.$/ })
    .filter({ hasText: "Back" });
  const pressed = await back.getAttribute("aria-pressed");
  await back.focus();
  await page.keyboard.press("Space");
  await expect(back).toHaveAttribute("data-dragging", "true");
  await sensorListening(page);

  await page.keyboard.press("Enter");
  await expect(back).not.toHaveAttribute("data-dragging", "true");
  await expect(back).toHaveAttribute("aria-pressed", pressed ?? "false");
});

// New pages program, Slice 3 (D8). Old: F2 on the focused tile opened the
// rename (the case "F2 on a focused scene tile opens its rename" went with the
// key). New: a double-click on the scene's name opens it. Reason: F2 was a key
// Studio Control bound; the double-click and the right-click menu's Rename are
// its twins. The first click of the double-click recalls the scene, as a click
// on the tile does, so the tile is named "(active)" from then on.
test("The rename a double-click opens takes a name with a space and keeps the tile where it is", async ({ page }) => {
  const interview = page.getByLabel("Saved scenes").getByRole("button", { name: /^Recall scene Interview\b/ });
  await interview.getByText("Interview", { exact: true }).dblclick();
  const rename = page.getByRole("textbox", { name: "Rename scene Interview" });
  await expect(rename).toBeFocused();
  await expect(rename).toHaveValue("Interview");

  await rename.press("End");
  await page.keyboard.type(" wide");
  await expect(rename).toHaveValue("Interview wide");
  await expect(interview).not.toHaveAttribute("data-dragging", "true");
  await page.keyboard.press("Enter");

  const renamed = page.getByLabel("Saved scenes").getByRole("button", { name: /^Recall scene Interview wide\b/ });
  await expect(renamed).toBeVisible();
  await expect(renamed).not.toHaveAttribute("data-dragging", "true");
});

// New pages program, Slice 3 (decision 11). In the empty search field the arrows
// walk the Recent list and Enter recalls the scene lit in it. Esc closes the
// list — and Enter used to recall that scene anyway, live, with nothing on
// screen to say which. The recall also took the focus out of the field, so the
// field keeping it is the proof that nothing was recalled.
test("Enter in the empty search field recalls nothing while the Recent list is closed", async ({ page }) => {
  // Interview, then Warm wash: the Recent list reads Warm wash, Interview.
  await page.getByRole("button", { name: "Recall scene Interview", exact: true }).click();
  await expect(page.getByRole("button", { name: "Recall scene Interview (active)" })).toBeVisible();
  await page.getByRole("button", { name: /^Recall scene Warm wash/ }).click();
  await expect(page.getByRole("button", { name: "Recall scene Warm wash (active)" })).toBeVisible();

  const search = page.getByLabel("Search fixtures, scenes and groups");
  const recentScenes = page.getByRole("listbox", { name: "Recent scenes" });
  await search.click();
  await expect(recentScenes).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(recentScenes.getByRole("option", { name: /Interview/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(recentScenes).toBeHidden();

  await page.keyboard.press("Enter");
  await expect(search).toBeFocused();
  await expect(recentScenes).toBeHidden();
  await expect(page.getByRole("button", { name: "Recall scene Warm wash (active)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Recall scene Interview (active)" })).toHaveCount(0);

  // With the list open again, Enter recalls the scene lit in it.
  await page.keyboard.press("ArrowDown");
  await expect(recentScenes).toBeVisible();
  await expect(recentScenes.getByRole("option", { name: /Warm wash/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await expect(recentScenes.getByRole("option", { name: /Interview/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Recall scene Interview (active)" })).toBeVisible();
  await expect(recentScenes).toBeHidden();
  await expect(search).not.toBeFocused();
});
