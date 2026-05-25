import { expect, test } from "@playwright/test";
import type { AudioSnapshot } from "@sse/engine-client";

import { audioMeterEntryFromRecord } from "../../packages/engine-client/src/store/createShellStore";
import {
  calculateNextFixturePeakHold,
  createFixtureTransport,
} from "../../packages/engine-client/src/transports/fixtureTransport";
import {
  dbfsToMeterPercent,
  faderDbToNormalized,
  formatAudioDb,
  formatMeterDb,
  meterTone,
  normalizedToDbfs,
  normalizedToFaderDb,
} from "../src/app/audio/audioFormatting";

import {
  COMPACT_PREAMP_ASPECT_RATIO,
  NARROW_PREAMP_ASPECT_RATIO,
  expectAudioInspectorPanelsFit,
  expectAudioLaneCardsInsideTierGrids,
  expectAudioOverviewProcessingStack,
  expectAudioStudioSideRailsFilled,
  expectAudioWorkspaceGeometry,
  expectSliderValueChanges,
  expectSnapshotActionsDoNotOverlapContent,
  readSnapshotThumbHeights,
  saveAudioSnapshot,
} from "./helpers/audio";
import { expectAspectRatio, expectNoDocumentScroll, expectNoElementOverflow } from "./helpers/geometry";
import {
  EXPECTED_DBFS_SCALE_LABELS,
  expectDbfsScaleLabelsInsideMeters,
  meterNormalizedForDbfs,
  readMeterCanvasSample,
} from "./helpers/meter-canvas";
import { modifierShortcut } from "./helpers/modifier-shortcut";
import { fixtureMap, openFixture } from "./helpers/openFixture";
import { audioPaletteSignatureForSnapshot, cloneValue } from "./helpers/view-models";

// plan PR 4 / workstream D4: audio workspace specs split out of
// operator-shell.spec.ts. Covers rendering, meters, snapshots, EQ +
// dynamics, hardware preamps, command palette, layout, and the pure-logic
// formatter/view-model assertions. Describe-block organization
// (snapshots / meters / EQ-dynamics / hardware-preamp) is a follow-up
// once D3 has migrated the pure-logic cases out to Vitest.

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
  // Slice 7 (Phase 3): "OSC NOT VERIFIED — never attempted" demotes from a
  // full-width warning banner to an inline attention dot next to the Sync
  // button. The fixture's `lastConsoleSyncAt: null` puts it in the demoted
  // state; the dot's title still carries the OSC NOT VERIFIED text for
  // hover / screen-reader access.
  const statusDot = page.getByTestId("audio-toolbar-status-dot");
  await expect(statusDot).toBeVisible();
  await expect(statusDot).toHaveAttribute("title", /OSC NOT VERIFIED/);
  await expect(page.getByTestId("audio-warning-band")).toHaveCount(0);
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
  // Plan PR 1 bumped this (and two sibling polls below) from 1_500 → 5_000:
  // tight enough to flake on ubuntu-latest CI under 3-worker load. Plan PR 5
  // (workstream D8) should root-cause why the first meter sample takes >1.5s
  // on slower hardware.
  await expect
    .poll(async () => (await readMeterCanvasSample(page, "audio-strip-audio-input-9")).checksum, { timeout: 5_000 })
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
    .poll(async () => (await readMeterCanvasSample(page, "audio-strip-audio-input-9")).checksum, { timeout: 5_000 })
    .toBeGreaterThan(0);
  // plan PR 5 / D8 flake sweep: load-bearing wait. We just observed the
  // first meter sample; this 900 ms window proves the engine doesn't
  // refresh `audio.snapshot` per meter tick. Replacing with `expect.poll`
  // would invert the assertion (we want to assert absence of further
  // requests over the window, not presence).
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
    .poll(async () => (await readMeterCanvasSample(page, "audio-strip-audio-input-9")).checksum, { timeout: 5_000 })
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
