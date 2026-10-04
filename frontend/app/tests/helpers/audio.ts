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
  // The visual overhaul's Console pull request (graft 1). Old: the Outputs tier
  // stood in the bay beside Inputs and Playback. New: the outputs are a block
  // in the cluster, beside DIM and MONO. Reason: the owner chose that graft;
  // the bay holds the sources only.
  expectInsideBox(outputTier, cluster, "outputs block inside the cluster");
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

  // The visual overhaul's Console pull request. Old: a plate taller than its
  // column passed when it could scroll. New: the plate fits its 1320 px and
  // never scrolls. Reason: DESIGN.md §1, nothing scrolls; the plate's EQ and
  // dynamics are tables with their editing in popovers now.
  expect(
    metrics.scrollHeight <= metrics.clientHeight + 1,
    `the plate scrolls or clips (scrollHeight ${metrics.scrollHeight} > clientHeight ${metrics.clientHeight}, overflow-y ${metrics.overflowY})`
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
    // The visual overhaul's Console pull request: Main Out's meter in the
    // outputs block (it was the master meter under the cluster's level).
    const monitorMeter = document.querySelector<HTMLElement>('[data-testid="audio-lane-meter-audio-mix-main"]');
    const rect = (el: HTMLElement | null) => (el ? el.getBoundingClientRect().width : 0);
    return {
      clusterWidth: rect(cluster),
      monitorMeter: rect(monitorMeter),
      shellWidth: rect(document.querySelector<HTMLElement>("[data-shell-frame]")),
      stateWidth: rect(state),
    };
  });
  // A share of the shell, not a pixel count (the cluster is 424 px of 2560,
  // plan D4).
  expect(metrics.clusterWidth / metrics.shellWidth, "cluster fills its column").toBeGreaterThan(0.12);
  expect(metrics.stateWidth / metrics.clusterWidth, "state display fills the cluster").toBeGreaterThan(0.8);
  expect(metrics.monitorMeter / metrics.clusterWidth, "monitor master meter is filled").toBeGreaterThan(0.8);
}

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

// 2026-10-01 (the owner's decision, after the studio walk). Old:
// `expectSnapshotActionsDoNotOverlapContent` hovered a slot and checked that
// the save / rename / delete strip in its float never covered the slot's name,
// mix shape or last recall. New: the slots are TotalMix's own eight, each one
// key holding its name and what TotalMix reports of it, and the check is that
// both sit inside the key, that neither collides with the other, and that the
// line naming where the names come from sits inside the panel. Reason: the
// strip, the float and the thumbnail went with the app's own snapshots.
export async function expectSnapshotSlotsHoldTheirWords(page: Page) {
  const deck = await readRequiredBox(page, "audio-snapshot-deck");
  for (let slot = 1; slot <= 8; slot += 1) {
    const keyBox = await readRequiredLocatorBox(page.getByTestId(`audio-snapshot-load-${slot}`), `slot ${slot} key`);
    expectInsideBox(keyBox, deck, `slot ${slot} key inside the snapshot panel`);
    const nameBox = await readRequiredLocatorBox(page.getByTestId(`audio-snapshot-name-${slot}`), `slot ${slot} name`);
    expectInsideBox(nameBox, keyBox, `slot ${slot} name inside its key`);
    // The visual overhaul's Console pull request: a slot TotalMix does not hold
    // says nothing (it said "–"), so only a word is measured.
    const state = page.getByTestId(`audio-snapshot-state-${slot}`);
    if ((await state.textContent())?.trim()) {
      const stateBox = await readRequiredLocatorBox(state, `slot ${slot} state`);
      expectInsideBox(stateBox, keyBox, `slot ${slot} state inside its key`);
      expect(boxesIntersect(nameBox, stateBox), `slot ${slot} name overlaps its state`).toBe(false);
    }
  }
  // The visual overhaul's Console pull request. Old: the line naming where the
  // names come from stood under the keys, inside the panel. New: it is the
  // tooltip of the head's "in TotalMix", so its words are the panel's own
  // (hidden until the pointer rests there). Reason: hints are tooltips.
  const source = page.getByTestId("audio-snapshot-source");
  if ((await source.count()) > 0) {
    await expect(page.getByTestId("audio-snapshot-deck"), "the source line belongs to the panel").toContainText(
      (await source.first().textContent()) ?? ""
    );
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

// The visual overhaul's Console pull request: the Console's standing commands
// (Sync, the probe, Clear clips, Peak hold, Reset peaks, Open Setup) are the
// page's ⋯ items, with the test ids the standing keys had. This opens it.
export async function openAudioPageMenu(page: Page) {
  await page.getByTestId("audio-page-menu").click();
  const menu = page.getByRole("menu", { name: "Audio" });
  await expect(menu).toBeVisible();
  return menu;
}

/** The group filter is the tier's ⋯ now (it was the chips): opens it. */
export async function openAudioTierMenu(page: Page, tier: "hardware-inputs" | "software-playback") {
  await page.getByTestId(`audio-tier-menu-${tier}`).click();
  const menu = page.getByRole("menu", { name: tier === "hardware-inputs" ? "Inputs" : "Playback" });
  await expect(menu).toBeVisible();
  return menu;
}

/** Switches one group of a tier's filter on or off, from the tier's ⋯. */
export async function toggleAudioTierGroup(page: Page, tier: "hardware-inputs" | "software-playback", group: string) {
  await openAudioTierMenu(page, tier);
  await page.getByTestId(`audio-tier-chip-${tier === "hardware-inputs" ? "inputs" : "playback"}-${group}`).click();
}

/** Reads whether a tier's filter shows `group` lit ("true" / "false"), or "absent"; leaves the menu closed. */
export async function readAudioTierGroup(page: Page, tier: "hardware-inputs" | "software-playback", group: string) {
  await openAudioTierMenu(page, tier);
  const item = page.getByTestId(`audio-tier-chip-${tier === "hardware-inputs" ? "inputs" : "playback"}-${group}`);
  const state = (await item.count()) === 0 ? "absent" : ((await item.getAttribute("aria-checked")) ?? "absent");
  await page.keyboard.press("Escape");
  return state;
}

// 2026-10-01: loads TotalMix's snapshot `slot` the operator's way, two presses
// of its key with the dwell between them, and waits for the arm to go. Old:
// `saveAudioSnapshot` armed and confirmed a save into the app's own snapshot
// (and `readSnapshotThumbHeights` read its mix shape); both went with them.
export async function loadAudioSnapshot(page: Page, slot: number) {
  const tile = page.getByTestId(`audio-snapshot-slot-${slot}`);
  const key = page.getByTestId(`audio-snapshot-load-${slot}`);
  await expect(key).toBeEnabled();
  await key.click();
  await expect(tile).toHaveAttribute("data-armed", "true");
  await expect(key).toContainText("LOAD?");
  await page.waitForTimeout(AUDIO_ARM_MIN_DWELL_MS + 50); // confirm after the arm dwell (Slice 7)
  await key.click();
  await expect(tile).toHaveAttribute("data-armed", "false");
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
