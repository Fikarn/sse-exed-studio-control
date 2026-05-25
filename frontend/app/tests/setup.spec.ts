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
