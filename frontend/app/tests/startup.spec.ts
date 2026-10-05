import { expect, test } from "@playwright/test";

import { expectNoDocumentScroll } from "./helpers/geometry";
import { openFixture } from "./helpers/openFixture";
import { measureRoom } from "./helpers/setup";

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
  await expect(page.getByText("Where things are", { exact: true })).toBeVisible();
  await expect(page.getByText("Requested protocol")).toBeVisible();
  await page.getByRole("button", { name: "App data" }).click();
  await expect(page.getByText(/App data opened at/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Logs" })).toBeVisible();

  await openFixture(page, "bootstrap-failed");
  await expect(page.getByTestId("setup-recovery-surface-state-display")).toContainText("STARTUP FAILED", {
    timeout: 10000,
  });
  await expect(page.getByText("What went wrong?")).toBeVisible();
  await expect(page.getByText("File paths", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Backups", exact: true })).toBeVisible();
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
  await expect(page.getByText("Where things are", { exact: true })).toBeVisible();
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
  await expect(page.getByRole("button", { name: "Backups", exact: true })).toBeVisible();
  await expect(page.getByText("File paths", { exact: true })).toBeVisible();
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
  // fourth being Planning. Slice 6a: four again, the Teleprompter after Audio.
  // Five with the Cameras, between the two (D4).
  const tabLabels = ["Setup / Support", "Lighting", "Audio", "Cameras", "Teleprompter"];
  await expect(nav.getByRole("button")).toHaveCount(tabLabels.length);
  for (const label of tabLabels) {
    await expect(nav.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-disabled", "true");
  }
  await expect(page.getByTestId("audio-workspace")).toHaveCount(0);
  await expect(page.getByTestId("lighting-stage")).toHaveCount(0);
  await expect(page.getByTestId("teleprompter-workspace")).toHaveCount(0);
  await expect(page.getByTestId("cameras-workspace")).toHaveCount(0);
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

  // The bay's sections, whole: they end on the screen. The shell (overhaul
  // 3): the file paths are on the plate, and the last of them, the lowest
  // text there is, ends on the screen too, with the plate unscrolled.
  const cards = await page.getByTestId("setup-recovery-cards").boundingBox();
  expect(cards, "the sections should have a box").not.toBeNull();
  expect(cards!.y).toBeGreaterThanOrEqual(0);
  expect(cards!.y + cards!.height).toBeLessThanOrEqual(1440);
  const lastPath = page.getByTestId("setup-recovery-paths").locator("li").last();
  const box = await lastPath.boundingBox();
  expect(box, "the last file path should have a box").not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(1440);
  const plate = page.getByTestId("setup-recovery-surface-plate");
  expect(await plate.evaluate((node) => node.scrollHeight <= node.clientHeight + 1)).toBe(true);
  await expectNoDocumentScroll(page);
});

// The visual overhaul (2026-10-05): an area that stopped drawing says so in a
// word that fits the display, its short name (`PROMPTER STOPPED`).
test("an area that stopped: its word fits, nothing scrolls, no line is cut", async ({ page }) => {
  for (const [crash, tab, word] of [
    ["setup", "Setup / Support", "SETUP STOPPED"],
    ["lighting", "Lighting", "LIGHTING STOPPED"],
    ["cameras", "Cameras", "CAMERAS STOPPED"],
    ["teleprompter", "Teleprompter", "PROMPTER STOPPED"],
  ] as const) {
    await openFixture(page, "audio-populated", { crash });
    await page
      .getByRole("navigation", { name: "Workspace navigation" })
      .getByRole("button", { name: tab, exact: true })
      .click();
    await expect(page.getByTestId("workspace-boundary-state-display")).toContainText(word);
    await expect(page.getByTestId("workspace-boundary-bay")).toContainText("The rest of Studio Control keeps working");
    const room = await measureRoom(page);
    expect(room.scrolls, `${crash}: every column holds what it shows`).toEqual([]);
    expect(room.cut, `${crash}: no line is cut`).toEqual([]);
  }
});

// The visual overhaul (2026-10-05): on every screen before ready nothing
// scrolls and no line is cut, the display's word included (the owner chose
// shorter words where the 440 px display cut them).
test("the screens before ready: nothing scrolls, no line is cut", async ({ page }) => {
  for (const [fixture, word] of [
    ["protocol-mismatch", "PROTOCOL MISMATCH"],
    ["bootstrap-failed", "STARTUP FAILED"],
    ["startup-loading", "STARTING UP…"],
  ] as const) {
    await openFixture(page, fixture);
    await expect(page.getByTestId(/state-display$/).first()).toContainText(word, { timeout: 10000 });
    const room = await measureRoom(page);
    expect(room.page, fixture).toEqual([2560, 1440]);
    expect(room.scrolls, `${fixture}: every column holds what it shows`).toEqual([]);
    expect(room.cut, `${fixture}: no line is cut`).toEqual([]);
  }
});

// Visual overhaul A, Slice 7 (plan Slice 7): a recovery surface is not a dead
// end — every band on it says what the operator does next.
test("every recovery band names a next step", async ({ page }) => {
  await openFixture(page, "bootstrap-failed");

  const display = page.getByTestId("setup-recovery-surface-state-display");
  // The fixture's failure comes after the page and the double load: the wait
  // every other case here gives it (this one flaked at the default 5 s).
  await expect(display).toContainText("STARTUP FAILED", { timeout: 10000 });
  // The way out is a key on the display itself.
  await expect(page.getByTestId("setup-recovery-retry")).toBeVisible();

  // Each band the surface shows carries an action or a named next step.
  await expect(page.getByRole("button", { name: "Backups", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Logs" })).toBeVisible();
  await expect(page.getByText("File paths", { exact: true })).toBeVisible();
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
  // The shell (overhaul 3): the display stands in the 440 px cluster; its one
  // way out stays on it, and the window's key stands right under it. The
  // visual overhaul (2026-10-05, the owner's answer): Back to Console went,
  // since it could never leave this screen.
  await expect(display.getByRole("button")).toHaveText(["Retry startup"]);
  await expect(page.getByTestId("setup-recovery-keys").getByRole("button")).toHaveText(["Reset the window layout"]);

  const reset = page.getByTestId("setup-recovery-window-reset");
  await reset.click();
  await expect(reset).toBeEnabled();
  await expect(page.getByTestId("setup-recovery-feedback")).toHaveCount(0);
  await expect(display).toContainText("STARTUP FAILED");
  // Unlike Retry startup, Reset asks nothing first.
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
