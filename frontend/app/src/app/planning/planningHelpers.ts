import type { StatusTone } from "@sse/design-system";
import type { JsonValue } from "@sse/engine-client";

import { asRecord, type PlanningProjectEntry, type PlanningTaskEntry, type SnapshotRecord } from "../shellData";

// ---------------------------------------------------------------------------
// Planning-domain types and constants
// ---------------------------------------------------------------------------

export const PLANNING_OVERLAP_PULSE_MS = 1200;

export interface PlanningTimeReportProjectEntry {
  projectId: string;
  taskCount: number;
  title: string;
  totalSeconds: number;
}

export interface PlanningTimeReportTaskEntry {
  isRunning: boolean;
  projectId: string;
  projectTitle: string;
  taskId: string;
  taskTitle: string;
  totalSeconds: number;
}

export interface PlanningTimeReportData {
  byProject: PlanningTimeReportProjectEntry[];
  byTask: PlanningTimeReportTaskEntry[];
  totalSeconds: number;
}

export type PlanningBoardStatus = "todo" | "in-progress" | "blocked" | "done";

// ---------------------------------------------------------------------------
// Time-axis formatting (used by the timeline header, the now-line, and the
// keyboard-driven day navigation).
// ---------------------------------------------------------------------------

export function formatPlanningHourLabel(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}

export function formatPlanningClockLabel(value: Date) {
  return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
}

export function planningDateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export function planningDateOnly(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

export function comparePlanningDates(left: Date, right: Date) {
  return planningDateOnly(left).getTime() - planningDateOnly(right).getTime();
}

export function formatPlanningDateLabel(value: Date, today: Date) {
  if (comparePlanningDates(value, today) === 0) {
    return "Today";
  }

  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
    weekday: "short",
  }).format(value);
}

export function planningMinutesForDate(value: Date) {
  return value.getHours() * 60 + value.getMinutes();
}

export function planningFractionForMinute(minute: number, startMinute: number, rangeMinutes: number) {
  return Math.max(0, Math.min(1, (minute - startMinute) / rangeMinutes));
}

export function planningPercentForMinute(minute: number, startMinute: number, rangeMinutes: number) {
  return `${planningFractionForMinute(minute, startMinute, rangeMinutes) * 100}%`;
}

export function planningWidthPercent(durationMinutes: number, rangeMinutes: number) {
  return `${Math.max(2, Math.min(100, (durationMinutes / rangeMinutes) * 100))}%`;
}

export function planningDateForMinute(day: Date, minute: number) {
  const next = planningDateOnly(day);
  next.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
  return next;
}

// ---------------------------------------------------------------------------
// Task scheduling (duration heuristics + overlap detection used by the
// timeline lane renderer and the project-detail overlay).
// ---------------------------------------------------------------------------

export function planningScheduledDurationSeconds(
  task: Pick<PlanningTaskEntry, "scheduledDurationSeconds" | "totalSeconds"> | null
) {
  const scheduledDuration = typeof task?.scheduledDurationSeconds === "number" ? task.scheduledDurationSeconds : null;
  if (scheduledDuration && scheduledDuration > 0) {
    return scheduledDuration;
  }

  const totalSeconds = typeof task?.totalSeconds === "number" ? task.totalSeconds : 0;
  if (totalSeconds > 0) {
    return totalSeconds;
  }

  return 15 * 60;
}

export function planningTaskWindow(
  task: Pick<PlanningTaskEntry, "scheduledDurationSeconds" | "scheduledStart" | "totalSeconds">,
  scheduledStartOverride?: string,
  scheduledDurationOverride?: number | null
) {
  const scheduledStart = scheduledStartOverride ?? task.scheduledStart;
  if (!scheduledStart) {
    return null;
  }

  const start = new Date(scheduledStart);
  if (Number.isNaN(start.getTime())) {
    return null;
  }

  const durationSeconds =
    typeof scheduledDurationOverride === "number" ? scheduledDurationOverride : planningScheduledDurationSeconds(task);
  return {
    end: start.getTime() + Math.max(1, durationSeconds) * 1000,
    start: start.getTime(),
  };
}

export function findPlanningOverlapTaskTitle(
  tasks: PlanningTaskEntry[],
  taskId: string,
  projectId: string,
  scheduledStart: string,
  scheduledDurationSeconds: number | null | undefined
) {
  const targetWindow = planningTaskWindow(
    {
      scheduledDurationSeconds: scheduledDurationSeconds ?? undefined,
      scheduledStart,
      totalSeconds: 0,
    },
    scheduledStart,
    scheduledDurationSeconds ?? undefined
  );
  if (!targetWindow) {
    return null;
  }

  for (const task of tasks) {
    if (task.id === taskId || task.projectId !== projectId) {
      continue;
    }

    const comparisonWindow = planningTaskWindow(task);
    if (!comparisonWindow) {
      continue;
    }

    if (targetWindow.start < comparisonWindow.end && comparisonWindow.start < targetWindow.end) {
      return task.title;
    }
  }

  return null;
}

export function buildPlanningLaneOverlapMap(tasks: PlanningTaskEntry[]) {
  const overlapTitles = new Map<string, string>();
  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index];
    const taskWindow = planningTaskWindow(task);
    if (!taskWindow) {
      continue;
    }

    for (let compareIndex = index + 1; compareIndex < tasks.length; compareIndex += 1) {
      const comparisonTask = tasks[compareIndex];
      if (comparisonTask.projectId !== task.projectId) {
        continue;
      }

      const comparisonWindow = planningTaskWindow(comparisonTask);
      if (!comparisonWindow) {
        continue;
      }

      if (taskWindow.start < comparisonWindow.end && comparisonWindow.start < taskWindow.end) {
        if (!overlapTitles.has(task.id)) {
          overlapTitles.set(task.id, comparisonTask.title);
        }
        if (!overlapTitles.has(comparisonTask.id)) {
          overlapTitles.set(comparisonTask.id, task.title);
        }
      }
    }
  }

  return overlapTitles;
}

// ---------------------------------------------------------------------------
// Status / search / labelling helpers for the board view, project detail
// header chips, and the activity-log feed.
// ---------------------------------------------------------------------------

export function planningStatusTone(status: string): StatusTone {
  switch (status) {
    case "blocked":
      return "error";
    case "done":
      return "healthy";
    case "in-progress":
      return "connected";
    default:
      return "idle";
  }
}

function asList(value: unknown): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

export function planningNormalizedSearchText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

export function planningProjectMatchesSearch(project: PlanningProjectEntry, tasks: PlanningTaskEntry[], query: string) {
  if (!query) {
    return true;
  }

  const projectText = [project.title, project.description, project.status, project.priority].join(" ").toLowerCase();

  if (projectText.includes(query)) {
    return true;
  }

  return tasks.some((task) =>
    [task.title, task.description, task.priority, task.labels.join(", ")].join(" ").toLowerCase().includes(query)
  );
}

export function formatPlanningDuration(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return "0s";
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export function parsePlanningTimeReport(value: JsonValue): PlanningTimeReportData {
  const record = asRecord(value) ?? {};
  const byProject = asList(record.byProject)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is SnapshotRecord => entry !== null)
    .map((entry) => ({
      projectId: typeof entry.projectId === "string" ? entry.projectId : "",
      taskCount: typeof entry.taskCount === "number" ? entry.taskCount : 0,
      title: typeof entry.title === "string" ? entry.title : "Unknown",
      totalSeconds: typeof entry.totalSeconds === "number" ? entry.totalSeconds : 0,
    }));
  const byTask = asList(record.byTask)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is SnapshotRecord => entry !== null)
    .map((entry) => ({
      isRunning: entry.isRunning === true,
      projectId: typeof entry.projectId === "string" ? entry.projectId : "",
      projectTitle: typeof entry.projectTitle === "string" ? entry.projectTitle : "Unknown",
      taskId: typeof entry.taskId === "string" ? entry.taskId : "",
      taskTitle: typeof entry.taskTitle === "string" ? entry.taskTitle : "Task",
      totalSeconds: typeof entry.totalSeconds === "number" ? entry.totalSeconds : 0,
    }));

  return {
    byProject,
    byTask,
    totalSeconds: typeof record.totalSeconds === "number" ? record.totalSeconds : 0,
  };
}

export function formatPlanningEnumLabel(value: string) {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatPlanningTaskTimer(totalSeconds: number) {
  const value = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = value % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function planningTaskIsBlocked(task: Pick<PlanningTaskEntry, "labels">) {
  return task.labels.some((label) => {
    const normalized = label.trim().toLowerCase();
    return normalized === "blocked" || normalized === "block";
  });
}

export function planningTaskStateLabel(task: PlanningTaskEntry) {
  if (task.completed) {
    return "Done";
  }
  if (planningTaskIsBlocked(task)) {
    return "Blocked";
  }
  if (task.isRunning) {
    return "In progress";
  }
  return "Todo";
}

export function planningDueDateTone(dueDate?: string) {
  if (!dueDate) {
    return "default";
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${dueDate}T00:00:00`);
  const diffDays = Math.floor((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return "error";
  }
  if (diffDays <= 3) {
    return "warning";
  }
  return "default";
}

export function planningDueDateLabel(dueDate?: string) {
  if (!dueDate) {
    return null;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${dueDate}T00:00:00`);
  const diffDays = Math.floor((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return `Overdue (${dueDate})`;
  }
  if (diffDays === 0) {
    return "Due today";
  }
  return `Due ${dueDate}`;
}

export function formatPlanningRelativeTimestamp(isoValue?: string) {
  if (!isoValue) {
    return "";
  }

  const timestamp = Date.parse(isoValue);
  if (Number.isNaN(timestamp)) {
    return "";
  }

  const diffMinutes = Math.floor((Date.now() - timestamp) / 60000);
  if (diffMinutes < 1) {
    return "just now";
  }
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}
