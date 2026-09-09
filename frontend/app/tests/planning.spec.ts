import { expect, test } from "@playwright/test";

import { openFixture } from "./helpers/openFixture";

// plan PR 4 / workstream D4: planning workspace specs split out of
// operator-shell.spec.ts. Covers timeline, board, the plate, reschedule + drag
// flows, cluster actions, empty/loading postures.
//
// Visual overhaul A, Slice 6 (plan D1): Planning moved onto the cluster rule.
// The mode switch, the day keys, the projects, the running timers and the
// standing actions are portalled into the SHELL's cluster region, so they are
// no longer inside `planning-workspace` — assertions on them scope to
// `planning-cluster` instead. The project-detail dialog became the always-on
// plate (`planning-project-detail`), which lives inside the workspace, so
// timeline-card lookups scope to their lane to stay unambiguous.

test("renders the planning timeline from an engine-backed snapshot and toggles board mode", async ({ page }) => {
  await openFixture(page, "planning-populated");

  const workspace = page.getByTestId("planning-workspace");
  const cluster = page.getByTestId("planning-cluster");
  await expect(page.getByRole("heading", { name: "Planning timeline" })).toHaveCount(0);
  // PLA-06 (Slice 10d-1): the mode + filter toggles are role="radio"/aria-checked,
  // not the old role="tab"/data-active tablist. Slice 6: the mode switch is a
  // segmented well on the shell's cluster; the filters ride the screen header.
  await expect(cluster.getByRole("radio", { name: "Timeline" })).toHaveAttribute("aria-checked", "true");
  await expect(workspace.getByText("evening_service")).toBeVisible();
  await expect(
    workspace.getByTestId("planning-lane-proj-booth-2").getByRole("button", {
      name: /Commission Stream Deck\+ · Booth 2/i,
    })
  ).toBeVisible();
  await expect(workspace.getByText("Archive Q3 cue library")).toBeVisible();
  await expect(page.getByTestId("planning-now-playhead")).toBeVisible();
  // PLA-03/DENSITY-03 (Slice 10c) as re-cut by Slice 6: the band divides evenly
  // between the lanes (A-planning.html's `laneH = (H - axis) / lanes`), so five
  // lanes on the studio monitor are taller than the retired 150px ceiling and
  // still leave room for a card's second row.
  const boothLaneBounds = await workspace.getByTestId("planning-lane-proj-booth-2").boundingBox();
  expect(boothLaneBounds?.height ?? 0).toBeGreaterThan(150);
  const timelineBounds = await workspace.getByTestId("planning-lane-proj-ops").boundingBox();
  expect(Math.abs((timelineBounds?.height ?? 0) - (boothLaneBounds?.height ?? 0))).toBeLessThanOrEqual(1);

  await page.keyboard.press("Shift+KeyB");
  await expect(cluster.getByRole("radio", { name: "Board" })).toHaveAttribute("aria-checked", "true");
  const boardCard = workspace.getByTestId("planning-board-card-proj-booth-2");
  await expect(boardCard).toBeVisible();
  await expect(boardCard).toHaveAttribute("data-running", "true");
  await expect(boardCard).toContainText("booth_2");
  await expect(boardCard).toContainText("P1");
  await expect(boardCard).toContainText("1/2 tasks");
  await expect(boardCard).toContainText("audio");
  await expect(boardCard).toContainText("control-surface");
  await expect(workspace.getByText("No projects in this column.")).toHaveCount(1);
  await expect(boardCard.getByText("booth_2")).toBeVisible();
  await page.keyboard.press("Digit4");
  await expect(workspace.getByRole("radio", { name: "Done" })).toHaveAttribute("aria-checked", "true");
  await expect(workspace.getByTestId("planning-board-empty-done")).toHaveAttribute("data-zero-filter", "true");
  await expect(workspace.getByText("No done projects. Press All to see the rest.")).toBeVisible();

  await page.keyboard.press("Shift+KeyT");
  await expect(cluster.getByRole("radio", { name: "Timeline" })).toHaveAttribute("aria-checked", "true");
  await expect(workspace.getByText("Filter: Done · 0 of 5 projects")).toBeVisible();
  await workspace.getByRole("button", { name: "Clear" }).click();
  await expect(
    workspace.getByTestId("planning-lane-proj-audio").getByRole("button", { name: /Level-match overflow/i })
  ).toBeVisible();
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

test("moves a planning board card across status columns from the keyboard", async ({ page }) => {
  await openFixture(page, "planning-populated");

  const workspace = page.getByTestId("planning-workspace");
  await page.keyboard.press("Shift+KeyB");

  const inProgressColumn = workspace.getByTestId("planning-board-column-in-progress");
  const blockedColumn = workspace.getByTestId("planning-board-column-blocked");
  const boothCard = workspace.getByTestId("planning-board-card-proj-booth-2");

  // CONTROLS-03: the card is now a focusable, keyboard-operable group.
  await expect(boothCard).toHaveAttribute("role", "group");
  await expect(boothCard).toHaveAttribute("tabindex", "0");
  await expect(boothCard).toHaveAttribute("aria-roledescription", "Draggable kanban card");

  await boothCard.focus();
  await expect(boothCard).toBeFocused();

  // ArrowRight moves in-progress -> blocked, reusing the drag reorder path.
  await page.keyboard.press("ArrowRight");
  await expect(blockedColumn.getByTestId("planning-board-card-proj-booth-2")).toBeVisible();
  await expect(blockedColumn.getByTestId("planning-board-card-proj-booth-2")).toHaveAttribute("data-blocked", "true");
  await expect(inProgressColumn.getByTestId("planning-board-card-proj-booth-2")).toHaveCount(0);
});

test("reorders a planning board card within its column from the keyboard", async ({ page }) => {
  await openFixture(page, "planning-populated");

  const workspace = page.getByTestId("planning-workspace");
  await page.keyboard.press("Shift+KeyB");

  const inProgressColumn = workspace.getByTestId("planning-board-column-in-progress");
  const inProgressCards = inProgressColumn.locator('[data-testid^="planning-board-card-"]');
  await expect(inProgressCards.nth(0)).toHaveAttribute("data-testid", "planning-board-card-proj-booth-2");
  await expect(inProgressCards.nth(1)).toHaveAttribute("data-testid", "planning-board-card-proj-audio");

  await workspace.getByTestId("planning-board-card-proj-booth-2").focus();
  // ArrowDown reorders booth_2 one position later within in-progress.
  await page.keyboard.press("ArrowDown");
  await expect(inProgressCards.nth(0)).toHaveAttribute("data-testid", "planning-board-card-proj-audio");
  await expect(inProgressCards.nth(1)).toHaveAttribute("data-testid", "planning-board-card-proj-booth-2");
});

test("selects a planning board card with Enter from the keyboard", async ({ page }) => {
  await openFixture(page, "planning-populated");

  const workspace = page.getByTestId("planning-workspace");
  await page.keyboard.press("Shift+KeyB");

  // proj-booth-2 is the seeded selection; selecting another card via the
  // keyboard must move the selection.
  const opsCard = workspace.getByTestId("planning-board-card-proj-ops");
  await opsCard.focus();
  await page.keyboard.press("Enter");
  await expect(opsCard).toHaveAttribute("data-selected", "true");
  await expect(workspace.getByTestId("planning-board-card-proj-booth-2")).toHaveAttribute("data-selected", "false");
});

test("supports planning timeline selection, keyboard reschedule, and local day navigation", async ({ page }) => {
  await openFixture(page, "planning-populated");

  const workspace = page.getByTestId("planning-workspace");
  const cluster = page.getByTestId("planning-cluster");
  const plate = page.getByTestId("planning-project-detail");
  const dayKey = cluster.getByTestId("planning-day-today");
  const selectedTask = workspace
    .getByTestId("planning-lane-proj-booth-2")
    .getByRole("button", { name: /Commission Stream Deck\+ · Booth 2/i });

  await selectedTask.click();
  await expect(selectedTask).toHaveAttribute("data-selected", "true");
  await expect(selectedTask).toHaveAttribute("data-time-label", "18:24");

  await page.keyboard.press("ArrowRight");
  await expect(selectedTask).toHaveAttribute("data-time-label", "18:39");

  await page.keyboard.press("ArrowDown");
  await expect(workspace.getByText("Commission Stream Deck+ · Booth 2 · running")).toBeVisible();
  // Slice 6: Enter used to open the project-detail dialog; the plate is always
  // on screen, so it puts the task's project on the plate instead.
  await page.keyboard.press("Enter");
  await expect(plate).toHaveAttribute("aria-label", "audio");

  await page.keyboard.press("ArrowUp");
  await expect(workspace.getByText("Commission Stream Deck+ · Booth 2 · running")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(plate).toHaveAttribute("aria-label", "booth_2");

  await page.keyboard.press("BracketRight");
  await expect(workspace.getByText(/10:00 – 23:00/)).toBeVisible();

  await page.keyboard.press("Shift+BracketRight");
  await expect(dayKey).toHaveAttribute("aria-label", /^Go to today/);

  await page.keyboard.press("0");
  await expect(dayKey).toHaveAttribute("aria-label", /^Today ·/);
  await expect(selectedTask).toBeVisible();
});

test("reschedules a planning timeline block by drag into another lane", async ({ page }) => {
  await openFixture(page, "planning-populated");

  const workspace = page.getByTestId("planning-workspace");
  const audioLane = workspace.getByTestId("planning-lane-body-proj-audio");
  const taskBlock = workspace
    .getByTestId("planning-lane-proj-booth-2")
    .getByRole("button", { name: /Commission Stream Deck\+ · Booth 2/i });

  await taskBlock.dragTo(audioLane, {
    targetPosition: { x: 420, y: 42 },
  });

  await expect(
    workspace.locator('[data-testid^="planning-lane-proj-"] button[data-row]', {
      hasText: /Commission Stream Deck\+ · Booth 2/,
    })
  ).toHaveCount(1);
  await expect(workspace.getByText("Commission Stream Deck+ · Booth 2 · running")).toBeVisible();
});

test("keeps the retained project detail on the plate, from timeline selection and board detail targets", async ({
  page,
}) => {
  await openFixture(page, "planning-populated");

  const workspace = page.getByTestId("planning-workspace");
  await workspace
    .getByTestId("planning-lane-proj-booth-2")
    .getByRole("button", { name: /Commission Stream Deck\+ · Booth 2/i })
    .click();
  await page.keyboard.press("Enter");

  // Slice 6 (plan D1): the same controls, on the plate rather than in a dialog.
  const detailDialog = page.getByTestId("planning-project-detail");
  await expect(detailDialog).toBeVisible();
  await expect(detailDialog).toHaveAttribute("aria-label", "booth_2");
  await expect(detailDialog.getByText("1/2 complete")).toBeVisible();
  await expect(detailDialog.getByText("Verify OSC bindings")).toBeVisible();
  // The plate names the selected task in its head and again in the project's
  // task list; the head is the one that says what is in front of the operator.
  await expect(detailDialog.getByRole("heading", { name: "Commission Stream Deck+ · Booth 2" })).toBeVisible();
  await expect(detailDialog.getByText("Stream Deck+ booth commissioning resumed.")).toBeVisible();
  // Slice 8 (system §9): the box is labelled with the press it makes, so the
  // label itself flips — one locator before the click, one after.
  const checklistToggle = detailDialog.getByRole("button", {
    name: "Mark 'Verify companion trigger handoff' done on Commission Stream Deck+ · Booth 2",
    exact: true,
  });
  await expect(checklistToggle).toHaveAttribute("data-done", "false");
  await checklistToggle.click();
  await expect(
    detailDialog.getByRole("button", {
      name: "Mark 'Verify companion trigger handoff' not done on Commission Stream Deck+ · Booth 2",
      exact: true,
    })
  ).toHaveAttribute("data-done", "true");
  await expect(detailDialog.getByText("Checklist item checked")).toBeVisible();
  await detailDialog.getByTestId("planning-plate-complete").click();
  await expect(detailDialog.getByText("2/2 complete")).toBeVisible();
  await expect(detailDialog.getByText('Task "Commission Stream Deck+ · Booth 2" marked as completed')).toBeVisible();
  await detailDialog.getByTestId("planning-plate-add-task").click();
  await detailDialog.getByLabel("New task for booth_2").fill("Run booth handoff");
  await detailDialog.getByRole("button", { name: "Add task", exact: true }).click();
  await expect(detailDialog.getByText("2/3 complete")).toBeVisible();
  // Slice 8: the row's box and the plate's take key now say the same thing —
  // they do the same thing — so this looks for the row's.
  await expect(
    detailDialog.locator('[data-testid^="planning-plate-task-"]').getByRole("button", {
      name: "Mark Run booth handoff done",
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
      name: "Mark 'Pack backup SD image' done on Run booth handoff",
      exact: true,
    })
  ).toBeVisible();
  await expect(detailDialog.getByText('Checklist item "Pack backup SD image" added')).toBeVisible();
  await page.keyboard.press("Shift+KeyB");
  await workspace.getByRole("button", { name: "Show ops on the plate" }).click();
  await expect(detailDialog).toHaveAttribute("aria-label", "ops");
  await workspace.getByRole("button", { name: "Show booth_2 on the plate" }).click();
  await expect(detailDialog).toHaveAttribute("aria-label", "booth_2");
});

test("surfaces planning lane overlap after a reschedule write", async ({ page }) => {
  await openFixture(page, "planning-overlap");

  const workspace = page.getByTestId("planning-workspace");
  const selectedTask = workspace
    .getByTestId("planning-lane-proj-overlap")
    .getByRole("button", { name: /Program note runthrough/i });

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
  const taskChip = workspace.getByRole("button", { name: "Select Archive Q3 cue library, unscheduled" });

  await expect(workspace.getByText("Drag a card onto a lane to put it on the day.")).toBeVisible();
  await expect(tray).toHaveAttribute("data-expanded", "true");
  await expect(tray).toHaveAttribute("data-all-unscheduled", "true");

  await taskChip.dragTo(lane);

  const scheduledCard = workspace
    .getByTestId("planning-lane-proj-ops")
    .getByRole("button", { name: /Archive Q3 cue library/i });
  await expect(scheduledCard).toBeVisible();
  await expect(scheduledCard).toContainText("15 min · P3");
  await expect(workspace.getByRole("button", { name: "Select Archive Q3 cue library, unscheduled" })).toHaveCount(0);
});

test("supports planning cluster project creation and backup export", async ({ page }) => {
  await openFixture(page, "planning-empty");

  const workspace = page.getByTestId("planning-workspace");
  const cluster = page.getByTestId("planning-cluster");
  await expect(workspace.getByText("No projects yet. Press N to start one.")).toBeVisible();

  await page.keyboard.press("KeyN");
  const projectTitle = cluster.getByLabel("New project title");
  await expect(projectTitle).toBeFocused();
  await projectTitle.fill("studio_patch");
  await cluster.getByTestId("planning-add-project").click();
  await expect(workspace.getByText("Created project 'studio_patch'.")).toBeVisible();
  await expect(cluster.getByText("studio_patch", { exact: true })).toBeVisible();

  await cluster.getByTestId("planning-backup").click();
  await expect(workspace.getByText(/Exported support backup to/)).toBeVisible();
});

test("supports planning screen search focus and engine-backed time report", async ({ page }) => {
  await openFixture(page, "planning-populated");

  const workspace = page.getByTestId("planning-workspace");
  const cluster = page.getByTestId("planning-cluster");
  const timelineTab = cluster.getByRole("radio", { name: "Timeline" });
  const search = workspace.getByLabel("Search tasks and projects");

  await timelineTab.click();
  await page.keyboard.press("/");
  await expect(search).toBeFocused();
  await search.fill("stream deck");
  await expect(workspace.getByTestId("planning-lane-proj-booth-2")).toBeVisible();
  await expect(workspace.getByTestId("planning-lane-proj-audio")).toHaveCount(0);

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
  await expect(page.getByTestId("planning-cluster").getByRole("radio", { name: "Board" })).toHaveAttribute(
    "aria-checked",
    "true"
  );
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
  await expect(workspace.getByText("Loading planning…")).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Visual overhaul A, Slice 6 (plan Slice 6): the cluster rule on Planning.
// ---------------------------------------------------------------------------

test("the cluster and the screen header never wrap", async ({ page }) => {
  await openFixture(page, "planning-populated");

  const cluster = page.getByTestId("planning-cluster");
  await expect(cluster).toBeVisible();

  // H11: nothing in the cluster reaches past its own column, and nothing on the
  // screen header falls onto a second line.
  const clusterBox = await cluster.boundingBox();
  const overflowing = await cluster.evaluate((root) => {
    const bounds = root.getBoundingClientRect();
    return [...root.querySelectorAll("*")]
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.right > bounds.right + 1;
      })
      .map((node) => (node as HTMLElement).dataset.testid ?? node.className)
      .slice(0, 5);
  });
  expect(overflowing, "no cluster element runs past the cluster").toEqual([]);
  expect(clusterBox?.width ?? 0).toBeGreaterThan(300);

  const head = await page.getByTestId("planning-screen").evaluate((frame) => {
    const row = frame.firstElementChild as HTMLElement | null;
    if (!row) return null;
    const bounds = row.getBoundingClientRect();
    return {
      height: Math.round(bounds.height),
      centres: [...row.children].map((child) => {
        const rect = child.getBoundingClientRect();
        return Math.round(rect.top + rect.height / 2);
      }),
      overflowing: [...row.querySelectorAll("*")].some((node) => {
        const el = node as HTMLElement;
        return el.scrollWidth > el.clientWidth + 1 && el.tagName !== "INPUT";
      }),
    };
  });
  // One row of a fixed height, every child on the same centreline, and nothing
  // inside it clipped: the header cannot have wrapped.
  expect(head!.height, "the screen header stays one row tall").toBeLessThanOrEqual(34);
  expect(new Set(head!.centres).size, "the screen header stays on one row").toBe(1);
  expect(head!.overflowing, "nothing on the screen header is clipped").toBe(false);
});

test("planning-overlap renders overlapping cards in a second row with no clipped title", async ({ page }) => {
  await openFixture(page, "planning-overlap");

  const lane = page.getByTestId("planning-workspace").getByTestId("planning-lane-proj-overlap");
  const first = lane.getByRole("button", { name: /Program note runthrough/i });
  const second = lane.getByRole("button", { name: /Projector handoff/i });

  // The mock's rule: a card whose box would cover another card in the lane
  // drops to the next row instead of sitting on top of it.
  await expect(first).toHaveAttribute("data-row", "0");
  await expect(second).toHaveAttribute("data-row", "1");

  const firstBox = await first.boundingBox();
  const secondBox = await second.boundingBox();
  expect(secondBox!.y).toBeGreaterThan(firstBox!.y + firstBox!.height - 1);

  // Both titles are printed in full: the card is wide enough for them.
  for (const card of [first, second]) {
    const clipped = await card.locator('[class*="planningBlockTitle"]').evaluate((node) => {
      const el = node as HTMLElement;
      return el.scrollWidth > el.clientWidth + 1;
    });
    expect(clipped).toBe(false);
  }
});

test("a card past the axis end hangs to the left of its start and its bar is clipped", async ({ page }) => {
  await openFixture(page, "planning-populated");

  const workspace = page.getByTestId("planning-workspace");
  const lane = workspace.getByTestId("planning-lane-proj-evening-service");
  // 20:30 + 120 min runs past the 22:00 axis end on the 09:00–22:00 day.
  const lateCard = lane.getByRole("button", { name: /Draft run-of-show · Tue/i });
  await expect(lateCard).toHaveAttribute("data-hangs-left", "true");

  const laneBodyBox = await lane.locator('[class*="planningLaneBody"]').boundingBox();
  const cardBox = await lateCard.boundingBox();
  const barBox = await workspace.getByTestId("planning-bar-task-draft-run-of-show").boundingBox();

  // The card sits to the left of where the bar starts, and neither leaves the axis.
  expect(cardBox!.x + cardBox!.width).toBeLessThanOrEqual(barBox!.x + 1);
  expect(barBox!.x + barBox!.width).toBeLessThanOrEqual(laneBodyBox!.x + laneBodyBox!.width + 1);
});

test("selecting a task populates the plate; Escape clears it", async ({ page }) => {
  await openFixture(page, "planning-populated");

  const workspace = page.getByTestId("planning-workspace");
  const plate = page.getByTestId("planning-project-detail");
  const card = workspace
    .getByTestId("planning-lane-proj-evening-service")
    .getByRole("button", { name: /Draft run-of-show · Tue/i });

  await card.click();
  await expect(plate.getByRole("heading", { name: "Draft run-of-show · Tue" })).toBeVisible();
  await expect(plate.getByTestId("planning-plate-schedule")).toContainText("20:30");
  await expect(plate.getByTestId("planning-plate-schedule")).toContainText("120 min");

  await page.keyboard.press("Escape");
  // The plate stays — it is the shell's right column, not a dialog — but the
  // task comes off it and the project it belongs to is what is left.
  await expect(plate.getByRole("heading", { name: "Draft run-of-show · Tue" })).toHaveCount(0);
  await expect(plate).toHaveAttribute("aria-label", "evening_service");
  await expect(card).toHaveAttribute("data-selected", "false");
});

test("a running timer renders the live key on the plate and the row in the cluster", async ({ page }) => {
  await openFixture(page, "planning-populated");

  const cluster = page.getByTestId("planning-cluster");
  const plate = page.getByTestId("planning-project-detail");

  // The cluster names both running timers, with what the engine reports about
  // them: the project, when they started, and how long they have run.
  const timerRow = cluster.getByTestId("planning-running-timer-task-commission-streamdeck");
  await expect(timerRow).toContainText("booth_2");
  await expect(timerRow).toContainText("started 18:24");
  await expect(timerRow).toContainText("1h 18m");
  await expect(cluster.getByTestId("planning-running-timer-task-level-match")).toContainText("42m");

  // The selected task is the running one, so the plate's key is lit and says
  // what pressing it does.
  const timerKey = plate.getByTestId("planning-plate-timer");
  await expect(timerKey).toHaveAttribute("aria-pressed", "true");
  await expect(timerKey).toContainText("Running");
  await expect(timerKey).toContainText("1h 18m · stop");

  // Stopping it from the cluster takes the row away and unlights the key.
  await cluster.getByTestId("planning-stop-timer-task-commission-streamdeck").click();
  await expect(timerRow).toHaveCount(0);
  await expect(timerKey).toHaveAttribute("aria-pressed", "false");
  await expect(cluster.getByTestId("planning-running-section")).toContainText("1 timer");
});
