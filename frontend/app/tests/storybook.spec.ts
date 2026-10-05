import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { liveAudioMasks } from "./helpers/liveAudioMasks";

// The captures of the design system's stories and of the prompter's glass.
// The storybook-static build (`npm run frontend:storybook:build`, chained into
// `frontend:playwright:test`) is served by the second `webServer` entry in
// `playwright.config.ts` on port 6007. Every story in `index.json` is opened
// at `/iframe.html?id=<id>&viewMode=story`; the baselines are under
// `tests/__visual__/storybook.spec.ts-snapshots/`.
//
// Of the A primitives the Sheet is captured, which holds every primitive at
// rest but the header's, the Shell board, which holds those (the tabs, the
// lamps, the REC tally and the logotype), and the boards of the overlays held
// open (their names end ", open"); `ui-contract.spec.ts` measures every one of
// their pages. The shell's page stories are gone (2026-09-28):
// `visual-review.spec.ts` captures the same boards from the same fixtures. The
// visual overhaul's polish (2026-10-05): the old "Design System/Primitives"
// boards are gone too, their components retired or on the A primitives boards.
//
// New pages program, Slice SW (D22): Studio Control runs on Windows at
// 2560×1440. Off Windows Playwright skips the comparison (`ignoreSnapshots`),
// so CI's Linux runner still checks that every story loads and paints.

const STORYBOOK_BASE = "http://127.0.0.1:6007";
const FIXTURE_NOW = new Date("2026-04-23T09:11:00+02:00");

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
const A_PRIMITIVES = "Design System/A primitives";
const stories: StoryEntry[] = Object.values(index.entries)
  .map((entry) => ({ id: entry.id, name: entry.name, title: entry.title }))
  .filter(
    (story) =>
      story.title !== A_PRIMITIVES ||
      story.name.startsWith("Sheet") ||
      story.name === "Shell" ||
      story.name.endsWith(", open")
  );

for (const story of stories) {
  test(`${story.title} — ${story.name}`, async ({ page }) => {
    await page.clock.setFixedTime(FIXTURE_NOW);
    const url = `${STORYBOOK_BASE}/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story`;
    const response = await page.goto(url, { waitUntil: "networkidle" });
    expect(response, `${story.id} should return a document response`).not.toBeNull();
    expect(response!.status(), `${story.id} should not 404`).toBeLessThan(400);

    // Storybook 10's iframe renders the story root inside the document
    // body. For component stories #storybook-root is visible; for
    // fullscreen-layout stories (`parameters.layout: "fullscreen"`) it's
    // `display: contents`-style and reports as hidden, so we only require
    // attached + rely on `toHaveScreenshot` to settle the paint.
    await page.locator("#storybook-root").first().waitFor({ state: "attached" });

    // STA-01 (S12): a zero-height story root means the baseline is a blank
    // frame guarding nothing — exactly the silent failure that left 8 shell
    // baselines byte-identical. Require a real painted box before capture.
    const rootBox = await page.locator("#storybook-root").first().boundingBox();
    expect(rootBox?.height, `${story.id} story root must paint at a real height`).toBeGreaterThan(0);

    await expect(page).toHaveScreenshot(`${story.id}.png`, { mask: liveAudioMasks(page) });
  });
}
