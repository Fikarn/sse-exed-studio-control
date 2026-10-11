import { expect, type Locator, type Page } from "@playwright/test";

import { ARM_DWELL_MS } from "../../../packages/design-system/src/components/useArm";
import { expectWorkspaceMounted, openFixture } from "./openFixture";
import { pausePageClock } from "./pageClock";

// The Cameras page's helpers (the visual overhaul, 2026-10-05): the camera's
// one menu, opened by its key's ⋯, its small picture's ⋯ and the plate
// title's ⋯; the format's and the look's popovers; the pictures' corners; and
// the two presses of an armed key.

export async function openCameras(page: Page, fixture = "cameras-held") {
  await openFixture(page, fixture);
  await expectWorkspaceMounted(page, "cameras");
}

async function openMenu(page: Page, testId: string): Promise<Locator> {
  await page.getByTestId(testId).click();
  const menu = page.getByRole("menu").last();
  await expect(menu).toBeVisible();
  return menu;
}

/** The ⋯ beside a camera's key in the cluster. */
export function openCameraKeyMenu(page: Page, camera: 1 | 2 | 3): Promise<Locator> {
  return openMenu(page, `cameras-key-menu-${camera}`);
}

/** The ⋯ in a small picture's chip. */
export function openTileMenu(page: Page, camera: 1 | 2 | 3): Promise<Locator> {
  return openMenu(page, `cameras-tile-menu-${camera}`);
}

/** The plate title's ⋯: the selected camera's menu. */
export function openCamerasPlateMenu(page: Page): Promise<Locator> {
  return openMenu(page, "cameras-plate-menu");
}

/** The format's popover (resolution and frame rate), from the Format section's key. */
export async function openFormat(page: Page): Promise<Locator> {
  await page.getByTestId("cameras-format-open").click();
  const popover = page.getByTestId("cameras-format-popover");
  await expect(popover).toBeVisible();
  return popover;
}

/** The look's popover (dynamic range and the display LUT), from its section's key. */
export async function openLook(page: Page): Promise<Locator> {
  await page.getByTestId("cameras-look-open").click();
  const popover = page.getByTestId("cameras-look-popover");
  await expect(popover).toBeVisible();
  return popover;
}

/**
 * Each camera picture's corners, in the page's order, as the page rounds them and as it
 * tells the pictures helper (D30): its place's wrapper's radius on each corner, which
 * clips the page's own drawing; whether the wrapper is the place's own box, so that its
 * corners are the picture's; and the radius in the page's last report, which the helper
 * rounds its picture to over the page in the app's window (`null` when the report is not
 * of that place).
 */
export function pictureCorners(page: Page) {
  return page.evaluate(() => {
    const reported = window.__SSE_TEST_CAMERAS__!.picturePlaces().last?.pictures ?? [];
    return [...document.querySelectorAll<HTMLElement>("[data-picture][data-camera]")].map((place, index) => {
      const camera = Number(place.dataset.camera);
      const wrapper = place.parentElement!;
      const style = getComputedStyle(wrapper);
      const box = place.getBoundingClientRect();
      const around = wrapper.getBoundingClientRect();
      const report = reported[index];
      return {
        camera,
        reported: report?.camera === camera ? report.radius : null,
        wrapper: [
          style.borderTopLeftRadius,
          style.borderTopRightRadius,
          style.borderBottomRightRadius,
          style.borderBottomLeftRadius,
        ].map(parseFloat),
        fills:
          Math.abs(box.x - around.x) < 0.5 &&
          Math.abs(box.y - around.y) < 0.5 &&
          Math.abs(box.width - around.width) < 0.5 &&
          Math.abs(box.height - around.height) < 0.5,
      };
    });
  });
}

/**
 * An armed key's two presses. The page's clock stands still from the first
 * press to the second and is moved past the dwell between them
 * (helpers/pageClock.ts), so the second is the confirm on any runner, inside
 * every arm window. The test installs the clock before the page opens.
 */
export async function pressTwice(page: Page, target: Locator) {
  await pausePageClock(page);
  await target.click();
  await expect(target).toHaveAttribute("data-armed", "true");
  await page.clock.fastForward(ARM_DWELL_MS + 50);
  await target.click();
  await page.clock.resume();
}
