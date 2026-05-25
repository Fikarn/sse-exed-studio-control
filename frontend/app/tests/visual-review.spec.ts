import { expect, test, type Locator, type Page } from "@playwright/test";

// Visual review baselines for the operator shell across the hardware-profile
// fallback ladder plus the Scaled Studio Preview surface. Replaces the
// screenshot-only loop that used to live in `scripts/tauri-visual-review.mjs`:
// the captures are now `toHaveScreenshot` baselines committed under
// `tests/__visual__/visual-review.spec.ts-snapshots/`, and PR diffs upload via
// the GitHub Actions `playwright-report` / `test-results` artifacts.

const FIXTURES = [
  "setup-ready",
  "protocol-mismatch",
  "lighting-populated",
  "audio-populated",
  "planning-populated",
] as const;

interface Viewport {
  readonly width: number;
  readonly height: number;
  readonly label: string;
}

const SIZES: readonly Viewport[] = [
  { width: 1280, height: 800, label: "1280x800" },
  { width: 1440, height: 900, label: "1440x900" },
  { width: 1600, height: 960, label: "1600x960" },
  { width: 1728, height: 1117, label: "1728x1117" },
  { width: 1920, height: 1080, label: "1920x1080" },
  { width: 2560, height: 1440, label: "2560x1440" },
];

// plan PR 11 / workstream A2: extend Scaled Studio Preview baselines beyond
// Audio so every operator surface in `OperatorLayoutProvider.tsx` is
// regression-tested on the proportional `2560x1440` review canvas, not just
// the Audio fixture. The host viewport mirrors the built-in 14-inch M5
// MacBook (the documented review surface in `docs/DEVELOPMENT.md §2b`).
const STUDIO_PREVIEW_FIXTURES = ["setup-ready", "lighting-populated", "audio-populated", "planning-populated"] as const;
const STUDIO_PREVIEW_HOST: Viewport = { width: 1512, height: 982, label: "1512x982" };

// Planning fixtures render relative time labels ("in 5 minutes", "ended 1h
// ago"). Freezing the clock keeps those labels stable across runs.
const FIXTURE_NOW = new Date("2026-04-23T09:11:00+02:00");

// Live, JS-driven surfaces that drift between captures (meter tracks redraw
// every engine tick, the overlay canvas accumulates sample history, the
// inspector signal canvas paints peaks). Mask these on audio fixtures so the
// baseline diff covers layout + chrome, not live values.
function liveAudioMasks(page: Page): Locator[] {
  return [
    page.locator('[data-meter-component="stereo"]'),
    page.locator('[data-testid="audio-meter-canvas"]'),
    page.locator('[data-testid="audio-signal-canvas"]'),
  ];
}

function masksFor(page: Page, fixture: string): Locator[] {
  return fixture.startsWith("audio-") ? liveAudioMasks(page) : [];
}

function expectedLayoutMode(width: number, height: number): string {
  if (width >= 1920 && height >= 1080) return "studioFull";
  if (width >= 1440 && height >= 900) return "desktopCompact";
  if (width >= 1280 && height >= 800) return "narrowUtility";
  return "constrained";
}

async function gotoFixture(page: Page, fixture: string, options: { operatorReview?: "studio" } = {}) {
  if (fixture.startsWith("planning-")) {
    await page.clock.setFixedTime(FIXTURE_NOW);
  }
  const params = new URLSearchParams({ fixture, transport: "fixture" });
  if (options.operatorReview) {
    params.set("operatorReview", options.operatorReview);
  }
  const response = await page.goto(`/?${params.toString()}`, { waitUntil: "networkidle" });
  expect(response, `fixture ${fixture} should return a document response`).not.toBeNull();
  expect(response!.status(), `fixture ${fixture} should not fail to load`).toBeLessThan(400);
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

async function assertLightingResponsive(page: Page, size: Viewport) {
  const expectedMode = expectedLayoutMode(size.width, size.height);
  const details = await page.evaluate(() => {
    const root = document.querySelector("[data-operator-layout-root]");
    const stage = document.querySelector('[data-testid="lighting-stage"]');
    const primaryControls = Array.from(document.querySelectorAll("[data-toolbar-primary]"));
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    return {
      layoutMode: root?.getAttribute("data-layout-mode") ?? null,
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

  expect(details.layoutMode, `lighting layout mode @ ${size.label}`).toBe(expectedMode);

  const primaryIds = details.primaryControls.map((entry) => entry.id).sort();
  expect(primaryIds, `lighting toolbar primary controls @ ${size.label}`).toEqual([
    "add",
    "overflow",
    "patch",
    "preview",
    "search",
    "status",
    "title",
  ]);

  const clipped = details.primaryControls.filter((entry) => !entry.fits).map((entry) => entry.id);
  expect(clipped, `lighting toolbar primary controls clipped @ ${size.label}`).toEqual([]);

  const stageMinWidth = expectedMode === "narrowUtility" ? 520 : 560;
  const stageMinHeight = expectedMode === "narrowUtility" ? 400 : 440;
  expect(details.stage, `lighting stage missing @ ${size.label}`).not.toBeNull();
  expect(details.stage!.width, `lighting stage width @ ${size.label}`).toBeGreaterThanOrEqual(stageMinWidth);
  expect(details.stage!.height, `lighting stage height @ ${size.label}`).toBeGreaterThanOrEqual(stageMinHeight);

  if (expectedMode !== "studioFull") {
    await page.locator('[data-testid="lighting-toolbar-overflow"]').click();
    const menuLabels = await page.locator('[role="menuitem"]').allTextContents();
    for (const label of ["Highlight selection", "Solo selection", "Find selected fixtures"]) {
      expect(
        menuLabels.some((entry) => entry.includes(label)),
        `lighting overflow missing '${label}' @ ${size.label}`
      ).toBe(true);
    }
    await page.keyboard.press("Escape");
  }

  if (expectedMode === "narrowUtility") {
    const drawer = page.locator('[data-testid="lighting-inspector-drawer"]');
    expect(await drawer.count(), `lighting inspector drawer should start closed @ ${size.label}`).toBe(0);
    await page.locator('[data-testid="lighting-open-inspector"]').click();
    await drawer.waitFor({ state: "visible" });
    await expect(
      drawer.getByLabel("Fixture intensity"),
      `lighting inspector drawer should expose selected fixture controls @ ${size.label}`
    ).toBeVisible();
    await drawer.getByRole("button", { name: "Close" }).click();
    await drawer.waitFor({ state: "detached" });
  }
}

function assertRatioClose(actual: number, expected: number, label: string, tolerance = 0.06) {
  expect(Number.isFinite(actual), `${label} ratio must be finite`).toBe(true);
  expect(Math.abs(actual - expected), label).toBeLessThanOrEqual(tolerance);
}

async function assertStudioPreviewFidelity(page: Page, fixture: string, size: Viewport) {
  const details = await page.evaluate(() => {
    const root = document.querySelector("[data-operator-layout-root]");
    const displayFor = (selector: string) => {
      const node = document.querySelector(selector);
      return node ? getComputedStyle(node).display : null;
    };
    const ratioFor = (node: Element | null) => {
      if (!node) return null;
      const rect = (node as HTMLElement).getBoundingClientRect();
      return rect.height > 0 ? rect.width / rect.height : null;
    };
    const compactPreampPanels = Array.from(
      document.querySelectorAll('[data-testid="audio-workspace"] img[class*="preampPanel"]')
    )
      .map((node) => node as HTMLImageElement)
      .filter((image) => image.currentSrc.includes("preamp-panel-compact"))
      .map((image) => ({
        naturalRatio: image.naturalWidth / Math.max(1, image.naturalHeight),
        renderedRatio: ratioFor(image),
      }));

    return {
      canvasBarLabelDisplay: displayFor("[class*=canvasBarLabel]"),
      canvasSelectedMetaDisplay: displayFor("[class*=canvasSelectedMeta]"),
      compactPreampPanels,
      root: root
        ? {
            layoutHeight: root.getAttribute("data-layout-height"),
            layoutMode: root.getAttribute("data-layout-mode"),
            layoutWidth: root.getAttribute("data-layout-width"),
            reviewSurface: root.getAttribute("data-review-surface"),
          }
        : null,
    };
  });

  expect(details.root?.reviewSurface, `Studio Preview review surface @ ${size.label}`).toBe("studioPreview");
  expect(details.root?.layoutMode, `Studio Preview layout mode @ ${size.label}`).toBe("studioFull");
  expect(details.root?.layoutWidth, `Studio Preview simulated width @ ${size.label}`).toBe("2560");
  expect(details.root?.layoutHeight, `Studio Preview simulated height @ ${size.label}`).toBe("1440");

  if (fixture.startsWith("audio-")) {
    expect(details.canvasBarLabelDisplay, `Audio Studio Preview canvas bar label hidden @ ${size.label}`).not.toBe(
      "none"
    );
    expect(details.canvasSelectedMetaDisplay, `Audio Studio Preview selected meta hidden @ ${size.label}`).not.toBe(
      "none"
    );
    expect(
      details.compactPreampPanels.length,
      `Audio Studio Preview must render compact preamp panels @ ${size.label}`
    ).toBeGreaterThan(0);
    details.compactPreampPanels.forEach((panel, index) => {
      assertRatioClose(
        panel.renderedRatio ?? Number.NaN,
        panel.naturalRatio,
        `Audio Studio Preview compact preamp panel ${index + 1} @ ${size.label}`
      );
    });
  }
}

for (const size of SIZES) {
  test.describe(`viewport ${size.label}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    for (const fixture of FIXTURES) {
      test(`${fixture}`, async ({ page }) => {
        await gotoFixture(page, fixture);

        if (fixture === "lighting-populated") {
          await assertLightingResponsive(page, size);
          // The lighting responsive harness opens overlays for non-studioFull
          // modes; re-navigate so the baseline screenshot captures the rest
          // state instead of any tail end of those interactions.
          await gotoFixture(page, fixture);
        }

        await assertViewportFit(page, size, fixture);
        await expect(page).toHaveScreenshot(`${fixture}-${size.label}.png`, {
          mask: masksFor(page, fixture),
        });
      });
    }
  });
}

test.describe("studio preview", () => {
  test.use({ viewport: { width: STUDIO_PREVIEW_HOST.width, height: STUDIO_PREVIEW_HOST.height } });

  for (const fixture of STUDIO_PREVIEW_FIXTURES) {
    test(`${fixture} @ ${STUDIO_PREVIEW_HOST.label}`, async ({ page }) => {
      await gotoFixture(page, fixture, { operatorReview: "studio" });
      await assertStudioPreviewFidelity(page, fixture, STUDIO_PREVIEW_HOST);
      await expect(page).toHaveScreenshot(`${fixture}-studio-preview-${STUDIO_PREVIEW_HOST.label}.png`, {
        mask: masksFor(page, fixture),
      });
    });
  }
});

test.describe("dpr-independent lighting layout", () => {
  for (const deviceScaleFactor of [1, 2] as const) {
    test(`devicePixelRatio ${deviceScaleFactor}`, async ({ browser }) => {
      const context = await browser.newContext({
        deviceScaleFactor,
        timezoneId: "Europe/Stockholm",
        viewport: { width: 1440, height: 900 },
      });
      try {
        const page = await context.newPage();
        await page.goto("/?fixture=lighting-populated&transport=fixture", {
          waitUntil: "networkidle",
        });
        const mode = await page.locator("[data-operator-layout-root]").getAttribute("data-layout-mode");
        expect(mode, `lighting layout mode must follow CSS viewport size (DPR=${deviceScaleFactor})`).toBe(
          "desktopCompact"
        );
      } finally {
        await context.close();
      }
    });
  }
});
