import { expect, test, type Page } from "@playwright/test";

import { expectWorkspaceMounted } from "./helpers/openFixture";
import { pausePageClock } from "./helpers/pageClock";
import {
  expectLaidOut,
  openPageMenu,
  openPlateMenu,
  openRowMenu,
  openTeleprompter,
  PAST_THE_DWELL_MS,
  pressTwice,
  showRemoved,
} from "./helpers/teleprompter";

// New pages program, Slice 6a: the Teleprompter page against the fixture
// double (board 1, "Live mirror"; the proposal, docs/design/
// teleprompter.md). The double answers every prompter request as the hardware link
// does (Slices 4 and 5a); the page's copy of the glass reports its layout, so
// PLAY unlocks once the fonts are in.
//
// The visual overhaul (2026-10-05): every press twice runs on the page's
// clock (helpers/teleprompter.ts, `pressTwice`), and checks that the first
// press armed; the standing commands are the page's ⋯; Rename, Earlier
// versions and Remove are a script's menu; Removed is a view of the Scripts
// section's ⋯, and a removed script's menu holds Restore and Delete for good.

const state = (page: Page) => page.getByTestId("teleprompter-state-display");

test.describe("the Teleprompter page (new pages S6a)", () => {
  test("is the last tab, and shows the script on the glass with its place and time", async ({ page }) => {
    await openTeleprompter(page);
    // The skylight (D48): the four pages on their platter, then Setup / Support on the system's.
    const tabs = page.locator('[data-region="header"] [data-nav-id]');
    // The shell (overhaul 3): a tab carries its page's word, outside its name.
    await expect(tabs).toHaveCount(5);
    for (const [index, name] of ["Lighting", "Audio", "Cameras", "Teleprompter", "Setup / Support"].entries()) {
      await expect(tabs.nth(index)).toHaveAccessibleName(name);
    }
    await expect(page.getByTestId("teleprompter-state-display")).toContainText("ON SCREEN");
    // The polish (2026-10-05): the page's own sentences keep the display's two lines.
    await expect(page.getByTestId("teleprompter-state-display")).toContainText(
      "02 Interview intro is on the glass. Paused at paragraph 8"
    );
    await expect(page.getByTestId("teleprompter-on-glass")).toHaveText("02 Interview intro");
    await expect(page.getByTestId("teleprompter-place")).toContainText("¶ 8 of");
    await expect(page.getByTestId("teleprompter-copy")).toHaveAttribute("data-picture", "prompter-glass");
    // The header: the Prompter lamp before the deck's, which is called Surface
    // (D19). The shell (overhaul 3): the prompter's lamp is the Teleprompter
    // tab's word, which the open page's tab does not repeat.
    await expect(page.getByTestId("shell-lamp-prompter")).toHaveCount(0);
    await expect(page.getByTestId("shell-lamp-surface")).toContainText("Surface");
  });

  // The shell (overhaul 3): while the prompter scrolls, the Teleprompter
  // tab says `playing` and the time left on every other page, and the tab
  // opens it. Old: a green latch of its own beside the lamps.
  test("PLAY scrolls and the Teleprompter tab says playing on every page, and opens it", async ({ page }) => {
    await openTeleprompter(page);
    await expectLaidOut(page);
    await page.getByTestId("teleprompter-play").click();
    await expect(page.getByTestId("teleprompter-play")).toHaveAttribute("aria-pressed", "true");
    const word = page.getByTestId("shell-lamp-prompter");
    await expect(word).toHaveCount(0);
    await expect(page.getByTestId("shell-lamp-latched-prompter-playing")).toHaveCount(0);

    await page.getByRole("button", { name: "Audio", exact: true }).click();
    await expectWorkspaceMounted(page, "audio");
    await expect(word).toContainText("playing");
    await expect(word).toContainText("left");
    await expect(word).toHaveAttribute("data-tone", "ok");
    await page.getByRole("button", { name: "Teleprompter", exact: true }).click();
    await expectWorkspaceMounted(page, "teleprompter");

    await page.getByTestId("teleprompter-play").click();
    await expect(page.getByTestId("teleprompter-play")).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: "Audio", exact: true }).click();
    await expectWorkspaceMounted(page, "audio");
    await expect(word).not.toContainText("playing");
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
    await page.clock.install();
    await openTeleprompter(page);
    await expectLaidOut(page);
    await page.getByTestId("teleprompter-scripts").getByText("04 Outro").click();
    await expect(page.getByTestId("teleprompter-selected")).toContainText("04 Outro");

    const replace = page.getByTestId("teleprompter-replace");
    await pausePageClock(page);
    await replace.click();
    await expect(replace).toHaveAttribute("data-armed", "true");
    await expect(state(page)).toContainText("Replace with 04 Outro · press again");
    await expect(page.getByTestId("teleprompter-on-glass")).toHaveText("02 Interview intro");
    await page.clock.fastForward(PAST_THE_DWELL_MS);
    await replace.click();
    await page.clock.resume();
    await expect(page.getByTestId("teleprompter-on-glass")).toHaveText("04 Outro");

    const clear = page.getByTestId("teleprompter-clear");
    await pausePageClock(page);
    await clear.click();
    await expect(clear).toHaveAttribute("data-armed", "true");
    await expect(state(page)).toContainText("Clear the prompter · press again");
    await expect(page.getByTestId("teleprompter-on-glass")).toHaveText("04 Outro");
    await page.clock.fastForward(PAST_THE_DWELL_MS);
    await clear.click();
    await page.clock.resume();
    await expect(page.getByTestId("teleprompter-nothing-on")).toHaveText("Nothing on the prompter");
    await expect(state(page)).toContainText("READY");
    await expect(page.getByTestId("teleprompter-play")).toHaveAttribute("data-locked", "");
  });

  test("with nothing on the prompter, Put on is one press", async ({ page }) => {
    await page.clock.install();
    await openTeleprompter(page);
    await expectLaidOut(page);
    await pressTwice(page, page.getByTestId("teleprompter-clear"));
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
    // The polish (2026-10-05): the strip says what is on the prompter, which
    // stays true; the plate says Not on the glass too, and no green lamp says
    // the script is on it while nothing is drawn.
    await expect(page.getByTestId("teleprompter-glass-strip")).toContainText("On the prompter");
    await expect(page.getByTestId("teleprompter-on-glass")).toHaveText("02 Interview intro");
    await expect(page.getByTestId("teleprompter-on-prompter")).toContainText("Not on the glass");
    await expect(page.getByTestId("teleprompter-plate").locator('[data-lamp="ok"]')).toHaveCount(0);
    await expect(
      page.locator('[data-testid^="teleprompter-script-"]', { hasText: "02 Interview intro" }).locator("[data-tone]")
    ).toHaveAttribute("data-tone", "off");
    // Jumps still work: the place they set is where the prompter comes back.
    await page.getByTestId("teleprompter-top").click();
    await expect(page.getByTestId("teleprompter-place")).toContainText("¶ 1 of");
  });

  // Flaky in a full gate on 2026-10-05 with real-time waits between the
  // presses; on the page's clock since the visual overhaul.
  test("NOT UPDATED offers Update · press twice, and Update clears it", async ({ page }) => {
    await page.clock.install();
    await openTeleprompter(page, "teleprompter-not-updated");
    await expect(state(page)).toContainText("NOT UPDATED");
    await expect(page.getByTestId("teleprompter-state-update")).toHaveText("Update the prompter · press twice");
    await expectLaidOut(page);
    await pressTwice(page, page.getByTestId("teleprompter-state-update"));
    await expect(state(page)).toContainText("ON SCREEN");
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

  // The visual overhaul (2026-10-05): Removed is a view the Scripts section's
  // ⋯ switches to, and Restore is a removed script's menu's item.
  test("Removed lists what was removed, and Restore brings a script back", async ({ page }) => {
    await openTeleprompter(page);
    await showRemoved(page, true);
    const removed = page.getByTestId("teleprompter-scripts");
    await expect(removed).toContainText("Removed");
    await expect(removed).toContainText("Draft intro");
    const menu = await openRowMenu(page, "Draft intro");
    await menu.getByRole("menuitem", { name: /Restore/ }).click();
    await expect(removed).not.toContainText("Draft intro");
    await showRemoved(page, false);
    await expect(page.getByTestId("teleprompter-scripts")).toContainText("Scripts");
    await expect(page.getByTestId("teleprompter-scripts")).toContainText("Draft intro");
  });

  test("Setup / Support's Workstation names the Prompter XL as Windows reports it", async ({ page }) => {
    await openTeleprompter(page);
    await page.getByRole("button", { name: "Setup / Support", exact: true }).click();
    await expectWorkspaceMounted(page, "setup");
    // The visual overhaul (2026-10-05): the link's word in its capitals.
    await expect(page.getByTestId("support-prompter-xl")).toContainText("CONNECTED · 1920×1080 · 60 Hz");
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
    await page.clock.install();
    await openEditor(page);
    await expect(page.getByTestId("teleprompter-edit-note")).toContainText("the glass keeps its text");
    const line = await caretInReadingLine(page);
    await page.keyboard.type(" Typed here.");
    await expect(line).toContainText("Typed here.");
    await expect(page.getByTestId("teleprompter-editor-saved")).toHaveAttribute("data-save", "saved");
    await expect(page.getByTestId("teleprompter-state-display")).toContainText("NOT UPDATED");
    await expect(page.getByTestId("teleprompter-edited-list")).toHaveText("¶ 8");
    await pressTwice(page, page.getByTestId("teleprompter-state-update"));
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
    await (await openPageMenu(page)).getByTestId("teleprompter-new-script").click();
    await expect(page.getByTestId("teleprompter-editor-text")).toHaveAttribute("contenteditable", "true");
    await expect(page.getByTestId("teleprompter-selected")).toContainText("New script");
    await page.getByTestId("teleprompter-editor-text").click();
    await page.keyboard.type("Good morning.");
    await expect(page.getByTestId("teleprompter-editor-saved")).toHaveAttribute("data-save", "saved");
    await expect(page.getByTestId("teleprompter-selected")).toContainText("2 words");
    await (await openPlateMenu(page)).getByTestId("teleprompter-rename").click();
    const field = page.getByRole("dialog").getByRole("textbox");
    await field.fill("01 Morning");
    await page.getByRole("dialog").getByRole("button", { name: "Rename" }).click();
    await expect(page.getByTestId("teleprompter-selected")).toContainText("01 Morning");
    await expect(page.getByTestId("teleprompter-scripts")).toContainText("01 Morning");
  });

  test("Paste as a new script adds what the clipboard holds and selects it", async ({ page }) => {
    await openTeleprompter(page, "teleprompter-empty");
    await copyToClipboard(page, "<p><b>Evening news</b></p><p>Here it is.</p>", "Evening news\n\nHere it is.");
    await (await openPageMenu(page)).getByTestId("teleprompter-paste-script").click();
    await expect(page.getByTestId("teleprompter-selected")).toContainText("Evening news");
    await expect(page.getByTestId("teleprompter-selected")).toContainText("2 paragraphs");
  });

  // Slice 6b's review: a text the hardware link will not save (here, over a
  // script's 30,000 words after two pastes) keeps the editor open on it:
  // another script, New script and Live copy wait, with the refusal said.
  test("a text that cannot be saved keeps the editor open on it, and the page does not move on", async ({ page }) => {
    await openEditor(page);
    const text = page.getByTestId("teleprompter-editor-text");
    await caretInReadingLine(page);
    const words = "word ".repeat(16_000);
    await copyToClipboard(page, `<p>${words}</p>`, words);
    await page.keyboard.press("Control+v");
    await expect(page.getByTestId("teleprompter-editor-saved")).toHaveAttribute("data-save", "saved");
    await page.keyboard.press("Control+v");
    await expect(page.getByTestId("teleprompter-editor-saved")).toHaveAttribute("data-save", "unsaved");
    await page.keyboard.type(" MARKER");
    const scripts = page.getByTestId("teleprompter-scripts").locator('[data-testid^="teleprompter-script-"]');
    const count = await scripts.count();
    await scripts.filter({ hasText: "01 Welcome" }).click();
    await expect(page.getByTestId("teleprompter-selected")).toContainText("02 Interview intro");
    await (await openPageMenu(page)).getByTestId("teleprompter-new-script").click();
    await page.getByTestId("teleprompter-bay-live").click();
    await expect(text).toContainText("MARKER");
    await expect(page.getByTestId("teleprompter-editor-saved")).toHaveAttribute("data-save", "unsaved");
    await expect(scripts).toHaveCount(count);
    await expect(page.getByTestId("teleprompter-selected")).toContainText("02 Interview intro");
    await expect(page.getByText("The script would have", { exact: false }).first()).toBeVisible();
  });

  // Slice 6b's review: a rename moves the script's time of change, but not its
  // text, so the editor stays as it is, its undo with it.
  test("Rename keeps the editor's text and its undo", async ({ page }) => {
    await openEditor(page);
    const line = await caretInReadingLine(page);
    await page.keyboard.type(" Kept");
    await expect(page.getByTestId("teleprompter-editor-saved")).toHaveAttribute("data-save", "saved");
    await (await openPlateMenu(page)).getByTestId("teleprompter-rename").click();
    await page.getByRole("dialog").getByRole("textbox").fill("02 Interview opening");
    await page.getByRole("dialog").getByRole("button", { name: "Rename" }).click();
    await expect(page.getByTestId("teleprompter-selected")).toContainText("02 Interview opening");
    await expect(line).toContainText("Kept");
    await expect(page.getByTestId("teleprompter-editor-undo")).not.toHaveAttribute("data-locked", "");
    await page.getByTestId("teleprompter-editor-undo").click();
    await expect(line).not.toContainText("Kept");
  });

  // Slice 6b's review: a paragraph removed from the script on the prompter is
  // counted, and the reading line says its paragraph is gone.
  test("a paragraph removed from the script on the prompter is counted, the reading line's too", async ({ page }) => {
    await openEditor(page);
    await caretInReadingLine(page);
    // Select from the end of the paragraph before the reading line's to the end of that one, and delete.
    await page.evaluate(() => {
      const line = document.querySelector('[data-testid="teleprompter-editor-text"] p[data-mark="reading line"]')!;
      const before = line.previousElementSibling!;
      const range = document.createRange();
      range.setStart(before, before.childNodes.length);
      range.setEnd(line, line.childNodes.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await page.keyboard.press("Backspace");
    await expect(page.getByTestId("teleprompter-edited-list")).toHaveText("1 removed");
    await expect(page.getByTestId("teleprompter-edited-reading-line")).toHaveText("removed");
    await expect(page.getByTestId("teleprompter-editor-text").locator('p[data-mark="reading line"]')).toHaveCount(0);
  });

  test("the bar's Paste and Add cue ask for the caret in the text first", async ({ page }) => {
    await openEditor(page);
    await copyToClipboard(page, "<p>Nowhere</p>", "Nowhere");
    await page.getByTestId("teleprompter-editor-paste").click();
    await expect(page.getByText("Click in the text where it goes first.").first()).toBeVisible();
    await expect(page.getByTestId("teleprompter-editor-text")).not.toContainText("Nowhere");
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

// The visual overhaul (2026-10-05): every take-time key in one fixed home,
// the size beside the speed; the room the page has, pinned (nothing scrolls,
// no line is cut, an armed key keeps its height); one menu per script, whose
// Replace hands off to the plate's key; Delete for good armed in place; the
// look and the Prompter XL's readouts in popovers that give the focus back.
test.describe("the Teleprompter page, the visual overhaul", () => {
  test("the size stands beside the speed and works with nothing on the prompter; the take's keys are take-time", async ({
    page,
  }) => {
    await openTeleprompter(page, "teleprompter-empty");
    await expect(page.getByTestId("teleprompter-speed-down")).toHaveAttribute("data-locked", "");
    await expect(page.getByTestId("teleprompter-speed-readout")).toHaveText("—");
    const size = page.getByTestId("teleprompter-text-size");
    await expect(size).toHaveText("88 px standard");
    await expect(page.getByTestId("teleprompter-size-standard")).toHaveAttribute("data-locked", "");
    await page.getByTestId("teleprompter-size-up").click();
    await expect(size).toHaveText("92 px standard 88");
    await page.getByTestId("teleprompter-size-standard").click();
    await expect(size).toHaveText("88 px standard");
    // READY with no script: the way out is Open file….
    await expect(page.getByTestId("teleprompter-state-open-file")).toHaveText("Open file…");
    // The polish (2026-10-05): a locked TOP says nothing under its cap, as BACK.
    await expect(page.getByTestId("teleprompter-top")).toHaveText("Top");

    await openTeleprompter(page);
    await expect(page.getByTestId("teleprompter-top")).toContainText("pauses · to ¶ 1");
    for (const id of [
      "teleprompter-play",
      "teleprompter-back",
      "teleprompter-top",
      "teleprompter-speed-down",
      "teleprompter-speed-up",
      "teleprompter-size-down",
      "teleprompter-size-up",
      "teleprompter-size-standard",
      "teleprompter-line-back",
      "teleprompter-paragraph-on",
      "teleprompter-cue-on",
      "teleprompter-clear",
      "teleprompter-script-bar",
      "teleprompter-go-to-key",
    ]) {
      await expect(page.getByTestId(id), id).toHaveAttribute("data-take", "");
    }
    const rows = page.getByTestId("teleprompter-paragraphs").locator("button");
    await expect(rows.first()).toHaveAttribute("data-take", "");
    expect(await rows.evaluateAll((buttons) => buttons.every((button) => button.hasAttribute("data-take")))).toBe(true);
    // − 5, + 5, − 4 and + 4 are labels: a value is never in the display face.
    // The face of each element that draws a figure inside the key (the
    // review of pull request 7: the key's own face says nothing of its cap).
    for (const id of [
      "teleprompter-speed-down",
      "teleprompter-speed-up",
      "teleprompter-size-down",
      "teleprompter-size-up",
    ]) {
      const faces = await page
        .getByTestId(id)
        .evaluate((key) =>
          [key, ...key.querySelectorAll("*")]
            .filter((element) =>
              [...element.childNodes].some(
                (node) => node.nodeType === Node.TEXT_NODE && /\d/.test(node.textContent ?? "")
              )
            )
            .map((element) => getComputedStyle(element).fontFamily)
        );
      expect(faces.length, id).toBeGreaterThan(0);
      for (const face of faces) expect(face, id).not.toContain("Adelia");
    }
  });

  test("nothing scrolls, no line is cut, and the paragraph list's 16 rows end above Clear", async ({ page }) => {
    for (const fixture of [
      "teleprompter-ready",
      "teleprompter-not-updated",
      "teleprompter-not-connected",
      "teleprompter-empty",
    ]) {
      await openTeleprompter(page, fixture);
      const sizes = await page.evaluate(() => {
        const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect() ?? null;
        const inside = (selector: string) => {
          const element = document.querySelector(selector)!;
          return element.scrollHeight <= element.clientHeight + 1;
        };
        const cluster = document.querySelector<HTMLElement>("[data-testid=teleprompter-cluster]")!;
        const clusterBottom =
          cluster.getBoundingClientRect().bottom - parseFloat(getComputedStyle(cluster).paddingBottom);
        const rows = [...document.querySelectorAll("[data-testid=teleprompter-paragraphs] li")];
        // Every text the page cuts with an ellipsis, but a paragraph's own
        // words in the list, which are cut by design (a paragraph is long).
        const cut = [
          ...document.querySelectorAll<HTMLElement>(
            "[data-region=cluster] *, [data-region=bay] *, [data-region=plate] *, [data-region=footer] *"
          ),
        ]
          .filter((element) => !element.closest("[data-paragraph-text], [data-picture]"))
          .filter((element) => getComputedStyle(element).textOverflow === "ellipsis")
          .filter((element) => element.scrollWidth > element.clientWidth)
          .map((element) => element.textContent);
        return {
          page: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
          copy: box("[data-testid=teleprompter-copy]"),
          cluster: inside("[data-testid=teleprompter-cluster]"),
          plate: inside("[data-testid=teleprompter-plate]"),
          rows: rows.length,
          lastRowBottom: rows.length > 0 ? rows[rows.length - 1]!.getBoundingClientRect().bottom : null,
          clearTop: box("[data-testid=teleprompter-clear]")!.top,
          clearBottom: box("[data-testid=teleprompter-clear]")!.bottom,
          clusterBottom,
          cut,
        };
      });
      expect(sizes.page, fixture).toEqual([2560, 1440]);
      expect(sizes.cluster, `${fixture}: the cluster holds everything it shows`).toBe(true);
      expect(sizes.plate, `${fixture}: the plate holds everything it shows`).toBe(true);
      expect(sizes.cut, `${fixture}: no line is cut`).toEqual([]);
      expect(sizes.clearBottom, `${fixture}: Clear stands inside the cluster`).toBeLessThanOrEqual(sizes.clusterBottom);
      if (fixture === "teleprompter-empty") continue;
      expect([sizes.copy!.width, sizes.copy!.height], `${fixture}: the copy is 1680 × 945`).toEqual([1680, 945]);
      expect(sizes.rows, `${fixture}: 16 of the 18 paragraphs`).toBe(16);
      expect(sizes.lastRowBottom!, `${fixture}: the last row ends above Clear`).toBeLessThanOrEqual(
        sizes.clearTop - 16
      );
    }
  });

  // The polish (2026-10-05): the cue keys, the Go to paragraph field and Go
  // are one row at one height, on one centre line.
  test("the cue keys, the Go to paragraph field and Go stand in one 36 px row", async ({ page }) => {
    await openTeleprompter(page);
    const box = async (id: string) => (await page.getByTestId(id).boundingBox())!;
    const cue = await box("teleprompter-cue-1");
    const go = await box("teleprompter-go-to-key");
    const field = await box("teleprompter-go-to-field");
    expect(Math.round(cue.height), "a cue key is 36 px").toBe(36);
    expect(Math.round(go.height), "Go is 36 px").toBe(36);
    expect(Math.abs(cue.y - go.y), "the first cue key and Go share a top").toBeLessThanOrEqual(1);
    expect(
      Math.abs(field.y + field.height / 2 - (go.y + go.height / 2)),
      "the field and Go share a centre line"
    ).toBeLessThanOrEqual(1);
  });

  test("an armed Clear keeps its height, and moves nothing above it", async ({ page }) => {
    await page.clock.install();
    await openTeleprompter(page);
    await expectLaidOut(page);
    const clear = page.getByTestId("teleprompter-clear");
    const lastRow = page.getByTestId("teleprompter-paragraphs").locator("li").last();
    const before = await clear.boundingBox();
    const rowBefore = await lastRow.boundingBox();
    await pausePageClock(page);
    await clear.click();
    await expect(clear).toHaveAttribute("data-armed", "true");
    await expect(clear).toContainText("press again");
    await expect(clear).toContainText("Clear the prompter");
    expect(await clear.boundingBox()).toEqual(before);
    expect(await lastRow.boundingBox()).toEqual(rowBefore);
    await page.keyboard.press("Escape");
    await expect(clear).toHaveAttribute("data-armed", "false");
    await expect(state(page)).not.toContainText("press again");
    await page.clock.resume();
  });

  test("NOT UPDATED: one Update on screen, the state display's, armed in place inside the display", async ({
    page,
  }) => {
    await page.clock.install();
    await openTeleprompter(page, "teleprompter-not-updated");
    await expectLaidOut(page);
    // The plate says it, and leaves the key to the state display.
    await expect(page.getByTestId("teleprompter-update")).toHaveCount(0);
    await expect(page.getByTestId("teleprompter-on-prompter")).toContainText("Not updated");
    const update = page.getByTestId("teleprompter-state-update");
    const display = state(page);
    const before = (await update.boundingBox())!;
    await pausePageClock(page);
    await update.click();
    await expect(update).toHaveAttribute("data-armed", "true");
    await expect(update).toContainText("press again");
    await expect(update).toContainText("Update the prompter");
    const armed = (await update.boundingBox())!;
    const outer = (await display.boundingBox())!;
    expect(armed.height, "the armed key keeps its height").toBe(before.height);
    expect(armed.y, "and its place").toBe(before.y);
    expect(armed.y + armed.height).toBeLessThanOrEqual(outer.y + outer.height);
    await page.clock.fastForward(PAST_THE_DWELL_MS);
    await update.click();
    await page.clock.resume();
    await expect(display).toContainText("ON SCREEN");
    await expect(page.getByTestId("teleprompter-on-prompter")).toContainText("On prompter");
  });

  test("a script's ⋯ and a right-click on its row open the same menu, and the plate title's ⋯ the selected one's", async ({
    page,
  }) => {
    await openTeleprompter(page);
    const fromKey = await openRowMenu(page, "04 Outro");
    await expect(fromKey).toHaveAccessibleName("04 Outro");
    // The polish (2026-10-05): the pace carries its unit; the words are the plate head's.
    await expect(fromKey).toHaveAccessibleDescription("1:13 at 140 words/min");
    const words = await fromKey.getByRole("menuitem").allTextContents();
    expect(words.map((word) => word.trim())).toEqual([
      "Select",
      "Replace on the prompter…on the plate",
      "Edit script",
      "Rename…",
      "Earlier versions…",
      "Removeto Removed",
    ]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);

    await page.locator('[data-testid^="teleprompter-script-"]', { hasText: "04 Outro" }).click({ button: "right" });
    const fromRow = page.getByRole("menu").last();
    await expect(fromRow).toHaveAccessibleName("04 Outro");
    expect(await fromRow.getByRole("menuitem").allTextContents()).toEqual(words);
    await page.keyboard.press("Escape");

    // The script on the prompter: Remove is locked, and says why.
    const onPrompter = await openPlateMenu(page);
    await expect(onPrompter).toHaveAccessibleName("02 Interview intro");
    await expect(onPrompter.getByTestId("teleprompter-remove")).toHaveAttribute("aria-disabled", "true");
    await expect(onPrompter.getByTestId("teleprompter-remove")).toContainText("on the prompter · clear it first");
    await expect(onPrompter.getByTestId("teleprompter-rename")).toBeVisible();
  });

  // The review of pull request 6 found a hand-off that waited for later reads
  // and could arm without a press. Here the hand-off arms once, from what the
  // page holds right after its own selection, and never presses again.
  test("Replace from another script's menu selects it and arms the plate's key, which takes the second press", async ({
    page,
  }) => {
    await page.clock.install();
    await openTeleprompter(page);
    await expectLaidOut(page);
    const menu = await openRowMenu(page, "04 Outro");
    await pausePageClock(page);
    await menu.locator('[data-testid$="-replace"]').click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(page.getByTestId("teleprompter-selected")).toContainText("04 Outro");
    const key = page.getByTestId("teleprompter-replace");
    await expect(key).toHaveAttribute("data-armed", "true");
    await expect(state(page)).toContainText("Replace with 04 Outro · press again");
    await expect(page.getByTestId("teleprompter-on-glass")).toHaveText("02 Interview intro");
    // The menu's Replace again, past the dwell, leaves the arm as it is: a
    // menu never gives the second press.
    await page.clock.fastForward(PAST_THE_DWELL_MS);
    await (await openRowMenu(page, "04 Outro")).locator('[data-testid$="-replace"]').click();
    await expect(key).toHaveAttribute("data-armed", "true");
    await expect(page.getByTestId("teleprompter-on-glass")).toHaveText("02 Interview intro");
    await key.click();
    await page.clock.resume();
    await expect(page.getByTestId("teleprompter-on-glass")).toHaveText("04 Outro");
  });

  test("a hand-off arms once: the script selected again by hand later arms nothing", async ({ page }) => {
    await openTeleprompter(page);
    const menu = await openRowMenu(page, "04 Outro");
    await menu.locator('[data-testid$="-replace"]').click();
    const key = page.getByTestId("teleprompter-replace");
    await expect(key).toHaveAttribute("data-armed", "true");
    await page.keyboard.press("Escape");
    await expect(key).toHaveAttribute("data-armed", "false");
    await page.getByTestId("teleprompter-scripts").getByText("01 Welcome").click();
    await expect(page.getByTestId("teleprompter-selected")).toContainText("01 Welcome");
    await page.getByTestId("teleprompter-scripts").getByText("04 Outro").click();
    await expect(page.getByTestId("teleprompter-selected")).toContainText("04 Outro");
    await page.waitForTimeout(1_200);
    await expect(key).toHaveAttribute("data-armed", "false");
    await expect(state(page)).not.toContainText("press again");
  });

  test("Delete for good is a removed script's last item: it arms in place, says it cannot be undone, and deletes at the second press", async ({
    page,
  }) => {
    await page.clock.install();
    await openTeleprompter(page);
    await expectLaidOut(page);
    await showRemoved(page, true);
    const menu = await openRowMenu(page, "Draft intro");
    await expect(menu).toHaveAccessibleDescription("Removed · a delete for good cannot be undone");
    const remove = menu.getByRole("menuitem").and(menu.locator('[data-testid^="teleprompter-delete-"]'));
    await expect(remove).toHaveText("Delete for good…");
    await pausePageClock(page);
    await remove.click();
    await expect(remove).toHaveAttribute("data-armed", "true");
    await expect(remove).toContainText("Press again to delete Draft intro for good");
    await expect(menu).toBeVisible();
    await expect(state(page)).toContainText("Delete Draft intro for good · press again");
    await page.clock.fastForward(PAST_THE_DWELL_MS);
    await remove.click();
    await page.clock.resume();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(page.getByTestId("teleprompter-scripts")).not.toContainText("Draft intro");
    await expect(page.getByTestId("teleprompter-scripts")).toContainText("Old outro");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("the page's ⋯ holds Open file…, Paste as a new script and New script", async ({ page }) => {
    await openTeleprompter(page);
    await expect(page.getByTestId("teleprompter-open-file")).toHaveCount(0);
    const menu = await openPageMenu(page);
    const chooser = page.waitForEvent("filechooser");
    await menu.getByTestId("teleprompter-open-file").click();
    expect((await chooser).isMultiple()).toBe(false);
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect((await openPageMenu(page)).getByTestId("teleprompter-new-script")).toHaveText("New script");
  });

  test("the look opens beside its section: its choices are the selection, and Esc gives the focus back to Change…", async ({
    page,
  }) => {
    await openTeleprompter(page);
    const open = page.getByTestId("teleprompter-look-open");
    await open.click();
    const popover = page.getByTestId("teleprompter-look-popover");
    await expect(popover).toBeVisible();
    await expect(popover).not.toHaveAttribute("role", "dialog");
    // Beside its section, over the bay: the plate stays in view.
    const beside = (await popover.boundingBox())!;
    const section = (await page.getByTestId("teleprompter-look").boundingBox())!;
    expect(beside.x + beside.width).toBeLessThanOrEqual(section.x);
    await expect(popover.getByTestId("teleprompter-colour-white")).toHaveAttribute("data-selected", "");
    await expect(popover.getByTestId("teleprompter-colour-white")).not.toHaveAttribute("data-engaged", "");
    await expect(popover.getByTestId("teleprompter-dim-read-on")).toHaveAttribute("data-selected", "");
    await popover.getByTestId("teleprompter-line-across-on").click();
    await expect(popover.getByTestId("teleprompter-line-across-on")).toHaveAttribute("data-selected", "");
    await expect(page.getByTestId("teleprompter-look-values")).toContainText("A line across at the reading lineon");
    await page.keyboard.press("Escape");
    await expect(popover).toHaveCount(0);
    await expect(open).toBeFocused();
  });

  test("a look slider sends its value when let go, and the reads while the text plays never take it from the hand", async ({
    page,
  }) => {
    await openTeleprompter(page);
    await expectLaidOut(page);
    await page.getByTestId("teleprompter-play").click();
    await expect(page.getByTestId("teleprompter-play")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("teleprompter-look-open").click();
    const slider = page
      .getByTestId("teleprompter-look-popover")
      .getByTestId("teleprompter-margins")
      .getByRole("slider");
    const values = page.getByTestId("teleprompter-look-values");
    await expect(values).toContainText("Margins, each side12 %");
    const box = (await slider.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2, { steps: 5 });
    // Two of the page's reads pass with the hand on the slider.
    await page.waitForTimeout(2_200);
    await expect(values).toContainText("Margins, each side12 %");
    await page.mouse.up();
    await expect(values).not.toContainText("Margins, each side12 %");
    await expect(page.getByTestId("teleprompter-look-popover")).toBeVisible();
    await page.getByTestId("teleprompter-play").click();
  });

  test("the Prompter XL's readouts open from the footer's key, and Esc gives the focus back to it", async ({
    page,
  }) => {
    await openTeleprompter(page);
    // The polish (2026-10-05): the footer keeps only the Prompter XL's mode;
    // the strip and the speed dial hold the rest.
    const footer = page.getByTestId("teleprompter-footer");
    await expect(footer).toContainText("1920×1080 · 60 Hz");
    await expect(footer).not.toContainText("02 Interview intro");
    const open = page.getByTestId("teleprompter-screen-open");
    await open.click();
    const popover = page.getByTestId("teleprompter-screen-popover");
    await expect(popover).toBeVisible();
    await expect(popover.getByTestId("teleprompter-screen-readouts")).toContainText("CONNECTED");
    await expect(popover.getByTestId("teleprompter-screen-readouts")).toContainText("1920×1080");
    await page.keyboard.press("Escape");
    await expect(popover).toHaveCount(0);
    await expect(open).toBeFocused();
  });

  test("earlier versions open beside the title from the script's menu, and the focus goes back to its ⋯", async ({
    page,
  }) => {
    await openTeleprompter(page);
    await (await openPlateMenu(page)).getByTestId("teleprompter-versions").click();
    const popover = page.getByTestId("teleprompter-versions-popover");
    await expect(popover).toBeVisible();
    await expect(popover).toContainText("Earlier versions of 02 Interview intro");
    await expect(popover.locator('[data-testid^="teleprompter-bring-back-"]').first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(popover).toHaveCount(0);
    await expect(page.getByTestId("teleprompter-plate-menu")).toBeFocused();
  });

  // The review of pull request 7: another script's versions open once that
  // script is selected, a Bring back keeps the focus in the popover (so Esc
  // still closes it), and a press on the ⋯ that opened it closes it.
  test("another script's versions open once it is selected; Bring back keeps Esc in reach; its ⋯ closes them", async ({
    page,
  }) => {
    await openTeleprompter(page);
    await (await openRowMenu(page, "04 Outro")).locator('[data-testid$="-versions"]').click();
    const popover = page.getByTestId("teleprompter-versions-popover");
    await expect(popover).toContainText("Earlier versions of 04 Outro");
    await expect(page.getByTestId("teleprompter-selected")).toContainText("04 Outro");
    await page.keyboard.press("Escape");
    await expect(popover).toHaveCount(0);

    await page.getByTestId("teleprompter-scripts").getByText("02 Interview intro").click();
    await (await openPlateMenu(page)).getByTestId("teleprompter-versions").click();
    await expect(popover).toContainText("Earlier versions of 02 Interview intro");
    const rows = popover.locator('[data-testid^="teleprompter-bring-back-"]');
    // The oldest version: its text differs from what is on the glass.
    await rows.last().click();
    await expect(state(page)).toContainText("NOT UPDATED");
    await expect(popover).toBeVisible();
    // The list is read again; the focus stays inside the popover, never on the body.
    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean(
            document.querySelector("[data-testid=teleprompter-versions-popover]")?.contains(document.activeElement)
          )
        )
      )
      .toBe(true);
    await page.keyboard.press("Escape");
    await expect(popover).toHaveCount(0);

    await (await openPlateMenu(page)).getByTestId("teleprompter-versions").click();
    await expect(popover).toBeVisible();
    await page.getByTestId("teleprompter-plate-menu").click();
    await expect(popover).toHaveCount(0);
    await expect(page.getByRole("menu")).toBeVisible();
  });
});
