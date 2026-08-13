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

// GLO-02 / CHROME-03 (the S2 "UI-scale escape" deferral, closed): the operator
// scale tokens are defined for `.root` AND for body[data-operator-scale-host]
// in one grouped rule, so overlays that portal to document.body (dialogs,
// palette, context menu, color picker, shortcut guide, toasts) now track the
// operator UI scale instead of silently falling back to unscaled DS tokens.
test("operator UI scale reaches portaled overlays", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("app.operator.uiScale", "125");
  });
  await openFixture(page, "lighting-populated");

  // Mechanism: the layout provider stamps body as the scale host.
  await expect(page.locator('body[data-operator-scale-host][data-ui-scale="125"]')).toHaveCount(1);

  // Consumer: a portaled dialog's title reads the title-lg token, so it must
  // render at 22px * 1.25 = 27.5px rather than the unscaled 22px fallback.
  await page.getByRole("button", { name: "Add fixture" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add fixture" });
  await expect(dialog).toBeVisible();
  const titleSize = await dialog
    .locator("h2")
    .first()
    .evaluate((node) => getComputedStyle(node).fontSize);
  expect(titleSize).toBe("27.5px");
});

// GLO-09: latched cross-workspace state (audio SOLO, lighting scene drift)
// surfaces as persistent attention chips in the shell monitor strip instead of
// being guarded only by the async leave-prompt. Both flags derive from engine
// snapshots, so the chips survive workspace switches.
test("audio solo latches a monitor-strip chip that survives workspace switches", async ({ page }) => {
  await openFixture(page, "audio-populated");
  const soloChip = page.getByRole("button", { name: /Open Audio for Solo/ });
  // The fixture transport's synthesized bank ships FX 3/4 pre-soloed, so the
  // chip is part of the designed rest state.
  await expect(soloChip).toBeVisible();

  const soloButton = page.getByTestId("audio-strip-audio-playback-3-4").getByRole("button", { name: "Solo FX 3/4" });
  await expect(soloButton).toHaveAttribute("aria-pressed", "true");
  await soloButton.click();
  await expect(soloButton).toHaveAttribute("aria-pressed", "false");
  await expect(soloChip).toHaveCount(0);

  // Re-latch and confirm the chip survives leaving the audio workspace.
  await soloButton.click();
  await expect(soloChip).toBeVisible();
  await page.getByRole("button", { name: "Lighting", exact: true }).click();
  await expect(page.getByTestId("lighting-stage")).toBeVisible();
  await expect(soloChip).toBeVisible();

  // The chip's click target is the owning workspace, not Setup.
  await soloChip.click();
  await expect(page.getByTestId("audio-workspace")).toBeVisible();
});

test("lighting scene drift latches a monitor-strip chip", async ({ page }) => {
  await openFixture(page, "lighting-populated");
  const driftChip = page.getByRole("button", { name: /Open Lighting for Scene drift/ });
  await expect(driftChip).toHaveCount(0);

  // Toggle the Front group off — the rig now diverges from the recalled
  // Warm wash scene, which must latch the drift chip; restoring the group
  // clears it.
  await page.getByRole("button", { name: /^Front, 2 fixtures at 67%, on/ }).click();
  await expect(driftChip).toBeVisible();
  await page.getByRole("button", { name: /^Front, 2 fixtures/ }).click();
  await expect(driftChip).toHaveCount(0);
});
