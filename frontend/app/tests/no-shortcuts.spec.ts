import { expect, test, type Page } from "@playwright/test";

import { expectWorkspaceMounted, openFixture } from "./helpers/openFixture";

// New pages program, Slice 3 (D6, the operator's of 2026-09-24): Studio
// Control binds no key of its own. Every key the program used to bind is
// pressed with nothing focused, and the screen must not move: the same page,
// no dialog, the same pressed keys, values, fields and focus. Plain keyboard
// operation (Tab, Enter or Space on a focused control, the arrows on a focused
// slider, Esc on a dialog or an armed key) is tested where it lives. The web
// view's own reload keys are switched off in the native shell (decision 12),
// which a browser page cannot show; Appendix B item 2 checks them on the
// workstation.

type ScreenState = Record<string, unknown>;

async function readScreenState(page: Page): Promise<ScreenState> {
  return page.evaluate(() => {
    const header = document.querySelector("header");
    const name = (element: Element) =>
      element.getAttribute("data-testid") ??
      element.getAttribute("aria-label") ??
      (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
    const attributes = (attribute: string) =>
      Array.from(document.querySelectorAll(`[${attribute}]`)).map(
        (element) => `${name(element)}=${element.getAttribute(attribute)}`
      );
    return {
      search: location.search,
      dialogs: document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')
        .length,
      tabs: Array.from(document.querySelectorAll('[role="tab"]')).map(
        (tab) => `${name(tab)}=${tab.getAttribute("aria-selected")}/${tab.getAttribute("aria-current")}`
      ),
      pressed: attributes("aria-pressed"),
      current: attributes("aria-current"),
      checked: attributes("aria-checked"),
      expanded: attributes("aria-expanded"),
      values: attributes("aria-valuenow"),
      fields: Array.from(document.querySelectorAll("input, textarea, select")).map(
        (field) => `${name(field)}=${(field as HTMLInputElement).value}`
      ),
      // Key words outside the header, whose clock and lamps move by themselves.
      keys: Array.from(document.querySelectorAll("button"))
        .filter((button) => !header?.contains(button))
        .map((button) => (button.textContent ?? "").replace(/\s+/g, " ").trim()),
      focus: document.activeElement === document.body ? "body" : name(document.activeElement!),
    };
  });
}

// Long enough for a key's request to reach the fixture double and its answer
// to be drawn; the proof that it is long enough is that this spec fails on the
// build before Slice 3 (the ledger's Slice 3 record).
async function settle(page: Page) {
  for (let round = 0; round < 3; round += 1) {
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0))))
    );
  }
  await page.waitForTimeout(150);
}

async function open(page: Page, fixture: string, workspace: "setup" | "lighting" | "audio") {
  await openFixture(page, fixture);
  await expectWorkspaceMounted(page, workspace);
  await settle(page);
  // Nothing is focused: a key goes to the page, not to a control.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

async function expectNoKeyGlyphs(page: Page, where: string) {
  const glyphs = await page.evaluate(() => ({
    kbd: document.querySelectorAll("kbd").length,
    ariaKeyshortcuts: document.querySelectorAll("[aria-keyshortcuts]").length,
    accesskey: document.querySelectorAll("[accesskey]").length,
  }));
  expect.soft(glyphs, `${where}: no key glyphs, aria-keyshortcuts or accesskey`).toEqual({
    kbd: 0,
    ariaKeyshortcuts: 0,
    accesskey: 0,
  });
}

// Presses each key on a freshly opened page and expects nothing to move. A
// key that moved something is named (a soft failure, so one run names them
// all) and the page is opened again for the next key.
async function expectKeysDoNothing(
  page: Page,
  fixture: string,
  workspace: "setup" | "lighting" | "audio",
  keys: readonly string[]
) {
  await open(page, fixture, workspace);
  for (const key of keys) {
    const before = await readScreenState(page);
    if (key.startsWith("hold:")) {
      const held = key.slice("hold:".length);
      await page.keyboard.down(held);
      await settle(page);
      const during = await readScreenState(page);
      await page.keyboard.up(held);
      expect.soft(during, `holding ${held} on ${fixture} must not move the screen`).toEqual(before);
    } else {
      await page.keyboard.press(key);
    }
    await settle(page);
    const after = await readScreenState(page);
    expect.soft(after, `${key} on ${fixture} must not move the screen`).toEqual(before);
    if (JSON.stringify(after) !== JSON.stringify(before)) await open(page, fixture, workspace);
  }
}

test.describe("No key does anything (new pages S3, D6)", () => {
  test("the Console: the page keys, the strip keys, the bank keys, the snapshot keys, talkback's T", async ({
    page,
  }) => {
    await open(page, "audio-selected-channel", "audio");
    await expectNoKeyGlyphs(page, "the Console");
    await expectKeysDoNothing(page, "audio-selected-channel", "audio", [
      "Control+1",
      "Control+2",
      "Control+k",
      "?",
      "Shift+S",
      "Control+Shift+R",
      "m",
      "s",
      "u",
      "2",
      "[",
      "]",
      "ArrowDown",
      "ArrowRight",
      "Escape",
      "Shift+1",
      "Control+s",
      "Alt+c",
      "Alt+s",
      "hold:t",
    ]);
  });

  test("Lighting: the page keys, the rig keys, the view keys, the arrows and Esc", async ({ page }) => {
    await open(page, "lighting-populated", "lighting");
    await expectNoKeyGlyphs(page, "Lighting");
    await expectKeysDoNothing(page, "lighting-populated", "lighting", [
      "Control+1",
      "Control+3",
      "Control+k",
      "?",
      "a",
      "p",
      "b",
      "s",
      "h",
      "Shift+H",
      "Shift+I",
      "t",
      "1",
      "Shift+1",
      "Control+Shift+1",
      "ArrowRight",
      "ArrowUp",
      "Control+a",
      "Control+f",
      "Control+z",
      "Control+Shift+P",
      "Control+Shift+M",
      "Control+Shift+S",
      "Escape",
    ]);
  });

  test("Setup: Support's key, the runner's Enter, the Map keys", async ({ page }) => {
    await open(page, "setup-ready", "setup");
    await expectNoKeyGlyphs(page, "Setup");
    await expectKeysDoNothing(page, "setup-ready", "setup", [
      "Control+2",
      "Control+3",
      "Control+k",
      "?",
      "a",
      "Shift+S",
      "Enter",
      "j",
      "k",
      "2",
    ]);
  });

  test("the startup and recovery screens show no key glyph", async ({ page }) => {
    for (const fixture of ["startup-loading", "bootstrap-failed"]) {
      await openFixture(page, fixture);
      await settle(page);
      await expectNoKeyGlyphs(page, fixture);
    }
  });
});
