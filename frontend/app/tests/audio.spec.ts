import { expect, test } from "@playwright/test";
import type { AudioSnapshot } from "@sse/engine-client";

import { audioMeterEntryFromRecord } from "../../packages/engine-client/src/store/createShellStore";
import {
  calculateNextFixturePeakHold,
  createFixtureTransport,
} from "../../packages/engine-client/src/transports/fixtureTransport";
import {
  AUDIO_FADER_UNITY,
  dbfsToMeterPercent,
  faderDbToNormalized,
  formatAudioDb,
  formatMeterDb,
  meterTone,
  normalizedToDbfs,
  normalizedToFaderDb,
} from "../src/app/audio/audioFormatting";

import { AUDIO_ARM_MIN_DWELL_MS } from "../src/app/audio/audioConstants";
import {
  NARROW_PREAMP_ASPECT_RATIO,
  expectAudioInspectorPanelsFit,
  expectAudioLaneCardsInsideTierGrids,
  expectAudioOverviewProcessingStack,
  expectAudioStudioSideRailsFilled,
  expectAudioWorkspaceGeometry,
  expectSliderValueChanges,
  expectSnapshotActionsDoNotOverlapContent,
  readSnapshotThumbHeights,
  revealPlateSection,
  saveAudioSnapshot,
} from "./helpers/audio";
import {
  expectAspectRatio,
  expectNoDocumentScroll,
  expectNoElementOverflow,
  expectNoHorizontalOverflow,
  readRequiredBox,
} from "./helpers/geometry";
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
  // 2026-09 audit Slice 9: the 2560 surface is desktop density — six playback
  // pairs on the first bank.
  await expect(workspace).toHaveAttribute("data-density", "desktop");
  await expect(
    page.locator('[data-testid="audio-tier-lanes-software-playback"] [data-testid^="audio-strip-"]')
  ).toHaveCount(6);
  // 2026-05-27 redesign: a single amber accent (#f5a524) replaces the
  // per-output cyan (#5dc5e8). --audio-accent now resolves to --accent for
  // every output role.
  await expect
    .poll(() => workspace.evaluate((element) => getComputedStyle(element).getPropertyValue("--audio-accent").trim()))
    .toBe("#f5a524");
  await expect(workspace.getByText("Main Out").first()).toBeVisible();
  await expect(page.getByTestId("audio-signal-canvas")).toBeVisible();
  // 2026-05-27 redesign: the dense context bar was slimmed; AudioSignalCanvas
  // no longer renders an "Editing" label.
  await expect(page.getByTestId("audio-signal-canvas").getByText("View", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("audio-signal-canvas").getByRole("button", { name: "Submix" })).toHaveCount(0);
  await expect(page.getByTestId("audio-signal-canvas").getByRole("button", { name: "Touch" })).toHaveCount(0);
  await expect(page.getByTestId("audio-tiered-mixer")).toBeVisible();
  await expect(page.getByTestId("audio-hardware-inputs-tier")).toBeVisible();
  await expect(page.getByTestId("audio-software-playback-tier")).toBeVisible();
  await expect(page.getByTestId("audio-hardware-outputs-tier")).toBeVisible();
  await expect(page.getByTestId("audio-health-bar")).toBeVisible();
  await expectAudioWorkspaceGeometry(page);
  // 2026-05-27 redesign: the decorative master-halo glow lived on the rail
  // monitor card (AudioRail.tsx), now dead code — the top bar + monitor bar
  // replaced the rail, so the halo no longer renders.
  await expect(page.getByTestId("audio-master-halo")).toHaveCount(0);
  await expect(page.getByTestId("audio-routing-overlay")).toHaveCount(0);
  // GS-AUD-45 (now 2026-05-27 redesign): OSC / Metering live in the
  // AudioTopBar stat cluster; Endpoint is dropped from the chrome entirely.
  // The footer keeps only the temporal facts.
  // Visual overhaul A, Slice 4 (system §2): the shell's footer carries the
  // Console's telemetry — the console link, the metering source, the last sync
  // and the bank. Old: the top bar's stat cluster carried OSC / Metering and
  // the footer carried Clock / Last sync.
  await expect(page.getByTestId("audio-footer-telemetry")).toContainText("Console");
  await expect(page.getByTestId("audio-footer-telemetry")).toContainText("Metering");
  await expect(page.getByTestId("audio-footer-telemetry")).toContainText("Last sync");
  await expect(page.getByTestId("audio-footer-telemetry")).toContainText("Bank");
  await expect(page.getByTestId("audio-footer-telemetry")).not.toContainText("Endpoint");
  // 2026-05-27 redesign: Endpoint is no longer surfaced on the chrome.
  // OSC / Metering live in the AudioTopBar stat cluster (no testid on the
  // cluster itself yet; assert via topbar text).
  await expect(page.getByTestId("audio-topbar")).toHaveCount(0);
  await expect(page.getByTestId("audio-footer-shortcuts")).toContainText("Command palette");
  await expect(page.getByTestId("audio-footer-shortcuts")).toContainText("Shortcuts");
  // Old: "Bank prev" / "Bank next" as two hints; the A footer prints one
  // `[ ] Bank` hint pair and the talkback hold (system §2).
  await expect(page.getByTestId("audio-footer-shortcuts")).toContainText("Bank");
  await expect(page.getByTestId("audio-footer-shortcuts")).toContainText("hold to talk");
  await expect(page.getByTestId("audio-footer-shortcuts")).not.toContainText("Shift 1-8 recall");
  await expect(page.getByTestId("audio-footer-shortcuts")).not.toContainText("Esc clear");
  // 2026-05-27 redesign: monitor controls moved from the rail card to the
  // new AudioMonitorBar (footer). The master-meter dB readout is on
  // `audio-monitor-master-meter`; assert visibility of the bar itself.
  await expect(page.getByTestId("audio-monitor-bar")).toBeVisible();
  await expect(page.getByTestId("audio-monitor-master-meter")).toBeVisible();
  // The standing actions live in the cluster now (plan D8: the state display's
  // way out duplicates them deliberately).
  await expect(page.getByTestId("audio-topbar-sync")).toContainText("Sync from TotalMix");
  await expect(page.getByTestId("audio-topbar-setup")).toBeEnabled();
  await expect(page.getByTestId("audio-solo-warning-band")).toContainText("solo engaged");
  // Visual overhaul A, Slice 4: the latch is one 40 px row in the cluster
  // (old: a 36 px band across the bay).
  await expect
    .poll(async () => {
      const box = await page.getByTestId("audio-solo-warning-band").boundingBox();
      return Math.round(box?.height ?? 0);
    })
    .toBeLessThanOrEqual(44);
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
  await expect(page.getByTestId("audio-output-audio-mix-main")).toHaveAttribute("data-selected", "true");
  await expect(page.getByTestId("audio-strip-audio-input-9")).toHaveAttribute("data-group", "talent");
  await expect(page.getByTestId("audio-strip-audio-playback-1-2")).toHaveAttribute("data-group", "bed");
  await expect(page.getByTestId("audio-strip-audio-playback-3-4")).toHaveAttribute("data-group", "fx");
  await expect(page.getByTestId("audio-strip-audio-input-9")).toBeVisible();
  await expect(page.getByTestId("audio-strip-audio-input-12")).toBeVisible();
  await expect(page.getByTestId("audio-strip-audio-input-1")).toHaveCount(0);
  await expect(page.getByTestId("audio-strip-audio-playback-3-4")).toHaveAttribute("data-feeding", "true");
  await expect(page.getByRole("heading", { name: "FX 3/4" })).toBeVisible();
  // Visual overhaul A, Slice 4c. Old: the preamp card printed its own eyebrow
  // ("Software" / "Mic / Line Gain"). New: the plate's section head says it.
  // Reason: with no tabs the section head names what the section is, so the
  // card no longer repeats it.
  await expect(page.locator('[data-plate-section="preamp"]')).toContainText("Software");
  await expect(page.getByTestId("audio-inspector-hardware-mini")).toContainText("No playback stats from the driver");
  await expect(page.getByTestId("audio-inspector-channel")).not.toContainText("Buffer status");
  await expect(page.getByTestId("audio-inspector-channel").getByRole("button", { name: "Stereo link" })).toHaveCount(0);
  await expect(page.getByTestId("audio-inspector-hardware-mini")).toContainText("Stereo link");
  await expect(page.getByTestId("audio-inspector-hardware-mini")).toContainText("Auto fade");
  await page.getByTestId("audio-strip-audio-input-9").click();
  await expect(page.locator('[data-plate-section="preamp"]')).toContainText("Preamp");
  await expect(page.getByTestId("audio-inspector-hardware-mini")).toContainText("48V");
  await expect(page.getByTestId("audio-inspector-hardware-mini")).toContainText("Hi-Z");
  await expect(page.getByTestId("audio-inspector-hardware-mini")).toContainText("Polarity");
  await expect(page.getByTestId("audio-inspector-hardware-mini")).toContainText("AutoSet");
  await expect(page.getByTestId("audio-inspector-hardware-mini")).not.toContainText("Pad");
  await page.getByTestId("audio-strip-audio-playback-3-4").click();

  // 2026-05-27 redesign: the AudioTargetPicker output dropdown (a "Main Out
  // selected output target" button that opened an "Audio output targets" menu)
  // was removed. Outputs are now selected directly from the output lanes.
  await page.getByTestId("audio-output-audio-mix-phones-a").click();
  await expect(page.getByTestId("audio-output-audio-mix-phones-a")).toHaveAttribute("data-selected", "true");
  await expect(workspace).toHaveAttribute("data-output-role", "phones-a");
  // 2026-05-27 redesign: per-output accents collapsed to the single amber
  // accent; phones-a no longer recolours --audio-accent to #e8a341.
  await expect
    .poll(() => workspace.evaluate((element) => getComputedStyle(element).getPropertyValue("--audio-accent").trim()))
    .toBe("#f5a524");
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
  await page.waitForTimeout(AUDIO_ARM_MIN_DWELL_MS + 50); // the confirm must come after the arm dwell (Slice 7)
  await page.keyboard.press("Shift+Digit3");
  await expect(page.getByTestId("audio-snapshot-snapshot-interview-block")).toHaveAttribute("data-current", "true");
  await expect(page.getByTestId("audio-toolbar-current-snapshot")).toHaveText("Recalled Interview block");

  // Visual overhaul A, Slice 4c. Old: the plate was a tab strip and this
  // asserted the Preamp tab was selected and its panel visible. New: every
  // section of the plate is present at once. Reason: the plate has no tab row —
  // nothing about the selected strip is hidden behind one.
  await expect(page.locator('[data-plate-section="preamp"]')).toBeVisible();
  await expect(page.getByTestId("audio-inspector-metering")).toContainText("Level L / R");
  await expect(page.getByTestId("audio-inspector-metering")).toContainText("Peak hold");
  await expect(page.getByTestId("audio-inspector-level-readout")).toHaveAttribute("data-meter-readout-mode", "level");
  await expect(page.getByTestId("audio-inspector-peak-hold-readout")).toHaveAttribute(
    "data-meter-readout-mode",
    "peakHold"
  );
  await expect(page.getByTestId("audio-inspector-metering")).toContainText("Nominal ref");
  // 2026-05-27 redesign: Overview mini-preview cards removed; the EQ / Dyn /
  // Routing tabs are the route into processing now.
  // Visual overhaul A, Slice 4c: they are sections of the plate, all present.
  for (const section of ["eq", "dynamics", "send", "meter", "channel"] as const) {
    await expect(page.locator(`[data-plate-section="${section}"]`)).toBeAttached();
  }
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
  await revealPlateSection(page, "eq");
  await page.getByTestId("audio-inspector-eq").getByRole("button", { name: "1", exact: true }).click();
  await expect(page.getByRole("button", { name: "Enable PEQ" })).toBeEnabled();
  await page.getByRole("button", { name: "Enable PEQ" }).click();
  await expect(page.getByRole("button", { name: "Bypass PEQ" })).toHaveAttribute("data-active", "true");
  await revealPlateSection(page, "dynamics");
  await expect(page.getByTestId("audio-inspector-dynamics").getByRole("button", { name: "Comp" })).toBeEnabled();
  await expect(page.getByTestId("audio-dynamics-range")).toContainText("Comp");
  await revealPlateSection(page, "send");
  await expect(page.getByTestId("audio-inspector-sends")).toContainText("Phones 1");
  await expect(page.getByTestId("audio-send-destination-audio-mix-phones-a")).toContainText(/Send|No send|Muted/);
  const preFader = page.getByTestId("audio-inspector-sends").getByRole("button", { name: "Pre fader" }).first();
  await expect(preFader).toBeEnabled();
  await preFader.click();
  await expect(preFader).toHaveAttribute("data-active", "true");

  // Visual overhaul A, Slice 4c. Old: E/D/R/P switched the plate's tabs and the
  // test read `aria-selected` / `aria-keyshortcuts`. New: the same keys bring
  // the section into view, and the test reads where the plate is scrolled to.
  // Reason: with every section present there is nothing to select — the keys
  // take the operator to the part of the plate they want.
  const plateSectionAtTop = async () => {
    return page.evaluate(() => {
      const plate = document.querySelector('[data-testid="audio-inspector"]');
      if (!plate) return null;
      const top = plate.getBoundingClientRect().top;
      let best: { id: string; delta: number } | null = null;
      for (const section of plate.querySelectorAll<HTMLElement>("[data-plate-section]")) {
        const delta = Math.abs(section.getBoundingClientRect().top - top);
        if (!best || delta < best.delta) best = { id: section.dataset.plateSection ?? "", delta };
      }
      return best?.id ?? null;
    });
  };
  await page.keyboard.press("KeyE");
  await expect.poll(plateSectionAtTop).toBe("eq");
  await page.keyboard.press("KeyD");
  await expect.poll(plateSectionAtTop).toBe("dynamics");
  await page.keyboard.press("KeyR");
  await expect.poll(plateSectionAtTop).toBe("send");
  await page.keyboard.press("KeyP");
  await expect.poll(plateSectionAtTop).toBe("preamp");

  // Escape lets the strip go (old: it first backed out of the open tab).
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-plate-section="preamp"]')).toHaveCount(0);
});

test("audio topbar setup action opens the setup workspace", async ({ page }) => {
  await openFixture(page, "audio-populated");

  await page.getByTestId("audio-topbar-setup").click();
  await expect(page.getByText("Setup / Support").first()).toBeVisible();
});

test("renders audio degraded and loading fixture states", async ({ page }) => {
  await openFixture(page, "audio-state-assumed");
  // Visual overhaul A, Slice 4 (plan D1): the state word, the engine's
  // sentence and the way out live in the cluster's state display. Old: the
  // band's title "STATE ASSUMED" above the bay.
  const assumedDisplay = page.getByTestId("audio-state-display");
  await expect(assumedDisplay).toContainText("ASSUMED");
  await expect(assumedDisplay).toContainText(/showing the last state the console confirmed/i);

  await openFixture(page, "audio-not-verified");
  // 2026-09 audit remediation, Slice 1: until the audio probe passes every
  // console write is refused by the engine, so the UI must (a) disable the
  // controls, (b) say why in a full banner, and (c) offer the probe as the
  // way out. The old assertion (Sync enabled + refusal toast after clicking
  // it) encoded the finding this slice fixes.
  const notVerifiedBand = page.getByTestId("audio-state-display");
  await expect(notVerifiedBand).toBeVisible();
  await expect(notVerifiedBand).toContainText("NOT VERIFIED");
  // Visual overhaul A, Slice 4 (plan D8): Sync stands in the cluster's actions
  // whatever the state; the probe is the way out inside the state display.
  // Old: the top bar hid Sync while the console was not verified.
  await expect(page.getByTestId("audio-state-probe")).toBeVisible();
  await expect(page.getByTestId("audio-topbar-probe")).toBeVisible();
  await expect(page.getByRole("slider", { name: "FX 3/4 send level" })).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByRole("button", { name: "Mute Host" })).toBeDisabled();
  await page.getByTestId("audio-state-probe").click();
  // The fixture probe passes, which is exactly what unlocks the console.
  await expect(page.getByTestId("audio-state-display")).not.toContainText("NOT VERIFIED");
  await expect(page.getByTestId("audio-topbar-sync")).toBeEnabled();
  await expect(page.getByRole("slider", { name: "FX 3/4 send level" })).not.toHaveAttribute("aria-disabled", "true");
  await expect(page.getByRole("button", { name: "Mute Host" })).toBeEnabled();

  await openFixture(page, "audio-osc-disabled");
  // The state display carries the engine's word (old: the band's title
  // "OSC DISABLED").
  await expect(page.getByTestId("audio-state-display")).toContainText("DISABLED");
  await expect(page.getByTestId("audio-topbar-sync")).toBeDisabled();

  await openFixture(page, "audio-offline");
  // The state display carries the engine's word and its sentence (old: the
  // band's title "CONSOLE UNREACHABLE").
  await expect(page.getByTestId("audio-state-display")).toContainText("OFFLINE");
  await expect(page.getByText("Console did not answer OSC ping.").first()).toBeVisible();

  await openFixture(page, "audio-action-failed");
  // Visual overhaul A, Slice 4a. Old: the sentence read
  // "AUDIO_SNAPSHOT_RECALL_FAILED · Snapshot slot 3 did not match…". New: the
  // sentence says what happened and the code stands in the display's own code
  // slot. Reason: operator copy never leads with a raw fault code, and the
  // state display is the one place that has somewhere else to put it.
  const failedState = page.getByTestId("audio-state-display");
  await expect(failedState).toContainText("ACTION FAILED");
  await expect(failedState).toContainText("Snapshot slot 3 did not match the current console layout.");
  await expect(failedState).toContainText("AUDIO_SNAPSHOT_RECALL_FAILED");
  await expect(failedState.locator("[data-state-code]")).toHaveText("AUDIO_SNAPSHOT_RECALL_FAILED");

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

// Visual overhaul A, Slice 4b (plan Slice 4, finding C2): when the console is
// locked, every write on the bay is outlined and says why — and the reason is
// on the tier header the operator's hand is reaching for, not only in the
// cluster's state display.
test("audio-not-verified outlines every console write on the bay and prints the reason on each tier header", async ({
  page,
}) => {
  await openFixture(page, "audio-not-verified");

  const reason = "Console controls stay locked until the audio probe passes.";
  for (const tier of ["hardware-inputs", "software-playback", "hardware-outputs"]) {
    await expect(page.getByTestId(`audio-tier-lock-note-${tier}`)).toHaveText("locked · run the audio probe");
  }

  const strip = page.getByTestId("audio-strip-audio-input-9");
  for (const testId of ["audio-lane-phantom-audio-input-9", "audio-lane-gain-audio-input-9"]) {
    const key = strip.getByTestId(testId);
    await expect(key).toHaveAttribute("aria-disabled", "true");
    await expect(key).toHaveAttribute("title", reason);
    expect(await key.evaluate((node) => getComputedStyle(node).borderStyle)).toBe("dashed");
  }
  const fader = strip.getByRole("slider", { name: "Host send level" });
  await expect(fader).toHaveAttribute("aria-disabled", "true");
  await expect(strip.getByRole("button", { name: "Mute Host" })).toBeDisabled();
  await expect(strip.getByRole("button", { name: "Solo Host" })).toBeDisabled();

  // The lock is the engine's, so it lifts the moment the probe passes.
  await page.getByTestId("audio-state-probe").click();
  await expect(page.getByTestId("audio-tier-lock-note-hardware-inputs")).toHaveCount(0);
  await expect(strip.getByTestId("audio-lane-gain-audio-input-9")).not.toHaveAttribute("aria-disabled", "true");
});

// Visual overhaul A, Slice 4b (plan Slice 4): with no console there is no
// signal, so the strips' meters are empty wells and their readouts print what
// the desk last said rather than inventing movement.
test("audio-offline empties the strip meters", async ({ page }) => {
  await openFixture(page, "audio-offline");

  const strip = page.getByTestId("audio-strip-audio-input-9");
  await expect(strip).toBeVisible();
  const meter = strip.locator("[data-meter]");
  await expect(meter).toHaveCount(1);
  await expect(meter).toHaveAttribute("data-empty", "");
  await expect(meter.locator("[data-signal='meter']")).toHaveCount(0);
  await expect(strip.getByTestId("audio-lane-readout-audio-input-9")).toBeVisible();
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

  // Visual overhaul A, Slice 4b. Old: the strip's meter was
  // `[data-meter-component="stereo"]`. New: `[data-meter]`. Reason: the strip
  // composes the design system's meter; the inspector keeps the tall Console
  // meter until Slice 4c.
  const meter = page.getByTestId("audio-strip-audio-input-9").locator("[data-meter]").first();
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
  // 2026-05-27 redesign: the rail Trust panel is gone. The simulated metering
  // label moved to the AudioTopBar's Metering stat cell ("test simulation").
  // The rail-card "Active mix · test meters" copy is retired (no replacement
  // — the monitor bar shows only the active master meter).
  // The metering source is a footer item now (old: the top bar's stat cell).
  await expect(page.getByTestId("audio-footer-telemetry")).toContainText("Test meter simulation");
  await expect(page.getByTestId("audio-inspector-metering")).toContainText("TEST STAGE");

  // Visual overhaul A, Slice 4b. Old: every strip meter assertion read
  // `[data-meter-component="stereo"]` and its `--audio-meter-*` custom
  // properties. New: `[data-meter]` and the design system's `--meter-level` on
  // each bar. Reason: the strip composes the design system's meter, which fills
  // by the same dBFS scale and still names its track, fill and peak. What is
  // checked is unchanged: the strip meters move under simulation, a mono strip
  // mirrors one level, and nothing about them animates or transitions.
  const hostMeter = page.getByTestId("audio-strip-audio-input-9").locator("[data-meter]");
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
  // Old: the fill was a transformed layer, so the guard read `transform` and
  // `will-change`. New: the design system's fill is the bar's own height, so
  // the guard reads that it has one. Reason: the meter is the design system's;
  // what the guard is for — the fill moves without animating — is unchanged.
  expect(await stripFill.evaluate((node) => getComputedStyle(node).height)).not.toBe("0px");
  // A mono source mirrors one level: it renders one bar, not two.
  await expect(hostMeter.locator("[data-meter-track]")).toHaveCount(1);
  const stripPeak = hostMeter.locator('[data-meter-peak="left"]').first();
  await expect(stripPeak).toBeVisible();
  expect(await stripPeak.evaluate((node) => getComputedStyle(node).animationName)).toBe("none");
  expect(await stripPeak.evaluate((node) => getComputedStyle(node).transitionDuration)).toBe("0s");
  const stripPeakColor = await stripPeak.evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(stripPeakColor).not.toBe("rgba(0, 0, 0, 0)");
  const stripPeakPosition = await stripPeak.evaluate((node) => (node as HTMLElement).style.bottom);
  expect(stripPeakPosition).not.toBe("");

  const inspectorPeak = page.getByTestId("audio-inspector-metering").locator('[data-meter-peak="left"]').first();
  await expect(inspectorPeak).toBeVisible();
  expect(await inspectorPeak.evaluate((node) => getComputedStyle(node).animationName)).toBe("none");
  expect(await inspectorPeak.evaluate((node) => getComputedStyle(node).transitionDuration)).toBe("0s");

  await expect(page.getByTestId("audio-strip-audio-input-10").locator("[data-meter]")).toHaveCount(1);
  await expect(page.getByTestId("audio-strip-audio-input-11").locator("[data-meter]")).toHaveCount(1);
  await expect(page.getByTestId("audio-strip-audio-input-12").locator("[data-meter]")).toHaveCount(1);
  const readSeededLevels = async () => {
    const levels: number[] = [];
    for (const testId of [
      "audio-strip-audio-input-9",
      "audio-strip-audio-input-10",
      "audio-strip-audio-input-11",
      "audio-strip-audio-input-12",
    ]) {
      levels.push(
        await page
          .getByTestId(testId)
          .locator("[data-meter-track]")
          .first()
          .evaluate((node) => Number.parseFloat(getComputedStyle(node).getPropertyValue("--meter-level")) * 100)
      );
    }
    return levels;
  };
  for (const seededLevel of await readSeededLevels()) {
    expect(seededLevel).toBeGreaterThanOrEqual(20);
    expect(seededLevel).toBeLessThanOrEqual(96);
  }
  // Four independently-seeded speech envelopes can momentarily round to the
  // same integer, so a single instantaneous sample flakes (CI run
  // 31616596501). Poll across sim ticks instead: genuinely distinct seeds
  // diverge within a tick or two, while a real everything-identical seeding
  // regression stays collapsed and still times out red.
  await expect
    .poll(async () => new Set((await readSeededLevels()).map((value) => Math.round(value))).size, { timeout: 5_000 })
    .toBeGreaterThan(1);

  const programPlaybackMeter = page.getByTestId("audio-strip-audio-playback-1-2").locator("[data-meter]");
  await expect(programPlaybackMeter).toHaveCount(1);
  // 2026-05-27 redesign: the rail's "Active mix" mini-meter (audio-active-mix-meter)
  // was removed with the rail; the monitor bar's master meter replaced it. The
  // strip/inspector meter no-animation guards above already cover the
  // "simulated metering must not CSS-animate" contract.
  const firstCanvasSample = await readMeterCanvasSample(page, "audio-strip-audio-input-9");
  await expect
    .poll(async () => (await readMeterCanvasSample(page, "audio-strip-audio-input-9")).checksum, { timeout: 1_800 })
    .not.toBe(firstCanvasSample.checksum);

  await openFixture(page, "audio-hardware-metering");
  await expect(page.getByTestId("audio-meter-simulation-chip")).toHaveCount(0);
  // 2026-05-27 redesign: rail card with the "Active mix · live" eyebrow is
  // gone. The Metering stat cell on the AudioTopBar shows the live metering
  // label (footerTelemetry.metering) instead of the "test simulation" copy.
  await expect(page.getByTestId("audio-footer-telemetry")).not.toContainText("Test meter simulation");
  await expect(page.locator("[data-simulated-meter]")).toHaveCount(0);
  await expect(page.getByTestId("audio-strip-audio-playback-3-4").locator("[data-simulation-profile]")).toHaveCount(0);
  // Visual overhaul A, Slice 4b. Old: the scale was read from the labels inside
  // the strip's meter ("0", "-6" … "-60", the dBFS marks). New: it is read from
  // the strip's fader scale beside the groove ("+6" … "-60"). Reason: the strip
  // now prints the scale the fader is set against, where the operator's hand
  // is; the meter's own −18 dBFS reference stays on the meter. The level is
  // still the desk's, on the same dBFS fill.
  const hardwareMeterVars = await page.getByTestId("audio-strip-audio-input-9").evaluate((strip) => {
    const track = strip.querySelector("[data-meter-track]");
    return {
      left: track ? Number.parseFloat(getComputedStyle(track).getPropertyValue("--meter-level")) * 100 : Number.NaN,
      scaleLabels: Array.from(strip.querySelectorAll("[data-fader-scale-mark]"))
        .map((entry) => entry.textContent?.trim())
        .filter(Boolean),
    };
  });
  expect(hardwareMeterVars.left).toBeCloseTo(((20 * Math.log10(0.72) + 60) / 60) * 100, 1);
  expect(hardwareMeterVars.scaleLabels).toEqual(
    expect.arrayContaining(["+6", "0", "-6", "-12", "-20", "-30", "-40", "-60"])
  );
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
          volume: mixTarget.id === "audio-mix-main" ? AUDIO_FADER_UNITY : mixTarget.volume,
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

  const unity = await readSingleSourceSubmix(AUDIO_FADER_UNITY);
  expect(unity.main.meterLevel).toBeCloseTo(unity.host.meterLevel, 4);

  const minusTen = await readSingleSourceSubmix(faderDbToNormalized(-10));
  expect(minusTen.main.meterLevel / minusTen.host.meterLevel).toBeCloseTo(10 ** (-10 / 20), 4);
});

test("supports audio warning-band sync and keyboard mix-target changes", async ({ page }) => {
  await openFixture(page, "audio-state-assumed");

  // Visual overhaul A, Slice 4 (plan D8): the way out is a key inside the
  // state display and the same command stands in the cluster's actions. Old:
  // "Sync now" / "Setup" buttons on the band, focused and confirmed with Enter.
  const stateDisplay = page.getByTestId("audio-state-display");
  await expect(stateDisplay).not.toContainText("Esc clear");
  await expect(page.getByTestId("audio-state-sync")).toBeEnabled();
  await expect(page.getByTestId("audio-topbar-setup")).toBeEnabled();
  await page.getByTestId("audio-state-sync").press("Enter");
  await expect(stateDisplay).not.toContainText("ASSUMED");

  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("audio-strip-audio-playback-5-6")).toHaveAttribute("data-selected", "true");
  await expect(page.getByTestId("audio-signal-canvas").getByRole("button", { name: "Master" })).toHaveCount(0);

  await openFixture(page, "audio-osc-disabled");
  await expect(page.getByTestId("audio-state-display")).toContainText("DISABLED");
  await expect(page.getByTestId("audio-topbar-sync")).toBeDisabled();
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
  // 2026-05-27 redesign: the channel name moved into the inspector's slimmed
  // sticky identity header (an <h2>), outside the audio-inspector-channel
  // tabpanel. Assert FX 3/4's inspector is shown via that header heading.
  await expect(page.getByRole("heading", { name: "FX 3/4" })).toBeVisible();
  await page.getByTestId("audio-output-audio-mix-phones-a").click();
  await expect(page.getByTestId("audio-output-audio-mix-phones-a")).toHaveAttribute("data-selected", "true");
  // Visual overhaul A, Slice 4c. Old: selecting an output selected the Output
  // tab and hid the EQ / Dyn / Routing tabs. New: the plate carries the
  // output's own section and none of the channel's. Reason: no tab row — what
  // the plate shows is what the selection has.
  await expect(page.locator('[data-plate-section="output"]')).toBeVisible();
  for (const section of ["eq", "dynamics", "send", "preamp"] as const) {
    await expect(page.locator(`[data-plate-section="${section}"]`)).toHaveCount(0);
  }
  await expect(page.getByTestId("audio-inspector-output")).toContainText("Phones 1");
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
  // Visual overhaul A, Slice 4c. Old: the no-channel overview card printed
  // "Output processing". New: the output's own plate section prints the mix,
  // its level and its metering. Reason: the overview cards were the tabbed
  // plate's way of previewing what a tab held; with every section visible there
  // is nothing to preview.
  await expect(page.getByTestId("audio-inspector-output")).toContainText("Monitor level");

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

  // 2026-05-27 redesign: the preamp card eyebrow is now "Mic / Line Gain"
  // (was "Hardware") and hosts an SVG rotary knob; the 48V / Hi-Z / Polarity
  // / AutoSet toggles stay.
  // Visual overhaul A, Slice 4c: the words moved to the plate's section head.
  await expect(page.locator('[data-plate-section="preamp"]')).toContainText("mic / line gain on the UFX III");
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
  await expect(phantom).toHaveAttribute("data-armed", "true");
  // 2026-09 audit Slice 7: a second click inside the dwell is a double-click,
  // not a confirm — 48V must not move and the arm must stay.
  await phantom.click();
  await expect(phantom).toHaveAttribute("data-armed", "true");
  await expect(phantom).toHaveAttribute("data-active", phantomBefore ?? "");
  await page.waitForTimeout(AUDIO_ARM_MIN_DWELL_MS + 50);
  await phantom.click();
  await expect(phantom).not.toHaveAttribute("data-active", phantomBefore ?? "");

  const autoSet = inspector.getByRole("button", { name: "AutoSet" });
  await expect(autoSet).toBeEnabled();
  await autoSet.click();
  await expect(autoSet).toHaveAttribute("data-active", "true");
});

test("supports audio solo chip and clip clearing", async ({ page }) => {
  await openFixture(page, "audio-populated");

  // Visual overhaul A, Slice 4 (system §7): a latched state the operator must
  // see from anywhere is a latch in the cluster. Old: a warning band on the
  // bay floor with a per-channel "×" chip; the latch clears every solo at once.
  await expect(page.getByTestId("audio-solo-warning-band")).toBeVisible();
  await page.getByTestId("audio-solo-warning-band").getByRole("button", { name: "Clear all solo" }).click();
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

  // Visual overhaul A, Slice 4c: peak hold is a key in the plate's Meter
  // section (old: a switch on the Outputs tier header with `data-active`), so
  // its engaged state is `aria-pressed`.
  await expect(peakHoldToggle).toHaveAttribute("aria-pressed", "true");
  await expect(meterCanvas).toHaveAttribute("data-meter-peak-hold-enabled", "true");
  await expect(peakHoldReadout).toHaveAttribute("data-meter-peak-hold-enabled", "true");

  await peakHoldToggle.click();
  await expect(peakHoldToggle).toHaveAttribute("aria-pressed", "false");
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
  await faderDialog.getByLabel("Fader level").fill("-65"); // off on RME's curve (2026-09 audit Slice 5)
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
  // Visual overhaul A, Slice 4a. Old: the save / rename / delete keys were a
  // row under every slot and were asserted visible with the pointer away. New:
  // they live in the slot's float with the preview, so they appear on hover or
  // keyboard focus. Reason: the resting slot is the mock's — the name and when
  // it was last recalled — and the deliberate actions come with the preview of
  // what they would change.
  const snapshotActions = currentSnapshot.getByTestId("audio-snapshot-actions-snapshot-show-open");
  await expect(snapshotActions).toBeHidden();
  await currentSnapshot.hover();
  await expect(snapshotActions).toBeVisible();
  await expect(currentSnapshot.getByText("18 sources saved")).toBeVisible();
  const recallSurface = currentSnapshot.locator("button").first();
  // Visual overhaul A, Slice 4 (system §6): one focus ring, on keyboard focus
  // only — so the ring is asserted after a real Tab, not a programmatic focus.
  await currentSnapshot.getByRole("button", { name: /Arm save|Apply save/ }).focus();
  await page.keyboard.press("Shift+Tab");
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

  await expect(page.getByTestId("audio-output-audio-mix-main")).toHaveAttribute("data-selected", "true");
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
  await faderDialog.getByLabel("Fader level").fill("-65"); // off on RME's curve (2026-09 audit Slice 5)
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
  await revealPlateSection(page, "eq");
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
  // 2026-05-27 Console redesign: the EQ tab now shows every band's knobs +
  // type controls at once (all-bands grid) instead of a single-active-band
  // tray. Band-type assertions scope to band 2's card, and the knob counts
  // reflect all three PEQ bands (Low Cut has only a cutoff knob, no "EQ" knob).
  const bandTwoCard = page.getByTestId("audio-eq-band-card-2");
  await expect(page.getByTestId("audio-eq-control-tray")).toContainText("Band 2");
  await expect(page.getByRole("button", { name: "Enable PEQ" })).toBeVisible();
  await expect(bandTwoCard.getByRole("button", { name: "Bell", exact: true })).toBeDisabled();
  await expect(bandTwoCard.getByRole("button", { name: "Low Shelf", exact: true })).toHaveCount(0);
  await expect(page.getByRole("slider", { name: /Host .* EQ frequency/ })).toHaveCount(3);
  await expect(page.getByRole("slider", { name: /Host .* EQ Q/ })).toHaveCount(3);
  await expect(page.getByRole("slider", { name: /Host .* EQ gain/ })).toHaveCount(3);
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
  await revealPlateSection(page, "dynamics");
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
  await revealPlateSection(page, "send");
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

test("snapshot recall reports the push and lists 48V differences without touching them", async ({ page }) => {
  // 2026-09 audit remediation, Slice 4: a recall pushes the snapshot to the
  // desk and reports what the console confirmed; 48V is never pushed and each
  // difference gets its own armed confirm in the report band.
  await openFixture(page, "audio-populated");
  const hostStrip = page.getByTestId("audio-strip-audio-input-9");
  // Visual overhaul A, Slice 4b. Old: the strip printed a read-only "48V"
  // badge. New: 48 V is a hazard key on the strip that lights when it is on.
  // Reason: the one control that can damage a source is on the strip, armed,
  // where the operator can see and change it. What this test checks is
  // unchanged: a recall lists the 48 V difference and never pushes it.
  const hostPhantom = hostStrip.getByTestId("audio-lane-phantom-audio-input-9");
  await expect(hostPhantom).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("Shift+Digit3");
  await expect(page.getByTestId("audio-snapshot-snapshot-interview-block")).toHaveAttribute("data-armed", "true");
  await page.waitForTimeout(AUDIO_ARM_MIN_DWELL_MS + 50);
  await page.keyboard.press("Shift+Digit3");

  const report = page.getByTestId("audio-recall-report");
  await expect(report).toBeVisible();
  await expect(report).toContainText("Recalled Interview block");
  await expect(report).toContainText("values pushed");
  await expect(report).toContainText("48V differs on Host (snapshot off, console on)");
  // The 48 V key did not move: the recall listed it instead of pushing it.
  await expect(hostPhantom).toHaveAttribute("aria-pressed", "true");

  const arm = page.getByTestId("audio-recall-arm-phantom-audio-input-9");
  await expect(arm).toHaveText(/Arm 48V off/);
  await arm.click();
  await expect(arm).toHaveAttribute("data-armed", "true");
  await expect(arm).toHaveText(/Confirm 48V off/);
  await page.waitForTimeout(AUDIO_ARM_MIN_DWELL_MS + 50);
  await arm.click();
  await expect(hostStrip.getByText("48V", { exact: true })).toHaveCount(0);

  await page.getByTestId("audio-recall-report-dismiss").click();
  await expect(report).toHaveCount(0);
});

test("audio command palette snapshot recall arms before applying", async ({ page }) => {
  await openFixture(page, "audio-populated");

  await page.keyboard.press(modifierShortcut("K"));
  await page.getByPlaceholder(/Type a command/i).fill("snapshot 1");
  await page.getByRole("option", { name: /Recall snapshot 1/ }).click();
  await expect(page.locator('[data-snapshot-slot][data-armed="true"]')).toHaveCount(1);
  await page.waitForTimeout(AUDIO_ARM_MIN_DWELL_MS + 50);

  await page.keyboard.press(modifierShortcut("K"));
  await page.getByPlaceholder(/Type a command/i).fill("snapshot 1");
  await page.getByRole("option", { name: /Recall snapshot 1/ }).click();
  await expect(page.locator('[data-snapshot-slot][data-armed="true"]')).toHaveCount(0);
});

test("formats audio faders with RME's TotalMix fader curve", () => {
  // 2026-09 audit Slice 5: RME's published curve, unity at step 836 of 1023.
  // The old assertions here (0.7 = -10 dB, 0.8 = 0 dB) pinned a prototype law.
  expect(normalizedToFaderDb(0)).toBe(Number.NEGATIVE_INFINITY);
  expect(normalizedToFaderDb(0.5)).toBeCloseTo(-12.125, 2);
  expect(normalizedToFaderDb(AUDIO_FADER_UNITY)).toBeCloseTo(0, 5);
  expect(normalizedToFaderDb(1)).toBeCloseTo(6, 5);
  expect(faderDbToNormalized(0)).toBeCloseTo(836 / 1023, 5);
  expect(faderDbToNormalized(-6)).toBeCloseTo(649 / 1023, 5);
  expect(formatAudioDb(AUDIO_FADER_UNITY)).toBe("0.0 dB");
  expect(formatAudioDb(0.8)).toBe("-0.6 dB");
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
  // Visual overhaul A, Slice 4b. Old: "0.0dB". New: "0.0 dB". Reason: the
  // strip's value is the design system's readout, which prints the unit the way
  // every other printed value in the program does.
  await expect(page.getByTestId("audio-strip-audio-playback-3-4")).toContainText("0.0 dB");

  await fxFader.focus();
  await page.keyboard.press("Enter");
  faderDialog = page.getByRole("dialog", { name: /Set FX 3\/4 send level/i });
  await expect(faderDialog).toBeVisible();
  await faderDialog.getByLabel("Fader level").fill("-65"); // off on RME's curve (2026-09 audit Slice 5)
  await faderDialog.getByRole("button", { name: "Set" }).click();
  await expect(page.getByTestId("audio-strip-audio-playback-3-4")).toHaveAttribute("data-no-send", "true");

  await page.keyboard.press("KeyU");
  await expect(page.getByTestId("audio-strip-audio-playback-3-4")).toContainText("0.0 dB");
});

test("audio preamp gain on the strip is a key that types and nudges", async ({ page }) => {
  // Visual overhaul A, Slice 4b. Old: "audio preamp gain control responds to
  // pointer drag" — the strip carried a 32 px knob and the test dragged it.
  // New: the strip carries a key that prints the gain the desk reports, opens
  // typed entry when pressed and nudges a whole dB with the arrows. Reason:
  // system §7 gives the strip a gain key; riding the gain by hand stays on the
  // plate's knob, which keeps its own drag test
  // ("inspector preamp gain knob only reports whole-dB values") — so no way of
  // setting gain was lost.
  await openFixture(page, "audio-populated");

  const hostGain = page.getByTestId("audio-lane-gain-audio-input-9");
  await expect(hostGain).toBeVisible();
  await expect(hostGain).toContainText("dB");
  const beforeGain = (await hostGain.textContent())?.trim();

  await hostGain.focus();
  await page.keyboard.press("ArrowUp");
  await expect.poll(async () => (await hostGain.textContent())?.trim()).not.toBe(beforeGain);

  await hostGain.click();
  const gainDialog = page.getByRole("dialog", { name: /Set Host preamp gain/i });
  await expect(gainDialog).toBeVisible();
  await gainDialog.getByLabel("Preamp gain").fill("12");
  await gainDialog.getByRole("button", { name: "Set" }).click();
  await expect(hostGain).toContainText("12 dB");
});

test("inspector preamp gain knob only reports whole-dB values", async ({ page }) => {
  await openFixture(page, "audio-populated");
  await page.getByTestId("audio-strip-audio-input-9").click();

  // The engine rejects fractional preamp gain ("gain must be an integer"), so
  // the inspector hero knob must only ever commit / report whole dB. Regression
  // guard: it used to use step 0.5 and display "35.0", which the engine bounced.
  const heroGain = page.getByTestId("audio-inspector-hardware-mini").getByRole("slider", { name: "Host preamp gain" });
  await expect(heroGain).toBeVisible();
  const before = await heroGain.getAttribute("aria-valuenow");
  const box = await heroGain.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2, box!.y - 40, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => heroGain.getAttribute("aria-valuenow")).not.toBe(before);
  const dragged = await heroGain.getAttribute("aria-valuenow");
  expect(Number.isInteger(Number(dragged)), `dragged gain ${dragged} must be a whole dB`).toBe(true);

  await heroGain.focus();
  await page.keyboard.press("ArrowDown");
  const stepped = await heroGain.getAttribute("aria-valuenow");
  expect(Number.isInteger(Number(stepped)), `keyboard gain ${stepped} must be a whole dB`).toBe(true);
});

test("renders audio scaled studio preview as the 2560 studio surface", async ({ page }) => {
  const readAudioLayoutDetails = async () =>
    page.evaluate(() => {
      const root = document.querySelector("[data-operator-layout-root]");
      const tieredMixer = document.querySelector('[data-testid="audio-tiered-mixer"]');
      const hostLane = document.querySelector('[data-testid="audio-strip-audio-input-9"]');
      return {
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
  // Visual overhaul A, Slice 4b. Old: the parity check measured the strip's
  // preamp knob (`role="slider"`, 1:1). New: it measures the strip's gain key.
  // Reason: the strip's gain is a key now; what the check is for — the scaled
  // studio preview lays the strip out exactly as the native surface does — is
  // unchanged, and it now compares the two surfaces to each other rather than
  // to a constant.
  const nativeHostGain = page.getByTestId("audio-lane-gain-audio-input-9");
  await expect(page.getByTestId("audio-tiered-mixer")).toBeVisible();
  await expect(nativeHostGain).toBeVisible();
  const nativeDetails = await readAudioLayoutDetails();
  const nativeGainBox = await nativeHostGain.boundingBox();
  expect(nativeGainBox, "native gain key should have a box").not.toBeNull();
  await expectDbfsScaleLabelsInsideMeters(page, "native 2560 studio surface");

  await page.setViewportSize({ width: 1512, height: 982 });
  await openFixture(page, "audio-populated", { operatorReview: "studio" });
  await expect(page.getByTestId("audio-tiered-mixer")).toBeVisible();
  // Slice 9: the preview measures its 2560 logical root, so density stays desktop.
  await expect(page.getByTestId("audio-workspace")).toHaveAttribute("data-density", "desktop");
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
  // 2026-05-27 redesign: the dense canvas context bar was slimmed — the
  // canvasBarLabel ("Editing …") and canvasSelectedMeta ("routed to main out")
  // elements were removed, so the studio-preview parity check drops them and
  // keeps the load-bearing layout-geometry equivalence above.
  await expectAudioLaneCardsInsideTierGrids(page);

  const previewHostGain = page.getByTestId("audio-lane-gain-audio-input-9");
  const previewGainBox = await previewHostGain.boundingBox();
  expect(previewGainBox, "preview gain key should have a box").not.toBeNull();
  expect(
    previewGainBox!.width / previewGainBox!.height,
    "the preview lays the gain key out as the native surface does"
  ).toBeCloseTo(nativeGainBox!.width / nativeGainBox!.height, 1);

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
  // 2026-05-27 redesign: the new top bar adds a "Snapshot" pill, so a bare
  // workspace.getByText("Snapshots") risks a strict-mode clash. Scope to the
  // snapshot deck's own header.
  await expect(page.getByTestId("audio-snapshot-deck").getByText("Snapshots")).toBeVisible();
  await expect(page.getByTestId("audio-signal-canvas").getByRole("button", { name: "Touch" })).toHaveCount(0);
  await expect(page.getByTestId("audio-strip-audio-playback-3-4")).toBeVisible();

  // 2026-09 audit Slice 9 (operator decision 6): below 2200 px the Console runs
  // at compact density — 4 inputs, 4 playback pairs, 3 outputs per bank, a
  // 380 px inspector — and no tier, the mixer, the inspector or the workspace
  // scrolls sideways. The old test read the document only; the tiers scroll
  // inside overflow-x:auto grids under an overflow:hidden shell, so it never
  // saw the 1920 overflow the audit found.
  await expect(workspace).toHaveAttribute("data-density", "compact");
  await expect(
    page.locator('[data-testid="audio-tier-lanes-hardware-inputs"] [data-testid^="audio-strip-"]')
  ).toHaveCount(4);
  await expect(
    page.locator('[data-testid="audio-tier-lanes-software-playback"] [data-testid^="audio-strip-"]')
  ).toHaveCount(4);
  await expect(
    page.locator('[data-testid="audio-tier-lanes-hardware-outputs"] > [data-testid^="audio-output-"]')
  ).toHaveCount(3);
  for (const testId of [
    "audio-tier-lanes-hardware-inputs",
    "audio-tier-lanes-software-playback",
    "audio-tier-lanes-hardware-outputs",
    "audio-tiered-mixer",
    "audio-inspector",
    "audio-workspace",
  ]) {
    await expectNoHorizontalOverflow(page.getByTestId(testId), `1920 ${testId}`);
  }
  // Visual overhaul A, Slice 4a. Old: "1920 inspector width should be 380 px".
  // New (Slice 4c): 360 px, the mock's plate at the 1920 fallback. Reason: the
  // cluster takes its width off the left of the shell and the plate takes the
  // mock's, and the bay holds its banked strips between them without scrolling
  // sideways. The 2560×1440 deliverable (D4) is unchanged.
  const inspectorBox = await readRequiredBox(page, "audio-inspector");
  expect(Math.abs(inspectorBox.width - 360), "1920 plate width should be 360 px").toBeLessThanOrEqual(1);
  // The other two playback pairs are one bank away and come back with "[".
  await expect(page.getByTestId("audio-strip-audio-playback-9-10")).toHaveCount(0);
  await page.keyboard.press("BracketRight");
  await expect(page.getByTestId("audio-strip-audio-playback-9-10")).toBeVisible();
  await expectNoHorizontalOverflow(page.getByTestId("audio-tier-lanes-software-playback"), "1920 playback bank 2");
  await page.keyboard.press("BracketLeft");
  await expect(page.getByTestId("audio-strip-audio-playback-3-4")).toBeVisible();

  await expectAudioWorkspaceGeometry(page);
  await expectAudioLaneCardsInsideTierGrids(page);
  await expectDbfsScaleLabelsInsideMeters(page, "1920 fallback");
  // Visual overhaul A, Slice 4b: the strip's gain is a key, and at the fallback
  // size it still fits its row (old: the knob's 1:1 aspect).
  const fallbackGainBox = await page.getByTestId("audio-lane-gain-audio-input-9").boundingBox();
  expect(fallbackGainBox, "1920 fallback gain key should have a box").not.toBeNull();
  expect(fallbackGainBox!.height, "1920 fallback gain key keeps its target height").toBeGreaterThanOrEqual(24);
  await page.getByTestId("audio-strip-audio-input-9").click();
  // 2026-05-27 redesign: the rail Trust panel and rail Snapshot panel are
  // gone. The chrome at 1920 now hangs the equivalent facts on the AudioTopBar
  // (OSC / Metering stat cluster) and keeps the snapshot deck inline under
  // the mixer (no panel wrapper). Assert the new bars are visible at the
  // 1920 fallback breakpoint.
  // Visual overhaul A, Slice 4a. Old: `audio-topbar` visible and
  // `audio-monitor-bar` visible. New: the cluster (`audio-monitor-bar` on the
  // cluster root) and the shell footer (`audio-health-bar`) are visible and no
  // top bar exists. Reason: the Console's chrome moved into the cluster and the
  // shared footer, so the top bar is gone at every size, not only at 2560.
  await expect(page.getByTestId("audio-topbar")).toHaveCount(0);
  await expect(page.getByTestId("audio-monitor-bar")).toBeVisible();
  await expect(page.getByTestId("audio-health-bar")).toBeVisible();
  // 2026-05-27 redesign: the Overview mini-preview cards (eq-mini / dynamics-mini
  // / sends-mini) were replaced by the EQ / Dyn / Routing tabs; assert those are
  // present for the selected channel at the 1920 fallback.
  // Visual overhaul A, Slice 4c: they are sections of the plate, all present at
  // the fallback size too — the plate scrolls, it does not hide.
  for (const section of ["eq", "dynamics", "send", "meter", "channel"] as const) {
    await expect(page.locator(`[data-plate-section="${section}"]`)).toBeAttached();
  }
  await expectAudioStudioSideRailsFilled(page, 32);
  await expectAudioOverviewProcessingStack(page, "1920 fallback selected-channel", 40);
  await expectSnapshotActionsDoNotOverlapContent(page, "snapshot-show-open");
  await expectAudioInspectorPanelsFit(page);

  await page.getByTestId("audio-output-audio-mix-phones-a").click();
  await expect(page.locator('[data-plate-section="output"]')).toBeVisible();
  await expectDbfsScaleLabelsInsideMeters(page, "1920 fallback output inspector");
  for (const section of ["eq", "dynamics", "send", "preamp"] as const) {
    await expect(page.locator(`[data-plate-section="${section}"]`)).toHaveCount(0);
  }
  // Visual overhaul A, Slice 4c. Old: the two long facts (Clock, Metering) were
  // measured on the retired overview card. New: they are the shell footer's
  // telemetry, measured there. Reason: those facts moved to the footer in
  // Slice 4a and the overview cards are gone with the tab row; the guard is the
  // same one — a long value must not overflow its box at the fallback size.
  const footerFacts = page.getByTestId("audio-footer-telemetry").locator("span");
  const footerFactCount = await footerFacts.count();
  expect(footerFactCount, "footer telemetry should be rendered").toBeGreaterThan(0);
  for (let index = 0; index < footerFactCount; index += 1) {
    await expectNoElementOverflow(footerFacts.nth(index), `1920 footer fact ${index + 1}`);
  }
  await expectNoDocumentScroll(page);
});

// Round-2 close-out (R2-CTX-01): the DS ContextMenu measures itself and
// clamps to the viewport (ContextMenu.tsx flips above/left when the bottom/
// right would clip). No shipped fixture can place a real right-click near
// the viewport edge — the centered mixer never reaches it — so this locks
// the clamp with synthetic edge coordinates dispatched at the strip's
// contextmenu handler, exactly how the close-out probe verified it live.
test("strip context menu clamps to the viewport at the edges", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openFixture(page, "audio-populated");
  await expect(page.locator('[data-testid^="audio-strip-"]').first()).toBeVisible();

  const probe = async (clientX: number, clientY: number, label: string) => {
    await page.keyboard.press("Escape");
    await page.evaluate(
      ([x, y]) => {
        const strip = document.querySelector('[data-testid^="audio-strip-"]');
        strip?.dispatchEvent(
          new MouseEvent("contextmenu", { clientX: x, clientY: y, bubbles: true, cancelable: true })
        );
      },
      [clientX, clientY]
    );
    const menu = page.getByRole("menu").first();
    await expect(menu, `${label}: menu opens`).toBeVisible();
    const box = await menu.boundingBox();
    expect(box, `${label}: menu has a box`).not.toBeNull();
    expect(box!.x, `${label}: fits left`).toBeGreaterThanOrEqual(0);
    expect(box!.y, `${label}: fits top`).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, `${label}: fits right`).toBeLessThanOrEqual(1281);
    expect(box!.y + box!.height, `${label}: fits bottom`).toBeLessThanOrEqual(801);
  };

  await probe(640, 400, "center");
  await probe(1270, 400, "right edge");
  await probe(640, 790, "bottom edge");
  await probe(1270, 790, "corner");
});
