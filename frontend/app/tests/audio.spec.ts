import { expect, test } from "@playwright/test";
import type { AudioSnapshot } from "@sse/engine-client";

import { createFixtureTransport } from "../../packages/engine-client/src/transports/fixtureTransport";
import {
  AUDIO_FADER_UNITY,
  faderDbToNormalized,
  formatAudioDb,
  normalizedToFaderDb,
} from "../src/app/audio/audioFormatting";

import { AUDIO_ARM_MIN_DWELL_MS } from "../src/app/audio/audioConstants";
import {
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
import { expectDbfsScaleLabelsInsideMeters } from "./helpers/meter-canvas";
import { expectWorkspaceMounted, fixtureMap, openFixture } from "./helpers/openFixture";
import { pausePageClock } from "./helpers/pageClock";

// plan PR 4 / workstream D4: audio workspace specs split out of
// operator-shell.spec.ts. Covers rendering, meters, snapshots, EQ +
// dynamics, hardware preamps, layout, and the pure-logic
// formatter/view-model assertions. Describe-block organization
// (snapshots / meters / EQ-dynamics / hardware-preamp) is a follow-up
// once D3 has migrated the pure-logic cases out to Vitest.
// Production readiness S15: the metering cases moved to audio-metering.spec.ts.
// New pages program, Slice 3 (D6): the Console binds no key of its own. The
// cases that drove it by key now click the control that does the same; the
// palette cases went with the palette; the on-screen controls S3 added (the
// bank keys, the plain-click chips, typed entry's Reset key) and the keys a
// focused fader keeps are in audio-onscreen-twins.spec.ts.

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
  // 2026-09 audit Slice 9: the 2560 surface has six playback pairs on the first
  // bank. New pages program, Slice SW (D22): the Console has one density now,
  // so `data-density` went and the count is the check.
  await expect(
    page.locator('[data-testid="audio-tier-lanes-software-playback"] [data-testid^="audio-strip-"]')
  ).toHaveCount(6);
  // 2026-05-27 redesign: a single amber accent (#f5a524) replaces the
  // per-output cyan (#5dc5e8). Read via the canonical --accent since
  // 2026-09-09: --audio-accent was a plain `var(--accent)` alias kept for the
  // dead AudioRail / AudioToolbar hosts, and went when they did. Same value,
  // same guarded fact, now read from the source of truth.
  await expect
    .poll(() => workspace.evaluate((element) => getComputedStyle(element).getPropertyValue("--accent").trim()))
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
  // monitor card (AudioRail.tsx), which the top bar + monitor bar replaced, so
  // the halo stopped rendering. AudioRail.tsx itself was deleted on 2026-09-09
  // when the GS-AUD-44 dead-code posture closed; its sole importer gone, the
  // AudioLiveMasterHalo component in AudioLiveMeterReadout.tsx is now unused,
  // so this count stays 0 for a second reason.
  await expect(page.getByTestId("audio-master-halo")).toHaveCount(0);
  await expect(page.getByTestId("audio-routing-overlay")).toHaveCount(0);
  // GS-AUD-45 (now 2026-05-27 redesign): OSC / Metering live in the
  // AudioTopBar stat cluster; Endpoint is dropped from the chrome entirely.
  // The footer keeps only the temporal facts.
  // Visual overhaul A, Slice 4 (system §2): the shell's footer carries the
  // Console's telemetry — the console link, the metering source, the last sync
  // and the bank. Old: the top bar's stat cluster carried OSC / Metering and
  // the footer carried Clock / Last sync.
  // Slice 8 (system §9): the OSC row is named for what it reports.
  await expect(page.getByTestId("audio-footer-telemetry")).toContainText("OSC control");
  await expect(page.getByTestId("audio-footer-telemetry")).toContainText("Metering");
  await expect(page.getByTestId("audio-footer-telemetry")).toContainText("Last sync");
  await expect(page.getByTestId("audio-footer-telemetry")).toContainText("Bank");
  await expect(page.getByTestId("audio-footer-telemetry")).not.toContainText("Endpoint");
  // 2026-05-27 redesign: Endpoint is no longer surfaced on the chrome.
  // OSC / Metering live in the AudioTopBar stat cluster (no testid on the
  // cluster itself yet; assert via topbar text).
  await expect(page.getByTestId("audio-topbar")).toHaveCount(0);
  // New pages program, Slice 3 (D6). Old: the footer's hint slot printed
  // "Command palette", "Shortcuts", the `[ ] Bank` pair and "Hold to talk".
  // New: the footer has no hint slot. Reason: every key those hints named is
  // gone; the bank is paged with the keys on the Inputs heading, and the
  // "Bank" readout stays in the telemetry (checked above).
  await expect(page.getByTestId("audio-footer-shortcuts")).toHaveCount(0);
  await expect(page.getByTestId("audio-health-bar").locator("kbd")).toHaveCount(0);
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
    // Slice 8 (system §9): an empty slot recalls the desk's own OSC slot, so
    // the preview names TotalMix rather than this workspace.
    page.getByTestId("audio-snapshot-snapshot-open-rehearsal").getByText("TotalMix slot recall")
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
  await expect(page.getByTestId("audio-inspector-hardware-mini")).toContainText("48 V");
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
  // accent; phones-a no longer recolours the accent to #e8a341. Asserted on
  // --accent since 2026-09-09 (see the note at the first check); the
  // [data-output-role] rule that re-declared --audio-accent for phones-a/-b
  // was deleted with the dead hosts, so this is the guard that keeps the
  // "one accent for every output role" decision honest.
  await expect
    .poll(() => workspace.evaluate((element) => getComputedStyle(element).getPropertyValue("--accent").trim()))
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

  // New pages program, Slice 3 (D6, decision 3). Old: `]` paged to bank 2, `1`
  // selected its first strip, `M` muted it and Shift+3 armed then recalled
  // snapshot 3. New: the Inputs heading's Next bank key, a click on the strip,
  // a click on its M key and two presses of snapshot key 3. Reason: the Console
  // binds no key of its own; each of these is the on-screen control that did
  // the same thing all along (the bank key is new with this slice).
  await page.getByTestId("audio-bank-next").click();
  await expect(page.getByTestId("audio-footer-telemetry")).toContainText("2 of 3");

  const selectedStrip = page.getByTestId("audio-strip-audio-input-1");
  // On the strip's name, clear of its fader, which a click mid-strip would move.
  await selectedStrip.click({ position: { x: 12, y: 12 } });
  await expect(selectedStrip).toHaveAttribute("data-selected", "true");

  await selectedStrip.getByRole("button", { name: /Mute/ }).click();
  await expect(selectedStrip.getByRole("button", { name: /Mute/ })).toHaveAttribute("data-active", "true");
  await expect(selectedStrip.getByRole("button", { name: /Mute/ })).toHaveAttribute("aria-pressed", "true");

  const interviewRecall = page.getByTestId("audio-snapshot-recall-snapshot-interview-block");
  await interviewRecall.click();
  await expect(page.getByTestId("audio-snapshot-snapshot-interview-block")).toHaveAttribute("data-armed", "true");
  await page.waitForTimeout(AUDIO_ARM_MIN_DWELL_MS + 50); // the confirm must come after the arm dwell (Slice 7)
  await interviewRecall.click();
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
  const renameDialog = page.getByRole("dialog", { name: "Rename channel" });
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

  // New pages program, Slice 3 (decisions 4 and 6). Old: E / D / R / P brought
  // a plate section into view, then Esc let the strip go. New: the section
  // keys are gone with no replacement (the plate shows every section and
  // scrolls), and a click on the row's heading lets the strip go. Reason: the
  // Console binds no key; the heading (or the empty floor) was the on-screen
  // way all along. The click lands on the heading's name, clear of the bank
  // keys and the group chips.
  await page.getByTestId("audio-tier-label-hardware-inputs").click({ position: { x: 8, y: 12 } });
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
  // Slice 8 (system §9): the hardware is the desk; "the console" is this
  // workspace. The sentence also names the key that gets the operator out.
  await expect(assumedDisplay).toContainText(/showing the last state the desk confirmed/i);
  await expect(assumedDisplay).toContainText(/press sync from totalmix/i);

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
  await expect(page.getByText("Loading the console…")).toBeVisible();
  // The loading surface has an id of its own (2026-09-23): `audio-workspace`
  // means the Console is up, so a spec that waits for it cannot land on this.
  await expect(page.getByTestId("audio-workspace-loading")).toBeVisible();
  await expect(page.getByTestId("audio-workspace")).toHaveCount(0);
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

test("switches audio output targets without a full-domain refresh", async ({ page }) => {
  await page.addInitScript(() => {
    window.__SSE_TEST_ENGINE_REQUEST_COUNTS__ = {};
  });
  await openFixture(page, "audio-populated");
  await expectWorkspaceMounted(page, "audio");

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
    "support.snapshot",
    "controlSurface.snapshot",
  ]) {
    expect((finalCounts[method] ?? 0) - (initialCounts[method] ?? 0), method).toBe(0);
  }
});

// New pages program, Slice 3 (D6). Old name: "supports audio warning-band sync
// and keyboard mix-target changes"; a page-wide ArrowRight then walked the
// selection to the next strip. New: that step is gone and the name says what
// is left. Reason: the arrows only move a focused slider or list now; a click
// on the strip selects it. Enter on the focused Sync key stays (it presses the
// control).
test("supports audio warning-band sync", async ({ page }) => {
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
  // New pages program, Slice 3 (decision 10). Old: Shift+click on Bed added it
  // beside FX. New: a plain click does. Reason: a key held while pointing is a
  // shortcut too; a plain click switches a chip on or off and several can be lit.
  await page.getByTestId("audio-tier-chip-playback-bed").click();
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
  // New pages program, Slice 3 (D6). Old: thirty page-wide ArrowRight presses
  // walked the selection past every strip to the last output, Phones 2. New:
  // gone; the output is selected by a click on it below. Reason: the arrows only
  // move a focused slider or list now.

  await page.getByTestId("audio-tier-chip-inputs-talent").click();
  // Old: one plain click on the lit FX chip cleared the row's filter. New: a
  // plain click turns only that chip off, so FX and then Bed are clicked, and
  // with no chip lit the row shows every strip again (decision 10).
  await page.getByTestId("audio-tier-chip-playback-fx").click();
  await expect(page.getByTestId("audio-tier-chip-playback-fx")).toHaveAttribute("data-active", "false");
  await expect(page.getByTestId("audio-tier-chip-playback-bed")).toHaveAttribute("data-active", "true");
  await page.getByTestId("audio-tier-chip-playback-bed").click();
  await expect(page.getByTestId("audio-tier-chip-playback-bed")).toHaveAttribute("data-active", "false");
  await expect(page.getByTestId("audio-strip-audio-playback-3-4")).toBeVisible();
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
  // The 48 V double-click below runs on a stopped page clock (S13).
  await page.clock.install();
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
  // Slice 8 (system §9): numbers carry their unit with a space.
  await expect(inspector).toContainText("48 V");
  await expect(inspector).toContainText("Hi-Z");
  await expect(inspector).toContainText("Polarity");
  await expect(inspector).toContainText("AutoSet");
  await expect(inspector).not.toContainText("Pad");

  const phantom = inspector.getByRole("button", { name: /48 V/ });
  const phantomBefore = await phantom.getAttribute("data-active");
  await phantom.click();
  await expect(phantom).toHaveAttribute("data-armed", "true");
  await expect(phantom).toHaveText(/Confirm 48 V (on|off)/);
  await expect(phantom).toHaveAttribute("data-active", phantomBefore ?? "");
  await page.keyboard.press("Escape");
  await expect(phantom).not.toHaveAttribute("data-armed", "true");
  await expect(phantom).toHaveText("48 V");
  // Production readiness S13. Old: the second click followed the first in real
  // time and was expected inside the 350 ms dwell. New: the page's clock is
  // stopped for the two presses and moved past the dwell for the confirm.
  // Reason: on a CI runner the two clicks are over a second apart, so the
  // second one confirmed and 48 V moved — nineteen of the branch's first thirty
  // runs (helpers/pageClock.ts). What is checked is unchanged.
  await pausePageClock(page);
  await phantom.click();
  await expect(phantom).toHaveAttribute("data-armed", "true");
  // 2026-09 audit Slice 7: a second click inside the dwell is a double-click,
  // not a confirm — 48V must not move and the arm must stay.
  await phantom.click();
  await expect(phantom).toHaveAttribute("data-armed", "true");
  await expect(phantom).toHaveAttribute("data-active", phantomBefore ?? "");
  await page.clock.fastForward(AUDIO_ARM_MIN_DWELL_MS + 50);
  await page.clock.resume();
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
  await expect(capturedSlot.getByText("No change from the current mix")).toBeVisible();

  await page.getByRole("slider", { name: "FX 3/4 send level" }).focus();
  await page.keyboard.press("Enter");
  const faderDialog = page.getByRole("dialog", { name: /Set FX 3\/4 send level/i });
  await expect(faderDialog).toBeVisible();
  await faderDialog.getByLabel("Fader level").fill("-65"); // off on RME's curve (2026-09 audit Slice 5)
  // New pages program, Slice 3 (decision 8). Old: the key was found by "Set".
  // New: by its whole name, "Set value". Reason: typed entry now also offers
  // "Reset to 0 dB", which a name search for "Set" matches too.
  await faderDialog.getByRole("button", { name: "Set value" }).click();
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
  const renameSnapshotDialog = page.getByRole("dialog", { name: "Rename snapshot" });
  await expect(renameSnapshotDialog).toBeVisible();
  await renameSnapshotDialog.getByLabel("Snapshot name").fill("Renamed snapshot");
  await renameSnapshotDialog.getByRole("button", { name: "Rename" }).click();
  await expect(capturedSlot).toContainText("Renamed snapshot");

  await capturedSlot.hover();
  await capturedSlot.getByRole("button", { name: /Delete/ }).click();
  const deleteSnapshotDialog = page.getByRole("dialog", { name: "Delete snapshot" });
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
  // "Set value" by its whole name: "Reset to 0 dB" matches "Set" too (S3, decision 8).
  await faderDialog.getByRole("button", { name: "Set value" }).click();

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

// New pages program, Slice 3 (D6): "supports audio command palette and
// shortcut overlay parity" went with the palette and the shortcut guide. Every
// command it listed has an on-screen control (the inventory, section 3).

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

  // New pages program, Slice 3 (D6). Old: Shift+3 armed, Shift+3 again
  // recalled. New: snapshot key 3 is pressed twice. Reason: the Console binds
  // no key; the snapshot key is the recall's on-screen control.
  const interviewRecall = page.getByTestId("audio-snapshot-recall-snapshot-interview-block");
  await interviewRecall.click();
  await expect(page.getByTestId("audio-snapshot-snapshot-interview-block")).toHaveAttribute("data-armed", "true");
  await page.waitForTimeout(AUDIO_ARM_MIN_DWELL_MS + 50);
  await interviewRecall.click();

  const report = page.getByTestId("audio-recall-report");
  await expect(report).toBeVisible();
  await expect(report).toContainText("Recalled Interview block");
  await expect(report).toContainText("values pushed");
  await expect(report).toContainText("48 V differs on Host (snapshot off, desk on)");
  // The 48 V key did not move: the recall listed it instead of pushing it.
  await expect(hostPhantom).toHaveAttribute("aria-pressed", "true");

  const arm = page.getByTestId("audio-recall-arm-phantom-audio-input-9");
  await expect(arm).toHaveText(/Arm 48 V off/);
  await arm.click();
  await expect(arm).toHaveAttribute("data-armed", "true");
  await expect(arm).toHaveText(/Confirm 48 V off/);
  await page.waitForTimeout(AUDIO_ARM_MIN_DWELL_MS + 50);
  await arm.click();
  await expect(hostStrip.getByText("48V", { exact: true })).toHaveCount(0);

  await page.getByTestId("audio-recall-report-dismiss").click();
  await expect(report).toHaveCount(0);
});

// New pages program, Slice 3 (D6): "audio command palette snapshot recall arms
// before applying" went with the palette. The snapshot key arms before it
// applies, which audio-arm-countdown.spec.ts proves.

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

test("audio workspace custom faders drag and accept numeric dB entry", async ({ page }) => {
  await openFixture(page, "audio-populated");

  // New pages program, Slice 3 (D6). Old: the case first found "Reset selected
  // fader" in the command palette. New: that step is gone. Reason: the palette
  // went; the strip's right-click "Reset to unity" is checked at the end.
  await expectWorkspaceMounted(page, "audio");

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
  // "Set value" by its whole name: "Reset to 0 dB" matches "Set" too (S3, decision 8).
  await faderDialog.getByRole("button", { name: "Set value" }).click();
  // Visual overhaul A, Slice 4b. Old: "0.0dB". New: "0.0 dB". Reason: the
  // strip's value is the design system's readout, which prints the unit the way
  // every other printed value in the program does.
  await expect(page.getByTestId("audio-strip-audio-playback-3-4")).toContainText("0.0 dB");

  await fxFader.focus();
  await page.keyboard.press("Enter");
  faderDialog = page.getByRole("dialog", { name: /Set FX 3\/4 send level/i });
  await expect(faderDialog).toBeVisible();
  await faderDialog.getByLabel("Fader level").fill("-65"); // off on RME's curve (2026-09 audit Slice 5)
  await faderDialog.getByRole("button", { name: "Set value" }).click();
  await expect(page.getByTestId("audio-strip-audio-playback-3-4")).toHaveAttribute("data-no-send", "true");

  // New pages program, Slice 3 (D6). Old: `U` put the selected strip's send
  // back on unity. New: right-click the strip, then "Reset to unity". Reason:
  // the Console binds no key; the strip's menu was the on-screen way all along.
  await page.getByTestId("audio-strip-audio-playback-3-4").click({ button: "right", position: { x: 12, y: 12 } });
  await page.getByRole("menuitem", { name: "Reset to unity" }).click();
  await expect(page.getByTestId("audio-strip-audio-playback-3-4")).toContainText("0.0 dB");
});

// New pages program, Slice 3 (decision 9). Old name: "audio preamp gain on the
// strip is a key that types and nudges"; the case pressed ArrowUp on the
// focused key and read a new gain. New: that step is gone and the name says the
// key types. Reason: the Gain key is a button, and a button takes no arrows;
// the plate's gain knob takes them (its whole-dB case below presses one).
test("audio preamp gain on the strip is a key that types", async ({ page }) => {
  // Visual overhaul A, Slice 4b. Old: "audio preamp gain control responds to
  // pointer drag" — the strip carried a 32 px knob and the test dragged it.
  // New: the strip carries a key that prints the gain the desk reports and
  // opens typed entry when pressed. Reason: system §7 gives the strip a gain
  // key; riding the gain by hand stays on the plate's knob, which keeps its own
  // drag test ("inspector preamp gain knob only reports whole-dB values") — so
  // no way of setting gain was lost.
  await openFixture(page, "audio-populated");

  const hostGain = page.getByTestId("audio-lane-gain-audio-input-9");
  await expect(hostGain).toBeVisible();
  await expect(hostGain).toContainText("dB");

  await hostGain.click();
  const gainDialog = page.getByRole("dialog", { name: /Set Host preamp gain/i });
  await expect(gainDialog).toBeVisible();
  await gainDialog.getByLabel("Preamp gain").fill("12");
  // "Set value" by its whole name: "Reset to 24 dB" matches "Set" too (S3, decision 8).
  await gainDialog.getByRole("button", { name: "Set value" }).click();
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

// New pages program, Slice SW (D22). Two cases went with the sizes they were
// about — "renders audio scaled studio preview as the 2560 studio surface"
// (Studio Preview) and "keeps the full audio workspace visible at the 1920x1080
// fallback size" — and their geometry guards are this case's, on the studio
// screen itself: the preview ran most of them on the 2560 layout drawn at ~59 %,
// the fallback case the rest at 1920 × 1080.
test("keeps the full audio workspace visible and inside its boxes at 2560x1440", async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1440 });
  await openFixture(page, "audio-populated");

  const workspace = page.getByTestId("audio-workspace");
  await expect(workspace).toBeVisible();
  await expect(page.getByTestId("audio-signal-canvas")).toBeVisible();
  await expect(page.getByTestId("audio-tiered-mixer")).toBeVisible();
  await expect(page.getByTestId("audio-hardware-inputs-tier")).toBeVisible();
  await expect(page.getByTestId("audio-software-playback-tier")).toBeVisible();
  await expect(page.getByTestId("audio-hardware-outputs-tier")).toBeVisible();
  await expect(page.getByTestId("audio-health-bar")).toBeVisible();
  // 2026-05-27 redesign: the top bar adds a "Snapshot" pill, so a bare
  // workspace.getByText("Snapshots") risks a strict-mode clash. Scope to the
  // snapshot deck's own header.
  await expect(page.getByTestId("audio-snapshot-deck").getByText("Snapshots")).toBeVisible();
  await expect(page.getByTestId("audio-signal-canvas").getByRole("button", { name: "Touch" })).toHaveCount(0);

  // A bank at 2560 × 1440: 4 inputs, 6 playback pairs, 3 outputs.
  await expect(
    page.locator('[data-testid="audio-tier-lanes-hardware-inputs"] [data-testid^="audio-strip-"]')
  ).toHaveCount(4);
  await expect(
    page.locator('[data-testid="audio-tier-lanes-software-playback"] [data-testid^="audio-strip-"]')
  ).toHaveCount(6);
  await expect(
    page.locator('[data-testid="audio-tier-lanes-hardware-outputs"] > [data-testid^="audio-output-"]')
  ).toHaveCount(3);
  // 2026-09 audit Slice 9: no tier, the mixer, the plate or the workspace
  // scrolls sideways. The tiers scroll inside overflow-x:auto grids under an
  // overflow:hidden shell, so a document read never sees a lane overflow; each
  // is read by its own scroll width.
  for (const testId of [
    "audio-tier-lanes-hardware-inputs",
    "audio-tier-lanes-software-playback",
    "audio-tier-lanes-hardware-outputs",
    "audio-tiered-mixer",
    "audio-inspector",
    "audio-workspace",
  ]) {
    await expectNoHorizontalOverflow(page.getByTestId(testId), `2560 ${testId}`);
  }
  // Plan D4: the plate is 416 px at 2560 × 1440.
  const plateBox = await readRequiredBox(page, "audio-inspector");
  expect(Math.abs(plateBox.width - 416), "the plate should be 416 px wide").toBeLessThanOrEqual(1);

  await expectAudioLaneCardsInsideTierGrids(page);
  await expectDbfsScaleLabelsInsideMeters(page, "2560 studio surface");
  // Visual overhaul A, Slice 4b: the strip's gain is a key, and it keeps its
  // target height.
  const gainBox = await page.getByTestId("audio-lane-gain-audio-input-9").boundingBox();
  expect(gainBox, "the strip's gain key should have a box").not.toBeNull();
  expect(gainBox!.height, "the strip's gain key keeps its target height").toBeGreaterThanOrEqual(24);

  await page.getByTestId("audio-strip-audio-input-9").click();
  // Visual overhaul A, Slice 4a: the Console's chrome is the cluster and the
  // shell footer; there is no top bar.
  await expect(page.getByTestId("audio-topbar")).toHaveCount(0);
  await expect(page.getByTestId("audio-monitor-bar")).toBeVisible();
  await expect(page.getByTestId("audio-health-bar")).toBeVisible();
  // Visual overhaul A, Slice 4c: every section of the plate is present; the
  // plate scrolls, it does not hide.
  for (const section of ["eq", "dynamics", "send", "meter", "channel"] as const) {
    await expect(page.locator(`[data-plate-section="${section}"]`)).toBeAttached();
  }
  await expectAudioStudioSideRailsFilled(page);
  await expectAudioOverviewProcessingStack(page, "2560 selected-channel", 82);
  await expectDbfsScaleLabelsInsideMeters(page, "2560 selected-channel");
  // The plate's preamp knob (AudioKnob) is square.
  await expectAspectRatio(
    page.getByTestId("audio-inspector-hardware-mini").getByRole("slider", { name: "Host preamp gain" }),
    1,
    "the plate's preamp knob"
  );
  await expectSnapshotActionsDoNotOverlapContent(page, "snapshot-show-open");
  await expectAudioInspectorPanelsFit(page);

  await page.getByTestId("audio-output-audio-mix-phones-a").click();
  await expect(page.locator('[data-plate-section="output"]')).toBeVisible();
  await expectDbfsScaleLabelsInsideMeters(page, "2560 output plate");
  for (const section of ["eq", "dynamics", "send", "preamp"] as const) {
    await expect(page.locator(`[data-plate-section="${section}"]`)).toHaveCount(0);
  }
  // Visual overhaul A, Slice 4c: the long facts (Clock, Metering) are the
  // shell footer's telemetry; a long value must not overflow its box.
  const footerFacts = page.getByTestId("audio-footer-telemetry").locator("span");
  const footerFactCount = await footerFacts.count();
  expect(footerFactCount, "footer telemetry should be rendered").toBeGreaterThan(0);
  for (let index = 0; index < footerFactCount; index += 1) {
    await expectNoElementOverflow(footerFacts.nth(index), `2560 footer fact ${index + 1}`);
  }
  await expectNoDocumentScroll(page);
});

// Round-2 close-out (R2-CTX-01): the DS ContextMenu measures itself and
// clamps to the viewport (ContextMenu.tsx flips above/left when the bottom/
// right would clip). No shipped fixture can place a real right-click near
// the viewport edge — the centered mixer never reaches it — so this locks
// the clamp with synthetic edge coordinates dispatched at the strip's
// contextmenu handler, exactly how the close-out probe verified it live.
// New pages program, Slice SW (D22): at the edges of the studio screen,
// 2560 × 1440 (old: 1280 × 800). Each edge probe is 10 px in, closer than the
// menu's own size, so the menu has to flip to stay on screen.
test("strip context menu clamps to the viewport at the edges", async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1440 });
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
    expect(box!.x + box!.width, `${label}: fits right`).toBeLessThanOrEqual(2561);
    expect(box!.y + box!.height, `${label}: fits bottom`).toBeLessThanOrEqual(1441);
  };

  await probe(1280, 720, "center");
  await probe(2550, 720, "right edge");
  await probe(1280, 1430, "bottom edge");
  await probe(2550, 1430, "corner");
});
