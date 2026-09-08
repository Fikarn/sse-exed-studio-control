import { expect, test } from "@playwright/test";

import { openFixture } from "./helpers/openFixture";

// plan PR 4 / workstream D4: setup / commissioning surface specs split
// out of operator-shell.spec.ts. Covers the setup-required runner walk,
// the setup-ready support actions, and the setup-degraded posture.
//
// Visual overhaul A, Slice 7 (plan D1, D12): Setup moved onto the cluster rule.
// The commissioning state, the mode switch, the five steps, the three probes
// and the standing actions are portalled into the SHELL's cluster region, so
// they are no longer inside the workspace; Support is a plate that is always on
// screen; and the step is a screen at the height the step needs, so the runner
// no longer scrolls to be reached.

test("renders the setup/support pilot shell from fixtures", async ({ page }) => {
  await openFixture(page, "setup-required");

  await expect(page.getByText("Commissioning runner")).toBeVisible();
  // Visual overhaul A, Slice 2 (plan D1): Setup is a workspace inside the one
  // shell (old assertion: no navigation, PreReadyFrame); before commissioning
  // is published the operator workspaces are locked.
  const nav = page.getByRole("navigation", { name: "Workspace navigation" });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("button", { name: "Setup / Support", exact: true })).toHaveAttribute(
    "aria-current",
    "page"
  );
  await expect(nav.getByRole("button", { name: "Audio", exact: true })).toHaveAttribute("aria-disabled", "true");
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
  // Slice 7: the step's own note prints the same count, so the result the probe
  // run reported is read off the notice it wrote.
  const feedback = page.getByTestId("setup-feedback");
  await expect(feedback).toContainText("2 of 3 probes passed");
  await expect(feedback).toContainText("Lighting Bridge Probe: Bridge 0.0.0.0 did not answer");
  // A failed probe never advances the runner on its own.
  await expect(page.getByRole("heading", { name: "Probe hardware" })).toBeVisible();

  // Jumping straight to Publish asks whether to skip the unconfirmed steps.
  await page.getByRole("tab", { name: /Publish/i }).click();
  await page.getByRole("dialog", { name: "Skip ahead?" }).getByRole("button", { name: "Skip ahead" }).click();
  await expect(page.getByRole("heading", { name: "Publish" })).toBeVisible();
  // Slice 7: the key says what pressing it will do before it is pressed.
  await expect(page.getByTestId("setup-step-primary")).toHaveText("Publish with override…");
  await page.getByTestId("setup-step-primary").click();
  const dialog = page.getByRole("dialog", { name: "Publish with failing probes?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Lighting Bridge Probe");
  await expect(dialog).toContainText("did not answer");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Publish" })).toBeVisible();
  await expect(page.getByTestId("planning-workspace")).toHaveCount(0);

  await page.getByTestId("setup-step-primary").click();
  await page
    .getByRole("dialog", { name: "Publish with failing probes?" })
    .getByRole("button", { name: "Publish anyway" })
    .click();
  await expect(page.getByTestId("planning-workspace")).toBeVisible();
});

test("opens support mode and exercises backup workflows", async ({ page }) => {
  await openFixture(page, "setup-ready");

  // Slice 7: Support is a mode of the bay and a plate that is always there —
  // the backup keys read off the plate, which is why they are scoped to it.
  const plate = page.getByTestId("support-plate");
  await page
    .getByTestId("setup-cluster")
    .getByRole("button", { name: /^Support$/ })
    .click();
  await expect(page.getByText("What went wrong?")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Backup and recovery" })).toBeVisible();

  await plate.getByRole("button", { name: "Export backup" }).click();
  await expect(page.getByText(/Exported support backup to/)).toBeVisible();

  await page.getByRole("button", { name: "Update repo" }).click();
  await expect(page.getByText(/Update repo opened at/)).toBeVisible();

  await plate.getByRole("button", { name: "Restore latest" }).click();
  await expect(page.getByText(/Restored native-support-backup/)).toBeVisible();
});

test("shows degraded setup posture from fixtures", async ({ page }) => {
  await openFixture(page, "setup-degraded");
  // Slice 7: the banner that said "Attention required" is gone; the state
  // display carries the word, the engine's sentence and the way out.
  const display = page.getByTestId("setup-state-display");
  await expect(display).toContainText("DEGRADED");
  await expect(display).toContainText("need attention");
  await page
    .getByTestId("setup-cluster")
    .getByRole("button", { name: /^Support$/ })
    .click();
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
  await expect(page.getByTestId("setup-cluster").getByRole("button", { name: /^Support$/ })).toBeVisible();
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
  // recovery affordance the operator clicks through to. Slice 7: the narrative
  // is the state display's sentence and the way out is the key on it; Support
  // is one press away on the cluster and its plate never leaves the screen.
  await expect(page.getByTestId("setup-state-display")).toContainText("DEGRADED");
  await expect(page.getByTestId("setup-state-run-probes")).toBeVisible();
  await expect(page.getByTestId("setup-cluster").getByRole("button", { name: /^Support$/ })).toBeVisible();
  await expect(page.getByTestId("support-plate")).toBeVisible();
});

test("the step screen needs no scroll at 1280x800 (SET-11)", async ({ page }) => {
  // Slice 11 / SET-11 locked that runner content below the fold could still be
  // reached by a real wheel scroll, because the global overflow:hidden chain
  // used to clip it. Visual overhaul A, Slice 7 (system §2) changes the
  // contract it is guarding: a commissioning step is a screen at the height the
  // step needs, so the step itself is on screen without scrolling at all — and
  // the lists that have no bound (the archives) are the only things that
  // scroll. This asserts the stronger property.
  await page.setViewportSize({ width: 1280, height: 800 });
  await openFixture(page, "setup-ready");
  await expect(page.getByText("Commissioning runner")).toBeVisible();

  const screen = page.getByTestId("setup-screen-publish");
  const box = await screen.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(800);

  // Every key the step offers is reachable without a gesture.
  for (const testId of ["setup-step-primary", "setup-mode-support", "setup-run-all-probes"]) {
    const control = page.getByTestId(testId);
    const controlBox = await control.boundingBox();
    expect(controlBox, testId).not.toBeNull();
    expect(controlBox!.y + controlBox!.height, testId).toBeLessThanOrEqual(800);
  }
});

// 2026-09 audit remediation, Slice 12: seeding demo planning data is a
// confirmed action (it used to fire on a single click next to the profile
// download).
test("loading sample planning asks for confirmation first", async ({ page }) => {
  await openFixture(page, "setup-required");
  await page.getByRole("tab", { name: /Import profile/i }).click();

  // Slice 7: the sample data lives on the Support plate, which is always on
  // screen — the import step no longer carries it next to the profile download.
  await page.getByTestId("support-load-sample-planning").click();
  const dialog = page.getByRole("dialog", { name: "Load sample planning data?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/adds the bundled sample projects/)).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/Loaded the bundled sample planning data/)).toHaveCount(0);

  await page.getByTestId("support-load-sample-planning").click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Load sample planning" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/Loaded the bundled sample planning data/)).toBeVisible();
});

// ---------------------------------------------------------------------------
// Visual overhaul A, Slice 7 (plan Slice 7): the cluster rule on Setup.
// ---------------------------------------------------------------------------

test("the Publish keys and every probe result are fully visible without scrolling (C4)", async ({ page }) => {
  await openFixture(page, "setup-ready");

  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const bottom = viewport!.height;

  // The publish step, the probes it gates on and the keys that do it all sit on
  // the studio monitor at once — nothing has to be scrolled into reach.
  for (const testId of [
    "setup-screen-publish",
    "setup-step-primary",
    "setup-probe-lighting",
    "setup-probe-audio",
    "setup-probe-control-surface",
    "setup-run-all-probes",
    "support-restart-bridge",
  ]) {
    const box = await page.getByTestId(testId).boundingBox();
    expect(box, testId).not.toBeNull();
    expect(box!.y, testId).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height, testId).toBeLessThanOrEqual(bottom);
  }
});

test("degraded: the display offers Run all probes and Publish becomes Publish with override…", async ({ page }) => {
  await openFixture(page, "setup-degraded");

  const display = page.getByTestId("setup-state-display");
  await expect(display).toContainText("DEGRADED");
  await expect(display).toContainText("1 of 3 probes passed");
  await expect(display).toContainText("re-verify before publishing");
  await expect(page.getByTestId("setup-state-run-probes")).toBeVisible();

  // The publish key says what pressing it will do before it is pressed.
  await expect(page.getByTestId("setup-step-primary")).toHaveText("Publish with override…");
  await page.getByTestId("setup-step-primary").click();
  const dialog = page.getByRole("dialog", { name: "Publish with failing probes?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Lighting bridge");
  await expect(dialog).toContainText("Control surface");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
});

test("setup-required: step 1 is current, the others pending, the header lamps mirror the probes (H12)", async ({
  page,
}) => {
  await openFixture(page, "setup-required");

  const cluster = page.getByTestId("setup-cluster");
  await expect(cluster.getByTestId("setup-state-display")).toContainText("SETUP REQUIRED");
  await expect(cluster.getByTestId("setup-step-import")).toHaveAttribute("data-standing", "current");
  for (const step of ["probe", "map", "verify", "publish"]) {
    await expect(cluster.getByTestId(`setup-step-${step}`)).toHaveAttribute("data-standing", "pending");
  }

  // The three probes on the cluster and the three lamps in the shell header say
  // the same thing about the same subsystems.
  await expect(cluster.getByTestId("setup-probe-lighting")).toContainText("attention");
  await expect(cluster.getByTestId("setup-probe-audio")).toContainText("attention");
  await expect(cluster.getByTestId("setup-probe-control-surface")).toContainText("passed");
  // The header lamp is the subsystem's, not the probe's alone — an unreachable
  // bridge is red even where the probe only says "attention" — so what H12
  // locks is that no subsystem whose probe is unverified reads green, and the
  // one that passed does.
  await expect(page.getByTestId("shell-lamp-lighting")).not.toHaveAttribute("data-tone", "ok");
  await expect(page.getByTestId("shell-lamp-audio")).not.toHaveAttribute("data-tone", "ok");
  await expect(page.getByTestId("shell-lamp-surface")).toHaveAttribute("data-tone", "ok");
});

test("Support keeps the shell header, tabs and lamps (H1)", async ({ page }) => {
  await openFixture(page, "setup-ready");
  await page.getByTestId("setup-mode-support").click();

  await expect(page.getByRole("heading", { name: "Backup and recovery" })).toBeVisible();
  const header = page.getByRole("banner");
  await expect(header).toBeVisible();
  const headerBox = await header.boundingBox();
  expect(Math.abs((headerBox?.height ?? 0) - 56)).toBeLessThanOrEqual(2);
  await expect(page.getByRole("navigation", { name: "Workspace navigation" })).toBeVisible();
  await expect(header.getByRole("button", { name: /^Lighting/ })).toBeVisible();
  await expect(page.getByTestId("setup-health-bar")).toBeVisible();
  // The plate does not go away when the bay changes mode.
  await expect(page.getByTestId("support-plate")).toBeVisible();
});
