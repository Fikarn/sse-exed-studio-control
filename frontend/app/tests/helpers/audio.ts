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
// Visual overhaul A, Slice 4b: the strip's preamp is a gain key now, so only
// the inspector's knob is measured by aspect. COMPACT_PREAMP_ASPECT_RATIO is
// retired with the strip knob; its callers compare the two surfaces' gain keys
// to each other instead.
export const NARROW_PREAMP_ASPECT_RATIO = 1;

async function readRequiredBoxBySelector(page: Page, selector: string, label: string) {
  const box = await page.locator(selector).first().boundingBox();
  expect(box, `${label} should have a box`).not.toBeNull();
  return { ...box!, bottom: box!.y + box!.height, left: box!.x, right: box!.x + box!.width, top: box!.y };
}

export async function expectAudioWorkspaceGeometry(page: Page) {
  await expectNoDocumentScroll(page);

  const workspace = await readRequiredBox(page, "audio-workspace");
  const canvas = await readRequiredBox(page, "audio-signal-canvas");
  const mixer = await readRequiredBox(page, "audio-tiered-mixer");
  const outputTier = await readRequiredBox(page, "audio-hardware-outputs-tier");
  // Visual overhaul A, Slice 4 (plan D1): the snapshot keys live in the shell's
  // cluster and the telemetry on the shell's footer, so neither sits inside the
  // workspace any more. Old: both were measured inside the canvas / workspace.
  const cluster = await readRequiredBoxBySelector(page, '[data-region="cluster"]', "cluster");
  const snapshotDeck = await readRequiredBox(page, "audio-snapshot-deck");
  const stateDisplay = await readRequiredBox(page, "audio-state-display");
  const footer = await readRequiredBox(page, "audio-health-bar");

  expectInsideBox(canvas, workspace, "canvas inside workspace");
  expectInsideBox(mixer, canvas, "tiered mixer inside canvas");
  expectInsideBox(outputTier, mixer, "output tier inside tiered mixer");
  expectInsideBox(outputTier, canvas, "output tier inside canvas");
  expectInsideBox(stateDisplay, cluster, "state display inside the cluster");
  expectInsideBox(snapshotDeck, cluster, "snapshot keys inside the cluster");
  expect(stateDisplay.top, "the state display is the cluster's first element").toBeLessThanOrEqual(
    snapshotDeck.top + 1
  );
  expect(footer.top, "footer should be below the bay").toBeGreaterThanOrEqual(workspace.bottom - 1);
}

export async function expectAudioInspectorPanelsFit(page: Page) {
  // Visual overhaul A, Slice 4c. Old: the check clicked each tab and measured
  // its panel. New: it measures the plate itself and every section in it.
  // Reason: there are no tabs — the plate is one scrolling column — and what
  // the guard is for is unchanged: nothing is cut off with no way to reach it.
  const metrics = await page.getByTestId("audio-inspector").evaluate((plate) => ({
    clientHeight: plate.clientHeight,
    scrollHeight: plate.scrollHeight,
    overflowY: getComputedStyle(plate).overflowY,
    sections: Array.from(plate.querySelectorAll<HTMLElement>("[data-plate-section]")).map((section) => ({
      id: section.dataset.plateSection ?? "",
      clipped: section.scrollHeight > section.clientHeight + 1 && getComputedStyle(section).overflowY === "hidden",
      width: section.getBoundingClientRect().width,
    })),
  }));

  const scrollable = metrics.overflowY === "auto" || metrics.overflowY === "scroll";
  expect(
    metrics.scrollHeight <= metrics.clientHeight + 1 || scrollable,
    `the plate clips content (scrollHeight ${metrics.scrollHeight} > clientHeight ${metrics.clientHeight}, overflow-y ${metrics.overflowY})`
  ).toBe(true);
  expect(metrics.sections.length, "the plate should render its sections").toBeGreaterThan(0);
  expect(
    metrics.sections.filter((section) => section.clipped).map((section) => section.id),
    "plate sections clipping their content"
  ).toEqual([]);
}

export async function expectAudioStudioSideRailsFilled(page: Page, _bottomGapPx = 24) {
  // Visual overhaul A, Slice 4 (plan D1): the top bar and the monitor bar are
  // gone; the Console's take-time controls are the cluster, whose first
  // element is the state display and whose master meter is filled. Old: the
  // top bar and the monitor bar each spanned the surface.
  await expect(page.getByTestId("audio-monitor-bar"), "console cluster present").toBeVisible();
  await expect(page.getByTestId("audio-state-display"), "state display present").toBeVisible();
  await expect(page.getByTestId("audio-topbar"), "the top bar is retired").toHaveCount(0);
  const metrics = await page.evaluate(() => {
    const cluster = document.querySelector<HTMLElement>('[data-testid="audio-monitor-bar"]');
    const state = document.querySelector<HTMLElement>('[data-testid="audio-state-display"]');
    const monitorMeter = document.querySelector<HTMLElement>('[data-testid="audio-monitor-master-meter"]');
    const rect = (el: HTMLElement | null) => (el ? el.getBoundingClientRect().width : 0);
    return {
      clusterWidth: rect(cluster),
      monitorMeter: rect(monitorMeter),
      shellWidth: rect(document.querySelector<HTMLElement>("[data-shell-frame]")),
      stateWidth: rect(state),
    };
  });
  // A share, not a pixel count: the Scaled Studio Preview renders the 2560
  // canvas at ~59 %, so the cluster measures ~250 px there and ~424 px native.
  expect(metrics.clusterWidth / metrics.shellWidth, "cluster fills its column").toBeGreaterThan(0.12);
  expect(metrics.stateWidth / metrics.clusterWidth, "state display fills the cluster").toBeGreaterThan(0.8);
  expect(metrics.monitorMeter / metrics.clusterWidth, "monitor master meter is filled").toBeGreaterThan(0.8);
}

// Visual overhaul A, Slice 4a. Old: the action strip was a row under every
// slot, asserted visible at rest and inside the tile's own box. New: it is in
// the slot's float, so the check hovers the slot first and asserts the strip is
// inside that float. Reason: the resting slot is the mock's name and last
// recall; save / rename / delete come with the preview of what they change.
// What the check is for is unchanged — the strip must never cover the slot's
// name, mix shape or last recall.
// Visual overhaul A, Slice 4c: the plate has no tab row — every section is
// visible at once — so what used to be "click the EQ tab" is "bring the EQ
// section into view". Sections keep the ids the tabs' panels had, prefixed
// `audio-plate-section-`.
export async function revealPlateSection(
  page: Page,
  section: "preamp" | "send" | "eq" | "dynamics" | "meter" | "channel" | "output"
) {
  const target = page.locator(`[data-plate-section="${section}"]`);
  await expect(target).toBeAttached();
  await target.scrollIntoViewIfNeeded();
  return target;
}

export async function expectSnapshotActionsDoNotOverlapContent(page: Page, snapshotId: string) {
  const tile = page.getByTestId(`audio-snapshot-${snapshotId}`);
  const actions = tile.getByTestId(`audio-snapshot-actions-${snapshotId}`);
  await expect(actions, `${snapshotId} action strip should rest hidden`).toBeHidden();
  await tile.hover();
  await expect(actions, `${snapshotId} action strip should be visible`).toBeVisible();

  const floatBox = await readRequiredLocatorBox(tile.locator('[data-level="float"]'), `${snapshotId} slot float`);
  const actionBox = await readRequiredLocatorBox(actions, `${snapshotId} action strip`);
  expectInsideBox(actionBox, floatBox, `${snapshotId} action strip inside the slot float`);

  for (const [locator, label] of [
    [tile.getByTestId(`audio-snapshot-name-${snapshotId}`), "name"],
    // The mix-shape thumbnail is the one part the slot drops below the studio
    // surface, so it is measured only where it is drawn.
    [tile.getByTestId(`audio-snapshot-thumb-${snapshotId}`), "thumbnail"],
    [tile.getByTestId(`audio-snapshot-meta-${snapshotId}`), "status"],
  ] as const) {
    const contentBox = await locator.boundingBox();
    if (label === "thumbnail" && contentBox === null) continue;
    expect(contentBox, `${snapshotId} ${label} should render a measurable box`).not.toBeNull();
    expect(boxesIntersect(actionBox, contentBox!), `${snapshotId} action strip overlaps ${label}`).toBe(false);
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
  // Visual overhaul A, Slice 4c. Old: the check measured the Preamp tab's
  // panel and the read-only EQ mini-preview card inside it. New: it measures
  // the plate's own order — the preamp section, then the sends, then the
  // equaliser, then the meter — because the plate shows every section at once
  // and the mini-preview is gone (the equaliser itself is right there).
  // Reason: no tab row, so what the check is for — the sections stack in the
  // signal's order inside the plate and stay boxed in it — reads off the plate.
  const plate = page.getByTestId("audio-inspector");
  const preamp = page.locator('[data-plate-section="preamp"]');
  const sends = page.locator('[data-plate-section="send"]');
  const eq = page.locator('[data-plate-section="eq"]');
  const meter = page.locator('[data-plate-section="meter"]');

  await expect(plate, `${label} plate`).toBeVisible();
  for (const [locator, name] of [
    [preamp, "preamp section"],
    [sends, "sends section"],
    [eq, "equaliser section"],
    [meter, "meter section"],
  ] as const) {
    await expect(locator, `${label} ${name}`).toBeAttached();
  }

  const plateBox = await readRequiredLocatorBox(plate, `${label} plate`);
  const preampBox = await readRequiredLocatorBox(preamp, `${label} preamp section`);
  const sendsBox = await readRequiredLocatorBox(sends, `${label} sends section`);
  const eqBox = await readRequiredLocatorBox(eq, `${label} equaliser section`);
  const meterBox = await readRequiredLocatorBox(meter, `${label} meter section`);

  // The signal's order down the plate: what the source is, where it goes, what
  // is done to it, what is coming back.
  expect(sendsBox.top, `${label} sends below the preamp`).toBeGreaterThanOrEqual(preampBox.top - 1);
  expect(eqBox.top, `${label} equaliser below the sends`).toBeGreaterThanOrEqual(sendsBox.top - 1);
  expect(meterBox.top, `${label} meter below the equaliser`).toBeGreaterThanOrEqual(eqBox.top - 1);

  // Every section is boxed inside the plate horizontally; the plate scrolls, so
  // a section below the fold is reachable rather than clipped.
  for (const [box, name] of [
    [preampBox, "preamp section"],
    [sendsBox, "sends section"],
    [eqBox, "equaliser section"],
    [meterBox, "meter section"],
  ] as const) {
    expect(box.left, `${label} ${name} left inside the plate`).toBeGreaterThanOrEqual(plateBox.left - 1);
    expect(box.right, `${label} ${name} right inside the plate`).toBeLessThanOrEqual(plateBox.right + 1);
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
