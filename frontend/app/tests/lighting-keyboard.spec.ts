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
