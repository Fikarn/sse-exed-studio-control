import { expect, test } from "@playwright/test";

import { expectWorkspaceMounted, openFixture } from "./helpers/openFixture";

// 2026-09-23, after the production readiness program (a finding of 2026-09-22,
// recorded under `7413b53`). A scene tile and a group chip are dnd-kit sortable
// items, and dnd-kit's `listeners` carry an `onKeyDown` of their own. Spread
// after the item's own handler, it replaced it: Enter on a focused scene tile
// picked the tile up for a drag instead of recalling the scene, F2 never opened
// the rename, and Enter on a focused group chip picked the chip up instead of
// switching the group on or off, as its label says it does. Space still picks
// an item up for a keyboard drag (`lighting-rig-actions.spec.ts`).

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

test("F2 on a focused scene tile opens its rename", async ({ page }) => {
  const interview = page.getByRole("button", { name: "Recall scene Interview", exact: true });
  await interview.focus();
  await page.keyboard.press("F2");

  const rename = page.getByRole("textbox", { name: "Rename scene Interview" });
  await expect(rename).toBeFocused();
  await expect(rename).toHaveValue("Interview");
  await expect(interview).not.toHaveAttribute("data-dragging", "true");

  // Esc leaves the name as it was.
  await page.keyboard.press("Escape");
  await expect(rename).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Recall scene Interview", exact: true })).toBeVisible();
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
// inside a tile, in the rename F2 opens, is the rename's: a space there picked
// the tile up.

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

test("F2's rename takes a name with a space and keeps the tile where it is", async ({ page }) => {
  const interview = page.getByRole("button", { name: "Recall scene Interview", exact: true });
  await interview.focus();
  await page.keyboard.press("F2");
  const rename = page.getByRole("textbox", { name: "Rename scene Interview" });
  await expect(rename).toBeFocused();

  await rename.press("End");
  await page.keyboard.type(" wide");
  await expect(rename).toHaveValue("Interview wide");
  await expect(interview).not.toHaveAttribute("data-dragging", "true");
  await page.keyboard.press("Enter");

  await expect(page.getByRole("button", { name: "Recall scene Interview wide", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Recall scene Interview wide", exact: true })).not.toHaveAttribute(
    "data-dragging",
    "true"
  );
});
