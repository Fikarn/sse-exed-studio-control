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
  expectSnapshotSlotsHoldTheirWords,
  loadAudioSnapshot,
  openAudioPageMenu,
  readAudioTierGroup,
  revealPlateSection,
  toggleAudioTierGroup,
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
// operator-shell.spec.ts. Covers rendering, meters, snapshots,
// hardware preamps, layout, and the pure-logic
// formatter/view-model assertions. Describe-block organization
// (snapshots / meters / hardware-preamp) is a follow-up
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
  // One yellow for engaged, not a colour per output. The visual overhaul's
  // Console pull request. Old: read from the Console's own --accent, which the
  // workspace re-pointed to Yellow. New: the mix target's key is lit in the
  // palette's Yellow, and the workspace keeps the design system's --accent, the
  // Beige of selection. Reason: the Console's private colours went; Yellow is
  // engaged and Beige is selected, one meaning each (DESIGN.md §4).
  const mainTarget = page.getByTestId("audio-mix-target-audio-mix-main");
  await expect
    .poll(() => mainTarget.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe("rgb(242, 222, 111)");
  await expect
    .poll(() =>
      workspace.evaluate((element) => getComputedStyle(element).getPropertyValue("--accent").trim().toLowerCase())
    )
    .toBe("#edebd1");
  await expect(page.getByTestId("audio-lane-name-audio-mix-main")).toHaveText("Main Out");
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
  // The visual overhaul's Console pull request. Old: the master meter under the
  // cluster's level; the standing keys in a "Console" row. New: Main Out's
  // meter in its row of the outputs block; the standing commands are the
  // page's ⋯ items, with the same test ids. Reason: the output level has one
  // home (graft 1), and the Console row became the page's menu (Atrium).
  await expect(page.getByTestId("audio-lane-meter-audio-mix-main")).toBeVisible();
  await expect(page.getByTestId("audio-standing-actions")).toHaveCount(0);
  await openAudioPageMenu(page);
  await expect(page.getByTestId("audio-topbar-sync")).toContainText("Sync from TotalMix");
  await expect(page.getByTestId("audio-topbar-setup")).toBeEnabled();
  await page.keyboard.press("Escape");
  // The shell (overhaul 3): the latch names itself, Solo, and counts in its text.
  await expect(page.getByTestId("audio-solo-warning-band")).toContainText("Solo");
  await expect(page.getByTestId("audio-solo-warning-band")).toContainText("1 on FX 3/4");
  // The latch is one row in the cluster, the latch slot's height (56 px,
  // docs/DESIGN.md section 2), never a band across the bay.
  await expect
    .poll(async () => {
      const box = await page.getByTestId("audio-solo-warning-band").boundingBox();
      return Math.round(box?.height ?? 0);
    })
    .toBeLessThanOrEqual(56);
  await expect(page.getByTestId("audio-clip-warning-band")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear all solo" }).click();
  await expect(page.getByTestId("audio-solo-warning-band")).toHaveCount(0);
  // The visual overhaul's Console pull request. Old: the group chips stood in
  // each tier's heading. New: they are the check items of the tier's ⋯, with
  // the chips' test ids. Reason: Atrium's tier menu replaces the chips.
  expect(await readAudioTierGroup(page, "hardware-inputs", "talent")).toBe("false");
  expect(await readAudioTierGroup(page, "hardware-inputs", "line")).toBe("absent");
  expect(await readAudioTierGroup(page, "hardware-inputs", "remote")).toBe("absent");
  expect(await readAudioTierGroup(page, "software-playback", "bed")).toBe("false");
  expect(await readAudioTierGroup(page, "software-playback", "remote")).toBe("absent");
  // 2026-10-01 (the owner's decision, after the studio walk). Old: the panel
  // held the app's own snapshots, a Capture key, empty slots, mix-shape
  // thumbnails and a hover preview naming the TotalMix slot a recall would
  // load. New: TotalMix's eight slots under the names TotalMix saved, what
  // TotalMix reports of each, and where the names come from. Reason: the
  // Console's snapshots follow TotalMix; the app keeps none.
  const snapshotDeck = page.getByTestId("audio-snapshot-deck");
  await expect(snapshotDeck).toContainText("in TotalMix");
  await expect(page.locator("[data-snapshot-slot]")).toHaveCount(8);
  await expect(page.getByTestId("audio-snapshot-capture")).toHaveCount(0);
  await expect(snapshotDeck.getByRole("button")).toHaveCount(8);
  await expect(page.getByTestId("audio-snapshot-name-1")).toHaveText("Mix 1");
  await expect(page.getByTestId("audio-snapshot-state-1")).toHaveText("active");
  // The visual overhaul's polish (2026-10-05). Old: a lone green word and a
  // green keyline round the key. New: TotalMix's word with its lamp, a state
  // word (● ACTIVE). Reason: DESIGN.md §4 and §8, a state word stands with its
  // lamp, and the system has no green keyline.
  await expect(page.getByTestId("audio-snapshot-state-1")).toHaveAttribute("data-tone", "ok");
  await expect(page.getByTestId("audio-snapshot-state-1").locator("[data-lamp]")).toHaveCount(1);
  await expect(page.getByTestId("audio-snapshot-slot-1")).toHaveAttribute("data-current", "true");
  await expect(page.getByTestId("audio-snapshot-name-3")).toHaveText("Panel & Q&A");
  // The visual overhaul's Console pull request. Old: a slot TotalMix does not
  // hold read "–". New: it says nothing; only TotalMix's own word shows.
  // Reason: Atrium, a quiet slot; the dash was a word saying nothing.
  await expect(page.getByTestId("audio-snapshot-state-3")).toHaveText("");
  await expect(page.getByTestId("audio-snapshot-name-6")).toHaveText("Slot 6");
  await expect(page.getByTestId("audio-snapshot-state-6")).toHaveText("");
  // A slot with no name of its own reads quieter.
  await expect(page.getByTestId("audio-snapshot-slot-6")).toHaveAttribute("data-named", "false");
  await expect(page.getByTestId("audio-snapshot-slot-3")).toHaveAttribute("data-named", "true");
  await expect(page.getByTestId("audio-snapshot-load-6")).toHaveAttribute("aria-label", "Load Slot 6 in TotalMix");
  await expect(page.getByTestId("audio-snapshot-load-6")).toHaveAttribute("title", "Press twice to load in TotalMix");
  await expect(page.getByTestId("audio-snapshot-source")).toHaveText(/^Names as TotalMix last saved them · .+/);
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
  // The visual overhaul's Console pull request. Old: a playback strip's plate
  // had a "Software" section: "No playback stats from the driver", its stereo
  // link and a fixed "Auto fade Off". New: a playback strip has no preamp
  // section; what it is (stereo, its group) is the title plate's one line.
  // Reason: the section repeated the plate's other facts or printed
  // placeholders (the survey's clutter findings), and the plate must fit.
  // (2026-10-04: "linked" went with the send modes.)
  await expect(page.locator('[data-plate-section="preamp"]')).toHaveCount(0);
  await expect(page.getByTestId("audio-plate-head")).toContainText("stereo");
  await expect(page.getByTestId("audio-plate-head")).not.toContainText("linked");
  // The visual overhaul's polish (2026-10-05): the group in the tier menu's
  // word (it printed the id, "group fx").
  await expect(page.getByTestId("audio-plate-head")).toContainText("group FX");
  await page.getByTestId("audio-strip-audio-input-9").click();
  await expect(page.locator('[data-plate-section="preamp"]')).toContainText("Preamp");
  await expect(page.getByTestId("audio-inspector-hardware-mini")).toContainText("48 V");
  await expect(page.getByTestId("audio-inspector-hardware-mini")).toContainText("Hi-Z");
  await expect(page.getByTestId("audio-inspector-hardware-mini")).toContainText("Polarity");
  await expect(page.getByTestId("audio-inspector-hardware-mini")).toContainText("AutoSet");
  await expect(page.getByTestId("audio-inspector-hardware-mini")).not.toContainText("Pad");
  await page.getByTestId("audio-strip-audio-playback-3-4").click();

  // The visual overhaul's Console pull request. Old: a click on an output's
  // strip in the bay made it the mix target and showed it on the plate. New:
  // the output's key in the cluster's outputs block makes it the mix target and
  // keeps the selected strip, as the deck's MAIN OUT and PHONES do; the plate
  // shows an output from its menu, "Show in the plate". Reason: graft 1 moves
  // the outputs into the cluster, and one press does one thing.
  await page.getByTestId("audio-mix-target-audio-mix-phones-a").click();
  await expect(page.getByTestId("audio-output-audio-mix-phones-a")).toHaveAttribute("data-selected", "true");
  await expect(workspace).toHaveAttribute("data-output-role", "phones-a");
  // One yellow for every output role: a phones mix does not recolour it.
  await expect
    .poll(() =>
      page
        .getByTestId("audio-mix-target-audio-mix-phones-a")
        .evaluate((element) => getComputedStyle(element).backgroundColor)
    )
    .toBe("rgb(242, 222, 111)");
  await expect(page.getByRole("heading", { name: "FX 3/4" })).toBeVisible();
  await expect(page.getByTestId("audio-hardware-outputs-tier")).toContainText("Phones 1");
  await page.getByTestId("audio-lane-menu-audio-mix-main").click();
  await page.getByTestId("audio-output-menu-plate-audio-mix-main").click();
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
  // 2026-10-01: snapshot key 3 is TotalMix's slot 3, and two presses load it
  // in TotalMix (it recalled the app's own snapshot).
  await page.getByTestId("audio-bank-next").click();
  await expect(page.getByTestId("audio-footer-telemetry")).toContainText("2 of 3");
  await expect(page.getByTestId("audio-tier-bank-pill-hardware-inputs")).toHaveText("2 / 3");

  const selectedStrip = page.getByTestId("audio-strip-audio-input-1");
  // On the strip's name, clear of its fader, which a click mid-strip would move.
  await selectedStrip.click({ position: { x: 12, y: 12 } });
  await expect(selectedStrip).toHaveAttribute("data-selected", "true");

  await selectedStrip.getByRole("button", { name: /Mute/ }).click();
  await expect(selectedStrip.getByRole("button", { name: /Mute/ })).toHaveAttribute("data-active", "true");
  await expect(selectedStrip.getByRole("button", { name: /Mute/ })).toHaveAttribute("aria-pressed", "true");

  await loadAudioSnapshot(page, 3);
  await expect(page.getByTestId("audio-snapshot-slot-3")).toHaveAttribute("data-current", "true");
  await expect(page.getByTestId("audio-snapshot-state-3")).toHaveText("active");
  await expect(page.getByTestId("audio-snapshot-slot-1")).toHaveAttribute("data-current", "false");
  await expect(page.getByTestId("audio-snapshot-state-1")).toHaveText("");
  await expect(page.getByTestId("audio-load-report")).toContainText("Loaded Panel & Q&A in TotalMix");
  // The visual overhaul's Console pull request: the load report stands at the
  // cluster's foot (it was a band over the bay, which shrank the strips).
  await expect(page.locator('[data-region="cluster"]').getByTestId("audio-load-report")).toBeVisible();

  // Visual overhaul A, Slice 4c. Old: the plate was a tab strip and this
  // asserted the Preamp tab was selected and its panel visible. New: every
  // section of the plate is present at once. Reason: the plate has no tab row —
  // nothing about the selected strip is hidden behind one.
  // The visual overhaul's Console pull request: Line 1 is a line input, and
  // only a front preamp has a preamp section (gain, 48 V, Hi-Z, AutoSet).
  await expect(page.locator('[data-plate-section="preamp"]')).toHaveCount(0);
  await expect(page.getByTestId("audio-inspector-metering")).toContainText("Level L / R");
  await expect(page.getByTestId("audio-inspector-metering")).toContainText("Peak hold");
  await expect(page.getByTestId("audio-inspector-level-readout")).toHaveAttribute("data-meter-readout-mode", "level");
  await expect(page.getByTestId("audio-inspector-peak-hold-readout")).toHaveAttribute(
    "data-meter-readout-mode",
    "peakHold"
  );
  // The visual overhaul's Console pull request. Old: "Nominal ref" and "Peak
  // warn" printed under the readouts. New: the meter section's tooltip says
  // them. Reason: hints are tooltips; the meter draws the reference itself.
  await expect(page.getByTestId("audio-plate-meter")).toContainText("the reference at −18 dBFS");
  // 2026-05-27 redesign: Overview mini-preview cards removed; the EQ / Dyn /
  // Routing tabs are the route into processing now.
  // Visual overhaul A, Slice 4c: they are sections of the plate, all present.
  // The visual overhaul's Console pull request: the "Channel" section, which
  // repeated the sections above it, went (the survey's clutter findings).
  // (2026-10-04: the dynamics and the equaliser went; see the test of the
  // plate without them.)
  for (const section of ["send", "meter"] as const) {
    await expect(page.locator(`[data-plate-section="${section}"]`)).toBeAttached();
  }
  await expect(page.locator('[data-plate-section="channel"]')).toHaveCount(0);
  const contextCountsBefore = await page.evaluate(() => ({ ...window.__SSE_TEST_ENGINE_REQUEST_COUNTS__ }));
  await page.getByTestId("audio-strip-audio-input-1").click({ button: "right", position: { x: 12, y: 12 } });
  // The visual overhaul's Console pull request. Old: the right-click menu was
  // named "<strip> actions" and held "Reset to unity" and the polarity. New:
  // the strip's menu (its ⋯ or a right-click) is named by its head, the
  // strip's name, and says which send it sets to 0 dB. Reason: DESIGN.md §9,
  // a menu's head names its object; "unity" did not say which mix.
  const menu = page.getByRole("menu", { name: "Line 1" });
  await expect(menu).toContainText("Set Main Out send to 0 dB");
  const contextCountsAfterOpen = await page.evaluate(() => ({ ...window.__SSE_TEST_ENGINE_REQUEST_COUNTS__ }));
  expect(contextCountsAfterOpen["audio.settings.update"] ?? 0).toBe(contextCountsBefore["audio.settings.update"] ?? 0);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  const contextCountsAfterEscape = await page.evaluate(() => ({ ...window.__SSE_TEST_ENGINE_REQUEST_COUNTS__ }));
  expect(contextCountsAfterEscape["audio.settings.update"] ?? 0).toBe(
    contextCountsBefore["audio.settings.update"] ?? 0
  );
  // 2026-10-01. Old: the menu's Rename opened a dialog that renamed the strip.
  // New: no Rename, in the menu or on the plate. Reason: the strips take
  // TotalMix's names, and a channel is renamed in TotalMix.
  await page.getByTestId("audio-strip-audio-input-1").click({ button: "right", position: { x: 12, y: 12 } });
  await expect(menu).toContainText("Set Main Out send to 0 dB");
  await expect(page.getByRole("menuitem", { name: /Rename/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(page.getByTestId("audio-plate-rename")).toHaveCount(0);
  await expect(page.getByTestId("audio-inspector").getByRole("button", { name: /Rename/ })).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.__SSE_TEST_NATIVE_DIALOG_COUNTS__))
    .toEqual({
      confirm: 0,
      prompt: 0,
    });
  await expect(page.getByRole("button", { name: "PFL" })).toHaveCount(0);
  await revealPlateSection(page, "send");
  // Old: a send card per mix with four mode keys. New: a row per other mix.
  // Reason: Atrium's OTHER MIXES; the mix target's send is the strip's fader.
  // The row's ⋯ is covered by the test of the other mixes below.
  await expect(page.getByTestId("audio-inspector-sends")).toContainText("Phones 1");
  await expect(page.getByTestId("audio-send-destination-audio-mix-phones-a")).toContainText("Phones 1");

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

  // The visual overhaul's Console pull request: Open Setup is the page's ⋯ item
  // (it was the Console row's standing key), with the same test id.
  await openAudioPageMenu(page);
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
  // workspace. The visual overhaul's polish (2026-10-05, the owner's two-line
  // rule). Old: the sentence also named the key ("Press Sync from TotalMix to
  // pull the current state …"). New: the key beside it names the press.
  await expect(assumedDisplay).toContainText(/the strips may not match totalmix/i);
  await expect(assumedDisplay.getByTestId("audio-state-sync")).toHaveText("Sync from TotalMix");

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
  // The visual overhaul's Console pull request: the probe stands in the page's
  // ⋯ too (it was the Console row's standing key).
  await openAudioPageMenu(page);
  await expect(page.getByTestId("audio-topbar-probe")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("slider", { name: "FX 3/4 send level" })).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByRole("button", { name: "Mute Host" })).toBeDisabled();
  await page.getByTestId("audio-state-probe").click();
  // The fixture probe passes, which is exactly what unlocks the console.
  await expect(page.getByTestId("audio-state-display")).not.toContainText("NOT VERIFIED");
  await openAudioPageMenu(page);
  await expect(page.getByTestId("audio-topbar-sync")).not.toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("slider", { name: "FX 3/4 send level" })).not.toHaveAttribute("aria-disabled", "true");
  await expect(page.getByRole("button", { name: "Mute Host" })).toBeEnabled();

  await openFixture(page, "audio-osc-disabled");
  // The state display carries the engine's word (old: the band's title
  // "OSC DISABLED").
  await expect(page.getByTestId("audio-state-display")).toContainText("DISABLED");
  // A menu item that cannot be pressed is disabled and says why at its right.
  await openAudioPageMenu(page);
  await expect(page.getByTestId("audio-topbar-sync")).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByTestId("audio-topbar-sync")).toContainText("TotalMix cannot be read now");
  await page.keyboard.press("Escape");

  await openFixture(page, "audio-offline");
  // The state display carries the engine's word and its sentence (old: the
  // band's title "CONSOLE UNREACHABLE").
  await expect(page.getByTestId("audio-state-display")).toContainText("OFFLINE");
  await expect(page.getByText("TotalMix did not answer on remote 4", { exact: false }).first()).toBeVisible();
  // The visual overhaul's polish (2026-10-05): the tiers' lock note names the
  // hardware and the page's word (it read "locked · desk unreachable").
  await expect(page.getByTestId("audio-tier-lock-note-hardware-inputs")).toHaveText("locked · TotalMix offline");

  await openFixture(page, "audio-action-failed");
  // Visual overhaul A, Slice 4a. Old: the sentence read
  // "AUDIO_SNAPSHOT_RECALL_FAILED · Snapshot slot 3 did not match…". New: the
  // sentence says what happened and the code stands in the display's own code
  // slot. Reason: operator copy never leads with a raw fault code, and the
  // state display is the one place that has somewhere else to put it.
  // 2026-10-01: the fixture's failure is a TotalMix snapshot load a
  // development run refused (it was a recall of the app's own snapshot).
  const failedState = page.getByTestId("audio-state-display");
  await expect(failedState).toContainText("ACTION FAILED");
  await expect(failedState).toContainText(
    "A development run never loads a mix in TotalMix; only the studio's build does."
  );
  await expect(failedState).toContainText("AUDIO_SNAPSHOT_LOAD_STUDIO_ONLY");
  await expect(failedState.locator("[data-state-code]")).toHaveText("AUDIO_SNAPSHOT_LOAD_STUDIO_ONLY");

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
  // The visual overhaul's Console pull request. Old: the strip's gain was a key,
  // locked like 48 V. New: the gain is a value on the strip, set from the
  // strip's menu and the plate, whose items are disabled and say why.
  // Reason: the strip shows the gain; editing it is the menu's and the plate's.
  for (const testId of ["audio-lane-phantom-audio-input-9"]) {
    const key = strip.getByTestId(testId);
    await expect(key).toHaveAttribute("aria-disabled", "true");
    await expect(key).toHaveAttribute("title", reason);
    expect(await key.evaluate((node) => getComputedStyle(node).borderStyle)).toBe("dashed");
  }
  await page.getByTestId("audio-lane-menu-audio-input-9").click();
  await expect(page.getByTestId("audio-lane-menu-audio-input-9-gain")).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByTestId("audio-lane-menu-audio-input-9-gain")).toContainText("desk NOT VERIFIED");
  await page.keyboard.press("Escape");
  const fader = strip.getByRole("slider", { name: "Host send level" });
  await expect(fader).toHaveAttribute("aria-disabled", "true");
  await expect(strip.getByRole("button", { name: "Mute Host" })).toBeDisabled();
  await expect(strip.getByRole("button", { name: "Solo Host" })).toBeDisabled();
  // 2026-10-01: a TotalMix snapshot load is a console write, so the slots are
  // locked the same way, with the same reason.
  const loadKey = page.getByTestId("audio-snapshot-load-2");
  await expect(loadKey).toHaveAttribute("aria-disabled", "true");
  await expect(loadKey).toHaveAttribute("title", reason);
  expect(await loadKey.evaluate((node) => getComputedStyle(node).borderStyle)).toBe("dashed");
  // The visual overhaul's polish (2026-10-05). Old: the solo latch's Clear all
  // was disabled, a solid edge and grey words, with no reason. New: it is
  // locked like every key the desk refuses, with the same reason. Reason:
  // DESIGN.md §4, a locked control is a dashed edge at 55 % and says why.
  const clearAllSolo = page.getByTestId("audio-topbar-solo");
  await expect(clearAllSolo).toHaveAttribute("aria-disabled", "true");
  await expect(clearAllSolo).toHaveAttribute("title", reason);
  expect(await clearAllSolo.evaluate((node) => getComputedStyle(node).borderStyle)).toBe("dashed");

  // The lock is the engine's, so it lifts the moment the probe passes.
  await page.getByTestId("audio-state-probe").click();
  await expect(page.getByTestId("audio-tier-lock-note-hardware-inputs")).toHaveCount(0);
  await expect(strip.getByTestId("audio-lane-phantom-audio-input-9")).not.toHaveAttribute("aria-disabled", "true");
  await expect(loadKey).not.toHaveAttribute("aria-disabled", "true");
  await expect(loadKey).toHaveAttribute("title", "Press twice to load in TotalMix");
  await expect(clearAllSolo).not.toHaveAttribute("aria-disabled", "true");
});

// The visual overhaul's polish (2026-10-05; DESIGN.md §4): a level the desk has
// not confirmed is in doubt, a dashed yellow keyline on the value itself — the
// strips' readouts, the outputs' and the plate's other mixes — as Cameras
// draws a camera's last-read values. A confirmed desk draws none.
test("audio-state-assumed draws every level in doubt, and a confirmed desk none", async ({ page }) => {
  // Both fixtures open with FX 3/4 on the plate and Main Out the mix target, so
  // the plate's other mixes are Phones 1 and Phones 2.
  await openFixture(page, "audio-state-assumed");
  await expect(page.getByTestId("audio-state-display")).toContainText("ASSUMED");
  await expect(page.getByRole("heading", { name: "FX 3/4" })).toBeVisible();
  const levels = [
    page.getByTestId("audio-lane-readout-audio-input-9"),
    page.getByTestId("audio-lane-readout-audio-mix-main"),
    page.getByTestId("audio-send-value-audio-mix-phones-a"),
  ];
  for (const level of levels) {
    await expect(level).toHaveAttribute("data-doubt", "");
  }

  await openFixture(page, "audio-populated");
  await expect(page.getByTestId("audio-state-display")).toContainText("SIMULATED");
  await expect(page.getByRole("heading", { name: "FX 3/4" })).toBeVisible();
  for (const level of levels) {
    await expect(level).toBeVisible();
    await expect(level).not.toHaveAttribute("data-doubt", "");
  }
});

test("switches audio output targets without a full-domain refresh", async ({ page }) => {
  await page.addInitScript(() => {
    window.__SSE_TEST_ENGINE_REQUEST_COUNTS__ = {};
  });
  await openFixture(page, "audio-populated");
  await expectWorkspaceMounted(page, "audio");

  const initialCounts = await page.evaluate(() => ({ ...window.__SSE_TEST_ENGINE_REQUEST_COUNTS__ }));
  // The visual overhaul's Console pull request: the output's key in the
  // cluster's outputs block (it was a click on the output's strip in the bay).
  await page.getByTestId("audio-mix-target-audio-mix-phones-a").click();
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
  await openAudioPageMenu(page);
  await expect(page.getByTestId("audio-topbar-setup")).toBeEnabled();
  await page.keyboard.press("Escape");
  await page.getByTestId("audio-state-sync").press("Enter");
  await expect(stateDisplay).not.toContainText("ASSUMED");

  await expect(page.getByTestId("audio-signal-canvas").getByRole("button", { name: "Master" })).toHaveCount(0);

  await openFixture(page, "audio-osc-disabled");
  await expect(page.getByTestId("audio-state-display")).toContainText("DISABLED");
  await openAudioPageMenu(page);
  await expect(page.getByTestId("audio-topbar-sync")).toHaveAttribute("aria-disabled", "true");
});

test("supports audio group filtering and source/output selection flow", async ({ page }) => {
  test.slow();
  await openFixture(page, "audio-populated");

  // The visual overhaul's Console pull request. Old: the group chips stood in
  // each tier's heading and a click on one switched it. New: the chips are the
  // check items of the tier's ⋯ (same test ids, `aria-checked`), and a lit
  // filter is said in the heading's words. Reason: Atrium's tier menu.
  await toggleAudioTierGroup(page, "hardware-inputs", "talent");
  expect(await readAudioTierGroup(page, "hardware-inputs", "talent")).toBe("true");
  await expect(page.getByTestId("audio-tier-filter-hardware-inputs")).toHaveText("Talent only");
  await expect(page.getByTestId("audio-strip-audio-input-9")).toBeVisible();
  await expect(page.getByTestId("audio-strip-audio-playback-3-4")).toBeVisible();

  await toggleAudioTierGroup(page, "hardware-inputs", "talent");
  expect(await readAudioTierGroup(page, "hardware-inputs", "talent")).toBe("false");
  await expect(page.getByTestId("audio-tier-filter-hardware-inputs")).toHaveCount(0);
  await expect(page.getByTestId("audio-strip-audio-input-9")).toBeVisible();

  expect(await readAudioTierGroup(page, "hardware-inputs", "line")).toBe("absent");
  expect(await readAudioTierGroup(page, "hardware-inputs", "remote")).toBe("absent");

  await toggleAudioTierGroup(page, "software-playback", "fx");
  expect(await readAudioTierGroup(page, "software-playback", "fx")).toBe("true");
  await expect(page.getByTestId("audio-strip-audio-playback-3-4")).toBeVisible();
  await expect(page.getByTestId("audio-strip-audio-playback-1-2")).toHaveCount(0);
  // New pages program, Slice 3 (decision 10): several groups can be lit at once.
  await toggleAudioTierGroup(page, "software-playback", "bed");
  expect(await readAudioTierGroup(page, "software-playback", "fx")).toBe("true");
  expect(await readAudioTierGroup(page, "software-playback", "bed")).toBe("true");
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

  // Old: one plain click on the lit FX chip cleared the row's filter. New: the
  // tier's "Show all" clears it; switching one group turns only that one off.
  await toggleAudioTierGroup(page, "software-playback", "fx");
  expect(await readAudioTierGroup(page, "software-playback", "fx")).toBe("false");
  expect(await readAudioTierGroup(page, "software-playback", "bed")).toBe("true");
  await page.getByTestId("audio-tier-menu-software-playback").click();
  await page.getByTestId("audio-tier-show-all-playback").click();
  expect(await readAudioTierGroup(page, "software-playback", "bed")).toBe("false");
  await expect(page.getByTestId("audio-strip-audio-playback-3-4")).toBeVisible();
  await page.getByTestId("audio-strip-audio-playback-3-4").click();
  // 2026-05-27 redesign: the channel name moved into the inspector's slimmed
  // sticky identity header (an <h2>), outside the audio-inspector-channel
  // tabpanel. Assert FX 3/4's inspector is shown via that header heading.
  await expect(page.getByRole("heading", { name: "FX 3/4" })).toBeVisible();
  // The visual overhaul's Console pull request: the output's menu shows it on
  // the plate (a click on its strip in the bay did), and makes it the target.
  await page.getByTestId("audio-lane-menu-audio-mix-phones-a").click();
  await page.getByTestId("audio-output-menu-plate-audio-mix-phones-a").click();
  await expect(page.getByTestId("audio-output-audio-mix-phones-a")).toHaveAttribute("data-selected", "true");
  // Visual overhaul A, Slice 4c. Old: selecting an output selected the Output
  // tab and hid the EQ / Dyn / Routing tabs. New: the plate carries the
  // output's own section and none of the channel's. Reason: no tab row — what
  // the plate shows is what the selection has.
  await expect(page.locator('[data-plate-section="output"]')).toBeVisible();
  for (const section of ["send", "preamp"] as const) {
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
  // The visual overhaul's Console pull request. Old: the output's plate had its
  // "Monitor level" slider and Mute and Unity keys. New: the plate shows the
  // output's meter and facts, and no control of its level. Reason: the output
  // level has one home, the outputs block in the cluster (graft 1).
  await expect(page.getByTestId("audio-inspector-output").getByRole("slider")).toHaveCount(0);
  await expect(page.getByTestId("audio-inspector-output")).toContainText("Mute");

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
  // The visual overhaul's Console pull request. Old: "Confirm 48 V on|off".
  // New: the one armed form's question, "48 V ON?" / "48 V OFF?", as the
  // strip's 48 V key and the snapshot keys' "LOAD?" ask it.
  await expect(phantom).toHaveText(/48 V (ON|OFF)\?/);
  await expect(phantom).toHaveAttribute("data-active", phantomBefore ?? "");
  await page.keyboard.press("Escape");
  await expect(phantom).not.toHaveAttribute("data-armed", "true");
  await expect(phantom).toHaveText("48 V");
  // Production readiness S13. Old: the second click followed the first in real
  // time and was expected inside the 350 ms dwell. New: the page's clock is
  // stopped for the two presses and moved past the dwell for the confirm.
  // Reason: on a slow runner the two clicks are over a second apart, so the
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
  // The visual overhaul's Console pull request: the page's ⋯ holds "Clear
  // clips" (it was a standing key); the clip latch's own key clears them too.
  await openAudioPageMenu(page);
  await expect(page.getByTestId("audio-clear-clips")).not.toHaveAttribute("aria-disabled", "true");
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

// 2026-10-01. Old: "honors reduced motion on audio snapshot pulse and hover
// transitions": a recalled slot flashed, and its hover float faded in. New: the
// one motion a snapshot key has is its arm's countdown bar, and reduced motion
// stills it. Reason: the pulse and the float went with the app's own snapshots.
test("honors reduced motion on a snapshot key's countdown", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openFixture(page, "audio-populated");

  const interviewTile = page.getByTestId("audio-snapshot-slot-2");
  await page.getByTestId("audio-snapshot-load-2").click();
  await expect(interviewTile).toHaveAttribute("data-armed", "true");
  const countdown = interviewTile.getByTestId("audio-arm-countdown");
  await expect(countdown).toHaveCount(1);
  expect(await countdown.evaluate((node) => getComputedStyle(node).animationName)).toBe("none");
});

// 2026-10-01 (the owner's decision, after the studio walk). Old: "supports
// audio snapshot capture save rename and delete": the app kept snapshots of its
// own, captured into an empty slot, saved over, renamed and deleted through the
// slot's float. New: the slots are TotalMix's own eight; a key arms, shows
// LOAD? and the state display's armed row, Esc lets it go, and a second press
// past the dwell loads the slot in TotalMix. Nothing captures, saves, renames
// or deletes. Reason: the Console's snapshots and names follow TotalMix.
test("loads one of TotalMix's snapshots with two presses, and keeps none of its own", async ({ page }) => {
  test.slow();
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
  await expectWorkspaceMounted(page, "audio");

  const deck = page.getByTestId("audio-snapshot-deck");
  for (const name of [/Capture/, /Save/, /Rename/, /Delete/]) {
    await expect(deck.getByRole("button", { name })).toHaveCount(0);
  }

  const interviewTile = page.getByTestId("audio-snapshot-slot-2");
  const interviewKey = page.getByTestId("audio-snapshot-load-2");
  await expect(interviewKey).toHaveAttribute("aria-label", "Load Interview in TotalMix");
  // Visual overhaul A, Slice 4 (system §6): one focus ring, on keyboard focus
  // only — so the ring is asserted after a real Tab, not a programmatic focus.
  await page.getByTestId("audio-snapshot-load-1").focus();
  await page.keyboard.press("Tab");
  await expect(interviewKey).toBeFocused();
  const keyBox = await interviewKey.boundingBox();
  expect(keyBox?.width ?? 0).toBeGreaterThan(40);
  expect(keyBox?.height ?? 0).toBeGreaterThan(40);
  expect(await interviewKey.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe("none");

  // The first press arms: LOAD? on the key, the armed row in the state display.
  // The state line gives way to the tag, so neither the key nor the panel
  // moves (finding C1).
  const keyAtRest = await readRequiredBox(page, "audio-snapshot-load-2");
  const deckAtRest = await readRequiredBox(page, "audio-snapshot-deck");
  await interviewKey.click();
  await expect(interviewTile).toHaveAttribute("data-armed", "true");
  await expect(interviewKey).toContainText("LOAD?");
  const keyArmed = await readRequiredBox(page, "audio-snapshot-load-2");
  const deckArmed = await readRequiredBox(page, "audio-snapshot-deck");
  expect(Math.abs(keyArmed.height - keyAtRest.height), "the armed key keeps its height").toBeLessThanOrEqual(0.5);
  expect(Math.abs(keyArmed.top - keyAtRest.top), "the armed key stays put").toBeLessThanOrEqual(0.5);
  expect(Math.abs(deckArmed.height - deckAtRest.height), "the panel keeps its height").toBeLessThanOrEqual(0.5);
  await expect(interviewKey).toHaveAttribute("aria-label", "Confirm load of Interview in TotalMix");
  await expect(page.getByTestId("audio-state-display")).toContainText("Load Interview · press again to apply");
  await page.keyboard.press("Escape");
  await expect(interviewTile).toHaveAttribute("data-armed", "false");
  await expect(page.getByTestId("audio-state-display")).not.toContainText("press again to apply");

  await loadAudioSnapshot(page, 2);
  await expect(interviewTile).toHaveAttribute("data-current", "true");
  await expect(page.getByTestId("audio-snapshot-state-2")).toHaveText("active");
  await expect(page.getByTestId("audio-snapshot-state-1")).toHaveText("");
  expect(
    await page.evaluate(() => window.__SSE_TEST_ENGINE_REQUEST_COUNTS__?.["audio.snapshot.load"] ?? 0),
    "one load for two presses"
  ).toBe(1);
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

// 2026-10-01: "shows numeric snapshot before and after preview text" went with
// the app's own snapshots. The app keeps none of a TotalMix snapshot's
// contents, so a slot has no before and after to show.

test("the plate has no dynamics or equaliser: they are set in TotalMix", async ({ page }) => {
  await openFixture(page, "audio-populated");

  await page.getByTestId("audio-strip-audio-input-9").click();
  // 2026-10-04 (the owner's decisions). Old: a Dynamics section (a compressor
  // and a gate, each with five knobs in a popover) and an Equaliser section (a
  // graph, a band table and popovers). New: neither; the meter follows the
  // other mixes. Reason: the dynamics were only kept in the app, and the
  // equaliser reached TotalMix over commands that only flipped its on/off,
  // could land on another strip and were never read back.
  await expect(page.locator('[data-plate-section="send"]')).toBeVisible();
  await expect(page.locator('[data-plate-section="meter"]')).toBeVisible();
  await expect(page.locator('[data-plate-section="dynamics"]')).toHaveCount(0);
  await expect(page.locator('[data-plate-section="eq"]')).toHaveCount(0);
  await expect(page.getByTestId("audio-inspector")).not.toContainText("Dynamics");
  await expect(page.getByTestId("audio-inspector")).not.toContainText("Equaliser");
});

test("the plate's other mixes: a row per mix, its menu makes it the mix target", async ({ page }) => {
  await openFixture(page, "audio-populated");

  await page.getByTestId("audio-strip-audio-input-9").click();
  await revealPlateSection(page, "send");
  // The visual overhaul's Console pull request. Old: a card per mix, the mix
  // target's first, each with four mode keys. New: a row per other mix; the mix
  // target's send is the strip's fader, so Main Out has no row while it is the
  // target. Reason: Atrium's OTHER MIXES.
  await expect(page.getByTestId("audio-send-destination-audio-mix-main")).toHaveCount(0);
  await expect(page.getByTestId("audio-send-destination-audio-mix-phones-a")).toContainText("Phones 1");
  await expect(page.getByTestId("audio-send-destination-audio-mix-phones-b")).toContainText("Phones 2");
  // The visual overhaul's polish (2026-10-05). Old: the value printed "-1.9
  // dB" as one string in the main ink. New: the real minus, and the unit at
  // half size in the quiet ink, as the strips' and the outputs' readouts.
  const phonesSend = page.getByTestId("audio-send-value-audio-mix-phones-a");
  await expect(phonesSend).toHaveText(/^[−+]\d+\.\d dB$/);
  await expect(phonesSend.locator("span")).toHaveText(/^\s*dB$/);
  // 2026-10-04. Old: the row's ⋯ held the send's four modes (Pre fader, Mute
  // send, Link L+R, Solo send) above "Make mix target". New: "Make mix target"
  // alone. Reason: the app only kept the modes; they never reached TotalMix,
  // which has no such modes per send (the owner's decision).
  await page.getByTestId("audio-send-menu-audio-mix-phones-a").click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitemcheckbox")).toHaveCount(0);
  await expect(menu).not.toContainText("Pre fader");
  await menu.getByRole("menuitem", { name: "Make mix target" }).click();
  await expect(page.getByTestId("audio-send-destination-audio-mix-phones-a")).toHaveCount(0);
  await expect(page.getByTestId("audio-send-destination-audio-mix-main")).toContainText("Main Out");
});

// New pages program, Slice 3 (D6): "supports audio command palette and
// shortcut overlay parity" went with the palette and the shortcut guide. Every
// command it listed has an on-screen control (the inventory, section 3).

// 2026-10-01. Old: "snapshot recall reports the push and lists 48V
// differences without touching them": a recall pushed the app's own snapshot
// and its band listed each 48 V difference with an Arm key. New: a load is
// TotalMix's, the band says what the read-back brought, and it has nothing to
// arm. Reason: 48 V does not switch with a TotalMix snapshot. The band for a
// read-back that failed after the load went out (the reply's own sentence) is
// covered by audioLoadReport.test.ts: the simulated console always reads back.
test("a TotalMix snapshot load reports the read-back and leaves 48 V alone", async ({ page }) => {
  await openFixture(page, "audio-populated");
  const hostPhantom = page.getByTestId("audio-lane-phantom-audio-input-9");
  await expect(hostPhantom).toHaveAttribute("aria-pressed", "true");

  await loadAudioSnapshot(page, 2);
  const report = page.getByTestId("audio-load-report");
  await expect(report).toBeVisible();
  await expect(report).toHaveAttribute("data-tone", "ok");
  await expect(report).toContainText("Loaded Interview in TotalMix");
  // The simulated console reads nothing back: the band says so in the hardware
  // link's own words.
  await expect(report).toContainText("on the simulated console; nothing was sent (test mode).");
  await expect(report.getByRole("button")).toHaveCount(1);
  await expect(hostPhantom).toHaveAttribute("aria-pressed", "true");

  await page.getByTestId("audio-load-report-dismiss").click();
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
  // The visual overhaul's Console pull request: unity reads "+0.0 dB", as the
  // deck's display prints it (it read "0.0 dB"). The polish (2026-10-05): a
  // level below unity carries the real minus (it was "-0.6 dB").
  expect(formatAudioDb(AUDIO_FADER_UNITY)).toBe("+0.0 dB");
  expect(formatAudioDb(0.8)).toBe("−0.6 dB");
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
  // The visual overhaul's Console pull request: "Reset to unity" says which
  // send it sets now.
  await page.getByRole("menuitem", { name: "Set Main Out send to 0 dB" }).click();
  await expect(page.getByTestId("audio-strip-audio-playback-3-4")).toContainText("0.0 dB");
});

// New pages program, Slice 3 (decision 9). Old name: "audio preamp gain on the
// strip is a key that types and nudges"; the case pressed ArrowUp on the
// focused key and read a new gain. New: that step is gone and the name says the
// key types. Reason: the Gain key is a button, and a button takes no arrows;
// the plate's gain knob takes them (its whole-dB case below presses one).
// The visual overhaul's Console pull request. Old name: "audio preamp gain on
// the strip is a key that types"; the strip's gain key opened typed entry. New:
// the strip shows the gain as a value, and its menu's "Set preamp gain…" opens
// the same typed entry. Reason: the strip is name, level, M and S, 48 V and the
// fader; the gain shows on it and is set from the menu and the plate (Atrium,
// and the operator's review: the screen shows what the deck's GAIN showed).
test("audio preamp gain shows on the strip and its menu types it", async ({ page }) => {
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
  await expect(page.getByTestId("audio-strip-audio-input-9").getByRole("button", { name: /preamp gain/ })).toHaveCount(
    0
  );

  await page.getByTestId("audio-lane-menu-audio-input-9").click();
  await page.getByTestId("audio-lane-menu-audio-input-9-gain").click();
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
  // The visual overhaul's Console pull request: the outputs are in the cluster.
  await expect(page.locator('[data-region="cluster"]').getByTestId("audio-tier-lanes-hardware-outputs")).toBeVisible();
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
  // The shell (overhaul 3): the plate is the shell's, 440 px at 2560 × 1440,
  // and the inspector fills it inside its hairline.
  const plateBox = await readRequiredBox(page, "audio-inspector");
  expect(Math.abs(plateBox.width - 439), "the plate should be 440 px wide").toBeLessThanOrEqual(1);

  await expectAudioLaneCardsInsideTierGrids(page);
  await expectDbfsScaleLabelsInsideMeters(page, "2560 studio surface");
  // The visual overhaul's Console pull request. Old: the strip's gain key kept
  // its target height. New: the gain is a value and the strip's M and S are 48
  // px keys (at least 44, the operator's review). Reason: the strip's take
  // keys are M, S, 48 V and the fader; the gain is set from the menu.
  for (const name of ["Mute Host", "Solo Host"]) {
    const keyBox = await page.getByTestId("audio-strip-audio-input-9").getByRole("button", { name }).boundingBox();
    expect(keyBox, `${name} should have a box`).not.toBeNull();
    expect(keyBox!.height, `${name} is at least 44 px tall`).toBeGreaterThanOrEqual(44);
  }
  // Names never wrap: one line on every strip.
  const names = page.locator('[data-testid^="audio-lane-name-"]');
  for (let index = 0; index < (await names.count()); index += 1) {
    await expectNoElementOverflow(names.nth(index), `strip name ${index + 1}`);
  }

  await page.getByTestId("audio-strip-audio-input-9").click();
  // Visual overhaul A, Slice 4a: the Console's chrome is the cluster and the
  // shell footer; there is no top bar.
  await expect(page.getByTestId("audio-topbar")).toHaveCount(0);
  await expect(page.getByTestId("audio-monitor-bar")).toBeVisible();
  await expect(page.getByTestId("audio-health-bar")).toBeVisible();
  // Visual overhaul A, Slice 4c: every section of the plate is present. The
  // visual overhaul's Console pull request: and the plate never scrolls.
  for (const section of ["send", "meter"] as const) {
    await expect(page.locator(`[data-plate-section="${section}"]`)).toBeVisible();
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
  await expectSnapshotSlotsHoldTheirWords(page);
  await expectAudioInspectorPanelsFit(page);
  await page.getByTestId("audio-strip-audio-playback-3-4").click();
  await expectAudioInspectorPanelsFit(page);

  await page.getByTestId("audio-lane-menu-audio-mix-phones-a").click();
  await page.getByTestId("audio-output-menu-plate-audio-mix-phones-a").click();
  await expect(page.locator('[data-plate-section="output"]')).toBeVisible();
  await expectAudioInspectorPanelsFit(page);
  await expectDbfsScaleLabelsInsideMeters(page, "2560 output plate");
  for (const section of ["send", "preamp"] as const) {
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

// The walk of 2026-10-07, finding 3 (2026-10-08): a strip TotalMix hides in
// its Channel Layout (Setup's list) is locked with the sentence whatever the
// desk's state, says so on the strip, and the plate says it too; the strips
// beside it are not locked.
test("a strip TotalMix hides is locked with the sentence, on the strip and on the plate", async ({ page }) => {
  await openFixture(page, "audio-hidden-strips");
  await expectWorkspaceMounted(page, "audio");
  const sentence = "TotalMix hides this channel: unhide it there, or take it off the list in Setup.";
  const strip = page.getByTestId("audio-strip-audio-playback-9-10");
  await expect(strip).toHaveAttribute("data-hidden", "");
  await expect(strip.getByTestId("audio-lane-hidden-audio-playback-9-10")).toHaveText("hidden");
  await expect(strip.getByTestId("audio-lane-readout-audio-playback-9-10")).toHaveText("—");
  const mute = strip.getByRole("button", { name: "Mute Playback 9/10" });
  await expect(mute).toBeDisabled();
  await expect(mute).toHaveAttribute("title", sentence);
  await expect(strip.getByRole("slider", { name: "Playback 9/10 send level" })).toHaveAttribute(
    "aria-disabled",
    "true"
  );
  // The menu's items say why, in the short reason.
  await page.getByTestId("audio-lane-menu-audio-playback-9-10").click();
  const level = page.getByTestId("audio-lane-menu-audio-playback-9-10-level");
  await expect(level).toHaveAttribute("aria-disabled", "true");
  await expect(level).toContainText("hidden in TotalMix");
  await page.keyboard.press("Escape");
  // The strip beside it is offered as before.
  const music = page.getByTestId("audio-strip-audio-playback-7-8");
  await expect(music).not.toHaveAttribute("data-hidden", "");
  await expect(music.getByRole("button", { name: "Mute Music 7/8" })).toBeEnabled();
  await expect(music.getByTestId("audio-lane-hidden-audio-playback-7-8")).toHaveCount(0);
  // The plate: the fixture selects the hidden strip, and the plate says so.
  await expect(page.getByTestId("audio-plate-hidden")).toHaveText(sentence);
  await expect(page.getByTestId("audio-plate-head")).toContainText("hidden in TotalMix");
  await expectAudioInspectorPanelsFit(page);
});
