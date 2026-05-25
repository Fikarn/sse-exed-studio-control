import { expect, type Locator, type Page } from "@playwright/test";

// plan PR 4 / workstream D4: shared geometry helpers — bounding-box reads,
// containment checks, scroll-overflow guards. Used by every per-surface
// spec that asserts layout.

export async function expectAspectRatio(locator: Locator, expectedRatio: number, label: string) {
  await expect(locator, `${label} should be visible before measuring aspect ratio`).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} should have a measurable box`).not.toBeNull();
  expect(box!.width / Math.max(1, box!.height), label).toBeCloseTo(expectedRatio, 2);
}

export async function expectNoDocumentScroll(page: Page) {
  const metrics = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    scrollWidth: document.documentElement.scrollWidth,
    viewportHeight: window.innerHeight,
    viewportWidth: window.innerWidth,
  }));
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.viewportHeight + 1);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
}

export async function readRequiredBox(page: Page, testId: string) {
  const box = await page.getByTestId(testId).boundingBox();
  expect(box, `${testId} should render a measurable box`).not.toBeNull();
  return {
    bottom: box!.y + box!.height,
    height: box!.height,
    left: box!.x,
    right: box!.x + box!.width,
    top: box!.y,
    width: box!.width,
  };
}

export type RequiredBox = Awaited<ReturnType<typeof readRequiredBox>>;

export async function readRequiredLocatorBox(locator: Locator, label: string) {
  const box = await locator.boundingBox();
  expect(box, `${label} should render a measurable box`).not.toBeNull();
  return {
    bottom: box!.y + box!.height,
    height: box!.height,
    left: box!.x,
    right: box!.x + box!.width,
    top: box!.y,
    width: box!.width,
  };
}

export function expectInsideBox(child: RequiredBox, parent: RequiredBox, label: string) {
  expect(child.left, `${label} left`).toBeGreaterThanOrEqual(parent.left - 1);
  expect(child.top, `${label} top`).toBeGreaterThanOrEqual(parent.top - 1);
  expect(child.right, `${label} right`).toBeLessThanOrEqual(parent.right + 1);
  expect(child.bottom, `${label} bottom`).toBeLessThanOrEqual(parent.bottom + 1);
}

export function boxesIntersect(first: RequiredBox, second: RequiredBox) {
  return (
    first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top
  );
}

export async function expectNoElementOverflow(locator: Locator, label: string) {
  const metrics = await locator.evaluate((element) => ({
    clientHeight: element.clientHeight,
    clientWidth: element.clientWidth,
    scrollHeight: element.scrollHeight,
    scrollWidth: element.scrollWidth,
    text: element.textContent?.trim() ?? "",
  }));
  expect(metrics.scrollWidth, `${label} horizontal overflow: ${metrics.text}`).toBeLessThanOrEqual(
    metrics.clientWidth + 1
  );
  expect(metrics.scrollHeight, `${label} vertical overflow: ${metrics.text}`).toBeLessThanOrEqual(
    metrics.clientHeight + 1
  );
}
