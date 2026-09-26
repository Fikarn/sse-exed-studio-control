import { expect, test } from "@playwright/test";

import { expectNoDocumentScroll } from "./helpers/geometry";
import { openFixture } from "./helpers/openFixture";

// plan PR 4 / workstream D4: startup + recovery surface specs split out
// of operator-shell.spec.ts. Covers the startup-loading, protocol-mismatch,
// and bootstrap-failed fixture states.
//
// Visual overhaul A, Slice 7 (plan D1, D12): the pre-ready surfaces use the
// same skeleton as the workspaces. What used to be an <h1> inside a card is now
// the state display's word, with the engine's sentence under it and the raw
// code in the display's own code slot, so these assertions read off the display
// (`recovery-surface-state-display` / `setup-recovery-surface-state-display`).

test("renders startup and recovery fixture states", async ({ page }) => {
  await openFixture(page, "startup-loading");
  await expect(page.getByText("STARTING UP…")).toBeVisible();
  // Visual overhaul A, Slice 2 (plan D1): the shell header renders on every
  // surface; before the engine is ready every tab is locked.
  await expect(page.getByRole("navigation", { name: "Workspace navigation" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Lighting", exact: true })).toBeDisabled();

  await openFixture(page, "protocol-mismatch");
  const mismatchDisplay = page.getByTestId("setup-recovery-surface-state-display");
  await expect(mismatchDisplay).toContainText("PROTOCOL MISMATCH", { timeout: 10000 });
  await expect(mismatchDisplay).toContainText("PROTOCOL_MISMATCH");
  await expect(page.getByText("What went wrong?")).toBeVisible();
  await expect(page.getByText("Reference paths")).toBeVisible();
  await expect(page.getByText("Requested protocol")).toBeVisible();
  await page.getByRole("button", { name: "Update folder" }).click();
  await expect(page.getByText(/Update folder opened at/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Logs" })).toBeVisible();

  await openFixture(page, "bootstrap-failed");
  await expect(page.getByTestId("setup-recovery-surface-state-display")).toContainText("STARTUP FAILED", {
    timeout: 10000,
  });
  await expect(page.getByText("What went wrong?")).toBeVisible();
  await expect(page.getByText("Install & Update")).toBeVisible();
  await expect(page.getByText("File paths")).toBeVisible();
  await expect(page.getByRole("button", { name: "Archive" })).toBeVisible();
});

// plan PR 6 / workstream D6: deeper assertions on the recovery surfaces
// the original test glossed over. Each test below isolates one failure
// posture so a regression in that specific posture surfaces against the
// fixture, instead of the omnibus test above masking it.

test("protocol-mismatch fixture exposes the documented diagnostic fields", async ({ page }) => {
  await openFixture(page, "protocol-mismatch");
  await expect(page.getByTestId("setup-recovery-surface-state-display")).toContainText("PROTOCOL MISMATCH", {
    timeout: 10000,
  });

  // Every protocol-mismatch instance must expose the documented diagnostic
  // strings; the operator hands these to the maintainer for triage.
  await expect(page.getByText("What went wrong?")).toBeVisible();
  await expect(page.getByText("Reference paths")).toBeVisible();
  await expect(page.getByText("Requested protocol")).toBeVisible();

  // Logs is the click-through that the operator uses to capture the
  // protocol-mismatch context.
  await expect(page.getByRole("button", { name: "Logs" })).toBeVisible();
});

test("bootstrap-failed fixture surfaces archive + recovery affordances", async ({ page }) => {
  await openFixture(page, "bootstrap-failed");
  await expect(page.getByTestId("setup-recovery-surface-state-display")).toContainText("STARTUP FAILED", {
    timeout: 10000,
  });

  // The bootstrap-failed posture is the worst-case startup failure; the
  // operator needs an archive button to capture the runtime state for
  // hand-off + the runtime paths block to know where to look.
  await expect(page.getByRole("button", { name: "Archive" })).toBeVisible();
  await expect(page.getByText("File paths")).toBeVisible();
  await expect(page.getByText("Install & Update")).toBeVisible();
});

test("startup-loading fixture hides every operator workspace surface", async ({ page }) => {
  await openFixture(page, "startup-loading");
  await expect(page.getByText("STARTING UP…")).toBeVisible();

  // While starting we should NOT show any operator workspace. The shell
  // header is there (visual overhaul A, Slice 2, plan D1) with every tab
  // locked — old assertion: no navigation at all — so the class of regression
  // caught here is a workspace surface flickering in before the engine is
  // ready, or a tab that could be pressed.
  const nav = page.getByRole("navigation", { name: "Workspace navigation" });
  await expect(nav).toBeVisible();
  // New pages program, Slice 1: three tabs, and no others. Old: four, the
  // fourth being Planning.
  const tabLabels = ["Setup / Support", "Lighting", "Audio"];
  await expect(nav.getByRole("button")).toHaveCount(tabLabels.length);
  for (const label of tabLabels) {
    await expect(nav.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-disabled", "true");
  }
  await expect(page.getByTestId("audio-workspace")).toHaveCount(0);
  await expect(page.getByTestId("lighting-stage")).toHaveCount(0);
});

test("the recovery screen needs no scroll at 2560x1440 (SET-11)", async ({ page }) => {
  // Slice 11 / SET-11: the recovery shell carried a 100vh/100dvh min-height
  // inside PreReadyFrame's overflow:hidden main, so the bottom card was
  // amputated at 1920x1080 with no way to scroll to it; the shell now scrolls
  // within the frame. New pages program, Slice SW (D22). Old: at 1920 × 1080
  // the last reference block started below the fold and a real wheel scroll had
  // to bring it into view. New: at 2560 × 1440 it is on screen as the screen
  // opens, with nothing scrolled. Reason: the studio screen is the only one,
  // and there the stronger property holds.
  await page.setViewportSize({ width: 2560, height: 1440 });
  await openFixture(page, "protocol-mismatch");
  await expect(page.getByTestId("setup-recovery-surface-state-display")).toContainText("PROTOCOL MISMATCH", {
    timeout: 10000,
  });

  const box = await page.getByText("Update posture").boundingBox();
  expect(box, "the last reference block should have a box").not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(1440);
  await expectNoDocumentScroll(page);
});

// Visual overhaul A, Slice 7 (plan Slice 7): a recovery surface is not a dead
// end — every band on it says what the operator does next.
test("every recovery band names a next step", async ({ page }) => {
  await openFixture(page, "bootstrap-failed");

  const display = page.getByTestId("setup-recovery-surface-state-display");
  await expect(display).toContainText("STARTUP FAILED");
  // The way out is a key on the display itself.
  await expect(page.getByTestId("setup-recovery-retry")).toBeVisible();

  // Each band the surface shows carries an action or a named next step.
  await expect(page.getByRole("button", { name: "Archive" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Logs" })).toBeVisible();
  await expect(page.getByText("File paths")).toBeVisible();
  await expect(page.getByText("Install & Update")).toBeVisible();
  await expect(page.getByRole("button", { name: /Export diagnostics/ }).first()).toBeVisible();
});

// New pages program, Slice 3 (D6, decision 2; the inventory's §7 note 8). The
// keys on the state display before Studio Control is ready. "Shortcuts", the
// only key on the startup screens, went with the shortcut guide; the recovery
// screens keep Retry startup and gain Reset the window layout beside it, the
// one window command that is not only in Setup / Support. Outside the installed
// app the native shell is not there, so the key moves nothing and says nothing.
test("the startup screen has no key (S3)", async ({ page }) => {
  await openFixture(page, "startup-loading");
  // Setup's startup screen or the plain one, whichever the shell draws.
  const display = page.getByTestId(/startup-surface-state-display$/);
  await expect(display).toContainText("STARTING UP…");
  await expect(display.getByRole("button")).toHaveCount(0);
});

test("the recovery screen offers Reset the window layout beside Retry startup (S3, decision 2)", async ({ page }) => {
  await openFixture(page, "bootstrap-failed");
  const display = page.getByTestId("setup-recovery-surface-state-display");
  await expect(display).toContainText("STARTUP FAILED", { timeout: 10000 });
  await expect(display.getByRole("button")).toHaveText(["Retry startup", "Reset the window layout", "Back to Console"]);

  const reset = page.getByTestId("setup-recovery-window-reset");
  await reset.click();
  await expect(reset).toBeEnabled();
  await expect(page.getByTestId("setup-recovery-feedback")).toHaveCount(0);
  await expect(display).toContainText("STARTUP FAILED");
  // Unlike Retry startup, Reset asks nothing first.
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
