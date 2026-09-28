import { expect, test, type Browser, type Page } from "@playwright/test";

// The prompter's window's page (`prompter.html`, the design's §7): the glass
// on the Prompter XL. In the app the shell opens it on the Prompter XL's
// screen; here it is a browser's page on the engine's test double, at the
// Prompter XL's size. The test double behind the page is the page's own, so
// what the operator would press on the other window is sent to it through
// `window.__SSE_TEST_GLASS__`.

const PROMPTER_XL = { width: 1920, height: 1080 };

async function openPrompterWindow(page: Page, fixture = "teleprompter-ready") {
  // The requests the page sends are counted from its first.
  await page.addInitScript(() => {
    window.__SSE_TEST_ENGINE_REQUEST_COUNTS__ = {};
  });
  const response = await page.goto(`/prompter.html?fixture=${fixture}`);
  expect(response?.status(), "prompter.html is a page of the build").toBeLessThan(400);
  await expect(page.getByTestId("prompter-window-glass")).toBeVisible();
}

/** Asks the test double behind the page, as the operator's window would. */
async function operatorSends(page: Page, method: string, params: Record<string, unknown> = {}) {
  await page.evaluate(
    ([sentMethod, sentParams]) =>
      window.__SSE_TEST_GLASS__!.request(sentMethod as string, sentParams as Record<string, never>),
    [method, params] as const
  );
}

/** How far up the text stands, in the glass's own pixels. */
async function textShift(page: Page): Promise<number> {
  return page.getByTestId("prompter-window-glass").evaluate((glass) => {
    const column = glass.querySelector("[data-p]")?.parentElement as HTMLElement | null;
    const shift = /translate3d\(0(?:px)?, (-?[\d.]+)px/.exec(column?.style.transform ?? "");
    return shift ? Number(shift[1]) : Number.NaN;
  });
}

/** Where every line of the text begins: the first word of each line, by paragraph. */
async function lineStarts(page: Page): Promise<string[]> {
  return page.getByTestId("prompter-window-glass").evaluate((glass) => {
    const starts: string[] = [];
    glass.querySelectorAll<HTMLElement>("[data-p]").forEach((paragraph) => {
      let lineTop = Number.NaN;
      paragraph.querySelectorAll<HTMLElement>("[data-w]").forEach((word) => {
        if (word.offsetTop !== lineTop) {
          lineTop = word.offsetTop;
          starts.push(`${paragraph.dataset.p}:${word.dataset.w}`);
        }
      });
    });
    return starts;
  });
}

test.describe("the prompter's window", () => {
  test.use({ viewport: PROMPTER_XL });

  test("is the glass and nothing else: the script's words on black, all of the screen, no pointer", async ({
    page,
  }) => {
    await openPrompterWindow(page);
    const glass = page.getByTestId("prompter-window-glass");
    await expect(glass).toHaveAttribute("data-layout-key", /^g\d+-l\d+$/);

    // All of the Prompter XL's screen, and nothing beside it to scroll to.
    expect(await glass.boundingBox()).toEqual({ x: 0, y: 0, ...PROMPTER_XL });
    const page_ = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      background: getComputedStyle(document.body).backgroundColor,
      window: getComputedStyle(document.querySelector('[data-testid="prompter-window"]')!).backgroundColor,
      pointers: [...document.querySelectorAll("*")]
        .map((element) => getComputedStyle(element).cursor)
        .filter((cursor) => cursor !== "none"),
      pressed: document.querySelectorAll("button, a, input, select, textarea, [role='button'], [tabindex]").length,
    }));
    expect(page_.scrollWidth).toBe(PROMPTER_XL.width);
    expect(page_.scrollHeight).toBe(PROMPTER_XL.height);
    expect(page_.background).toBe("rgb(0, 0, 0)");
    expect(page_.window).toBe("rgb(0, 0, 0)");
    expect(page_.pointers, "no pointer over any of it").toEqual([]);
    expect(page_.pressed, "nothing on it is pressed").toBe(0);

    // The script's words and END, and no word of Studio Control's own.
    const words = (await page.getByTestId("prompter-window").innerText()).replace(/\s+/g, " ").trim();
    expect(words.endsWith("END")).toBe(true);
    for (const own of ["Studio Control", "Prompter XL", "PAUSED", "CONNECTED", "hardware link"]) {
      expect(words.includes(own), own).toBe(false);
    }

    await expect(page).toHaveScreenshot("prompter-window-1920x1080.png");
  });

  test("is black while nothing is on the prompter", async ({ page }) => {
    await openPrompterWindow(page, "teleprompter-empty");
    const glass = page.getByTestId("prompter-window-glass");
    await expect(glass).not.toHaveAttribute("data-layout-key");
    expect(await glass.boundingBox()).toEqual({ x: 0, y: 0, ...PROMPTER_XL });
    expect(await page.getByTestId("prompter-window").innerText()).toBe("");
    await expect(glass.locator("[data-p]")).toHaveCount(0);
    await expect(page).toHaveScreenshot("prompter-window-blank-1920x1080.png");
  });

  test("sends the hardware link its two requests, and no other", async ({ page }) => {
    await openPrompterWindow(page);
    await expect
      .poll(() => page.evaluate(() => window.__SSE_TEST_ENGINE_REQUEST_COUNTS__?.["prompter.layout.report"] ?? 0))
      .toBeGreaterThan(0);
    const sent = await page.evaluate(() => Object.keys(window.__SSE_TEST_ENGINE_REQUEST_COUNTS__ ?? {}).sort());
    expect(sent).toEqual(["prompter.glass.snapshot", "prompter.layout.report"]);
  });

  test("follows the take: it scrolls while the text plays, and stands when it is paused", async ({ page }) => {
    await openPrompterWindow(page);
    await expect.poll(() => textShift(page)).not.toBeNaN();
    const paused = await textShift(page);
    await page.waitForTimeout(400);
    expect(await textShift(page), "paused after a start").toBe(paused);

    await operatorSends(page, "prompter.play");
    await expect.poll(() => textShift(page), { timeout: 5_000 }).toBeLessThan(paused - 20);

    await operatorSends(page, "prompter.pause");
    // The pause eases for 0.3 s; then nothing moves.
    await page.waitForTimeout(600);
    const stopped = await textShift(page);
    await page.waitForTimeout(500);
    expect(await textShift(page)).toBe(stopped);
    expect(stopped).toBeLessThan(paused);
  });

  test("follows what the operator does to the glass: a jump, another look, a clear", async ({ page }) => {
    await openPrompterWindow(page);
    await expect.poll(() => textShift(page)).not.toBeNaN();
    const before = await textShift(page);

    await operatorSends(page, "prompter.jump", { to: "top" });
    await expect.poll(() => textShift(page)).toBeGreaterThan(before);

    // A colour needs no new layout, and so has no new key: it is read all the same.
    const key = await page.getByTestId("prompter-window-glass").getAttribute("data-layout-key");
    const colour = () =>
      page
        .getByTestId("prompter-window-glass")
        .evaluate((glass) => getComputedStyle(glass.querySelector("[data-p]")!).color);
    expect(await colour()).toBe("rgb(255, 255, 255)");
    await operatorSends(page, "prompter.look.update", { textColour: "yellow" });
    await expect.poll(colour).toBe("rgb(255, 216, 74)");
    await expect(page.getByTestId("prompter-window-glass")).toHaveAttribute("data-layout-key", key!);

    // A larger text is another layout.
    await operatorSends(page, "prompter.textSize", { step: 2 });
    await expect(page.getByTestId("prompter-window-glass")).not.toHaveAttribute("data-layout-key", key!);

    await operatorSends(page, "prompter.clear");
    await expect(page.getByTestId("prompter-window-glass").locator("[data-p]")).toHaveCount(0);
    expect(await page.getByTestId("prompter-window").innerText()).toBe("");
  });
});

// The design's §7: Studio Control draws at the resolution Windows reports, and
// Windows' display scaling on that screen changes nothing, because the script
// is drawn in the screen's own pixels.
test.describe("the prompter's window under Windows' scaling", () => {
  async function at(browser: Browser, viewport: { width: number; height: number }, deviceScaleFactor: number) {
    const context = await browser.newContext({ viewport, deviceScaleFactor });
    const page = await context.newPage();
    await openPrompterWindow(page);
    await expect(page.getByTestId("prompter-window-glass")).toHaveAttribute("data-layout-key", /^g\d+-l\d+$/);
    await expect
      .poll(() => page.evaluate(() => window.__SSE_TEST_ENGINE_REQUEST_COUNTS__?.["prompter.layout.report"] ?? 0))
      .toBeGreaterThan(0);
    const box = await page.getByTestId("prompter-window-glass").boundingBox();
    const result = {
      box,
      starts: await lineStarts(page),
      pixels: await page.evaluate(() => [
        Math.round(window.innerWidth * window.devicePixelRatio),
        Math.round(window.innerHeight * window.devicePixelRatio),
      ]),
    };
    await context.close();
    return result;
  }

  test("breaks every line alike at 100 %, 125 % and 150 %, and fills the screen's own pixels", async ({ browser }) => {
    const plain = await at(browser, { width: 1920, height: 1080 }, 1);
    const at125 = await at(browser, { width: 1536, height: 864 }, 1.25);
    const at150 = await at(browser, { width: 1280, height: 720 }, 1.5);

    expect(plain.starts.length).toBeGreaterThan(20);
    expect(at125.starts).toEqual(plain.starts);
    expect(at150.starts).toEqual(plain.starts);
    for (const scaled of [plain, at125, at150]) {
      expect(scaled.pixels).toEqual([1920, 1080]);
    }
    expect(at125.box).toEqual({ x: 0, y: 0, width: 1536, height: 864 });
    expect(at150.box).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
  });

  test("keeps the glass whole on a screen of another shape, black around it", async ({ browser }) => {
    const tall = await at(browser, { width: 1920, height: 1200 }, 1);
    expect(tall.box).toEqual({ x: 0, y: 60, width: 1920, height: 1080 });
    const wide = await at(browser, { width: 2560, height: 1080 }, 1);
    expect(wide.box).toEqual({ x: 320, y: 0, width: 1920, height: 1080 });
    // Below the Prompter XL's own size the glass is drawn smaller, the same lines on it.
    const low = await at(browser, { width: 1280, height: 720 }, 1);
    expect(low.box).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
    expect(low.starts).toEqual(tall.starts);
  });
});
