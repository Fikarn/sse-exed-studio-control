import { expect, type Page } from "@playwright/test";

// plan PR 4 / workstream D4: lighting-toolbar-specific helper. Asserts
// every documented primary control renders inside the viewport without
// clipping, in the canonical sort order.
// Visual overhaul A, Slice 5. Old: the seven toolbar primaries, "overflow"
// among them. New: the same ids on their new homes in the cluster — the state
// display is the title, the Lighting key the status, and Add fixture, Patch,
// Preview and the search field keep their own — minus "overflow", because
// nothing is folded into an overflow menu any more: the selection's keys are
// on the cluster at every size. What the helper is for is unchanged: every
// primary renders inside the viewport without clipping.
const EXPECTED_PRIMARY_IDS = ["add", "patch", "preview", "search", "status", "title"] as const;

export async function expectToolbarPrimaryControlsFit(page: Page) {
  // Visual overhaul A, Slice 5: the primaries live in the cluster, which is one
  // scrolling column, so each is brought into view before it is measured. The
  // guard is the same: a primary must render and must not be clipped by the
  // viewport once the operator can see it.
  const ids = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("[data-toolbar-primary]")).map(
      (control) => control.dataset.toolbarPrimary ?? "unknown"
    )
  );
  expect([...ids].sort()).toEqual([...EXPECTED_PRIMARY_IDS]);

  const unfitted: string[] = [];
  for (const id of ids) {
    const control = page.locator(`[data-toolbar-primary="${id}"]`).first();
    await control.scrollIntoViewIfNeeded();
    const fits = await control.evaluate((node) => {
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
