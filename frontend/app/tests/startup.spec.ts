import { expect, test } from "@playwright/test";

import { openFixture } from "./helpers/openFixture";

// plan PR 4 / workstream D4: startup + recovery surface specs split out
// of operator-shell.spec.ts. Covers the startup-loading, protocol-mismatch,
// and bootstrap-failed fixture states.

test("renders startup and recovery fixture states", async ({ page }) => {
  await openFixture(page, "startup-loading");
  await expect(page.getByText("STARTING ENGINE…")).toBeVisible();
  await expect(page.getByLabel("Workspace command rail")).toHaveCount(0);

  await openFixture(page, "protocol-mismatch");
  await expect(page.getByRole("heading", { name: "Protocol mismatch" })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("What went wrong?")).toBeVisible();
  await expect(page.getByText("Reference paths")).toBeVisible();
  await expect(page.getByText("Requested protocol")).toBeVisible();
  await page.getByRole("button", { name: "Update repo" }).click();
  await expect(page.getByText(/Update repo opened at/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Logs" })).toBeVisible();

  await openFixture(page, "bootstrap-failed");
  await expect(page.getByRole("heading", { name: "Engine bootstrap failed" })).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByText("What went wrong?")).toBeVisible();
  await expect(page.getByText("Install & Update")).toBeVisible();
  await expect(page.getByText("Runtime paths")).toBeVisible();
  await expect(page.getByRole("button", { name: "Archive" })).toBeVisible();
});
