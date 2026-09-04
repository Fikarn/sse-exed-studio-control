import { expect, test } from "@playwright/test";

import { openFixture } from "./helpers/openFixture";

// plan PR 4 / workstream D4: setup / commissioning surface specs split
// out of operator-shell.spec.ts. Covers the setup-required runner walk,
// the setup-ready support actions, and the setup-degraded posture.

test("renders the setup/support pilot shell from fixtures", async ({ page }) => {
  await openFixture(page, "setup-required");

  await expect(page.getByText("Commissioning runner")).toBeVisible();
  await expect(page.getByLabel("Workspace command rail")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Import the Companion profile" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Import profile/i })).toBeVisible();
});

test("walks the fixture-backed commissioning runner and support actions", async ({ page }) => {
  await openFixture(page, "setup-required");

  await page.getByRole("tab", { name: /Import profile/i }).click();
  await page.getByRole("button", { name: "Download profile" }).click();
  await expect(page.getByText(/Exported Companion profile to/)).toBeVisible();

  await page.getByRole("tab", { name: /Probe hardware/i }).click();
  await page.getByLabel("Lighting bridge IP").fill("192.168.1.80");
  await page.getByRole("button", { name: "Run all probes" }).click();
  await expect(page.getByText("All 3 commissioning probes passed.")).toBeVisible();

  await expect(page.getByRole("heading", { name: "Map bindings" })).toBeVisible();
  await page.getByRole("button", { name: "Continue to verify" }).click();
  await expect(page.getByRole("heading", { name: "Verify live echo" })).toBeVisible();

  await page.getByRole("button", { name: "Continue to publish" }).click();
  await expect(page.getByRole("heading", { name: "Publish" })).toBeVisible();

  await page.getByRole("button", { name: "Publish setup" }).click();
  await expect(page.getByTestId("planning-workspace")).toBeVisible();
});

test("publish refuses failing probes until the operator overrides explicitly", async ({ page }) => {
  // 2026-09 audit remediation, Slice 8 (operator decision 7). Before this the
  // walk-through above was the only publish coverage and it asserted nothing
  // about probes: "Run all probes" said "completed" whatever the probes
  // returned, and Publish unlocked the dashboard regardless.
  await openFixture(page, "setup-required");

  // Same entry as the walk-through: the Import step first, so the Probe tab
  // opens without the skip-ahead prompt.
  await page.getByRole("tab", { name: /Import profile/i }).click();
  await page.getByRole("button", { name: "Download profile" }).click();
  await expect(page.getByText(/Exported Companion profile to/)).toBeVisible();

  await page.getByRole("tab", { name: /Probe hardware/i }).click();
  await page.getByLabel("Lighting bridge IP").fill("0.0.0.0");
  await page.getByRole("button", { name: "Run all probes" }).click();
  await expect(page.getByText(/2 of 3 probes passed/)).toBeVisible();
  await expect(page.getByText(/Lighting Bridge Probe: Bridge 0\.0\.0\.0 did not answer/)).toBeVisible();
  // A failed probe never advances the runner on its own.
  await expect(page.getByRole("heading", { name: "Probe hardware" })).toBeVisible();

  // Jumping straight to Publish asks whether to skip the unconfirmed steps.
  await page.getByRole("tab", { name: /Publish/i }).click();
  await page.getByRole("dialog", { name: "Skip ahead?" }).getByRole("button", { name: "Skip ahead" }).click();
  await expect(page.getByRole("heading", { name: "Publish" })).toBeVisible();
  await page.getByRole("button", { name: "Publish setup" }).click();
  const dialog = page.getByRole("dialog", { name: "Publish with failing probes?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Lighting Bridge Probe");
  await expect(dialog).toContainText("did not answer");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Publish" })).toBeVisible();
  await expect(page.getByTestId("planning-workspace")).toHaveCount(0);

  await page.getByRole("button", { name: "Publish setup" }).click();
  await page
    .getByRole("dialog", { name: "Publish with failing probes?" })
    .getByRole("button", { name: "Publish anyway" })
    .click();
  await expect(page.getByTestId("planning-workspace")).toBeVisible();
});

test("opens support mode and exercises backup workflows", async ({ page }) => {
  await openFixture(page, "setup-ready");

  await page.getByRole("button", { name: /^Support$/ }).click();
  await expect(page.getByText("What went wrong?")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Backup and recovery" })).toBeVisible();

  await page.getByRole("button", { name: "Export backup" }).click();
  await expect(page.getByText(/Exported support backup to/)).toBeVisible();

  await page.getByRole("button", { name: "Update repo" }).click();
  await expect(page.getByText(/Update repo opened at/)).toBeVisible();

  await page.getByRole("button", { name: "Restore latest" }).click();
  await expect(page.getByText(/Restored native-support-backup/)).toBeVisible();
});

test("shows degraded setup posture from fixtures", async ({ page }) => {
  await openFixture(page, "setup-degraded");
  await expect(page.getByText("Attention required")).toBeVisible();
  await page.getByRole("button", { name: /^Open support$/ }).click();
  await expect(page.getByRole("heading", { name: "Backup and recovery" })).toBeVisible();
});

// plan PR 6 / workstream D6: additional setup-surface coverage. The
// pre-existing tests above walk the happy path; these focus on the
// commissioning unlock contract — setup-ready is the published-and-ready
// state that should NOT show the commissioning runner, and the probe runner
// detail panels should expose their per-probe status fields.

test("setup-ready fixture still exposes the operator-mode Support entry", async ({ page }) => {
  await openFixture(page, "setup-ready");
  // setup-ready means the operator workstation already published — the
  // shell is in operator mode but the Support button must remain reachable
  // so the operator can capture diagnostics from the published state.
  await expect(page.getByRole("button", { name: /^Support$/ })).toBeVisible();
});

test("setup-required surfaces the full commissioning runner step tab list", async ({ page }) => {
  await openFixture(page, "setup-required");

  // The runner exposes a fixed set of stage tabs. Asserting all five by
  // name catches a copy regression or accidental tab-list edit; the
  // existing walk-through test only exercises the active one.
  for (const stageName of ["Import profile", "Probe hardware", "Map bindings", "Verify live echo", "Publish"]) {
    await expect(page.getByRole("tab", { name: new RegExp(stageName, "i") })).toBeVisible();
  }
});

test("setup-degraded fixture surfaces the recovery + support entry points", async ({ page }) => {
  await openFixture(page, "setup-degraded");

  // The degraded state must surface BOTH the diagnostic narrative AND the
  // recovery affordance the operator clicks through to.
  await expect(page.getByText("Attention required")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Open support$/ })).toBeVisible();
});

test("runner panels scroll within their tracks at 1280x800 (SET-11)", async ({ page }) => {
  // Slice 11 / SET-11: the global overflow:hidden chain used to CLIP any
  // runner content that exceeded the viewport — at 1280x800 the side cards
  // painted underneath the pinned footer and could never be reached. The
  // panels now scroll within their grid tracks. The gesture must be a REAL
  // wheel scroll: overflow:hidden ancestors still honor programmatic
  // scrolling (scrollIntoViewIfNeeded passes either way), but swallow user
  // input — exactly the operator-visible defect this locks against.
  await page.setViewportSize({ width: 1280, height: 800 });
  await openFixture(page, "setup-ready");
  await expect(page.getByText("Commissioning runner")).toBeVisible();

  // Precondition: the deepest side-card control starts below the fold.
  const supportDashboard = page.getByRole("button", { name: "Support dashboard" });
  const before = await supportDashboard.boundingBox();
  expect(before).not.toBeNull();
  expect(before!.y + before!.height).toBeGreaterThan(800);

  await page.getByText("Health posture").hover();
  await page.mouse.wheel(0, 2400);
  await expect
    .poll(async () => {
      const box = await supportDashboard.boundingBox();
      return box !== null && box.y >= 0 && box.y + box.height <= 800;
    })
    .toBe(true);
});
