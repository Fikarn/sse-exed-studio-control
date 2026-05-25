import { expect, type Locator, type Page } from "@playwright/test";

import {
  boxesIntersect,
  expectInsideBox,
  expectNoDocumentScroll,
  readRequiredBox,
  readRequiredLocatorBox,
} from "./geometry";

// plan PR 4 / workstream D4: audio-workspace-specific geometry/layout
// helpers extracted from the original operator-shell.spec.ts. Other
// audio-spec helpers (canvas sampling, dBFS scale checks) live in
// meter-canvas.ts; this module is the workspace + snapshot deck +
// inspector overview piece.

export const COMPACT_PREAMP_ASPECT_RATIO = 640 / 213;
export const NARROW_PREAMP_ASPECT_RATIO = 426 / 640;

export async function expectAudioWorkspaceGeometry(page: Page) {
  await expectNoDocumentScroll(page);

  const workspace = await readRequiredBox(page, "audio-workspace");
  const canvas = await readRequiredBox(page, "audio-signal-canvas");
  const mixer = await readRequiredBox(page, "audio-tiered-mixer");
  const outputTier = await readRequiredBox(page, "audio-hardware-outputs-tier");
  const snapshotDeck = await readRequiredBox(page, "audio-snapshot-deck");
  const healthBar = await readRequiredBox(page, "audio-health-bar");

  expectInsideBox(canvas, workspace, "canvas inside workspace");
  expectInsideBox(mixer, canvas, "tiered mixer inside canvas");
  expectInsideBox(outputTier, mixer, "output tier inside tiered mixer");
  expectInsideBox(outputTier, canvas, "output tier inside canvas");
  expectInsideBox(snapshotDeck, canvas, "snapshot deck inside canvas");
  expect(outputTier.bottom, "output tier should end before snapshot deck").toBeLessThanOrEqual(snapshotDeck.top + 1);
  expect(healthBar.top, "health bar should be below canvas").toBeGreaterThanOrEqual(canvas.bottom - 1);
  expectInsideBox(healthBar, workspace, "health bar inside workspace");
}

export async function expectAudioInspectorPanelsFit(page: Page) {
  for (const { tab, panelId } of [
    { tab: "Overview", panelId: "audio-inspector-channel" },
    { tab: "EQ", panelId: "audio-inspector-eq" },
    { tab: "Dynamics", panelId: "audio-inspector-dynamics" },
    { tab: "Sends", panelId: "audio-inspector-sends" },
  ]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    const metrics = await page.getByTestId(panelId).evaluate((panel) => ({
      clientHeight: panel.clientHeight,
      scrollHeight: panel.scrollHeight,
    }));
    expect(metrics.scrollHeight, `${panelId} hidden overflow`).toBeLessThanOrEqual(metrics.clientHeight + 1);
  }
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
}

export async function expectAudioStudioSideRailsFilled(page: Page, bottomGapPx = 24) {
  const metrics = await page.evaluate(() => {
    const boxFor = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        bottom: rect.bottom,
        display: getComputedStyle(element).display,
        height: rect.height,
        top: rect.top,
      };
    };
    const inspectorPanel = document.querySelector<HTMLElement>('[data-testid="audio-inspector-channel"]');
    const inspectorCards = inspectorPanel
      ? Array.from(inspectorPanel.querySelectorAll<HTMLElement>("[class*=inspectorMiniCard]")).map((element) => {
          const rect = element.getBoundingClientRect();
          return { bottom: rect.bottom, top: rect.top };
        })
      : [];
    return {
      inspectorCards,
      inspectorPanel: boxFor('[data-testid="audio-inspector-channel"]'),
      rail: boxFor("[class*=audioRail]"),
      railSnapshot: boxFor('[data-testid="audio-rail-snapshot-panel"]'),
      railTrust: boxFor('[data-testid="audio-rail-trust-panel"]'),
    };
  });

  expect(metrics.railTrust?.display, "studio trust rail panel visible").not.toBe("none");
  expect(metrics.railSnapshot?.display, "studio snapshot rail panel visible").not.toBe("none");
  expect(metrics.railSnapshot?.bottom ?? 0, "left rail content should fill the studio rail").toBeGreaterThanOrEqual(
    (metrics.rail?.bottom ?? 0) - bottomGapPx
  );
  expect(
    Math.max(...metrics.inspectorCards.map((card) => card.bottom)),
    "right inspector cards should fill the channel panel"
  ).toBeGreaterThanOrEqual((metrics.inspectorPanel?.bottom ?? 0) - bottomGapPx);
}

export async function expectSnapshotActionsDoNotOverlapContent(page: Page, snapshotId: string) {
  const tile = page.getByTestId(`audio-snapshot-${snapshotId}`);
  const actions = tile.getByTestId(`audio-snapshot-actions-${snapshotId}`);
  await expect(actions, `${snapshotId} action strip should be visible`).toBeVisible();

  const tileBox = await readRequiredLocatorBox(tile, `${snapshotId} tile`);
  const actionBox = await readRequiredLocatorBox(actions, `${snapshotId} action strip`);
  expectInsideBox(actionBox, tileBox, `${snapshotId} action strip inside tile`);

  for (const [locator, label] of [
    [tile.getByTestId(`audio-snapshot-name-${snapshotId}`), "name"],
    [tile.getByTestId(`audio-snapshot-thumb-${snapshotId}`), "thumbnail"],
    [tile.getByTestId(`audio-snapshot-meta-${snapshotId}`), "status"],
  ] as const) {
    const contentBox = await readRequiredLocatorBox(locator, `${snapshotId} ${label}`);
    expect(boxesIntersect(actionBox, contentBox), `${snapshotId} action strip overlaps ${label}`).toBe(false);
  }
}

export async function expectAudioLaneCardsInsideTierGrids(page: Page) {
  const overflows = await page.evaluate(() => {
    const mixer = document.querySelector<HTMLElement>('[data-testid="audio-tiered-mixer"]');
    if (!mixer) return [{ id: "audio-tiered-mixer", overflow: Number.POSITIVE_INFINITY, tier: "missing" }];

    return Array.from(mixer.children)
      .filter((tier): tier is HTMLElement => tier instanceof HTMLElement && tier.hasAttribute("data-tier"))
      .flatMap((tier) => {
        const grid = tier.querySelector<HTMLElement>('[data-testid^="audio-tier-lanes-"], [class*="outputLaneGrid"]');
        if (!grid) {
          return [{ id: "lane-grid", overflow: Number.POSITIVE_INFINITY, tier: tier.dataset.tier ?? "unknown" }];
        }
        const gridRect = grid.getBoundingClientRect();
        return Array.from(
          grid.querySelectorAll<HTMLElement>('[data-testid^="audio-strip-"], [data-testid^="audio-output-"]')
        ).map((lane) => {
          const laneRect = lane.getBoundingClientRect();
          return {
            id: lane.dataset.testid ?? lane.getAttribute("data-testid") ?? "unknown-lane",
            overflow: Math.max(0, laneRect.bottom - gridRect.bottom, gridRect.top - laneRect.top),
            tier: tier.dataset.tier ?? "unknown",
          };
        });
      });
  });

  expect(overflows.length, "audio lane cards should be measurable").toBeGreaterThan(0);
  expect(
    overflows.filter((entry) => entry.overflow > 1),
    "audio lane cards clipping their tier grids"
  ).toEqual([]);
}

export async function expectAudioOverviewProcessingStack(page: Page, label: string, minimumGraphHeight: number) {
  const panel = page.getByTestId("audio-inspector-channel");
  const meter = page.getByTestId("audio-inspector-metering");
  const route = page.getByTestId("audio-inspector-sends-mini");
  const eq = page.getByTestId("audio-inspector-eq-mini");
  const dynamics = page.getByTestId("audio-inspector-dynamics-mini");
  const source = page.getByTestId("audio-inspector-source-mini");
  const hardware = page.getByTestId("audio-inspector-hardware-mini");

  await expect(panel, `${label} Overview panel`).toBeVisible();
  await expect(source, `${label} Source card removed from Overview`).toHaveCount(0);
  for (const locator of [meter, hardware, route, eq, dynamics]) {
    await expect(locator, `${label} Overview card should be visible`).toBeVisible();
  }

  const panelBox = await readRequiredLocatorBox(panel, `${label} Overview panel`);
  const meterBox = await readRequiredLocatorBox(meter, `${label} meter card`);
  const hardwareBox = await readRequiredLocatorBox(hardware, `${label} Hardware card`);
  const routeBox = await readRequiredLocatorBox(route, `${label} route card`);
  const eqBox = await readRequiredLocatorBox(eq, `${label} EQ card`);
  const dynamicsBox = await readRequiredLocatorBox(dynamics, `${label} Dynamics card`);

  for (const [box, boxLabel] of [
    [routeBox, "route"],
    [eqBox, "EQ"],
    [dynamicsBox, "Dynamics"],
  ] as const) {
    expectInsideBox(box, panelBox, `${label} ${boxLabel} card inside Overview`);
  }

  expect(hardwareBox.top, `${label} Hardware sits below meter`).toBeGreaterThanOrEqual(meterBox.bottom - 2);
  expect(hardwareBox.top - meterBox.bottom, `${label} Hardware follows meter directly`).toBeLessThanOrEqual(10);
  expect(
    Math.abs(hardwareBox.width - meterBox.width),
    `${label} Hardware width matches meter stack`
  ).toBeLessThanOrEqual(2);
  expect(routeBox.bottom, `${label} route above EQ`).toBeLessThanOrEqual(eqBox.top + 2);
  expect(eqBox.bottom, `${label} EQ above Dynamics`).toBeLessThanOrEqual(dynamicsBox.top + 2);

  expect(eqBox.width, `${label} EQ spans the full Overview width`).toBeGreaterThan(panelBox.width * 0.88);
  expect(dynamicsBox.width, `${label} Dynamics spans the full Overview width`).toBeGreaterThan(panelBox.width * 0.88);
  expect(Math.abs(eqBox.width - dynamicsBox.width), `${label} EQ/Dynamics width parity`).toBeLessThanOrEqual(2);

  const eqGraphBox = await readRequiredLocatorBox(eq.locator("[class*=eqGraphMini]"), `${label} EQ graph`);
  const dynamicsGraphBox = await readRequiredLocatorBox(
    dynamics.locator("[class*=dynamicsGraphMini]"),
    `${label} Dynamics graph`
  );
  expectInsideBox(eqGraphBox, eqBox, `${label} EQ graph inside card`);
  expectInsideBox(dynamicsGraphBox, dynamicsBox, `${label} Dynamics graph inside card`);
  expect(eqGraphBox.height, `${label} EQ graph useful preview height`).toBeGreaterThanOrEqual(minimumGraphHeight);
  expect(dynamicsGraphBox.height, `${label} Dynamics graph useful preview height`).toBeGreaterThanOrEqual(
    minimumGraphHeight
  );
  expect(eqGraphBox.width, `${label} EQ graph uses full-width card`).toBeGreaterThan(panelBox.width * 0.82);
  expect(dynamicsGraphBox.width, `${label} Dynamics graph uses full-width card`).toBeGreaterThan(panelBox.width * 0.82);
}

export async function readSnapshotThumbHeights(page: Page, snapshotId: string) {
  return page
    .getByTestId(`audio-snapshot-thumb-${snapshotId}`)
    .locator("i")
    .evaluateAll((bars) => bars.map((bar) => (bar as HTMLElement).style.height));
}

export async function saveAudioSnapshot(page: Page, snapshotId: string) {
  const snapshotTile = page.getByTestId(`audio-snapshot-${snapshotId}`);
  await snapshotTile.hover();
  const saveButton = snapshotTile.getByTestId(`audio-snapshot-actions-${snapshotId}`).getByRole("button").first();
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expect(saveButton).toHaveAttribute("data-armed", "true");
  await saveButton.click();
}

export async function expectSliderValueChanges(page: Page, label: string) {
  const slider = page.getByRole("slider", { name: label });
  const before = await slider.getAttribute("aria-valuenow");
  const max = Number(await slider.getAttribute("aria-valuemax"));
  const direction = Number(before) >= max ? "ArrowLeft" : "ArrowRight";
  await slider.focus();
  await page.keyboard.press(direction);
  await expect(slider).not.toHaveAttribute("aria-valuenow", before ?? "");
}

// Re-export Locator for callers that build their own assertions on top.
export type { Locator };
