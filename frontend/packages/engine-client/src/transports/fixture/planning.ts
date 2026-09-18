// Part of the fixture double (`../fixtureTransport.ts`): the in-memory stand-in for the
// hardware link that Playwright and the browser fixture mode run against. Test-only.
import type { JsonObject } from "../../generated/protocol";
import type { MutableFixtureState } from "./state";
import { asRecord, asArray, asString, asNumber, asBoolean } from "./json";

export function buildDefaultPlanningSnapshot(): JsonObject {
  return {
    projects: [],
    tasks: [],
    activityLog: [],
    settings: {
      viewFilter: "all",
      sortBy: "manual",
      dashboardView: "kanban",
      deckMode: "project",
      modeSection: "timeline",
      timelineStartHour: 9,
      timelineEndHour: 22,
      selectedProjectId: null,
      selectedTaskId: null,
    },
    counts: {
      projectCount: 0,
      taskCount: 0,
      runningTaskCount: 0,
      completedTaskCount: 0,
    },
  };
}

export function buildSeededPlanningSnapshot(): JsonObject {
  return {
    projects: [
      {
        id: "proj-evening-service",
        title: "evening_service",
        description: "Tuesday evening run-of-show.",
        status: "todo",
        priority: "p1",
        createdAt: "2026-04-23T08:00:00+02:00",
        lastUpdated: "2026-04-23T19:12:00+02:00",
        order: 1,
      },
      {
        id: "proj-booth-2",
        title: "booth_2",
        description: "Secondary booth deck commissioning.",
        status: "in-progress",
        priority: "p1",
        createdAt: "2026-04-23T08:10:00+02:00",
        lastUpdated: "2026-04-23T19:24:00+02:00",
        order: 2,
      },
      {
        id: "proj-audio",
        title: "audio",
        description: "Audio desk prep and tuning.",
        status: "in-progress",
        priority: "p1",
        createdAt: "2026-04-23T08:20:00+02:00",
        lastUpdated: "2026-04-23T19:18:00+02:00",
        order: 3,
      },
      {
        id: "proj-lighting",
        title: "lighting",
        description: "Lighting fixes waiting on ops.",
        status: "blocked",
        priority: "p0",
        createdAt: "2026-04-23T08:30:00+02:00",
        lastUpdated: "2026-04-23T18:52:00+02:00",
        order: 4,
      },
      {
        id: "proj-ops",
        title: "ops",
        description: "Shared operator maintenance.",
        status: "todo",
        priority: "p2",
        createdAt: "2026-04-23T08:40:00+02:00",
        lastUpdated: "2026-04-23T16:06:00+02:00",
        order: 5,
      },
    ],
    tasks: [
      {
        id: "task-import-profile",
        projectId: "proj-evening-service",
        title: "Import companion profile",
        description: "",
        priority: "p2",
        dueDate: null,
        labels: ["setup"],
        checklist: [],
        isRunning: false,
        totalSeconds: 1200,
        lastStarted: null,
        completed: true,
        order: 1,
        createdAt: "2026-04-23T09:05:00+02:00",
        scheduledStart: "2026-04-23T09:30:00+02:00",
        scheduledDurationSeconds: 1200,
      },
      {
        id: "task-probe-hardware",
        projectId: "proj-evening-service",
        title: "Probe hardware · DMX/OSC",
        description: "",
        priority: "p1",
        dueDate: null,
        labels: ["setup"],
        checklist: [],
        isRunning: false,
        totalSeconds: 2100,
        lastStarted: null,
        completed: true,
        order: 2,
        createdAt: "2026-04-23T09:50:00+02:00",
        scheduledStart: "2026-04-23T10:15:00+02:00",
        scheduledDurationSeconds: 2100,
      },
      {
        id: "task-house-light",
        projectId: "proj-evening-service",
        title: 'House-light scene "preshow"',
        description: "",
        priority: "p1",
        dueDate: null,
        labels: ["lighting"],
        checklist: [],
        isRunning: false,
        totalSeconds: 2100,
        lastStarted: null,
        completed: true,
        order: 3,
        createdAt: "2026-04-23T16:00:00+02:00",
        scheduledStart: "2026-04-23T16:35:00+02:00",
        scheduledDurationSeconds: 2100,
      },
      {
        id: "task-draft-run-of-show",
        projectId: "proj-evening-service",
        title: "Draft run-of-show · Tue",
        description: "",
        priority: "p0",
        dueDate: null,
        labels: ["planning"],
        checklist: [],
        isRunning: false,
        totalSeconds: 0,
        lastStarted: null,
        completed: false,
        order: 4,
        createdAt: "2026-04-23T18:00:00+02:00",
        scheduledStart: "2026-04-23T20:30:00+02:00",
        scheduledDurationSeconds: 7200,
      },
      {
        id: "task-verify-osc",
        projectId: "proj-booth-2",
        title: "Verify OSC bindings",
        description: "",
        priority: "p1",
        dueDate: null,
        labels: ["audio"],
        checklist: [],
        isRunning: false,
        totalSeconds: 1080,
        lastStarted: null,
        completed: true,
        order: 1,
        createdAt: "2026-04-23T16:00:00+02:00",
        scheduledStart: "2026-04-23T16:24:00+02:00",
        scheduledDurationSeconds: 1080,
      },
      {
        id: "task-commission-streamdeck",
        projectId: "proj-booth-2",
        title: "Commission Stream Deck+ · Booth 2",
        description: "",
        priority: "p0",
        dueDate: null,
        labels: ["control-surface"],
        checklist: [],
        isRunning: true,
        totalSeconds: 4680,
        lastStarted: "2026-04-23T18:24:00+02:00",
        completed: false,
        order: 2,
        createdAt: "2026-04-23T18:10:00+02:00",
        scheduledStart: "2026-04-23T18:24:00+02:00",
        scheduledDurationSeconds: 5100,
      },
      {
        id: "task-level-match",
        projectId: "proj-audio",
        title: "Level-match overflow",
        description: "",
        priority: "p1",
        dueDate: null,
        labels: ["audio"],
        checklist: [],
        isRunning: true,
        totalSeconds: 2520,
        lastStarted: "2026-04-23T19:00:00+02:00",
        completed: false,
        order: 1,
        createdAt: "2026-04-23T18:45:00+02:00",
        scheduledStart: "2026-04-23T19:00:00+02:00",
        scheduledDurationSeconds: 5400,
      },
      {
        id: "task-dmx-splitter",
        projectId: "proj-lighting",
        title: "DMX splitter · stage right",
        description: "",
        priority: "p0",
        dueDate: null,
        labels: ["lighting"],
        checklist: [],
        isRunning: false,
        totalSeconds: 0,
        lastStarted: null,
        completed: false,
        order: 1,
        createdAt: "2026-04-23T16:45:00+02:00",
        scheduledStart: "2026-04-23T17:00:00+02:00",
        scheduledDurationSeconds: 10800,
      },
      {
        id: "task-save-backup",
        projectId: "proj-ops",
        title: "Save backup · pre-service",
        description: "",
        priority: "p2",
        dueDate: null,
        labels: ["support"],
        checklist: [],
        isRunning: false,
        totalSeconds: 240,
        lastStarted: null,
        completed: true,
        order: 1,
        createdAt: "2026-04-23T15:50:00+02:00",
        scheduledStart: "2026-04-23T16:02:00+02:00",
        scheduledDurationSeconds: 240,
      },
      {
        id: "task-archive-cues",
        projectId: "proj-ops",
        title: "Archive Q3 cue library",
        description: "",
        priority: "p3",
        dueDate: null,
        labels: ["support"],
        checklist: [],
        isRunning: false,
        totalSeconds: 0,
        lastStarted: null,
        completed: false,
        order: 2,
        createdAt: "2026-04-23T10:30:00+02:00",
        scheduledStart: null,
        scheduledDurationSeconds: null,
      },
    ],
    activityLog: [
      {
        id: "planning-activity-1",
        timestamp: "2026-04-23T18:24:00+02:00",
        entityType: "task",
        entityId: "task-commission-streamdeck",
        action: "timer-started",
        detail: "Stream Deck+ booth commissioning resumed.",
      },
      {
        id: "planning-activity-2",
        timestamp: "2026-04-23T19:00:00+02:00",
        entityType: "task",
        entityId: "task-level-match",
        action: "timer-started",
        detail: "Audio level-matching is in progress.",
      },
    ],
    settings: {
      viewFilter: "all",
      sortBy: "manual",
      dashboardView: "kanban",
      deckMode: "project",
      modeSection: "timeline",
      timelineStartHour: 9,
      timelineEndHour: 22,
      selectedProjectId: "proj-booth-2",
      selectedTaskId: "task-commission-streamdeck",
    },
  };
}

export function normalizePlanningModeSection(value: unknown) {
  return value === "board" ? "board" : "timeline";
}

export function normalizePlanningViewFilter(value: unknown) {
  return value === "todo" || value === "in-progress" || value === "blocked" || value === "done" ? value : "all";
}

export function normalizePlanningProjectStatus(value: unknown) {
  return value === "in-progress" || value === "blocked" || value === "done" ? value : "todo";
}

export function normalizePlanningPriority(value: unknown) {
  return value === "p0" || value === "p1" || value === "p3" ? value : "p2";
}

export function buildPlanningTimeReport(state: MutableFixtureState, projectId?: string | null): JsonObject {
  const planningSnapshot = asRecord(state.planningSnapshot) ?? buildDefaultPlanningSnapshot();
  const projects = asArray(planningSnapshot.projects)
    .map((project) => asRecord(project))
    .filter((project): project is JsonObject => project !== null);
  const tasks = asArray(planningSnapshot.tasks)
    .map((task) => asRecord(task))
    .filter((task): task is JsonObject => task !== null)
    .filter((task) => (projectId ? asString(task.projectId) === projectId : true));
  const activityLog = asArray(planningSnapshot.activityLog)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is JsonObject => entry !== null);

  const projectTotals = new Map<string, JsonObject>();
  for (const task of tasks) {
    const taskProjectId = asString(task.projectId);
    if (!taskProjectId) {
      continue;
    }

    const project = projects.find((entry) => asString(entry.id) === taskProjectId) ?? null;
    const entry = projectTotals.get(taskProjectId) ?? {
      projectId: taskProjectId,
      title: asString(project?.title, "Unknown"),
      totalSeconds: 0,
      taskCount: 0,
    };
    entry.totalSeconds = asNumber(entry.totalSeconds) + Math.max(0, asNumber(task.totalSeconds));
    entry.taskCount = asNumber(entry.taskCount) + 1;
    projectTotals.set(taskProjectId, entry);
  }

  const byProject = Array.from(projectTotals.values()).sort(
    (left, right) => asNumber(right.totalSeconds) - asNumber(left.totalSeconds)
  );

  const byTask = tasks
    .filter((task) => asNumber(task.totalSeconds) > 0)
    .map((task) => {
      const taskProjectId = asString(task.projectId);
      const project = projects.find((entry) => asString(entry.id) === taskProjectId) ?? null;
      return {
        taskId: asString(task.id),
        taskTitle: asString(task.title, "Task"),
        projectId: taskProjectId,
        projectTitle: asString(project?.title, "Unknown"),
        totalSeconds: Math.max(0, asNumber(task.totalSeconds)),
        isRunning: asBoolean(task.isRunning),
        lastStarted: typeof task.lastStarted === "string" ? task.lastStarted : null,
      };
    })
    .sort((left, right) => asNumber(right.totalSeconds) - asNumber(left.totalSeconds));

  const timerEvents = activityLog
    .filter((entry) => {
      const action = asString(entry.action);
      return (
        action === "timer-started" ||
        action === "timer-stopped" ||
        action === "timer_started" ||
        action === "timer_stopped"
      );
    })
    .slice(0, 100);

  return {
    totalSeconds: tasks.reduce((total, task) => total + Math.max(0, asNumber(task.totalSeconds)), 0),
    byProject,
    byTask,
    timerEvents,
  };
}
