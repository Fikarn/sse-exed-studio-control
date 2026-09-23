import { expect, test } from "@playwright/test";

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
  for (const label of ["Setup / Support", "Lighting", "Audio", "Planning"]) {
    await expect(nav.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-disabled", "true");
  }
  await expect(page.getByTestId("audio-workspace")).toHaveCount(0);
  await expect(page.getByTestId("lighting-stage")).toHaveCount(0);
  await expect(page.getByTestId("planning-workspace")).toHaveCount(0);
});

test("recovery shell scrolls within the frame at 1920x1080 (SET-11)", async ({ page }) => {
  // Slice 11 / SET-11: the recovery shell carried a 100vh/100dvh min-height
  // inside PreReadyFrame's overflow:hidden main, so the bottom card was
  // amputated at 1920x1080 with no way to scroll to it. The shell now
  // scrolls within the frame; this locks that the last reference block can
  // be brought fully into view.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openFixture(page, "protocol-mismatch");
  await expect(page.getByTestId("setup-recovery-surface-state-display")).toContainText("PROTOCOL MISMATCH", {
    timeout: 10000,
  });

  // Precondition: the last reference block starts below the fold. The
  // gesture must be a REAL wheel scroll: overflow:hidden ancestors still
  // honor programmatic scrolling (scrollIntoViewIfNeeded passes either
  // way), but swallow user input — the operator-visible defect.
  const updatePosture = page.getByText("Update posture");
  const before = await updatePosture.boundingBox();
  expect(before).not.toBeNull();
  expect(before!.y + before!.height).toBeGreaterThan(1080);

  await page.getByText("What went wrong?").hover();
  await page.mouse.wheel(0, 2400);
  await expect
    .poll(async () => {
      const box = await updatePosture.boundingBox();
      return box !== null && box.y >= 0 && box.y + box.height <= 1080;
    })
    .toBe(true);
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
