import { expect, test } from "@playwright/test";

import {
  AUDIO_ARM_TIMEOUT_MS,
  AUDIO_DRAFT_CLEAR_MS,
  AUDIO_THROTTLE_EQ_MS,
  AUDIO_THROTTLE_FADER_MS,
  INSPECTOR_DB_HYSTERESIS,
  INSPECTOR_READOUT_INTERVAL_MS,
  METER_PEAK_FALL_DB_PER_SECOND,
  METER_PEAK_HOLD_MS,
  PREAMP_GAIN_MAX_DB,
  PREAMP_ROTATION_ORIGIN_DEG,
  PREAMP_ROTATION_RANGE_DEG,
  PROTOTYPE_MONITOR_LEVEL_DB,
  SNAPSHOT_PLACEHOLDER_LEVELS,
  SNAPSHOT_THUMB_BAR_COUNT,
} from "../src/app/audio/audioConstants";
import { createAudioControlDraftStore } from "../src/app/audio/audioControlDraftStore";

test.describe("audio constants module", () => {
  test("publishes the timing and range constants that were previously inlined", () => {
    expect(AUDIO_ARM_TIMEOUT_MS).toBe(4500);
    expect(AUDIO_THROTTLE_FADER_MS).toBe(75);
    expect(AUDIO_THROTTLE_EQ_MS).toBe(500);
    expect(AUDIO_DRAFT_CLEAR_MS).toBe(250);
    expect(INSPECTOR_READOUT_INTERVAL_MS).toBe(150);
    expect(INSPECTOR_DB_HYSTERESIS).toBe(0.75);
  });

  test("aligns peak-hold ballistics with the engine and IEC PPM", () => {
    expect(METER_PEAK_HOLD_MS).toBe(1500);
    expect(METER_PEAK_FALL_DB_PER_SECOND).toBe(15);
  });

  test("publishes preamp range and rail prototype defaults", () => {
    expect(PREAMP_GAIN_MAX_DB).toBe(75);
    expect(PREAMP_ROTATION_RANGE_DEG).toBe(250);
    expect(PREAMP_ROTATION_ORIGIN_DEG).toBe(-125);
    expect(PROTOTYPE_MONITOR_LEVEL_DB).toBe(-12);
  });

  test("snapshot thumbnail density constants stay stable", () => {
    expect(SNAPSHOT_THUMB_BAR_COUNT).toBe(12);
    expect(SNAPSHOT_PLACEHOLDER_LEVELS).toHaveLength(SNAPSHOT_THUMB_BAR_COUNT);
    expect(Math.max(...SNAPSHOT_PLACEHOLDER_LEVELS)).toBeLessThanOrEqual(0.32);
    expect(Math.min(...SNAPSHOT_PLACEHOLDER_LEVELS)).toBeGreaterThanOrEqual(0.16);
  });
});

test.describe("audio control draft store", () => {
  test("notify isolates a throwing listener so subsequent listeners still fire", () => {
    const store = createAudioControlDraftStore();
    const warn = console.warn;
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    try {
      let bGotCalled = false;
      store.subscribe("fader:a", () => {
        throw new Error("boom from listener A");
      });
      store.subscribe("fader:a", () => {
        bGotCalled = true;
      });

      // A `set` triggers `notify`; the throw from listener A must not stop
      // listener B from running, and must surface as a console.warn.
      store.set("fader:a", 0.42);
      expect(bGotCalled).toBe(true);
      expect(warnings.some((entry) => String(entry[0]).includes("draft listener threw"))).toBe(true);
    } finally {
      console.warn = warn;
      store.dispose();
    }
  });
});

test.describe("audio tokens", () => {
  test("audio palette tokens resolve on the workspace root", async ({ page }) => {
    await page.goto("/?fixture=audio-populated");
    const workspace = page.getByTestId("audio-workspace");
    await expect(workspace).toBeVisible();

    const resolved = await workspace.evaluate((element) => {
      const computed = window.getComputedStyle(element);
      return {
        meterLow: computed.getPropertyValue("--audio-meter-low").trim(),
        meterOver: computed.getPropertyValue("--audio-meter-over").trim(),
        meterBg: computed.getPropertyValue("--audio-meter-bg").trim(),
        tierInputs: computed.getPropertyValue("--audio-tier-inputs").trim(),
        tierPlayback: computed.getPropertyValue("--audio-tier-playback").trim(),
        tierOutputs: computed.getPropertyValue("--audio-tier-outputs").trim(),
        outputMainOut: computed.getPropertyValue("--audio-output-main-out").trim(),
        outputPhonesA: computed.getPropertyValue("--audio-output-phones-a").trim(),
        outputPhonesB: computed.getPropertyValue("--audio-output-phones-b").trim(),
        groupTalent: computed.getPropertyValue("--audio-group-talent").trim(),
        warningSimulated: computed.getPropertyValue("--audio-warning-band-simulated").trim(),
      };
    });

    expect(resolved.meterLow.toLowerCase()).toBe("#36ce71");
    expect(resolved.meterOver.toLowerCase()).toBe("#ff3b30");
    expect(resolved.meterBg.toLowerCase()).toBe("#050608");
    expect(resolved.tierInputs.toLowerCase()).toBe("#d8c483");
    expect(resolved.tierPlayback.toLowerCase()).toBe("#d6acce");
    expect(resolved.tierOutputs.toLowerCase()).toBe("#5dc5e8");
    expect(resolved.outputMainOut.toLowerCase()).toBe("#5dc5e8");
    expect(resolved.outputPhonesA.toLowerCase()).toBe("#e8a341");
    expect(resolved.outputPhonesB.toLowerCase()).toBe("#b388f5");
    expect(resolved.groupTalent.toLowerCase()).toBe("#d8c483");
    expect(resolved.warningSimulated.toLowerCase()).toBe("#f59e0b");
  });
});
