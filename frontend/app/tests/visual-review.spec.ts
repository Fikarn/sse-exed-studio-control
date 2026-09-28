import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectToolbarPrimaryControlsFit } from "./helpers/lighting";
import { liveAudioMasks } from "./helpers/liveAudioMasks";
import { stepToBoard } from "./helpers/ui-contract/boards.mjs";

// The captures of the pages at 2560×1440, the one screen Studio Control runs
// on: `toHaveScreenshot` baselines under
// `tests/__visual__/visual-review.spec.ts-snapshots/`, compared on the Windows
// workstation only (`ignoreSnapshots` in playwright.config.ts) — on CI's Linux
// runner these cases make their other checks and compare no screenshot.
//
// A page's capture is its workspace: the header and the footer are masked,
// and captured once, as strips of their own (the last block). Until
// 2026-09-28 every capture held them, so a change to the header moved some
// twenty-eight captures; it now moves the strips.

// New pages program, Slice 6a: the Teleprompter joins with its ready board.
const FIXTURES = [
  "setup-ready",
  "protocol-mismatch",
  "lighting-populated",
  "audio-populated",
  "teleprompter-ready",
] as const;

interface Viewport {
  readonly width: number;
  readonly height: number;
  readonly label: string;
}

// The capture names keep their `-2560x1440` suffix.
const STUDIO: Viewport = { width: 2560, height: 1440, label: "2560x1440" };

// Lighting fixtures render relative time labels ("last 19h ago" on scene
// cards), and every shell prints the header clock. Freezing the clock for every
// fixture keeps them stable across runs — a guard for one workspace's fixtures
// only let the lighting scene-card label drift with wall-clock time until
// baselines rotted past the diff budget (2026-08-12).
const FIXTURE_NOW = new Date("2026-04-23T09:11:00+02:00");

// The live-audio masks are shared with storybook.spec.ts since production
// readiness S13: helpers/liveAudioMasks.ts (moved from here unchanged).

// AA / font rendering on the unmasked full-page renders jitters run-to-run
// (a stable element rendered a shade off at its edges) — e.g.
// lighting-populated-1280x800 once diffed 105 px against the default 100.
// The 2026-06-02 audio UX polish enlarged the jitter surface — the live meter
// sim's random fills plus the corrected sans face now resolving to Inter
// (instead of the unloaded "Inter Tight" -> system-ui fallback) add text-edge
// AA — so audio-populated-1440x900 reproducibly diffs ~440 px against a
// baseline regenerated from identical code. Raised 400 -> 800 to absorb that;
// still far below a real layout regression, which moves thousands of pixels.
const FULL_RENDER_MAX_DIFF_PX = 800;

const HEADER = '[data-region="header"]';
const FOOTER = '[data-region="footer"]';

function liveMasksFor(page: Page, fixture: string): Locator[] {
  return fixture.startsWith("audio-") ? liveAudioMasks(page) : [];
}

/** A page's capture leaves out the chrome, which has captures of its own. */
function masksFor(page: Page, fixture: string): Locator[] {
  return [page.locator(HEADER), page.locator(FOOTER), ...liveMasksFor(page, fixture)];
}

async function gotoFixture(page: Page, fixture: string) {
  await page.clock.setFixedTime(FIXTURE_NOW);
  const params = new URLSearchParams({ fixture, transport: "fixture" });
  const response = await page.goto(`/?${params.toString()}`, { waitUntil: "networkidle" });
  expect(response, `fixture ${fixture} should return a document response`).not.toBeNull();
  expect(response!.status(), `fixture ${fixture} should not fail to load`).toBeLessThan(400);
  // The audio snapshot hydrates on its own refresh machine after bootstrap;
  // chrome derived from it (the GLO-09 solo chip) would otherwise race the
  // capture. Pre-ready families never hydrate audio, so they skip the wait.
  const preReadyFixture =
    fixture.startsWith("protocol-") || fixture.startsWith("bootstrap-") || fixture.startsWith("startup");
  if (!preReadyFixture) {
    await page.waitForSelector("html[data-audio-hydrated]", { state: "attached", timeout: 10_000 });
  }
  // A board the page reaches by a press (Slice 6b: the Teleprompter's editor).
  await page.evaluate(() => document.fonts.ready);
  await stepToBoard(page, fixture);
}

async function assertViewportFit(page: Page, size: Viewport, fixture: string) {
  const metrics = await page.evaluate(() => ({
    bodyScrollHeight: document.body?.scrollHeight ?? 0,
    bodyScrollWidth: document.body?.scrollWidth ?? 0,
    docClientHeight: document.documentElement.clientHeight,
    docClientWidth: document.documentElement.clientWidth,
    docScrollHeight: document.documentElement.scrollHeight,
    docScrollWidth: document.documentElement.scrollWidth,
    innerHeight: window.innerHeight,
    innerWidth: window.innerWidth,
  }));
  expect(metrics.docScrollWidth, `${fixture} @ ${size.label} must not horizontally scroll`).toBeLessThanOrEqual(
    metrics.innerWidth + 1
  );
  expect(metrics.docScrollHeight, `${fixture} @ ${size.label} must not vertically scroll`).toBeLessThanOrEqual(
    metrics.innerHeight + 1
  );
  expect(metrics.bodyScrollWidth, `${fixture} @ ${size.label} body must not horizontally scroll`).toBeLessThanOrEqual(
    metrics.innerWidth + 1
  );
  expect(metrics.bodyScrollHeight, `${fixture} @ ${size.label} body must not vertically scroll`).toBeLessThanOrEqual(
    metrics.innerHeight + 1
  );
}

async function assertLightingLayout(page: Page, size: Viewport) {
  const details = await page.evaluate(() => {
    const stage = document.querySelector('[data-testid="lighting-stage"]');
    const primaryControls = Array.from(document.querySelectorAll("[data-toolbar-primary]"));
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    return {
      primaryControls: primaryControls.map((control) => {
        const rect = (control as HTMLElement).getBoundingClientRect();
        return {
          id: (control as HTMLElement).dataset.toolbarPrimary ?? "unknown",
          fits:
            rect.width > 0 &&
            rect.height > 0 &&
            rect.left >= -1 &&
            rect.top >= -1 &&
            rect.right <= viewportWidth + 1 &&
            rect.bottom <= viewportHeight + 1,
        };
      }),
      stage: stage
        ? {
            height: (stage as HTMLElement).getBoundingClientRect().height,
            width: (stage as HTMLElement).getBoundingClientRect().width,
          }
        : null,
    };
  });

  // Visual overhaul A, Slice 5. Old: seven toolbar primaries, "overflow" among
  // them, each measured where it stood. New: the same ids on their new homes in
  // the cluster, minus "overflow" — nothing folds into an overflow menu now.
  // The cluster is one scrolling column, so a primary below the fold is
  // reachable rather than clipped, and the clipping check is the helper's,
  // which brings each one into view first.
  const primaryIds = details.primaryControls.map((entry) => entry.id).sort();
  expect(primaryIds, `lighting primary controls @ ${size.label}`).toEqual([
    "add",
    "patch",
    "preview",
    "search",
    "status",
    "title",
  ]);
  await expectToolbarPrimaryControlsFit(page);

  expect(details.stage, `lighting stage missing @ ${size.label}`).not.toBeNull();
  expect(details.stage!.width, `lighting stage width @ ${size.label}`).toBeGreaterThanOrEqual(560);
  expect(details.stage!.height, `lighting stage height @ ${size.label}`).toBeGreaterThanOrEqual(440);

  // Visual overhaul A, Slice 5. Old: below the studio surface the selection's
  // tools folded into a toolbar overflow menu, and this checked the menu held
  // them. New: Highlight, Solo and Find are keys on the cluster at every size.
  // Reason: there is no overflow menu — the cluster is the same at every size.
  for (const testId of ["lighting-highlight-toggle", "lighting-solo-toggle", "lighting-identify-find"]) {
    expect(
      await page.locator(`[data-testid="${testId}"]`).count(),
      `lighting cluster missing '${testId}' @ ${size.label}`
    ).toBe(1);
  }
}

test.describe(`viewport ${STUDIO.label}`, () => {
  test.use({ viewport: { width: STUDIO.width, height: STUDIO.height } });

  for (const fixture of FIXTURES) {
    test(`${fixture}`, async ({ page }) => {
      await gotoFixture(page, fixture);

      if (fixture === "lighting-populated") {
        await assertLightingLayout(page, STUDIO);
        // The harness scrolls each primary control into view; re-navigate so
        // the baseline screenshot captures the rest state.
        await gotoFixture(page, fixture);
      }

      await assertViewportFit(page, STUDIO, fixture);
      await expect(page).toHaveScreenshot(`${fixture}-${STUDIO.label}.png`, {
        mask: masksFor(page, fixture),
        maxDiffPixels: FULL_RENDER_MAX_DIFF_PX,
      });
    });
  }
});

// R2-C (round-2 audit, R2-FIX-01): the designed empty/degraded states were
// functionally tested but never visually locked — the lighting "No fixtures
// on the rig yet" canvas state, the setup degraded banner posture and the
// audio assumed-state warning band could all silently regress. One
// state-locking capture each at 2560×1440.
// Close-out extension: the remaining degraded postures from the round-2
// audit's R2-FIX-01 matrix (audio not-verified / offline / action-failed
// warning bands + the lighting DMX-unreachable posture) join the loop —
// the full designed-state set is now locked.
const STATE_FIXTURES = [
  // The three screens before and beside a page: Setup not yet published, the
  // start, and a start that failed. Until 2026-09-28 Storybook's shell
  // stories captured them, with six boards this file captured as well.
  "setup-required",
  "startup-loading",
  "bootstrap-failed",
  "lighting-empty",
  "setup-degraded",
  "audio-state-assumed",
  "audio-not-verified",
  "audio-offline",
  "audio-action-failed",
  "lighting-dmx-unreachable",
  // New pages program, Slice 6a: the Teleprompter's first run, the Prompter XL
  // gone, and a script edited after it went on.
  "teleprompter-empty",
  "teleprompter-not-connected",
  "teleprompter-not-updated",
  // Slice 6b: the editor, on the script on the prompter edited since it went
  // on, and on a new script.
  "teleprompter-editing",
  "teleprompter-new-script",
] as const;

test.describe("state coverage", () => {
  test.use({ viewport: { width: 2560, height: 1440 } });

  for (const fixture of STATE_FIXTURES) {
    test(`${fixture} @ 2560x1440`, async ({ page }) => {
      await gotoFixture(page, fixture);
      await assertViewportFit(page, { width: 2560, height: 1440, label: "2560x1440" }, fixture);
      await expect(page).toHaveScreenshot(`${fixture}-2560x1440.png`, {
        mask: masksFor(page, fixture),
        maxDiffPixels: FULL_RENDER_MAX_DIFF_PX,
      });
    });
  }
});

// The chrome, captured once: what the masks above leave out. The header on
// each page (its tab is the lit one, and its lamps are that board's), on a
// board whose desk does not answer, and on a start that failed; and each
// page's footer.
const CHROME = [
  { name: "header-setup", fixture: "setup-ready", region: HEADER },
  { name: "header-lighting", fixture: "lighting-populated", region: HEADER },
  { name: "header-audio", fixture: "audio-populated", region: HEADER },
  { name: "header-teleprompter", fixture: "teleprompter-ready", region: HEADER },
  { name: "header-desk-offline", fixture: "audio-offline", region: HEADER },
  { name: "header-start-failed", fixture: "bootstrap-failed", region: HEADER },
  { name: "footer-setup", fixture: "setup-ready", region: FOOTER },
  { name: "footer-lighting", fixture: "lighting-populated", region: FOOTER },
  { name: "footer-audio", fixture: "audio-populated", region: FOOTER },
  { name: "footer-teleprompter", fixture: "teleprompter-ready", region: FOOTER },
] as const;

test.describe("the chrome", () => {
  test.use({ viewport: { width: 2560, height: 1440 } });

  for (const { name, fixture, region } of CHROME) {
    test(`${name}`, async ({ page }) => {
      await gotoFixture(page, fixture);
      await expect(page.locator(region)).toHaveScreenshot(`${name}.png`, {
        mask: liveMasksFor(page, fixture),
      });
    });
  }
});
