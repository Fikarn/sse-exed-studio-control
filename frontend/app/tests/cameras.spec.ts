import { expect, test, type Page } from "@playwright/test";

import { ARM_DWELL_MS } from "../../packages/design-system/src/components/useArm";
import { FULL_PICTURE, testCardUyvy, uyvyToRgba } from "../../packages/engine-client/src/transports/pictureFrame";
import { STOP_WINDOW_MS } from "../src/app/cameras/perform";
import { peakingMask, peakingOverlay, zebraMask, zebraOverlay } from "../src/app/cameras/pictures/pictureAids";
import { openCameraKeyMenu, openCamerasPlateMenu, openFormat, openLook, openTileMenu } from "./helpers/cameras";
import { expectWorkspaceMounted, openFixture } from "./helpers/openFixture";
import { pausePageClock } from "./helpers/pageClock";

// The Cameras page against the fixture double (board 2, "Hero and two", as
// D10, D11 and D19 amend it). The double answers every cameras request as the
// hardware link does; its simulated cameras are reached through
// `window.__SSE_TEST_CAMERAS__`: a value changed on a camera's body, a camera
// that stops answering and answers again. The visual overhaul (2026-10-05):
// each camera has one menu (its key's ⋯, its small picture's ⋯, the plate
// title's ⋯, and a right-click on the key, the picture or the title); the values list, the typed
// entry, the format and the look open in popovers beside the plate, never a
// dialog, so the pictures stay drawn; the current choice is the selection.

async function openCameras(page: Page, fixture = "cameras-held") {
  await openFixture(page, fixture);
  await expectWorkspaceMounted(page, "cameras");
}

/** Past the arm's dwell: a second press before it is a bounce, and applies nothing. */
const PAST_THE_DWELL_MS = ARM_DWELL_MS + 50;

/**
 * Presses an armed key's two presses. The page's clock stands still from the
 * first press to the second and is moved past the dwell between them
 * (helpers/pageClock.ts), so the second is the confirm on any runner, inside
 * every arm window. The test installs the clock before the page opens.
 */
async function pressTwice(page: Page, testId: string) {
  await pausePageClock(page);
  await page.getByTestId(testId).click();
  await expect(page.getByTestId(testId)).toHaveAttribute("data-armed", "true");
  await page.clock.fastForward(PAST_THE_DWELL_MS);
  await page.getByTestId(testId).click();
  await page.clock.resume();
}

const state = (page: Page) => page.getByTestId("cameras-state-display");
const recChip = (page: Page) => page.getByTestId("shell-lamp-latched-rec");
const toast = (page: Page) => page.getByRole("status").filter({ hasText: /\S/ }).last();

test.describe("the Cameras page", () => {
  test("sits between Audio and the Teleprompter, and shows the selected camera big and the other two small", async ({
    page,
  }) => {
    await openCameras(page);
    const tabs = page.getByRole("navigation", { name: "Workspace navigation" }).getByRole("button");
    // The shell (overhaul 3): a tab carries its page's word, outside its name.
    await expect(tabs).toHaveCount(5);
    for (const [index, name] of ["Setup / Support", "Lighting", "Audio", "Cameras", "Teleprompter"].entries()) {
      await expect(tabs.nth(index)).toHaveAccessibleName(name);
    }
    await expect(state(page)).toContainText("HELD");
    await expect(state(page)).toContainText("CAM 1 is held: Studio Control reads it and sends only what you press.");
    await expect(state(page)).toContainText("3 of 3 held · CAM 1 not recording");

    await expect(page.getByTestId("cameras-hero-picture")).toHaveAttribute("data-camera", "1");
    await expect(page.getByTestId("cameras-hero-picture")).toHaveAttribute("data-picture", "");
    await expect(page.getByTestId("cameras-tile-2")).toBeVisible();
    await expect(page.getByTestId("cameras-tile-3")).toBeVisible();
    await expect(page.getByTestId("cameras-tile-1")).toHaveCount(0);
    await expect(page.getByTestId("cameras-plate")).toHaveAttribute("data-camera", "1");
    await expect(page.getByTestId("cameras-iso-value")).toContainText("400");
    await expect(page.getByTestId("cameras-shutter-value")).toContainText("180°");

    // The header: the cameras' lamp between the Console's and the prompter's
    // (D19). The shell (overhaul 3): each page's lamp is its tab's word, and
    // the open page's tab carries none, because the state display says it;
    // the deck's lamp follows the tabs. REC has its own slot, quiet at rest.
    const lamps = page.locator('[data-region="header"] [data-testid^="shell-lamp-"]:not([data-latch])');
    await expect(lamps).toHaveCount(4);
    await expect(page.getByTestId("shell-lamp-cameras")).toHaveCount(0);
    await expect(page.getByTestId("shell-lamp-surface")).toContainText("Surface");
    await expect(recChip(page)).toHaveCount(0);
    await expect(page.getByTestId("shell-rec-slot")).toHaveText("REC");
    await tabs.nth(0).click();
    await expect(tabs.nth(3).getByTestId("shell-lamp-cameras")).toContainText("ready");
  });

  test("has one selection: a camera's key and a small picture both select, and everything follows", async ({
    page,
  }) => {
    await openCameras(page);
    await page.getByTestId("cameras-key-2").click();
    await expect(page.getByTestId("cameras-key-2")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("cameras-key-1")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("cameras-hero-picture")).toHaveAttribute("data-camera", "2");
    await expect(page.getByTestId("cameras-plate")).toHaveAttribute("data-camera", "2");
    await expect(page.getByTestId("cameras-iso-value")).toContainText("800");
    await expect(page.getByTestId("cameras-tile-1")).toBeVisible();
    await expect(page.getByTestId("cameras-tile-2")).toHaveCount(0);
    await expect(state(page)).toContainText("CAM 2 is held");

    await page.getByTestId("cameras-tile-3").click();
    await expect(page.getByTestId("cameras-key-3")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("cameras-hero-picture")).toHaveAttribute("data-camera", "3");
    await expect(page.getByTestId("cameras-plate")).toHaveAttribute("data-camera", "3");
    await expect(page.getByTestId("cameras-iso-value")).toContainText("1600");
    await expect(page.getByTestId("cameras-footer")).toContainText("Big picture CAM 3 · 87.5 %");
  });

  test("the bank's keys say what the Stream Deck's dials set, and set it", async ({ page }) => {
    await openCameras(page);
    const bank = (name: string) => page.getByTestId(`cameras-bank-${name}`);
    const hint = page.getByTestId("cameras-dials-hint");
    const footer = page.getByTestId("cameras-footer");
    await expect(page.getByTestId("cameras-bank").getByRole("button")).toHaveText(["Exposure", "Colour", "Focus"]);
    await expect(bank("exposure")).toHaveAttribute("aria-pressed", "true");
    await expect(hint).toHaveText("The dials drive CAM 1: ISO · shutter · iris · ND.");
    await expect(footer).toContainText("Dials CAM 1 · Exposure");
    const recent = await page.getByTestId("cameras-recent-row").allTextContents();

    await bank("colour").click();
    await expect(bank("colour")).toHaveAttribute("aria-pressed", "true");
    await expect(bank("exposure")).toHaveAttribute("aria-pressed", "false");
    await expect(hint).toHaveText("The dials drive CAM 1: white balance · tint.");
    await expect(footer).toContainText("Dials CAM 1 · Colour");

    // The bank is the deck's, not a camera's: it stays when the selection
    // changes, and the dials follow the selection.
    await page.getByTestId("cameras-key-3").click();
    await expect(page.getByTestId("cameras-plate")).toHaveAttribute("data-camera", "3");
    await expect(bank("colour")).toHaveAttribute("aria-pressed", "true");
    await expect(hint).toHaveText("The dials drive CAM 3: white balance · tint.");
    await expect(footer).toContainText("Dials CAM 3 · Colour");

    await bank("focus").click();
    await expect(hint).toHaveText("The dials drive CAM 3: focus · a push is autofocus once.");
    await expect(footer).toContainText("Dials CAM 3 · Focus");

    // Setting the bank sends nothing to a camera and is no Recent action.
    await expect(page.getByTestId("cameras-recent-row")).toHaveText(recent);
  });

  test("the dials set nothing on a camera that is not held, and the hint says what brings them back", async ({
    page,
  }) => {
    const hint = page.getByTestId("cameras-dials-hint");
    await openCameras(page, "cameras-released");
    await expect(hint).toHaveText("CAM 2 is released: the dials set nothing until you press Connect.");
    await expect(hint).not.toHaveAttribute("data-live", "");
    // The bank can be set meanwhile: it is the deck's.
    await page.getByTestId("cameras-bank-focus").click();
    await expect(page.getByTestId("cameras-bank-focus")).toHaveAttribute("aria-pressed", "true");
    await expect(hint).toHaveText("CAM 2 is released: the dials set nothing until you press Connect.");
    await page.getByTestId("cameras-state-connect").click();
    await expect(hint).toHaveText("The dials drive CAM 2: focus · a push is autofocus once.");
    await expect(hint).toHaveAttribute("data-live", "");

    await openCameras(page, "cameras-unreachable");
    await expect(hint).toHaveText("CAM 3 does not answer: the dials set nothing until it does.");
    await openCameras(page, "cameras-no-link");
    await expect(hint).toHaveText("CAM 1 is not set up: the dials set nothing until it is.");
  });

  test("REC starts with one press and stops with two, and its chip stands on every page", async ({ page }) => {
    await page.clock.install();
    await openCameras(page);
    const rec = page.getByTestId("cameras-rec");
    await expect(rec).toHaveAttribute("data-rec", "stopped");
    await rec.click();
    await expect(rec).toHaveAttribute("data-rec", "recording");
    await expect(rec).toHaveAttribute("data-key-mode", "hazard");
    await expect(rec.locator("[data-lamp='error']")).toHaveCount(1);
    await expect(page.getByTestId("cameras-take-length")).toContainText("counted here since");
    await expect(page.getByTestId("cameras-recent-row").first()).toContainText("CAM 1 started recording.");
    await expect(page.getByTestId("cameras-recent-row").first()).toContainText("Screen");
    await expect(recChip(page)).toContainText("REC");
    await expect(recChip(page)).toContainText("CAM 1");
    await expect(recChip(page)).toHaveAttribute("data-tone", "error");

    // REC is CAM 1's whichever camera is selected (D14).
    await page.getByTestId("cameras-key-2").click();
    await expect(page.getByTestId("cameras-plate")).toHaveAttribute("data-camera", "2");
    await expect(rec).toHaveAttribute("data-rec", "recording");

    // The chip opens the page from any other.
    await page.getByRole("button", { name: "Audio", exact: true }).click();
    await expectWorkspaceMounted(page, "audio");
    await expect(recChip(page)).toBeVisible();
    await recChip(page).click();
    await expectWorkspaceMounted(page, "cameras");

    // One press arms the stop, and says what the second press does. The
    // page's clock stands still meanwhile: the second press is inside the
    // stop's 3 s on any runner.
    await pausePageClock(page);
    await rec.click();
    await expect(rec).toHaveAttribute("data-armed", "true");
    await expect(rec).toContainText("Stop?");
    await expect(state(page)).toContainText("Stop recording on CAM 1 · press again");
    await expect(page.getByTestId("cameras-footer")).toContainText("recording · stop armed");
    await page.clock.fastForward(PAST_THE_DWELL_MS);
    await rec.click();
    await page.clock.resume();
    await expect(rec).toHaveAttribute("data-rec", "stopped");
    await expect(recChip(page)).toHaveCount(0);
    await expect(page.getByTestId("cameras-recent-row").first()).toContainText("CAM 1 stopped recording.");
    await expect(page.getByTestId("cameras-take-length")).toContainText("not recording");
  });

  test("an armed stop that is not pressed again within 3 s is dropped, and the take goes on", async ({ page }) => {
    await page.clock.install();
    await openCameras(page, "cameras-recording");
    const rec = page.getByTestId("cameras-rec");
    await expect(rec).toHaveAttribute("data-rec", "recording");
    // The take ran before Studio Control looked, so its length is not known.
    await expect(page.getByTestId("cameras-take-length")).toContainText("not known");
    expect(STOP_WINDOW_MS, "the deck's window (D14)").toBe(3000);
    await pausePageClock(page);
    await rec.click();
    await expect(rec).toHaveAttribute("data-armed", "true");
    await expect(page.getByTestId("cameras-stop-countdown")).toHaveAttribute("style", /--arm-duration: 3000ms/);
    // Short of the 3 s the arm stands; past them it is dropped.
    await page.clock.fastForward(STOP_WINDOW_MS - 100);
    await expect(rec).toHaveAttribute("data-armed", "true");
    await page.clock.fastForward(200);
    await expect(rec).toHaveAttribute("data-armed", "false");
    await page.clock.resume();
    await expect(rec).toHaveAttribute("data-rec", "recording");
    await expect(recChip(page)).toHaveAttribute("data-tone", "error");
  });

  test("one press steps a value, picks one from the list the camera allows, or runs an auto", async ({ page }) => {
    await openCameras(page);
    const iso = page.getByTestId("cameras-iso-value");
    await page.getByTestId("cameras-iso-up").click();
    await expect(iso).toContainText("500");
    await page.getByTestId("cameras-iso-down").click();
    await page.getByTestId("cameras-iso-down").click();
    await expect(iso).toContainText("320");

    await iso.click();
    const list = page.getByTestId("cameras-values-list");
    await expect(list).toBeVisible();
    // A popover holding a listbox (the visual overhaul): the value the camera
    // reports is the selected option, and it takes the focus.
    await expect(list.getByRole("listbox")).toBeVisible();
    await expect(list.getByRole("option", { selected: true })).toHaveText("320");
    await expect(list.getByRole("option", { selected: true })).toBeFocused();
    await expect(list.getByRole("option")).toHaveCount(25);
    await expect(list.locator("[data-testid^='cameras-value-']")).toHaveCount(25);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await list.getByTestId("cameras-value-1600").click();
    await expect(list).toHaveCount(0);
    await expect(iso).toContainText("1600");

    // The arrows move over the options and Enter picks one.
    await iso.click();
    await expect(list.getByRole("option", { selected: true })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(list.getByTestId("cameras-value-2000")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(list.getByTestId("cameras-value-6400")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(list).toHaveCount(0);
    await expect(iso).toContainText("6400");

    // Esc, its readout again and a press anywhere else (the title, the row's
    // own label) leave the list without a change.
    await page.getByTestId("cameras-shutter-value").click();
    await expect(list).toContainText("Shutter");
    await page.keyboard.press("Escape");
    await expect(list).toHaveCount(0);
    await expect(page.getByTestId("cameras-shutter-value")).toBeFocused();
    await page.getByTestId("cameras-shutter-value").click();
    await expect(list).toBeVisible();
    await page.getByTestId("cameras-shutter-value").click();
    await expect(list).toHaveCount(0);
    await page.getByTestId("cameras-shutter-value").click();
    await expect(list).toBeVisible();
    await page.getByTestId("cameras-plate-head").click({ position: { x: 20, y: 20 } });
    await expect(list).toHaveCount(0);
    await page.getByTestId("cameras-shutter-value").click();
    await expect(list).toBeVisible();
    await page.getByTestId("cameras-shutter").getByText("Shutter", { exact: true }).click();
    await expect(list).toHaveCount(0);
    await expect(page.getByTestId("cameras-shutter-value")).toContainText("180°");

    // What the list shows is what the camera reports now: a value changed on
    // the camera while the list is open moves its selected option.
    await iso.click();
    await expect(list.getByRole("option", { selected: true })).toHaveText("6400");
    await page.evaluate(() => window.__SSE_TEST_CAMERAS__!.changeOnBody(1, { iso: "800" }));
    await expect(list.getByRole("option", { selected: true })).toHaveText("800", { timeout: 3000 });
    // Another value's list from the keyboard is a list of its own: its value
    // takes the focus.
    await page.getByTestId("cameras-shutter-value").focus();
    await page.keyboard.press("Enter");
    await expect(list).toContainText("Shutter");
    await expect(list.getByRole("option", { selected: true })).toHaveText("180°");
    await expect(list.getByRole("option", { selected: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(list).toHaveCount(0);

    await page.getByTestId("cameras-auto-iris").click();
    await expect(page.getByTestId("cameras-iris-value")).toContainText("f/4.0");
    await page.getByTestId("cameras-auto-focus").click();
    await expect(page.getByTestId("cameras-focus-value")).toHaveText("0.50");

    // A step at the end of the camera's own values is locked, with the reason.
    await page.getByTestId("cameras-iso-value").click();
    await list.getByTestId("cameras-value-100").click();
    await expect(page.getByTestId("cameras-iso-down")).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByTestId("cameras-iso-down")).toHaveAttribute(
      "title",
      "ISO is at the lowest value CAM 1 allows."
    );
  });

  test("a level takes a typed value, in the camera's range and on its step", async ({ page }) => {
    await openCameras(page);
    const balance = page.getByTestId("cameras-whiteBalance-value");
    await expect(balance).toContainText("5600 K");
    await page.getByTestId("cameras-whiteBalance-up").click();
    await expect(balance).toContainText("5650 K");
    await balance.click();
    // A popover with a field (the visual overhaul): not a dialog, so the
    // pictures stay drawn while a value is typed.
    const entry = page.getByTestId("cameras-typed-entry");
    await expect(entry).toContainText("White balance · CAM 1");
    await expect(entry).toContainText("2500 to 10000 K, in steps of 50");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(entry.getByRole("spinbutton")).toBeFocused();
    await entry.getByRole("spinbutton").fill("4320");
    await entry.getByRole("button", { name: "Set value" }).click();
    await expect(entry).toHaveCount(0);
    // 4320 is not on CAM 1's step of 50: the nearest that is.
    await expect(balance).toContainText("4300 K");

    // Enter in the field sets it too; Esc leaves it without a change.
    await balance.click();
    await entry.getByRole("spinbutton").fill("5000");
    await page.keyboard.press("Enter");
    await expect(entry).toHaveCount(0);
    await expect(balance).toContainText("5000 K");
    await balance.click();
    await entry.getByRole("spinbutton").fill("9000");
    await page.keyboard.press("Escape");
    await expect(entry).toHaveCount(0);
    await expect(balance).toContainText("5000 K");
  });

  test("the format and the look are press twice, and a rate the camera does not allow is locked", async ({ page }) => {
    await page.clock.install();
    await openCameras(page);
    // The plate says what the camera reports; the keys are in a popover beside it.
    await expect(page.getByTestId("cameras-frameRate-value")).toHaveText("25p");
    await expect(page.getByTestId("cameras-resolution-value")).toHaveText("6K");
    const format = await openFormat(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const fifty = page.getByTestId("cameras-frameRate-50");
    // The camera's value is the selection (the Beige keyline), not a lit fill.
    await expect(page.getByTestId("cameras-frameRate-25")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("cameras-frameRate-25")).toHaveAttribute("data-selected", "");
    await expect(page.getByTestId("cameras-frameRate-25")).not.toHaveAttribute("data-engaged", "");
    await expect(page.getByTestId("cameras-frameRate-60")).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByTestId("cameras-frameRate-60")).toHaveAttribute("title", "60p: not at 6K");
    // The reason a key is locked stands on screen, under its row.
    await expect(page.getByTestId("cameras-frameRate-refused")).toHaveText("60p not at 6K");

    await fifty.click();
    await expect(fifty).toHaveAttribute("data-armed", "true");
    await expect(state(page)).toContainText("Frame rate 25p → 50p on CAM 1 · press again");
    await expect(page.getByTestId("cameras-frameRate-25")).toHaveAttribute("aria-pressed", "true");
    // Another key takes the arm; the first is dropped and nothing was set.
    await page.getByTestId("cameras-resolution-UHD").click();
    await expect(fifty).not.toHaveAttribute("data-armed", "true");
    await expect(page.getByTestId("cameras-resolution-UHD")).toHaveAttribute("data-armed", "true");
    // Esc closes the popover, and the arm goes with it: nothing armed is ever
    // out of sight (one Esc, one layer).
    await page.keyboard.press("Escape");
    await expect(format).toHaveCount(0);
    await expect(state(page)).not.toContainText("press again");
    await expect(page.getByTestId("cameras-format-open")).toBeFocused();
    await openFormat(page);
    await expect(page.getByTestId("cameras-resolution-UHD")).not.toHaveAttribute("data-armed", "true");
    await expect(page.getByTestId("cameras-resolution-6K")).toHaveAttribute("aria-pressed", "true");
    // The arm moved to another key of the same row keeps the focus in the
    // popover: Esc still reaches it and drops the arm.
    await page.getByTestId("cameras-resolution-UHD").click();
    await expect(page.getByTestId("cameras-resolution-UHD")).toBeFocused();
    await page.getByTestId("cameras-resolution-HD").click();
    await expect(page.getByTestId("cameras-resolution-HD")).toHaveAttribute("data-armed", "true");
    await expect(page.getByTestId("cameras-resolution-HD")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(format).toHaveCount(0);
    await expect(state(page)).not.toContainText("press again");
    // So does a close by its key, and a press elsewhere in the section.
    await openFormat(page);
    await page.getByTestId("cameras-resolution-UHD").click();
    await expect(page.getByTestId("cameras-resolution-UHD")).toHaveAttribute("data-armed", "true");
    await page.getByTestId("cameras-format-open").click();
    await expect(format).toHaveCount(0);
    await expect(state(page)).not.toContainText("press again");
    await openFormat(page);
    await page.getByTestId("cameras-resolution-UHD").click();
    await page.getByTestId("cameras-resolution-value").click();
    await expect(format).toHaveCount(0);
    await expect(state(page)).not.toContainText("press again");
    // A popover belongs to a camera that is held: one that stops answering
    // takes its popover, and the arm, with it, with no press anywhere.
    await openFormat(page);
    await page.getByTestId("cameras-resolution-UHD").click();
    await expect(page.getByTestId("cameras-resolution-UHD")).toHaveAttribute("data-armed", "true");
    await page.evaluate(() => window.__SSE_TEST_CAMERAS__!.stopAnswering(1));
    await expect(format).toHaveCount(0, { timeout: 3000 });
    await expect(state(page)).not.toContainText("press again");
    await page.evaluate(() => window.__SSE_TEST_CAMERAS__!.answerAgain(1));
    await expect(page.getByTestId("cameras-format-open")).not.toHaveAttribute("aria-disabled", "true", {
      timeout: 3000,
    });

    await openFormat(page);
    await pressTwice(page, "cameras-frameRate-50");
    await expect(page.getByTestId("cameras-frameRate-50")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("cameras-frameRate-value")).toHaveText("50p");
    await expect(page.getByTestId("cameras-recent-row").first()).toContainText("CAM 1: 25p → 50p.");

    await openLook(page);
    await expect(format).toHaveCount(0);
    await pressTwice(page, "cameras-dynamicRange-Video");
    await expect(page.getByTestId("cameras-dynamicRange-Video")).toHaveAttribute("aria-pressed", "true");
    await pressTwice(page, "cameras-displayLutOn-off");
    await expect(page.getByTestId("cameras-displayLutOn-off")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("cameras-recent-row").first()).toContainText("CAM 1: display LUT off.");

    // The BGH1s report neither a profile nor a LUT, and say so. Selecting
    // another camera (a press outside the popover) closes the popover.
    await page.getByTestId("cameras-key-2").click();
    await expect(page.getByTestId("cameras-look-popover")).toHaveCount(0);
    await expect(page.getByTestId("cameras-look-open")).toHaveCount(0);
    await expect(page.getByTestId("cameras-dynamicRange-not-reported")).toHaveText(
      "CAM 2 does not report its dynamic range."
    );
    await expect(page.getByTestId("cameras-nd-not-reported")).toHaveText("The BGH1 has no ND filter.");
    await expect(page.getByTestId("cameras-focus-nearer")).toBeVisible();
  });

  test("Release is press twice and hands the camera over; Connect takes it back", async ({ page }) => {
    await page.clock.install();
    await openCameras(page);
    await page.getByTestId("cameras-key-2").click();
    await expect(page.getByTestId("cameras-release")).toContainText("Release to LUMIX Tether · press twice");
    await pressTwice(page, "cameras-release");
    await expect(state(page)).toContainText("RELEASED");
    await expect(state(page)).toContainText("CAM 2 is released to LUMIX Tether.");
    await expect(page.getByTestId("cameras-connection-word")).toContainText("RELEASED");
    await expect(page.getByTestId("cameras-iso-value")).toContainText("not read");
    await expect(page.getByTestId("cameras-iso-up")).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByTestId("cameras-release")).toHaveCount(0);
    await expect(page.getByTestId("cameras-recent-row").first()).toContainText("CAM 2 released to LUMIX Tether.");

    // The state display's way out and the plate's key are the same Connect.
    await expect(page.getByTestId("cameras-state-connect")).toHaveText("Connect CAM 2");
    await page.getByTestId("cameras-connect").click();
    await expect(state(page)).toContainText("HELD");
    await expect(page.getByTestId("cameras-iso-value")).toContainText("800");
    await expect(page.getByTestId("cameras-recent-row").first()).toContainText("CAM 2 held again.");
  });

  test("CAM 1 released: REC is locked and the chip says that it is not read", async ({ page }) => {
    await page.clock.install();
    await openCameras(page);
    await page.getByTestId("cameras-rec").click();
    await expect(recChip(page)).toHaveAttribute("data-tone", "error");
    await pausePageClock(page);
    await page.getByTestId("cameras-release").click();
    await expect(page.getByTestId("cameras-connection-note")).toHaveText(
      "CAM 1 is recording: after Release, REC stops only on the camera or the iPad."
    );
    await page.clock.fastForward(PAST_THE_DWELL_MS);
    await page.getByTestId("cameras-release").click();
    await page.clock.resume();

    const rec = page.getByTestId("cameras-rec");
    await expect(rec).toHaveAttribute("data-rec", "locked");
    await expect(rec).toHaveAttribute("aria-disabled", "true");
    await expect(rec).toContainText("locked · CAM 1 is released to the iPad");
    await expect(recChip(page)).toContainText("not read while released");
    await expect(recChip(page)).toHaveAttribute("data-tone", "attention");
    await expect(page.getByTestId("cameras-take-timecode")).toContainText("not read while released");

    // Connect reads it again: the take it found running started before it looked.
    await page.getByTestId("cameras-connect").click();
    await expect(rec).toHaveAttribute("data-rec", "recording");
    await expect(page.getByTestId("cameras-take-length")).toContainText("not known");
    await expect(recChip(page)).toHaveAttribute("data-tone", "error");
  });

  test("a camera that stops answering reads UNREACHABLE, keeps its last values as doubt, and has no Release", async ({
    page,
  }) => {
    await openCameras(page);
    await page.getByTestId("cameras-key-3").click();
    await page.evaluate(() => window.__SSE_TEST_CAMERAS__!.stopAnswering(3));
    await expect(state(page)).toContainText("UNREACHABLE");
    await expect(state(page)).toContainText("CAM 3 does not answer at 172.16.16.30.");
    await expect(page.getByTestId("cameras-iso-value")).toHaveAttribute("data-doubt", "");
    await expect(page.getByTestId("cameras-iso-value")).toContainText("1600");
    await expect(page.getByTestId("cameras-iso-value")).toContainText("last read");
    await expect(page.getByTestId("cameras-iso-up")).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByTestId("cameras-release")).toHaveCount(0);
    await expect(page.getByTestId("cameras-footer")).toContainText("2 / 3 held · CAM 3 unreachable");

    // Try again is one read, which sends nothing: the page says that it tried.
    await page.getByTestId("cameras-state-read-again").click();
    await expect(toast(page)).toContainText("Read again: nothing has changed. CAM 3 does not answer");
    expect(await page.evaluate(() => window.__SSE_TEST_CAMERAS__!.sent(3))).toBe(0);

    // It answers again: the page reads the cameras once a second, and shows it.
    await page.evaluate(() => window.__SSE_TEST_CAMERAS__!.answerAgain(3));
    await expect(state(page)).toContainText("HELD", { timeout: 3000 });
    await expect(page.getByTestId("cameras-iso-value")).not.toHaveAttribute("data-doubt", "");
  });

  test("a value changed on the camera shows on the page, and the camera wins", async ({ page }) => {
    await openCameras(page);
    await page.evaluate(() => window.__SSE_TEST_CAMERAS__!.changeOnBody(1, { iso: "3200", whiteBalance: 4300 }));
    await expect(page.getByTestId("cameras-iso-value")).toContainText("3200", { timeout: 3000 });
    await expect(page.getByTestId("cameras-whiteBalance-value")).toContainText("4300 K");
    await expect(page.getByTestId("cameras-key-1")).toContainText("ISO 3200");
    // A take started on the camera itself is a take the page saw start.
    await page.evaluate(() => window.__SSE_TEST_CAMERAS__!.changeOnBody(1, { recording: true }));
    await expect(page.getByTestId("cameras-rec")).toHaveAttribute("data-rec", "recording", { timeout: 3000 });
    await expect(recChip(page)).toBeVisible();
  });

  test("CAM 1 lost mid-take: the last report as doubt, STOP locked, the chip amber", async ({ page }) => {
    await openCameras(page, "cameras-lost-mid-take");
    const rec = page.getByTestId("cameras-rec");
    await expect(rec).toHaveAttribute("data-rec", "last-known");
    await expect(rec).toHaveAttribute("aria-disabled", "true");
    await expect(rec).toContainText("last known: recording");
    await expect(rec).toContainText("STOP is locked until CAM 1 answers");
    await expect(recChip(page)).toContainText("last known");
    await expect(recChip(page)).toHaveAttribute("data-tone", "attention");
    await expect(page.getByTestId("cameras-take-timecode").locator("b")).toHaveAttribute("data-doubt", "");
    await expect(page.getByTestId("cameras-take-timecode")).toContainText("last read");
    await expect(page.getByTestId("cameras-take-length")).toContainText("not counted · CAM 1 does not answer");
    await rec.click({ force: true });
    await expect(rec).toHaveAttribute("data-rec", "last-known");
  });

  test("without a link every camera is NOT SET UP and says why, and REC is locked", async ({ page }) => {
    await openCameras(page, "cameras-no-link");
    await expect(state(page)).toContainText("NOT SET UP");
    await expect(state(page)).toContainText("Studio Control has no link to CAM 1 yet: it comes with a later version.");
    await expect(page.getByTestId("cameras-rec")).toHaveAttribute("data-rec", "locked");
    await expect(page.getByTestId("cameras-rec")).toContainText("locked · CAM 1 is not set up");
    await expect(page.getByTestId("cameras-recent-empty")).toBeVisible();
    await expect(recChip(page)).toHaveCount(0);
  });

  // The studio's build with vMix sending none of its outputs: each
  // picture's place says so and what to check, and the view, the aids and
  // the loupe are locked.
  test("with no picture from vMix every picture's place says so and what to check", async ({ page }) => {
    await openCameras(page, "cameras-no-link");
    const empty = page.getByTestId("cameras-no-picture");
    await expect(empty).toHaveAttribute("data-no-picture", "no-pictures");
    await expect(empty).toContainText("NO PICTURE");
    await expect(empty).toContainText("vMix is not sending CAM 1 over NDI.");
    await expect(empty).toContainText(
      "Either vMix is closed, or its Outputs 2, 3 and 4 are not sent over NDI (Settings › Outputs)."
    );
    await expect(page.getByTestId("cameras-hero-picture")).toHaveCount(0);
    for (const camera of [2, 3]) {
      const small = page.getByTestId(`cameras-no-picture-${camera}`);
      await expect(small).toContainText("NO PICTURE");
      await expect(small).toContainText(`vMix Output ${camera + 1} · nothing received`);
      await expect(small).not.toContainText("vMix input");
    }
    await expect(page.getByTestId("cameras-loupe-empty")).toHaveText("No picture to check");
    for (const key of [
      "view-whole",
      "view-one-to-one",
      "aid-guides",
      "aid-peaking",
      "aid-zebras",
      "zoom-2",
      "zoom-4",
    ]) {
      await expect(page.getByTestId(`cameras-${key}`), key).toHaveAttribute("aria-disabled", "true");
    }
    await expect(page.getByTestId("cameras-caption-detail")).toHaveText("vMix Output 2 · nothing received");
    // The plate names the camera's own vMix output, fixed: CAM 1's is Output 2.
    await expect(page.getByTestId("cameras-plate-head")).toContainText("vMix Output 2");
    const pictures = page.getByTestId("cameras-pictures");
    await expect(pictures).toContainText("vMix Outputs 2 to 4");
    await expect(pictures).toContainText(
      "Over NDI from vMix on this PC: CAM 1 from Output 2, CAM 2 from Output 3, CAM 3 from Output 4."
    );
    await expect(page.getByTestId("cameras-picture-row-1")).toContainText("vMix Output 2 · nothing received");
    await expect(page.getByTestId("cameras-picture-row-1")).toContainText("NO PICTURE");
    await expect(page.getByTestId("cameras-footer")).toContainText("Pictures none · vMix Outputs 2 to 4");
  });

  // Board 2's `one-picture`: vMix sends pictures, and none for CAM 2's input.
  test("a picture that does not arrive says why in its place, and the camera's controls still work", async ({
    page,
  }) => {
    await openCameras(page, "cameras-picture-missing");
    await expect(state(page)).toContainText("PICTURE MISSING");
    await expect(state(page)).toContainText(
      "vMix sends no picture for CAM 2. Check that vMix input 7 is still there and live."
    );
    await expect(state(page)).toContainText("The camera controls still work · 3 of 3 held");
    await expect(page.getByTestId("cameras-no-picture-2")).toContainText("NO PICTURE");
    await expect(page.getByTestId("cameras-no-picture-2")).toContainText("nothing received");
    await expect(page.getByTestId("cameras-picture-row-2")).toContainText("nothing received");
    await expect(page.getByTestId("cameras-picture-row-2")).not.toContainText("vMix input");
    await expect(page.getByTestId("cameras-picture-row-2")).toContainText("NO PICTURE");
    await expect(page.getByTestId("cameras-picture-row-1")).toContainText("test picture");
    await expect(page.getByTestId("cameras-picture-row-1")).toContainText("LIVE");
    await expect(page.getByTestId("cameras-footer")).toContainText("Pictures test pictures · 2 / 3 · CAM 2 missing");
    // CAM 1's picture arrives, and its aids work.
    await expect(page.getByTestId("cameras-hero-picture")).toHaveAttribute("data-camera", "1");
    await page.getByTestId("cameras-aid-zebras").click();
    await expect(page.getByTestId("cameras-aid-zebras")).toHaveAttribute("aria-pressed", "true");

    // Look again reads once more: nothing has changed.
    await page.getByTestId("cameras-state-look-again").click();
    await expect(toast(page)).toContainText("Read again: nothing has changed.");

    // CAM 2 selected: its place says why, the picture's keys are locked, and
    // its own controls still set it.
    await page.getByTestId("cameras-key-2").click();
    const empty = page.getByTestId("cameras-no-picture");
    await expect(empty).toHaveAttribute("data-no-picture", "missing");
    await expect(empty).toContainText("vMix is not sending CAM 2 over NDI.");
    await expect(empty).toContainText("vMix sends other inputs: check that vMix input 7 is still there and live.");
    await expect(page.getByTestId("cameras-hero")).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByTestId("cameras-aid-zebras")).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByTestId("cameras-aid-zebras")).toHaveAttribute("title", "CAM 2 has no picture to show.");
    await expect(page.getByTestId("cameras-view-one-to-one")).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByTestId("cameras-zoom-4")).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByTestId("cameras-loupe-empty")).toHaveText("No picture to check");
    await expect(page.getByTestId("cameras-caption-detail")).toHaveText("nothing received");
    await expect(page.getByTestId("cameras-plate-head")).toContainText("vMix Output 3");
    await expect(page.getByTestId("cameras-iso-value")).toContainText("800");
    await page.getByTestId("cameras-iso-up").click();
    await expect(page.getByTestId("cameras-iso-value")).toContainText("1000");
  });

  test("the aids, the view and the loupe are this screen's own, and off again at every start", async ({ page }) => {
    await openCameras(page);
    const hero = page.getByTestId("cameras-hero-picture");
    const loupe = page.getByTestId("cameras-loupe-picture");
    await expect(hero).toHaveAttribute("data-aids", "");
    await expect(hero).toHaveAttribute("data-part", "0,0,1920,1080");
    await expect(loupe).toHaveAttribute("data-part", "818,472,284,136");

    for (const aid of ["guides", "peaking", "zebras"]) {
      await page.getByTestId(`cameras-aid-${aid}`).click();
      await expect(page.getByTestId(`cameras-aid-${aid}`)).toHaveAttribute("aria-pressed", "true");
    }
    await expect(hero).toHaveAttribute("data-aids", "guides zebras peaking");
    // The loupe takes the zebras and the peaking, never the guides.
    await expect(loupe).toHaveAttribute("data-aids", "zebras peaking");
    // Nothing of it reaches a camera.
    expect(
      await page.evaluate(() => [1, 2, 3].map((camera) => window.__SSE_TEST_CAMERAS__!.sent(camera as 1 | 2 | 3)))
    ).toEqual([0, 0, 0]);

    await page.getByTestId("cameras-zoom-4").click();
    await expect(loupe).toHaveAttribute("data-part", "889,506,142,68");
    // A press on the big picture moves the loupe there: 420 of 1680 across is
    // 480 of the picture's 1920, 700 of 945 down is 800 of its 1080.
    const box = (await page.getByTestId("cameras-hero").boundingBox())!;
    await page.mouse.click(box.x + 420, box.y + 700);
    await expect(loupe).toHaveAttribute("data-part", "409,766,142,68");
    await page.getByTestId("cameras-view-one-to-one").click();
    await expect(hero).toHaveAttribute("data-part", "0,135,1680,945");
    await expect(page.getByTestId("cameras-caption-detail")).toContainText("1:1 · 1680 × 945 of 1920 × 1080");
    await expect(page.getByTestId("cameras-footer")).toContainText("CAM 1 · 1:1");

    // Each camera keeps its own point; the aids and the view are the page's.
    await page.getByTestId("cameras-key-2").click();
    await expect(hero).toHaveAttribute("data-part", "120,68,1680,945");
    await expect(hero).toHaveAttribute("data-aids", "guides zebras peaking");

    await page.reload();
    await expectWorkspaceMounted(page, "cameras");
    await expect(hero).toHaveAttribute("data-aids", "");
    await expect(hero).toHaveAttribute("data-part", "0,0,1920,1080");
    await expect(page.getByTestId("cameras-zoom-2")).toHaveAttribute("aria-pressed", "true");
  });

  test("the pictures are drawn, and the aids change what is drawn", async ({ page }) => {
    await openCameras(page);
    const hero = page.getByTestId("cameras-hero-picture");
    await expect(hero).toHaveAttribute("data-drawn", /^\d+$/);
    const inks = () =>
      page.evaluate(() => {
        const view = document.querySelector("[data-testid=cameras-hero-picture]")!;
        const [picture, overlay] = Array.from(view.querySelectorAll("canvas"));
        // The picture is WebGL2's, and kept once drawn; the guides are on the canvas above it.
        const gl = picture!.getContext("webgl2")!;
        const at = (x: number, y: number) => {
          const pixel = new Uint8Array(4);
          gl.readPixels(x, picture!.height - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          return Array.from(pixel);
        };
        const above = (x: number, y: number) => Array.from(overlay!.getContext("2d")!.getImageData(x, y, 1, 1).data);
        // The first bar, the white patch where a dark zebra stripe crosses it, and a
        // point on the first third's line.
        return { bar: at(200, 300), white: at(958, 800), third: above(560, 300) };
      });
    const plain = await inks();
    // 75 % and full white, through UYVY and back.
    for (const channel of plain.bar.slice(0, 3)) expect(Math.abs(channel - 191)).toBeLessThanOrEqual(1);
    expect(plain.white.slice(0, 3)).toEqual([255, 255, 255]);

    await page.getByTestId("cameras-aid-zebras").click();
    await expect(hero).toHaveAttribute("data-aids", "zebras");
    const zebras = await inks();
    expect(zebras.bar, "75 % is under the zebras' 95 %").toEqual(plain.bar);
    expect(zebras.white, "full white is striped").not.toEqual(plain.white);

    await page.getByTestId("cameras-aid-guides").click();
    await expect(hero).toHaveAttribute("data-aids", "guides zebras");
    expect((await inks()).third, "a guide runs down the first third").not.toEqual(plain.third);
  });

  // The shader works the aids out as `pictureAids.ts` does, which stays their reference:
  // at 1:1 each of the view's pixels is one of the picture's, so they can be held to it
  // pixel for pixel, the card decoded as the shader decodes it and the overlays laid over
  // as a canvas lays them.
  test("the shader's zebras and peaking are pictureAids.ts's, pixel for pixel at 1:1", async ({ page }) => {
    await openCameras(page);
    const hero = page.getByTestId("cameras-hero-picture");
    await page.getByTestId("cameras-view-one-to-one").click();
    await page.getByTestId("cameras-aid-zebras").click();
    await page.getByTestId("cameras-aid-peaking").click();
    await expect(hero).toHaveAttribute("data-part", "120,68,1680,945");
    await expect(hero).toHaveAttribute("data-aids", "zebras peaking");
    await expect(hero).toHaveAttribute("data-drawn", /^\d+$/);
    // The view's rows through the bars, the steps, and the line pairs and patches, and
    // the rows on each side of two horizontal edges (the bars' top, the patches'),
    // where the peaking can come only from the pixel above or below.
    const rows = [51, 52, 232, 732, 791, 792, 832];
    const drawn = await page.evaluate((rows) => {
      const canvas = document.querySelector<HTMLCanvasElement>("[data-testid=cameras-hero-picture] canvas")!;
      const gl = canvas.getContext("webgl2")!;
      return rows.map((row) => {
        const line = new Uint8Array(canvas.width * 4);
        gl.readPixels(0, canvas.height - 1 - row, canvas.width, 1, gl.RGBA, gl.UNSIGNED_BYTE, line);
        return Array.from(line);
      });
    }, rows);

    const { width, height } = FULL_PICTURE;
    const picture = uyvyToRgba(testCardUyvy(1, true), width, height);
    const zebras = zebraOverlay(zebraMask(picture, width, height), width, height);
    const peaking = peakingOverlay(peakingMask(picture, width, height), width, height);
    const over = (under: number, ink: number, alpha: number) => Math.round(ink * alpha + under * (1 - alpha));
    let differing = 0;
    let total = 0;
    rows.forEach((row, index) => {
      for (let x = 0; x < 1680; x += 1) {
        const at = ((68 + row) * width + 120 + x) * 4;
        const expected = [0, 1, 2].map((channel) => {
          let value = picture[at + channel]!;
          value = over(value, zebras[at + channel]!, zebras[at + 3]! / 255);
          return over(value, peaking[at + channel]!, peaking[at + 3]! / 255);
        });
        const got = drawn[index]!.slice(x * 4, x * 4 + 3);
        total += 1;
        if (expected.some((value, channel) => Math.abs(value - got[channel]!) > 2)) differing += 1;
      }
    });
    expect(differing, `${differing} of ${total} pixels differ from pictureAids.ts`).toBeLessThanOrEqual(total * 0.002);
  });

  // In the app's window the pictures helper draws the pictures over the page, where the
  // page says they stand (D30). The page says the same in a browser, and the double keeps
  // what it said: the boxes here are the ones the helper would draw into.
  test("the page says where its pictures stand, keeps them under the values list, and shows none once it is left", async ({
    page,
  }) => {
    await openCameras(page);
    await expect(page.getByTestId("cameras-hero-picture")).toHaveAttribute("data-drawn", /^\d+$/);
    const places = () => page.evaluate(() => window.__SSE_TEST_CAMERAS__!.picturePlaces());
    const last = async () => (await places()).last;
    const boxOf = async (testId: string) => (await page.getByTestId(testId).boundingBox())!;
    const whole = { x: 0, y: 0, width: 1920, height: 1080 };
    const noAids = { guides: false, zebras: false, peaking: false, marker: null };
    // Where the loupe looks at 2:1: the big picture's marker in the whole view.
    const loupePart = { x: 818, y: 472, width: 284, height: 136 };

    await expect.poll(async () => (await last())?.pictures.length).toBe(4);
    const first = (await last())!;
    expect(first.showing).toBe(true);
    expect(first.scale).toBe(1);
    expect(first.bay).toEqual(await boxOf("cameras-bay"));
    const [hero, tile2, tile3, loupe] = first.pictures;
    expect(hero).toEqual({
      camera: 1,
      at: await boxOf("cameras-hero-picture"),
      part: whole,
      smooth: true,
      ...noAids,
      marker: loupePart,
    });
    expect(hero!.at).toMatchObject({ width: 1680, height: 945 });
    expect(tile2).toMatchObject({ camera: 2, part: whole, smooth: true, at: { width: 544, height: 306 }, ...noAids });
    expect(tile3).toMatchObject({ camera: 3, part: whole, smooth: true, at: { width: 544, height: 306 }, ...noAids });
    // The loupe shows each pixel as it is: 284 × 136 of the picture at 2:1, around its centre.
    expect(loupe).toEqual({
      camera: 1,
      at: await boxOf("cameras-loupe-picture"),
      part: loupePart,
      smooth: false,
      ...noAids,
    });
    // Each small picture's chip is a hole in it.
    expect(first.holes).toHaveLength(2);
    for (const [index, tile] of [tile2!, tile3!].entries()) {
      const hole = first.holes[index]!;
      expect(hole.x).toBeGreaterThanOrEqual(tile.at.x);
      expect(hole.y).toBeGreaterThanOrEqual(tile.at.y);
      expect(hole.x + hole.width).toBeLessThanOrEqual(tile.at.x + tile.at.width);
      expect(hole.y + hole.height).toBeLessThanOrEqual(tile.at.y + tile.at.height);
    }

    // Nothing moves: it says the same again within about a second.
    const said = (await places()).said;
    await expect.poll(async () => (await places()).said, { timeout: 5_000 }).toBeGreaterThan(said);
    expect(await last()).toEqual(first);

    // The values list stands over the big picture as a popover holding a
    // listbox (the visual overhaul): one hole more, and the pictures stay.
    // Until then it was a dialog, and every picture hid while it was open.
    await page.getByTestId("cameras-iso-value").click();
    await expect(page.getByTestId("cameras-values-list")).toBeVisible();
    await expect.poll(async () => (await last())?.holes.length).toBe(3);
    expect((await last())!.showing).toBe(true);
    expect((await last())!.pictures).toHaveLength(4);
    const listBox = await boxOf("cameras-values-list");
    expect((await last())!.holes[2]).toEqual({
      x: Math.round(listBox.x),
      y: Math.round(listBox.y),
      width: Math.round(listBox.width),
      height: Math.round(listBox.height),
    });
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await last())?.holes.length).toBe(2);
    // So does the typed entry, which was a dialog too.
    await page.getByTestId("cameras-whiteBalance-value").click();
    await expect(page.getByTestId("cameras-typed-entry")).toBeVisible();
    await expect.poll(async () => (await last())?.holes.length).toBe(3);
    expect((await last())!.showing).toBe(true);
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await last())?.holes.length).toBe(2);

    // The aids: the big picture all three, the loupe zebras and peaking, the small ones none.
    for (const aid of ["guides", "zebras", "peaking"]) await page.getByTestId(`cameras-aid-${aid}`).click();
    await expect
      .poll(async () => (await last())?.pictures.map(({ guides, zebras, peaking }) => [guides, zebras, peaking]))
      .toEqual([
        [true, true, true],
        [false, false, false],
        [false, false, false],
        [false, true, true],
      ]);
    for (const aid of ["guides", "zebras", "peaking"]) await page.getByTestId(`cameras-aid-${aid}`).click();
    await expect.poll(async () => (await last())?.pictures[0]?.zebras).toBe(false);

    // Another camera selected, the 1:1 view, the loupe at 4:1.
    await page.getByTestId("cameras-key-2").click();
    await expect.poll(async () => (await last())?.pictures.map((picture) => picture.camera)).toEqual([2, 1, 3, 2]);
    await page.getByTestId("cameras-view-one-to-one").click();
    await expect
      .poll(async () => (await last())?.pictures[0]?.part)
      .toEqual({ x: 120, y: 68, width: 1680, height: 945 });
    // At 1:1 the big picture is where the loupe looks: no marker on it.
    expect((await last())?.pictures[0]?.marker).toBeNull();
    await page.getByTestId("cameras-zoom-4").click();
    await expect
      .poll(async () => (await last())?.pictures[3]?.part)
      .toEqual({ x: 889, y: 506, width: 142, height: 68 });

    // Left: it says it shows no picture, and then nothing more.
    await page
      .getByRole("navigation", { name: "Workspace navigation" })
      .getByRole("button", { name: "Lighting" })
      .click();
    await expectWorkspaceMounted(page, "lighting");
    const left = await places();
    expect(left.last?.showing).toBe(false);
    await page.waitForTimeout(1_200);
    expect((await places()).said, "nothing is said once the page is left").toBe(left.said);
  });

  test("the page takes the pictures only while it is open, and says that it shows them", async ({ page }) => {
    await openCameras(page);
    await expect(page.getByTestId("cameras-hero-picture")).toHaveAttribute("data-drawn", /^\d+$/);
    const hooks = () =>
      page.evaluate(() => ({
        pulled: window.__SSE_TEST_CAMERAS__!.picturesPulled(),
        said: window.__SSE_TEST_CAMERAS__!.picturesShowingSaid(),
      }));
    expect((await hooks()).said, "the page said it shows the pictures").toBeGreaterThan(0);
    await page
      .getByRole("navigation", { name: "Workspace navigation" })
      .getByRole("button", { name: "Lighting" })
      .click();
    await expectWorkspaceMounted(page, "lighting");
    const left = await hooks();
    // Longer than a second: the page says it shows the pictures once a second.
    await page.waitForTimeout(1_200);
    expect(await hooks(), "nothing is taken, and nothing said, once the page is left").toEqual(left);
  });

  test("the Recent list says when it cannot be read, and the cameras' state stays", async ({ page }) => {
    await openCameras(page);
    await expect(page.getByTestId("cameras-recent-row")).toHaveCount(5);
    await expect(page.getByTestId("cameras-recent-row").first()).toContainText("09:08");
    await expect(page.getByTestId("cameras-recent-row").first()).toContainText("CAM 2 held again.");
    await page.evaluate(() => window.__SSE_TEST_CAMERAS__!.actionLogUnreadable(true));
    await expect(page.getByTestId("cameras-recent-unread")).toBeVisible({ timeout: 3000 });
    await expect(state(page)).toContainText("HELD");
    await page.evaluate(() => window.__SSE_TEST_CAMERAS__!.actionLogUnreadable(false));
    await expect(page.getByTestId("cameras-recent-row")).toHaveCount(5, { timeout: 3000 });
  });

  test("no line is cut: a key holds the longest line its camera reports, as doubt too", async ({ page }) => {
    await openCameras(page);
    // The longest value of each of the cameras' lists (the unit test beside
    // the page's model holds that none is longer): 36 characters a line.
    await page.evaluate(() => {
      const cameras = window.__SSE_TEST_CAMERAS__!;
      cameras.changeOnBody(1, { iso: "25600", shutter: "172.8°", iris: "f/5.6", whiteBalance: 10000 });
      cameras.changeOnBody(2, { iso: "51200", shutter: "1/1000", iris: "f/5.6", whiteBalance: 10000 });
      cameras.changeOnBody(3, { iso: "51200", shutter: "1/1000", iris: "f/5.6", whiteBalance: 10000 });
    });
    await expect(page.getByTestId("cameras-key-1")).toContainText("ISO 25600 · 172.8° · f/5.6 · 10000 K", {
      timeout: 3000,
    });
    await expect(page.getByTestId("cameras-key-3")).toContainText("ISO 51200 · 1/1000 · f/5.6 · 10000 K");

    /** The lines that are cut, of every text the page may cut with an ellipsis. */
    const cut = () =>
      page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLElement>(
            "[data-region=cluster] *, [data-region=bay] *, [data-region=plate] *"
          ),
        ]
          .filter((element) => getComputedStyle(element).textOverflow === "ellipsis")
          .filter((element) => element.scrollWidth > element.clientWidth)
          .map((element) => element.textContent)
      );
    expect(await cut(), "held").toEqual([]);

    await page.evaluate(() => {
      for (const camera of [1, 2, 3] as const) window.__SSE_TEST_CAMERAS__!.stopAnswering(camera);
    });
    for (const camera of [1, 2, 3]) {
      const key = page.getByTestId(`cameras-key-${camera}`);
      await expect(key).toHaveAttribute("data-state", "unreachable", { timeout: 3000 });
      await expect(key).toContainText("10000 K");
      await expect(key).toContainText("last read");
    }
    expect(await cut(), "unreachable").toEqual([]);
  });

  test("nothing scrolls, and the regions keep their sizes", async ({ page }) => {
    for (const fixture of ["cameras-held", "cameras-lost-mid-take", "cameras-no-link", "cameras-picture-missing"]) {
      await openCameras(page, fixture);
      const sizes = await page.evaluate(() => {
        const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
        const inside = (selector: string) => {
          const element = document.querySelector(selector)!;
          return element.scrollHeight <= element.clientHeight + 1;
        };
        return {
          page: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
          hero: [box("[data-testid=cameras-hero]").width, box("[data-testid=cameras-hero]").height],
          rowBottom: box("[data-testid=cameras-loupe]").bottom,
          footerTop: box("[data-region=footer]").top,
          cluster: inside("[data-testid=cameras-cluster]"),
          plate: inside("[data-testid=cameras-plate]"),
        };
      });
      expect(sizes.page, fixture).toEqual([2560, 1440]);
      expect(sizes.hero, `${fixture}: the big picture is exactly 1680 × 945`).toEqual([1680, 945]);
      expect(sizes.rowBottom, `${fixture}: the small pictures end above the footer`).toBeLessThanOrEqual(
        sizes.footerTop
      );
      expect(sizes.cluster, `${fixture}: the cluster holds everything it shows`).toBe(true);
      expect(sizes.plate, `${fixture}: the plate holds everything it shows`).toBe(true);
    }
  });

  test("the Recent list has room for its five rows at two lines each", async ({ page }) => {
    await page.clock.install();
    await openCameras(page);
    // A look's sentence is the longest a row carries, and takes two lines.
    await openLook(page);
    for (const lut of ["Film → Video", "Film → Ext. video", "Film → Video", "Film → Ext. video", "Film → Video"]) {
      await pressTwice(page, `cameras-displayLut-${lut}`);
      await expect(page.getByTestId("cameras-recent-row").first()).toContainText(`→ ${lut}.`);
    }
    const room = await page.evaluate(() => {
      const section = document.querySelector<HTMLElement>("[data-testid=cameras-recent]")!;
      const rows = [...section.querySelectorAll<HTMLElement>("[data-testid=cameras-recent-row]")];
      return {
        lines: rows.map((row) => {
          const text = row.children[1] as HTMLElement;
          return Math.round(text.getBoundingClientRect().height / parseFloat(getComputedStyle(text).lineHeight));
        }),
        cut: section.scrollHeight > section.clientHeight + 1,
        lastRowBottom: rows.at(-1)!.getBoundingClientRect().bottom,
        sectionBottom: section.getBoundingClientRect().bottom,
        // The shell (overhaul 3): the standing keys went into the page's ⋯, so
        // the list is the cluster's last section, above its foot margin.
        clusterFoot: (() => {
          const cluster = document.querySelector<HTMLElement>("[data-testid=cameras-cluster]")!;
          return cluster.getBoundingClientRect().bottom - parseFloat(getComputedStyle(cluster).paddingBottom);
        })(),
      };
    });
    expect(room.lines).toEqual([2, 2, 2, 2, 2]);
    expect(room.cut, "the list is not cut").toBe(false);
    expect(room.lastRowBottom).toBeLessThanOrEqual(room.sectionBottom + 0.5);
    expect(room.sectionBottom, "the list ends inside the cluster").toBeLessThanOrEqual(room.clusterFoot + 0.5);
  });

  // Controls used during a take never move (docs/DESIGN.md, section 1): REC,
  // the cameras' keys and what stands under them are where they were, whatever
  // the take's rows and the cameras' keys say.
  test("the cluster's keys stand where they stood, whatever the cameras' state", async ({ page }) => {
    const places = () =>
      page.evaluate(() =>
        [
          "cameras-rec",
          "cameras-take",
          "cameras-key-1",
          "cameras-key-2",
          "cameras-key-3",
          "cameras-dials",
          "cameras-bank-exposure",
          "cameras-dials-hint",
          "cameras-pictures",
          "cameras-recent",
        ].map((id) => {
          const box = document.querySelector(`[data-testid=${id}]`)!.getBoundingClientRect();
          // The Recent list is as long as its rows. The shell (overhaul 3): the
          // standing keys that stood at the foot are in the page's ⋯.
          const height = id === "cameras-recent" ? null : Math.round(box.height * 10) / 10;
          return [id, Math.round(box.top * 10) / 10, height];
        })
      );
    await openCameras(page, "cameras-held");
    const held = await places();
    for (const fixture of [
      "cameras-recording",
      "cameras-released",
      "cameras-unreachable",
      "cameras-lost-mid-take",
      "cameras-no-link",
      "cameras-picture-missing",
    ]) {
      await openCameras(page, fixture);
      expect(await places(), fixture).toEqual(held);
      // Whatever the dials' hint says, it says it on one line.
      for (const bank of ["colour", "focus", "exposure"]) {
        await page.getByTestId(`cameras-bank-${bank}`).click();
        await expect(page.getByTestId(`cameras-bank-${bank}`)).toHaveAttribute("aria-pressed", "true");
        expect(await places(), `${fixture}, ${bank}`).toEqual(held);
      }
    }

    // And through a take on one board: started, armed to stop, stopped.
    await openCameras(page, "cameras-held");
    const rec = page.getByTestId("cameras-rec");
    await rec.click();
    await expect(rec).toHaveAttribute("data-rec", "recording");
    await expect(page.getByTestId("cameras-take-length")).toContainText("counted here since");
    expect(await places(), "recording").toEqual(held);
    await rec.click();
    await expect(rec).toHaveAttribute("data-armed", "true");
    expect(await places(), "stop armed").toEqual(held);
  });

  // The visual overhaul (2026-10-05, DESIGN.md §9): one menu for each camera.
  // Its key's ⋯, its small picture's ⋯ and the plate title's ⋯ open the same
  // items, and a right-click on the key or the picture opens it at the pointer.
  test("a camera's key, its small picture and the plate's title open the same menu, and a right-click does too", async ({
    page,
  }) => {
    await openCameras(page);
    const items = (menu: Awaited<ReturnType<typeof openCameraKeyMenu>>) =>
      menu.locator("[data-menu-item]").allTextContents();

    let menu = await openCameraKeyMenu(page, 2);
    // Its head names the camera and how it is reached.
    await expect(menu).toHaveAccessibleName("CAM 2");
    await expect(menu).toHaveAccessibleDescription("Panasonic LUMIX BGH1 · network · 172.16.16.85");
    const fromKey = await items(menu);
    expect(fromKey.join(" | ")).toContain("Read CAM 2 again");
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);

    menu = await openTileMenu(page, 2);
    expect(await items(menu)).toEqual(fromKey);
    await page.keyboard.press("Escape");

    // A right-click on the small picture opens it at the pointer.
    await page.getByTestId("cameras-tile-2").click({ button: "right", position: { x: 300, y: 200 } });
    menu = page.getByRole("menu").last();
    await expect(menu).toBeVisible();
    expect(await items(menu)).toEqual(fromKey);
    await page.keyboard.press("Escape");

    // The selected camera's menu is the plate's: Select is the camera already,
    // and Release arms in the menu.
    menu = await openCamerasPlateMenu(page);
    await expect(menu).toHaveAccessibleName("CAM 1");
    await expect(menu.getByTestId("cameras-plate-menu-select")).toHaveAttribute("aria-disabled", "true");
    await expect(menu.getByTestId("cameras-plate-menu-release")).toHaveText("Release CAM 1…");
    await page.keyboard.press("Escape");
    // A right-click on the plate's title opens the same menu.
    await page.getByTestId("cameras-plate-head").click({ button: "right", position: { x: 40, y: 30 } });
    menu = page.getByRole("menu").last();
    await expect(menu).toHaveAccessibleName("CAM 1");
    await expect(menu.getByTestId("cameras-plate-menu-release")).toHaveText("Release CAM 1…");
    await page.keyboard.press("Escape");
    await page.getByTestId("cameras-key-1").click({ button: "right" });
    menu = page.getByRole("menu").last();
    await expect(menu.getByTestId("cameras-key-menu-1-release")).toHaveText("Release CAM 1…");
    await page.keyboard.press("Escape");

    // Select in another camera's menu selects it.
    menu = await openTileMenu(page, 3);
    await menu.getByTestId("cameras-tile-menu-3-select").click();
    await expect(page.getByTestId("cameras-plate")).toHaveAttribute("data-camera", "3");
    // Read again is one read, which sends nothing.
    menu = await openCamerasPlateMenu(page);
    await menu.getByTestId("cameras-plate-menu-read-again").click();
    await expect(toast(page)).toContainText("Read again: nothing has changed.");
    expect(await page.evaluate(() => window.__SSE_TEST_CAMERAS__!.sent(3))).toBe(0);
  });

  // The selected camera's Release in its menu is the menu's last item, which
  // arms in place and keeps the menu open; the second press releases. Until
  // the page knew a menu's arm (`menu:release:N`), it dropped it at once.
  test("Release in the selected camera's menu arms in place, says so, and releases at the second press", async ({
    page,
  }) => {
    await page.clock.install();
    await openCameras(page);
    await page.getByTestId("cameras-key-2").click();
    await expect(page.getByTestId("cameras-plate")).toHaveAttribute("data-camera", "2");
    const menu = await openCamerasPlateMenu(page);
    const release = menu.getByTestId("cameras-plate-menu-release");
    await pausePageClock(page);
    await release.click();
    await expect(release).toHaveAttribute("data-armed", "true");
    await expect(release).toContainText("Press again to release CAM 2 to LUMIX Tether");
    await expect(menu).toBeVisible();
    await expect(state(page)).toContainText("Release CAM 2 to LUMIX Tether · press again");
    await expect(page.getByTestId("cameras-connection-note")).toHaveText(
      "LUMIX Tether can then reach CAM 2. Connect takes it back."
    );
    await page.clock.fastForward(PAST_THE_DWELL_MS);
    await release.click();
    await page.clock.resume();
    await expect(state(page)).toContainText("RELEASED");
    await expect(page.getByTestId("cameras-connection-word")).toContainText("RELEASED");
    await expect(page.getByTestId("cameras-recent-row").first()).toContainText("CAM 2 released to LUMIX Tether.");
    await expect(page.getByTestId("cameras-key-1")).toContainText("HELD");
  });

  // Release in a camera's menu that is not selected selects it first and arms
  // the plate's fixed Release key, once the hardware link says it is
  // selected; it never arms the camera that was selected before.
  test("CAM 2's picture menu while CAM 1 is selected: Release… selects CAM 2 and arms the plate's key; CAM 1 stays held", async ({
    page,
  }) => {
    await openCameras(page);
    await expect(page.getByTestId("cameras-plate")).toHaveAttribute("data-camera", "1");
    const menu = await openTileMenu(page, 2);
    await expect(menu.getByTestId("cameras-tile-menu-2-release")).toContainText("Release CAM 2…");
    await expect(menu.getByTestId("cameras-tile-menu-2-release")).toContainText("on the plate");
    await menu.getByTestId("cameras-tile-menu-2-release").click();
    await expect(menu).toHaveCount(0);
    await expect(page.getByTestId("cameras-plate")).toHaveAttribute("data-camera", "2");
    const key = page.getByTestId("cameras-release");
    await expect(key).toHaveAttribute("data-armed", "true");
    await expect(state(page)).toContainText("Release CAM 2 to LUMIX Tether · press again");
    // CAM 1 was never armed, and is held.
    await expect(page.getByTestId("cameras-key-1")).toContainText("HELD");
    // The arm came with the selection, on the running clock: the second press
    // past the dwell and inside the window releases.
    await page.waitForTimeout(PAST_THE_DWELL_MS);
    await key.click();
    await expect(page.getByTestId("cameras-connection-word")).toContainText("RELEASED");
    await expect(page.getByTestId("cameras-key-2")).toContainText("RELEASED");
    await expect(page.getByTestId("cameras-key-1")).toContainText("HELD");
    expect(await page.evaluate(() => window.__SSE_TEST_CAMERAS__!.sent(1))).toBe(0);
  });

  // The hand-off arms once, from the read that follows its own selection, and
  // nothing waits for a later one: the camera selected again by hand later
  // arms nothing (the review of pull request 6: a give-up timer that every
  // read restarted could arm it then, and one press would have released it).
  test("a hand-off arms once: the camera selected again by hand later arms nothing", async ({ page }) => {
    await openCameras(page);
    const menu = await openTileMenu(page, 2);
    await menu.getByTestId("cameras-tile-menu-2-release").click();
    const key = page.getByTestId("cameras-release");
    await expect(key).toHaveAttribute("data-armed", "true");
    await page.keyboard.press("Escape");
    await expect(key).toHaveAttribute("data-armed", "false");
    await page.getByTestId("cameras-key-3").click();
    await expect(page.getByTestId("cameras-plate")).toHaveAttribute("data-camera", "3");
    // Past more than one read.
    await page.waitForTimeout(2_500);
    await page.getByTestId("cameras-key-2").click();
    await expect(page.getByTestId("cameras-plate")).toHaveAttribute("data-camera", "2");
    await page.waitForTimeout(1_200);
    await expect(key).toHaveAttribute("data-armed", "false");
    await expect(state(page)).not.toContainText("press again");
  });

  // The words the page prints are the hardware link's state words, in capitals
  // (DESIGN.md §8), and no value is set in SSE Adelia.
  test("the state words are in capitals, and no value is set in the display face", async ({ page }) => {
    await openCameras(page, "cameras-released");
    await expect(page.getByTestId("cameras-key-2")).toContainText("RELEASED");
    await expect(page.getByTestId("cameras-caption-state")).toHaveText("RELEASED");
    await expect(page.getByTestId("cameras-tile-chip-1")).toContainText("HELD");
    await expect(page.getByTestId("cameras-picture-row-1")).toContainText("LIVE");
    // The face of each element whose own text is a value, on the held board:
    // the loupe's zooms, the take's timecode, a value of the plate's and a
    // camera key's values.
    await openCameras(page);
    const faces = await page.evaluate(() => {
      const ownText = (element: Element) =>
        [...element.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? "")
          .join("")
          .trim();
      const valued = (id: string) =>
        [document.querySelector(`[data-testid=${id}]`), ...document.querySelectorAll(`[data-testid=${id}] *`)].filter(
          (element): element is Element => element !== null && /\d/.test(ownText(element))
        );
      return ["cameras-zoom-2", "cameras-zoom-4", "cameras-take-timecode", "cameras-iso-value", "cameras-key-1"].map(
        (id) => {
          const elements = valued(id);
          return { id, count: elements.length, faces: elements.map((element) => getComputedStyle(element).fontFamily) };
        }
      );
    });
    for (const { id, count, faces: found } of faces) {
      expect(count, `${id} has a value`).toBeGreaterThan(0);
      for (const face of found) expect(face, id).not.toContain("Adelia");
    }
  });
});

test.describe("the header with the cameras", () => {
  // The shell (overhaul 3): the fullest header is Setup's, where every page's
  // tab carries its word, with the deck, the latches and the REC tally lit. A
  // drifted scene is the Lighting tab's word, the prompter's play its tab's.
  test("its fullest row fits: every tab's word, Solo, the prompter playing and REC together", async ({ page }) => {
    await openFixture(page, "every-page");
    await expectWorkspaceMounted(page, "cameras");
    await page.getByTestId("cameras-rec").click();
    await expect(recChip(page)).toBeVisible();

    await page.getByRole("button", { name: "Lighting", exact: true }).click();
    await expectWorkspaceMounted(page, "lighting");
    await page.getByRole("button", { name: /^Front, 2 fixtures at 67 %, on/ }).click();

    await page.getByRole("button", { name: "Teleprompter", exact: true }).click();
    // The lighting page asks before it is left with a scene that drifted.
    const leave = page.getByRole("button", { name: /Leave|Discard|Continue/ });
    if (await leave.count()) await leave.first().click();
    await expectWorkspaceMounted(page, "teleprompter");
    await expect(page.getByTestId("teleprompter-play")).not.toHaveAttribute("data-locked", "", { timeout: 10_000 });
    await page.getByTestId("teleprompter-play").click();

    await page.getByRole("button", { name: "Setup / Support", exact: true }).click();
    await expect(page.getByTestId("setup-state-display")).toBeVisible();
    await expect(page.getByTestId("shell-lamp-prompter")).toContainText("playing");
    await expect(page.getByTestId("shell-lamp-prompter")).toContainText("left");
    await expect(page.getByTestId("shell-lamp-latched-solo")).toBeVisible();
    await expect(recChip(page)).toBeVisible();

    const row = await page.evaluate(() => {
      const header = document.querySelector('[data-region="header"]')!;
      const box = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      };
      const nav = header.querySelector("nav")!;
      const words = [...nav.querySelectorAll('[data-testid^="shell-lamp-"]')].map((word) =>
        word.getAttribute("data-testid")
      );
      const health = header.querySelector('[data-testid="shell-lamp-surface"]')!.parentElement!;
      const chips = [...health.querySelectorAll('[data-testid^="shell-lamp-"]')].map((chip) => ({
        id: chip.getAttribute("data-testid"),
        ...box(chip),
      }));
      return {
        words,
        chips,
        tabs: box(nav),
        tabsClipped: nav.scrollWidth > nav.clientWidth,
        tally: box(header.querySelector('[data-testid="shell-rec-slot"]')!),
        clock: box(header.querySelector('[data-testid="shell-clock"]')!),
        logo: box(header.querySelector("img")!),
        clipped: health.scrollWidth > health.clientWidth,
        width: header.getBoundingClientRect().width,
      };
    });
    expect(row.words).toEqual(["shell-lamp-lighting", "shell-lamp-audio", "shell-lamp-cameras", "shell-lamp-prompter"]);
    expect(row.chips.map((chip) => chip.id)).toEqual(["shell-lamp-surface", "shell-lamp-latched-solo"]);
    expect(row.tabsClipped, "no tab is cut").toBe(false);
    expect(row.clipped, "no chip is cut").toBe(false);
    expect(row.chips[0]!.left, "the lamps start after the tabs").toBeGreaterThan(row.tabs.right);
    for (let index = 1; index < row.chips.length; index += 1) {
      expect(row.chips[index]!.left, `${row.chips[index]!.id} stands after the chip before it`).toBeGreaterThanOrEqual(
        row.chips[index - 1]!.right
      );
    }
    expect(row.chips.at(-1)!.right, "the last chip ends before the REC tally").toBeLessThanOrEqual(row.tally.left);
    expect(row.tally.right, "the REC tally ends before the clock").toBeLessThanOrEqual(row.clock.left);
    expect(row.clock.right, "the clock keeps the logotype's clear space").toBeLessThanOrEqual(row.logo.left - 20);
    expect(row.logo.right).toBeLessThanOrEqual(row.width - 32);
  });

  test("the REC tally stands in the same place whether or not it is lit", async ({ page }) => {
    await openFixture(page, "every-page");
    await expectWorkspaceMounted(page, "cameras");
    const slot = page.getByTestId("shell-rec-slot");
    const surface = page.getByTestId("shell-lamp-surface");
    const at = async () => ({ slot: await slot.boundingBox(), surface: await surface.boundingBox() });
    const before = await at();
    await page.getByTestId("cameras-rec").click();
    await expect(recChip(page)).toBeVisible();
    await expect(recChip(page)).toHaveAttribute("data-tone", "error");
    expect(await at(), "nothing in the header moves when REC lights").toEqual(before);
  });
});

test.describe("Setup / Support's camera section", () => {
  test("Camera setup opens it from the page, and it is no step of the runner", async ({ page }) => {
    await openCameras(page);
    // The shell (overhaul 3): Camera setup is in the page's ⋯.
    await page.getByTestId("cameras-page-menu").click();
    await page.getByTestId("cameras-open-setup").click();
    await expectWorkspaceMounted(page, "setup");
    await expect(page.getByTestId("setup-mode-cameras")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("setup-screen-cameras")).toContainText("Camera setup");
    await expect(page.locator('[data-testid^="setup-step-"][role="tab"]')).toHaveCount(5);
    for (const camera of [1, 2, 3]) {
      await expect(page.getByTestId(`setup-camera-${camera}-state`)).toHaveText("HELD");
    }
    // It is a mode of Setup / Support, beside the runner and Support.
    await page.getByTestId("setup-mode-runner").click();
    await expect(page.getByTestId("setup-screen-cameras")).toHaveCount(0);
    await expect(page.getByTestId("setup-mode-cameras")).toHaveAttribute("aria-pressed", "false");
    await page.getByTestId("setup-mode-cameras").click();
    await expect(page.getByTestId("setup-screen-cameras")).toBeVisible();
  });

  test("takes an address and a pairing, names each camera's vMix output, and forgets a camera", async ({ page }) => {
    await page.clock.install();
    await openFixture(page, "setup-cameras");
    await expectWorkspaceMounted(page, "setup");
    await expect(page.getByTestId("setup-camera-3-state")).toHaveText("NOT SET UP");
    // The visual overhaul (2026-10-05): the hardware link's sentence under the camera's head.
    await expect(page.getByTestId("setup-camera-record-3")).toContainText("has no address");
    await expect(page.getByTestId("setup-camera-3-save-address")).toHaveAttribute("aria-disabled", "true");

    await page.getByTestId("setup-camera-3-address").fill("172.16.16.30");
    await page.getByTestId("setup-camera-3-save-address").click();
    await expect(page.getByTestId("setup-camera-3-state")).toHaveText("HELD");
    await expect(page.getByTestId("setup-feedback")).toContainText(
      "CAM 3's address is saved. Studio Control holds CAM 3 now; nothing was sent to it."
    );
    expect(await page.evaluate(() => window.__SSE_TEST_CAMERAS__!.sent(3))).toBe(0);
    await expect(page.getByTestId("shell-lamp-cameras")).toContainText("ready");

    // What is not the address of one machine is refused in the hardware link's words.
    await page.getByTestId("setup-camera-2-address").fill("172.16.16");
    await page.getByTestId("setup-camera-2-save-address").click();
    await expect(page.getByTestId("setup-feedback")).toContainText("172.16.16 is not the address of one machine.");
    await expect(page.getByTestId("setup-camera-2-state")).toHaveText("HELD");

    // Each camera's picture comes from its own vMix output, fixed: named, never taken.
    for (const [camera, output] of [
      [1, 2],
      [2, 3],
      [3, 4],
    ]) {
      await expect(page.getByTestId(`setup-camera-${camera}-output`)).toHaveText(`vMix Output ${output}`);
      await expect(page.getByTestId(`setup-camera-${camera}-input`)).toHaveCount(0);
    }
    await expect(page.getByTestId("setup-screen-cameras")).not.toContainText("vMix input");

    // The visual overhaul (2026-10-05): Forget is the camera menu's last item,
    // and it arms in place: the second press forgets.
    await page.getByTestId("setup-camera-menu-1").click();
    await pressTwice(page, "setup-camera-1-forget");
    await expect(page.getByTestId("setup-feedback")).toContainText("CAM 1's pairing is forgotten.");
    await expect(page.getByTestId("setup-camera-1-state")).toHaveText("NOT SET UP");
    await expect(page.getByTestId("setup-camera-1-paired")).toHaveText("not paired");
    await expect(page.getByTestId("setup-camera-1-output")).toHaveText("vMix Output 2");
    await page.getByTestId("setup-camera-1-pair").click();
    await expect(page.getByTestId("setup-camera-1-state")).toHaveText("HELD");
    await expect(page.getByTestId("setup-camera-1-paired")).toHaveText("paired");
  });

  test("without a link it takes no pairing and no address, and says why", async ({ page }) => {
    await openCameras(page, "cameras-no-link");
    await page.getByTestId("cameras-state-setup").click();
    await expectWorkspaceMounted(page, "setup");
    await expect(page.getByTestId("setup-screen-cameras")).toContainText(
      "This version has no link to the cameras yet, so it takes no pairing and no address."
    );
    await expect(page.getByTestId("setup-camera-1-pair")).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByTestId("setup-camera-1-no-link")).toHaveText(
      "Studio Control cannot pair CAM 1 yet: its Bluetooth link comes with a later version."
    );
    await expect(page.getByTestId("setup-camera-2-address")).toBeDisabled();
    await expect(page.getByTestId("setup-camera-2-save-address")).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByTestId("setup-camera-2-no-link")).toHaveText(
      "Studio Control cannot take CAM 2's address yet: its network link comes with a later version."
    );
    await expect(page.getByTestId("setup-screen-cameras")).not.toContainText("vMix input");
    // Each camera's output is named all the same.
    await expect(page.getByTestId("setup-camera-2-output")).toHaveText("vMix Output 3");
  });
});
