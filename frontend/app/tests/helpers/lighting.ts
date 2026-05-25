import { expect, type Page } from "@playwright/test";

// plan PR 4 / workstream D4: lighting-toolbar-specific helper. Asserts
// every documented primary control renders inside the viewport without
// clipping, in the canonical sort order.

const EXPECTED_PRIMARY_IDS = ["add", "overflow", "patch", "preview", "search", "status", "title"] as const;

export async function expectToolbarPrimaryControlsFit(page: Page) {
  const result = await page.evaluate(() => {
    const controls = Array.from(document.querySelectorAll<HTMLElement>("[data-toolbar-primary]"));
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    return controls.map((control) => {
      const rect = control.getBoundingClientRect();
      return {
        id: control.dataset.toolbarPrimary ?? "unknown",
        fits:
          rect.width > 0 &&
          rect.height > 0 &&
          rect.left >= -1 &&
          rect.top >= -1 &&
          rect.right <= viewportWidth + 1 &&
          rect.bottom <= viewportHeight + 1,
      };
    });
  });

  expect(result.map((entry) => entry.id).sort()).toEqual([...EXPECTED_PRIMARY_IDS]);
  expect(result.filter((entry) => !entry.fits)).toEqual([]);
}
