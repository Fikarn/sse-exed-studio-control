import { expect, test, type Page } from "@playwright/test";

import { ARM_DWELL_MS } from "../../packages/design-system/src/components/useArm";
import { expectWorkspaceMounted, openFixture } from "./helpers/openFixture";
import { pausePageClock } from "./helpers/pageClock";

// The Overview (D47, board 3) against the fixture double, on its three
// moments: `overview-take` (CAM 1 records, the script plays at 140, every link
// answers), `overview-landing` (the first look of the day: the Console not yet
// read, the script paused at ¶ 1) and `overview-fault` (CAM 1 lost mid-take,
// a clip held, the script at 145). The page mirrors the worst page, sends
// what the pages send, and lays out every page's key facts at once. Where the
// app opens is `landing.spec.ts`.

async function openOverview(page: Page, fixture: string) {
  await openFixture(page, fixture);
  await expectWorkspaceMounted(page, "overview");
}

/** How often the double has been asked `method` since the page opened. */
const asked = (page: Page, method: string) =>
  page.evaluate((name) => window.__SSE_TEST_ENGINE_REQUEST_COUNTS__?.[name] ?? 0, method);

const display = (page: Page) => page.getByTestId("overview-state-display");

/** The band reports the glass's layout once the faces are in; PLAY unlocks then. */
async function expectLaidOut(page: Page) {
  await expect(page.getByTestId("overview-play")).not.toHaveAttribute("data-locked", "", { timeout: 10_000 });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__SSE_TEST_ENGINE_REQUEST_COUNTS__ = {};
  });
});

test.describe("the state display: the worst page", () => {
  test("reads READY while every link answers, and lights no room", async ({ page }) => {
    await openOverview(page, "overview-take");
    await expect(display(page)).toHaveAttribute("data-tone", "ok");
    await expect(display(page)).toContainText("READY");
    await expect(display(page)).toContainText("Every link answers. Nothing on any page needs you.");
    await expect(display(page)).toContainText("8 of 8 links answer");
    await expect(page.locator("[data-room][data-alert]")).toHaveCount(0);
    await expect(page.getByTestId("overview-latch-slot")).toHaveAttribute("data-count", "0");
  });

  test("mirrors the Console's ASSUMED, lights THE SOUND, and its Sync from here makes the studio READY", async ({
    page,
  }) => {
    await openOverview(page, "overview-landing");
    await expect(display(page)).toHaveAttribute("data-tone", "attention");
    await expect(display(page)).toContainText("ASSUMED");
    await expect(display(page).locator("[data-state-sentence]")).toHaveText(/^Console: /);
    await expect(page.getByTestId("overview-room-sound")).toHaveAttribute("data-alert", "attention");
    await expect(page.getByTestId("overview-room-picture")).not.toHaveAttribute("data-alert", /.*/);

    await page.getByTestId("overview-state-sync").click();
    await expect(display(page)).toContainText("READY");
    expect(await asked(page, "audio.sync")).toBe(1);
    await expect(page.getByTestId("overview-room-sound")).not.toHaveAttribute("data-alert", /.*/);
  });

  test("mirrors CAM 1 lost mid-take in the cameras' words, lights THE PICTURE, and opens Cameras", async ({ page }) => {
    await openOverview(page, "overview-fault");
    await expect(display(page)).toHaveAttribute("data-tone", "error");
    await expect(display(page)).toContainText("UNREACHABLE");
    await expect(display(page).locator("[data-state-sentence]")).toHaveText(/^Cameras: CAM 1/);
    await expect(page.getByTestId("overview-status-card")).toHaveAttribute("data-tone", "error");
    await expect(page.getByTestId("overview-room-picture")).toHaveAttribute("data-alert", "error");
    // REC is last known, with the take's values in doubt.
    await expect(page.getByTestId("overview-rec")).toHaveAttribute("data-rec", "last-known");
    await expect(page.getByTestId("overview-take-timecode")).toHaveAttribute("data-doubt", "");

    await page.getByTestId("overview-state-open-cameras").click();
    await expectWorkspaceMounted(page, "cameras");
  });
});

test("the latch slot holds every page's latches: a held clip, cleared from here", async ({ page }) => {
  await openOverview(page, "overview-fault");
  const clip = page.getByTestId("overview-latch-audio-clip");
  await expect(clip).toContainText("CLIP");
  await expect(clip).toContainText("1 over 0 dBFS · Guest 1");
  await expect(page.getByTestId("overview-status-card")).toHaveAttribute("data-latched", "");
  await page.getByTestId("overview-latch-audio-clip-clear").click();
  await expect(page.getByTestId("overview-latch-slot")).toHaveAttribute("data-count", "0");
  expect(await asked(page, "audio.clip.clear")).toBe(1);
});

test("REC starts CAM 1 with one press and stops it with two, as on Cameras", async ({ page }) => {
  await page.clock.install();
  await openOverview(page, "overview-landing");
  const rec = page.getByTestId("overview-rec");
  await expect(rec).toHaveAttribute("data-rec", "stopped");
  await rec.click();
  await expect(rec).toHaveAttribute("data-rec", "recording");
  await expect(page.getByTestId("overview-take-length")).toContainText("counted here since");
  await expect(page.locator('[data-testid="shell-rec-slot"] [data-tone="error"]')).toBeVisible();

  await pausePageClock(page);
  await rec.click();
  await expect(rec).toHaveAttribute("data-armed", "true");
  await expect(display(page)).toContainText("Stop recording on CAM 1 · press again");
  await page.clock.fastForward(ARM_DWELL_MS + 50);
  await rec.click();
  await page.clock.resume();
  await expect(rec).toHaveAttribute("data-rec", "stopped");
  expect(await asked(page, "cameras.record.start")).toBe(1);
  expect(await asked(page, "cameras.record.stop")).toBe(1);
});

test("the take's keys send what the Teleprompter's send, and the tape follows the pace", async ({ page }) => {
  await openOverview(page, "overview-landing");
  await expectLaidOut(page);
  const tape = page.getByTestId("overview-speed-tape");
  await expect(tape).toHaveAttribute("data-value", "140");
  await expect(tape).toHaveAttribute("data-caption", "this script's own pace");

  await page.getByTestId("overview-speed-up").click();
  await expect(tape).toHaveAttribute("data-value", "145");
  // The page's own press is not the deck's turn.
  await expect(tape).not.toHaveAttribute("data-turned", "");
  await page.getByTestId("overview-speed-down").click();
  await expect(tape).toHaveAttribute("data-value", "140");
  expect(await asked(page, "prompter.speed")).toBe(2);

  await page.getByTestId("overview-cue-on").click();
  await expect(page.getByTestId("overview-place")).toContainText("¶ 9 of 18");
  // The script's first cue opens ¶ 9: from it there is none before the reading line.
  await expect(page.getByTestId("overview-cue-back")).toHaveAttribute("data-locked", "");
  await page.getByTestId("overview-top").click();
  await expect(page.getByTestId("overview-place")).toContainText("¶ 1 of 18");

  const play = page.getByTestId("overview-play");
  await play.click();
  await expect(play).toHaveAttribute("data-live", "");
  await expect(page.getByTestId("overview-run-state")).toContainText("Playing");
  await page.getByTestId("overview-back").click();
  await play.click();
  await expect(play).not.toHaveAttribute("data-live", "");
  expect(await asked(page, "prompter.play")).toBe(1);
  expect(await asked(page, "prompter.pause")).toBe(1);
  expect(await asked(page, "prompter.jump")).toBe(3);
});

test("a cue's time ahead falls as the pace goes up", async ({ page }) => {
  await openOverview(page, "overview-landing");
  await expectLaidOut(page);
  const first = page.getByTestId("overview-cue-0").locator("[data-seconds]");
  await expect(first).toHaveAttribute("data-seconds", /^\d/);
  const at140 = Number(await first.getAttribute("data-seconds"));
  await page.getByTestId("overview-speed-up").click();
  await expect(page.getByTestId("overview-speed-tape")).toHaveAttribute("data-value", "145");
  await expect.poll(async () => Number(await first.getAttribute("data-seconds"))).toBeLessThan(at140);
});

test("the glass band stands its reading line at the look's own share of the band", async ({ page }) => {
  await openOverview(page, "overview-landing");
  await expectLaidOut(page);
  const band = page.getByTestId("overview-glass-band");
  const box = (await band.boundingBox())!;
  const arrow = (await band.locator("[data-glass-arrow]").boundingBox())!;
  // The standard look's reading line stands at 35 % of the glass's height.
  expect(Math.abs(arrow.y + arrow.height / 2 - box.y - box.height * 0.35)).toBeLessThanOrEqual(1.5);
  expect(arrow.x).toBeGreaterThanOrEqual(box.x);
});

test("the four pictures are the helper's four: CAM 1, CAM 2, CAM 3 and CAM 1's loupe", async ({ page }) => {
  await openOverview(page, "overview-take");
  const places = () => page.evaluate(() => window.__SSE_TEST_CAMERAS__!.picturePlaces());
  await expect.poll(async () => (await places()).last?.pictures.length).toBe(4);
  const [hero, tile2, tile3, loupe] = (await places()).last!.pictures;
  const whole = { x: 0, y: 0, width: 1920, height: 1080 };
  // The loupe at 2:1 looks at a small picture's size, 160 × 90, around the centre.
  const loupePart = { x: 880, y: 495, width: 160, height: 90 };
  expect(hero).toMatchObject({ camera: 1, part: whole, smooth: true, marker: loupePart, peaking: false });
  expect(hero!.at).toMatchObject({ width: 1280, height: 720 });
  expect(tile2).toMatchObject({ camera: 2, part: whole });
  expect(tile3).toMatchObject({ camera: 3, part: whole });
  expect(tile2!.at).toMatchObject({ width: 320, height: 180 });
  expect(loupe).toMatchObject({ camera: 1, part: loupePart, smooth: false, guides: false });

  // 4:1 looks at half as much; the zebras reach CAM 1 and the loupe, and the Cameras page keeps them.
  await page.getByTestId("overview-zoom-4").click();
  await page.getByTestId("overview-aid-zebras").click();
  await expect
    .poll(async () => (await places()).last?.pictures[3]?.part)
    .toEqual({ x: 920, y: 518, width: 80, height: 45 });
  await expect.poll(async () => (await places()).last?.pictures[0]?.zebras).toBe(true);
  await page.getByTestId("overview-door-cameras").click();
  await expectWorkspaceMounted(page, "cameras");
  await expect(page.getByTestId("cameras-aid-zebras")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("cameras-zoom-4")).toHaveAttribute("aria-pressed", "true");
});

test("the meters wait for a Sync while the Console is not sure of the desk, and move once it is", async ({ page }) => {
  await openOverview(page, "overview-landing");
  const canvas = page.getByTestId("audio-meter-canvas");
  await expect(page.getByTestId("overview-workspace")).toHaveAttribute("data-canvas-metering", "false");
  await expect(canvas).toHaveAttribute("data-meter-ballistics", "gated");
  await expect(page.getByTestId("overview-meters-gated")).toHaveText("The meters wait for a Sync from TotalMix.");

  await openOverview(page, "overview-take");
  await expect(page.getByTestId("overview-workspace")).toHaveAttribute("data-canvas-metering", "true");
  await expect(canvas).toHaveAttribute("data-meter-ballistics", "display");
  // Four inputs and Main Out's two sides.
  await expect.poll(async () => Number(await canvas.getAttribute("data-meter-count"))).toBe(6);
  await expect(page.getByTestId("overview-meters-gated")).toHaveCount(0);
});

test("M mutes an input and Main Out as the Console sends it", async ({ page }) => {
  await openOverview(page, "overview-take");
  const host = page.locator('[data-testid^="overview-mute-audio-input"]').first();
  await host.click();
  await expect(host).toHaveAttribute("data-engaged", "");
  expect(await asked(page, "audio.channel.update")).toBe(1);
  await page.getByTestId("overview-mute-main").click();
  await expect(page.getByTestId("overview-mute-main")).toHaveAttribute("data-engaged", "");
  expect(await asked(page, "audio.mixTarget.update")).toBe(1);
});

// The boards' own check (overview-3.html's `__report`): no line is cut, on any
// of the three moments. A text that gives way by design says so.
for (const fixture of ["overview-take", "overview-landing", "overview-fault"]) {
  test(`${fixture}: nothing is cut`, async ({ page }) => {
    await openOverview(page, fixture);
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
