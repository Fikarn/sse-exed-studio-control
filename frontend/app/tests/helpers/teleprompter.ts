import { expect, type Locator, type Page } from "@playwright/test";

import { ARM_DWELL_MS } from "../../../packages/design-system/src/components/useArm";
import { expectWorkspaceMounted, openFixture } from "./openFixture";
import { pausePageClock } from "./pageClock";

// The Teleprompter page's helpers (the visual overhaul, 2026-10-05): the
// page's ⋯ (Open file…, Paste as a new script, New script), a script's one
// menu (its row's ⋯, a right-click on the row, the plate title's ⋯), and the
// two presses of an armed key on the page's clock.

/** Past the arm's dwell: a second press before it is a bounce, and applies nothing. */
export const PAST_THE_DWELL_MS = ARM_DWELL_MS + 50;

export async function openTeleprompter(page: Page, fixture = "teleprompter-ready") {
  await openFixture(page, fixture);
  await expectWorkspaceMounted(page, "teleprompter");
}

/** PLAY unlocks once the copy's layout has reached the hardware link. */
export async function expectLaidOut(page: Page) {
  await expect(page.getByTestId("teleprompter-play")).not.toHaveAttribute("data-locked", "", { timeout: 10_000 });
}

async function openMenu(page: Page, opener: Locator): Promise<Locator> {
  await opener.click();
  const menu = page.getByRole("menu").last();
  await expect(menu).toBeVisible();
  return menu;
}

/** The state display's ⋯: the page's standing commands. */
export function openPageMenu(page: Page): Promise<Locator> {
  return openMenu(page, page.getByTestId("teleprompter-page-menu"));
}

/** The plate title's ⋯: the selected script's menu. */
export function openPlateMenu(page: Page): Promise<Locator> {
  return openMenu(page, page.getByTestId("teleprompter-plate-menu"));
}

/** A script's row's ⋯, or a removed script's, found by the script's name in the list. */
export function openRowMenu(page: Page, name: string): Promise<Locator> {
  return openMenu(
    page,
    page.getByTestId("teleprompter-scripts").getByRole("button", { name: `${name} menu`, exact: true })
  );
}

/** The Scripts section's ⋯, which shows the scripts or the removed ones. */
export async function showRemoved(page: Page, removed: boolean) {
  const menu = await openMenu(page, page.getByTestId("teleprompter-scripts-menu"));
  await menu.getByTestId(removed ? "teleprompter-removed" : "teleprompter-show-scripts").click();
}

/**
 * An armed key's two presses. The page's clock stands still from the first
 * press to the second and is moved past the dwell between them
 * (helpers/pageClock.ts), so the second is the confirm on any runner, inside
 * the arm's window. The test installs the clock before the page opens and
 * waits for the layout first: the pause stops the glass's frames.
 */
export async function pressTwice(page: Page, target: Locator) {
  await pausePageClock(page);
  await target.click();
  await expect(target).toHaveAttribute("data-armed", "true");
  await page.clock.fastForward(PAST_THE_DWELL_MS);
  await target.click();
  await page.clock.resume();
}
