import { expect, test } from "@playwright/test";

import { openFixture } from "./helpers/openFixture";

// plan PR 4 / workstream D4: planning workspace specs split out of
// operator-shell.spec.ts. Covers timeline, board, project detail overlay,
// reschedule + drag flows, toolbar actions, empty/loading postures.

test("renders the planning timeline from an engine-backed snapshot and toggles board mode", async ({ page }) => {
  await openFixture(page, "planning-populated");

  const workspace = page.getByTestId("planning-workspace");
  await expect(page.getByRole("heading", { name: "Planning timeline" })).toHaveCount(0);
  await expect(workspace.getByRole("tab", { name: "Timeline" })).toHaveAttribute("data-active", "true");
  await expect(workspace.getByText("evening_service")).toBeVisible();
  await expect(workspace.getByRole("button", { name: /Commission Stream Deck\+ · Booth 2/i })).toBeVisible();
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
    })
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
    })
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
  const timelineTab = workspace.getByRole("tab", { name: "Timeline" });
  const search = workspace.getByLabel("Search planning tasks");

  await timelineTab.click();
  await page.keyboard.press("/");
  await expect(search).toBeFocused();
  await search.fill("stream deck");
  await expect(workspace.getByText("booth_2")).toBeVisible();
  await expect(workspace.getByText("audio")).toHaveCount(0);

  await timelineTab.click();
  await page.keyboard.press("KeyS");
  await expect(search).toBeFocused();

  await timelineTab.click();
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
