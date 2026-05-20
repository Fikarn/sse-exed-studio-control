import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { expect, test } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../../");

const EXPECTED_INSPECTOR_FILES = [
  "frontend/app/src/app/audio/components/inspector/audioInspectorHelpers.ts",
  "frontend/app/src/app/audio/components/inspector/AudioInspectorChannelHeader.tsx",
  "frontend/app/src/app/audio/components/inspector/AudioInspectorDynamicsTab.tsx",
  "frontend/app/src/app/audio/components/inspector/AudioInspectorEqTab.tsx",
  "frontend/app/src/app/audio/components/inspector/AudioInspectorOutputView.tsx",
  "frontend/app/src/app/audio/components/inspector/AudioInspectorOverviewCards.tsx",
  "frontend/app/src/app/audio/components/inspector/AudioInspectorSendsTab.tsx",
];

const EXPECTED_HOOK_FILES = [
  "frontend/app/src/app/audio/hooks/useAudioArming.ts",
  "frontend/app/src/app/audio/hooks/useAudioOptimisticSettings.ts",
];

const EXPECTED_AUDIO_SHARED_MODULES = [
  "frontend/app/src/app/audio/audioArming.ts",
  "frontend/app/src/app/audio/audioConstants.ts",
  "frontend/app/src/app/audio/components/AudioArmCountdown.tsx",
];

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

  for (const relative of EXPECTED_AUDIO_SHARED_MODULES) {
    test(`audio shared module: ${path.basename(relative)} exists`, () => {
      const absolute = path.join(repoRoot, relative);
      expect(existsSync(absolute), `${relative} should exist after the prior slices`).toBe(true);
    });
  }
});
