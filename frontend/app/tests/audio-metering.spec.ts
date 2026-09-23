import { expect, test } from "@playwright/test";
import type { AudioSnapshot } from "@sse/engine-client";

import { audioMeterEntryFromRecord } from "../../packages/engine-client/src/store/createShellStore";
import { AUDIO_METERING_TICK_MS } from "../../packages/engine-client/src/transports/fixture/audioMetering";
import {
  calculateNextFixturePeakHold,
  createFixtureTransport,
} from "../../packages/engine-client/src/transports/fixtureTransport";
import {
  AUDIO_FADER_UNITY,
  dbfsToMeterPercent,
  faderDbToNormalized,
  formatMeterDb,
  meterTone,
  normalizedToDbfs,
} from "../src/app/audio/audioFormatting";

import {
  EXPECTED_DBFS_SCALE_LABELS,
  expectDbfsScaleLabelsInsideMeters,
  meterNormalizedForDbfs,
  readMeterCanvasSample,
} from "./helpers/meter-canvas";
import { expectWorkspaceMounted, fixtureMap, openFixture } from "./helpers/openFixture";
import { pausePageClock } from "./helpers/pageClock";
import { audioPaletteSignatureForSnapshot, cloneValue } from "./helpers/view-models";

// Production readiness S15: the Console's metering cases, moved out of
// audio.spec.ts by line range — at 1,977 lines that spec had no room left under
// the 2,000-line file guard. The meters on the strips and the plate, the live
// painter's canvas, the fixture double's simulated metering and the meter
// formatters; the move changed none of the cases.

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
  // S14: a baseline read once, so it is read with the Console on screen.
  await expectWorkspaceMounted(page, "audio");

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

test("marks simulated audio metering as test-stage movement", async ({ page }) => {
  test.slow();
  // Production readiness S15. Old: the case waited on real time — up to 5 s for
  // the painter's first frame, 5 s for the seeded strips below to read as more
  // than one level, 1.8 s for the canvas to move. New: the page's clock runs
  // the fixture double's metering interval and the painter's frames
  // (helpers/pageClock.ts), and the seeded strips are compared as the numbers
  // they are. Reason: the case was quarantined as a wall-clock measurement
  // (frontend/app/tests/quarantine.json until S15); what it checks is unchanged.
  await page.clock.install();
  await openFixture(page, "audio-populated");

  await expect(page.getByTestId("audio-meter-simulation-chip")).toHaveText("TEST METER SIMULATION");
  // 2026-05-27 redesign: the rail Trust panel is gone. The simulated metering
  // label moved to the AudioTopBar's Metering stat cell ("test simulation").
  // The rail-card "Active mix · test meters" copy is retired (no replacement
  // — the monitor bar shows only the active master meter).
  // The metering source is a footer item now (old: the top bar's stat cell).
  await expect(page.getByTestId("audio-footer-telemetry")).toContainText("Test meter simulation");
  // Slice 8 (system §9): one state, one word — the mixer chip and the plate
  // both call meter simulation by the same name.
  await expect(page.getByTestId("audio-inspector-metering")).toContainText("TEST METER SIMULATION");

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
  await expectWorkspaceMounted(page, "audio");
  await pausePageClock(page);
  // Each attempt runs one metering tick and the frames it paints, then reads.
  await expect
    .poll(async () => {
      await page.clock.runFor(AUDIO_METERING_TICK_MS);
      return (await readMeterCanvasSample(page, "audio-strip-audio-input-9")).checksum;
    })
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
  const seededLevels = await readSeededLevels();
  for (const seededLevel of seededLevels) {
    expect(seededLevel).toBeGreaterThanOrEqual(20);
    expect(seededLevel).toBeLessThanOrEqual(96);
  }
  // Production readiness S15. Old: the four levels were rounded to whole
  // percent and polled for 5 s until they read as more than one level. New: one
  // read, compared as they are — no two strips share a level. Reason: a strip's
  // level is the Console's audio snapshot, taken once as the Console starts;
  // the metering ticks move the painter's canvas, never the strips, so the poll
  // had nothing to wait for. At 2 % of start-up instants the four seeded
  // envelopes round to one whole percent (85.37, 85.02, 85.11 and 85.31 at
  // 2026-09-21 08:00:00.000 UTC) and the case failed on any runner; unrounded,
  // no two were equal at any of 3,611 instants over an hour. Only seeding that
  // gives two strips one envelope makes them equal — which is what this guards.
  expect(new Set(seededLevels).size).toBe(seededLevels.length);

  const programPlaybackMeter = page.getByTestId("audio-strip-audio-playback-1-2").locator("[data-meter]");
  await expect(programPlaybackMeter).toHaveCount(1);
  // 2026-05-27 redesign: the rail's "Active mix" mini-meter (audio-active-mix-meter)
  // was removed with the rail; the monitor bar's master meter replaced it. The
  // strip/inspector meter no-animation guards above already cover the
  // "simulated metering must not CSS-animate" contract.
  const firstCanvasSample = await readMeterCanvasSample(page, "audio-strip-audio-input-9");
  await expect
    .poll(async () => {
      await page.clock.runFor(AUDIO_METERING_TICK_MS * 3);
      return (await readMeterCanvasSample(page, "audio-strip-audio-input-9")).checksum;
    })
    .not.toBe(firstCanvasSample.checksum);
  await page.clock.resume();

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
