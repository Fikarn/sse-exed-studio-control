import { expect, test, type Locator, type Page } from "@playwright/test";
import type { AudioSnapshot } from "@sse/engine-client";
import { readFileSync } from "node:fs";

import {
  dbfsToMeterPercent,
  faderDbToNormalized,
  formatAudioDb,
  formatMeterDb,
  meterTone,
  normalizedToDbfs,
  normalizedToFaderDb,
} from "../src/app/audio/audioFormatting";
import { buildAudioPaletteRegistrationSignature, buildAudioViewModel } from "../src/app/audio/audioViewModel";
import {
  calculateNextFixturePeakHold,
  createFixtureTransport,
} from "../../packages/engine-client/src/transports/fixtureTransport";
import { audioMeterEntryFromRecord } from "../../packages/engine-client/src/store/createShellStore";

const FIXTURE_NOW = new Date("2026-04-23T09:11:00+02:00");
const COMPACT_PREAMP_ASPECT_RATIO = 640 / 213;
const EXPECTED_DBFS_SCALE_LABELS = ["0", "-6", "-12", "-18", "-24", "-40", "-60"];
const EMPTY_AUDIO_GROUP_SELECTIONS = {
  "hardware-inputs": [],
  "software-playback": [],
};
const NARROW_PREAMP_ASPECT_RATIO = 426 / 640;
const fixtureMap = JSON.parse(
  readFileSync(new URL("../../packages/test-fixtures/src/fixtures.json", import.meta.url), "utf-8")
) as Record<string, { audioSnapshot?: AudioSnapshot }>;

declare global {
  interface Window {
    __SSE_TEST_ENGINE_REQUEST_COUNTS__?: Record<string, number>;
    __SSE_TEST_RENDER_COUNTS__?: {
      audioInspector?: number;
      audioRail?: number;
      audioSignalCanvas?: number;
      audioWorkspace?: number;
    };
    __SSE_TEST_NATIVE_DIALOG_COUNTS__?: {
      confirm: number;
      prompt: number;
    };
  }
}

function modifierShortcut(key: string) {
  return `${process.platform === "darwin" ? "Meta" : "Control"}+${key}`;
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function buildAudioTestViewModel(audioSnapshot: AudioSnapshot) {
  return buildAudioViewModel({
    activeChannelGroups: EMPTY_AUDIO_GROUP_SELECTIONS,
    appSnapshot: null,
    audioSnapshot,
    bankIndex: 0,
    density: "desktop",
  });
}

function audioPaletteSignatureForSnapshot(audioSnapshot: AudioSnapshot) {
  const viewModel = buildAudioTestViewModel(audioSnapshot);
  return buildAudioPaletteRegistrationSignature(viewModel, [
    ...viewModel.hardwareInputs.channels,
    ...viewModel.softwarePlayback.channels,
  ]);
}

function meterNormalizedForDbfs(dbfs: number) {
  return 10 ** (dbfs / 20);
}

async function openFixture(page: Page, fixtureId: string, options?: { operatorReview?: "studio" }) {
  if (fixtureId.startsWith("planning-")) {
    await page.clock.setFixedTime(FIXTURE_NOW);
  }
  const params = new URLSearchParams({
    fixture: fixtureId,
    transport: "fixture",
  });
  if (options?.operatorReview) {
    params.set("operatorReview", options.operatorReview);
  }
  const response = await page.goto(`/?${params.toString()}`);
  expect(response, `fixture ${fixtureId} should return a document response`).not.toBeNull();
  expect(response!.status(), `fixture ${fixtureId} should not fail to load`).toBeLessThan(400);
  expect(page.url()).toContain(`fixture=${fixtureId}`);
}

async function expectAspectRatio(locator: Locator, expectedRatio: number, label: string) {
  await expect(locator, `${label} should be visible before measuring aspect ratio`).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} should have a measurable box`).not.toBeNull();
  expect(box!.width / Math.max(1, box!.height), label).toBeCloseTo(expectedRatio, 2);
}

async function expectNoDocumentScroll(page: Page) {
  const metrics = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    scrollWidth: document.documentElement.scrollWidth,
    viewportHeight: window.innerHeight,
    viewportWidth: window.innerWidth,
  }));
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.viewportHeight + 1);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
}

async function readMeterCanvasSample(page: Page, hostTestId: string) {
  const trackBox = await page.getByTestId(hostTestId).locator('[data-meter-track="left"]').first().boundingBox();
  expect(trackBox, `${hostTestId} meter track should be measurable`).not.toBeNull();

  return page.getByTestId("audio-meter-canvas").evaluate((canvas, rect) => {
    const element = canvas as HTMLCanvasElement;
    const context = element.getContext("2d");
    if (!context || !rect) {
      return { checksum: 0, count: 0, sequence: "" };
    }

    const canvasRect = element.getBoundingClientRect();
    const scaleX = element.width / Math.max(1, canvasRect.width);
    const scaleY = element.height / Math.max(1, canvasRect.height);
    const x = Math.max(0, Math.floor((rect.x - canvasRect.x) * scaleX));
    const y = Math.max(0, Math.floor((rect.y - canvasRect.y) * scaleY));
    const width = Math.max(1, Math.min(element.width - x, Math.ceil(rect.width * scaleX)));
    const height = Math.max(1, Math.min(element.height - y, Math.ceil(rect.height * scaleY)));
    const data = context.getImageData(x, y, width, height).data;
    let checksum = 0;
    for (let index = 0; index < data.length; index += 17) {
      checksum = (checksum + data[index] * (index + 1)) % 1_000_000_007;
    }

    return {
      checksum,
      count: Number.parseInt(element.dataset.meterCount ?? "0", 10),
      sequence: element.dataset.meterSequence ?? "",
    };
  }, trackBox);
}

async function readRequiredBox(page: Page, testId: string) {
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

function expectInsideBox(
  child: Awaited<ReturnType<typeof readRequiredBox>>,
  parent: Awaited<ReturnType<typeof readRequiredBox>>,
  label: string
) {
  expect(child.left, `${label} left`).toBeGreaterThanOrEqual(parent.left - 1);
  expect(child.top, `${label} top`).toBeGreaterThanOrEqual(parent.top - 1);
  expect(child.right, `${label} right`).toBeLessThanOrEqual(parent.right + 1);
  expect(child.bottom, `${label} bottom`).toBeLessThanOrEqual(parent.bottom + 1);
}

async function expectAudioWorkspaceGeometry(page: Page) {
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

async function expectAudioInspectorPanelsFit(page: Page) {
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

async function expectAudioStudioSideRailsFilled(page: Page, bottomGapPx = 24) {
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

async function expectNoElementOverflow(locator: Locator, label: string) {
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

async function readRequiredLocatorBox(locator: Locator, label: string) {
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

function boxesIntersect(
  first: Awaited<ReturnType<typeof readRequiredLocatorBox>>,
  second: Awaited<ReturnType<typeof readRequiredLocatorBox>>
) {
  return (
    first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top
  );
}

async function expectSnapshotActionsDoNotOverlapContent(page: Page, snapshotId: string) {
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

async function expectAudioLaneCardsInsideTierGrids(page: Page) {
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

async function expectDbfsScaleLabelsInsideMeters(page: Page, label: string) {
  const meterAudit = await page.locator('[data-meter-component="stereo"]').evaluateAll((meters, expectedLabels) => {
    const tolerance = 1;
    return meters.map((meter, meterIndex) => {
      const meterElement = meter as HTMLElement;
      const meterRect = meterElement.getBoundingClientRect();
      const meterStyle = getComputedStyle(meterElement);
      const scale = meterElement.querySelector<HTMLElement>('[data-meter-scale="dbfs"]');
      const scaleRect = scale?.getBoundingClientRect() ?? null;
      const scaleLabels = scale
        ? Array.from(scale.querySelectorAll<HTMLElement>("[data-meter-scale-mark]")).map((scaleLabel, labelIndex) => {
            const labelRect = scaleLabel.getBoundingClientRect();
            const mark = scaleLabel.dataset.meterScaleMark ?? scaleLabel.textContent?.trim() ?? "";
            const insideMeter =
              labelRect.left >= meterRect.left - tolerance &&
              labelRect.top >= meterRect.top - tolerance &&
              labelRect.right <= meterRect.right + tolerance &&
              labelRect.bottom <= meterRect.bottom + tolerance;
            const insideScale =
              scaleRect !== null &&
              labelRect.left >= scaleRect.left - tolerance &&
              labelRect.top >= scaleRect.top - tolerance &&
              labelRect.right <= scaleRect.right + tolerance &&
              labelRect.bottom <= scaleRect.bottom + tolerance;

            return {
              insideMeter,
              insideScale,
              labelIndex,
              mark,
              position: getComputedStyle(scaleLabel).getPropertyValue("--meter-scale-position").trim(),
            };
          })
        : [];

      return {
        expectedLabels,
        id: meterElement.dataset.meterId ?? meterElement.closest("[data-testid]")?.getAttribute("data-testid") ?? "",
        labels: scaleLabels.map((entry) => entry.mark),
        scaleCount: meterElement.querySelectorAll('[data-meter-scale="dbfs"]').length,
        scaleLabels,
        visible:
          meterRect.width > 0 &&
          meterRect.height > 0 &&
          meterStyle.display !== "none" &&
          meterStyle.visibility !== "hidden",
        meterIndex,
      };
    });
  }, EXPECTED_DBFS_SCALE_LABELS);

  const visibleMeters = meterAudit.filter((entry) => entry.visible);
  expect(visibleMeters.length, `${label} visible stereo meters`).toBeGreaterThan(0);
  expect(
    visibleMeters.filter((entry) => entry.scaleCount !== 1),
    `${label} every visible meter should expose exactly one dBFS scale`
  ).toEqual([]);

  for (const entry of visibleMeters) {
    expect(entry.labels, `${label} ${entry.id || `meter ${entry.meterIndex}`} scale labels`).toEqual(
      EXPECTED_DBFS_SCALE_LABELS
    );
  }

  const clippedLabels = visibleMeters.flatMap((entry) =>
    entry.scaleLabels
      .filter((scaleLabel) => !scaleLabel.insideMeter || !scaleLabel.insideScale)
      .map((scaleLabel) => ({
        id: entry.id || `meter ${entry.meterIndex}`,
        insideMeter: scaleLabel.insideMeter,
        insideScale: scaleLabel.insideScale,
        mark: scaleLabel.mark,
      }))
  );
  expect(clippedLabels, `${label} clipped dBFS scale labels`).toEqual([]);

  const clippedBoundaryLabels = visibleMeters.flatMap((entry) =>
    entry.scaleLabels
      .filter((scaleLabel) => scaleLabel.mark === "0" || scaleLabel.mark === "-60")
      .filter((scaleLabel) => !scaleLabel.insideMeter || !scaleLabel.insideScale)
      .map((scaleLabel) => ({
        id: entry.id || `meter ${entry.meterIndex}`,
        mark: scaleLabel.mark,
      }))
  );
  expect(clippedBoundaryLabels, `${label} boundary dBFS scale labels`).toEqual([]);
}

async function expectAudioOverviewProcessingStack(page: Page, label: string, minimumGraphHeight: number) {
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

async function readSnapshotThumbHeights(page: Page, snapshotId: string) {
  return page
    .getByTestId(`audio-snapshot-thumb-${snapshotId}`)
    .locator("i")
    .evaluateAll((bars) => bars.map((bar) => (bar as HTMLElement).style.height));
}

async function saveAudioSnapshot(page: Page, snapshotId: string) {
  const snapshotTile = page.getByTestId(`audio-snapshot-${snapshotId}`);
  await snapshotTile.hover();
  const saveButton = snapshotTile.getByTestId(`audio-snapshot-actions-${snapshotId}`).getByRole("button").first();
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expect(saveButton).toHaveAttribute("data-armed", "true");
  await saveButton.click();
}

async function expectSliderValueChanges(page: Page, label: string) {
  const slider = page.getByRole("slider", { name: label });
  const before = await slider.getAttribute("aria-valuenow");
  const max = Number(await slider.getAttribute("aria-valuemax"));
  const direction = Number(before) >= max ? "ArrowLeft" : "ArrowRight";
  await slider.focus();
  await page.keyboard.press(direction);
  await expect(slider).not.toHaveAttribute("aria-valuenow", before ?? "");
}

async function expectToolbarPrimaryControlsFit(page: Page) {
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

  expect(result.map((entry) => entry.id).sort()).toEqual([
    "add",
    "overflow",
    "patch",
    "preview",
    "search",
    "status",
    "title",
  ]);
  expect(result.filter((entry) => !entry.fits)).toEqual([]);
}

test("renders the setup/support pilot shell from fixtures", async ({ page }) => {
  await openFixture(page, "setup-required");

  await expect(page.getByText("Commissioning runner")).toBeVisible();
  await expect(page.getByLabel("Workspace command rail")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Import the Companion profile" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Import profile/i })).toBeVisible();
});

test("walks the fixture-backed commissioning runner and support actions", async ({ page }) => {
  await openFixture(page, "setup-required");

  await page.getByRole("tab", { name: /Import profile/i }).click();
  await page.getByRole("button", { name: "Download profile" }).click();
  await expect(page.getByText(/Exported Companion profile to/)).toBeVisible();

  await page.getByRole("tab", { name: /Probe hardware/i }).click();
  await page.getByLabel("Lighting bridge IP").fill("192.168.1.80");
  await page.getByRole("button", { name: "Run all probes" }).click();
  await expect(page.getByText("All commissioning probes completed.")).toBeVisible();

  await expect(page.getByRole("heading", { name: "Map bindings" })).toBeVisible();
  await page.getByRole("button", { name: "Continue to verify" }).click();
  await expect(page.getByRole("heading", { name: "Verify live echo" })).toBeVisible();

  await page.getByRole("button", { name: "Continue to publish" }).click();
  await expect(page.getByRole("heading", { name: "Publish" })).toBeVisible();

  await page.getByRole("button", { name: "Publish setup" }).click();
  await expect(page.getByTestId("planning-workspace")).toBeVisible();
});

test("opens support mode and exercises backup workflows", async ({ page }) => {
  await openFixture(page, "setup-ready");

  await page.getByRole("button", { name: /^Support$/ }).click();
  await expect(page.getByText("What went wrong?")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Backup and recovery" })).toBeVisible();

  await page.getByRole("button", { name: "Export backup" }).click();
  await expect(page.getByText(/Exported support backup to/)).toBeVisible();

  await page.getByRole("button", { name: "Update repo" }).click();
  await expect(page.getByText(/Update repo opened at/)).toBeVisible();

  await page.getByRole("button", { name: "Restore latest" }).click();
  await expect(page.getByText(/Restored native-support-backup/)).toBeVisible();
});

test("renders startup and recovery fixture states", async ({ page }) => {
  await openFixture(page, "startup-loading");
  await expect(page.getByText("STARTING ENGINE…")).toBeVisible();
  await expect(page.getByLabel("Workspace command rail")).toHaveCount(0);

  await openFixture(page, "protocol-mismatch");
  await expect(page.getByRole("heading", { name: "Protocol mismatch" })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("What went wrong?")).toBeVisible();
  await expect(page.getByText("Reference paths")).toBeVisible();
  await expect(page.getByText("Requested protocol")).toBeVisible();
  await page.getByRole("button", { name: "Update repo" }).click();
  await expect(page.getByText(/Update repo opened at/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Logs" })).toBeVisible();

  await openFixture(page, "bootstrap-failed");
  await expect(page.getByRole("heading", { name: "Engine bootstrap failed" })).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByText("What went wrong?")).toBeVisible();
  await expect(page.getByText("Install & Update")).toBeVisible();
  await expect(page.getByText("Runtime paths")).toBeVisible();
  await expect(page.getByRole("button", { name: "Archive" })).toBeVisible();
});

test("shows degraded setup posture from fixtures", async ({ page }) => {
  await openFixture(page, "setup-degraded");
  await expect(page.getByText("Degraded startup posture")).toBeVisible();
  await page.getByRole("button", { name: /^Open support$/ }).click();
  await expect(page.getByRole("heading", { name: "Backup and recovery" })).toBeVisible();
});

test("renders the audio workspace from an engine-backed snapshot and supports key desk actions", async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.addInitScript(() => {
    window.__SSE_TEST_ENGINE_REQUEST_COUNTS__ = {};
    window.__SSE_TEST_NATIVE_DIALOG_COUNTS__ = { confirm: 0, prompt: 0 };
    window.prompt = () => {
      window.__SSE_TEST_NATIVE_DIALOG_COUNTS__!.prompt += 1;
      return null;
    };
    window.confirm = () => {
      window.__SSE_TEST_NATIVE_DIALOG_COUNTS__!.confirm += 1;
      return false;
    };
  });
  await openFixture(page, "audio-populated");

  const workspace = page.getByTestId("audio-workspace");
  await expect(workspace).toBeVisible();
  await expect(workspace).toHaveAttribute("data-output-role", "main-out");
  await expect
    .poll(() => workspace.evaluate((element) => getComputedStyle(element).getPropertyValue("--audio-accent").trim()))
    .toBe("#5dc5e8");
  await expect(workspace.getByText("Main Out").first()).toBeVisible();
  await expect(page.getByTestId("audio-signal-canvas")).toBeVisible();
  await expect(page.getByTestId("audio-signal-canvas").getByText("Editing")).toBeVisible();
  await expect(page.getByTestId("audio-signal-canvas").getByText("View", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("audio-signal-canvas").getByRole("button", { name: "Submix" })).toHaveCount(0);
  await expect(page.getByTestId("audio-signal-canvas").getByRole("button", { name: "Touch" })).toHaveCount(0);
  await expect(page.getByTestId("audio-tiered-mixer")).toBeVisible();
  await expect(page.getByTestId("audio-hardware-inputs-tier")).toBeVisible();
  await expect(page.getByTestId("audio-software-playback-tier")).toBeVisible();
  await expect(page.getByTestId("audio-hardware-outputs-tier")).toBeVisible();
  await expect(page.getByTestId("audio-health-bar")).toBeVisible();
  await expectAudioWorkspaceGeometry(page);
  await expect(page.getByTestId("audio-master-halo")).toBeVisible();
  await expect(page.getByTestId("audio-routing-overlay")).toHaveCount(0);
  // GS-AUD-45: OSC / Endpoint / Metering moved to the rail Trust panel
  // (canonical surface). The footer keeps only the temporal facts.
  await expect(page.getByTestId("audio-footer-telemetry")).not.toContainText("OSC");
  await expect(page.getByTestId("audio-footer-telemetry")).not.toContainText("Endpoint");
  await expect(page.getByTestId("audio-footer-telemetry")).not.toContainText("Metering");
  await expect(page.getByTestId("audio-footer-telemetry")).toContainText("Clock");
  await expect(page.getByTestId("audio-rail-trust-panel")).toContainText("Endpoint");
  await expect(page.getByTestId("audio-rail-trust-panel")).toContainText("Metering");
  await expect(page.getByTestId("audio-footer-shortcuts")).toContainText("Command palette");
  await expect(page.getByTestId("audio-footer-shortcuts")).toContainText("Shortcuts");
  await expect(page.getByTestId("audio-footer-shortcuts")).toContainText("Bank prev");
  await expect(page.getByTestId("audio-footer-shortcuts")).toContainText("Bank next");
  await expect(page.getByTestId("audio-footer-shortcuts")).not.toContainText("Shift 1-8 recall");
  await expect(page.getByTestId("audio-footer-shortcuts")).not.toContainText("Esc clear");
  await expect(page.getByTestId("audio-rail-monitor-card")).toBeVisible();
  await expect(page.getByTestId("audio-rail-monitor-card")).toContainText(formatAudioDb(0.78));
  await expect(page.getByTestId("audio-rail-tools")).toContainText("Sync");
  await expect(page.getByTestId("audio-rail-tools").getByRole("button", { name: /Setup/ })).toBeEnabled();
  await expect(page.getByTestId("audio-rail-tools")).not.toContainText("Levels");
  await expect(page.getByTestId("audio-solo-warning-band")).toContainText("solo engaged");
  await expect
    .poll(async () => {
      const box = await page.getByTestId("audio-solo-warning-band").boundingBox();
      return Math.round(box?.height ?? 0);
    })
    .toBeLessThanOrEqual(36);
  await expect(page.getByTestId("audio-clip-warning-band")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear all solo" }).click();
  await expect(page.getByTestId("audio-solo-warning-band")).toHaveCount(0);
  await expect(page.getByTestId("audio-tier-chip-inputs-talent")).toBeVisible();
  await expect(page.getByTestId("audio-tier-chip-inputs-line")).toHaveCount(0);
  await expect(page.getByTestId("audio-tier-chip-inputs-remote")).toHaveCount(0);
  await expect(page.getByTestId("audio-tier-chip-playback-bed")).toBeVisible();
  await expect(page.getByTestId("audio-tier-chip-playback-remote")).toHaveCount(0);
  await expect(page.getByTestId("audio-snapshot-capture")).toBeEnabled();
  await expect(page.locator("[data-snapshot-slot]")).toHaveCount(8);
  await expect(page.getByTestId("audio-snapshot-empty-6")).toContainText("Empty");
  await expect(page.getByTestId("audio-snapshot-thumb-snapshot-show-open")).toBeVisible();
  await expect(page.getByTestId("audio-snapshot-capture")).toBeEnabled();
  await page.getByTestId("audio-snapshot-snapshot-open-rehearsal").hover();
  await expect(
    page.getByTestId("audio-snapshot-snapshot-open-rehearsal").getByText("Console slot recall")
  ).toBeVisible();
  await expect(page.getByTestId("audio-signal-canvas").getByRole("button", { name: "Master" })).toHaveCount(0);
  await expect(page.getByTestId("audio-warning-band")).toHaveCount(0);
  await expect(page.getByTestId("audio-mix-target-audio-mix-main")).toHaveAttribute("data-selected", "true");
  await expect(page.getByTestId("audio-strip-audio-input-9")).toHaveAttribute("data-group", "talent");
  await expect(page.getByTestId("audio-strip-audio-playback-1-2")).toHaveAttribute("data-group", "bed");
  await expect(page.getByTestId("audio-strip-audio-playback-3-4")).toHaveAttribute("data-group", "fx");
  await expect(page.getByTestId("audio-strip-audio-input-9")).toBeVisible();
  await expect(page.getByTestId("audio-strip-audio-input-12")).toBeVisible();
  await expect(page.getByTestId("audio-strip-audio-input-1")).toHaveCount(0);
  await expect(page.getByTestId("audio-strip-audio-playback-3-4")).toHaveAttribute("data-feeding", "true");
  await expect(page.getByTestId("audio-inspector-channel")).toContainText("FX 3/4");
  await expect(page.getByTestId("audio-inspector-hardware-mini")).toContainText("Software");
  await expect(page.getByTestId("audio-inspector-hardware-mini")).toContainText("Playback telemetry not reported");
  await expect(page.getByTestId("audio-inspector-channel")).not.toContainText("Buffer status");
  await expect(page.getByTestId("audio-inspector-channel").getByRole("button", { name: "Stereo link" })).toHaveCount(0);
  await expect(page.getByTestId("audio-inspector-hardware-mini")).toContainText("Stereo link");
  await expect(page.getByTestId("audio-inspector-hardware-mini")).toContainText("Auto fade");
  await page.getByTestId("audio-strip-audio-input-9").click();
  await expect(page.getByTestId("audio-inspector-hardware-mini")).toContainText("Hardware");
  await expect(page.getByTestId("audio-inspector-hardware-mini")).toContainText("48V");
  await expect(page.getByTestId("audio-inspector-hardware-mini")).toContainText("Hi-Z");
  await expect(page.getByTestId("audio-inspector-hardware-mini")).toContainText("Polarity");
  await expect(page.getByTestId("audio-inspector-hardware-mini")).toContainText("AutoSet");
  await expect(page.getByTestId("audio-inspector-hardware-mini")).not.toContainText("Pad");
  await page.getByTestId("audio-strip-audio-playback-3-4").click();

  await page.getByRole("button", { name: /Main Out.*selected/i }).click();
  await expect(page.getByRole("menu", { name: "Audio output targets" })).toBeVisible();
  await page.getByRole("menuitem", { name: /Phones 1/i }).click();
  await expect(workspace).toHaveAttribute("data-output-role", "phones-a");
  await expect(page.getByRole("button", { name: /Phones 1.*selected/i })).toBeVisible();

  await page.getByTestId("audio-mix-target-audio-mix-phones-a").click();
  await expect(page.getByTestId("audio-mix-target-audio-mix-phones-a")).toHaveAttribute("data-selected", "true");
  await expect(workspace).toHaveAttribute("data-output-role", "phones-a");
  await expect
    .poll(() => workspace.evaluate((element) => getComputedStyle(element).getPropertyValue("--audio-accent").trim()))
    .toBe("#e8a341");
  await expect(page.getByTestId("audio-hardware-outputs-tier")).toContainText("Phones 1");
  await page.getByTestId("audio-output-audio-mix-main").click();
  await expect(page.locator('[data-source-tier="outputs"]')).toBeVisible();
  await expect(page.getByTestId("audio-inspector-output")).toContainText("Hardware output");
  await page.getByTestId("audio-tier-lanes-hardware-inputs").dispatchEvent("click");
  await expect(page.locator('[data-source-tier="outputs"]')).toBeVisible();
  await expect(page.getByTestId("audio-inspector-output")).toContainText("Hardware output");
  await expect(page.getByTestId("audio-inspector-output").getByRole("button", { name: "PFL" })).toHaveCount(0);
  await page.getByTestId("audio-strip-audio-playback-3-4").click();

  await page.keyboard.press("BracketRight");
  await expect(page.getByTestId("audio-tiered-mixer")).toBeVisible();

  await page.keyboard.press("Digit1");
  const selectedStrip = page.getByTestId("audio-strip-audio-input-1");
  await expect(selectedStrip).toHaveAttribute("data-selected", "true");

  await page.keyboard.press("KeyM");
  await expect(selectedStrip.getByRole("button", { name: /Mute/ })).toHaveAttribute("data-active", "true");
  await expect(selectedStrip.getByRole("button", { name: /Mute/ })).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("Shift+Digit3");
  await expect(page.getByTestId("audio-snapshot-snapshot-interview-block")).toHaveAttribute("data-armed", "true");
  await page.keyboard.press("Shift+Digit3");
  await expect(page.getByTestId("audio-snapshot-snapshot-interview-block")).toHaveAttribute("data-current", "true");
  await expect(page.getByTestId("audio-toolbar-current-snapshot")).toHaveText("Recalled Interview block");

  await expect(page.getByTestId("audio-inspector-channel")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("audio-inspector-metering")).toContainText("Level L / R");
  await expect(page.getByTestId("audio-inspector-metering")).toContainText("Peak hold");
  await expect(page.getByTestId("audio-inspector-level-readout")).toHaveAttribute("data-meter-readout-mode", "level");
  await expect(page.getByTestId("audio-inspector-peak-hold-readout")).toHaveAttribute(
    "data-meter-readout-mode",
    "peakHold"
  );
  await expect(page.getByTestId("audio-inspector-metering")).toContainText("Nominal ref");
  await expect(page.getByTestId("audio-inspector-eq-mini")).toContainText("EQ");
  await expect(page.getByTestId("audio-inspector-dynamics-mini")).toContainText("Dynamics");
  await expect(page.getByTestId("audio-inspector-sends-mini")).toContainText("Sends");
  const contextCountsBefore = await page.evaluate(() => ({ ...window.__SSE_TEST_ENGINE_REQUEST_COUNTS__ }));
  await page.getByTestId("audio-strip-audio-input-1").click({ button: "right", position: { x: 12, y: 12 } });
  const menu = page.getByRole("menu", { name: /actions/i });
  await expect(menu).toContainText("Reset to unity");
  const contextCountsAfterOpen = await page.evaluate(() => ({ ...window.__SSE_TEST_ENGINE_REQUEST_COUNTS__ }));
  expect(contextCountsAfterOpen["audio.settings.update"] ?? 0).toBe(contextCountsBefore["audio.settings.update"] ?? 0);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  const contextCountsAfterEscape = await page.evaluate(() => ({ ...window.__SSE_TEST_ENGINE_REQUEST_COUNTS__ }));
  expect(contextCountsAfterEscape["audio.settings.update"] ?? 0).toBe(
    contextCountsBefore["audio.settings.update"] ?? 0
  );
  await page.getByTestId("audio-strip-audio-input-1").click({ button: "right", position: { x: 12, y: 12 } });
  await expect(page.getByRole("menuitem", { name: "Rename" })).toBeEnabled();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const renameDialog = page.getByRole("dialog", { name: "Rename Audio Channel" });
  await expect(renameDialog).toBeVisible();
  await renameDialog.getByLabel("Channel name").fill("Renamed line 1");
  await renameDialog.getByRole("button", { name: "Rename" }).click();
  await expect(page.getByTestId("audio-strip-audio-input-1")).toContainText("Renamed line 1");
  await expect
    .poll(() => page.evaluate(() => window.__SSE_TEST_NATIVE_DIALOG_COUNTS__))
    .toEqual({
      confirm: 0,
      prompt: 0,
    });
  await expect(page.getByRole("button", { name: "PFL" })).toHaveCount(0);
  await page.getByRole("tab", { name: "EQ" }).click();
  await page.getByTestId("audio-inspector-eq").getByRole("button", { name: "1", exact: true }).click();
  await expect(page.getByRole("button", { name: "Enable PEQ" })).toBeEnabled();
  await page.getByRole("button", { name: "Enable PEQ" }).click();
  await expect(page.getByRole("button", { name: "Bypass PEQ" })).toHaveAttribute("data-active", "true");
  await page.getByRole("tab", { name: "Dynamics" }).click();
  await expect(page.getByTestId("audio-inspector-dynamics").getByRole("button", { name: "Comp" })).toBeEnabled();
  await expect(page.getByTestId("audio-dynamics-range")).toContainText("Comp");
  await page.getByRole("tab", { name: "Sends" }).click();
  await expect(page.getByTestId("audio-inspector-sends")).toContainText("Phones 1");
  await expect(page.getByTestId("audio-send-destination-audio-mix-phones-a")).toContainText(/Send|No send|Muted/);
  const preFader = page.getByTestId("audio-inspector-sends").getByRole("button", { name: "Pre fader" }).first();
  await expect(preFader).toBeEnabled();
  await preFader.click();
  await expect(preFader).toHaveAttribute("data-active", "true");

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("audio-inspector-channel")).toBeVisible();
});

test("audio rail setup action opens the setup workspace", async ({ page }) => {
  await openFixture(page, "audio-populated");

  await page.getByTestId("audio-rail-tools").getByRole("button", { name: /Setup/ }).click();
  await expect(page.getByText("Setup / Support").first()).toBeVisible();
});

test("renders audio degraded and loading fixture states", async ({ page }) => {
  await openFixture(page, "audio-state-assumed");
  await expect(page.getByText("STATE ASSUMED", { exact: true })).toBeVisible();
  await expect(page.getByText(/using last synced console state/i)).toBeVisible();

  await openFixture(page, "audio-not-verified");
  await expect(page.getByText("OSC NOT VERIFIED", { exact: true })).toBeVisible();
  await expect(page.getByTestId("audio-rail-tools").getByRole("button", { name: "Sync" })).toBeEnabled();
  await expect(page.getByRole("slider", { name: "FX 3/4 send level" })).not.toHaveAttribute("aria-disabled", "true");
  await page.getByTestId("audio-rail-tools").getByRole("button", { name: "Sync" }).click();
  await expect(page.getByText(/Run the commissioning audio probe before syncing/i)).toBeVisible();

  await openFixture(page, "audio-osc-disabled");
  await expect(page.getByText("OSC DISABLED", { exact: true })).toBeVisible();
  await expect(page.getByTestId("audio-rail-tools").getByRole("button", { name: "Sync" })).toBeDisabled();

  await openFixture(page, "audio-offline");
  await expect(page.getByText("CONSOLE UNREACHABLE", { exact: true })).toBeVisible();
  await expect(page.getByText("Console did not answer OSC ping.").first()).toBeVisible();

  await openFixture(page, "audio-action-failed");
  await expect(page.getByText("SNAPSHOT RECALL FAILED", { exact: true })).toBeVisible();
  await expect(
    page.getByText("AUDIO_SNAPSHOT_RECALL_FAILED · Snapshot slot 3 did not match the current console layout.")
  ).toBeVisible();

  await openFixture(page, "audio-loading");
  await expect(page.getByText("Loading audio snapshot.")).toBeVisible();
});

test("renders unclipped dBFS scale labels beside every audio meter", async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1440 });
  await openFixture(page, "audio-populated");
  await page.getByTestId("audio-strip-audio-input-9").click();

  const meterAudit = await page.locator('[data-meter-component="stereo"]').evaluateAll((meters) =>
    meters.map((meter) => ({
      labels: Array.from(meter.querySelectorAll('[data-meter-scale="dbfs"] span')).map((entry) =>
        entry.textContent?.trim()
      ),
      scaleCount: meter.querySelectorAll('[data-meter-scale="dbfs"]').length,
      strip: meter.closest("[data-testid]")?.getAttribute("data-testid") ?? "unknown-meter-host",
    }))
  );

  expect(meterAudit.length).toBeGreaterThan(0);
  expect(meterAudit.filter((entry) => entry.scaleCount !== 1)).toEqual([]);
  for (const entry of meterAudit) {
    expect(entry.labels).toEqual(EXPECTED_DBFS_SCALE_LABELS);
  }
  await expectDbfsScaleLabelsInsideMeters(page, "native 2560 selected-channel");

  await page.getByTestId("audio-output-audio-mix-main").click();
  await expect(page.getByTestId("audio-inspector-output-metering")).toBeVisible();
  await expectDbfsScaleLabelsInsideMeters(page, "native 2560 output inspector");
});

test("stacks audio inspector processing previews in Overview", async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1440 });
  await openFixture(page, "audio-populated");

  await page.getByTestId("audio-strip-audio-input-9").click();
  await expect(page.getByRole("tab", { name: "Overview", exact: true })).toHaveAttribute("aria-selected", "true");
  await expectAudioOverviewProcessingStack(page, "native 2560 selected-channel", 82);

  await page.getByTestId("audio-inspector-eq-mini").click();
  await expect(page.getByRole("tab", { name: "EQ", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tab", { name: "Overview", exact: true })).toHaveAttribute("aria-selected", "true");

  await page.getByTestId("audio-inspector-dynamics-mini").click();
  await expect(page.getByRole("tab", { name: "Dynamics", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tab", { name: "Overview", exact: true })).toHaveAttribute("aria-selected", "true");

  await page.getByTestId("audio-output-audio-mix-main").click();
  await expect(page.getByTestId("audio-inspector-output")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Output", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "EQ", exact: true })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Dynamics", exact: true })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Sends", exact: true })).toHaveCount(0);
});

test("renders live-console meter references instead of loudness readouts", async ({ page }) => {
  await openFixture(page, "audio-populated");

  await expect(page.getByTestId("audio-signal-canvas")).not.toContainText("LUFS");
  await expect(page.getByTestId("audio-signal-canvas")).toContainText("SIM");
  await expect(page.getByTestId("audio-inspector-metering")).toContainText("Nominal ref");
  await expect(page.getByTestId("audio-inspector-metering")).toContainText("Peak warn");

  const nominalReferences = await page
    .locator('[data-meter-component="stereo"] [data-meter-reference="nominal"]')
    .count();
  const stereoMeters = await page.locator('[data-meter-component="stereo"]').count();
  expect(stereoMeters).toBeGreaterThan(0);
  expect(nominalReferences).toBe(stereoMeters * 2);

  const offsets = await page
    .locator('[data-meter-component="stereo"]')
    .evaluateAll((meters) =>
      meters.map((meter) => getComputedStyle(meter).getPropertyValue("--audio-meter-nominal-offset").trim())
    );
  expect(offsets.every((offset) => offset === "30.00%")).toBe(true);
});

test("renders live audio meters without clip-path compositor churn", async ({ page }) => {
  await openFixture(page, "audio-populated");
  await expect(page.locator('[data-meter-component="stereo"]').first()).toBeVisible();

  const meterPaintStyles = await page
    .locator(
      '[data-meter-fill], [data-meter-peak], [data-testid="audio-active-mix-meter"] i, [data-testid="audio-inspector-metering"] i'
    )
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const style = getComputedStyle(node);
        return {
          clipPath: style.clipPath,
          transitionProperty: style.transitionProperty,
          willChange: style.willChange,
        };
      })
    );

  expect(meterPaintStyles.length).toBeGreaterThan(0);
  expect(meterPaintStyles.filter((entry) => entry.clipPath !== "none")).toEqual([]);
  expect(meterPaintStyles.filter((entry) => entry.willChange !== "auto" && entry.willChange !== "transform")).toEqual(
    []
  );
  expect(meterPaintStyles.filter((entry) => entry.transitionProperty.includes("clip-path"))).toEqual([]);
});

test("keeps the audio workspace stable during meter-only ticks", async ({ page }) => {
  test.slow();
  await page.addInitScript(() => {
    window.__SSE_TEST_RENDER_COUNTS__ = {
      audioInspector: 0,
      audioRail: 0,
      audioSignalCanvas: 0,
      audioWorkspace: 0,
    };
  });
  await openFixture(page, "audio-populated");

  const meter = page.getByTestId("audio-strip-audio-input-9").locator('[data-meter-component="stereo"]').first();
  await expect(meter).toBeVisible();
  const canvas = page.getByTestId("audio-meter-canvas");
  await expect(canvas).toBeVisible();

  const initialCounts = await page.evaluate(() => ({ ...window.__SSE_TEST_RENDER_COUNTS__ }));
  await expect
    .poll(async () => (await readMeterCanvasSample(page, "audio-strip-audio-input-9")).checksum, { timeout: 1_500 })
    .toBeGreaterThan(0);
  const initialCanvas = await readMeterCanvasSample(page, "audio-strip-audio-input-9");

  await expect
    .poll(async () => (await readMeterCanvasSample(page, "audio-strip-audio-input-9")).checksum, { timeout: 1_800 })
    .not.toBe(initialCanvas.checksum);

  const finalCanvas = await readMeterCanvasSample(page, "audio-strip-audio-input-9");
  const finalCounts = await page.evaluate(() => ({ ...window.__SSE_TEST_RENDER_COUNTS__ }));

  expect(finalCanvas.checksum).not.toBe(initialCanvas.checksum);
  for (const key of ["audioWorkspace", "audioRail", "audioSignalCanvas", "audioInspector"] as const) {
    expect((finalCounts[key] ?? 0) - (initialCounts[key] ?? 0), key).toBeLessThanOrEqual(1);
  }
});

test("runs simulated meters in the selected-channel review fixture", async ({ page }) => {
  test.slow();
  await openFixture(page, "audio-selected-channel");

  await expect(page.getByTestId("audio-strip-audio-playback-3-4")).toHaveAttribute("data-selected", "true");
  await expect(page.getByTestId("audio-meter-canvas")).toBeVisible();
  const initialSequence = Number((await readMeterCanvasSample(page, "audio-strip-audio-playback-3-4")).sequence) || 0;
  await expect
    .poll(async () => Number((await readMeterCanvasSample(page, "audio-strip-audio-playback-3-4")).sequence) || 0, {
      timeout: 1_800,
    })
    .toBeGreaterThan(initialSequence);
});

test("stabilizes audio inspector meter readouts during meter-only ticks", async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 2560, height: 1440 });
  await openFixture(page, "audio-populated");
  await page.getByTestId("audio-strip-audio-input-9").click();

  const levelReadout = page.getByTestId("audio-inspector-level-readout");
  const peakHoldReadout = page.getByTestId("audio-inspector-peak-hold-readout");
  await expect(page.getByTestId("audio-inspector-metering")).toContainText("Level L / R");
  await expect(page.getByTestId("audio-inspector-metering")).toContainText("Peak hold");
  await expect(levelReadout).toHaveAttribute("data-meter-readout-mode", "level");
  await expect(peakHoldReadout).toHaveAttribute("data-meter-readout-mode", "peakHold");

  const initialLevelBox = await levelReadout.boundingBox();
  const initialPeakBox = await peakHoldReadout.boundingBox();
  expect(initialLevelBox).not.toBeNull();
  expect(initialPeakBox).not.toBeNull();
  const initialCanvas = await readMeterCanvasSample(page, "audio-strip-audio-input-9");

  const readoutMetrics = await page.evaluate(async () => {
    const level = document.querySelector<HTMLElement>('[data-testid="audio-inspector-level-readout"]');
    const peakHold = document.querySelector<HTMLElement>('[data-testid="audio-inspector-peak-hold-readout"]');
    if (!level || !peakHold) {
      return { levelText: "", mutations: 0, peakHoldText: "" };
    }

    let mutations = 0;
    const observer = new MutationObserver(() => {
      mutations += 1;
    });
    observer.observe(level, { characterData: true, childList: true, subtree: true });
    observer.observe(peakHold, { characterData: true, childList: true, subtree: true });
    await new Promise((resolve) => window.setTimeout(resolve, 700));
    observer.disconnect();

    return {
      levelText: level.textContent?.trim() ?? "",
      mutations,
      peakHoldText: peakHold.textContent?.trim() ?? "",
    };
  });

  expect(readoutMetrics.levelText).toMatch(/(-∞|-?\d+)\s*\/\s*(-∞|-?\d+)/);
  expect(readoutMetrics.peakHoldText).toMatch(/(-∞|-?\d+)\s*\/\s*(-∞|-?\d+)/);
  expect(readoutMetrics.mutations).toBeLessThanOrEqual(18);

  const finalLevelBox = await levelReadout.boundingBox();
  const finalPeakBox = await peakHoldReadout.boundingBox();
  expect(finalLevelBox).not.toBeNull();
  expect(finalPeakBox).not.toBeNull();
  expect(Math.abs(finalLevelBox!.width - initialLevelBox!.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(finalPeakBox!.width - initialPeakBox!.width)).toBeLessThanOrEqual(1);

  const finalCanvas = await readMeterCanvasSample(page, "audio-strip-audio-input-9");
  expect(finalCanvas.checksum).not.toBe(initialCanvas.checksum);
});

test("does not refresh audio snapshots for meter-only ticks", async ({ page }) => {
  test.slow();
  await page.addInitScript(() => {
    window.__SSE_TEST_ENGINE_REQUEST_COUNTS__ = {};
  });
  await openFixture(page, "audio-populated");

  const initialAudioSnapshotRequests = await page.evaluate(
    () => window.__SSE_TEST_ENGINE_REQUEST_COUNTS__?.["audio.snapshot"] ?? 0
  );
  await expect
    .poll(async () => (await readMeterCanvasSample(page, "audio-strip-audio-input-9")).checksum, { timeout: 1_500 })
    .toBeGreaterThan(0);
  await page.waitForTimeout(900);
  const finalAudioSnapshotRequests = await page.evaluate(
    () => window.__SSE_TEST_ENGINE_REQUEST_COUNTS__?.["audio.snapshot"] ?? 0
  );

  expect(finalAudioSnapshotRequests).toBe(initialAudioSnapshotRequests);
});

test("switches audio output targets without a full-domain refresh", async ({ page }) => {
  await page.addInitScript(() => {
    window.__SSE_TEST_ENGINE_REQUEST_COUNTS__ = {};
  });
  await openFixture(page, "audio-populated");

  const initialCounts = await page.evaluate(() => ({ ...window.__SSE_TEST_ENGINE_REQUEST_COUNTS__ }));
  await page.getByTestId("audio-output-audio-mix-phones-a").click();
  await expect(page.getByTestId("audio-output-audio-mix-phones-a")).toHaveAttribute("data-selected", "true");

  const finalCounts = await page.evaluate(() => ({ ...window.__SSE_TEST_ENGINE_REQUEST_COUNTS__ }));
  expect((finalCounts["audio.settings.update"] ?? 0) - (initialCounts["audio.settings.update"] ?? 0)).toBe(1);
  for (const method of [
    "health.snapshot",
    "app.snapshot",
    "commissioning.snapshot",
    "lighting.snapshot",
    "planning.snapshot",
    "support.snapshot",
    "controlSurface.snapshot",
  ]) {
    expect((finalCounts[method] ?? 0) - (initialCounts[method] ?? 0), method).toBe(0);
  }
});

test("marks simulated audio metering as test-stage movement", async ({ page }) => {
  test.slow();
  await openFixture(page, "audio-populated");

  await expect(page.getByTestId("audio-meter-simulation-chip")).toHaveText("TEST METER SIMULATION");
  await expect(page.getByTestId("audio-rail-monitor-card")).toContainText("test meters");
  // GS-AUD-45: simulated metering label now lives on the rail Trust panel.
  await expect(page.getByTestId("audio-rail-trust-panel")).toContainText("test simulation");
  await expect(page.getByTestId("audio-inspector-metering")).toContainText("TEST STAGE");

  const hostMeter = page.getByTestId("audio-strip-audio-input-9").locator('[data-meter-component="stereo"]');
  await expect(hostMeter).toHaveCount(1);
  const meterCanvas = page.getByTestId("audio-meter-canvas");
  await expect(meterCanvas).toBeVisible();
  await expect
    .poll(async () => (await readMeterCanvasSample(page, "audio-strip-audio-input-9")).checksum, { timeout: 1_500 })
    .toBeGreaterThan(0);
  const stripFill = hostMeter.locator('[data-meter-fill="left"]').first();
  await expect(stripFill).toBeVisible();
  expect(await stripFill.evaluate((node) => getComputedStyle(node).animationName)).toBe("none");
  expect(await stripFill.evaluate((node) => getComputedStyle(node).transitionDuration)).toBe("0s");
  expect(["auto", "transform"]).toContain(await stripFill.evaluate((node) => getComputedStyle(node).willChange));
  expect(await stripFill.evaluate((node) => getComputedStyle(node).transform)).not.toBe("none");
  const firstHostMeterVars = await hostMeter.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      left: style.getPropertyValue("--audio-meter-left").trim(),
      right: style.getPropertyValue("--audio-meter-right").trim(),
      peakLeft: style.getPropertyValue("--audio-meter-peak-left").trim(),
      peakRight: style.getPropertyValue("--audio-meter-peak-right").trim(),
    };
  });
  expect(firstHostMeterVars.right).toBe(firstHostMeterVars.left);
  expect(firstHostMeterVars.peakRight).toBe(firstHostMeterVars.peakLeft);
  const stripPeak = hostMeter.locator('[data-meter-peak="left"]').first();
  await expect(stripPeak).toBeVisible();
  expect(await stripPeak.evaluate((node) => getComputedStyle(node).animationName)).toBe("none");
  expect(await stripPeak.evaluate((node) => getComputedStyle(node).transitionDuration)).toBe("0s");
  const stripPeakColor = await stripPeak.evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(stripPeakColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(stripPeakColor).not.toContain("255, 255, 255");
  const hostPeakVars = await hostMeter.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      left: style.getPropertyValue("--audio-meter-peak-left").trim(),
      right: style.getPropertyValue("--audio-meter-peak-right").trim(),
    };
  });
  expect(hostPeakVars.left).not.toBe("");
  expect(hostPeakVars.right).not.toBe("");
  expect(hostPeakVars.right).toBe(hostPeakVars.left);

  const inspectorPeak = page.getByTestId("audio-inspector-metering").locator('[data-meter-peak="left"]').first();
  await expect(inspectorPeak).toBeVisible();
  expect(await inspectorPeak.evaluate((node) => getComputedStyle(node).animationName)).toBe("none");
  expect(await inspectorPeak.evaluate((node) => getComputedStyle(node).transitionDuration)).toBe("0s");

  await expect(page.getByTestId("audio-strip-audio-input-10").locator('[data-meter-component="stereo"]')).toHaveCount(
    1
  );
  await expect(page.getByTestId("audio-strip-audio-input-11").locator('[data-meter-component="stereo"]')).toHaveCount(
    1
  );
  await expect(page.getByTestId("audio-strip-audio-input-12").locator('[data-meter-component="stereo"]')).toHaveCount(
    1
  );
  const speechLevels: number[] = [];
  for (const testId of [
    "audio-strip-audio-input-9",
    "audio-strip-audio-input-10",
    "audio-strip-audio-input-11",
    "audio-strip-audio-input-12",
  ]) {
    const seededLevel = await page
      .getByTestId(testId)
      .locator('[data-meter-component="stereo"]')
      .evaluate((node) => Number.parseFloat(getComputedStyle(node).getPropertyValue("--audio-meter-left")));
    expect(seededLevel).toBeGreaterThanOrEqual(20);
    expect(seededLevel).toBeLessThanOrEqual(96);
    speechLevels.push(seededLevel);
  }
  expect(new Set(speechLevels.map((value) => Math.round(value))).size).toBeGreaterThan(1);

  const programPlaybackMeter = page
    .getByTestId("audio-strip-audio-playback-1-2")
    .locator('[data-meter-component="stereo"]');
  await expect(programPlaybackMeter).toHaveCount(1);
  const activeMixFill = page.getByTestId("audio-active-mix-meter").locator("i").first();
  expect(await activeMixFill.evaluate((node) => getComputedStyle(node).animationName)).toBe("none");
  const firstCanvasSample = await readMeterCanvasSample(page, "audio-strip-audio-input-9");
  await expect
    .poll(async () => (await readMeterCanvasSample(page, "audio-strip-audio-input-9")).checksum, { timeout: 1_800 })
    .not.toBe(firstCanvasSample.checksum);

  await openFixture(page, "audio-hardware-metering");
  await expect(page.getByTestId("audio-meter-simulation-chip")).toHaveCount(0);
  await expect(page.getByTestId("audio-rail-monitor-card")).toContainText("Active mix · live");
  // GS-AUD-45: the simulated badge moved to the rail Trust panel.
  await expect(page.getByTestId("audio-rail-trust-panel")).not.toContainText("test simulation");
  await expect(page.locator("[data-simulated-meter]")).toHaveCount(0);
  await expect(page.getByTestId("audio-strip-audio-playback-3-4").locator("[data-simulation-profile]")).toHaveCount(0);
  const hardwareHostMeter = page.getByTestId("audio-strip-audio-input-9").locator('[data-meter-component="stereo"]');
  const hardwareMeterVars = await hardwareHostMeter.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      left: Number.parseFloat(style.getPropertyValue("--audio-meter-left")),
      scaleLabels: Array.from(node.querySelectorAll("span"))
        .map((entry) => entry.textContent?.trim())
        .filter(Boolean),
    };
  });
  expect(hardwareMeterVars.left).toBeCloseTo(((20 * Math.log10(0.72) + 60) / 60) * 100, 1);
  expect(hardwareMeterVars.scaleLabels).toEqual(expect.arrayContaining(["0", "-6", "-12", "-18", "-24", "-40", "-60"]));
});

test("holds fixture peak markers until the hold window expires", () => {
  const first = calculateNextFixturePeakHold({
    body: 0.36,
    deltaSeconds: 0.083,
    elapsedMs: 1_000,
    holdUntilMs: 0,
    previousPeak: 0.4,
    raw: 0.68,
  });
  expect(first.peakHold).toBe(0.68);
  expect(first.holdUntilMs).toBe(2_500);

  const smallerTransientDuringHold = calculateNextFixturePeakHold({
    body: 0.38,
    deltaSeconds: 0.25,
    elapsedMs: 1_250,
    holdUntilMs: first.holdUntilMs,
    previousPeak: first.peakHold,
    raw: 0.46,
  });
  expect(smallerTransientDuringHold.peakHold).toBe(first.peakHold);
  expect(smallerTransientDuringHold.holdUntilMs).toBe(first.holdUntilMs);

  const decayedAfterHold = calculateNextFixturePeakHold({
    body: 0.39,
    deltaSeconds: 0.5,
    elapsedMs: 2_800,
    holdUntilMs: first.holdUntilMs,
    previousPeak: smallerTransientDuringHold.peakHold,
    raw: 0.42,
  });
  expect(decayedAfterHold.peakHold).toBeLessThan(smallerTransientDuringHold.peakHold);
  expect(decayedAfterHold.peakHold).toBeGreaterThanOrEqual(0.39);
});

test("keeps audio command palette registration stable during metering ticks", async () => {
  const transport = createFixtureTransport({ ...fixtureMap["audio-populated"], audioMeteringActive: true });
  const baseline = (await transport.request("audio.snapshot")) as AudioSnapshot;
  const meteringTick = cloneValue(baseline);
  meteringTick.channels = meteringTick.channels.map((channel, index) => ({
    ...channel,
    meterLeft: Math.min(0.98, channel.meterLeft + 0.03 + index * 0.001),
    meterLevel: Math.min(0.98, channel.meterLevel + 0.02),
    meterRight: Math.min(0.98, channel.meterRight + 0.025 + index * 0.001),
    peakHold: Math.min(1, channel.peakHold + 0.04),
    peakHoldLeft: Math.min(1, channel.peakHoldLeft + 0.04),
    peakHoldRight: Math.min(1, channel.peakHoldRight + 0.04),
  }));
  meteringTick.mixTargets = meteringTick.mixTargets.map((mixTarget) => ({
    ...mixTarget,
    meterLeft: Math.min(0.98, mixTarget.meterLeft + 0.02),
    meterLevel: Math.min(0.98, mixTarget.meterLevel + 0.02),
    meterRight: Math.min(0.98, mixTarget.meterRight + 0.02),
    peakHold: Math.min(1, mixTarget.peakHold + 0.04),
    peakHoldLeft: Math.min(1, mixTarget.peakHoldLeft + 0.04),
    peakHoldRight: Math.min(1, mixTarget.peakHoldRight + 0.04),
  }));

  expect(audioPaletteSignatureForSnapshot(meteringTick)).toBe(audioPaletteSignatureForSnapshot(baseline));

  const muteChange = cloneValue(baseline);
  muteChange.channels = muteChange.channels.map((channel) =>
    channel.id === "audio-input-9" ? { ...channel, mute: !channel.mute } : channel
  );
  expect(audioPaletteSignatureForSnapshot(muteChange)).not.toBe(audioPaletteSignatureForSnapshot(baseline));
  await transport.dispose();
});

test("fixture simulated output submix uses TotalMix fader gain curve", async () => {
  const seedTransport = createFixtureTransport({ ...fixtureMap["audio-populated"], audioMeteringActive: false });
  const seedSnapshot = (await seedTransport.request("audio.snapshot")) as AudioSnapshot;
  await seedTransport.dispose();

  async function readSingleSourceSubmix(sendLevel: number) {
    const scenario = {
      ...fixtureMap["audio-populated"],
      audioMeteringActive: false,
      audioSnapshot: {
        ...(fixtureMap["audio-populated"].audioSnapshot ?? {}),
        channels: seedSnapshot.channels.map((channel) => ({
          ...channel,
          fader: channel.id === "audio-input-9" ? sendLevel : 0,
          mixLevels: {
            ...channel.mixLevels,
            "audio-mix-main": channel.id === "audio-input-9" ? sendLevel : 0,
          },
          mute: false,
          solo: false,
        })),
        mixTargets: seedSnapshot.mixTargets.map((mixTarget) => ({
          ...mixTarget,
          dim: false,
          mono: false,
          mute: false,
          volume: mixTarget.id === "audio-mix-main" ? 0.8 : mixTarget.volume,
        })),
        selectedChannelId: "audio-input-9",
        selectedMixTargetId: "audio-mix-main",
      },
    };
    const transport = createFixtureTransport(scenario);
    const snapshot = (await transport.request("audio.snapshot")) as AudioSnapshot;
    await transport.dispose();
    return {
      host: snapshot.channels.find((channel) => channel.id === "audio-input-9")!,
      main: snapshot.mixTargets.find((mixTarget) => mixTarget.id === "audio-mix-main")!,
    };
  }

  const unity = await readSingleSourceSubmix(0.8);
  expect(unity.main.meterLevel).toBeCloseTo(unity.host.meterLevel, 4);

  const minusTen = await readSingleSourceSubmix(0.7);
  expect(minusTen.main.meterLevel / minusTen.host.meterLevel).toBeCloseTo(10 ** (-10 / 20), 4);
});

test("supports audio warning-band sync and keyboard mix-target changes", async ({ page }) => {
  await openFixture(page, "audio-state-assumed");

  const warningBand = page.getByTestId("audio-warning-band");
  await expect(warningBand).not.toContainText("Esc clear");
  await expect(warningBand.getByRole("button", { name: "Sync now" })).toBeEnabled();
  await expect(warningBand.getByRole("button", { name: "Setup" })).toBeEnabled();
  await warningBand.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("audio-warning-band")).toHaveCount(0);

  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("audio-strip-audio-playback-5-6")).toHaveAttribute("data-selected", "true");
  await expect(page.getByTestId("audio-signal-canvas").getByRole("button", { name: "Master" })).toHaveCount(0);

  await openFixture(page, "audio-osc-disabled");
  const disabledWarningBand = page.getByTestId("audio-warning-band");
  await expect(disabledWarningBand.getByRole("button", { name: "Sync now" })).toBeDisabled();
  await expect(page.getByTestId("audio-rail-tools").getByRole("button", { name: "Sync" })).toBeDisabled();
});

test("supports audio group filtering and source/output selection flow", async ({ page }) => {
  test.slow();
  await openFixture(page, "audio-populated");

  await page.getByTestId("audio-tier-chip-inputs-talent").click();
  await expect(page.getByTestId("audio-tier-chip-inputs-talent")).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("audio-strip-audio-input-9")).toBeVisible();
  await expect(page.getByTestId("audio-strip-audio-playback-3-4")).toBeVisible();

  await page.getByTestId("audio-tier-chip-inputs-talent").click();
  await expect(page.getByTestId("audio-tier-chip-inputs-talent")).toHaveAttribute("data-active", "false");
  await expect(page.getByTestId("audio-strip-audio-input-9")).toBeVisible();

  await expect(page.getByTestId("audio-tier-chip-inputs-line")).toHaveCount(0);
  await expect(page.getByTestId("audio-tier-chip-inputs-remote")).toHaveCount(0);

  await page.getByTestId("audio-tier-chip-playback-fx").click();
  await expect(page.getByTestId("audio-tier-chip-playback-fx")).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("audio-strip-audio-playback-3-4")).toBeVisible();
  await expect(page.getByTestId("audio-strip-audio-playback-1-2")).toHaveCount(0);
  await page.getByTestId("audio-tier-chip-playback-bed").click({ modifiers: ["Shift"] });
  await expect(page.getByTestId("audio-tier-chip-playback-fx")).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("audio-tier-chip-playback-bed")).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("audio-strip-audio-playback-1-2")).toBeVisible();

  await page.getByTestId("audio-strip-audio-input-9").click();
  await expect(page.getByTestId("audio-strip-audio-input-9")).toHaveAttribute("data-selected", "true");
  await page.getByTestId("audio-tier-label-hardware-inputs").click();
  await expect(page.getByTestId("audio-strip-audio-input-9")).toHaveAttribute("data-selected", "false");
  await page.getByTestId("audio-strip-audio-input-9").click();
  await page.getByTestId("audio-strip-audio-input-9").click();
  await expect(page.getByTestId("audio-strip-audio-input-9")).toHaveAttribute("data-selected", "true");
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });

  for (let index = 0; index < 30; index += 1) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(20);
  }
  await expect(page.getByTestId("audio-output-audio-mix-phones-b")).toHaveAttribute("data-selected", "true");
  await expect(page.getByTestId("audio-strip-audio-input-9")).toHaveAttribute("data-selected", "false");

  await page.getByTestId("audio-tier-chip-inputs-talent").click();
  await page.getByTestId("audio-tier-chip-playback-fx").click();
  await page.getByTestId("audio-strip-audio-playback-3-4").click();
  await expect(page.getByTestId("audio-inspector-channel")).toContainText("FX 3/4");
  await page.getByTestId("audio-output-audio-mix-phones-a").click();
  await expect(page.getByTestId("audio-mix-target-audio-mix-phones-a")).toHaveAttribute("data-selected", "true");
  await expect(page.getByRole("tab", { name: "Output", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "EQ", exact: true })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Dynamics", exact: true })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Sends", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("audio-inspector-output-panel")).toContainText("Phones 1");
  await expect(page.getByTestId("audio-inspector-output")).toContainText("Level L / R");
  await expect(page.getByTestId("audio-inspector-output")).toContainText("Peak hold");
  await expect(page.getByTestId("audio-inspector-output-level-readout")).toHaveAttribute(
    "data-meter-readout-mode",
    "level"
  );
  await expect(page.getByTestId("audio-inspector-output-peak-hold-readout")).toHaveAttribute(
    "data-meter-readout-mode",
    "peakHold"
  );
  await expect(page.getByTestId("audio-inspector-eq-mini")).toHaveCount(0);
  await expect(page.getByTestId("audio-inspector-dynamics-mini")).toHaveCount(0);
  await expect(page.getByTestId("audio-inspector-output-panel")).toContainText("Output processing");

  await page.getByTestId("audio-tier-lanes-hardware-inputs").dispatchEvent("click");
  await expect(page.getByTestId("audio-inspector-output")).toContainText("Phones 1");
});

test("aligns audio input hardware controls with UFX III preamps", async ({ page }) => {
  await openFixture(page, "audio-populated");

  await page.getByTestId("audio-strip-audio-input-9").click();
  const strip = page.getByTestId("audio-strip-audio-input-9");
  const inspector = page.getByTestId("audio-inspector-hardware-mini");

  await expect(strip.getByRole("button", { name: "48V" })).toHaveCount(0);
  await expect(strip.getByRole("button", { name: "Hi-Z" })).toHaveCount(0);
  await expect(strip.getByRole("button", { name: "Polarity" })).toHaveCount(0);
  await expect(strip.getByRole("button", { name: "AutoSet" })).toHaveCount(0);
  await expect(strip.getByRole("button", { name: "Pad" })).toHaveCount(0);

  await expect(inspector).toContainText("Hardware");
  await expect(inspector).toContainText("48V");
  await expect(inspector).toContainText("Hi-Z");
  await expect(inspector).toContainText("Polarity");
  await expect(inspector).toContainText("AutoSet");
  await expect(inspector).not.toContainText("Pad");

  const phantom = inspector.getByRole("button", { name: /48V/ });
  const phantomBefore = await phantom.getAttribute("data-active");
  await phantom.click();
  await expect(phantom).toHaveAttribute("data-armed", "true");
  await expect(phantom).toHaveText(/Confirm 48V|Confirm Off/);
  await expect(phantom).toHaveAttribute("data-active", phantomBefore ?? "");
  await page.keyboard.press("Escape");
  await expect(phantom).not.toHaveAttribute("data-armed", "true");
  await expect(phantom).toHaveText("48V");
  await phantom.click();
  await phantom.click();
  await expect(phantom).not.toHaveAttribute("data-active", phantomBefore ?? "");

  const autoSet = inspector.getByRole("button", { name: "AutoSet" });
  await expect(autoSet).toBeEnabled();
  await autoSet.click();
  await expect(autoSet).toHaveAttribute("data-active", "true");
});

test("supports audio solo chip and clip clearing", async ({ page }) => {
  await openFixture(page, "audio-populated");

  await expect(page.getByTestId("audio-solo-warning-band")).toBeVisible();
  await page.getByTestId("audio-solo-warning-band").getByRole("button", { name: /×/ }).click();
  await expect(page.getByTestId("audio-solo-warning-band")).toHaveCount(0);

  await openFixture(page, "audio-clipped");
  await expect(page.getByTestId("audio-clip-warning-band")).toBeVisible();
  await expect(page.getByTestId("audio-clear-clips")).toBeEnabled();
  await page.getByTestId("audio-clear-clips").click();
  await expect(page.getByTestId("audio-clip-warning-band")).toHaveCount(0);
});

test("fixture audio solo clear-all command clears all soloed channels in one command", async () => {
  const transport = createFixtureTransport({ ...fixtureMap["audio-populated"], audioMeteringActive: false });
  const result = (await transport.request("audio.solo.clearAll")) as AudioSnapshot;
  expect(result.channels.filter((channel) => channel.solo)).toEqual([]);

  const idempotentResult = (await transport.request("audio.solo.clearAll")) as AudioSnapshot;
  expect(idempotentResult.channels.filter((channel) => channel.solo)).toEqual([]);
  await transport.dispose();
});

test("supports operator peak-hold control for live audio meters", async ({ page }) => {
  await openFixture(page, "audio-populated");
  await page.getByTestId("audio-strip-audio-input-9").click();

  const meterCanvas = page.getByTestId("audio-meter-canvas");
  const peakHoldToggle = page.getByTestId("audio-peak-hold-toggle");
  const levelReadout = page.getByTestId("audio-inspector-level-readout");
  const peakHoldReadout = page.getByTestId("audio-inspector-peak-hold-readout");

  await expect(peakHoldToggle).toHaveAttribute("data-active", "true");
  await expect(meterCanvas).toHaveAttribute("data-meter-peak-hold-enabled", "true");
  await expect(peakHoldReadout).toHaveAttribute("data-meter-peak-hold-enabled", "true");

  await peakHoldToggle.click();
  await expect(peakHoldToggle).toHaveAttribute("data-active", "false");
  await expect(meterCanvas).toHaveAttribute("data-meter-peak-hold-enabled", "false");
  await expect(peakHoldReadout).toHaveAttribute("data-meter-peak-hold-enabled", "false");
  await expect
    .poll(async () => {
      const levelText = (await levelReadout.textContent())?.trim() ?? "";
      const peakHoldText = (await peakHoldReadout.textContent())?.trim() ?? "";
      return peakHoldText === levelText;
    })
    .toBe(true);

  const resetTokenBefore = Number((await meterCanvas.getAttribute("data-meter-peak-hold-reset-token")) ?? "0");
  const inspectorResetTokenBefore = Number(
    (await peakHoldReadout.getAttribute("data-meter-peak-hold-reset-token")) ?? "0"
  );
  await page.getByTestId("audio-peak-hold-reset").click();
  await expect
    .poll(async () => Number((await meterCanvas.getAttribute("data-meter-peak-hold-reset-token")) ?? "0"))
    .toBeGreaterThan(resetTokenBefore);
  await expect
    .poll(async () => Number((await peakHoldReadout.getAttribute("data-meter-peak-hold-reset-token")) ?? "0"))
    .toBeGreaterThan(inspectorResetTokenBefore);
});

test("honors reduced motion on audio snapshot pulse and hover transitions", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openFixture(page, "audio-populated");

  const recalledTile = page.getByTestId("audio-snapshot-snapshot-interview-block");
  await recalledTile.evaluate((node) => node.setAttribute("data-flash", "true"));
  const animationMs = await recalledTile.evaluate((node) => {
    const duration = getComputedStyle(node).animationDuration;
    return duration.endsWith("ms") ? Number.parseFloat(duration) : Number.parseFloat(duration) * 1000;
  });
  expect(animationMs).toBeLessThanOrEqual(1);
  const actions = page.getByTestId("audio-snapshot-actions-snapshot-interview-block");
  const transitionMs = await actions.evaluate((node) => {
    const duration = getComputedStyle(node).transitionDuration;
    return duration.endsWith("ms") ? Number.parseFloat(duration) : Number.parseFloat(duration) * 1000;
  });
  expect(transitionMs).toBeLessThanOrEqual(1);
});

test("supports audio snapshot capture save rename and delete", async ({ page }) => {
  test.slow();
  await page.addInitScript(() => {
    window.__SSE_TEST_NATIVE_DIALOG_COUNTS__ = { confirm: 0, prompt: 0 };
    window.prompt = () => {
      window.__SSE_TEST_NATIVE_DIALOG_COUNTS__!.prompt += 1;
      return null;
    };
    window.confirm = () => {
      window.__SSE_TEST_NATIVE_DIALOG_COUNTS__!.confirm += 1;
      return false;
    };
  });
  await openFixture(page, "audio-populated");

  const currentSnapshot = page.getByTestId("audio-snapshot-snapshot-show-open");
  await saveAudioSnapshot(page, "snapshot-show-open");
  await expect(currentSnapshot.getByTestId("audio-snapshot-thumb-snapshot-show-open")).toHaveAttribute(
    "data-has-contents",
    "true"
  );
  const savedThumbBefore = await readSnapshotThumbHeights(page, "snapshot-show-open");

  await expect(page.getByTestId("audio-snapshot-capture")).toBeEnabled();
  await page.getByTestId("audio-snapshot-capture").click();
  const capturedSlot = page.locator('[data-snapshot-slot="6"][data-slot-state="populated"]');
  await expect(capturedSlot).toContainText("Snapshot 6");
  await capturedSlot.hover();
  await expect(capturedSlot.getByText("No diff from current mix")).toBeVisible();

  await page.getByRole("slider", { name: "FX 3/4 send level" }).focus();
  await page.keyboard.press("Enter");
  const faderDialog = page.getByRole("dialog", { name: /Set FX 3\/4 send level/i });
  await expect(faderDialog).toBeVisible();
  await faderDialog.getByLabel("Fader level").fill("-60");
  await faderDialog.getByRole("button", { name: "Set" }).click();
  await expect(page.getByTestId("audio-strip-audio-playback-3-4")).toHaveAttribute("data-no-send", "true");
  await currentSnapshot.hover();
  await expect(currentSnapshot.getByText("FX 3/4")).toBeVisible();
  await expect(currentSnapshot.getByText(/-∞ dB -> [+-]?\d+\.\d dB|[+-]?\d+\.\d dB -> [+-]?\d+\.\d dB/)).toBeVisible();

  await saveAudioSnapshot(page, "snapshot-show-open");
  await expect
    .poll(async () => readSnapshotThumbHeights(page, "snapshot-show-open"), {
      message: "saved snapshot thumbnail should reflect the changed mix",
    })
    .not.toEqual(savedThumbBefore);
  await page.mouse.move(1, 1);
  const snapshotActions = currentSnapshot.getByTestId("audio-snapshot-actions-snapshot-show-open");
  await expect(snapshotActions).toBeVisible();
  await currentSnapshot.hover();
  await expect(currentSnapshot.getByText("18 sources saved")).toBeVisible();
  const recallSurface = currentSnapshot.locator("button").first();
  await recallSurface.focus();
  const recallBox = await recallSurface.boundingBox();
  expect(recallBox?.width ?? 0).toBeGreaterThan(40);
  expect(recallBox?.height ?? 0).toBeGreaterThan(40);
  expect(await recallSurface.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe("none");
  await recallSurface.click();
  await expect(currentSnapshot).toHaveAttribute("data-armed", "true");
  await expect(recallSurface).toHaveAttribute("data-armed", "true");
  await page.keyboard.press("Escape");
  await expect(recallSurface).not.toHaveAttribute("data-armed", "true");

  await capturedSlot.hover();
  await capturedSlot.getByRole("button", { name: /Rename/ }).click();
  const renameSnapshotDialog = page.getByRole("dialog", { name: "Rename Audio Snapshot" });
  await expect(renameSnapshotDialog).toBeVisible();
  await renameSnapshotDialog.getByLabel("Snapshot name").fill("Renamed snapshot");
  await renameSnapshotDialog.getByRole("button", { name: "Rename" }).click();
  await expect(capturedSlot).toContainText("Renamed snapshot");

  await capturedSlot.hover();
  await capturedSlot.getByRole("button", { name: /Delete/ }).click();
  const deleteSnapshotDialog = page.getByRole("dialog", { name: "Delete Audio Snapshot" });
  await expect(deleteSnapshotDialog).toBeVisible();
  await deleteSnapshotDialog.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByTestId("audio-snapshot-empty-6")).toContainText("Empty");
  await expect
    .poll(() => page.evaluate(() => window.__SSE_TEST_NATIVE_DIALOG_COUNTS__))
    .toEqual({
      confirm: 0,
      prompt: 0,
    });
});

test("audio-no-send fixture marks FX playback as not feeding main", async ({ page }) => {
  await openFixture(page, "audio-no-send");

  await expect(page.getByTestId("audio-mix-target-audio-mix-main")).toHaveAttribute("data-selected", "true");
  await expect(page.getByTestId("audio-strip-audio-playback-3-4")).toHaveAttribute("data-no-send", "true");
  await expect(page.getByTestId("audio-routing-overlay")).toHaveCount(0);
});

test("shows numeric snapshot before and after preview text", async ({ page }) => {
  await openFixture(page, "audio-populated");

  const currentSnapshot = page.getByTestId("audio-snapshot-snapshot-show-open");
  await saveAudioSnapshot(page, "snapshot-show-open");

  await page.getByRole("slider", { name: "FX 3/4 send level" }).focus();
  await page.keyboard.press("Enter");
  const faderDialog = page.getByRole("dialog", { name: /Set FX 3\/4 send level/i });
  await expect(faderDialog).toBeVisible();
  await faderDialog.getByLabel("Fader level").fill("-60");
  await faderDialog.getByRole("button", { name: "Set" }).click();

  await currentSnapshot.hover();
  await expect(currentSnapshot.getByText("FX 3/4")).toBeVisible();
  await expect(currentSnapshot.getByText(/-∞ dB -> [+-]?\d+\.\d dB|[+-]?\d+\.\d dB -> [+-]?\d+\.\d dB/)).toBeVisible();
});

test("supports engine-backed audio EQ editing", async ({ page }) => {
  test.slow();
  await page.addInitScript(() => {
    window.__SSE_TEST_ENGINE_REQUEST_COUNTS__ = {};
  });
  await openFixture(page, "audio-populated");

  await page.getByTestId("audio-strip-audio-input-9").click();
  await page.getByRole("tab", { name: "EQ" }).click();
  await expect(page.getByTestId("audio-eq-range")).toContainText("20 Hz");
  await expect(page.getByTestId("audio-eq-range")).toContainText("20 kHz");
  await expect(page.getByTestId("audio-eq-range")).toContainText("±20 dB");
  await expect(page.getByTestId("audio-eq-db-scale")).toContainText("+20 dB");
  await expect(page.getByTestId("audio-eq-db-scale")).toContainText("0 dB");
  await expect(page.getByTestId("audio-eq-db-scale")).toContainText("-20 dB");
  await expect(page.getByTestId("audio-eq-frequency-markers")).toContainText("20 Hz");
  await expect(page.getByTestId("audio-eq-frequency-markers")).toContainText("20 kHz");
  await expect(page.getByTestId("audio-eq-point-low-cut")).toBeVisible();
  await expect(page.getByTestId("audio-eq-point-1")).toBeVisible();
  await expect(page.getByTestId("audio-eq-point-2")).toBeVisible();
  await expect(page.getByTestId("audio-eq-point-3")).toBeVisible();
  await expect(page.getByTestId("audio-eq-low-cut-shade")).toHaveCount(0);
  await expect(page.getByTestId("audio-eq-point-low-cut")).toHaveAttribute("data-active", "false");
  const eqGraphBox = await page.getByTestId("audio-eq-graph").boundingBox();
  const lowCutPointBox = await page.getByTestId("audio-eq-point-low-cut").boundingBox();
  expect(eqGraphBox, "EQ graph should be measurable").not.toBeNull();
  expect(lowCutPointBox, "Low Cut point should be measurable").not.toBeNull();
  expect(
    Math.abs(lowCutPointBox!.y + lowCutPointBox!.height / 2 - (eqGraphBox!.y + eqGraphBox!.height / 2)),
    "disabled Low Cut point should sit on the 0 dB line"
  ).toBeLessThanOrEqual(3);

  const eqPanel = page.getByTestId("audio-inspector-eq");
  await eqPanel.getByRole("button", { name: "LC", exact: true }).click();
  await expect(page.getByTestId("audio-eq-control-tray")).toContainText("Low Cut");
  const lowCutEnable = page.getByRole("button", { name: "Enable Low Cut" });
  await expect(lowCutEnable).toBeVisible();
  for (const slope of ["6", "12", "18", "24"]) {
    await expect(eqPanel.getByRole("button", { name: slope, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("slider", { name: "Host Low Cut frequency" })).toHaveAttribute("aria-valuemin", "20");
  await expect(page.getByRole("slider", { name: "Host Low Cut frequency" })).toHaveAttribute("aria-valuemax", "500");
  await expect(page.getByRole("slider", { name: /Host Low Cut EQ gain/ })).toHaveCount(0);
  await expect(page.getByRole("slider", { name: /Host Low Cut EQ Q/ })).toHaveCount(0);
  await lowCutEnable.click();
  await expect(page.getByRole("button", { name: "Bypass Low Cut" })).toBeVisible();
  await expect(page.getByTestId("audio-eq-point-low-cut")).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("audio-eq-low-cut-shade")).toHaveCount(1);
  await expectSliderValueChanges(page, "Host Low Cut frequency");

  await eqPanel.getByRole("button", { name: "2", exact: true }).click();
  await expect(page.getByTestId("audio-eq-control-tray")).toContainText("Band 2");
  await expect(page.getByRole("button", { name: "Enable PEQ" })).toBeVisible();
  await expect(eqPanel.getByRole("button", { name: "Bell", exact: true })).toBeDisabled();
  await expect(eqPanel.getByRole("button", { name: "Low Shelf", exact: true })).toHaveCount(0);
  await expect(page.getByRole("slider", { name: /Host .* EQ frequency/ })).toHaveCount(1);
  await expect(page.getByRole("slider", { name: /Host .* EQ Q/ })).toHaveCount(1);
  await expect(page.getByRole("slider", { name: /Host .* EQ gain/ })).toHaveCount(1);
  await expect(page.getByRole("slider", { name: "Host Band 2 EQ frequency" })).toHaveAttribute("aria-valuemin", "20");
  await expect(page.getByRole("slider", { name: "Host Band 2 EQ frequency" })).toHaveAttribute(
    "aria-valuemax",
    "20000"
  );
  await expect(page.getByRole("slider", { name: "Host Band 2 EQ gain" })).toHaveAttribute("aria-valuemin", "-20");
  await expect(page.getByRole("slider", { name: "Host Band 2 EQ gain" })).toHaveAttribute("aria-valuemax", "20");
  await expect(page.getByRole("slider", { name: "Host Band 2 EQ Q" })).toHaveAttribute("aria-valuemin", "0.4");
  await expect(page.getByRole("slider", { name: "Host Band 2 EQ Q" })).toHaveAttribute("aria-valuemax", "9.9");
  await expectSliderValueChanges(page, "Host Band 2 EQ Q");

  const bandTwoFrequency = page.getByRole("slider", { name: "Host Band 2 EQ frequency" });
  const bandTwoGain = page.getByRole("slider", { name: "Host Band 2 EQ gain" });
  const bandTwoFrequencyBefore = await bandTwoFrequency.getAttribute("aria-valuenow");
  const bandTwoGainBefore = await bandTwoGain.getAttribute("aria-valuenow");
  const bandTwoPoint = page.getByTestId("audio-eq-point-2");
  await expect(bandTwoPoint).toHaveAttribute("data-selected", "true");
  await page.waitForTimeout(180);
  await page.evaluate(() => {
    window.__SSE_TEST_ENGINE_REQUEST_COUNTS__ = {};
  });
  const bandTwoPointBox = await bandTwoPoint.boundingBox();
  expect(bandTwoPointBox, "Band 2 EQ point should be draggable").not.toBeNull();
  await page.mouse.move(
    bandTwoPointBox!.x + bandTwoPointBox!.width / 2,
    bandTwoPointBox!.y + bandTwoPointBox!.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    bandTwoPointBox!.x + bandTwoPointBox!.width / 2 + 60,
    bandTwoPointBox!.y + bandTwoPointBox!.height / 2 - 18,
    { steps: 20 }
  );
  await page.mouse.up();
  await expect(bandTwoPoint).toHaveAttribute("data-selected", "true");
  await expect(bandTwoFrequency).not.toHaveAttribute("aria-valuenow", bandTwoFrequencyBefore ?? "");
  await expect(bandTwoGain).not.toHaveAttribute("aria-valuenow", bandTwoGainBefore ?? "");
  const graphDragCountsAfter = await page.evaluate(() => ({ ...window.__SSE_TEST_ENGINE_REQUEST_COUNTS__ }));
  expect(graphDragCountsAfter["audio.channel.eq.update"] ?? 0).toBeLessThanOrEqual(3);
});

test("supports engine-backed audio dynamics editing", async ({ page }) => {
  test.slow();
  await openFixture(page, "audio-populated");

  await page.getByTestId("audio-strip-audio-input-9").click();
  await page.getByRole("tab", { name: "Dynamics" }).click();
  await expect(page.getByTestId("audio-dynamics-range")).toContainText("Comp");
  await expect(page.getByTestId("audio-dynamics-curve")).toHaveAttribute("data-active", "false");
  const comp = page.getByTestId("audio-inspector-dynamics").getByRole("button", { name: "Comp" });
  await expect(comp).toHaveAttribute("data-active", "false");
  await comp.click();
  await expect(comp).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("audio-dynamics-curve")).toHaveAttribute("data-active", "true");

  await expectSliderValueChanges(page, "Host compressor threshold");
  await expectSliderValueChanges(page, "Host compressor ratio");
  await expectSliderValueChanges(page, "Host compressor attack");
  await expectSliderValueChanges(page, "Host compressor release");
  await expectSliderValueChanges(page, "Host compressor makeup");

  const gate = page.getByTestId("audio-inspector-dynamics").getByRole("button", { name: "Gate" });
  await expect(gate).toHaveAttribute("data-active", "false");
  await gate.click();
  await expect(gate).toHaveAttribute("data-active", "true");
  await expectSliderValueChanges(page, "Host gate threshold");
  await expectSliderValueChanges(page, "Host gate ratio");
  await expectSliderValueChanges(page, "Host gate attack");
  await expectSliderValueChanges(page, "Host gate release");
  await expectSliderValueChanges(page, "Host gate makeup");
});

test("supports engine-backed audio send mode controls", async ({ page }) => {
  await openFixture(page, "audio-populated");

  await page.getByTestId("audio-strip-audio-input-9").click();
  await page.getByRole("tab", { name: "Sends" }).click();
  const sends = page.getByTestId("audio-inspector-sends");
  await expect(page.getByTestId("audio-send-destination-audio-mix-main")).toContainText("Main Out");
  await expect(page.getByTestId("audio-send-destination-audio-mix-phones-a")).toContainText("Phones 1");
  await expect(page.getByTestId("audio-send-destination-audio-mix-phones-b")).toContainText("Phones 2");
  const preFader = sends.getByRole("button", { name: "Pre fader" }).first();
  await expect(preFader).toBeEnabled();
  await expect(preFader).toHaveAttribute("data-active", "false");
  await preFader.click();
  await expect(preFader).toHaveAttribute("data-active", "true");
  await expect(preFader).toHaveAttribute("aria-pressed", "true");

  const link = sends.getByRole("button", { name: "Link L+R" }).first();
  await expect(link).toHaveAttribute("data-active", "true");
  await link.click();
  await expect(link).toHaveAttribute("data-active", "false");
  await expect(link).toHaveAttribute("aria-pressed", "false");
});

test("supports audio command palette and shortcut overlay parity", async ({ page }) => {
  await openFixture(page, "audio-populated");

  await page.keyboard.press(modifierShortcut("K"));
  const palette = page.getByRole("dialog", { name: "Command palette" });
  const commandInput = page.getByPlaceholder(/Type a command/i);
  await commandInput.fill("fx");
  await expect(palette.getByText("Results", { exact: true })).toHaveCount(0);
  await expect(palette.getByText("Channels", { exact: true })).toBeVisible();
  await expect(palette.getByText("Actions", { exact: true })).toBeVisible();
  await expect(palette.getByText("Select FX 3/4", { exact: true })).toBeVisible();
  await expect(palette.getByText("Solo FX 3/4", { exact: true })).toBeVisible();
  await expect(palette.getByText("Mute FX 3/4", { exact: true })).toBeVisible();
  await commandInput.fill("main out");
  await expect(palette.getByText("Outputs", { exact: true })).toBeVisible();
  await expect(palette.getByText("Switch active mix to Main Out", { exact: true })).toBeVisible();
  await commandInput.fill("snapshot 1");
  await expect(palette.getByText("Snapshots", { exact: true })).toBeVisible();
  await expect(palette.getByText("Recall snapshot 1", { exact: true })).toBeVisible();
  await commandInput.fill("rename selected audio");
  await expect(page.getByText("Rename selected channel")).toBeVisible();
  await commandInput.fill("toggle selected polarity");
  await expect(page.getByText("Toggle selected polarity")).toBeVisible();
  await commandInput.fill("clear selected channel clip");
  await expect(page.getByText("Clear selected channel clip")).toBeVisible();
  await commandInput.fill("toggle master submix");
  await expect(page.getByText("Toggle Master/Submix view")).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.keyboard.press("Shift+/");
  const shortcuts = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(shortcuts).toBeVisible();
  await shortcuts.getByPlaceholder(/Filter shortcuts/i).fill("audio");
  await expect(shortcuts).not.toContainText("Toggle Audio Master / Submix view");
  await expect(shortcuts).toContainText("Clear held audio clip indicators");
  await expect(shortcuts).toContainText("Arm or apply current audio snapshot save");
  await expect(shortcuts).toContainText("Open strip actions");
});

test("audio command palette snapshot recall arms before applying", async ({ page }) => {
  await openFixture(page, "audio-populated");

  await page.keyboard.press(modifierShortcut("K"));
  await page.getByPlaceholder(/Type a command/i).fill("snapshot 1");
  await page.getByRole("option", { name: /Recall snapshot 1/ }).click();
  await expect(page.locator('[data-snapshot-slot][data-armed="true"]')).toHaveCount(1);

  await page.keyboard.press(modifierShortcut("K"));
  await page.getByPlaceholder(/Type a command/i).fill("snapshot 1");
  await page.getByRole("option", { name: /Recall snapshot 1/ }).click();
  await expect(page.locator('[data-snapshot-slot][data-armed="true"]')).toHaveCount(0);
});

test("formats audio faders with the prototype TotalMix-style law", () => {
  expect(normalizedToFaderDb(0)).toBe(Number.NEGATIVE_INFINITY);
  expect(normalizedToFaderDb(0.7)).toBeCloseTo(-10, 5);
  expect(normalizedToFaderDb(0.8)).toBeCloseTo(0, 5);
  expect(normalizedToFaderDb(1)).toBeCloseTo(6, 5);
  expect(faderDbToNormalized(0)).toBeCloseTo(0.8, 5);
  expect(formatAudioDb(0.8)).toBe("0.0 dB");
  expect(formatAudioDb(1)).toBe("+6.0 dB");
});

test("maps audio meters to the documented dBFS scale", () => {
  expect(normalizedToDbfs(0)).toBe(Number.NEGATIVE_INFINITY);
  expect(normalizedToDbfs(1)).toBeCloseTo(0, 5);
  expect(normalizedToDbfs(0.5)).toBeCloseTo(-6.0206, 4);
  expect(normalizedToDbfs(0.1)).toBeCloseTo(-20, 5);
  expect(formatMeterDb(0.5)).toBe("-6");
  expect(dbfsToMeterPercent(-60)).toBe(0);
  expect(dbfsToMeterPercent(-30)).toBe(50);
  expect(dbfsToMeterPercent(0)).toBe(100);
  expect(meterTone(meterNormalizedForDbfs(-19))).toBe("green");
  expect(meterTone(meterNormalizedForDbfs(-18))).toBe("amber");
  expect(meterTone(meterNormalizedForDbfs(-6))).toBe("hot");
  expect(meterTone(meterNormalizedForDbfs(-3))).toBe("red");
});

test("prefers live-console level fields in compact audio meter entries", () => {
  const entry = audioMeterEntryFromRecord({
    clip: false,
    clipHold: true,
    id: "audio-input-9",
    levelLeftDbfs: -18,
    levelRightDbfs: -24,
    meterLeft: 0.4,
    meterPoint: "input",
    meterPointOver: true,
    meterPointOverLeft: false,
    meterPointOverRight: true,
    meterRight: 0.3,
    over: true,
    overLeft: false,
    overRight: true,
    peakHoldLeft: 0.8,
    peakHoldRight: 0.5,
    peakWarning: true,
    rmsLeftDbfs: -40,
    rmsRightDbfs: -45,
  });

  expect(entry).not.toBeNull();
  expect(entry?.levelLeftDbfs).toBe(-18);
  expect(entry?.levelRightDbfs).toBe(-24);
  expect(entry?.rmsLeftDbfs).toBe(-40);
  expect(entry?.meterPoint).toBe("input");
  expect(entry?.peakWarning).toBe(true);
  expect(entry?.meterPointOver).toBe(true);
  expect(entry?.meterPointOverLeft).toBe(false);
  expect(entry?.meterPointOverRight).toBe(true);
  expect(entry?.over).toBe(true);
  expect(entry?.overLeft).toBe(false);
  expect(entry?.overRight).toBe(true);
  expect(entry?.channelPathClip).toBe(true);
  expect(entry?.clipHold).toBe(true);
});

test("audio workspace custom faders drag and accept numeric dB entry", async ({ page }) => {
  await openFixture(page, "audio-populated");

  await page.keyboard.press(modifierShortcut("K"));
  await page.getByPlaceholder(/Type a command/i).fill("reset selected audio");
  await expect(page.getByText(/Reset selected fader/i)).toBeVisible();
  await page.keyboard.press("Escape");

  const fxFader = page.getByRole("slider", { name: "FX 3/4 send level" });
  await expect(fxFader).toBeVisible();
  await expect(fxFader).toHaveAttribute("aria-orientation", "vertical");
  const beforeValue = await fxFader.getAttribute("aria-valuenow");
  const faderBox = await fxFader.boundingBox();
  expect(faderBox).not.toBeNull();
  await page.mouse.move(faderBox!.x + faderBox!.width / 2, faderBox!.y + faderBox!.height - 4);
  await page.mouse.down();
  await page.mouse.move(faderBox!.x + faderBox!.width / 2, faderBox!.y + 4, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => fxFader.getAttribute("aria-valuenow")).not.toBe(beforeValue);

  await fxFader.focus();
  await page.keyboard.press("Enter");
  let faderDialog = page.getByRole("dialog", { name: /Set FX 3\/4 send level/i });
  await expect(faderDialog).toBeVisible();
  await faderDialog.getByLabel("Fader level").fill("0");
  await faderDialog.getByRole("button", { name: "Set" }).click();
  await expect(page.getByTestId("audio-strip-audio-playback-3-4")).toContainText("0.0dB");

  await fxFader.focus();
  await page.keyboard.press("Enter");
  faderDialog = page.getByRole("dialog", { name: /Set FX 3\/4 send level/i });
  await expect(faderDialog).toBeVisible();
  await faderDialog.getByLabel("Fader level").fill("-60");
  await faderDialog.getByRole("button", { name: "Set" }).click();
  await expect(page.getByTestId("audio-strip-audio-playback-3-4")).toHaveAttribute("data-no-send", "true");

  await page.keyboard.press("KeyU");
  await expect(page.getByTestId("audio-strip-audio-playback-3-4")).toContainText("0.0dB");
});

test("audio preamp gain control responds to pointer drag", async ({ page }) => {
  await openFixture(page, "audio-populated");

  const hostGain = page.getByTestId("audio-strip-audio-input-9").getByRole("slider", { name: "Host preamp gain" });
  await expect(hostGain).toHaveAttribute("aria-orientation", "vertical");
  const beforeGain = await hostGain.getAttribute("aria-valuenow");
  const gainBox = await hostGain.boundingBox();
  expect(gainBox).not.toBeNull();
  await page.mouse.move(gainBox!.x + gainBox!.width / 2, gainBox!.y + gainBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(gainBox!.x + gainBox!.width / 2, gainBox!.y - 32, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => hostGain.getAttribute("aria-valuenow")).not.toBe(beforeGain);

  await hostGain.focus();
  await page.keyboard.press("Enter");
  const gainDialog = page.getByRole("dialog", { name: /Set Host preamp gain/i });
  await expect(gainDialog).toBeVisible();
  await gainDialog.getByLabel("Preamp gain").fill("12");
  await gainDialog.getByRole("button", { name: "Set" }).click();
  await expect(hostGain).toHaveAttribute("aria-valuenow", "12");
});

test("renders audio scaled studio preview as the 2560 studio surface", async ({ page }) => {
  const readAudioLayoutDetails = async () =>
    page.evaluate(() => {
      const root = document.querySelector("[data-operator-layout-root]");
      const tieredMixer = document.querySelector('[data-testid="audio-tiered-mixer"]');
      const hostLane = document.querySelector('[data-testid="audio-strip-audio-input-9"]');
      const canvasBarLabel = document.querySelector("[class*=canvasBarLabel]");
      const canvasSelectedMeta = document.querySelector("[class*=canvasSelectedMeta]");
      return {
        canvasBarLabelDisplay: canvasBarLabel ? getComputedStyle(canvasBarLabel).display : null,
        canvasSelectedMetaDisplay: canvasSelectedMeta ? getComputedStyle(canvasSelectedMeta).display : null,
        hostLaneColumns: hostLane ? getComputedStyle(hostLane).gridTemplateColumns : null,
        hostLaneRows: hostLane ? getComputedStyle(hostLane).gridTemplateRows : null,
        root: root
          ? {
              layoutHeight: root.getAttribute("data-layout-height"),
              layoutMode: root.getAttribute("data-layout-mode"),
              layoutWidth: root.getAttribute("data-layout-width"),
              reviewSurface: root.getAttribute("data-review-surface"),
            }
          : null,
        tierRows: tieredMixer ? getComputedStyle(tieredMixer).gridTemplateRows : null,
      };
    });

  await page.setViewportSize({ width: 2560, height: 1440 });
  await openFixture(page, "audio-populated");
  const nativeHostGain = page
    .getByTestId("audio-strip-audio-input-9")
    .getByRole("slider", { name: "Host preamp gain" });
  await expect(page.getByTestId("audio-tiered-mixer")).toBeVisible();
  await expect(nativeHostGain).toBeVisible();
  const nativeDetails = await readAudioLayoutDetails();
  await expectAspectRatio(nativeHostGain, COMPACT_PREAMP_ASPECT_RATIO, "native 2560 compact preamp");
  await expectDbfsScaleLabelsInsideMeters(page, "native 2560 studio surface");

  await page.setViewportSize({ width: 1512, height: 982 });
  await openFixture(page, "audio-populated", { operatorReview: "studio" });
  await expect(page.getByTestId("audio-tiered-mixer")).toBeVisible();
  const previewDetails = await readAudioLayoutDetails();
  expect(previewDetails.root).toMatchObject({
    layoutHeight: "1440",
    layoutMode: "studioFull",
    layoutWidth: "2560",
    reviewSurface: "studioPreview",
  });
  expect(previewDetails.tierRows).toBe(nativeDetails.tierRows);
  expect(previewDetails.hostLaneColumns).toBe(nativeDetails.hostLaneColumns);
  expect(previewDetails.hostLaneRows).toBe(nativeDetails.hostLaneRows);
  expect(previewDetails.canvasBarLabelDisplay).toBe(nativeDetails.canvasBarLabelDisplay);
  expect(previewDetails.canvasSelectedMetaDisplay).toBe(nativeDetails.canvasSelectedMetaDisplay);
  const previewRouteMeta = page.locator("[class*=canvasSelectedMeta]").first();
  await expect(previewRouteMeta).toContainText(/routed to main out/i);
  await expectNoElementOverflow(previewRouteMeta, "studio preview selected-source route");
  await expectAudioLaneCardsInsideTierGrids(page);

  const previewHostGain = page
    .getByTestId("audio-strip-audio-input-9")
    .getByRole("slider", { name: "Host preamp gain" });
  await expectAspectRatio(previewHostGain, COMPACT_PREAMP_ASPECT_RATIO, "studio preview compact preamp");

  await page.getByTestId("audio-strip-audio-input-9").click();
  await expectAudioStudioSideRailsFilled(page);
  await expectAudioOverviewProcessingStack(page, "scaled studio preview selected-channel", 82);
  await expectDbfsScaleLabelsInsideMeters(page, "scaled studio preview selected-channel");
  await expectAspectRatio(
    page.getByTestId("audio-inspector-hardware-mini").getByRole("slider", { name: "Host preamp gain" }),
    NARROW_PREAMP_ASPECT_RATIO,
    "studio preview inspector narrow preamp"
  );
  await expectSnapshotActionsDoNotOverlapContent(page, "snapshot-show-open");
});

test("keeps the full audio workspace visible at the 1920x1080 fallback size", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openFixture(page, "audio-1920-fallback");

  const workspace = page.getByTestId("audio-workspace");
  await expect(workspace).toBeVisible();
  await expect(page.getByTestId("audio-signal-canvas")).toBeVisible();
  await expect(page.getByTestId("audio-tiered-mixer")).toBeVisible();
  await expect(page.getByTestId("audio-hardware-inputs-tier")).toBeVisible();
  await expect(page.getByTestId("audio-software-playback-tier")).toBeVisible();
  await expect(page.getByTestId("audio-hardware-outputs-tier")).toBeVisible();
  await expect(page.getByTestId("audio-health-bar")).toBeVisible();
  await expect(workspace.getByText("Snapshots")).toBeVisible();
  await expect(page.getByTestId("audio-signal-canvas").getByRole("button", { name: "Touch" })).toHaveCount(0);
  await expect(page.getByTestId("audio-strip-audio-playback-3-4")).toBeVisible();

  await expectAudioWorkspaceGeometry(page);
  await expectAudioLaneCardsInsideTierGrids(page);
  await expectDbfsScaleLabelsInsideMeters(page, "1920 fallback");
  await expectAspectRatio(
    page.getByTestId("audio-strip-audio-input-9").getByRole("slider", { name: "Host preamp gain" }),
    COMPACT_PREAMP_ASPECT_RATIO,
    "1920 fallback compact preamp"
  );
  await page.getByTestId("audio-strip-audio-input-9").click();
  await expect(page.getByTestId("audio-rail-trust-panel")).toBeVisible();
  await expect(page.getByTestId("audio-rail-snapshot-panel")).toBeVisible();
  await expect(page.getByTestId("audio-inspector-eq-mini")).toBeVisible();
  await expect(page.getByTestId("audio-inspector-dynamics-mini")).toBeVisible();
  await expect(page.getByTestId("audio-inspector-sends-mini")).toBeVisible();
  await expectAudioStudioSideRailsFilled(page, 32);
  await expectAudioOverviewProcessingStack(page, "1920 fallback selected-channel", 40);
  await expectSnapshotActionsDoNotOverlapContent(page, "snapshot-show-open");
  await expectAudioInspectorPanelsFit(page);

  await page.getByTestId("audio-output-audio-mix-phones-a").click();
  await expect(page.getByRole("tab", { name: "Output", exact: true })).toHaveAttribute("aria-selected", "true");
  await expectDbfsScaleLabelsInsideMeters(page, "1920 fallback output inspector");
  await expect(page.getByRole("tab", { name: "EQ", exact: true })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Dynamics", exact: true })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Sends", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("audio-inspector-eq-mini")).toHaveCount(0);
  await expect(page.getByTestId("audio-inspector-dynamics-mini")).toHaveCount(0);
  await expect(page.getByTestId("audio-inspector-sends-mini")).toHaveCount(0);
  const outputFacts = page.locator('[data-fact-size="long"]');
  const outputFactCount = await outputFacts.count();
  expect(outputFactCount, "output long facts should be rendered").toBeGreaterThan(0);
  for (let index = 0; index < outputFactCount; index += 1) {
    await expectNoElementOverflow(outputFacts.nth(index), `1920 output fact ${index + 1}`);
  }
  await expectNoDocumentScroll(page);
});

test("renders the planning timeline from an engine-backed snapshot and toggles board mode", async ({ page }) => {
  await openFixture(page, "planning-populated");

  const workspace = page.getByTestId("planning-workspace");
  await expect(page.getByRole("heading", { name: "Planning timeline" })).toHaveCount(0);
  await expect(workspace.getByRole("tab", { name: "Timeline" })).toHaveAttribute("data-active", "true");
  await expect(workspace.getByText("evening_service")).toBeVisible();
  await expect(workspace.getByRole("button", { name: /Commission Stream Deck\+ · Booth 2/i })).toBeVisible();
  await expect(workspace.getByText("Archive Q3 cue library")).toBeVisible();
  await expect(page.getByTestId("planning-now-playhead")).toBeVisible();
  const boothLaneBounds = await workspace.getByTestId("planning-lane-proj-booth-2").boundingBox();
  expect(boothLaneBounds?.height ?? 0).toBeGreaterThan(80);
  expect(boothLaneBounds?.height ?? 0).toBeLessThan(90);

  await page.keyboard.press("Shift+KeyB");
  await expect(workspace.getByRole("tab", { name: "Board" })).toHaveAttribute("data-active", "true");
  const boardCard = workspace.getByTestId("planning-board-card-proj-booth-2");
  await expect(boardCard).toBeVisible();
  await expect(boardCard).toHaveAttribute("data-running", "true");
  await expect(boardCard).toContainText("booth_2");
  await expect(boardCard).toContainText("P1");
  await expect(boardCard).toContainText("1/2 tasks");
  await expect(boardCard).toContainText("audio");
  await expect(boardCard).toContainText("control-surface");
  await expect(workspace.getByText("No projects in this column.")).toHaveCount(1);
  await expect(workspace.getByText("booth_2")).toBeVisible();
  await page.keyboard.press("Digit4");
  await expect(workspace.getByRole("tab", { name: "Done" })).toHaveAttribute("data-active", "true");
  await expect(workspace.getByTestId("planning-board-empty-done")).toHaveAttribute("data-zero-filter", "true");
  await expect(workspace.getByText("No done tasks.")).toBeVisible();

  await page.keyboard.press("Shift+KeyT");
  await expect(workspace.getByRole("tab", { name: "Timeline" })).toHaveAttribute("data-active", "true");
  await expect(workspace.getByText("Filter: done · 0 of 5")).toBeVisible();
  await workspace.getByRole("button", { name: "Clear" }).click();
  await expect(workspace.getByRole("button", { name: /Level-match overflow/i })).toBeVisible();
});

test("supports retained planning board drag reorder and status moves", async ({ page }) => {
  await openFixture(page, "planning-populated");

  const workspace = page.getByTestId("planning-workspace");
  await page.keyboard.press("Shift+KeyB");

  const inProgressColumn = workspace.getByTestId("planning-board-column-in-progress");
  const blockedColumn = workspace.getByTestId("planning-board-column-blocked");
  const blockedColumnBody = workspace.getByTestId("planning-board-column-body-blocked");
  const boothCard = workspace.getByTestId("planning-board-card-proj-booth-2");
  const lightingCard = workspace.getByTestId("planning-board-card-proj-lighting");

  await boothCard.dragTo(blockedColumnBody);
  await expect(blockedColumn.getByTestId("planning-board-card-proj-booth-2")).toBeVisible();
  await expect(blockedColumn.getByTestId("planning-board-card-proj-booth-2")).toHaveAttribute("data-blocked", "true");
  await expect(inProgressColumn.getByTestId("planning-board-card-proj-booth-2")).toHaveCount(0);

  await blockedColumn.getByTestId("planning-board-card-proj-booth-2").dragTo(lightingCard, {
    targetPosition: { x: 24, y: 12 },
  });
  const blockedCards = blockedColumn.locator('[data-testid^="planning-board-card-"]');
  await expect(blockedCards.nth(0)).toContainText("booth_2");
  await expect(blockedCards.nth(1)).toContainText("lighting");
});

test("supports planning timeline selection, keyboard reschedule, and local day navigation", async ({ page }) => {
  await openFixture(page, "planning-populated");

  const workspace = page.getByTestId("planning-workspace");
  const selectedTask = workspace.getByRole("button", { name: /Commission Stream Deck\+ · Booth 2/i });

  await selectedTask.click();
  await expect(selectedTask).toHaveAttribute("data-selected", "true");
  await expect(selectedTask).toHaveAttribute("data-time-label", "18:24");

  await page.keyboard.press("ArrowRight");
  await expect(selectedTask).toHaveAttribute("data-time-label", "18:39");

  await page.keyboard.press("ArrowDown");
  await expect(workspace.getByText("Commission Stream Deck+ · Booth 2 · running")).toBeVisible();
  await page.keyboard.press("Enter");
  const audioDetailDialog = page.getByRole("dialog", { name: "audio" });
  await expect(audioDetailDialog).toBeVisible();
  await audioDetailDialog.getByRole("button", { name: "Close" }).click();
  await expect(audioDetailDialog).toHaveCount(0);

  await page.keyboard.press("ArrowUp");
  await expect(workspace.getByText("Commission Stream Deck+ · Booth 2 · running")).toHaveCount(1);
  await page.keyboard.press("Enter");
  const boothDetailDialog = page.getByRole("dialog", { name: "booth_2" });
  await expect(boothDetailDialog).toBeVisible();
  await boothDetailDialog.getByRole("button", { name: "Close" }).click();
  await expect(boothDetailDialog).toHaveCount(0);

  await page.keyboard.press("BracketRight");
  await expect(workspace.getByText("10:00 → 23:00")).toBeVisible();

  await page.keyboard.press("Shift+BracketRight");
  await expect(workspace.getByRole("button", { name: "Today" })).toBeVisible();

  await page.keyboard.press("0");
  await expect(workspace.getByRole("button", { name: "Today" })).toHaveCount(0);
  await expect(selectedTask).toBeVisible();
});

test("reschedules a planning timeline block by drag into another lane", async ({ page }) => {
  await openFixture(page, "planning-populated");

  const workspace = page.getByTestId("planning-workspace");
  const audioLane = workspace.getByTestId("planning-lane-body-proj-audio");
  const taskBlock = workspace.getByRole("button", { name: /Commission Stream Deck\+ · Booth 2/i });

  await taskBlock.dragTo(audioLane, {
    targetPosition: { x: 420, y: 42 },
  });

  await expect(workspace.getByRole("button", { name: /Commission Stream Deck\+ · Booth 2/i })).toHaveCount(1);
  await expect(workspace.getByText("Commission Stream Deck+ · Booth 2 · running")).toBeVisible();
});

test("opens the retained planning project detail overlay from timeline selection and board detail targets", async ({
  page,
}) => {
  await openFixture(page, "planning-populated");

  const workspace = page.getByTestId("planning-workspace");
  await workspace.getByRole("button", { name: /Commission Stream Deck\+ · Booth 2/i }).click();
  await page.keyboard.press("Enter");

  const detailDialog = page.getByRole("dialog", { name: "booth_2" });
  await expect(detailDialog).toBeVisible();
  await expect(detailDialog.getByText("1/2 complete")).toBeVisible();
  await expect(detailDialog.getByText("Verify OSC bindings")).toBeVisible();
  await expect(detailDialog.getByText("Commission Stream Deck+ · Booth 2")).toBeVisible();
  await expect(detailDialog.getByText("Stream Deck+ booth commissioning resumed.")).toBeVisible();
  const checklistToggle = detailDialog.getByRole("button", {
    name: "Toggle checklist item Verify companion trigger handoff for Commission Stream Deck+ · Booth 2",
    exact: true,
  });
  await expect(checklistToggle).toHaveAttribute("data-done", "false");
  await checklistToggle.click();
  await expect(checklistToggle).toHaveAttribute("data-done", "true");
  await expect(detailDialog.getByText("Checklist item checked")).toBeVisible();
  await detailDialog
    .getByRole("button", {
      name: "Toggle completion for Commission Stream Deck+ · Booth 2",
      exact: true,
    })
    .click();
  await expect(detailDialog.getByText("2/2 complete")).toBeVisible();
  await expect(detailDialog.getByText('Task "Commission Stream Deck+ · Booth 2" marked as completed')).toBeVisible();
  await detailDialog.getByRole("button", { name: "+ Add Task" }).click();
  await detailDialog.getByLabel("New task for booth_2").fill("Run booth handoff");
  await detailDialog.getByRole("button", { name: "Add Task", exact: true }).click();
  await expect(detailDialog.getByText("2/3 complete")).toBeVisible();
  await expect(
    detailDialog.getByRole("button", {
      name: "Toggle completion for Run booth handoff",
      exact: true,
    })
  ).toBeVisible();
  await expect(detailDialog.getByText('Task "Run booth handoff" created')).toBeVisible();
  await detailDialog.getByLabel("Checklist item text for Run booth handoff").fill("Pack backup SD image");
  await detailDialog
    .getByRole("button", {
      name: "Add checklist item for Run booth handoff",
      exact: true,
    })
    .click();
  await expect(
    detailDialog.getByRole("button", {
      name: "Toggle checklist item Pack backup SD image for Run booth handoff",
      exact: true,
    })
  ).toBeVisible();
  await expect(detailDialog.getByText('Checklist item "Pack backup SD image" added')).toBeVisible();
  await detailDialog.getByRole("button", { name: "Close" }).click();
  await expect(detailDialog).toHaveCount(0);

  await page.keyboard.press("Shift+KeyB");
  await workspace.getByRole("button", { name: "Open project detail for booth_2" }).click();
  await expect(page.getByRole("dialog", { name: "booth_2" })).toBeVisible();
});

test("surfaces planning lane overlap after a reschedule write", async ({ page }) => {
  await openFixture(page, "planning-overlap");

  const workspace = page.getByTestId("planning-workspace");
  const selectedTask = workspace.getByRole("button", { name: /Program note runthrough/i });

  await selectedTask.click();
  await expect(selectedTask).toHaveAttribute("data-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(selectedTask).toHaveAttribute("data-overlap", "true");
  await expect(selectedTask).toHaveAttribute("data-overlap-pulse", "true");
  await expect(selectedTask).toHaveAttribute("title", /Overlaps 'Projector handoff'\./);
});

test("supports planning all-unscheduled tray expansion and schedules a task into its own lane", async ({ page }) => {
  await openFixture(page, "planning-all-unscheduled");

  const workspace = page.getByTestId("planning-workspace");
  const tray = workspace.getByTestId("planning-unscheduled-tray");
  const lane = workspace.getByTestId("planning-lane-body-proj-ops");
  const taskChip = workspace.getByRole("button", { name: "Unscheduled task Archive Q3 cue library" });

  await expect(workspace.getByText("Drag into a lane to schedule.")).toBeVisible();
  await expect(tray).toHaveAttribute("data-expanded", "true");
  await expect(tray).toHaveAttribute("data-all-unscheduled", "true");

  await taskChip.dragTo(lane);

  await expect(workspace.getByText("Archive Q3 cue library")).toBeVisible();
  await expect(workspace.getByText("15 min · P3")).toBeVisible();
  await expect(workspace.getByRole("button", { name: "Unscheduled task Archive Q3 cue library" })).toHaveCount(0);
});

test("supports planning toolbar project creation and backup export", async ({ page }) => {
  await openFixture(page, "planning-empty");

  const workspace = page.getByTestId("planning-workspace");
  await expect(workspace.getByText("No projects yet. Press N to start one.")).toBeVisible();

  await page.keyboard.press("KeyN");
  const projectTitle = workspace.getByLabel("New project title");
  await expect(projectTitle).toBeFocused();
  await projectTitle.fill("studio_patch");
  await workspace.getByRole("button", { name: "Add project" }).click();
  await expect(workspace.getByText("Created project 'studio_patch'.")).toBeVisible();
  await expect(workspace.getByText("studio_patch", { exact: true })).toBeVisible();

  await workspace.getByRole("button", { name: "Backup" }).click();
  await expect(workspace.getByText(/Exported support backup to/)).toBeVisible();
});

test("supports planning toolbar search focus and engine-backed time report", async ({ page }) => {
  await openFixture(page, "planning-populated");

  const workspace = page.getByTestId("planning-workspace");
  const timelineTab = workspace.getByRole("tab", { name: "Timeline" });
  const search = workspace.getByLabel("Search planning tasks");

  await timelineTab.click();
  await page.keyboard.press("/");
  await expect(search).toBeFocused();
  await search.fill("stream deck");
  await expect(workspace.getByText("booth_2")).toBeVisible();
  await expect(workspace.getByText("audio")).toHaveCount(0);

  await timelineTab.click();
  await page.keyboard.press("KeyS");
  await expect(search).toBeFocused();

  await timelineTab.click();
  await page.keyboard.press("KeyR");
  const timeReportDialog = page.getByRole("dialog", { name: "Time report" });
  await expect(timeReportDialog).toBeVisible();
  await expect(timeReportDialog.getByText("By project")).toBeVisible();
  await expect(timeReportDialog.getByText("By task")).toBeVisible();
  await expect(timeReportDialog.getByText("booth_2", { exact: true }).first()).toBeVisible();
  await expect(timeReportDialog.getByText("Commission Stream Deck+ · Booth 2")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog", { name: "Time report" })).toHaveCount(0);
});

test("shows the centered empty-state card in planning board mode with no projects", async ({ page }) => {
  await openFixture(page, "planning-empty");

  const workspace = page.getByTestId("planning-workspace");
  await expect(workspace.getByText("No projects yet. Press N to start one.")).toBeVisible();

  await page.keyboard.press("Shift+KeyB");
  await expect(workspace.getByRole("tab", { name: "Board" })).toHaveAttribute("data-active", "true");
  await expect(workspace.getByText("No projects yet. Press N to start one.")).toBeVisible();
  await expect(workspace.getByTestId("planning-board-column-todo")).toBeVisible();
  await expect(workspace.getByTestId("planning-board-column-in-progress")).toBeVisible();
  await expect(workspace.getByTestId("planning-board-column-blocked")).toBeVisible();
  await expect(workspace.getByTestId("planning-board-column-done")).toBeVisible();
});

test("renders the planning board loading posture from app snapshot mode settings", async ({ page }) => {
  await openFixture(page, "planning-loading-board");

  const workspace = page.getByTestId("planning-workspace");
  await expect(workspace.getByTestId("planning-board-column-todo")).toBeVisible();
  await expect(workspace.getByTestId("planning-board-column-in-progress")).toBeVisible();
  await expect(workspace.getByTestId("planning-board-column-blocked")).toBeVisible();
  await expect(workspace.getByTestId("planning-board-column-done")).toBeVisible();
  await expect(workspace.getByText("Run-of-show loading…")).toHaveCount(0);
});

test("renders the lighting snapshot loading posture", async ({ page }) => {
  await openFixture(page, "lighting-loading");

  const workspace = page.getByRole("main").first();
  await expect(page.getByRole("toolbar", { name: "Lighting workspace toolbar" })).toBeVisible();
  await expect(workspace.getByText("No scenes saved yet")).toBeVisible();
  await expect(workspace.getByText("No fixtures on the rig yet")).toBeVisible();
  await expect(workspace.getByText("0 / 0 patched")).toBeVisible();
  await expect(page.getByRole("button", { name: /Fixture /i })).toHaveCount(0);
});

test("renders the lighting workspace from an engine-backed fixture snapshot", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  const workspace = page.getByRole("main").first();
  await expect(page.getByRole("toolbar", { name: "Lighting workspace toolbar" })).toBeVisible();
  await expect(workspace.getByText("192.168.1.80 · U1")).toBeVisible();
  await expect(workspace.getByText("Warm wash").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Recall scene Warm wash (active)" })).toHaveAttribute(
    "data-selected",
    "true"
  );
  await expect(page.getByRole("button", { name: "Recall scene Interview" })).toBeVisible();
  await expect(page.getByRole("application", { name: "Lighting stage plot" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Fixture Key, 76 percent, 3200 kelvin/i })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(workspace.getByText("1 fixture selected")).toBeVisible();
  await expect(workspace.getByText("Scene state")).toBeVisible();
  await expect(workspace.getByText("Saved", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Scene intensity shape for Warm wash" })).toBeVisible();

  await page.keyboard.press("KeyS");
  await expect(page.getByRole("button", { name: "Recall scene Scene 3" })).toBeVisible();
  await page.getByRole("button", { name: "Recall scene Interview" }).click();
  await expect(page.getByRole("button", { name: "Recall scene Interview (active)" })).toHaveAttribute(
    "data-selected",
    "true"
  );
  await expect(
    page.getByRole("application", { name: "Lighting stage plot" }).getByText("Interview", { exact: true })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Fixture Key, 92 percent, 4400 kelvin/i })).toHaveAttribute(
    "aria-pressed",
    "true"
  );

  await page.getByLabel("Fixture intensity").focus();
  await page.getByLabel("Fixture intensity").press("End");
  await expect(page.getByLabel("Fixture intensity")).toHaveAttribute("aria-valuenow", "100");
  await page.getByLabel("Fixture CCT").focus();
  await page.getByLabel("Fixture CCT").press("End");
  await expect(page.getByLabel("Fixture CCT")).toHaveAttribute("aria-valuenow", "5600");

  await page.getByRole("button", { name: /^Fixture Warm wash,/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /^Fixture Warm wash,/ })).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByLabel("Lighting inspector — Fixture").getByText("Apollo Bridge", { exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: "Turn off" }).click();
  await expect(page.getByRole("button", { name: /^Fixture Warm wash, off,/ })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Inspect Front group" }).click();
  await page.getByRole("tab", { name: "Group" }).click();
  await expect(page.getByRole("heading", { name: "Group" })).toBeVisible();
  await expect(workspace.getByText("Front", { exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: "Turn group off" }).click();
  await expect(page.getByRole("button", { name: /Front, 2 fixtures.*off\. Toggle on\./i })).toBeVisible();
});

test("renders lighting fixture symbol families and stage plot render modes", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openFixture(page, "lighting-symbol-families");

  const plot = page.getByRole("application", { name: "Lighting stage plot" });
  await expect(plot.locator('[data-fixture-id="fixture-key"] [data-symbol-kind="panel"]')).toHaveCount(1);
  await expect(plot.locator('[data-fixture-id="fixture-soft-mat"] [data-symbol-kind="soft-mat"]')).toHaveCount(1);
  await expect(plot.locator('[data-fixture-id="fixture-back"] [data-symbol-kind="linear-bar"]')).toHaveCount(1);
  await expect(plot.locator('[data-fixture-id="fixture-fresnel"] [data-symbol-kind="fresnel"]')).toHaveCount(1);
  await expect(plot.locator('[data-fixture-id="fixture-kicker"] [data-symbol-kind="control-node"]')).toHaveCount(1);
  await expect(plot.locator('[data-fixture-output-id="fixture-kicker"]')).toHaveCount(0);

  await page.getByRole("radio", { name: "Coverage" }).click();
  await expect(plot).toHaveAttribute("data-render-mode", "coverage");
  await page.getByRole("radio", { name: "Photometric" }).click();
  await expect(plot).toHaveAttribute("data-render-mode", "photometric");
  await expect(plot.locator('[data-fixture-output-id="fixture-back"]')).toHaveText(/593 lx @ 1 m|120 deg est\./);
  await page.getByRole("radio", { name: "Pixel" }).click();
  await expect(plot).toHaveAttribute("data-render-mode", "pixel");
  expect(await plot.locator('[data-fixture-id="fixture-back"] [data-emitter-segment="true"]').count()).toBeGreaterThan(
    0
  );

  const symbolKey = page.getByTestId("fixture-symbol-key");
  await expect(symbolKey).toBeVisible();
  await expect(page.getByTestId("fixture-symbol-key-row-litepanels-astra-bicolor")).toContainText("2");
  await expect(page.getByTestId("fixture-symbol-key-row-aputure-infinibar-pb12")).toContainText("8 ch");

  const fresnel = page.getByRole("button", { name: /^Fixture Fresnel,/ });
  await fresnel.focus();
  await page.keyboard.press("Enter");
  await expect(fresnel).toHaveAttribute("aria-pressed", "true");
});

test("keeps the full lighting workspace visible at the 1920x1080 fallback size", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openFixture(page, "lighting-populated");

  const workspace = page.getByRole("main").first();
  await expect(page.getByRole("toolbar", { name: "Lighting workspace toolbar" })).toBeVisible();
  await expect(workspace.getByText("Scenes", { exact: true })).toBeVisible();
  await expect(workspace.getByText("Groups", { exact: true })).toBeVisible();
  await expect(page.getByRole("application", { name: "Lighting stage plot" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Patch/ })).toBeVisible();
  await expect(workspace.getByText("1 fixture selected")).toBeVisible();

  const layoutMetrics = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    scrollWidth: document.documentElement.scrollWidth,
    viewportHeight: window.innerHeight,
    viewportWidth: window.innerWidth,
  }));

  expect(layoutMetrics.scrollHeight).toBeLessThanOrEqual(layoutMetrics.viewportHeight + 1);
  expect(layoutMetrics.scrollWidth).toBeLessThanOrEqual(layoutMetrics.viewportWidth + 1);
});

test("adapts lighting layout modes across supported logical viewport sizes", async ({ page }) => {
  const cases = [
    { width: 1280, height: 800, mode: "narrowUtility" },
    { width: 1440, height: 900, mode: "desktopCompact" },
    { width: 1600, height: 960, mode: "desktopCompact" },
    { width: 1728, height: 1117, mode: "desktopCompact" },
    { width: 1920, height: 1080, mode: "studioFull" },
    { width: 2560, height: 1440, mode: "studioFull" },
  ] as const;

  for (const entry of cases) {
    await page.setViewportSize({ width: entry.width, height: entry.height });
    await openFixture(page, "lighting-populated");

    await expect(page.locator("[data-operator-layout-root]")).toHaveAttribute("data-layout-mode", entry.mode);
    await expect(page.getByTestId("lighting-toolbar")).toBeVisible();
    await expect(page.getByTestId("lighting-stage")).toBeVisible();
    await expectToolbarPrimaryControlsFit(page);
    await expectNoDocumentScroll(page);

    const stageBounds = await page.getByTestId("lighting-stage").boundingBox();
    expect(stageBounds?.width ?? 0).toBeGreaterThanOrEqual(entry.mode === "narrowUtility" ? 520 : 560);
    expect(stageBounds?.height ?? 0).toBeGreaterThanOrEqual(entry.mode === "narrowUtility" ? 400 : 440);

    if (entry.mode !== "studioFull") {
      await page.getByTestId("lighting-toolbar-overflow").click();
      await expect(page.getByRole("menuitem", { name: /Highlight selection|Clear Highlight/ })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: /Solo selection|Clear Solo/ })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Find selected fixtures" })).toBeVisible();
      await page.keyboard.press("Escape");
    }

    if (entry.mode === "narrowUtility") {
      await expect(page.getByTestId("lighting-inspector-drawer")).toHaveCount(0);
      await page.getByTestId("lighting-open-inspector").click();
      await expect(page.getByTestId("lighting-inspector-drawer")).toBeVisible();
      await expect(page.getByTestId("lighting-inspector-drawer").getByLabel("Fixture intensity")).toBeVisible();
      await page.getByTestId("lighting-inspector-drawer").getByRole("button", { name: "Close" }).click();
      await expect(page.getByTestId("lighting-inspector-drawer")).toHaveCount(0);
    }
  }
});

test("renders scaled studio preview inside the current MacBook-sized viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 982 });
  const response = await page.goto("/?fixture=lighting-populated&transport=fixture&operatorReview=studio");
  expect(response, "studio preview fixture should return a document response").not.toBeNull();
  expect(response!.status(), "studio preview fixture should not fail to load").toBeLessThan(400);

  const root = page.locator("[data-operator-layout-root]");
  await expect(root).toHaveAttribute("data-review-surface", "studioPreview");
  await expect(root).toHaveAttribute("data-layout-mode", "studioFull");
  await expect(root).toHaveAttribute("data-layout-width", "2560");
  await expect(root).toHaveAttribute("data-layout-height", "1440");
  await expect(page.getByText(/Studio Preview/)).toBeVisible();
  await expectToolbarPrimaryControlsFit(page);
  await expectNoDocumentScroll(page);

  const visualBounds = await root.boundingBox();
  expect(visualBounds?.width ?? 0).toBeLessThanOrEqual(1512 + 1);
  expect(visualBounds?.height ?? 0).toBeLessThanOrEqual(982 + 1);
  expect((visualBounds?.width ?? 0) / (visualBounds?.height ?? 1)).toBeCloseTo(16 / 9, 2);
});

test("enters and exits scaled studio preview from the command palette", async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 982 });
  await openFixture(page, "lighting-populated");

  await page.keyboard.press("Meta+K");
  await page.locator("input[placeholder*=command]").fill("studio preview");
  await expect(page.getByRole("option", { name: "Studio Preview: Enter 2560x1440 Review" })).toBeVisible();
  await page.getByRole("option", { name: "Studio Preview: Enter 2560x1440 Review" }).click();

  const root = page.locator("[data-operator-layout-root]");
  await expect(root).toHaveAttribute("data-review-surface", "studioPreview");
  await expect(root).toHaveAttribute("data-layout-mode", "studioFull");
  await expect(page.getByText(/Studio Preview - 2560x1440 @/)).toBeVisible();

  await page.keyboard.press("Meta+K");
  await page.locator("input[placeholder*=command]").fill("studio preview");
  await expect(page.getByRole("option", { name: "Studio Preview: Exit Review" })).toBeVisible();
  await page.getByRole("option", { name: "Studio Preview: Exit Review" }).click();

  await expect(root).toHaveAttribute("data-review-surface", "native");
});

test("supports lighting preview mode without driving live scene state", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  const workspace = page.getByRole("main").first();
  await page.getByRole("button", { name: /Preview/ }).click();
  await expect(page.getByLabel("Lighting preview mode")).toBeVisible();
  await expect(page.getByText("Editing offline")).toBeVisible();
  await expect(page.getByRole("button", { name: /Patch/ })).toBeDisabled();
  await expect(page.getByText("Preview values")).toBeVisible();

  await page.getByLabel("Fixture intensity").focus();
  await page.getByLabel("Fixture intensity").press("End");
  await expect(workspace.getByText("Offline edits", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Fixture Key, 100 percent,/ })).toHaveAttribute(
    "aria-pressed",
    "true"
  );

  await page.getByRole("button", { name: /Exit preview/ }).click();
  await expect(page.getByRole("dialog", { name: "Exit preview with offline edits?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Recall scene Interview" }).click();
  await expect(page.getByText("Scene loaded into preview.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Recall scene Warm wash (active)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Recall scene Interview (preview)" })).toBeVisible();

  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByLabel("Lighting preview mode")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Fixture Key, 76 percent,/ })).toHaveAttribute("aria-pressed", "true");
});

test("supports lighting palette pools from the inspector and quick picker", async ({ page }) => {
  await openFixture(page, "lighting-palettes-selected");

  const inspector = page.getByLabel(/Lighting inspector.*Palettes/);
  await expect(page.getByRole("tab", { name: "Palettes" })).toHaveAttribute("aria-selected", "true");
  await expect(inspector.getByRole("heading", { name: "Intensity" })).toBeVisible();
  await expect(inspector.getByRole("heading", { name: "CCT" })).toBeVisible();
  await expect(inspector.getByText("1 selected")).toBeVisible();

  await inspector.getByRole("button", { name: "Apply Low" }).click();
  await expect(page.getByRole("button", { name: /^Fixture Key, 10 percent,/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/Lighting intensity palette 'Low' applied to 1 fixture/)).toBeVisible();

  await page.keyboard.press(modifierShortcut("Shift+KeyP"));
  const quickPicker = page.getByRole("dialog", { name: "Lighting palettes" });
  await expect(quickPicker).toBeVisible();
  await expect(quickPicker.getByLabel("Search palettes")).toBeFocused();
  await expect(quickPicker.getByRole("button", { name: "Apply palette Low 10%" }).first()).toBeVisible();
  await quickPicker.getByLabel("Search palettes").fill("studio");
  await quickPicker.getByRole("button", { name: "Apply palette Studio 4000K" }).click();
  await expect(page.getByRole("button", { name: /^Fixture Key, 10 percent, 4000 kelvin/i })).toHaveAttribute(
    "aria-pressed",
    "true"
  );

  await inspector.getByRole("button", { name: "Create Intensity palette" }).click();
  await inspector.getByLabel("Palette name").fill("Desk");
  await inspector.getByLabel("Palette value").fill("33");
  await inspector.getByRole("button", { name: "Save" }).click();
  await expect(inspector.getByRole("button", { name: "Apply Desk" })).toBeVisible();

  await openFixture(page, "lighting-palettes-empty");
  const emptyInspector = page.getByLabel(/Lighting inspector.*Palettes/);
  await expect(emptyInspector.getByText("0 selected")).toBeVisible();
  await expect(emptyInspector.getByRole("button", { name: "Apply Low" })).toBeDisabled();
  await page.keyboard.press(modifierShortcut("Shift+KeyP"));
  await expect(page.getByText("Select fixtures to apply.")).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Lighting palettes" }).getByRole("button", { name: "Apply palette Low 10%" })
  ).toBeDisabled();
  await page.keyboard.press("Escape");

  await openFixture(page, "lighting-palettes-patch-disabled");
  const patchInspector = page.getByLabel(/Lighting inspector.*Palettes/);
  await expect(patchInspector.getByText("1 selected")).toBeVisible();
  await expect(patchInspector.getByText("Patch locked")).toBeVisible();
  await expect(patchInspector.getByRole("button", { name: "Create Intensity palette" })).toBeDisabled();
  await expect(patchInspector.getByRole("button", { name: "Apply Low" })).toBeDisabled();
  await expect(patchInspector.getByRole("button", { name: "Edit Low" })).toBeDisabled();
  await expect(patchInspector.getByRole("button", { name: "Move Low later" })).toBeDisabled();
  await expect(patchInspector.getByRole("button", { name: "Delete Low" })).toBeDisabled();
});

test("supports lighting toolbar search, patch mode, and empty-state fixture create", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  const workspace = page.getByRole("main").first();
  await page.getByRole("button", { name: "Recall scene Interview" }).click();
  await expect(page.getByRole("button", { name: "Recall scene Interview (active)" })).toBeVisible();
  await page.getByRole("button", { name: "Recall scene Warm wash" }).click();
  await expect(page.getByRole("button", { name: "Recall scene Warm wash (active)" })).toBeVisible();
  await page.keyboard.press(modifierShortcut("KeyF"));
  await expect(page.getByLabel("Search fixtures, scenes and groups")).toBeFocused();
  const recentScenes = page.getByRole("listbox", { name: "Recent scenes" });
  await expect(recentScenes).toBeVisible();
  await expect(recentScenes.getByRole("option", { name: /Warm wash/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await expect(recentScenes.getByRole("option", { name: /Interview/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Recall scene Interview (active)" })).toBeVisible();

  await page.getByRole("button", { name: "Recall scene Interview (active)" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /Delete scene/ }).click();
  await page.getByRole("button", { name: "Delete scene" }).click();
  await expect(page.getByText("Scene 'Interview' deleted.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Recall scene Interview/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("button", { name: /Recall scene Interview/ })).toBeVisible();

  await page.getByLabel("Search fixtures, scenes and groups").fill("zzz");
  await expect(workspace.getByText(/No scenes match .zzz./)).toBeVisible();
  await expect(workspace.getByText(/No groups match .zzz./)).toBeVisible();
  await page.getByLabel("Search fixtures, scenes and groups").fill("");
  await expect(workspace.getByText(/No scenes match .zzz./)).toBeHidden();

  await page.getByRole("button", { name: /Patch/ }).click();
  await expect(workspace.getByText("Master · paused · patch mode")).toBeVisible();
  await expect(page.getByLabel("Fixture patch start channel")).toBeVisible();
  await expect(page.getByTestId("lighting-beam-fixture-key")).toHaveCount(0);
  await page.getByLabel("Fixture patch start channel").fill("3");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("003", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Identify" }).click();
  await expect(page.getByRole("button", { name: /Bursting/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Beam angle in degrees").fill("42");
  await page.getByLabel("Beam angle in degrees").press("Enter");
  await expect(page.getByLabel("Beam angle in degrees")).toHaveValue("42");

  await openFixture(page, "lighting-empty");
  const emptyWorkspace = page.getByRole("main").first();
  await expect(emptyWorkspace.getByText("No fixtures on the rig yet")).toBeVisible();
  await page.getByRole("button", { name: "Add fixture" }).first().click();
  const addFixtureDialog = page.getByRole("dialog", { name: "Add fixture" });
  await expect(addFixtureDialog.getByLabel("Name")).toHaveValue("Fixture 1");
  await addFixtureDialog.getByRole("button", { name: "Add fixture" }).click();
  await expect(page.getByRole("button", { name: /^Fixture Fixture 1,/ })).toBeVisible();
});

test("surfaces patch collisions and auto-fixes them in lighting patch mode", async ({ page }) => {
  await openFixture(page, "lighting-patch-overlap");

  const workspace = page.getByRole("main").first();
  await page.getByRole("button", { name: /Patch/ }).click();

  const backFixture = page.getByRole("button", { name: /^Fixture Back,/ });
  await backFixture.focus();
  await page.keyboard.press("Enter");
  const patchInspector = page.getByLabel("Lighting inspector — Patch");
  await expect(patchInspector.getByText("Patch collision")).toBeVisible();
  await expect(patchInspector.getByText("Key", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Auto-fix to 003" })).toBeVisible();

  await page.getByRole("button", { name: "Auto-fix to 003" }).click();
  await expect(page.getByRole("button", { name: /^Fixture Back,/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("003", { exact: true })).toBeVisible();
  await expect(workspace.getByText("Patch collision")).toHaveCount(0);
});

test("persists lighting view bookmark slots through workspace changes", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.keyboard.press(modifierShortcut("Shift+Digit1"));
  await expect(page.getByRole("button", { name: /Recall view 1/ })).toBeVisible();
  await expect(page.getByText("Saved view 1.")).toBeVisible();

  await page.keyboard.press(modifierShortcut("Digit4"));
  await expect(page.getByTestId("planning-workspace")).toBeVisible();
  await page.keyboard.press(modifierShortcut("Digit2"));

  await expect(page.getByRole("button", { name: /Recall view 1/ })).toBeVisible();
  await page.keyboard.press("Shift+Digit1");
  await expect(page.getByRole("button", { name: /Recall view 1/ })).toBeVisible();
});

test("supports lighting drag-lasso multi-select and group save", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  await page.getByRole("button", { name: /^Fixture Fill,/ }).focus();
  await page.keyboard.down("Shift");
  await page.keyboard.press("Enter");
  await page.keyboard.up("Shift");

  await expect(page.getByLabel("Selected fixtures", { exact: true }).getByText("2 fixtures selected")).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear all selection" })).toBeVisible();

  await page.getByRole("button", { name: "Create a new lighting group" }).click();
  const createGroupDialog = page.getByRole("dialog", { name: "New lighting group" });
  await expect(createGroupDialog.getByLabel("Group name")).toBeFocused();
  await createGroupDialog.getByLabel("Group name").fill("Group 3");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /^Group 3, 0 fixtures, off\. Toggle on\.$/i })).toBeVisible();
});

test("saves the current lighting selection as a scene from the inspector prompt", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  await page.keyboard.press(modifierShortcut("Shift+KeyS"));
  const saveSceneDialog = page.getByRole("dialog", { name: "Save as new scene" });
  await expect(saveSceneDialog.getByLabel("Scene name")).toBeFocused();
  await saveSceneDialog.getByLabel("Scene name").fill("Interview reset");
  await page.keyboard.press("Enter");

  await expect(page.getByRole("button", { name: /Recall scene Interview reset/i })).toBeVisible();
});

test("nudges the selected fixture horizontally from the keyboard", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  await expect(page.getByLabel("Stage X position in metres")).toHaveValue("0.24");
  await page.keyboard.press("ArrowRight");

  await expect(page.getByLabel("Stage X position in metres")).toHaveValue("0.35");
});

test("drags the selected fixture to a new plot position", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  const fixture = page.getByRole("button", { name: /^Fixture Key,/ });
  const output = page.locator('[data-fixture-output-id="fixture-key"]');
  await fixture.scrollIntoViewIfNeeded();
  const start = await fixture.evaluate((node) => {
    const marker = node.querySelector("g[filter]");
    if (!(marker instanceof SVGGraphicsElement)) throw new Error("Fixture marker body not found");
    const matrix = marker.getScreenCTM();
    if (!matrix) throw new Error("Fixture marker matrix not available");

    return { x: matrix.e, y: matrix.f };
  });
  const startOutputTransform = await output.getAttribute("transform");

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 180, start.y + 120, { steps: 8 });
  await expect.poll(async () => output.getAttribute("transform")).not.toBe(startOutputTransform);
  await page.mouse.up();
  expect(await output.getAttribute("transform")).not.toBe(startOutputTransform);

  await expect(page.getByLabel("Stage X position in metres")).toHaveValue("1.5");
  await expect(page.getByLabel("Stage Y position in metres")).toHaveValue("1.0");
});

test("mirrors fixture intensity slider drafts on the stage plot before commit", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  const fixture = page.getByRole("button", { name: /^Fixture Key,/ });
  const output = page.locator('[data-fixture-output-id="fixture-key"]');
  await expect(fixture).toHaveAttribute("aria-label", /76 percent/);
  const startOutputOpacity = await output.locator("stop").first().getAttribute("stop-opacity");

  const slider = page.getByRole("slider", { name: "Fixture intensity" });
  const box = await slider.boundingBox();
  expect(box).not.toBeNull();
  const y = box!.y + box!.height / 2;

  await page.mouse.move(box!.x + box!.width * 0.76, y);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.24, y, { steps: 8 });

  await expect.poll(async () => fixture.getAttribute("aria-label")).toMatch(/2[0-9] percent/);
  await expect
    .poll(async () => output.locator("stop").first().getAttribute("stop-opacity"))
    .not.toBe(startOutputOpacity);
  await page.mouse.up();

  await expect(fixture).toHaveAttribute("aria-label", /2[0-9] percent/);
});

test("rotates the selected fixture from the plot and inspector", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  const rotationInput = page.getByLabel("Fixture rotation in degrees");
  await expect(rotationInput).toHaveValue("0");

  const output = page.locator('[data-fixture-output-id="fixture-key"]');
  const startOutputTransform = await output.getAttribute("transform");
  const handle = page.locator('[data-fixture-rotate-handle="fixture-key"]');
  await expect(handle).toBeVisible();
  const points = await handle.evaluate((node) => {
    const circle = node.querySelector("circle");
    const marker = node.closest("[data-fixture-id]");
    const body = marker?.querySelector("g[filter]");
    if (!(circle instanceof SVGCircleElement) || !(body instanceof SVGGraphicsElement)) {
      throw new Error("Fixture rotate handle geometry not found");
    }
    const circleRect = circle.getBoundingClientRect();
    const matrix = body.getScreenCTM();
    if (!matrix) throw new Error("Fixture marker matrix not available");
    return {
      centerX: matrix.e,
      centerY: matrix.f,
      handleX: circleRect.left + circleRect.width / 2,
      handleY: circleRect.top + circleRect.height / 2,
    };
  });

  await page.mouse.move(points.handleX, points.handleY);
  await page.mouse.down();
  await page.mouse.move(points.centerX + 96, points.centerY - 12, { steps: 8 });
  await expect.poll(async () => output.getAttribute("transform")).not.toBe(startOutputTransform);
  await page.mouse.up();
  expect(await output.getAttribute("transform")).not.toBe(startOutputTransform);
  await expect(rotationInput).toHaveValue("82");

  await rotationInput.fill("270");
  await rotationInput.press("Enter");
  await expect(rotationInput).toHaveValue("270");
  await expect(page.locator('[data-fixture-id="fixture-key"] g[filter]').first()).toHaveAttribute(
    "transform",
    /rotate\(270\)/
  );
});

test("toggles the expanded DMX monitor from the keyboard", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  await page.keyboard.press(modifierShortcut("Shift+KeyM"));
  const dmxMonitorDialog = page.getByRole("dialog", { name: "DMX universe U1" });
  await expect(dmxMonitorDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dmxMonitorDialog).toBeHidden();
});

test("opens the compact DMX strip and expands it to the full monitor", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  await page.getByRole("button", { name: "Show DMX strip" }).click();
  await expect(page.getByRole("region", { name: "Universe 1 compact DMX strip" })).toBeVisible();
  await page.getByRole("button", { name: "Open full DMX monitor" }).click();
  const dialog = page.getByRole("dialog", { name: "DMX universe U1" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Patched to a fixture")).toBeVisible();
  await expect(dialog.getByRole("grid", { name: "DMX universe U1 channels" })).toBeVisible();
  await expect(dialog.locator('[title="Ch 1 · Key · Dimmer"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("shows lighting DMX-unreachable posture and blackout hold", async ({ page }) => {
  await openFixture(page, "lighting-dmx-unreachable");

  const workspace = page.getByRole("main").first();
  await expect(page.getByText("DMX bridge unreachable")).toBeVisible();
  await expect(workspace.getByText(/Lighting commands won't reach the rig/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Identify" })).toBeDisabled();

  await openFixture(page, "lighting-populated");
  await page.getByRole("button", { name: "Emergency cut all fixtures" }).click();
  const cutAllDialog = page.getByRole("dialog", { name: "Cut all fixtures?" });
  await expect(cutAllDialog).toBeVisible();
  await cutAllDialog.getByRole("button", { name: "Cut all", exact: true }).click();
  await expect(page.getByText("All fixtures off")).toBeVisible();
  await expect(page.getByText("Master · 0 / 4 on")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Fixture Key, off,/ })).toHaveAttribute("aria-pressed", "true");
});

test("supports shell keyboard overlays and workspace switching", async ({ page }) => {
  await openFixture(page, "setup-required");

  await page.keyboard.press("Shift+/");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeHidden();

  await page.keyboard.press("Shift+S");
  await expect(page.getByRole("heading", { name: "Backup and recovery" })).toBeVisible();
  await page.keyboard.press("Shift+S");
  await expect(page.getByRole("heading", { name: "Import the Companion profile" })).toBeVisible();

  await page.keyboard.press("Tab");
  await expect(page.getByRole("heading", { name: "Probe hardware" })).toBeVisible();

  await page.keyboard.press("Tab");
  await expect(page.getByRole("heading", { name: "Map bindings" })).toBeVisible();
  await expect(page.getByText("Project 1").last()).toBeVisible();

  await page.keyboard.press("Digit2");
  await expect(page.getByText("Task 1").last()).toBeVisible();

  await page.keyboard.press("KeyK");
  await expect(page.getByText("Task 2").last()).toBeVisible();

  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("heading", { name: "Probe hardware" })).toBeVisible();

  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("heading", { name: "Import the Companion profile" })).toBeVisible();

  await page.keyboard.press(modifierShortcut("Shift+KeyR"));
  await expect(page.getByRole("dialog", { name: "Restart engine bridge?" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Restart engine bridge?" })).toBeHidden();

  await page.keyboard.press(modifierShortcut("Digit2"));
  await expect(page.getByRole("heading", { name: "Import the Companion profile" })).toBeVisible();
});
