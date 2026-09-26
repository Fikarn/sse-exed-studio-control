import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { liveAudioMasks } from "./helpers/liveAudioMasks";

// plan PR 5 / workstream D5: Storybook visual integration. The
// storybook-static build (produced by `npm run frontend:storybook:build`,
// chained into `frontend:playwright:test`) is served by the second
// `webServer` entry in `playwright.config.ts` on port 6007. We read the
// generated `index.json`, iterate over every story id, navigate to
// `/iframe.html?id=<id>&viewMode=story`, and take a `toHaveScreenshot`
// per story.
//
// Baselines live next to the per-surface specs under
// `tests/__visual__/storybook.spec.ts-snapshots/`: the win32 captures at
// 2560×1440, the only ones there are.
//
// New pages program, Slice SW (D22): Studio Control runs on Windows at
// 2560×1440, and this spec does nothing but capture, so it runs on Windows
// only. It is skipped, not quarantined: the gate is checked on the workstation
// before each push (`frontend/app/tests/__visual__/README.md`).
test.skip(process.platform !== "win32", "the Storybook captures are the Windows workstation's (D22)");

const STORYBOOK_BASE = "http://127.0.0.1:6007";
const FIXTURE_NOW = new Date("2026-04-23T09:11:00+02:00");

// STA-01 (S12): now that the shell stories paint real 2560x1440 frames
// (height decorator), they are full-app renders — the same capture class as
// visual-review.spec.ts, which budgets FULL_RENDER_MAX_DIFF_PX=800 for
// single-frame render noise (slider-fill/grid sub-pixel jitter, font AA).
// DS component stories keep the strict config default (maxDiffPixels: 100).
const FULL_RENDER_MAX_DIFF_PX = 800;

interface StoryEntry {
  id: string;
  name: string;
  title: string;
}

interface StorybookIndex {
  v: number;
  entries: Record<string, StoryEntry & Record<string, unknown>>;
}

const indexPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../storybook-static/index.json");

const index = JSON.parse(readFileSync(indexPath, "utf-8")) as StorybookIndex;
const stories: StoryEntry[] = Object.values(index.entries).map((entry) => ({
  id: entry.id,
  name: entry.name,
  title: entry.title,
}));

function shouldFreezeClock(storyId: string) {
  // Every shell story prints the header clock (visual overhaul A, Slice 2).
  // Freeze the clock so the captures are stable.
  return storyId.includes("operatorshell");
}

function shouldAwaitAudioHydration(storyId: string) {
  // GLO-09: the monitor-strip solo chip derives from the audio snapshot,
  // which hydrates on its own refresh machine after bootstrap — wait for the
  // shell's hydration marker so ready-frame captures are deterministic.
  // Pre-ready stories never mount the strip; Setup does since visual
  // overhaul A, Slice 2 (one shell on every surface), so it waits too.
  return (
    storyId.includes("operatorshell") &&
    !storyId.includes("bootstrap") &&
    !storyId.includes("protocol") &&
    !storyId.includes("startup")
  );
}

for (const story of stories) {
  test(`${story.title} — ${story.name}`, async ({ page }) => {
    if (shouldFreezeClock(story.id)) {
      await page.clock.setFixedTime(FIXTURE_NOW);
    }
    const url = `${STORYBOOK_BASE}/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story`;
    const response = await page.goto(url, { waitUntil: "networkidle" });
    expect(response, `${story.id} should return a document response`).not.toBeNull();
    expect(response!.status(), `${story.id} should not 404`).toBeLessThan(400);

    // Storybook 10's iframe renders the story root inside the document
    // body. For component stories #storybook-root is visible; for
    // fullscreen-layout stories (`parameters.layout: "fullscreen"` —
    // OperatorShell uses this) it's `display: contents`-style and reports
    // as hidden, so we only require attached + rely on `toHaveScreenshot`
    // to settle the paint.
    await page.locator("#storybook-root").first().waitFor({ state: "attached" });

    // STA-01 (S12): a zero-height story root means the baseline is a blank
    // frame guarding nothing — exactly the silent failure that left 8 shell
    // baselines byte-identical. Require a real painted box before capture.
    const rootBox = await page.locator("#storybook-root").first().boundingBox();
    expect(rootBox?.height, `${story.id} story root must paint at a real height`).toBeGreaterThan(0);

    if (shouldAwaitAudioHydration(story.id)) {
      await page.waitForSelector("html[data-audio-hydrated]", { state: "attached", timeout: 10_000 });
    }

    await expect(page).toHaveScreenshot(`${story.id}.png`, {
      mask: liveAudioMasks(page),
      ...(story.title.startsWith("Shell/") ? { maxDiffPixels: FULL_RENDER_MAX_DIFF_PX } : {}),
    });
  });
}
