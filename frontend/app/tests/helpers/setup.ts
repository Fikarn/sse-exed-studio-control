import { expect, type Locator, type Page } from "@playwright/test";

import { ARM_DWELL_MS } from "../../../packages/design-system/src/components/useArm";
import { expectWorkspaceMounted, openFixture } from "./openFixture";
import { pausePageClock } from "./pageClock";

// Setup / Support's helpers (the visual overhaul, 2026-10-05): the page, its
// menus (the page's ⋯, the plate title's ⋯, a backup's and a camera's), the
// two presses of an armed key on the page's clock, and the measure of what
// fits: nothing scrolls and no line is cut.

/** Past the arm's dwell: a second press before it is a bounce, and applies nothing. */
export const PAST_THE_DWELL_MS = ARM_DWELL_MS + 50;

/** The page's clock is installed first; pause it only once Setup has drawn
 *  (a paused clock holds the page's own chunk). */
export async function openSetup(page: Page, fixture: string, { clock = false } = {}) {
  if (clock) await page.clock.install();
  await openFixture(page, fixture);
  await expectWorkspaceMounted(page, "setup");
  await expect(page.getByTestId("setup-step-publish")).toBeVisible();
}

export async function openMenu(page: Page, opener: Locator): Promise<Locator> {
  await opener.click();
  const menu = page.getByRole("menu").last();
  await expect(menu).toBeVisible();
  return menu;
}

/** The state display's ⋯: Export backup, Open the log, Back to the Console. */
export function openSetupPageMenu(page: Page): Promise<Locator> {
  return openMenu(page, page.getByTestId("setup-page-menu"));
}

/**
 * An armed key's two presses. The page's clock stands still from the first
 * press to the second and is moved past the dwell between them
 * (helpers/pageClock.ts), so the second is the confirm on any runner, inside
 * the arm's window. The test installs the clock before the page opens.
 */
export async function pressTwice(page: Page, target: Locator) {
  await pausePageClock(page);
  await target.click();
  await expect(target).toHaveAttribute("data-armed", "true");
  await page.clock.fastForward(PAST_THE_DWELL_MS);
  await target.click();
  await page.clock.resume();
}

export interface SetupRoom {
  /** The document's scroll width and height. */
  page: [number, number];
  /** Each of the page's columns holds everything it shows. */
  scrolls: string[];
  /** Every text the page cuts with an ellipsis, but the rows cut by design. */
  cut: (string | null)[];
}

/** What fits on the screen as it stands: the columns that scroll, and the lines cut. */
export function measureRoom(page: Page): Promise<SetupRoom> {
  return page.evaluate(() => {
    const columns = [
      ...document.querySelectorAll<HTMLElement>(
        // The page's columns, the bay's main, the step screen's well (which
        // clips a screen taller than the bay) and the screens' before ready
        // bay (which clips what it holds).
        "[data-region=cluster] > *, [data-region=bay] > *, [data-region=plate] > *, [data-region=bay] main, " +
          "[data-region=bay] [data-screen] > [data-well], [data-region=bay] [data-pre-ready]"
      ),
    ];
    const scrolls = columns
      .filter((element) => element.scrollHeight > element.clientHeight + 1)
      .map((element) => element.getAttribute("data-testid") ?? element.className);
    // A Recent actions row's sentence gives way by design; its tooltip holds it whole.
    const cut = [
      ...document.querySelectorAll<HTMLElement>(
        "[data-region=cluster] *, [data-region=bay] *, [data-region=plate] *, [data-region=footer] *"
      ),
    ]
      .filter((element) => !element.closest("[data-cut-by-design]"))
      .filter((element) => getComputedStyle(element).textOverflow === "ellipsis")
      .filter((element) => element.scrollWidth > element.clientWidth)
      .map((element) => element.textContent);
    return {
      page: [document.documentElement.scrollWidth, document.documentElement.scrollHeight] as [number, number],
      scrolls,
      cut,
    };
  });
}
