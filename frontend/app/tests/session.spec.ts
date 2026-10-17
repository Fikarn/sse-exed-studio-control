import { expect, test, type Page } from "@playwright/test";

import { expectWorkspaceMounted, openFixture } from "./helpers/openFixture";
import { stepToBoard } from "./helpers/ui-contract/boards.mjs";

// The Session page (D51, board 2: `docs/design/boards/session-2.html`, with
// `docs/design/session.md`) against the fixture double, on its four boards:
// `session-choose` (no session runs, the Console only assumed, the last session
// of two kinds), `session-window` (the podcast Room's window), `session-running`
// (the podcast recording runs since 08:46, each kind has a last session) and
// `session-running-window` (its own window). The page asks one question and
// stands three Rooms under it; a Room opens its window, whose Begin begins the
// session and opens the Overview. Where the app opens is `landing.spec.ts`.

/** The boards' moment, as the captures and the measures fix it (09:11 in Stockholm). */
const FIXTURE_NOW = new Date("2026-04-23T09:11:00+02:00");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__SSE_TEST_ENGINE_REQUEST_COUNTS__ = {};
  });
  await page.clock.setFixedTime(FIXTURE_NOW);
});

/** Every animation on the page has run: the Rooms' entrance, a window's open or close. */
async function settleAnimations(page: Page) {
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined)))
  );
}

async function openSession(page: Page, fixture: string) {
  await openFixture(page, fixture);
  await expectWorkspaceMounted(page, "session");
  await settleAnimations(page);
}

/** How often the double has been asked `method` since the page opened. */
const asked = (page: Page, method: string) =>
  page.evaluate((name) => window.__SSE_TEST_ENGINE_REQUEST_COUNTS__?.[name] ?? 0, method);

const room = (page: Page, kind: string) => page.getByTestId(`session-room-${kind}`);
const sessionWindow = (page: Page) => page.getByTestId("session-window");
const tab = (page: Page, name: string) =>
  page.locator('[data-region="header"]').getByRole("button", { name, exact: true });
const toasts = (page: Page) => page.getByRole("region", { name: "Notifications" });

/** Opens a Room's window and waits for it to stand open. */
async function openWindow(page: Page, kind: string) {
  await room(page, kind).click();
  await expect(sessionWindow(page)).toBeVisible();
  await settleAnimations(page);
}

/** Back to the Session page from another page, by its tab. */
async function backToSession(page: Page) {
  await tab(page, "Session").click();
  await expectWorkspaceMounted(page, "session");
  await settleAnimations(page);
}

test.describe("the question and the Rooms", () => {
  test("three keys under the day's question, each with its kind's name and line", async ({ page }) => {
    await openSession(page, "session-choose");
    await expect(tab(page, "Session")).toHaveAttribute("aria-current", "page");
    const question = page.getByTestId("session-question");
    await expect(question).toContainText("Thursday 23 April");
    await expect(question).toContainText("What are we making today?");
    await expect(page.getByTestId("session-running")).toHaveCount(0);

    for (const [kind, name, line] of [
      ["green-screen", "Green Screen Recording", "A presenter at the screen, with the prompter."],
      ["podcast", "Podcast Recording", "Voices around the table, a camera on each."],
      ["webinar", "Webinar", "Live, to an audience online."],
    ] as const) {
      await expect(room(page, kind)).toHaveRole("button");
      await expect(room(page, kind)).toContainText(name);
      await expect(room(page, kind)).toContainText(line);
      await expect(room(page, kind), "no session runs: no Room is lit").not.toHaveAttribute("data-lit", "");
      // Its words are text the measures read, not a picture.
      await expect(room(page, kind)).not.toHaveAttribute("data-picture", /.*/);
    }
    // Board 2's places at 2560 × 1440: 600 × 880, 56 apart, centred, at 342.
    const boxes = await page.locator("[data-session-room]").evaluateAll((rooms) =>
      rooms.map((element) => {
        const rect = element.getBoundingClientRect();
        return [rect.x, rect.y, rect.width, rect.height];
      })
    );
    expect(boxes).toEqual([
      [324, 342, 600, 880],
      [980, 342, 600, 880],
      [1636, 342, 600, 880],
    ]);
  });

  test("the page has no cluster, no plate and no state display; the footer is the Overview's", async ({ page }) => {
    await openSession(page, "session-choose");
    await expect(page.locator('[data-region="cluster"]')).toHaveCount(0);
    await expect(page.locator('[data-region="plate"]')).toHaveCount(0);
    await expect(page.locator('[data-region="state-display"]')).toHaveCount(0);
    const bay = await page.locator('[data-region="bay"]').boundingBox();
    expect(bay).toEqual({ x: 0, y: 88, width: 2560, height: 1312 });
    const footer = page.getByTestId("session-footer");
    await expect(footer).toContainText("Takes today");
    await expect(footer).toContainText("Last sync");
    await expect(footer).toContainText("Backup");
  });
});

test.describe("a Room's window", () => {
  test("opens from its Room, its name field focused, while the Room on the page stands empty", async ({ page }) => {
    await openSession(page, "session-choose");
    await openWindow(page, "podcast");
    const dialog = page.getByRole("dialog", { name: "New session: Podcast Recording" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(dialog).toContainText("New session");
    await expect(dialog).toContainText("Thursday 23 April");
    await expect(page.getByTestId("session-name")).toBeFocused();
    await expect(page.getByTestId("session-name")).toHaveAttribute("placeholder", "A name, optional");
    // Board 2's window: 1200 × 620, centred in the bay.
    expect(await sessionWindow(page).boundingBox()).toEqual({ x: 680, y: 434, width: 1200, height: 620 });
    // The Room's picture is in the window; the Room keeps its place, empty.
    await expect(room(page, "podcast")).toHaveAttribute("data-away", "");
    await expect(room(page, "podcast")).toBeHidden();
    await expect(sessionWindow(page).locator('[data-session-room="umber"][data-size="window"]')).toBeVisible();
    await expect(page.getByTestId("session-begin")).toContainText("Begin session");
    await expect(page.getByTestId("session-begin")).toContainText("opens the Overview");
  });

  test("Use this name puts the last session's name in the field; the field takes 80 characters and no more", async ({
    page,
  }) => {
    await openSession(page, "session-choose");
    await openWindow(page, "podcast");
    const last = page.getByTestId("session-last");
    await expect(last).toContainText("Last time · Wednesday 22 April");
    await expect(last).toContainText("Leading Through Change — episode 2");
    await page.getByTestId("session-use-last").click();
    const field = page.getByTestId("session-name");
    await expect(field).toHaveValue("Leading Through Change — episode 2");
    await expect(field).toBeFocused();

    await field.fill("x".repeat(80));
    await field.press("y");
    await expect(field).toHaveValue("x".repeat(80));
    await page.getByTestId("session-begin").click();
    await expectWorkspaceMounted(page, "overview");
    expect(await asked(page, "session.begin")).toBe(1);
  });

  test("a kind never made says so, and has no name to use", async ({ page }) => {
    await openSession(page, "session-choose");
    await openWindow(page, "webinar");
    await expect(page.getByTestId("session-last")).toHaveText("No session of this kind yet");
    await expect(page.getByTestId("session-use-last")).toHaveCount(0);
  });

  test("its note is the worst page's: the Console's ASSUMED, and its Sync from here", async ({ page }) => {
    await openSession(page, "session-choose");
    await openWindow(page, "green-screen");
    const note = page.getByTestId("session-note");
    await expect(note).toContainText("ASSUMED");
    await expect(note).toContainText(/Console: /);
    await expect(page.getByTestId("session-note-sync")).toHaveText("Sync from TotalMix");
    await page.getByTestId("session-note-sync").click();
    await expect.poll(() => asked(page, "audio.sync")).toBe(1);
    // The Console read, every page is ready: the note goes, the window stays.
    await expect(note).toHaveCount(0);
    await expect(sessionWindow(page)).toBeVisible();
  });

  test("on a desk whose CAM 1 is lost, its note's way out opens the Cameras", async ({ page }) => {
    await openFixture(page, "overview-fault");
    await expectWorkspaceMounted(page, "overview");
    await backToSession(page);
    await openWindow(page, "podcast");
    await expect(page.getByTestId("session-note")).toContainText(/Cameras: /);
    await page.getByTestId("session-note-open-cameras").click();
    await expectWorkspaceMounted(page, "cameras");
    await expect(sessionWindow(page)).toHaveCount(0);
  });

  test("Begin session begins the session with its name trimmed, and opens the Overview", async ({ page }) => {
    await openSession(page, "session-choose");
    await openWindow(page, "podcast");
    await page.getByTestId("session-name").fill("  Leading Through Change — episode 3  ");
    // Enter in the field begins nothing: it stands in no form.
    await page.getByTestId("session-name").press("Enter");
    await expect(sessionWindow(page)).toBeVisible();
    expect(await asked(page, "session.begin")).toBe(0);

    await page.getByTestId("session-begin").click();
    await expectWorkspaceMounted(page, "overview");
    await expect(sessionWindow(page)).toHaveCount(0);
    expect(await asked(page, "session.begin")).toBe(1);

    await backToSession(page);
    await expect(page.getByTestId("session-running-line")).toHaveText(
      "Podcast Recording · Leading Through Change — episode 3 · since 09:11"
    );
    await expect(room(page, "podcast")).toHaveAttribute("data-lit", "");
  });

  test("a refusal keeps the window open and says the hardware link's sentence", async ({ page }) => {
    await openSession(page, "session-choose");
    await openWindow(page, "podcast");
    // The field stops at 80; a name set past it, as no keyboard can, is refused.
    await page.getByTestId("session-name").evaluate((input: HTMLInputElement) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "x".repeat(81));
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.getByTestId("session-begin").click();
    await expect(toasts(page)).toContainText("A session's name has at most 80 characters; this one has 81.");
    await expect(sessionWindow(page)).toBeVisible();
    await expect(page.getByTestId("overview-workspace")).toHaveCount(0);
    expect(await asked(page, "session.begin")).toBe(1);
  });

  for (const [how, close] of [
    ["Esc", (page: Page) => page.keyboard.press("Escape")],
    ["Cancel", (page: Page) => page.getByTestId("session-cancel").click()],
    [
      "a press on the dimmed page",
      (page: Page) => page.getByTestId("session-window-scrim").click({ position: { x: 200, y: 600 } }),
    ],
  ] as const) {
    test(`${how} closes it back into its Room, and gives the Room the focus`, async ({ page }) => {
      await openSession(page, "session-choose");
      const before = await page
        .locator("[data-session-room]")
        .evaluateAll((rooms) => rooms.map((element) => element.getBoundingClientRect().toJSON()));
      await openWindow(page, "podcast");
      await close(page);
      await expect(sessionWindow(page)).toHaveCount(0);
      await expect(room(page, "podcast")).toBeVisible();
      await expect(room(page, "podcast")).not.toHaveAttribute("data-away", "");
      await expect(room(page, "podcast")).toBeFocused();
      const after = await page
        .locator("[data-session-room]")
        .evaluateAll((rooms) => rooms.map((element) => element.getBoundingClientRect().toJSON()));
      expect(after, "the Rooms stay where they were").toEqual(before);
      expect(await asked(page, "session.begin")).toBe(0);
    });
  }

  test("the header stays live above it: a tab leaves the page, and the window with it", async ({ page }) => {
    await openSession(page, "session-choose");
    await openWindow(page, "podcast");
    await tab(page, "Lighting").click();
    await expectWorkspaceMounted(page, "lighting");
    await expect(sessionWindow(page)).toHaveCount(0);
    await expect(page.getByTestId("session-window-scrim")).toHaveCount(0);
  });

  test("it opens from its Room: the face grows and the picture travels", async ({ page }) => {
    await recordKeyframes(page);
    await openSession(page, "session-choose");
    await openWindow(page, "podcast");
    const properties = await keyframesSeen(page);
    expect(properties.some((names) => names.includes("width") && names.includes("left"))).toBe(true);
    expect(properties.some((names) => names.includes("transform"))).toBe(true);
  });
});

test.describe("a running session", () => {
  test("its platter says what runs and since when, its Room is lit, and Continue opens the Overview", async ({
    page,
  }) => {
    await openSession(page, "session-running");
    const platter = page.getByTestId("session-running");
    await expect(platter).toContainText("In session");
    await expect(page.getByTestId("session-running-line")).toHaveText(
      "Podcast Recording · Leading Through Change — episode 3 · since 08:46"
    );
    await expect(room(page, "podcast")).toHaveAttribute("data-lit", "");
    await expect(room(page, "podcast")).toContainText("In session");
    await expect(room(page, "podcast")).toContainText("· since 08:46");
    await expect(room(page, "podcast")).not.toContainText("Voices around the table");
    await expect(room(page, "webinar")).not.toHaveAttribute("data-lit", "");
    // The question moves up for the platter; the Rooms stay where they are.
    expect((await page.getByTestId("session-question").boundingBox())?.y).toBe(150);
    expect((await room(page, "podcast").boundingBox())?.y).toBe(342);

    await page.getByTestId("session-running-continue").click();
    await expectWorkspaceMounted(page, "overview");
  });

  test("its own window holds End session, which ends it, and the Room's light goes off", async ({ page }) => {
    await openSession(page, "session-running");
    await openWindow(page, "podcast");
    const dialog = page.getByRole("dialog", { name: "In session: Podcast Recording" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("since 08:46 today");
    await expect(page.getByTestId("session-window-name")).toHaveText("Leading Through Change — episode 3");
    await expect(dialog).toContainText("Begun at 08:46");
    // The focus moves in to Continue: End session stands first in the window's order.
    await expect(page.getByTestId("session-continue")).toBeFocused();
    await expect(page.getByTestId("session-name")).toHaveCount(0);

    await page.getByTestId("session-end").click();
    await expect(sessionWindow(page)).toHaveCount(0);
    expect(await asked(page, "session.end")).toBe(1);
    await expect(page.locator("[data-session-room][data-lit]")).toHaveCount(0);
    await expect(page.getByTestId("session-running")).toHaveCount(0);
    // The question moves back down as the platter goes.
    await settleAnimations(page);
    expect((await page.getByTestId("session-question").boundingBox())?.y).toBe(214);
    await expect(room(page, "podcast")).toContainText("Voices around the table, a camera on each.");
  });

  test("its own window's Close closes it, and Continue opens the Overview", async ({ page }) => {
    await openSession(page, "session-running");
    await openWindow(page, "podcast");
    await page.getByTestId("session-close").click();
    await expect(sessionWindow(page)).toHaveCount(0);
    await expect(room(page, "podcast")).toHaveAttribute("data-lit", "");
    await openWindow(page, "podcast");
    await page.getByTestId("session-continue").click();
    await expectWorkspaceMounted(page, "overview");
    expect(await asked(page, "session.end")).toBe(0);
  });

  test("another Room's window names it, and Begin instead ends it and begins the new one", async ({ page }) => {
    await openSession(page, "session-running");
    await openWindow(page, "webinar");
    await expect(page.getByTestId("session-note-running")).toContainText(
      "Podcast Recording, since 08:46. Beginning this ends it."
    );
    // Every page is ready: the session it ends is the window's one note.
    await expect(page.getByTestId("session-note")).toHaveCount(0);
    await expect(page.getByTestId("session-last")).toContainText("Markets Outlook, spring");
    const begin = page.getByTestId("session-begin");
    await expect(begin).toContainText("Begin instead");
    await expect(begin).toContainText("ends the podcast recording · opens the Overview");

    await begin.click();
    await expectWorkspaceMounted(page, "overview");
    expect(await asked(page, "session.begin")).toBe(1);
    expect(await asked(page, "session.end")).toBe(0);

    await backToSession(page);
    await expect(page.getByTestId("session-running-line")).toHaveText("Webinar · no name · since 09:11");
    await expect(room(page, "webinar")).toHaveAttribute("data-lit", "");
    await expect(room(page, "podcast")).not.toHaveAttribute("data-lit", "");
  });
});

test.describe("motion", () => {
  test("with reduced motion the window only fades, and the Rooms stand at rest at once", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await recordKeyframes(page);
    await openFixture(page, "session-choose");
    await expectWorkspaceMounted(page, "session");
    await expect(page.getByTestId("session-workspace")).not.toHaveAttribute("data-entering", "");
    const roomsRunning = await page.evaluate(
      () =>
        document
          .getAnimations()
          .filter((animation) => animation.playState === "running")
          .filter((animation) => {
            const target = animation.effect && "target" in animation.effect ? animation.effect.target : null;
            return target instanceof Element && target.closest("[data-testid=session-workspace]");
          }).length
    );
    expect(roomsRunning, "no entrance runs").toBe(0);

    await openWindow(page, "podcast");
    await page.getByTestId("session-cancel").click();
    await expect(sessionWindow(page)).toHaveCount(0);
    const properties = await keyframesSeen(page);
    expect(properties.length, "the window faded in and out").toBeGreaterThanOrEqual(4);
    for (const names of properties) expect(names, "a fade moves nothing").toEqual(["opacity"]);
  });

  test("the Rooms come in once after a start, not at every return to the page", async ({ page }) => {
    await openFixture(page, "session-choose");
    await expectWorkspaceMounted(page, "session");
    await settleAnimations(page);
    await expect(page.getByTestId("session-workspace")).not.toHaveAttribute("data-entering", "");
    await tab(page, "Overview").click();
    await expectWorkspaceMounted(page, "overview");
    await tab(page, "Session").click();
    await expectWorkspaceMounted(page, "session");
    await expect(page.getByTestId("session-workspace")).not.toHaveAttribute("data-entering", "");
  });
});

// The boards' own check: no line is cut, on any of the four, the windows' included.
for (const fixture of ["session-choose", "session-window", "session-running", "session-running-window"]) {
  test(`${fixture}: nothing is cut`, async ({ page }) => {
    await openSession(page, fixture);
    await stepToBoard(page, fixture);
    await settleAnimations(page);
    await page.evaluate(() => document.fonts.ready);
    const cut = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("body *")]
        .filter((element) => {
          if (element.closest("[data-picture], [data-cut-by-design], [role='tooltip']")) return false;
          const style = getComputedStyle(element);
          if (style.display === "none" || !element.textContent?.trim() || element.children.length > 0) return false;
          const clips = style.whiteSpace === "nowrap" || style.textOverflow === "ellipsis";
          return clips && element.scrollWidth > element.clientWidth + 1;
        })
        .map((element) => `${element.dataset.testid ?? element.className}: ${element.textContent?.trim().slice(0, 40)}`)
    );
    expect(cut, `${fixture}: cut text`).toEqual([]);
  });
}

/** Records, before the page opens, the properties of every Web Animation the page starts. */
async function recordKeyframes(page: Page) {
  await page.addInitScript(() => {
    const seen: string[][] = [];
    (window as unknown as { __SSE_TEST_KEYFRAMES__: string[][] }).__SSE_TEST_KEYFRAMES__ = seen;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (
      this: Element,
      keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
      options?: number | KeyframeAnimationOptions
    ) {
      const frames = Array.isArray(keyframes) ? keyframes : keyframes ? [keyframes] : [];
      const names = new Set(frames.flatMap((frame) => Object.keys(frame)));
      for (const timing of ["offset", "easing", "composite"]) names.delete(timing);
      seen.push([...names].sort());
      return animate.call(this, keyframes, options);
    };
  });
}

const keyframesSeen = (page: Page) =>
  page.evaluate(() => (window as unknown as { __SSE_TEST_KEYFRAMES__: string[][] }).__SSE_TEST_KEYFRAMES__);
