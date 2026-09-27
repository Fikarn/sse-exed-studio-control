import { expect, test, type Page } from "@playwright/test";

import { expectWorkspaceMounted, openFixture } from "./helpers/openFixture";

// New pages program, Slice 6a: the Teleprompter page against the fixture
// double (board 1, "Live mirror"; the proposal, docs/redesign/teleprompter-
// 2026-09.md). The double answers every prompter request as the hardware link
// does (Slices 4 and 5a); the page's copy of the glass reports its layout, so
// PLAY unlocks once the fonts are in.

async function openTeleprompter(page: Page, fixture = "teleprompter-ready") {
  await openFixture(page, fixture);
  await expectWorkspaceMounted(page, "teleprompter");
}

/** PLAY unlocks once the copy's layout has reached the hardware link. */
async function expectLaidOut(page: Page) {
  await expect(page.getByTestId("teleprompter-play")).not.toHaveAttribute("data-locked", "", { timeout: 10_000 });
}

test.describe("the Teleprompter page (new pages S6a)", () => {
  test("sits after Audio, and shows the script on the glass with its place and time", async ({ page }) => {
    await openTeleprompter(page);
    const tabs = page.getByRole("navigation", { name: "Workspace navigation" }).getByRole("button");
    await expect(tabs).toHaveText(["Setup / Support", "Lighting", "Audio", "Teleprompter"]);
    await expect(page.getByTestId("teleprompter-state-display")).toContainText("ON SCREEN");
    await expect(page.getByTestId("teleprompter-state-display")).toContainText(
      "The Prompter XL shows 02 Interview intro. Paused at paragraph 8"
    );
    await expect(page.getByTestId("teleprompter-on-glass")).toHaveText("02 Interview intro");
    await expect(page.getByTestId("teleprompter-place")).toContainText("¶ 8 of");
    await expect(page.getByTestId("teleprompter-copy")).toHaveAttribute("data-picture", "prompter-glass");
    // The header: the Prompter lamp before the deck's, which is called Surface (D19).
    await expect(page.getByTestId("shell-lamp-prompter")).toContainText("Prompter");
    await expect(page.getByTestId("shell-lamp-surface")).toContainText("Surface");
  });

  test("PLAY scrolls and lights a green latch on every page, which opens the Teleprompter", async ({ page }) => {
    await openTeleprompter(page);
    await expectLaidOut(page);
    await page.getByTestId("teleprompter-play").click();
    await expect(page.getByTestId("teleprompter-play")).toHaveAttribute("aria-pressed", "true");
    const latch = page.getByTestId("shell-lamp-latched-prompter-playing");
    await expect(latch).toContainText("Prompter playing");
    await expect(latch).toContainText("left");

    await page.getByRole("button", { name: "Audio", exact: true }).click();
    await expectWorkspaceMounted(page, "audio");
    await expect(latch).toBeVisible();
    await latch.click();
    await expectWorkspaceMounted(page, "teleprompter");

    await page.getByTestId("teleprompter-play").click();
    await expect(page.getByTestId("teleprompter-play")).toHaveAttribute("aria-pressed", "false");
    await expect(latch).toHaveCount(0);
  });

  test("a jump moves the place and never starts the scroll", async ({ page }) => {
    await openTeleprompter(page);
    await expectLaidOut(page);
    await page.getByTestId("teleprompter-top").click();
    await expect(page.getByTestId("teleprompter-place")).toContainText("¶ 1 of");
    await page.getByTestId("teleprompter-paragraph-on").click();
    await expect(page.getByTestId("teleprompter-place")).toContainText("¶ 2 of");
    await page.getByTestId("teleprompter-paragraph-5").click();
    await expect(page.getByTestId("teleprompter-place")).toContainText("¶ 5 of");
    // Enter in the field moves nothing (D6); the Go key does.
    await page.getByTestId("teleprompter-go-to-field").fill("3");
    await page.getByTestId("teleprompter-go-to-field").press("Enter");
    await page.waitForTimeout(300);
    await expect(page.getByTestId("teleprompter-place")).toContainText("¶ 5 of");
    await page.getByTestId("teleprompter-go-to-key").click();
    await expect(page.getByTestId("teleprompter-place")).toContainText("¶ 3 of");
    await expect(page.getByTestId("teleprompter-play")).toHaveAttribute("aria-pressed", "false");
  });

  test("a speed press moves the pace by 5 words a minute, and a size press the text by 4 px", async ({ page }) => {
    await openTeleprompter(page);
    await expectLaidOut(page);
    const speed = page.getByTestId("teleprompter-speed-readout");
    await expect(speed).toHaveText("140 words/min");
    await page.getByTestId("teleprompter-speed-up").click();
    await expect(speed).toHaveText("145 words/min");
    await page.getByTestId("teleprompter-speed-down").click();
    await page.getByTestId("teleprompter-speed-down").click();
    await expect(speed).toHaveText("135 words/min");

    const size = page.getByTestId("teleprompter-text-size");
    await expect(size).toHaveText("88 px standard");
    await page.getByTestId("teleprompter-size-up").click();
    await expect(size).toHaveText("92 px standard 88");
    await page.getByTestId("teleprompter-size-down").click();
    await expect(size).toHaveText("88 px standard");
  });

  test("the mouse wheel over the copy moves nothing", async ({ page }) => {
    await openTeleprompter(page);
    await expectLaidOut(page);
    const before = await page.getByTestId("teleprompter-place").textContent();
    await page.getByTestId("teleprompter-copy").hover();
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(300);
    await expect(page.getByTestId("teleprompter-place")).toHaveText(before ?? "");
  });

  test("Replace and Clear are armed: the first press arms, the second applies", async ({ page }) => {
    await openTeleprompter(page);
    await page.getByTestId("teleprompter-scripts").getByText("04 Outro").click();
    await expect(page.getByTestId("teleprompter-selected")).toContainText("04 Outro");

    await page.getByTestId("teleprompter-replace").click();
    await expect(page.getByTestId("teleprompter-state-display")).toContainText("Replace with 04 Outro · press again");
    await expect(page.getByTestId("teleprompter-on-glass")).toHaveText("02 Interview intro");
    await page.waitForTimeout(400);
    await page.getByTestId("teleprompter-replace").click();
    await expect(page.getByTestId("teleprompter-on-glass")).toHaveText("04 Outro");

    await page.getByTestId("teleprompter-clear").click();
    await expect(page.getByTestId("teleprompter-on-glass")).toHaveText("04 Outro");
    await page.waitForTimeout(400);
    await page.getByTestId("teleprompter-clear").click();
    await expect(page.getByTestId("teleprompter-nothing-on")).toHaveText("Nothing on the prompter");
    await expect(page.getByTestId("teleprompter-state-display")).toContainText("READY");
    await expect(page.getByTestId("teleprompter-play")).toHaveAttribute("data-locked", "");
  });

  test("with nothing on the prompter, Put on is one press", async ({ page }) => {
    await openTeleprompter(page);
    await page.waitForTimeout(400);
    await page.getByTestId("teleprompter-clear").click();
    await page.waitForTimeout(400);
    await page.getByTestId("teleprompter-clear").click();
    await expect(page.getByTestId("teleprompter-nothing-on")).toBeVisible();
    await page.getByTestId("teleprompter-scripts").getByText("01 Welcome").click();
    await page.getByTestId("teleprompter-put-on").click();
    await expect(page.getByTestId("teleprompter-on-glass")).toHaveText("01 Welcome");
  });

  test("NOT CONNECTED locks PLAY, dims the copy and marks it Not on the glass", async ({ page }) => {
    await openTeleprompter(page, "teleprompter-not-connected");
    await expect(page.getByTestId("teleprompter-state-display")).toContainText("NOT CONNECTED");
    await expect(page.getByTestId("teleprompter-play")).toHaveAttribute("data-locked", "");
    await expect(page.getByTestId("teleprompter-not-on-glass")).toHaveText("Not on the glass");
    await expect(page.getByTestId("shell-lamp-prompter")).toContainText("not connected");
    // Jumps still work: the place they set is where the prompter comes back.
    await page.getByTestId("teleprompter-top").click();
    await expect(page.getByTestId("teleprompter-place")).toContainText("¶ 1 of");
  });

  test("NOT UPDATED offers Update · press twice, and Update clears it", async ({ page }) => {
    await openTeleprompter(page, "teleprompter-not-updated");
    await expect(page.getByTestId("teleprompter-state-display")).toContainText("NOT UPDATED");
    await expect(page.getByTestId("shell-lamp-prompter")).toContainText("not updated");
    await page.getByTestId("teleprompter-state-update").click();
    await page.waitForTimeout(400);
    await page.getByTestId("teleprompter-state-update").click();
    await expect(page.getByTestId("teleprompter-state-display")).toContainText("ON SCREEN");
  });

  test("the first run: no scripts, a blank glass, and Open file… adds one", async ({ page }) => {
    await openTeleprompter(page, "teleprompter-empty");
    await expect(page.getByTestId("teleprompter-state-display")).toContainText("READY");
    await expect(page.getByTestId("teleprompter-selected")).toContainText("No scripts");
    await page.getByTestId("teleprompter-file-input").setInputFiles({
      name: "Morning news.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Good morning.\n\nHere is the news.\n"),
    });
    await expect(page.getByTestId("teleprompter-scripts")).toContainText("Morning news");
  });

  test("Removed lists what was removed, and Restore brings a script back", async ({ page }) => {
    await openTeleprompter(page);
    await page.getByTestId("teleprompter-removed").click();
    const removed = page.getByTestId("teleprompter-scripts");
    await expect(removed).toContainText("Removed");
    const restore = removed.getByRole("button", { name: "Restore" }).first();
    await restore.click();
    await page.getByTestId("teleprompter-removed").click();
    await expect(page.getByTestId("teleprompter-scripts")).toContainText("Scripts");
  });

  test("Setup / Support's Workstation names the Prompter XL as Windows reports it", async ({ page }) => {
    await openTeleprompter(page);
    await page.getByRole("button", { name: "Setup / Support", exact: true }).click();
    await expectWorkspaceMounted(page, "setup");
    await expect(page.getByTestId("support-prompter-xl")).toContainText("connected · 1920×1080 · 60 Hz");
  });
});
