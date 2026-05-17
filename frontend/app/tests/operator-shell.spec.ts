import { expect, test, type Page } from "@playwright/test";
import type { AudioSnapshot } from "@sse/engine-client";
import { readFileSync } from "node:fs";

import { faderDbToNormalized, formatAudioDb, normalizedToFaderDb } from "../src/app/audio/audioFormatting";
import { buildAudioPaletteRegistrationSignature, buildAudioViewModel } from "../src/app/audio/audioViewModel";
import {
  calculateNextFixturePeakHold,
  createFixtureTransport,
} from "../../packages/engine-client/src/transports/fixtureTransport";

const FIXTURE_NOW = new Date("2026-04-23T09:11:00+02:00");
const EMPTY_AUDIO_GROUP_SELECTIONS = {
  "hardware-inputs": [],
  "software-playback": [],
};
const fixtureMap = JSON.parse(
  readFileSync(new URL("../../packages/test-fixtures/src/fixtures.json", import.meta.url), "utf-8")
) as Record<string, { audioSnapshot?: AudioSnapshot }>;

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

async function openFixture(page: Page, fixtureId: string) {
  if (fixtureId.startsWith("planning-")) {
    await page.clock.setFixedTime(FIXTURE_NOW);
  }
  const response = await page.goto(`/?fixture=${fixtureId}&transport=fixture`);
  expect(response, `fixture ${fixtureId} should return a document response`).not.toBeNull();
  expect(response!.status(), `fixture ${fixtureId} should not fail to load`).toBeLessThan(400);
  expect(page.url()).toContain(`fixture=${fixtureId}`);
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

async function readSnapshotThumbHeights(page: Page, snapshotId: string) {
  return page
    .getByTestId(`audio-snapshot-thumb-${snapshotId}`)
    .locator("i")
    .evaluateAll((bars) => bars.map((bar) => (bar as HTMLElement).style.height));
}

async function saveAudioSnapshot(page: Page, snapshotId: string) {
  const snapshotTile = page.getByTestId(`audio-snapshot-${snapshotId}`);
  await snapshotTile.hover();
  const saveButton = snapshotTile.getByRole("button", { exact: true, name: "Save" });
  await expect(saveButton).toBeEnabled();
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
  await expect(page.getByTestId("audio-signal-canvas").getByText("View", { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("audio-signal-canvas").getByRole("button", { name: "Submix" })).toBeVisible();
  await expect(page.getByTestId("audio-signal-canvas").getByText("Active mix").first()).toBeVisible();
  await expect(page.getByTestId("audio-signal-canvas").getByText("Density").first()).toBeVisible();
  await expect(page.getByTestId("audio-tiered-mixer")).toBeVisible();
  await expect(page.getByTestId("audio-hardware-inputs-tier")).toBeVisible();
  await expect(page.getByTestId("audio-software-playback-tier")).toBeVisible();
  await expect(page.getByTestId("audio-hardware-outputs-tier")).toBeVisible();
  await expect(page.getByTestId("audio-health-bar")).toBeVisible();
  await expectAudioWorkspaceGeometry(page);
  await expect(page.getByTestId("audio-master-halo")).toBeVisible();
  await expect(page.getByTestId("audio-routing-overlay")).toHaveCount(0);
  await expect(page.getByTestId("audio-footer-telemetry")).toContainText("Endpoint");
  await expect(page.getByTestId("audio-footer-telemetry")).toContainText("Metering");
  await expect(page.getByTestId("audio-footer-telemetry")).toContainText("Clock");
  await expect(page.getByTestId("audio-footer-shortcuts")).toContainText("Command palette");
  await expect(page.getByTestId("audio-footer-shortcuts")).toContainText("Shortcuts");
  await expect(page.getByTestId("audio-footer-shortcuts")).toContainText("Bank prev");
  await expect(page.getByTestId("audio-footer-shortcuts")).toContainText("Bank next");
  await expect(page.getByTestId("audio-footer-shortcuts")).not.toContainText("Shift 1-8 recall");
  await expect(page.getByTestId("audio-footer-shortcuts")).not.toContainText("Esc clear");
  await expect(page.getByTestId("audio-rail-monitor-card")).toBeVisible();
  await expect(page.getByTestId("audio-rail-tools")).toContainText("Sync");
  await expect(page.getByTestId("audio-solo-warning-band")).toContainText("Solo engaged");
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
  await expect(page.getByTestId("audio-signal-canvas").getByRole("button", { name: "Master" })).toBeEnabled();
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
  await expect(page.getByTestId("audio-inspector-channel")).toContainText("Playback engine");
  await expect(page.getByTestId("audio-inspector-channel")).toContainText("Buffer status");
  await expect(page.getByTestId("audio-inspector-channel")).toContainText("n/a");
  await expect(page.getByTestId("audio-inspector-channel").getByRole("button", { name: "Stereo link" })).toBeVisible();
  await expect(page.getByTestId("audio-inspector-channel").getByRole("button", { name: "Auto fade" })).toBeVisible();
  await page.getByTestId("audio-strip-audio-input-9").click();
  await expect(page.getByTestId("audio-inspector-channel")).toContainText("RME UFX III mic preamp");
  await expect(page.getByTestId("audio-inspector-channel")).toContainText("48V");
  await expect(page.getByTestId("audio-inspector-channel")).toContainText("Hi-Z");
  await expect(page.getByTestId("audio-inspector-channel")).toContainText("Polarity");
  await expect(page.getByTestId("audio-inspector-channel")).toContainText("AutoSet");
  await expect(page.getByTestId("audio-inspector-channel")).not.toContainText("Pad");
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
  await expect(page.getByTestId("audio-inspector-output").getByRole("button", { name: "PFL" })).toBeDisabled();
  await page.getByTestId("audio-strip-audio-playback-3-4").click();

  await page.keyboard.press("KeyV");
  await expect(workspace).toHaveAttribute("data-view-mode", "master");
  await page.keyboard.press("KeyV");
  await expect(workspace).toHaveAttribute("data-view-mode", "submix");

  await page.keyboard.press("BracketRight");
  await expect(page.getByTestId("audio-tiered-mixer")).toBeVisible();

  await page.keyboard.press("Digit1");
  const selectedStrip = page.getByTestId("audio-strip-audio-input-1");
  await expect(selectedStrip).toHaveAttribute("data-selected", "true");

  await page.keyboard.press("KeyM");
  await expect(selectedStrip.getByRole("button", { name: "Mute" })).toHaveAttribute("data-active", "true");

  await page.keyboard.press("Shift+Digit3");
  await expect(page.getByTestId("audio-snapshot-snapshot-interview-block")).toHaveAttribute("data-current", "true");
  await expect(page.getByTestId("audio-toolbar-current-snapshot")).toHaveText("Recalled Interview block");

  await expect(page.getByTestId("audio-inspector-channel")).toBeVisible();
  await expect(page.getByTestId("audio-inspector-metering")).toContainText("LUFS");
  await expect(page.getByTestId("audio-inspector-eq-mini")).toContainText("EQ");
  await expect(page.getByTestId("audio-inspector-dynamics-mini")).toContainText("Dynamics");
  await expect(page.getByTestId("audio-inspector-sends-mini")).toContainText("Sends");
  await page.getByTestId("audio-strip-audio-input-1").click({ button: "right" });
  await expect(page.getByTestId("audio-context-menu")).toContainText("Reset to unity");
  await expect(page.getByRole("menuitem", { name: "Rename..." })).toBeEnabled();
  page.once("dialog", (dialog) => dialog.accept("Renamed line 1"));
  await page.getByRole("menuitem", { name: "Rename..." }).click();
  await expect(page.getByTestId("audio-strip-audio-input-1")).toContainText("Renamed line 1");
  await expect(page.getByRole("button", { name: "PFL" })).toBeDisabled();
  await page.getByRole("button", { name: "EQ" }).click();
  await expect(page.getByRole("button", { name: "Enable EQ" })).toBeEnabled();
  await page.getByRole("button", { name: "Enable EQ" }).click();
  await expect(page.getByRole("button", { name: "Bypass EQ" })).toHaveAttribute("data-active", "true");
  await page.getByRole("button", { name: "Dynamics" }).click();
  await expect(page.getByTestId("audio-inspector-dynamics").getByRole("button", { name: "Comp" })).toBeEnabled();
  await page.getByRole("button", { name: "Sends" }).click();
  await expect(page.getByTestId("audio-inspector-sends")).toContainText("Phones 1");
  const preFader = page.getByTestId("audio-inspector-sends").getByRole("button", { name: "Pre fader" }).first();
  await expect(preFader).toBeEnabled();
  await preFader.click();
  await expect(preFader).toHaveAttribute("data-active", "true");

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("audio-inspector-channel")).toBeVisible();
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
  await expect(page.getByRole("button", { name: "Sync" })).toBeDisabled();

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

test("marks simulated audio metering as test-stage movement", async ({ page }) => {
  await openFixture(page, "audio-populated");

  await expect(page.getByTestId("audio-meter-simulation-chip")).toHaveText("TEST METER SIMULATION");
  await expect(page.getByTestId("audio-rail-monitor-card")).toContainText("test meters");
  await expect(page.getByTestId("audio-footer-telemetry")).toContainText("Test meter simulation");
  await expect(page.getByTestId("audio-inspector-metering")).toContainText("TEST STAGE");

  const hostMeter = page.getByTestId("audio-strip-audio-input-9").locator('[data-meter-component="stereo"]');
  await expect(hostMeter).toHaveCount(1);
  const stripFill = hostMeter.locator('[data-meter-fill="left"]').first();
  await expect(stripFill).toBeVisible();
  expect(await stripFill.evaluate((node) => getComputedStyle(node).animationName)).toBe("none");
  expect(await stripFill.evaluate((node) => getComputedStyle(node).transitionDuration)).not.toBe("0s");
  expect(await stripFill.evaluate((node) => getComputedStyle(node).clipPath)).toContain("inset");
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
  const firstActiveMixLevel = await activeMixFill.evaluate((node) =>
    getComputedStyle(node).getPropertyValue("--meter-level")
  );
  await page.waitForTimeout(900);
  const nextHostMeterVars = await hostMeter.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      left: style.getPropertyValue("--audio-meter-left").trim(),
      peakLeft: style.getPropertyValue("--audio-meter-peak-left").trim(),
    };
  });
  const nextActiveMixLevel = await activeMixFill.evaluate((node) =>
    getComputedStyle(node).getPropertyValue("--meter-level")
  );
  expect([nextHostMeterVars.left, nextHostMeterVars.peakLeft]).not.toEqual([
    firstHostMeterVars.left,
    firstHostMeterVars.peakLeft,
  ]);
  expect(nextActiveMixLevel).not.toBe(firstActiveMixLevel);

  await openFixture(page, "audio-hardware-metering");
  await expect(page.getByTestId("audio-meter-simulation-chip")).toHaveCount(0);
  await expect(page.getByTestId("audio-rail-monitor-card")).toContainText("Active mix · live");
  await expect(page.getByTestId("audio-footer-telemetry")).not.toContainText("Test meter simulation");
  await expect(page.locator("[data-simulated-meter]")).toHaveCount(0);
  await expect(page.getByTestId("audio-strip-audio-playback-3-4").locator("[data-simulation-profile]")).toHaveCount(0);
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

test("supports audio warning-band sync and keyboard mix-target changes", async ({ page }) => {
  await openFixture(page, "audio-state-assumed");

  const warningBand = page.getByTestId("audio-warning-band");
  await warningBand.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("audio-warning-band")).toHaveCount(0);

  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("audio-strip-audio-playback-5-6")).toHaveAttribute("data-selected", "true");
  await page.keyboard.press("KeyV");
  await expect(page.getByTestId("audio-workspace")).toHaveAttribute("data-view-mode", "master");
  await page.keyboard.press("KeyV");
  await expect(page.getByTestId("audio-workspace")).toHaveAttribute("data-view-mode", "submix");
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
  await expect(page.getByTestId("audio-inspector-channel")).toContainText("Phones 1");

  await page.getByTestId("audio-tier-lanes-hardware-inputs").dispatchEvent("click");
  await expect(page.getByTestId("audio-inspector-output")).toContainText("Phones 1");
});

test("aligns audio input hardware controls with UFX III preamps", async ({ page }) => {
  await openFixture(page, "audio-populated");

  await page.getByTestId("audio-strip-audio-input-9").click();
  const strip = page.getByTestId("audio-strip-audio-input-9");
  const inspector = page.getByTestId("audio-inspector-channel");

  await expect(strip.getByRole("button", { name: "48V" })).toHaveCount(0);
  await expect(strip.getByRole("button", { name: "Hi-Z" })).toHaveCount(0);
  await expect(strip.getByRole("button", { name: "Polarity" })).toHaveCount(0);
  await expect(strip.getByRole("button", { name: "AutoSet" })).toHaveCount(0);
  await expect(strip.getByRole("button", { name: "Pad" })).toHaveCount(0);

  await expect(inspector).toContainText("RME UFX III mic preamp");
  await expect(inspector).toContainText("48V");
  await expect(inspector).toContainText("Hi-Z");
  await expect(inspector).toContainText("Polarity");
  await expect(inspector).toContainText("AutoSet");
  await expect(inspector).not.toContainText("Pad");

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

test("supports audio snapshot capture save rename and delete", async ({ page }) => {
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

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Set fader dB");
    await dialog.accept("-60");
  });
  await page.getByRole("slider", { name: "FX 3/4 send level" }).dblclick();
  await expect(page.getByTestId("audio-strip-audio-playback-3-4")).toHaveAttribute("data-no-send", "true");
  await currentSnapshot.hover();
  await expect(currentSnapshot.getByText("FX 3/4")).toBeVisible();
  await expect(
    currentSnapshot.getByText(/[+-]?inf dB -> [+-]?\d+\.\d dB|[+-]?\d+\.\d dB -> [+-]?\d+\.\d dB/)
  ).toBeVisible();

  await saveAudioSnapshot(page, "snapshot-show-open");
  await expect
    .poll(async () => readSnapshotThumbHeights(page, "snapshot-show-open"), {
      message: "saved snapshot thumbnail should reflect the changed mix",
    })
    .not.toEqual(savedThumbBefore);
  await page.mouse.move(1, 1);
  const snapshotActions = currentSnapshot.getByTestId("audio-snapshot-actions-snapshot-show-open");
  await expect(snapshotActions).toBeHidden();
  await currentSnapshot.hover();
  await expect(snapshotActions).toBeVisible();
  await expect(currentSnapshot.getByText("18 sources saved")).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept("Renamed snapshot"));
  await capturedSlot.hover();
  await capturedSlot.getByRole("button", { name: "Rename" }).click();
  await expect(capturedSlot).toContainText("Renamed snapshot");

  page.once("dialog", (dialog) => dialog.accept());
  await capturedSlot.hover();
  await capturedSlot.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByTestId("audio-snapshot-empty-6")).toContainText("Empty");
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

  page.once("dialog", async (dialog) => {
    await dialog.accept("-60");
  });
  await page.getByRole("slider", { name: "FX 3/4 send level" }).dblclick();

  await currentSnapshot.hover();
  await expect(currentSnapshot.getByText("FX 3/4")).toBeVisible();
  await expect(
    currentSnapshot.getByText(/[+-]?inf dB -> [+-]?\d+\.\d dB|[+-]?\d+\.\d dB -> [+-]?\d+\.\d dB/)
  ).toBeVisible();
});

test("supports engine-backed audio EQ editing", async ({ page }) => {
  test.slow();
  await openFixture(page, "audio-populated");

  await page.getByTestId("audio-strip-audio-input-9").click();
  await page.getByRole("button", { name: "EQ" }).click();
  await page.getByRole("button", { name: "Enable EQ" }).click();
  await expect(page.getByRole("button", { name: "Bypass EQ" })).toHaveAttribute("data-active", "true");

  const loBand = page.getByTestId("audio-inspector-eq").getByRole("button", { name: "LO", exact: true });
  await expect(loBand).toHaveAttribute("data-active", "true");
  await loBand.click();
  await expect(loBand).toHaveAttribute("data-active", "false");

  await expect(page.getByRole("slider", { name: /Host .* EQ frequency/ })).toHaveCount(4);
  await expect(page.getByRole("slider", { name: /Host .* EQ Q/ })).toHaveCount(4);
  await expect(page.getByRole("slider", { name: /Host .* EQ gain/ })).toHaveCount(4);
  await expectSliderValueChanges(page, "Host LO EQ frequency");
  await expectSliderValueChanges(page, "Host LO EQ Q");
  await expectSliderValueChanges(page, "Host LO EQ gain");

  const midFrequency = page.getByRole("slider", { name: "Host MID EQ frequency" });
  const midGain = page.getByRole("slider", { name: "Host MID EQ gain" });
  const midFrequencyBefore = await midFrequency.getAttribute("aria-valuenow");
  const midGainBefore = await midGain.getAttribute("aria-valuenow");
  const midPoint = page.getByTestId("audio-eq-point-mid");
  await expect(midPoint).toHaveAttribute("data-selected", "false");
  const midPointBox = await midPoint.boundingBox();
  expect(midPointBox, "MID EQ point should be draggable").not.toBeNull();
  await page.mouse.move(midPointBox!.x + midPointBox!.width / 2, midPointBox!.y + midPointBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(midPointBox!.x + midPointBox!.width / 2 + 60, midPointBox!.y + midPointBox!.height / 2 - 18, {
    steps: 6,
  });
  await page.mouse.up();
  await expect(midPoint).toHaveAttribute("data-selected", "true");
  await expect(midFrequency).not.toHaveAttribute("aria-valuenow", midFrequencyBefore ?? "");
  await expect(midGain).not.toHaveAttribute("aria-valuenow", midGainBefore ?? "");
});

test("supports engine-backed audio dynamics editing", async ({ page }) => {
  test.slow();
  await openFixture(page, "audio-populated");

  await page.getByTestId("audio-strip-audio-input-9").click();
  await page.getByRole("button", { name: "Dynamics" }).click();
  const comp = page.getByTestId("audio-inspector-dynamics").getByRole("button", { name: "Comp" });
  await expect(comp).toHaveAttribute("data-active", "false");
  await comp.click();
  await expect(comp).toHaveAttribute("data-active", "true");

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
  await page.getByRole("button", { name: "Sends" }).click();
  const sends = page.getByTestId("audio-inspector-sends");
  const preFader = sends.getByRole("button", { name: "Pre fader" }).first();
  await expect(preFader).toBeEnabled();
  await expect(preFader).toHaveAttribute("data-active", "false");
  await preFader.click();
  await expect(preFader).toHaveAttribute("data-active", "true");

  const link = sends.getByRole("button", { name: "Link L+R" }).first();
  await expect(link).toHaveAttribute("data-active", "true");
  await link.click();
  await expect(link).toHaveAttribute("data-active", "false");
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
  await expect(page.getByText("Toggle Master/Submix view")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.keyboard.press("Shift+/");
  const shortcuts = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(shortcuts).toBeVisible();
  await shortcuts.getByPlaceholder(/Filter shortcuts/i).fill("audio");
  await expect(shortcuts).toContainText("Toggle Audio Master / Submix view");
  await expect(shortcuts).toContainText("Clear held audio clip indicators");
  await expect(shortcuts).toContainText("Save the current audio snapshot");
  await expect(shortcuts).toContainText("Open strip actions");
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

test("audio workspace custom faders drag and accept numeric dB entry", async ({ page }) => {
  await openFixture(page, "audio-populated");

  await page.keyboard.press(modifierShortcut("K"));
  await page.getByPlaceholder(/Type a command/i).fill("reset selected audio");
  await expect(page.getByText(/Reset selected fader/i)).toBeVisible();
  await page.keyboard.press("Escape");

  const fxFader = page.getByRole("slider", { name: "FX 3/4 send level" });
  await expect(fxFader).toBeVisible();
  const beforeValue = await fxFader.getAttribute("aria-valuenow");
  const faderBox = await fxFader.boundingBox();
  expect(faderBox).not.toBeNull();
  await page.mouse.move(faderBox!.x + faderBox!.width / 2, faderBox!.y + faderBox!.height - 4);
  await page.mouse.down();
  await page.mouse.move(faderBox!.x + faderBox!.width / 2, faderBox!.y + 4, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => fxFader.getAttribute("aria-valuenow")).not.toBe(beforeValue);

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Set fader dB");
    await dialog.accept("0");
  });
  await fxFader.dblclick();
  await expect(page.getByTestId("audio-strip-audio-playback-3-4")).toContainText("0.0dB");

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Set fader dB");
    await dialog.accept("-60");
  });
  await fxFader.dblclick();
  await expect(page.getByTestId("audio-strip-audio-playback-3-4")).toHaveAttribute("data-no-send", "true");

  await page.keyboard.press("KeyU");
  await expect(page.getByTestId("audio-strip-audio-playback-3-4")).toContainText("0.0dB");
});

test("audio preamp gain control responds to pointer drag", async ({ page }) => {
  await openFixture(page, "audio-populated");

  const hostGain = page.getByTestId("audio-strip-audio-input-9").getByRole("slider", { name: "Host preamp gain" });
  const beforeGain = await hostGain.getAttribute("aria-valuenow");
  const gainBox = await hostGain.boundingBox();
  expect(gainBox).not.toBeNull();
  await page.mouse.move(gainBox!.x + gainBox!.width / 2, gainBox!.y + gainBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(gainBox!.x + gainBox!.width / 2, gainBox!.y - 32, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => hostGain.getAttribute("aria-valuenow")).not.toBe(beforeGain);
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
  await expect(page.getByTestId("audio-strip-audio-playback-3-4")).toBeVisible();

  await expectAudioWorkspaceGeometry(page);
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
