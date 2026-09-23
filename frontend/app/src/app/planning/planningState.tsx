import type { ReactNode } from "react";
import type { StateDisplayTone } from "@sse/design-system";

import type { PlanningProjectEntry, PlanningTaskEntry } from "../shellData";
import {
  comparePlanningDates,
  formatPlanningClockLabel,
  planningDateKey,
  planningMinutesForDate,
  planningScheduledDurationSeconds,
} from "./planningHelpers";

// Visual overhaul A, Slice 6 (plan D1, D10): what the day is, in one word, one
// sentence and one line of counts — all of it counted from the tasks the engine
// reports. `ON TIME` and `SLIPPED` are the only two words: a blocked project is
// a count on the meta line, not a state of the day.

export type PlanningStateWord = "ON TIME" | "SLIPPED";

export interface PlanningDayFacts {
  /** Projects with a task blocked on somebody else, named. */
  blockedProjectNames: string[];
  /** `Thursday 23 April`, or `Today` shape handled by the day key. */
  dayLabel: string;
  /** `Thu 23 Apr` — the same day where the chrome is narrower. */
  dayShortLabel: string;
  doneCount: number;
  /** `09:30` — the first scheduled start on the day. */
  firstStartLabel: string | null;
  /** `22:30` — the last scheduled end on the day. */
  lastEndLabel: string | null;
  runningTasks: PlanningTaskEntry[];
  scheduledCount: number;
  /** Tasks whose scheduled end has passed with the task still open. */
  slippedCount: number;
  /** Seconds the timers have put on each project today, biggest first. */
  trackedByProject: { projectId: string; seconds: number; title: string }[];
  trackedTotalSeconds: number;
  unscheduledCount: number;
}

export interface PlanningState {
  word: PlanningStateWord;
  tone: StateDisplayTone;
  /** The day, what is on it, and when it runs. */
  sentence: string;
  /** The counts line; the blocked count is emphasised when there is one. */
  meta: ReactNode;
}

/** `1h 18m`, `42m`, `4m` — the deck's shape, no seconds. */
export function formatPlanningElapsed(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return "0m";
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.round((totalSeconds % 3600) / 60);
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${Math.max(1, minutes)}m`;
}

export function formatPlanningDayLabel(day: Date) {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long", weekday: "long" }).format(day);
}

export function formatPlanningDayShortLabel(day: Date) {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", weekday: "short" }).format(day);
}

export interface PlanningDayFactsInput {
  day: Date;
  now: Date;
  projects: readonly PlanningProjectEntry[];
  /** Every task the engine reports, scheduled or not. */
  tasks: readonly PlanningTaskEntry[];
}

export function derivePlanningDayFacts({ day, now, projects, tasks }: PlanningDayFactsInput): PlanningDayFacts {
  const dayKey = planningDateKey(day);
  const scheduled = tasks.filter((task) => {
    if (!task.scheduledStart) return false;
    const start = new Date(task.scheduledStart);
    return !Number.isNaN(start.getTime()) && planningDateKey(start) === dayKey;
  });
  const unscheduled = tasks.filter((task) => !task.scheduledStart || !task.scheduledDurationSeconds);

  // Only a day that has already begun can have slipped: on a future day
  // nothing has had its chance yet, on a past day the clock is at its end.
  const dayComparedToToday = comparePlanningDates(day, now);
  const nowMinute = planningMinutesForDate(now);
  const slippedCount =
    dayComparedToToday > 0
      ? 0
      : scheduled.filter((task) => {
          if (task.completed) return false;
          const start = new Date(task.scheduledStart ?? "");
          if (Number.isNaN(start.getTime())) return false;
          const endMinute = planningMinutesForDate(start) + planningScheduledDurationSeconds(task) / 60;
          return dayComparedToToday < 0 || endMinute < nowMinute;
        }).length;

  let firstStart: Date | null = null;
  let lastEnd: Date | null = null;
  for (const task of scheduled) {
    const start = new Date(task.scheduledStart ?? "");
    if (Number.isNaN(start.getTime())) continue;
    const end = new Date(start.getTime() + planningScheduledDurationSeconds(task) * 1000);
    if (!firstStart || start < firstStart) firstStart = start;
    if (!lastEnd || end > lastEnd) lastEnd = end;
  }

  const trackedByProject = projects
    .map((project) => ({
      projectId: project.id,
      seconds: tasks
        .filter((task) => task.projectId === project.id)
        .reduce((total, task) => total + Math.max(0, task.totalSeconds), 0),
      title: project.title,
    }))
    .filter((entry) => entry.seconds > 0)
    .sort((left, right) => right.seconds - left.seconds);

  const blockedTaskProjectIds = new Set(
    projects.filter((project) => project.status === "blocked").map((project) => project.id)
  );

  return {
    blockedProjectNames: projects
      .filter((project) => blockedTaskProjectIds.has(project.id))
      .map((project) => project.title),
    dayLabel: formatPlanningDayLabel(day),
    dayShortLabel: formatPlanningDayShortLabel(day),
    doneCount: scheduled.filter((task) => task.completed).length,
    firstStartLabel: firstStart ? formatPlanningClockLabel(firstStart) : null,
    lastEndLabel: lastEnd ? formatPlanningClockLabel(lastEnd) : null,
    runningTasks: tasks.filter((task) => task.isRunning),
    scheduledCount: scheduled.length,
    slippedCount,
    trackedByProject,
    trackedTotalSeconds: trackedByProject.reduce((total, entry) => total + entry.seconds, 0),
    unscheduledCount: unscheduled.length,
  };
}

export function derivePlanningState(facts: PlanningDayFacts): PlanningState {
  const window =
    facts.firstStartLabel && facts.lastEndLabel ? ` · ${facts.firstStartLabel} – ${facts.lastEndLabel}` : "";
  const scheduledWord = facts.scheduledCount === 1 ? "task" : "tasks";
  const sentence = `${facts.dayLabel} · ${facts.scheduledCount} ${scheduledWord} scheduled${window}`;
  const blockedCount = facts.blockedProjectNames.length;
  const timerWord = facts.runningTasks.length === 1 ? "timer" : "timers";

  const meta: ReactNode = [
    `${facts.slippedCount} slipped`,
    blockedCount > 0 ? (
      <b key="blocked">
        {blockedCount} blocked · {facts.blockedProjectNames.join(", ")}
      </b>
    ) : (
      "0 blocked"
    ),
    `${facts.doneCount} done`,
    `${facts.runningTasks.length} ${timerWord} running`,
    `${facts.unscheduledCount} unscheduled`,
  ].reduce<ReactNode[]>((parts, part, index) => {
    if (index > 0) parts.push(<span key={`sep-${index}`}> · </span>);
    parts.push(typeof part === "string" ? <span key={`part-${index}`}>{part}</span> : part);
    return parts;
  }, []);

  if (facts.slippedCount > 0) {
    return { word: "SLIPPED", tone: "attention", sentence, meta };
  }

  return { word: "ON TIME", tone: "ok", sentence, meta };
}
