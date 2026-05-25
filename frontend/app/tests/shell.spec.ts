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
