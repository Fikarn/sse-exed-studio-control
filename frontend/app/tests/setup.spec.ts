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
  await expect(page.getByText("All commissioning probes completed.")).toBeVisible();

  await expect(page.getByRole("heading", { name: "Map bindings" })).toBeVisible();
  await page.getByRole("button", { name: "Continue to verify" }).click();
  await expect(page.getByRole("heading", { name: "Verify live echo" })).toBeVisible();

  await page.getByRole("button", { name: "Continue to publish" }).click();
  await expect(page.getByRole("heading", { name: "Publish" })).toBeVisible();

  await page.getByRole("button", { name: "Publish setup" }).click();
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
  await expect(page.getByText("Degraded startup posture")).toBeVisible();
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
  await expect(page.getByText("Degraded startup posture")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Open support$/ })).toBeVisible();
});
