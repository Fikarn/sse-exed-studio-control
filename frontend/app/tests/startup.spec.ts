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

// plan PR 6 / workstream D6: deeper assertions on the recovery surfaces
// the original test glossed over. Each test below isolates one failure
// posture so a regression in that specific posture surfaces against the
// fixture, instead of the omnibus test above masking it.

test("protocol-mismatch fixture exposes the documented diagnostic fields", async ({ page }) => {
  await openFixture(page, "protocol-mismatch");
  await expect(page.getByRole("heading", { name: "Protocol mismatch" })).toBeVisible({ timeout: 10000 });

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
  await expect(page.getByRole("heading", { name: "Engine bootstrap failed" })).toBeVisible({
    timeout: 10000,
  });

  // The bootstrap-failed posture is the worst-case startup failure; the
  // operator needs an archive button to capture the runtime state for
  // hand-off + the runtime paths block to know where to look.
  await expect(page.getByRole("button", { name: "Archive" })).toBeVisible();
  await expect(page.getByText("Runtime paths")).toBeVisible();
  await expect(page.getByText("Install & Update")).toBeVisible();
});

test("startup-loading fixture hides every operator workspace surface", async ({ page }) => {
  await openFixture(page, "startup-loading");
  await expect(page.getByText("STARTING ENGINE…")).toBeVisible();

  // While starting we should NOT show any operator workspace — the rail,
  // the workspace tabs, none of it. Asserting absence catches the class
  // of regression where the rail flickers in before the engine is ready.
  await expect(page.getByLabel("Workspace command rail")).toHaveCount(0);
  await expect(page.getByTestId("audio-workspace")).toHaveCount(0);
  await expect(page.getByTestId("lighting-stage")).toHaveCount(0);
  await expect(page.getByTestId("planning-workspace")).toHaveCount(0);
});
