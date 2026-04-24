import { expect, test, type Page } from "@playwright/test";

const FIXTURE_NOW = new Date("2026-04-23T09:11:00+02:00");

function modifierShortcut(key: string) {
  return `${process.platform === "darwin" ? "Meta" : "Control"}+${key}`;
}

async function openFixture(page: Page, fixtureId: string) {
  if (fixtureId.startsWith("planning-")) {
    await page.clock.setFixedTime(FIXTURE_NOW);
  }
  const response = await page.goto(`/?fixture=${fixtureId}&transport=fixture`);
  expect(response, `fixture ${fixtureId} should return a document response`).not.toBeNull();
  expect(
    response!.status(),
    `fixture ${fixtureId} should not fail to load`,
  ).toBeLessThan(400);
  expect(page.url()).toContain(`fixture=${fixtureId}`);
}

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

test("shows degraded setup posture from fixtures", async ({ page }) => {
  await openFixture(page, "setup-degraded");
  await expect(page.getByText("Degraded startup posture")).toBeVisible();
  await page.getByRole("button", { name: /^Open support$/ }).click();
  await expect(page.getByRole("heading", { name: "Backup and recovery" })).toBeVisible();
});

test("renders the audio workspace from an engine-backed snapshot and supports key desk actions", async ({
  page,
}) => {
  await openFixture(page, "audio-populated");

  const workspace = page.getByTestId("audio-workspace");
  await expect(workspace).toBeVisible();
  await expect(workspace.getByText("Main Out").first()).toBeVisible();
  await expect(page.getByTestId("audio-meter-bridge")).toBeVisible();
  await expect(page.getByTestId("audio-mix-target-audio-mix-main")).toHaveAttribute(
    "data-selected",
    "true",
  );

  await page.getByTestId("audio-mix-target-audio-mix-phones-a").click();
  await expect(page.getByTestId("audio-mix-target-audio-mix-phones-a")).toHaveAttribute(
    "data-selected",
    "true",
  );

  await page.keyboard.press("KeyV");
  await expect(workspace).toHaveAttribute("data-density", "precision");

  await page.keyboard.press("BracketRight");
  await expect(workspace.getByText("Bank 2 / 3")).toBeVisible();

  await page.keyboard.press("Digit1");
  const selectedStrip = page.getByTestId("audio-strip-audio-input-5");
  await expect(selectedStrip).toHaveAttribute("data-selected", "true");

  await page.keyboard.press("KeyM");
  await expect(selectedStrip.getByRole("button", { name: "Mute" })).toHaveAttribute(
    "data-active",
    "true",
  );

  await page.keyboard.press("Shift+Digit3");
  await expect(page.getByTestId("audio-snapshot-snapshot-interview-block")).toHaveAttribute(
    "data-current",
    "true",
  );
  await expect(page.getByTestId("audio-toolbar-current-snapshot")).toHaveText(
    "Recalled Interview block",
  );

  await page.keyboard.press("Escape");
  await expect(page.getByText("Desk help")).toBeVisible();
});

test("renders audio degraded and loading fixture states", async ({ page }) => {
  await openFixture(page, "audio-state-assumed");
  await expect(page.getByText("STATE ASSUMED", { exact: true })).toBeVisible();
  await expect(page.getByText(/using last synced console state/i)).toBeVisible();

  await openFixture(page, "audio-not-verified");
  await expect(page.getByText("OSC NOT VERIFIED", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sync" })).toBeDisabled();

  await openFixture(page, "audio-osc-disabled");
  await expect(page.getByText("OSC DISABLED", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sync" })).toBeDisabled();

  await openFixture(page, "audio-offline");
  await expect(page.getByText("CONSOLE UNREACHABLE", { exact: true })).toBeVisible();
  await expect(page.getByText("Console did not answer OSC ping.").first()).toBeVisible();

  await openFixture(page, "audio-action-failed");
  await expect(page.getByText("SNAPSHOT RECALL FAILED", { exact: true })).toBeVisible();
  await expect(
    page.getByText("AUDIO_SNAPSHOT_RECALL_FAILED · Snapshot slot 3 did not match the current console layout."),
  ).toBeVisible();

  await openFixture(page, "audio-loading");
  await expect(page.getByText("Loading audio snapshot.")).toBeVisible();
});

test("supports audio warning-band sync and keyboard mix-target changes", async ({ page }) => {
  await openFixture(page, "audio-state-assumed");

  const warningBand = page.getByTestId("audio-warning-band");
  await warningBand.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("audio-warning-band")).toHaveCount(0);

  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("audio-mix-target-audio-mix-phones-a")).toHaveAttribute(
    "data-selected",
    "true",
  );
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("audio-mix-target-audio-mix-phones-b")).toHaveAttribute(
    "data-selected",
    "true",
  );
});

test("keeps the full audio workspace visible at the 1920x1080 fallback size", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openFixture(page, "audio-1920-fallback");

  const workspace = page.getByTestId("audio-workspace");
  await expect(workspace).toBeVisible();
  await expect(workspace.getByText("Submix first")).toBeVisible();
  await expect(workspace.getByText("Monitor confidence")).toBeVisible();
  await expect(page.getByTestId("audio-strip-audio-playback-3-4")).toBeVisible();

  const layoutMetrics = await page.evaluate(() => ({
    documentScrollHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight,
  }));
  expect(layoutMetrics.documentScrollHeight).toBeLessThanOrEqual(layoutMetrics.viewportHeight + 1);
});

test("renders the planning timeline from an engine-backed snapshot and toggles board mode", async ({ page }) => {
  await openFixture(page, "planning-populated");

  const workspace = page.getByTestId("planning-workspace");
  await expect(page.getByRole("heading", { name: "Planning timeline" })).toHaveCount(0);
  await expect(workspace.getByRole("tab", { name: "Timeline" })).toHaveAttribute("data-active", "true");
  await expect(workspace.getByText("evening_service")).toBeVisible();
  await expect(
    workspace.getByRole("button", { name: /Commission Stream Deck\+ · Booth 2/i }),
  ).toBeVisible();
  await expect(workspace.getByText("Archive Q3 cue library")).toBeVisible();
  await expect(page.getByTestId("planning-now-playhead")).toBeVisible();
  const boothLaneBounds = await workspace.getByTestId("planning-lane-proj-booth-2").boundingBox();
  expect(boothLaneBounds?.height ?? 0).toBeGreaterThan(80);
  expect(boothLaneBounds?.height ?? 0).toBeLessThan(90);

  await page.keyboard.press("Shift+KeyB");
  await expect(workspace.getByRole("tab", { name: "Board" })).toHaveAttribute("data-active", "true");
  const boardCard = workspace.getByTestId("planning-board-card-proj-booth-2");
  await expect(boardCard).toBeVisible();
  await expect(boardCard).toHaveAttribute("data-running", "true");
  await expect(boardCard).toContainText("booth_2");
  await expect(boardCard).toContainText("P1");
  await expect(boardCard).toContainText("1/2 tasks");
  await expect(boardCard).toContainText("audio");
  await expect(boardCard).toContainText("control-surface");
  await expect(workspace.getByText("No projects in this column.")).toHaveCount(1);
  await expect(workspace.getByText("booth_2")).toBeVisible();
  await page.keyboard.press("Digit4");
  await expect(workspace.getByRole("tab", { name: "Done" })).toHaveAttribute("data-active", "true");
  await expect(workspace.getByTestId("planning-board-empty-done")).toHaveAttribute("data-zero-filter", "true");
  await expect(workspace.getByText("No done tasks.")).toBeVisible();

  await page.keyboard.press("Shift+KeyT");
  await expect(workspace.getByRole("tab", { name: "Timeline" })).toHaveAttribute("data-active", "true");
  await expect(workspace.getByText("Filter: done · 0 of 5")).toBeVisible();
  await workspace.getByRole("button", { name: "Clear" }).click();
  await expect(workspace.getByRole("button", { name: /Level-match overflow/i })).toBeVisible();
});

test("supports retained planning board drag reorder and status moves", async ({ page }) => {
  await openFixture(page, "planning-populated");

  const workspace = page.getByTestId("planning-workspace");
  await page.keyboard.press("Shift+KeyB");

  const inProgressColumn = workspace.getByTestId("planning-board-column-in-progress");
  const blockedColumn = workspace.getByTestId("planning-board-column-blocked");
  const blockedColumnBody = workspace.getByTestId("planning-board-column-body-blocked");
  const boothCard = workspace.getByTestId("planning-board-card-proj-booth-2");
  const lightingCard = workspace.getByTestId("planning-board-card-proj-lighting");

  await boothCard.dragTo(blockedColumnBody);
  await expect(blockedColumn.getByTestId("planning-board-card-proj-booth-2")).toBeVisible();
  await expect(blockedColumn.getByTestId("planning-board-card-proj-booth-2")).toHaveAttribute("data-blocked", "true");
  await expect(inProgressColumn.getByTestId("planning-board-card-proj-booth-2")).toHaveCount(0);

  await blockedColumn.getByTestId("planning-board-card-proj-booth-2").dragTo(lightingCard, {
    targetPosition: { x: 24, y: 12 },
  });
  const blockedCards = blockedColumn.locator('[data-testid^="planning-board-card-"]');
  await expect(blockedCards.nth(0)).toContainText("booth_2");
  await expect(blockedCards.nth(1)).toContainText("lighting");
});

test("supports planning timeline selection, keyboard reschedule, and local day navigation", async ({ page }) => {
  await openFixture(page, "planning-populated");

  const workspace = page.getByTestId("planning-workspace");
  const selectedTask = workspace.getByRole("button", { name: /Commission Stream Deck\+ · Booth 2/i });

  await selectedTask.click();
  await expect(selectedTask).toHaveAttribute("data-selected", "true");
  await expect(selectedTask).toHaveAttribute("data-time-label", "18:24");

  await page.keyboard.press("ArrowRight");
  await expect(selectedTask).toHaveAttribute("data-time-label", "18:39");

  await page.keyboard.press("ArrowDown");
  await expect(workspace.getByText("Commission Stream Deck+ · Booth 2 · running")).toBeVisible();
  await page.keyboard.press("Enter");
  const audioDetailDialog = page.getByRole("dialog", { name: "audio" });
  await expect(audioDetailDialog).toBeVisible();
  await audioDetailDialog.getByRole("button", { name: "Close" }).click();
  await expect(audioDetailDialog).toHaveCount(0);

  await page.keyboard.press("ArrowUp");
  await expect(workspace.getByText("Commission Stream Deck+ · Booth 2 · running")).toHaveCount(1);
  await page.keyboard.press("Enter");
  const boothDetailDialog = page.getByRole("dialog", { name: "booth_2" });
  await expect(boothDetailDialog).toBeVisible();
  await boothDetailDialog.getByRole("button", { name: "Close" }).click();
  await expect(boothDetailDialog).toHaveCount(0);

  await page.keyboard.press("BracketRight");
  await expect(workspace.getByText("10:00 → 23:00")).toBeVisible();

  await page.keyboard.press("Shift+BracketRight");
  await expect(workspace.getByRole("button", { name: "Today" })).toBeVisible();

  await page.keyboard.press("0");
  await expect(workspace.getByRole("button", { name: "Today" })).toHaveCount(0);
  await expect(selectedTask).toBeVisible();
});

test("reschedules a planning timeline block by drag into another lane", async ({ page }) => {
  await openFixture(page, "planning-populated");

  const workspace = page.getByTestId("planning-workspace");
  const audioLane = workspace.getByTestId("planning-lane-body-proj-audio");
  const taskBlock = workspace.getByRole("button", { name: /Commission Stream Deck\+ · Booth 2/i });

  await taskBlock.dragTo(audioLane, {
    targetPosition: { x: 420, y: 42 },
  });

  await expect(workspace.getByRole("button", { name: /Commission Stream Deck\+ · Booth 2/i })).toHaveCount(1);
  await expect(workspace.getByText("Commission Stream Deck+ · Booth 2 · running")).toBeVisible();
});

test("opens the retained planning project detail overlay from timeline selection and board detail targets", async ({
  page,
}) => {
  await openFixture(page, "planning-populated");

  const workspace = page.getByTestId("planning-workspace");
  await workspace.getByRole("button", { name: /Commission Stream Deck\+ · Booth 2/i }).click();
  await page.keyboard.press("Enter");

  const detailDialog = page.getByRole("dialog", { name: "booth_2" });
  await expect(detailDialog).toBeVisible();
  await expect(detailDialog.getByText("1/2 complete")).toBeVisible();
  await expect(detailDialog.getByText("Verify OSC bindings")).toBeVisible();
  await expect(detailDialog.getByText("Commission Stream Deck+ · Booth 2")).toBeVisible();
  await expect(detailDialog.getByText("Stream Deck+ booth commissioning resumed.")).toBeVisible();
  const checklistToggle = detailDialog.getByRole("button", {
    name: "Toggle checklist item Verify companion trigger handoff for Commission Stream Deck+ · Booth 2",
    exact: true,
  });
  await expect(checklistToggle).toHaveAttribute("data-done", "false");
  await checklistToggle.click();
  await expect(checklistToggle).toHaveAttribute("data-done", "true");
  await expect(detailDialog.getByText("Checklist item checked")).toBeVisible();
  await detailDialog
    .getByRole("button", {
      name: "Toggle completion for Commission Stream Deck+ · Booth 2",
      exact: true,
    })
    .click();
  await expect(detailDialog.getByText("2/2 complete")).toBeVisible();
  await expect(detailDialog.getByText('Task "Commission Stream Deck+ · Booth 2" marked as completed')).toBeVisible();
  await detailDialog.getByRole("button", { name: "+ Add Task" }).click();
  await detailDialog.getByLabel("New task for booth_2").fill("Run booth handoff");
  await detailDialog.getByRole("button", { name: "Add Task", exact: true }).click();
  await expect(detailDialog.getByText("2/3 complete")).toBeVisible();
  await expect(
    detailDialog.getByRole("button", {
      name: "Toggle completion for Run booth handoff",
      exact: true,
    }),
  ).toBeVisible();
  await expect(detailDialog.getByText('Task "Run booth handoff" created')).toBeVisible();
  await detailDialog.getByLabel("Checklist item text for Run booth handoff").fill("Pack backup SD image");
  await detailDialog
    .getByRole("button", {
      name: "Add checklist item for Run booth handoff",
      exact: true,
    })
    .click();
  await expect(
    detailDialog.getByRole("button", {
      name: "Toggle checklist item Pack backup SD image for Run booth handoff",
      exact: true,
    }),
  ).toBeVisible();
  await expect(detailDialog.getByText('Checklist item "Pack backup SD image" added')).toBeVisible();
  await detailDialog.getByRole("button", { name: "Close" }).click();
  await expect(detailDialog).toHaveCount(0);

  await page.keyboard.press("Shift+KeyB");
  await workspace.getByRole("button", { name: "Open project detail for booth_2" }).click();
  await expect(page.getByRole("dialog", { name: "booth_2" })).toBeVisible();
});

test("surfaces planning lane overlap after a reschedule write", async ({ page }) => {
  await openFixture(page, "planning-overlap");

  const workspace = page.getByTestId("planning-workspace");
  const selectedTask = workspace.getByRole("button", { name: /Program note runthrough/i });

  await selectedTask.click();
  await expect(selectedTask).toHaveAttribute("data-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(selectedTask).toHaveAttribute("data-overlap", "true");
  await expect(selectedTask).toHaveAttribute("data-overlap-pulse", "true");
  await expect(selectedTask).toHaveAttribute("title", /Overlaps 'Projector handoff'\./);
});

test("supports planning all-unscheduled tray expansion and schedules a task into its own lane", async ({ page }) => {
  await openFixture(page, "planning-all-unscheduled");

  const workspace = page.getByTestId("planning-workspace");
  const tray = workspace.getByTestId("planning-unscheduled-tray");
  const lane = workspace.getByTestId("planning-lane-body-proj-ops");
  const taskChip = workspace.getByRole("button", { name: "Unscheduled task Archive Q3 cue library" });

  await expect(workspace.getByText("Drag into a lane to schedule.")).toBeVisible();
  await expect(tray).toHaveAttribute("data-expanded", "true");
  await expect(tray).toHaveAttribute("data-all-unscheduled", "true");

  await taskChip.dragTo(lane);

  await expect(workspace.getByText("Archive Q3 cue library")).toBeVisible();
  await expect(workspace.getByText("15 min · P3")).toBeVisible();
  await expect(workspace.getByRole("button", { name: "Unscheduled task Archive Q3 cue library" })).toHaveCount(0);
});

test("supports planning toolbar project creation and backup export", async ({ page }) => {
  await openFixture(page, "planning-empty");

  const workspace = page.getByTestId("planning-workspace");
  await expect(workspace.getByText("No projects yet. Press N to start one.")).toBeVisible();

  await page.keyboard.press("KeyN");
  const projectTitle = workspace.getByLabel("New project title");
  await expect(projectTitle).toBeFocused();
  await projectTitle.fill("studio_patch");
  await workspace.getByRole("button", { name: "Add project" }).click();
  await expect(workspace.getByText("Created project 'studio_patch'.")).toBeVisible();
  await expect(workspace.getByText("studio_patch", { exact: true })).toBeVisible();

  await workspace.getByRole("button", { name: "Backup" }).click();
  await expect(workspace.getByText(/Exported support backup to/)).toBeVisible();
});

test("supports planning toolbar search focus and engine-backed time report", async ({ page }) => {
  await openFixture(page, "planning-populated");

  const workspace = page.getByTestId("planning-workspace");
  const toolbar = page.getByTestId("planning-toolbar");
  const search = workspace.getByLabel("Search planning tasks");

  await page.keyboard.press("/");
  await expect(search).toBeFocused();
  await search.fill("stream deck");
  await expect(workspace.getByText("booth_2")).toBeVisible();
  await expect(workspace.getByText("audio")).toHaveCount(0);

  await toolbar.click();
  await page.keyboard.press("KeyS");
  await expect(search).toBeFocused();

  await toolbar.click();
  await page.keyboard.press("KeyR");
  const timeReportDialog = page.getByRole("dialog", { name: "Time report" });
  await expect(timeReportDialog).toBeVisible();
  await expect(timeReportDialog.getByText("By project")).toBeVisible();
  await expect(timeReportDialog.getByText("By task")).toBeVisible();
  await expect(timeReportDialog.getByText("booth_2", { exact: true }).first()).toBeVisible();
  await expect(timeReportDialog.getByText("Commission Stream Deck+ · Booth 2")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog", { name: "Time report" })).toHaveCount(0);
});

test("shows the centered empty-state card in planning board mode with no projects", async ({ page }) => {
  await openFixture(page, "planning-empty");

  const workspace = page.getByTestId("planning-workspace");
  await expect(workspace.getByText("No projects yet. Press N to start one.")).toBeVisible();

  await page.keyboard.press("Shift+KeyB");
  await expect(workspace.getByRole("tab", { name: "Board" })).toHaveAttribute("data-active", "true");
  await expect(workspace.getByText("No projects yet. Press N to start one.")).toBeVisible();
  await expect(workspace.getByTestId("planning-board-column-todo")).toBeVisible();
  await expect(workspace.getByTestId("planning-board-column-in-progress")).toBeVisible();
  await expect(workspace.getByTestId("planning-board-column-blocked")).toBeVisible();
  await expect(workspace.getByTestId("planning-board-column-done")).toBeVisible();
});

test("renders the planning board loading posture from app snapshot mode settings", async ({ page }) => {
  await openFixture(page, "planning-loading-board");

  const workspace = page.getByTestId("planning-workspace");
  await expect(workspace.getByTestId("planning-board-column-todo")).toBeVisible();
  await expect(workspace.getByTestId("planning-board-column-in-progress")).toBeVisible();
  await expect(workspace.getByTestId("planning-board-column-blocked")).toBeVisible();
  await expect(workspace.getByTestId("planning-board-column-done")).toBeVisible();
  await expect(workspace.getByText("Run-of-show loading…")).toHaveCount(0);
});

test("renders the lighting snapshot loading posture", async ({ page }) => {
  await openFixture(page, "lighting-loading");

  const workspace = page.getByRole("main");
  await expect(page.getByRole("heading", { name: "Lighting workspace" })).toBeVisible();
  await expect(workspace.getByText("Loading cue stack…")).toBeVisible();
  await expect(workspace.getByText("Blank ribbon until the DMX monitor snapshot arrives.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Select fixture/i })).toHaveCount(0);
});

test("renders the lighting workspace from an engine-backed fixture snapshot", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  const workspace = page.getByRole("main");
  await expect(page.getByRole("heading", { name: "Lighting workspace" })).toBeVisible();
  await expect(workspace.locator("p").filter({ hasText: "Lighting snapshot active." })).toBeVisible();
  await expect(workspace.getByText("Bridge 192.168.1.80 · Universe 1")).toBeVisible();
  await expect(page.getByTestId("lighting-beam-fixture-key")).toBeVisible();
  await expect(page.getByTestId("lighting-stage-marker-camera")).toBeVisible();
  await expect(page.getByTestId("lighting-stage-marker-subject")).toBeVisible();
  await expect(workspace.getByText("Warm wash").first()).toBeVisible();
  await expect(workspace.getByText("Cue Rail", { exact: true })).toBeVisible();
  await expect(workspace.getByText("DMX peek", { exact: true })).toBeVisible();
  await expect(page.getByTitle("Key · Dimmer")).toContainText("001");
  await expect(page.getByTitle("Key · Dimmer")).toContainText("C2");
  await expect(page.getByTitle("Back · FX")).toContainText("047");
  await expect(page.getByTitle("Back · FX")).toContainText("00");
  await expect(page.getByRole("button", { name: "Select fixture Key" })).toHaveAttribute(
    "data-active",
    "true",
  );
  await expect(workspace.getByText("Live at 76% / 3200K")).toBeVisible();
  await page.keyboard.press("KeyS");
  await expect(page.getByLabel("Lighting scene name")).toBeFocused();
  await expect(page.getByLabel("Lighting scene name")).toHaveValue("Scene 3");
  await expect(page.getByRole("button", { name: "Select fixture Key" })).toHaveAttribute(
    "data-active",
    "true",
  );
  await page.getByRole("button", { name: "Select fixture Key" }).click();
  await page.getByRole("button", { name: /2\. Interview look/i }).click();
  await expect(page.getByRole("button", { name: "Select fixture Key" })).toHaveAttribute(
    "data-active",
    "false",
  );
  await expect(workspace.getByText("Cue preview")).toBeVisible();
  await expect(workspace.getByText("Cue 2. Interview look")).toBeVisible();
  await expect(workspace.getByText("fade 1.5 s · 4 fixture changes")).toBeVisible();
  await expect(page.getByTitle("Back OFF → 18%")).toBeVisible();
  await page.getByRole("button", { name: "Select fixture Key" }).click();
  await page.getByLabel("Fixture intensity").focus();
  await page.getByLabel("Fixture intensity").press("End");
  await expect(
    workspace.getByRole("status").getByText(/Lighting fixture 'Key'.*100% \/ 3200K/i),
  ).toBeVisible();
  await expect(page.getByTitle("Key · Dimmer")).toContainText("FF");
  await page.getByLabel("Fixture CCT").focus();
  await page.getByLabel("Fixture CCT").press("End");
  await expect(
    workspace.getByRole("status").getByText(/Lighting fixture 'Key'.*100% \/ 5600K/i),
  ).toBeVisible();
  await expect(page.getByTitle("Key · CCT")).toContainText("FF");
  await page.getByLabel("Fixture patch start channel").fill("3");
  await page.getByRole("button", { name: "Apply patch" }).click();
  await expect(
    workspace.getByRole("status").getByText(/Lighting fixture 'Key'.*DMX 3\)/i),
  ).toBeVisible();
  await expect(page.getByTitle("Key · Dimmer")).toContainText("003");
  await expect(page.getByTitle("Key · CCT")).toContainText("004");
  await expect(page.getByTitle("Dimmer · 003 · 255")).toBeVisible();
  await expect(page.getByTitle("CCT · 004 · 255")).toBeVisible();
  await expect(workspace.getByText("1 membership")).toBeVisible();
  await expect(workspace.getByText("Front").first()).toBeVisible();
  await expect(
    workspace.locator("span").filter({ hasText: /^1\. Opening look$/ }),
  ).toBeVisible();
  await expect(
    workspace.locator("span").filter({ hasText: /^2\. Interview look$/ }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Front/i })).toContainText("2/2 on");
  await expect(page.getByRole("button", { name: /Interview 4/i })).toBeVisible();

  await page.getByRole("button", { name: "Select fixture Warm wash" }).click();
  await expect(page.getByRole("button", { name: "Select fixture Warm wash" })).toHaveAttribute(
    "data-active",
    "true",
  );
  await expect(workspace.getByText("Type Apollo Bridge · DMX 61")).toBeVisible();
  await expect(workspace.getByText("Live at 64% / 3000K")).toBeVisible();
  await page.getByRole("button", { name: "Turn fixture off" }).click();
  await expect(
    workspace.getByRole("status").getByText(/Lighting fixture 'Warm wash'.*saved as off/i),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Back 0/2 on" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Turn fixture on" })).toBeVisible();

  await page.getByRole("button", { name: /Front/i }).click();
  await expect(workspace.getByText("Group controls")).toBeVisible();
  await expect(workspace.getByText("2/2 on · intensity 58-100% · CCT 4300-5600K")).toBeVisible();
  await page.getByRole("button", { name: "Turn group off" }).click();
  await expect(
    workspace.locator("p").filter({ hasText: "Lighting group 'Front' set off across 2 fixtures." }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Front/i })).toContainText("0/2 on");
  await expect(page.getByTitle("Key · Dimmer")).toContainText("00");

  await page.keyboard.press(modifierShortcut("KeyM"));
  await expect(workspace.getByText("DMX monitor")).toBeVisible();
  await expect(workspace.getByText(/^00300Dimmer$/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(workspace.getByText("DMX monitor")).toBeHidden();

  const backFixture = page.getByRole("button", { name: "Select fixture Back" });
  await expect(backFixture).toHaveAttribute("data-display-intensity", "0");
  await page.keyboard.press("Space");
  await expect(
    workspace.locator("p").filter({ hasText: "Lighting cue 'Interview look' fired." }),
  ).toBeVisible();
  await expect(page.getByTestId("lighting-go-bar")).toHaveAttribute("data-transitioning", "true");
  await expect(page.getByText("GOING → Interview look")).toBeVisible();
  await expect(page.getByTestId("lighting-go-progress")).toBeVisible();
  await expect(page.getByTestId("lighting-stage-plot")).toHaveAttribute("data-cue-pulse", "true");
  await page.waitForTimeout(250);
  const duringFadeIntensity = Number(await backFixture.getAttribute("data-display-intensity"));
  expect(duringFadeIntensity).toBeGreaterThan(0);
  expect(duringFadeIntensity).toBeLessThan(18);
  await expect.poll(async () => await backFixture.getAttribute("data-display-intensity")).toBe("18");
  await page.keyboard.press("Backspace");
  await expect(
    workspace.locator("p").filter({ hasText: "Lighting cue 'Opening look' fired." }),
  ).toBeVisible();

  await page.getByRole("button", { name: /Interview 4/i }).click();
  await expect(
    workspace
      .locator("p")
      .filter({ hasText: "Fixture lighting scene 'Interview' was recalled via immediate transition" }),
  ).toBeVisible();
});

test("keeps the full lighting workspace visible at the 1920x1080 fallback size", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openFixture(page, "lighting-populated");

  const workspace = page.getByRole("main");
  await expect(page.getByRole("heading", { name: "Lighting workspace" })).toBeVisible();
  await expect(workspace.getByText("Cue Rail", { exact: true })).toBeVisible();
  await expect(workspace.getByText("DMX peek", { exact: true })).toBeVisible();
  await expect(page.getByTestId("lighting-stage-plot")).toBeVisible();
  await expect(page.getByRole("button", { name: "GO" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Patch", exact: true })).toBeVisible();
  await expect(workspace.getByText("Live at 76% / 3200K")).toBeVisible();

  const layoutMetrics = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    scrollWidth: document.documentElement.scrollWidth,
    viewportHeight: window.innerHeight,
    viewportWidth: window.innerWidth,
  }));

  expect(layoutMetrics.scrollHeight).toBeLessThanOrEqual(layoutMetrics.viewportHeight + 1);
  expect(layoutMetrics.scrollWidth).toBeLessThanOrEqual(layoutMetrics.viewportWidth + 1);
});

test("supports lighting toolbar search, patch mode, and empty-state fixture create", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  const workspace = page.getByRole("main");
  await page.getByPlaceholder("Search fixtures").fill("zzz");
  await expect(workspace.getByText('Search: "zzz" · 0 of 4')).toBeVisible();
  await page.getByRole("button", { name: "Clear" }).first().click();
  await expect(workspace.getByText('Search: "zzz" · 0 of 4')).toBeHidden();

  await page.getByRole("button", { name: "Patch", exact: true }).click();
  await expect(workspace.getByText("Patch mode · output muted")).toBeVisible();
  await expect(workspace.getByText("Universe 1", { exact: true })).toBeVisible();
  await expect(workspace.getByText("001-002", { exact: true })).toBeVisible();
  await expect(workspace.getByText("2 ch mode", { exact: true })).toBeVisible();
  await expect(workspace.getByText("4.2 m", { exact: true })).toBeVisible();
  await expect(workspace.getByText("38°", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "GO" })).toBeDisabled();
  await expect(page.getByTestId("lighting-beam-fixture-key")).toHaveCount(0);
  await page.keyboard.press("Space");
  await expect(
    workspace.getByRole("status").getByText("Patch mode is active. Exit patch mode to resume cue output."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Patch candidate DMX 3" })).toBeVisible();
  await page
    .getByRole("button", { name: "Patch candidate DMX 3" })
    .dragTo(page.getByRole("button", { name: "Select fixture Key" }));
  await expect(
    workspace.getByRole("status").getByText(/Lighting fixture 'Key'.*DMX 3\)/i),
  ).toBeVisible();
  await expect(page.getByTitle("Key · Dimmer")).toContainText("003");
  await page.getByRole("button", { name: "Identify burst" }).click();
  await expect(
    workspace.getByRole("status").getByText("Identify burst preview active for 'Key'."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Select fixture Key" })).toHaveAttribute(
    "data-identify-active",
    "true",
  );
  await page.getByLabel("Fixture beam angle").fill("42");
  await page.getByRole("button", { name: "Apply beam" }).click();
  await expect(
    workspace.getByRole("status").getByText(/Lighting fixture 'Key'.*beam 42deg/i),
  ).toBeVisible();
  await expect(workspace.getByText("42°", { exact: true })).toBeVisible();
  await page.keyboard.press("KeyP");
  await expect(workspace.getByText("Patch mode · address tags visible")).toBeHidden();

  await openFixture(page, "lighting-empty");
  const emptyWorkspace = page.getByRole("main");
  await expect(emptyWorkspace.getByText("No fixtures are patched yet.")).toBeVisible();
  await page.getByRole("button", { name: "+ Fixture" }).first().click();
  await expect(
    emptyWorkspace
      .getByRole("status")
      .getByText(/Lighting fixture 'Fixture 1' was created as astra-bicolor on DMX 1\./i),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Select fixture Fixture 1" })).toBeVisible();
  await expect(emptyWorkspace.getByText("Type astra-bicolor · DMX 1")).toBeVisible();
});

test("surfaces patch collisions and auto-fixes them in lighting patch mode", async ({ page }) => {
  await openFixture(page, "lighting-patch-overlap");

  const workspace = page.getByRole("main");
  await page.getByRole("button", { name: "Patch", exact: true }).click();

  const backFixture = page.getByRole("button", { name: "Select fixture Back" });
  await expect(backFixture).toContainText("⚠ OVERLAPS KEY");
  await expect(workspace.getByText("Patch collision")).toBeVisible();
  await expect(workspace.getByText("Back overlaps Key at u1 · 2-9 (8 ch).")).toBeVisible();
  await expect(page.getByRole("button", { name: "Auto-fix to DMX 3" })).toBeVisible();

  await page.getByRole("button", { name: "Auto-fix to DMX 3" }).click();
  await expect(
    workspace.getByRole("status").getByText(/Lighting fixture 'Back'.*DMX 3\)/i),
  ).toBeVisible();
  await expect(backFixture).toContainText("u1 · 3-10");
  await expect(backFixture).not.toContainText("⚠ OVERLAPS KEY");
  await expect(workspace.getByText("Patch collision")).toHaveCount(0);
});

test("persists lighting cue caret and section view through shell settings", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  const workspace = page.getByRole("main");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(
    workspace.locator("p").filter({ hasText: "Lighting cue 'Interview look' fired." }),
  ).toBeVisible();

  await page.keyboard.press("Digit1");
  await expect(workspace.getByText("1. Stage Left")).toBeVisible();
  await expect(page.getByRole("button", { name: "Select fixture Warm wash" })).toHaveAttribute(
    "data-section-dimmed",
    "true",
  );

  await page.keyboard.press(modifierShortcut("Digit4"));
  await expect(page.getByTestId("planning-workspace")).toBeVisible();
  await page.keyboard.press(modifierShortcut("Digit2"));

  await expect(workspace.getByText("Cue 2. Interview look")).toBeVisible();
  await expect(workspace.getByText("1. Stage Left")).toBeVisible();

  await page.keyboard.press("0");
  await expect(workspace.getByText("1. Stage Left")).toBeHidden();
  await expect(page.getByRole("button", { name: "Select fixture Warm wash" })).toHaveAttribute(
    "data-section-dimmed",
    "false",
  );

  await page.keyboard.press("KeyF");
  await expect(
    workspace
      .getByRole("status")
      .getByText(/Lighting fixture 'Fixture 5' was created as astra-bicolor on DMX 3\./i),
  ).toBeVisible();
});

test("supports lighting drag-lasso multi-select and group save", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  const workspace = page.getByRole("main");
  const plot = page.getByTestId("lighting-stage-plot");
  await plot.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const dispatch = (type: string, x: number, y: number, buttons: number) => {
      node.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          button: 0,
          buttons,
          clientX: rect.left + rect.width * x,
          clientY: rect.top + rect.height * y,
          shiftKey: true,
        }),
      );
    };

    dispatch("mousedown", 0.12, 0.14, 1);
    dispatch("mousemove", 0.58, 0.72, 1);
    dispatch("mouseup", 0.58, 0.72, 0);
  });

  await expect(page.getByRole("button", { name: "Select fixture Key" })).toHaveAttribute(
    "data-lasso-selected",
    "true",
  );
  await expect(page.getByRole("button", { name: "Select fixture Back" })).toHaveAttribute(
    "data-lasso-selected",
    "true",
  );
  await expect(workspace.getByText("2 fixtures selected")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save as Group…" })).toBeVisible();

  await page.keyboard.press("KeyG");
  await expect(
    workspace
      .getByRole("status")
      .getByText(/Lighting group 'Group 3' created from 2 selected fixtures\./i),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Group 3/i })).toContainText("1/2 on");
});

test("saves the current lighting selection as a scene from the inspector prompt", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  const workspace = page.getByRole("main");
  await page.getByRole("button", { name: "Select fixture Key" }).click();
  await page.keyboard.press("KeyS");
  await expect(page.getByLabel("Lighting scene name")).toBeFocused();
  await page.getByLabel("Lighting scene name").fill("Interview reset");
  await page.keyboard.press("Enter");

  await expect(
    workspace
      .getByRole("status")
      .getByText(/Lighting scene 'Interview reset' was saved from the current fixture state\./i),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Interview reset 4/i })).toBeVisible();
});

test("nudges the selected fixture horizontally from the keyboard", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  const workspace = page.getByRole("main");
  await page.getByRole("button", { name: "Select fixture Key" }).click();
  await page.keyboard.press("ArrowRight");

  await expect(
    workspace.getByRole("status").getByText(/manual layout at 25% \/ 26% \/ 0deg/i),
  ).toBeVisible();
});

test("drags the selected fixture to a new plot position", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  const workspace = page.getByRole("main");
  const plot = page.getByTestId("lighting-stage-plot");
  const fixture = page.getByRole("button", { name: "Select fixture Key" });
  await plot.scrollIntoViewIfNeeded();
  await fixture.scrollIntoViewIfNeeded();
  const plotBox = await plot.boundingBox();
  const fixtureBox = await fixture.boundingBox();

  expect(plotBox).not.toBeNull();
  expect(fixtureBox).not.toBeNull();

  await page.mouse.move(
    fixtureBox!.x + fixtureBox!.width / 2,
    fixtureBox!.y + fixtureBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    plotBox!.x + plotBox!.width * 0.34,
    plotBox!.y + plotBox!.height * 0.36,
    { steps: 12 },
  );
  await page.mouse.up();

  await expect(
    workspace.getByRole("status").getByText(/manual layout at 34% \/ 36% \/ 0deg/i),
  ).toBeVisible();
});

test("toggles the expanded DMX monitor from the keyboard", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  await page.keyboard.press(modifierShortcut("m"));
  await expect(page.getByText("DMX monitor")).toBeVisible();
  await page.keyboard.press(modifierShortcut("m"));
  await expect(page.getByText("DMX monitor")).toBeHidden();
});

test("opens the DMX monitor overlay from a peek channel click", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  await page.getByRole("button", { name: "Open DMX channel 1" }).click();
  const dialog = page.getByRole("dialog", { name: "DMX monitor" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Channel", { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Inspect DMX channel 1", exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText("Dimmer", { exact: true }).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("adds a lighting cue after the selected cue from the rail shortcut", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  const workspace = page.getByRole("main");
  await page.getByRole("button", { name: /2\. Interview look/i }).click();
  await page.keyboard.press("KeyC");

  await expect(
    workspace.getByRole("status").getByText(/Lighting cue 'Cue 3' was added\./i),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /3\. Cue 3/i })).toBeVisible();
});

test("edits the selected lighting cue inline from the inspector", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  const workspace = page.getByRole("main");
  await page.getByRole("button", { name: /2\. Interview look/i }).click();
  await page.keyboard.press("KeyE");
  await expect(page.getByLabel("Cue label")).toBeFocused();
  await page.getByLabel("Cue label").fill("Interview tighter");
  await page.getByLabel("Cue fade in").fill("1800");
  await page.getByLabel("Cue follow seconds").fill("2.5");
  await page.getByLabel("Cue notes").fill("Camera reset cue");
  await page.getByRole("button", { name: "Apply cue edits" }).click();

  await expect(
    workspace.getByRole("status").getByText(/Lighting cue 'Interview tighter' was updated\./i),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /2\. Interview tighter/i })).toBeVisible();
  await expect(page.getByText("Follow 2.5s")).toBeVisible();
});

test("deletes the selected lighting cue from the cue rail", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  const workspace = page.getByRole("main");
  await expect(page.getByRole("button", { name: /1\. Opening look/i })).toBeVisible();
  await page.getByRole("button", { name: "Delete cue" }).click();

  await expect(
    workspace.getByRole("status").getByText(/Lighting cue 'Opening look' was deleted\./i),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /1\. Opening look/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /1\. Interview look/i })).toBeVisible();
});

test("confirms Enter before firing a cue jump that is more than two steps away", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  const workspace = page.getByRole("main");
  const addCueButton = page.getByRole("button", { name: "+ Cue" });
  await page.getByRole("button", { name: /2\. Interview look/i }).click();
  await addCueButton.click();
  await expect(page.getByRole("button", { name: /3\. Cue 3/i })).toBeVisible();
  await page.getByRole("button", { name: /3\. Cue 3/i }).click();
  await addCueButton.click();
  await expect(page.getByRole("button", { name: /4\. Cue 4/i })).toBeVisible();
  await page.getByRole("button", { name: /4\. Cue 4/i }).click();
  await addCueButton.click();
  const cueFiveButton = page.getByRole("button", { name: /5\. Cue 5/i });
  await expect(cueFiveButton).toBeVisible();
  await cueFiveButton.click();
  await expect(workspace.getByText("Cue 5. Cue 5")).toBeVisible();
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });

  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toContainText("Jump to selected cue?");
  await page.getByRole("button", { name: "Fire jump cue" }).click();

  await expect(
    workspace.getByRole("status").getByText(/Lighting cue 'Cue 5' fired\./i),
  ).toBeVisible();
});

test("shows lighting DMX-unreachable posture and blackout hold", async ({ page }) => {
  await openFixture(page, "lighting-dmx-unreachable");

  const workspace = page.getByRole("main");
  await expect(page.getByText("DMX unreachable")).toBeVisible();
  await expect(page.getByRole("button", { name: "GO" })).toBeDisabled();
  await expect(workspace.getByText("No DMX — connect bridge.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Select fixture Key" })).toHaveAttribute(
    "data-stale",
    "true",
  );

  await openFixture(page, "lighting-populated");
  const blackoutButton = page.getByRole("button", { name: "Blackout" });
  const blackoutBox = await blackoutButton.boundingBox();
  expect(blackoutBox).not.toBeNull();
  await page.mouse.move(
    blackoutBox!.x + blackoutBox!.width / 2,
    blackoutBox!.y + blackoutBox!.height / 2,
  );
  await page.mouse.down();
  await page.waitForTimeout(450);
  await page.mouse.up();
  await expect(
    page.getByRole("main").getByRole("status").getByText(/All native lighting fixtures set off across 4 fixtures\./i),
  ).toBeVisible();
  await expect(page.getByTitle("Key · Dimmer").first()).toContainText("00");
});

test("supports shell keyboard overlays and workspace switching", async ({ page }) => {
  await openFixture(page, "setup-required");

  await page.keyboard.press("Shift+/");
  await expect(page.getByRole("dialog", { name: "Keyboard model" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Keyboard model" })).toBeHidden();

  await page.keyboard.press("Shift+S");
  await expect(page.getByRole("heading", { name: "Backup and recovery" })).toBeVisible();
  await page.keyboard.press("Shift+S");
  await expect(page.getByRole("heading", { name: "Import the Companion profile" })).toBeVisible();

  await page.keyboard.press("Tab");
  await expect(page.getByRole("heading", { name: "Probe hardware" })).toBeVisible();

  await page.keyboard.press("Tab");
  await expect(page.getByRole("heading", { name: "Map bindings" })).toBeVisible();
  await expect(page.getByText("Project 1").last()).toBeVisible();

  await page.keyboard.press("Digit2");
  await expect(page.getByText("Task 1").last()).toBeVisible();

  await page.keyboard.press("KeyK");
  await expect(page.getByText("Task 2").last()).toBeVisible();

  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("heading", { name: "Probe hardware" })).toBeVisible();

  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("heading", { name: "Import the Companion profile" })).toBeVisible();

  await page.keyboard.press(modifierShortcut("Shift+KeyR"));
  await expect(page.getByRole("dialog", { name: "Restart engine bridge?" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Restart engine bridge?" })).toBeHidden();

  await page.keyboard.press(modifierShortcut("Digit2"));
  await expect(page.getByRole("heading", { name: "Import the Companion profile" })).toBeVisible();
});
