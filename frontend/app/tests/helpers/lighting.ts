import { expect, type Locator, type Page } from "@playwright/test";

import { ARM_DWELL_MS } from "../../../packages/design-system/src/components/useArm";

// The Lighting page's test helpers.
//
// The visual overhaul's Lighting page (2026-10-04). Old: six primaries (title,
// status, Add fixture, Patch, Preview, search) in a cluster that scrolled, each
// brought into view before it was measured. New: the state display (title),
// the LIGHTING key (status), the search field, and the bar under the plot
// (bar); Add fixture, Patch and Preview are the page ⋯'s items, with their
// test ids. Nothing scrolls, so nothing is scrolled into view: each primary
// must stand inside the window as the page is drawn.
const EXPECTED_PRIMARY_IDS = ["bar", "search", "status", "title"] as const;

export async function expectToolbarPrimaryControlsFit(page: Page) {
  const ids = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("[data-toolbar-primary]")).map(
      (control) => control.dataset.toolbarPrimary ?? "unknown"
    )
  );
  expect([...ids].sort()).toEqual([...EXPECTED_PRIMARY_IDS]);

  const unfitted: string[] = [];
  for (const id of ids) {
    const fits = await page
      .locator(`[data-toolbar-primary="${id}"]`)
      .first()
      .evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.left >= -1 &&
          rect.top >= -1 &&
          rect.right <= window.innerWidth + 1 &&
          rect.bottom <= window.innerHeight + 1
        );
      });
    if (!fits) unfitted.push(id);
  }
  expect(unfitted, "lighting primary controls clipped by the viewport").toEqual([]);
}

/** The cluster and the plate hold all they show: neither scrolls. */
export async function expectLightingColumnsFit(page: Page) {
  for (const testId of ["lighting-cluster", "lighting-plate"]) {
    const overflow = await page.getByTestId(testId).evaluate((node) => node.scrollHeight - node.clientHeight);
    expect(overflow, `${testId} holds what it shows`).toBeLessThanOrEqual(1);
  }
}

/** Opens the page's ⋯ (on the state display), which holds the standing commands. */
export async function openLightingPageMenu(page: Page): Promise<Locator> {
  await page.getByTestId("lighting-page-menu").click();
  const menu = page.getByRole("menu", { name: "Lighting" });
  await expect(menu).toBeVisible();
  return menu;
}

/** Opens a scene row's ⋯. */
export async function openSceneMenu(page: Page, sceneId: string): Promise<Locator> {
  await page.getByTestId(`lighting-scene-menu-${sceneId}`).click();
  const menu = page.getByRole("menu").last();
  await expect(menu).toBeVisible();
  return menu;
}

/** Opens the plate title's ⋯ (the menu of whatever the plate shows). */
export async function openPlateMenu(page: Page): Promise<Locator> {
  await page.getByTestId("lighting-plate-menu").click();
  const menu = page.getByRole("menu").last();
  await expect(menu).toBeVisible();
  return menu;
}

/** Opens the plot's ⋯ in the bar under it. */
export async function openPlotMenu(page: Page): Promise<Locator> {
  await page.getByTestId("lighting-plot-menu").click();
  const menu = page.getByRole("menu", { name: "Stage plot" });
  await expect(menu).toBeVisible();
  return menu;
}

/**
 * Presses an arming item or key twice: the first press arms, the second, past
 * the dwell, does it. The page's clock must be installed and paused
 * (`pausePageClock`), as for every arm.
 */
export async function pressTwice(page: Page, target: Locator) {
  await target.click();
  await expect(target).toHaveAttribute("data-armed", "true");
  await page.clock.fastForward(ARM_DWELL_MS + 50);
  await target.click();
}
