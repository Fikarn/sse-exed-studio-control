import { expect, type Locator, type Page } from "@playwright/test";

import { AUDIO_ARM_MIN_DWELL_MS } from "../../src/app/audio/audioConstants";
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

// 2026-05-27 Console redesign: both preamp controls are now square SVG rotary
// dials — AudioStripPreamp (32×32) in the channel strip and AudioKnob (132×132)
// in the inspector hero. The role="slider" element measures ~1:1 in every
// surface, so the old 640×213 / 426×640 preamp-bitmap aspect ratios no longer
// apply. Kept as two named constants so the per-surface assertions still read
// as "strip preamp" vs "inspector preamp" intent.
export const COMPACT_PREAMP_ASPECT_RATIO = 1;
export const NARROW_PREAMP_ASPECT_RATIO = 1;

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
    { tab: "Preamp", panelId: "audio-inspector-channel" },
    { tab: "EQ", panelId: "audio-inspector-eq" },
    { tab: "Dyn", panelId: "audio-inspector-dynamics" },
    { tab: "Routing", panelId: "audio-inspector-sends" },
  ]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    const metrics = await page.getByTestId(panelId).evaluate((panel) => ({
      clientHeight: panel.clientHeight,
      scrollHeight: panel.scrollHeight,
      overflowY: getComputedStyle(panel).overflowY,
    }));
    // 2026-05-27 Console redesign: the dense processing panels (EQ / Dyn
    // all-knob grids) can exceed the inspector height at the cramped 1920×1080
    // fallback. That is fine as long as the panel scrolls (content stays
    // reachable) instead of clipping silently — so a scrollable panel satisfies
    // the guard. The guard still catches a panel that overflows with hidden
    // overflow (content cut off with no way to reach it).
    const fits = metrics.scrollHeight <= metrics.clientHeight + 1;
    const scrollable = metrics.overflowY === "auto" || metrics.overflowY === "scroll";
    expect(
      fits || scrollable,
      `${panelId} clips content (scrollHeight ${metrics.scrollHeight} > clientHeight ${metrics.clientHeight}, overflow-y ${metrics.overflowY})`
    ).toBe(true);
  }
  await page.getByRole("tab", { name: "Preamp", exact: true }).click();
}

export async function expectAudioStudioSideRailsFilled(page: Page, _bottomGapPx = 24) {
  // 2026-05-27 Console redesign: the left studio rail (Trust / Snapshot
  // panels) was replaced by the top bar + bottom monitor bar. This helper now
  // asserts that chrome is present + filled instead of the removed rail.
  await expect(page.getByTestId("audio-topbar"), "studio top bar present").toBeVisible();
  await expect(page.getByTestId("audio-monitor-bar"), "studio monitor bar present").toBeVisible();
  const metrics = await page.evaluate(() => {
    const topbar = document.querySelector<HTMLElement>('[data-testid="audio-topbar"]');
    const monitor = document.querySelector<HTMLElement>('[data-testid="audio-monitor-bar"]');
    const monitorMeter = document.querySelector<HTMLElement>('[data-testid="audio-monitor-master-meter"]');
    const rect = (el: HTMLElement | null) => (el ? el.getBoundingClientRect().width : 0);
    return { monitorMeter: rect(monitorMeter), monitorWidth: rect(monitor), topbarWidth: rect(topbar) };
  });
  expect(metrics.topbarWidth, "top bar spans the surface").toBeGreaterThan(400);
  expect(metrics.monitorWidth, "monitor bar spans the surface").toBeGreaterThan(400);
  expect(metrics.monitorMeter, "monitor master meter is filled").toBeGreaterThan(120);
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

export async function expectAudioOverviewProcessingStack(page: Page, label: string, _minimumGraphHeight: number) {
  // 2026-05-27 Console redesign: the Overview tab's dense mini-preview cards
  // (Route / EQ / Dynamics graphs) were replaced by the Preamp tab's hero
  // preamp knob + meter card + send fader. Claude Design polish (DP4) then
  // added a read-only EQ mini-preview card between the preamp hero and the
  // send card (source → EQ → send → meter). This helper asserts the Preamp
  // panel is present and that the preamp hero, the EQ preview, and the meter
  // card all render inside it.
  const panel = page.getByTestId("audio-inspector-channel");
  const meter = page.getByTestId("audio-inspector-metering");
  const hardware = page.getByTestId("audio-inspector-hardware-mini");
  const eqPreview = page.getByTestId("audio-inspector-eq-preview");

  await expect(panel, `${label} Preamp panel`).toBeVisible();
  await expect(hardware, `${label} preamp card visible`).toBeVisible();
  await expect(eqPreview, `${label} EQ preview visible`).toBeVisible();
  await expect(meter, `${label} meter card visible`).toBeVisible();

  const panelBox = await readRequiredLocatorBox(panel, `${label} Preamp panel`);
  const meterBox = await readRequiredLocatorBox(meter, `${label} meter card`);
  const hardwareBox = await readRequiredLocatorBox(hardware, `${label} preamp card`);
  const eqPreviewBox = await readRequiredLocatorBox(eqPreview, `${label} EQ preview`);

  // The preamp hero + EQ preview sit at the top of the stack, always above the
  // fold, so they stay fully boxed inside the panel.
  expectInsideBox(hardwareBox, panelBox, `${label} preamp card inside Preamp panel`);
  expectInsideBox(eqPreviewBox, panelBox, `${label} EQ preview inside Preamp panel`);
  // EQ preview sits below the preamp hero and above the meter card.
  expect(eqPreviewBox.top, `${label} EQ preview below preamp hero`).toBeGreaterThanOrEqual(hardwareBox.top - 1);
  expect(meterBox.top, `${label} meter card below EQ preview`).toBeGreaterThanOrEqual(eqPreviewBox.top - 1);

  // The meter card is the last card in the stack. With the EQ preview added,
  // the cramped 1920×1080 fallback can push it into the panel's scroll
  // overflow — that is fine (the panel scrolls; the card stays reachable),
  // exactly as expectAudioInspectorPanelsFit already allows. So we require the
  // meter card to be horizontally boxed in the panel and to start within the
  // panel, and only require its bottom inside the panel when the panel is not
  // scrollable (content actually fits).
  expect(meterBox.left, `${label} meter card left inside Preamp panel`).toBeGreaterThanOrEqual(panelBox.left - 1);
  expect(meterBox.right, `${label} meter card right inside Preamp panel`).toBeLessThanOrEqual(panelBox.right + 1);
  expect(meterBox.top, `${label} meter card top inside Preamp panel`).toBeGreaterThanOrEqual(panelBox.top - 1);

  const panelScrolls = await panel.evaluate(
    (node) => node.scrollHeight > node.clientHeight + 1 && getComputedStyle(node).overflowY !== "visible"
  );
  if (!panelScrolls) {
    expect(meterBox.bottom, `${label} meter card bottom inside Preamp panel`).toBeLessThanOrEqual(panelBox.bottom + 1);
  }
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
  await page.waitForTimeout(AUDIO_ARM_MIN_DWELL_MS + 50); // confirm after the arm dwell (Slice 7)
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
