import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { expect, test } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../../");

const EXPECTED_INSPECTOR_FILES = [
  "frontend/app/src/app/audio/components/inspector/audioInspectorHelpers.ts",
  "frontend/app/src/app/audio/components/inspector/AudioInspectorChannelHardwareCard.tsx",
  "frontend/app/src/app/audio/components/inspector/AudioInspectorChannelHeader.tsx",
  "frontend/app/src/app/audio/components/inspector/AudioInspectorChannelMeterCard.tsx",
  "frontend/app/src/app/audio/components/inspector/AudioInspectorChannelSendActions.tsx",
  "frontend/app/src/app/audio/components/inspector/AudioInspectorDynamicsTab.tsx",
  "frontend/app/src/app/audio/components/inspector/AudioInspectorEqBandTray.tsx",
  "frontend/app/src/app/audio/components/inspector/AudioInspectorEqLowCutTray.tsx",
  "frontend/app/src/app/audio/components/inspector/AudioInspectorEqTab.tsx",
  "frontend/app/src/app/audio/components/inspector/AudioInspectorOutputView.tsx",
  "frontend/app/src/app/audio/components/inspector/AudioInspectorOverviewCards.tsx",
  "frontend/app/src/app/audio/components/inspector/AudioInspectorSendsTab.tsx",
  "frontend/app/src/app/audio/components/inspector/AudioInspectorTabStrip.tsx",
];

const EXPECTED_HOOK_FILES = [
  "frontend/app/src/app/audio/hooks/useAudioArming.ts",
  "frontend/app/src/app/audio/hooks/useAudioInspectorEqState.ts",
  "frontend/app/src/app/audio/hooks/useAudioKeyboardShortcuts.ts",
  "frontend/app/src/app/audio/hooks/useAudioOptimisticSettings.ts",
  "frontend/app/src/app/audio/hooks/useAudioPaletteRegistration.ts",
];

const EXPECTED_PER_COMPONENT_CSS_MODULES = [
  "frontend/app/src/app/audio/components/AudioHealthBar.module.css",
  "frontend/app/src/app/audio/components/AudioInspector.module.css",
  "frontend/app/src/app/audio/components/AudioMixerLane.module.css",
  "frontend/app/src/app/audio/components/AudioRail.module.css",
  "frontend/app/src/app/audio/components/AudioSignalCanvas.module.css",
  "frontend/app/src/app/audio/components/AudioSnapshotDeck.module.css",
  "frontend/app/src/app/audio/components/AudioToolbar.module.css",
];

const EXPECTED_AUDIO_SHARED_MODULES = [
  "frontend/app/src/app/audio/audioArming.ts",
  "frontend/app/src/app/audio/audioConstants.ts",
  "frontend/app/src/app/audio/components/AudioArmCountdown.tsx",
];

// Why: the Slice 5 close-out pass extracted nine utility-component CSS modules
// to drive shell `AudioWorkspace.module.css` from 1342 → 217 lines (under the
// plan's ≤ 600 budget). If any of these get reabsorbed back into shell the
// shell budget breaks silently — these specs flag the regression at the file
// level before the size assertions catch it at the line level.
const EXPECTED_UTILITY_CSS_MODULES = [
  "frontend/app/src/app/audio/components/AudioArmCountdown.module.css",
  "frontend/app/src/app/audio/components/AudioDialog.module.css",
  "frontend/app/src/app/audio/components/AudioFader.module.css",
  "frontend/app/src/app/audio/components/AudioLiveMeterReadout.module.css",
  "frontend/app/src/app/audio/components/AudioMeterCanvasOverlay.module.css",
  "frontend/app/src/app/audio/components/AudioPreampControl.module.css",
  "frontend/app/src/app/audio/components/AudioSliderControl.module.css",
  "frontend/app/src/app/audio/components/AudioStereoMeter.module.css",
  "frontend/app/src/app/audio/components/AudioTargetPicker.module.css",
];

// Why: the Slice 5 close-out pass also split MixerLane along the Tier vs Lane
// TSX boundary, and Inspector along the per-tab boundary. Those splits brought
// the two largest modules under the ≤ 1100 per-file budget; the specs guard
// the file-level shape.
const EXPECTED_TAB_BOUNDARY_CSS_MODULES = [
  "frontend/app/src/app/audio/components/AudioInspectorDynamicsTab.module.css",
  "frontend/app/src/app/audio/components/AudioInspectorEqTab.module.css",
  "frontend/app/src/app/audio/components/AudioInspectorSendsTab.module.css",
  "frontend/app/src/app/audio/components/AudioTieredMixer.module.css",
];

// Why: the palette-registration hook came in at 369 lines on first extract;
// the 14 fixed palette actions + per-channel solo/mute actions were moved to
// a pure builder so the hook itself fits under the ≤ 200 hook budget. If the
// builder gets re-inlined the hook overflows silently.
const EXPECTED_HOOK_HELPER_FILES = ["frontend/app/src/app/audio/hooks/buildAudioPaletteActions.ts"];

test.describe("audio code-health Slice 5 file structure", () => {
  for (const relative of EXPECTED_INSPECTOR_FILES) {
    test(`inspector split: ${path.basename(relative)} exists`, () => {
      const absolute = path.join(repoRoot, relative);
      expect(existsSync(absolute), `${relative} should exist after Slice 5B`).toBe(true);
    });
  }

  for (const relative of EXPECTED_HOOK_FILES) {
    test(`workspace hooks: ${path.basename(relative)} exists`, () => {
      const absolute = path.join(repoRoot, relative);
      expect(existsSync(absolute), `${relative} should exist after Slice 5C`).toBe(true);
    });
  }

  for (const relative of EXPECTED_PER_COMPONENT_CSS_MODULES) {
    test(`per-component CSS module: ${path.basename(relative)} exists`, () => {
      const absolute = path.join(repoRoot, relative);
      expect(existsSync(absolute), `${relative} should exist after Slice 5A`).toBe(true);
    });
  }

  for (const relative of EXPECTED_AUDIO_SHARED_MODULES) {
    test(`audio shared module: ${path.basename(relative)} exists`, () => {
      const absolute = path.join(repoRoot, relative);
      expect(existsSync(absolute), `${relative} should exist after the prior slices`).toBe(true);
    });
  }

  for (const relative of EXPECTED_UTILITY_CSS_MODULES) {
    test(`utility CSS module: ${path.basename(relative)} exists`, () => {
      const absolute = path.join(repoRoot, relative);
      expect(existsSync(absolute), `${relative} should exist after the Slice 5 close-out`).toBe(true);
    });
  }

  for (const relative of EXPECTED_TAB_BOUNDARY_CSS_MODULES) {
    test(`tab-boundary CSS module: ${path.basename(relative)} exists`, () => {
      const absolute = path.join(repoRoot, relative);
      expect(existsSync(absolute), `${relative} should exist after the Slice 5 close-out`).toBe(true);
    });
  }

  for (const relative of EXPECTED_HOOK_HELPER_FILES) {
    test(`hook helper: ${path.basename(relative)} exists`, () => {
      const absolute = path.join(repoRoot, relative);
      expect(existsSync(absolute), `${relative} should exist after the Slice 5 close-out`).toBe(true);
    });
  }
});
