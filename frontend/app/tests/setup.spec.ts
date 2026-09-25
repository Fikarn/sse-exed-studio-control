import { expect, test } from "@playwright/test";

import { expectWorkspaceMounted, openFixture } from "./helpers/openFixture";
import { pausePageClock } from "./helpers/pageClock";

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
  await page.getByTestId("setup-run-all-probes").click();
  await expect(page.getByText("All 3 commissioning probes passed.")).toBeVisible();

  await expect(page.getByRole("heading", { name: "Map bindings" })).toBeVisible();
  await page.getByRole("button", { name: "Continue to verify" }).click();
  await expect(page.getByRole("heading", { name: "Verify live echo" })).toBeVisible();

  await page.getByRole("button", { name: "Continue to publish" }).click();
  await expect(page.getByRole("heading", { name: "Publish" })).toBeVisible();

  await page.getByRole("button", { name: "Publish setup" }).click();
  // New pages program, Slice 1 (D1): Publish opens the Console. Old: Planning.
  await expectWorkspaceMounted(page, "audio");
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
  await page.getByTestId("setup-run-all-probes").click();
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
  // New pages program, Slice 1 (D1): Publish opens the Console, so the Console
  // is what must not have opened. Old: the Planning workspace.
  await expect(page.getByTestId("audio-workspace")).toHaveCount(0);

  await page.getByTestId("setup-step-primary").click();
  await page
    .getByRole("dialog", { name: "Publish with failing probes?" })
    .getByRole("button", { name: "Publish anyway" })
    .click();
  await expectWorkspaceMounted(page, "audio");
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

  await page.getByRole("button", { name: "Update folder" }).click();
  await expect(page.getByText(/Update folder opened at/)).toBeVisible();

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

// 2026-09 production readiness, Slice 11 (F30, F31): the Light outputs switch
// on the Support plate, in the built app. Held is said in three places — the
// switch's readout, the header's Lighting lamp (on every workspace, and ahead
// of an unsaved scene or a probe that has not run) and a Recent actions row
// with the screen as its source — and nowhere promises a dark room.
test.describe("Light outputs: Armed / Held", () => {
  test.use({ viewport: { width: 2560, height: 1440 } });

  test("holding and arming from the plate: the readout, the lamp, the row", async ({ page }) => {
    await openFixture(page, "lighting-populated");
    const header = page.getByRole("banner");
    const lamp = header.getByRole("button", { name: /^Open Setup \/ Support for Lighting/ });
    await expect(lamp).not.toContainText("held");

    await page
      .getByRole("navigation", { name: "Workspace navigation" })
      .getByRole("button", { name: "Setup / Support", exact: true })
      .click();
    const plate = page.getByTestId("support-plate");
    const workstation = plate.getByTestId("support-workstation");
    await expect(plate.getByTestId("support-outputs-armed")).toHaveAttribute("aria-pressed", "true");
    await expect(workstation).toContainText("the rig follows the app");
    await expect(plate.getByTestId("support-recent-actions-empty")).toBeVisible();

    await plate.getByTestId("support-outputs-held").click();
    await expect(plate.getByTestId("support-outputs-held")).toHaveAttribute("aria-pressed", "true");
    await expect(plate.getByTestId("support-outputs-armed")).toHaveAttribute("aria-pressed", "false");
    await expect(workstation).toContainText("nothing is sent to the rig");
    await expect(lamp).toContainText("held");
    const feedback = page.getByTestId("setup-feedback");
    await expect(feedback).toContainText("Light outputs held");
    await expect(feedback).not.toContainText(/dark|blackout/i);
    const newest = plate.getByTestId("support-recent-action").first();
    await expect(newest).toContainText("Light outputs held");
    await expect(newest).toContainText("Screen");
    await expect(newest).toHaveAttribute("data-source", "ui");

    // The lamp is the header's: it says held on the other workspaces too.
    await page
      .getByRole("navigation", { name: "Workspace navigation" })
      .getByRole("button", { name: "Lighting", exact: true })
      .click();
    await expect(page.getByTestId("lighting-workspace")).toBeVisible();
    await expect(lamp).toContainText("held");

    await page
      .getByRole("navigation", { name: "Workspace navigation" })
      .getByRole("button", { name: "Setup / Support", exact: true })
      .click();
    await plate.getByTestId("support-outputs-armed").click();
    await expect(plate.getByTestId("support-outputs-armed")).toHaveAttribute("aria-pressed", "true");
    await expect(lamp).not.toContainText("held");
    await expect(plate.getByTestId("support-recent-action")).toHaveCount(2);
    await expect(plate.getByTestId("support-recent-action").first()).toContainText("Light outputs armed");
  });

  test("Recent actions shows the newest eight of the nine the fixture carries, inside the plate", async ({ page }) => {
    await openFixture(page, "setup-ready");
    const plate = page.getByTestId("support-plate");
    const rows = plate.getByTestId("support-recent-action");
    await expect(rows).toHaveCount(8);
    await expect(rows.first()).toContainText("Light outputs armed");
    for (const word of ["Screen", "Stream Deck", "Console", "Watchdog"]) {
      await expect(plate.getByTestId("support-recent-actions")).toContainText(word);
    }
    // Nothing on the plate scrolls, and the list ends above the red key.
    const fits = await plate.evaluate((element) => element.scrollHeight <= element.clientHeight);
    expect(fits, "the Support plate must not scroll at 2560x1440").toBe(true);
    const listBox = await plate.getByTestId("support-recent-actions").boundingBox();
    const dangerBox = await plate.getByTestId("support-restart-bridge").boundingBox();
    expect((listBox?.y ?? 0) + (listBox?.height ?? 0)).toBeLessThan(dangerBox?.y ?? 0);
  });
});

// 2026-09-22, after the production readiness program: the fixture double writes
// the rows the hardware link writes for every action the screen asks for
// (`transports/fixture/actionLog.ts`, after `native/rust-engine/src/action_log.rs`).
// Until then it wrote one for the light-outputs switch only, so nothing done on
// the Lighting page ever showed here.
test("Recent actions lists what was done on the Lighting page, newest first, from the screen", async ({ page }) => {
  // The identify flash is shown over the rig while it lasts, and a rig that
  // differs from its scene makes leaving Lighting ask about unsaved changes;
  // the page's clock is stopped so the flash can be run out before the recall.
  await page.clock.install();
  await openFixture(page, "lighting-populated");
  await expectWorkspaceMounted(page, "lighting");
  await pausePageClock(page);

  const highlight = page.getByTestId("lighting-highlight-toggle");
  await highlight.click();
  await expect(highlight).toHaveAttribute("aria-pressed", "true");
  await highlight.click();
  await expect(highlight).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Identify", exact: true }).click();
  await expect(page.getByText("Identify burst sent to 'Key'.")).toBeVisible();
  await page.clock.runFor(1_300);
  await page.getByRole("button", { name: "Recall scene Interview", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Recall scene Interview \(active/ })).toBeVisible();

  await page
    .getByRole("navigation", { name: "Workspace navigation" })
    .getByRole("button", { name: "Setup / Support", exact: true })
    .click();
  const rows = page.getByTestId("support-plate").getByTestId("support-recent-action");
  await expect(rows).toHaveCount(4);
  const details = [
    "Scene recalled: Interview",
    "Identify flash (fixture-key)",
    "Highlight and light solo off",
    "Highlight on · 1 light(s)",
  ];
  for (const [index, detail] of details.entries()) {
    await expect(rows.nth(index)).toContainText(detail);
    await expect(rows.nth(index)).toContainText("Screen");
    await expect(rows.nth(index)).toHaveAttribute("data-source", "ui");
  }
});
