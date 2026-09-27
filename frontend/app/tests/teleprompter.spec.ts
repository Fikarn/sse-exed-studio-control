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

// New pages program, Slice 6b: the editor (the bay's second view), Rename, New
// script and Paste as a new script, and a file opened again (the proposal
// §3.1, §3.3, §6.3). The page reads the clipboard itself, so these cases may.
test.describe("the Teleprompter's editor (new pages S6b)", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  async function openEditor(page: Page, fixture = "teleprompter-ready") {
    await openTeleprompter(page, fixture);
    await page.getByTestId("teleprompter-bay-edit").click();
    await expect(page.getByTestId("teleprompter-editor-text")).toHaveAttribute("contenteditable", "true");
    await expect(page.getByTestId("teleprompter-quarter-copy")).toHaveAttribute("data-picture", "prompter-glass");
  }

  /** Puts the caret at the end of the paragraph at the reading line, which the editor opens on. */
  async function caretInReadingLine(page: Page) {
    const line = page.getByTestId("teleprompter-editor-text").locator('p[data-mark="reading line"]');
    await expect(line).toBeVisible();
    const box = (await line.boundingBox())!;
    await page.mouse.click(box.x + box.width - 2, box.y + box.height - 6);
    await page.keyboard.press("End");
    return line;
  }

  async function copyToClipboard(page: Page, html: string, text: string) {
    await page.evaluate(
      async ([markup, plain]) => {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([markup], { type: "text/html" }),
            "text/plain": new Blob([plain], { type: "text/plain" }),
          }),
        ]);
      },
      [html, text] as const
    );
  }

  test("an edit of the script on the prompter is saved as it is typed, marked, and reaches the glass only on Update", async ({
    page,
  }) => {
    await openEditor(page);
    await expect(page.getByTestId("teleprompter-edit-note")).toContainText("the glass keeps its text");
    const line = await caretInReadingLine(page);
    await page.keyboard.type(" Typed here.");
    await expect(line).toContainText("Typed here.");
    await expect(page.getByTestId("teleprompter-editor-saved")).toHaveAttribute("data-save", "saved");
    await expect(page.getByTestId("teleprompter-state-display")).toContainText("NOT UPDATED");
    await expect(page.getByTestId("teleprompter-edited-list")).toHaveText("¶ 8");
    await page.getByTestId("teleprompter-state-update").click();
    await page.waitForTimeout(400);
    await page.getByTestId("teleprompter-state-update").click();
    await expect(page.getByTestId("teleprompter-state-display")).toContainText("ON SCREEN");
    await expect(page.getByTestId("teleprompter-edited-list")).toHaveText("nothing");
  });

  test("formatting comes from the bar, not the browser's keys; the browser's undo and redo act on the editor's text", async ({
    page,
  }) => {
    await openEditor(page);
    const line = await caretInReadingLine(page);
    await page.keyboard.press("Shift+Home");
    const bold = () => line.locator("b").count();
    const before = await bold();
    await page.keyboard.press("Control+b");
    expect(await bold()).toBe(before);
    await page.getByTestId("teleprompter-editor-bold").click();
    await expect.poll(bold).toBeGreaterThan(before);
    await page.keyboard.press("Control+z");
    await expect.poll(bold).toBe(before);
    await page.keyboard.press("Control+y");
    await expect.poll(bold).toBeGreaterThan(before);
    await page.getByTestId("teleprompter-editor-undo").click();
    await expect.poll(bold).toBe(before);
    await expect(page.getByTestId("teleprompter-editor-redo")).not.toHaveAttribute("data-locked", "");
  });

  test("a paste keeps its bold and its paragraphs, read by the hardware link's reader, and Add cue writes a cue", async ({
    page,
  }) => {
    await openEditor(page);
    const text = page.getByTestId("teleprompter-editor-text");
    const paragraphs = await text.locator("p").count();
    await caretInReadingLine(page);
    await copyToClipboard(
      page,
      "<p><b>Pasted bold</b> and plain</p><p>A second paragraph</p>",
      "Pasted bold and plain"
    );
    await page.keyboard.press("Control+v");
    await expect(text.locator("b", { hasText: "Pasted bold" })).toHaveCount(1);
    await expect(text.locator("p")).toHaveCount(paragraphs + 1);
    await page.getByTestId("teleprompter-editor-paste").click();
    await expect(text.locator("b", { hasText: "Pasted bold" })).toHaveCount(2);
    await page.getByTestId("teleprompter-editor-cue").click();
    await page.keyboard.type("look up");
    await expect(text).toContainText("[look up]");
  });

  test("New script opens an empty script in the editor, and Rename names it", async ({ page }) => {
    await openTeleprompter(page, "teleprompter-empty");
    await page.getByTestId("teleprompter-new-script").click();
    await expect(page.getByTestId("teleprompter-editor-text")).toHaveAttribute("contenteditable", "true");
    await expect(page.getByTestId("teleprompter-selected")).toContainText("New script");
    await page.getByTestId("teleprompter-editor-text").click();
    await page.keyboard.type("Good morning.");
    await expect(page.getByTestId("teleprompter-editor-saved")).toHaveAttribute("data-save", "saved");
    await expect(page.getByTestId("teleprompter-selected")).toContainText("2 words");
    await page.getByTestId("teleprompter-rename").click();
    const field = page.getByRole("dialog").getByRole("textbox");
    await field.fill("01 Morning");
    await page.getByRole("dialog").getByRole("button", { name: "Rename" }).click();
    await expect(page.getByTestId("teleprompter-selected")).toContainText("01 Morning");
    await expect(page.getByTestId("teleprompter-scripts")).toContainText("01 Morning");
  });

  test("Paste as a new script adds what the clipboard holds and selects it", async ({ page }) => {
    await openTeleprompter(page, "teleprompter-empty");
    await copyToClipboard(page, "<p><b>Evening news</b></p><p>Here it is.</p>", "Evening news\n\nHere it is.");
    await page.getByTestId("teleprompter-paste-script").click();
    await expect(page.getByTestId("teleprompter-selected")).toContainText("Evening news");
    await expect(page.getByTestId("teleprompter-selected")).toContainText("2 paragraphs");
  });

  test("a file opened again asks whether to update its script from it or add it as a new one", async ({ page }) => {
    await openTeleprompter(page, "teleprompter-empty");
    const file = (text: string) => ({ name: "Morning news.txt", mimeType: "text/plain", buffer: Buffer.from(text) });
    const input = page.getByTestId("teleprompter-file-input");
    await input.setInputFiles(file("Good morning.\n"));
    await expect(page.getByTestId("teleprompter-selected")).toContainText("Morning news");
    await input.setInputFiles(file("Good morning.\n\nHere is the news.\n"));
    await expect(page.getByTestId("teleprompter-reopen")).toContainText("Morning news came from this file");
    await page.getByTestId("teleprompter-reopen-update").click();
    await expect(page.getByTestId("teleprompter-selected")).toContainText("2 paragraphs");
    await expect(page.getByTestId("teleprompter-scripts").locator('[data-testid^="teleprompter-script-"]')).toHaveCount(
      1
    );
    await input.setInputFiles(file("Another.\n"));
    await page.getByTestId("teleprompter-reopen-add").click();
    await expect(page.getByTestId("teleprompter-scripts")).toContainText("Morning news");
    await expect(page.getByTestId("teleprompter-scripts").locator('[data-testid^="teleprompter-script-"]')).toHaveCount(
      2
    );
  });
});
