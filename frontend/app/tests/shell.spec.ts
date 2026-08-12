import { expect, test } from "@playwright/test";

import { modifierShortcut } from "./helpers/modifier-shortcut";
import { openFixture } from "./helpers/openFixture";

// plan PR 4 / workstream D4: shell-level specs split out of
// operator-shell.spec.ts. Covers shell-wide keyboard overlays + workspace
// switching shortcuts that aren't tied to any single workspace.

test("supports shell keyboard overlays and workspace switching", async ({ page }) => {
  await openFixture(page, "setup-required");

  await page.keyboard.press("Shift+/");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeHidden();

  await page.keyboard.press("Shift+S");
  await expect(page.getByRole("heading", { name: "Backup and recovery" })).toBeVisible();
  await page.keyboard.press("Shift+S");
  await expect(page.getByRole("heading", { name: "Import the Companion profile" })).toBeVisible();

  await page.keyboard.press("Tab");
  await expect(page.getByRole("heading", { name: "Probe hardware" })).toBeVisible();

  await page.keyboard.press("Tab");
  await expect(page.getByRole("heading", { name: "Map bindings" })).toBeVisible();
  await expect(page.getByText("Project 1").last()).toBeVisible();

  await page.keyboard.press("Digit2");
  await expect(page.getByText("Task 1").last()).toBeVisible();

  await page.keyboard.press("KeyK");
  await expect(page.getByText("Task 2").last()).toBeVisible();

  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("heading", { name: "Probe hardware" })).toBeVisible();

  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("heading", { name: "Import the Companion profile" })).toBeVisible();

  await page.keyboard.press(modifierShortcut("Shift+KeyR"));
  await expect(page.getByRole("dialog", { name: "Restart engine bridge?" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Restart engine bridge?" })).toBeHidden();

  await page.keyboard.press(modifierShortcut("Digit2"));
  await expect(page.getByRole("heading", { name: "Import the Companion profile" })).toBeVisible();
});

// R2-A (round-2 audit, R2-GLO-01): the palette is a modal — Tab must never
// walk focus out to the page behind it, Escape must close it from wherever
// focus sits, and focus must return to the invoker on close. The pre-fix
// palette failed all three (probe transcript in
// docs/archive/program-ux-audit-round-2-2026-06-10.md).
test("command palette traps focus, closes on Escape from anywhere, and restores focus", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  // Park focus on a known invoker first so restore is observable.
  const lightingTab = page.getByRole("button", { name: "Lighting", exact: true });
  await lightingTab.focus();

  await page.keyboard.press(modifierShortcut("KeyK"));
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();

  // Tab repeatedly: focus must stay inside the dialog every step.
  for (let i = 0; i < 5; i += 1) {
    await page.keyboard.press("Tab");
    const inDialog = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
    expect(inDialog, `focus must stay inside the palette after Tab #${i + 1}`).toBe(true);
  }

  // Escape closes — even though focus has been tabbed around.
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();

  // Focus returns to the invoker.
  await expect(lightingTab).toBeFocused();
});

// R2-A (R2-GLO-02): single-modal posture — opening the palette dismisses the
// shortcut guide instead of stacking two live modals.
test("opening the palette dismisses the shortcut guide", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  await page.keyboard.press("Shift+/");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();

  await page.keyboard.press(modifierShortcut("KeyK"));
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeHidden();

  const dialogCount = await page.evaluate(() => document.querySelectorAll('[role="dialog"]').length);
  expect(dialogCount, "exactly one modal surface may be live").toBe(1);
});
