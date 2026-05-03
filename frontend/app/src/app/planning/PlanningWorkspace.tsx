import {
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { StatusBadge } from "@sse/design-system";
import type { PlanningSnapshot, ShellStore } from "@sse/engine-client";

import {
  asRecord,
  getPlanningActivityLog,
  getPlanningCounts,
  getPlanningProjects,
  getPlanningSettings,
  getPlanningTasks,
  isEditableTarget,
  type PlanningProjectEntry,
  type PlanningTaskEntry,
  type SnapshotRecord,
} from "../shellData";
import planningStyles from "./PlanningWorkspace.module.css";
import { type ActionFeedback } from "../startup/startupHelpers";
import { useLiveCallback } from "../shared/useLiveCallback";
import { PlanningClockIcon } from "./icons";
import { PlanningProjectDetailOverlay } from "./PlanningProjectDetailOverlay";
import { PlanningTimeReportOverlay } from "./PlanningTimeReportOverlay";
import {
  PLANNING_OVERLAP_PULSE_MS,
  type PlanningBoardStatus,
  type PlanningTimeReportData,
  buildPlanningLaneOverlapMap,
  comparePlanningDates,
  findPlanningOverlapTaskTitle,
  formatPlanningClockLabel,
  formatPlanningDateLabel,
  formatPlanningHourLabel,
  parsePlanningTimeReport,
  planningDateForMinute,
  planningDateKey,
  planningDateOnly,
  planningFractionForMinute,
  planningMinutesForDate,
  planningNormalizedSearchText,
  planningPercentForMinute,
  planningProjectMatchesSearch,
  planningScheduledDurationSeconds,
  planningStatusTone,
  planningWidthPercent,
} from "./planningHelpers";

export function PlanningWorkspaceSurface({
  appSnapshot,
  planningSnapshot,
  store,
}: {
  appSnapshot: SnapshotRecord | null;
  planningSnapshot: PlanningSnapshot | null;
  store: ShellStore;
}) {
  const projects = useMemo(() => getPlanningProjects(planningSnapshot), [planningSnapshot]);
  const tasks = useMemo(() => getPlanningTasks(planningSnapshot), [planningSnapshot]);
  const activityLog = useMemo(() => getPlanningActivityLog(planningSnapshot), [planningSnapshot]);
  const counts = useMemo(() => getPlanningCounts(planningSnapshot), [planningSnapshot]);
  const settings = useMemo(() => getPlanningSettings(planningSnapshot), [planningSnapshot]);
  const loadingModeSection = (() => {
    const planning = asRecord(appSnapshot?.planning);
    return planning?.modeSection === "board" ? "board" : "timeline";
  })();
  const [now, setNow] = useState(() => new Date());
  const [timelineDay, setTimelineDay] = useState(() => planningDateOnly(new Date()));
  const [timelineOffsetMinutes, setTimelineOffsetMinutes] = useState(0);
  const [planningBusyAction, setPlanningBusyAction] = useState<string | null>(null);
  const [planningFeedback, setPlanningFeedback] = useState<ActionFeedback | null>(null);
  const [planningSearchQuery, setPlanningSearchQuery] = useState("");
  const deferredPlanningSearchQuery = useDeferredValue(planningNormalizedSearchText(planningSearchQuery));
  const [projectComposerOpen, setProjectComposerOpen] = useState(false);
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [planningTimeReportOpen, setPlanningTimeReportOpen] = useState(false);
  const [planningTimeReportLoading, setPlanningTimeReportLoading] = useState(false);
  const [planningTimeReportError, setPlanningTimeReportError] = useState<string | null>(null);
  const [planningTimeReport, setPlanningTimeReport] = useState<PlanningTimeReportData | null>(null);
  const [planningProjectDetailOpen, setPlanningProjectDetailOpen] = useState(false);
  const [planningProjectDetailProjectId, setPlanningProjectDetailProjectId] = useState<string | null>(null);
  const [planningProjectDetailTaskId, setPlanningProjectDetailTaskId] = useState<string | null>(null);
  const [planningOverlapPulseTaskId, setPlanningOverlapPulseTaskId] = useState<string | null>(null);
  const [trayExpanded, setTrayExpanded] = useState(false);
  const [draggingScheduledTaskId, setDraggingScheduledTaskId] = useState<string | null>(null);
  const [draggingUnscheduledTaskId, setDraggingUnscheduledTaskId] = useState<string | null>(null);
  const [draggingBoardProjectId, setDraggingBoardProjectId] = useState<string | null>(null);
  const [planningDropTarget, setPlanningDropTarget] = useState<{
    minute: number;
    projectId: string;
  } | null>(null);
  const [planningBoardDropTarget, setPlanningBoardDropTarget] = useState<{
    index: number;
    status: PlanningBoardStatus;
  } | null>(null);
  const [planningTimelineViewportHeight, setPlanningTimelineViewportHeight] = useState<number | null>(null);
  const newProjectTitleRef = useRef<HTMLInputElement | null>(null);
  const planningSearchInputRef = useRef<HTMLInputElement | null>(null);
  const planningOverlapPulseTimerRef = useRef<number | null>(null);
  const planningTimeReportOpenRef = useRef(false);
  const planningProjectDetailOpenRef = useRef(false);
  const planningTimelineRef = useRef<HTMLDivElement | null>(null);
  const selectedTimelineTaskRef = useRef<PlanningTaskEntry | null>(null);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(new Date());
    }, 60_000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!projectComposerOpen) {
      return;
    }

    newProjectTitleRef.current?.focus();
    newProjectTitleRef.current?.select();
  }, [projectComposerOpen]);

  useEffect(() => {
    planningTimeReportOpenRef.current = planningTimeReportOpen;
  }, [planningTimeReportOpen]);

  useEffect(() => {
    planningProjectDetailOpenRef.current = planningProjectDetailOpen;
  }, [planningProjectDetailOpen]);

  useEffect(
    () => () => {
      if (planningOverlapPulseTimerRef.current !== null) {
        window.clearTimeout(planningOverlapPulseTimerRef.current);
      }
    },
    []
  );

  const timelineBaseStartMinute = settings.timelineStartHour * 60;
  const timelineBaseEndMinute = settings.timelineEndHour * 60;
  const timelineRangeMinutes = Math.max(60, timelineBaseEndMinute - timelineBaseStartMinute);
  const maxTimelineStartMinute = Math.max(0, 24 * 60 - timelineRangeMinutes);
  const timelineStartMinute = Math.max(
    0,
    Math.min(maxTimelineStartMinute, timelineBaseStartMinute + timelineOffsetMinutes)
  );
  const timelineEndMinute = timelineStartMinute + timelineRangeMinutes;
  const timelineDayKey = planningDateKey(timelineDay);
  const currentMinute = planningMinutesForDate(now);
  const clampedNowMinute =
    comparePlanningDates(timelineDay, now) < 0
      ? timelineEndMinute
      : comparePlanningDates(timelineDay, now) > 0
        ? timelineStartMinute
        : Math.max(timelineStartMinute, Math.min(timelineEndMinute, currentMinute));
  const nowLabel = formatPlanningClockLabel(now);
  const viewDayLabel = formatPlanningDateLabel(timelineDay, now);
  const viewIsToday = comparePlanningDates(timelineDay, now) === 0;
  const allScheduledTasks = tasks.filter((task) => {
    if (!task.scheduledStart || !task.scheduledDurationSeconds) {
      return false;
    }
    const scheduledStart = new Date(task.scheduledStart);
    if (Number.isNaN(scheduledStart.getTime())) {
      return false;
    }
    return planningDateKey(scheduledStart) === timelineDayKey;
  });
  const filteredProjects = useMemo(
    () =>
      projects.filter((project) => {
        if (settings.viewFilter !== "all" && project.status !== settings.viewFilter) {
          return false;
        }

        const projectTasks = tasks.filter((task) => task.projectId === project.id);
        return planningProjectMatchesSearch(project, projectTasks, deferredPlanningSearchQuery);
      }),
    [deferredPlanningSearchQuery, projects, settings.viewFilter, tasks]
  );
  const filteredProjectIds = useMemo(() => new Set(filteredProjects.map((project) => project.id)), [filteredProjects]);
  useEffect(() => {
    if (settings.modeSection !== "timeline") {
      setPlanningTimelineViewportHeight(null);
      return;
    }

    const timelineElement = planningTimelineRef.current;
    if (!timelineElement) {
      return;
    }

    const updateViewportHeight = () => {
      setPlanningTimelineViewportHeight(timelineElement.getBoundingClientRect().height);
    };

    updateViewportHeight();
    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      updateViewportHeight();
    });
    observer.observe(timelineElement);
    return () => observer.disconnect();
  }, [filteredProjects.length, settings.modeSection]);
  const visibleScheduledTasks = allScheduledTasks.filter((task) => filteredProjectIds.has(task.projectId));
  const unscheduledTasks = tasks.filter((task) => !task.scheduledStart || !task.scheduledDurationSeconds);
  const visibleUnscheduledTasks = unscheduledTasks.filter((task) => filteredProjectIds.has(task.projectId));
  const filteredTaskCount = tasks.filter((task) => filteredProjectIds.has(task.projectId)).length;
  const allTasksUnscheduled = filteredTaskCount > 0 && visibleScheduledTasks.length === 0;
  const draggingScheduledTask =
    (draggingScheduledTaskId ? tasks.find((task) => task.id === draggingScheduledTaskId) : undefined) ?? null;
  const draggingUnscheduledTask =
    (draggingUnscheduledTaskId
      ? visibleUnscheduledTasks.find((task) => task.id === draggingUnscheduledTaskId)
      : null) ?? null;
  const draggingTimelineTask = draggingScheduledTask ?? draggingUnscheduledTask;
  const unscheduledTrayExpanded = trayExpanded || allTasksUnscheduled || draggingUnscheduledTask !== null;
  const selectedTask = tasks.find((task) => task.id === settings.selectedTaskId) ?? visibleScheduledTasks[0] ?? null;
  const selectedTimelineTask =
    selectedTask?.scheduledStart && planningDateKey(new Date(selectedTask.scheduledStart)) === timelineDayKey
      ? selectedTask
      : null;
  useEffect(() => {
    selectedTimelineTaskRef.current = selectedTimelineTask;
  }, [selectedTimelineTask]);
  const tasksByProjectId = new Map(
    filteredProjects.map((project) => [
      project.id,
      visibleScheduledTasks
        .filter((task) => task.projectId === project.id)
        .sort((left, right) => {
          const leftStart = left.scheduledStart ? new Date(left.scheduledStart).getTime() : 0;
          const rightStart = right.scheduledStart ? new Date(right.scheduledStart).getTime() : 0;
          return leftStart - rightStart;
        }),
    ])
  );
  const planningOverlapTitlesByTaskId = useMemo(
    () => buildPlanningLaneOverlapMap(visibleScheduledTasks),
    [visibleScheduledTasks]
  );
  const planningProjectDetailProject =
    (planningProjectDetailProjectId
      ? projects.find((project) => project.id === planningProjectDetailProjectId)
      : null) ?? null;
  const planningProjectDetailTasks = useMemo(
    () =>
      planningProjectDetailProject
        ? tasks
            .filter((task) => task.projectId === planningProjectDetailProject.id)
            .sort((left, right) => left.order - right.order)
        : [],
    [planningProjectDetailProject, tasks]
  );
  const planningProjectDetailSelectedTask =
    (planningProjectDetailTaskId
      ? planningProjectDetailTasks.find((task) => task.id === planningProjectDetailTaskId)
      : null) ??
    (settings.selectedTaskId ? planningProjectDetailTasks.find((task) => task.id === settings.selectedTaskId) : null) ??
    planningProjectDetailTasks[0] ??
    null;
  const planningProjectDetailTaskIds = useMemo(
    () => new Set(planningProjectDetailTasks.map((task) => task.id)),
    [planningProjectDetailTasks]
  );
  const planningProjectDetailActivity = useMemo(
    () =>
      planningProjectDetailProject
        ? activityLog.filter(
            (entry) =>
              entry.entityId === planningProjectDetailProject.id || planningProjectDetailTaskIds.has(entry.entityId)
          )
        : [],
    [activityLog, planningProjectDetailProject, planningProjectDetailTaskIds]
  );
  const planningProjectDetailCompletedTaskCount = planningProjectDetailTasks.filter((task) => task.completed).length;
  const planningProjectDetailTotalSeconds = planningProjectDetailTasks.reduce(
    (total, task) => total + task.totalSeconds,
    0
  );
  const planningProjectDetailChecklistTotals = planningProjectDetailTasks.reduce(
    (totals, task) => ({
      done: totals.done + task.checklist.filter((item) => item.done).length,
      total: totals.total + task.checklist.length,
    }),
    { done: 0, total: 0 }
  );
  const planningProjectDetailProgressValue =
    planningProjectDetailTasks.length > 0
      ? planningProjectDetailCompletedTaskCount / planningProjectDetailTasks.length
      : 0;

  useEffect(() => {
    if (!planningProjectDetailOpen) {
      return;
    }

    if (planningProjectDetailProject) {
      return;
    }

    setPlanningProjectDetailOpen(false);
    setPlanningProjectDetailProjectId(null);
    setPlanningProjectDetailTaskId(null);
  }, [planningProjectDetailOpen, planningProjectDetailProject]);

  const blockedCount = projects.filter((project) => project.status === "blocked").length;
  const slippedCount = visibleScheduledTasks.filter((task) => {
    if (task.completed) {
      return false;
    }
    const scheduledStart = task.scheduledStart ? new Date(task.scheduledStart) : null;
    if (!scheduledStart || Number.isNaN(scheduledStart.getTime())) {
      return false;
    }
    const taskEndMinute = planningMinutesForDate(scheduledStart) + (task.scheduledDurationSeconds ?? 0) / 60;
    return taskEndMinute < currentMinute;
  }).length;
  const onTimeCount = Math.max(0, visibleScheduledTasks.length - slippedCount - blockedCount);
  const timelineTicks = Array.from(
    { length: Math.ceil(timelineRangeMinutes / 60) + 1 },
    (_, index) => Math.floor(timelineStartMinute / 60) + index
  );
  const timelineMinorTicks = Array.from(
    { length: Math.max(0, Math.floor(timelineRangeMinutes / 30) - 1) },
    (_, index) => timelineStartMinute + (index + 1) * 30
  ).filter((minute) => minute % 60 !== 0);
  const timelineLaneHeight = (() => {
    const defaultLaneHeight = 84;
    const minimumLaneHeight = 48;
    if (!planningTimelineViewportHeight || filteredProjects.length === 0) {
      return defaultLaneHeight;
    }

    const compressedLaneHeight = Math.floor(planningTimelineViewportHeight / filteredProjects.length);
    return Math.max(minimumLaneHeight, Math.min(defaultLaneHeight, compressedLaneHeight));
  })();
  const planningTimelineVariables = {
    "--planning-half-hour-count": String(Math.max(1, Math.round(timelineRangeMinutes / 30))),
    "--planning-hour-count": String(Math.max(1, Math.round(timelineRangeMinutes / 60))),
    "--planning-lane-height": `${timelineLaneHeight}px`,
  } as CSSProperties;
  const hasPlanningSearch = deferredPlanningSearchQuery.length > 0;
  const showSearchZeroResult = hasPlanningSearch && filteredProjects.length === 0;
  const showFilterBanner = settings.viewFilter !== "all";
  const togglePlanningMode = (modeSection: "timeline" | "board") => {
    if (settings.modeSection === modeSection) {
      return;
    }
    void store.updatePlanningSettings({ modeSection });
  };

  const updatePlanningViewFilter = useLiveCallback(
    (viewFilter: "all" | "todo" | "in-progress" | "blocked" | "done") => {
      void store.updatePlanningSettings({ viewFilter });
    }
  );

  const selectPlanningTask = useLiveCallback((taskId: string, projectId: string) => {
    selectedTimelineTaskRef.current = tasks.find((task) => task.id === taskId) ?? null;
    void store.updatePlanningSettings({
      selectedProjectId: projectId,
      selectedTaskId: taskId,
    });
  });

  const closePlanningProjectDetail = useLiveCallback(() => {
    planningProjectDetailOpenRef.current = false;
    setPlanningProjectDetailOpen(false);
  });

  const openPlanningProjectDetail = useLiveCallback((projectId: string, taskId?: string | null) => {
    const projectTasks = tasks
      .filter((task) => task.projectId === projectId)
      .sort((left, right) => left.order - right.order);
    const nextTaskId = taskId ?? projectTasks[0]?.id ?? null;

    setPlanningProjectDetailProjectId(projectId);
    setPlanningProjectDetailTaskId(nextTaskId);
    planningProjectDetailOpenRef.current = true;
    setPlanningProjectDetailOpen(true);
    void store.updatePlanningSettings({
      selectedProjectId: projectId,
      selectedTaskId: nextTaskId,
    });
  });

  const selectPlanningProjectDetailTask = useLiveCallback((taskId: string, projectId: string) => {
    setPlanningProjectDetailProjectId(projectId);
    setPlanningProjectDetailTaskId(taskId);
    void store.updatePlanningSettings({
      selectedProjectId: projectId,
      selectedTaskId: taskId,
    });
  });

  const togglePlanningProjectDetailTaskComplete = useLiveCallback(async (taskId: string) => {
    await store.togglePlanningTaskComplete(taskId);
  });

  const createPlanningProjectDetailTask = useLiveCallback(async (projectId: string, title: string) => {
    return store.createPlanningTask({ projectId, title });
  });

  const createPlanningProjectDetailChecklistItem = useLiveCallback(async (taskId: string, text: string) => {
    return store.addPlanningChecklistItem(taskId, text);
  });

  const togglePlanningProjectDetailChecklistItem = useLiveCallback(
    async (taskId: string, itemId: string, done: boolean) => {
      await store.setPlanningChecklistItemDone(taskId, itemId, done);
    }
  );

  const reschedulePlanningTask = useLiveCallback(async (taskId: string, deltaMinutes: number) => {
    const task = tasks.find((entry) => entry.id === taskId) ?? null;
    if (!task?.scheduledStart) {
      return;
    }

    const nextScheduledStart = new Date(task.scheduledStart);
    if (Number.isNaN(nextScheduledStart.getTime())) {
      return;
    }

    nextScheduledStart.setMinutes(nextScheduledStart.getMinutes() + deltaMinutes);
    const overlapTitle = findPlanningOverlapTaskTitle(
      tasks,
      task.id,
      task.projectId,
      nextScheduledStart.toISOString(),
      task.scheduledDurationSeconds ?? null
    );
    await store.reschedulePlanningTask({
      taskId,
      scheduledDurationSeconds: task.scheduledDurationSeconds ?? null,
      scheduledStart: nextScheduledStart.toISOString(),
    });
    selectedTimelineTaskRef.current = {
      ...task,
      scheduledStart: nextScheduledStart.toISOString(),
    };
    pulsePlanningOverlap(overlapTitle ? task.id : null);
  });

  const movePlanningTaskToAdjacentLane = useLiveCallback(async (taskId: string, direction: -1 | 1) => {
    const task = tasks.find((entry) => entry.id === taskId) ?? null;
    if (!task?.scheduledStart) {
      return;
    }

    const currentLaneIndex = filteredProjects.findIndex((project) => project.id === task.projectId);
    if (currentLaneIndex < 0) {
      return;
    }

    const targetProject = filteredProjects[currentLaneIndex + direction] ?? null;
    if (!targetProject || targetProject.id === task.projectId) {
      return;
    }

    const overlapTitle = findPlanningOverlapTaskTitle(
      tasks,
      taskId,
      targetProject.id,
      task.scheduledStart,
      planningScheduledDurationSeconds(task)
    );
    await store.reschedulePlanningTask({
      projectId: targetProject.id,
      taskId,
      scheduledDurationSeconds: task.scheduledDurationSeconds ?? null,
      scheduledStart: task.scheduledStart ?? null,
    });
    selectedTimelineTaskRef.current = {
      ...task,
      projectId: targetProject.id,
    };
    pulsePlanningOverlap(overlapTitle ? task.id : null);
  });

  const reorderPlanningProject = useLiveCallback(
    async (projectId: string, newStatus: PlanningBoardStatus, newIndex: number) => {
      await store.reorderPlanningProject({ newIndex, newStatus, projectId });
    }
  );

  const clearPlanningBoardDragState = useLiveCallback(() => {
    setDraggingBoardProjectId(null);
    setPlanningBoardDropTarget(null);
  });

  const resolvePlanningBoardDropIndex = useLiveCallback(
    (targetStatus: PlanningBoardStatus, targetProjects: PlanningProjectEntry[], rawIndex: number) => {
      const draggedProject = projects.find((project) => project.id === draggingBoardProjectId) ?? null;
      const sameStatus = draggedProject?.status === targetStatus;
      const sourceIndex = sameStatus
        ? targetProjects.findIndex((project) => project.id === draggingBoardProjectId)
        : -1;
      let nextIndex = rawIndex;
      if (sourceIndex >= 0 && sourceIndex < nextIndex) {
        nextIndex -= 1;
      }
      const maxIndex = Math.max(0, targetProjects.length - (sameStatus ? 1 : 0));
      return Math.max(0, Math.min(maxIndex, nextIndex));
    }
  );

  const minuteForLaneDrop = useLiveCallback((event: ReactDragEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) {
      return timelineStartMinute;
    }

    const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const rawMinute = timelineStartMinute + fraction * timelineRangeMinutes;
    const snappedMinute = Math.round(rawMinute / 15) * 15;
    return Math.max(timelineStartMinute, Math.min(timelineEndMinute - 15, snappedMinute));
  });

  const updatePlanningDropTarget = useLiveCallback((event: ReactDragEvent<HTMLDivElement>, projectId: string) => {
    if (draggingScheduledTask) {
      setPlanningDropTarget({
        minute: minuteForLaneDrop(event),
        projectId,
      });
      return true;
    }

    if (!draggingUnscheduledTask || draggingUnscheduledTask.projectId !== projectId) {
      setPlanningDropTarget(null);
      return false;
    }

    setPlanningDropTarget({
      minute: minuteForLaneDrop(event),
      projectId,
    });
    return true;
  });

  const rescheduleScheduledTaskByDrop = useLiveCallback(async (taskId: string, projectId: string, minute: number) => {
    const task = tasks.find((entry) => entry.id === taskId) ?? null;
    if (!task) {
      return;
    }

    const scheduledStart = planningDateForMinute(timelineDay, minute).toISOString();
    const overlapTitle = findPlanningOverlapTaskTitle(
      tasks,
      taskId,
      projectId,
      scheduledStart,
      planningScheduledDurationSeconds(task)
    );
    await store.reschedulePlanningTask({
      projectId,
      taskId,
      scheduledDurationSeconds: planningScheduledDurationSeconds(task),
      scheduledStart,
    });
    selectedTimelineTaskRef.current = {
      ...task,
      projectId,
      scheduledStart,
    };
    pulsePlanningOverlap(overlapTitle ? taskId : null);
  });

  const scheduleUnscheduledTask = useLiveCallback(async (taskId: string, projectId: string, minute: number) => {
    const task = tasks.find((entry) => entry.id === taskId) ?? null;
    if (!task || task.projectId !== projectId) {
      return;
    }

    const scheduledStart = planningDateForMinute(timelineDay, minute).toISOString();
    const overlapTitle = findPlanningOverlapTaskTitle(
      tasks,
      taskId,
      projectId,
      scheduledStart,
      planningScheduledDurationSeconds(task)
    );
    await store.reschedulePlanningTask({
      taskId,
      scheduledDurationSeconds: planningScheduledDurationSeconds(task),
      scheduledStart,
    });
    await store.updatePlanningSettings({
      selectedProjectId: projectId,
      selectedTaskId: taskId,
    });
    pulsePlanningOverlap(overlapTitle ? taskId : null);
  });

  const snapTimelineToNow = useLiveCallback(() => {
    const nextDay = planningDateOnly(new Date());
    const centeredStartMinute = Math.round(currentMinute - timelineRangeMinutes / 2);
    setTimelineDay(nextDay);
    setTimelineOffsetMinutes(centeredStartMinute - timelineBaseStartMinute);
  });

  const openProjectComposer = useLiveCallback(() => {
    setProjectComposerOpen(true);
    setPlanningFeedback(null);
  });

  const closeProjectComposer = useLiveCallback(() => {
    setProjectComposerOpen(false);
    setNewProjectTitle("");
  });

  const createPlanningProject = useLiveCallback(async () => {
    const title = newProjectTitle.trim();
    if (!title) {
      return;
    }

    setPlanningBusyAction("project-create");
    setPlanningFeedback(null);
    try {
      const result = asRecord(await store.createPlanningProject({ title }));
      setPlanningFeedback({
        message: String(
          result?.project && asRecord(result.project)?.title
            ? `Created project '${asRecord(result.project)?.title}'.`
            : `Created project '${title}'.`
        ),
        tone: "ok",
      });
      setProjectComposerOpen(false);
      setNewProjectTitle("");
    } catch (error) {
      setPlanningFeedback({
        message: error instanceof Error ? error.message : "The project could not be created.",
        tone: "error",
      });
    } finally {
      setPlanningBusyAction(null);
    }
  });

  const exportPlanningBackup = useLiveCallback(async () => {
    setPlanningBusyAction("backup-export");
    setPlanningFeedback(null);
    try {
      const result = asRecord(await store.exportSupportBackup());
      setPlanningFeedback({
        message: `Exported support backup to ${String(result?.path ?? "the backup archive")}.`,
        tone: "info",
      });
    } catch (error) {
      setPlanningFeedback({
        message: error instanceof Error ? error.message : "The support backup could not be exported.",
        tone: "error",
      });
    } finally {
      setPlanningBusyAction(null);
    }
  });

  const focusPlanningSearch = useLiveCallback(() => {
    planningSearchInputRef.current?.focus();
    planningSearchInputRef.current?.select();
  });

  const clearPlanningFilters = useLiveCallback(() => {
    setPlanningSearchQuery("");
    if (settings.viewFilter !== "all") {
      void store.updatePlanningSettings({ viewFilter: "all" });
    }
  });

  const loadPlanningTimeReport = useLiveCallback(async () => {
    setPlanningTimeReportLoading(true);
    setPlanningTimeReportError(null);
    try {
      const result = await store.readPlanningTimeReport();
      setPlanningTimeReport(parsePlanningTimeReport(result));
    } catch (error) {
      setPlanningTimeReportError(
        error instanceof Error ? error.message : "The planning time report could not be loaded."
      );
    } finally {
      setPlanningTimeReportLoading(false);
    }
  });

  const openPlanningTimeReport = useLiveCallback(() => {
    planningTimeReportOpenRef.current = true;
    setPlanningTimeReportOpen(true);
    void loadPlanningTimeReport();
  });

  const closePlanningTimeReport = useLiveCallback(() => {
    planningTimeReportOpenRef.current = false;
    setPlanningTimeReportOpen(false);
  });

  const togglePlanningTimeReport = useLiveCallback(() => {
    if (planningTimeReportOpenRef.current) {
      closePlanningTimeReport();
      return;
    }

    openPlanningTimeReport();
  });

  const pulsePlanningOverlap = useLiveCallback((taskId: string | null) => {
    if (planningOverlapPulseTimerRef.current !== null) {
      window.clearTimeout(planningOverlapPulseTimerRef.current);
      planningOverlapPulseTimerRef.current = null;
    }

    if (!taskId) {
      setPlanningOverlapPulseTaskId(null);
      return;
    }

    setPlanningOverlapPulseTaskId(taskId);
    planningOverlapPulseTimerRef.current = window.setTimeout(() => {
      setPlanningOverlapPulseTaskId((currentTaskId) => (currentTaskId === taskId ? null : currentTaskId));
      planningOverlapPulseTimerRef.current = null;
    }, PLANNING_OVERLAP_PULSE_MS);
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      if (planningProjectDetailOpenRef.current) {
        if (event.key === "Escape") {
          closePlanningProjectDetail();
          event.preventDefault();
        }
        return;
      }

      if (planningTimeReportOpenRef.current) {
        if (event.key === "Escape") {
          closePlanningTimeReport();
          event.preventDefault();
          return;
        }

        if (!event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "r") {
          closePlanningTimeReport();
          event.preventDefault();
          return;
        }

        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      if (!event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "n") {
        openProjectComposer();
        event.preventDefault();
        return;
      }

      if (!event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && event.key === "/") {
        focusPlanningSearch();
        event.preventDefault();
        return;
      }

      if (!event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "s") {
        focusPlanningSearch();
        event.preventDefault();
        return;
      }

      if (!event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "r") {
        togglePlanningTimeReport();
        event.preventDefault();
        return;
      }

      if (settings.modeSection !== "timeline") {
        if (!event.metaKey && !event.ctrlKey && !event.altKey && ["0", "1", "2", "3", "4"].includes(event.key)) {
          const viewFilter =
            event.key === "1"
              ? "todo"
              : event.key === "2"
                ? "in-progress"
                : event.key === "3"
                  ? "blocked"
                  : event.key === "4"
                    ? "done"
                    : "all";
          updatePlanningViewFilter(viewFilter);
          event.preventDefault();
        }
        return;
      }

      if (event.code === "BracketLeft" || event.code === "BracketRight") {
        if (event.shiftKey) {
          const direction = event.code === "BracketLeft" ? -1 : 1;
          setTimelineDay((current) => {
            const next = new Date(current);
            next.setDate(next.getDate() + direction);
            return planningDateOnly(next);
          });
        } else {
          const direction = event.code === "BracketLeft" ? -1 : 1;
          setTimelineOffsetMinutes((current) => current + direction * 60);
        }
        event.preventDefault();
        return;
      }

      if (event.key === "0" && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
        snapTimelineToNow();
        event.preventDefault();
        return;
      }

      const keyboardSelectedTimelineTask = selectedTimelineTaskRef.current;
      if (!keyboardSelectedTimelineTask?.id) {
        return;
      }

      if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
        openPlanningProjectDetail(keyboardSelectedTimelineTask.projectId, keyboardSelectedTimelineTask.id);
        event.preventDefault();
        return;
      }

      if (event.key === "ArrowLeft") {
        void reschedulePlanningTask(keyboardSelectedTimelineTask.id, -15);
        event.preventDefault();
        return;
      }

      if (event.key === "ArrowRight") {
        void reschedulePlanningTask(keyboardSelectedTimelineTask.id, 15);
        event.preventDefault();
        return;
      }

      if (event.key === "ArrowUp") {
        void movePlanningTaskToAdjacentLane(keyboardSelectedTimelineTask.id, -1);
        event.preventDefault();
        return;
      }

      if (event.key === "ArrowDown") {
        void movePlanningTaskToAdjacentLane(keyboardSelectedTimelineTask.id, 1);
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    closePlanningProjectDetail,
    closePlanningTimeReport,
    currentMinute,
    focusPlanningSearch,
    filteredProjects,
    movePlanningTaskToAdjacentLane,
    openPlanningProjectDetail,
    pulsePlanningOverlap,
    reschedulePlanningTask,
    selectedTimelineTask?.id,
    selectedTimelineTask?.projectId,
    settings.modeSection,
    snapTimelineToNow,
    timelineBaseStartMinute,
    timelineDayKey,
    timelineRangeMinutes,
    togglePlanningTimeReport,
    updatePlanningViewFilter,
    openProjectComposer,
  ]);

  const boardColumns = [
    { id: "todo", label: "Todo" },
    { id: "in-progress", label: "In progress" },
    { id: "blocked", label: "Blocked" },
    { id: "done", label: "Done" },
  ] as const;

  if (!planningSnapshot) {
    return (
      <div
        aria-busy="true"
        aria-label="Planning workspace"
        className={planningStyles.planningWorkspace}
        data-testid="planning-workspace"
        role="region"
      >
        {loadingModeSection === "board" ? (
          <div className={planningStyles.planningBoardShell}>
            {boardColumns.map((column) => (
              <section
                key={`planning-loading-${column.id}`}
                className={planningStyles.planningBoardColumn}
                data-testid={`planning-board-column-${column.id}`}
              >
                <div className={planningStyles.planningBoardColumnHead}>
                  <span>{column.label}</span>
                  <span>…</span>
                </div>
                <div className={planningStyles.planningLoadingBoardColumn}>
                  {Array.from({ length: 2 }, (_, index) => (
                    <div
                      key={`planning-loading-${column.id}-${index}`}
                      className={planningStyles.planningLoadingBoardCard}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className={planningStyles.planningShell} style={planningTimelineVariables}>
            <div className={planningStyles.planningScale}>
              <div className={planningStyles.planningScaleHead}>
                <span>Project</span>
                <span>Run-of-show loading…</span>
              </div>
              <div className={planningStyles.planningScaleTicks}>
                {timelineMinorTicks.map((minute) => (
                  <div
                    key={`planning-loading-half-hour-${minute}`}
                    className={planningStyles.planningScaleMinorTick}
                    style={{
                      left: planningPercentForMinute(minute, timelineStartMinute, timelineRangeMinutes),
                    }}
                  />
                ))}
              </div>
            </div>
            <div className={planningStyles.planningLoadingLanes}>
              {Array.from({ length: 5 }, (_, index) => (
                <div key={`planning-loading-${index}`} className={planningStyles.planningLoadingLane}>
                  <div className={planningStyles.planningLoadingHead} />
                  <div className={planningStyles.planningLoadingBody} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      aria-label="Planning workspace"
      className={planningStyles.planningWorkspace}
      data-testid="planning-workspace"
      role="region"
    >
      <div className={planningStyles.planningToolbar} data-testid="planning-toolbar">
        <div className={planningStyles.planningToolbarActions}>
          <div className={planningStyles.planningModeToggle} role="tablist" aria-label="Planning mode">
            <button
              aria-selected={settings.modeSection === "timeline"}
              className={planningStyles.planningModeButton}
              data-active={settings.modeSection === "timeline"}
              onClick={() => togglePlanningMode("timeline")}
              role="tab"
              type="button"
            >
              Timeline
            </button>
            <button
              aria-selected={settings.modeSection === "board"}
              className={planningStyles.planningModeButton}
              data-active={settings.modeSection === "board"}
              onClick={() => togglePlanningMode("board")}
              role="tab"
              type="button"
            >
              Board
            </button>
          </div>
          <div className={planningStyles.planningNowCard}>
            <div className={planningStyles.planningNowHeader}>
              <span className={planningStyles.planningNowLabel}>Now</span>
              <span className={planningStyles.planningNowValue}>{nowLabel}</span>
            </div>
            <div className={planningStyles.planningNudgeRow}>
              <button
                aria-label="View one hour earlier"
                className={planningStyles.planningNudgeButton}
                onClick={() => setTimelineOffsetMinutes((current) => current - 60)}
                type="button"
              >
                [
              </button>
              <button
                aria-label="Snap to now"
                className={planningStyles.planningNudgeButton}
                onClick={() => snapTimelineToNow()}
                type="button"
              >
                ●
              </button>
              <button
                aria-label="View one hour later"
                className={planningStyles.planningNudgeButton}
                onClick={() => setTimelineOffsetMinutes((current) => current + 60)}
                type="button"
              >
                ]
              </button>
            </div>
          </div>
          <div className={planningStyles.planningDayCard}>
            <span className={planningStyles.planningNowLabel}>Day</span>
            <span className={planningStyles.planningNowValue}>{viewDayLabel}</span>
            {!viewIsToday ? (
              <button className={planningStyles.planningTodayButton} onClick={() => snapTimelineToNow()} type="button">
                Today
              </button>
            ) : null}
          </div>
          <div className={planningStyles.planningStatRow}>
            <div className={planningStyles.planningStatChip}>
              <span className={planningStyles.planningStatLabel}>Lanes</span>
              <span className={planningStyles.planningStatValue}>{counts.projectCount}</span>
            </div>
            <div className={planningStyles.planningStatChip}>
              <span className={planningStyles.planningStatLabel}>On-time</span>
              <span className={planningStyles.planningStatValue}>{onTimeCount}</span>
            </div>
            <div className={planningStyles.planningStatChip}>
              <span className={planningStyles.planningStatLabel}>Slipped</span>
              <span className={planningStyles.planningStatValue}>{slippedCount}</span>
            </div>
            <div className={planningStyles.planningStatChip}>
              <span className={planningStyles.planningStatLabel}>Blocked</span>
              <span className={planningStyles.planningStatValue}>{blockedCount}</span>
            </div>
          </div>
          <div className={planningStyles.planningFilterRow} role="tablist" aria-label="Planning filter">
            {[
              { label: "All", value: "all" },
              { label: "Todo", value: "todo" },
              { label: "In progress", value: "in-progress" },
              { label: "Blocked", value: "blocked" },
              { label: "Done", value: "done" },
            ].map((filter) => (
              <button
                key={filter.value}
                aria-selected={settings.viewFilter === filter.value}
                className={planningStyles.planningFilterButton}
                data-active={settings.viewFilter === filter.value}
                onClick={() =>
                  updatePlanningViewFilter(filter.value as "all" | "todo" | "in-progress" | "blocked" | "done")
                }
                role="tab"
                type="button"
              >
                {filter.label}
              </button>
            ))}
          </div>
          {settings.modeSection === "timeline" && allTasksUnscheduled ? (
            <div className={planningStyles.planningTipChip}>Drag into a lane to schedule.</div>
          ) : null}
          <input
            aria-label="Search planning tasks"
            className={planningStyles.planningSearchInput}
            onChange={(event) => setPlanningSearchQuery(event.currentTarget.value)}
            placeholder="Search tasks..."
            ref={planningSearchInputRef}
            type="text"
            value={planningSearchQuery}
          />
          <button
            aria-pressed={planningTimeReportOpen}
            className={planningStyles.planningToolbarButton}
            data-active={planningTimeReportOpen}
            onClick={() => togglePlanningTimeReport()}
            type="button"
          >
            <span className={planningStyles.planningToolbarButtonContent}>
              <PlanningClockIcon />
              <span>Time report</span>
            </span>
          </button>
          <button
            className={planningStyles.planningToolbarButton}
            disabled={planningBusyAction !== null}
            onClick={() => void exportPlanningBackup()}
            type="button"
          >
            Backup
          </button>
          {projectComposerOpen ? (
            <div className={planningStyles.planningProjectComposer}>
              <input
                aria-label="New project title"
                className={planningStyles.planningProjectInput}
                disabled={planningBusyAction !== null}
                onChange={(event) => setNewProjectTitle(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void createPlanningProject();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    closeProjectComposer();
                  }
                }}
                placeholder="New project title"
                ref={newProjectTitleRef}
                type="text"
                value={newProjectTitle}
              />
              <button
                className={planningStyles.planningToolbarButton}
                data-primary="true"
                disabled={newProjectTitle.trim().length === 0 || planningBusyAction !== null}
                onClick={() => void createPlanningProject()}
                type="button"
              >
                Add project
              </button>
              <button
                className={planningStyles.planningToolbarButton}
                disabled={planningBusyAction !== null}
                onClick={() => closeProjectComposer()}
                type="button"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              className={planningStyles.planningToolbarButton}
              data-primary="true"
              disabled={planningBusyAction !== null}
              onClick={() => openProjectComposer()}
              type="button"
            >
              New project
            </button>
          )}
        </div>
      </div>
      {planningFeedback ? (
        <div className={planningStyles.planningToolbarNotice} data-tone={planningFeedback.tone} role="status">
          {planningFeedback.message}
        </div>
      ) : null}

      {settings.modeSection === "board" ? (
        <div className={planningStyles.planningBoardShell}>
          {boardColumns.map((column) => {
            const columnProjects = filteredProjects.filter((project) => project.status === column.id);
            const filteredOut = settings.viewFilter !== "all" && settings.viewFilter !== column.id;
            return (
              <section
                key={column.id}
                className={planningStyles.planningBoardColumn}
                data-filter-dimmed={filteredOut}
                data-testid={`planning-board-column-${column.id}`}
              >
                <div className={planningStyles.planningBoardColumnHead}>
                  <span>{column.label}</span>
                  <span>{columnProjects.length}</span>
                </div>
                <div
                  className={planningStyles.planningBoardColumnBody}
                  data-drop-active={planningBoardDropTarget?.status === column.id}
                  data-testid={`planning-board-column-body-${column.id}`}
                  onDragOver={(event) => {
                    const draggedProjectId =
                      event.dataTransfer.getData("text/planning-project-id") || draggingBoardProjectId;
                    if (!draggedProjectId) {
                      return;
                    }
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setPlanningBoardDropTarget({
                      index: resolvePlanningBoardDropIndex(column.id, columnProjects, columnProjects.length),
                      status: column.id,
                    });
                  }}
                  onDragLeave={(event) => {
                    if (planningBoardDropTarget?.status !== column.id) {
                      return;
                    }
                    const relatedTarget = event.relatedTarget;
                    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
                      return;
                    }
                    setPlanningBoardDropTarget((current) => (current?.status === column.id ? null : current));
                  }}
                  onDrop={(event) => {
                    const draggedProjectId =
                      event.dataTransfer.getData("text/planning-project-id") || draggingBoardProjectId;
                    if (!draggedProjectId) {
                      clearPlanningBoardDragState();
                      return;
                    }
                    event.preventDefault();
                    const dropIndex = resolvePlanningBoardDropIndex(column.id, columnProjects, columnProjects.length);
                    void reorderPlanningProject(draggedProjectId, column.id, dropIndex);
                    clearPlanningBoardDragState();
                  }}
                >
                  {settings.viewFilter !== "all" && settings.viewFilter === column.id && columnProjects.length === 0 ? (
                    <div
                      className={planningStyles.planningBoardEmpty}
                      data-testid={`planning-board-empty-${column.id}`}
                      data-zero-filter="true"
                    >
                      No {column.label.toLowerCase()} tasks.
                    </div>
                  ) : columnProjects.length > 0 ? (
                    columnProjects.map((project, projectIndex) => {
                      const projectTasks = tasks.filter((task) => task.projectId === project.id);
                      const completedTaskCount = projectTasks.filter((task) => task.completed).length;
                      const runningTask = projectTasks.find((task) => task.isRunning) ?? null;
                      const allLabels = Array.from(
                        new Set(projectTasks.flatMap((task) => task.labels.map((label) => label.toLowerCase())))
                      );
                      const visibleLabels = allLabels.slice(0, 2);
                      const extraLabelCount = allLabels.length - visibleLabels.length;
                      return (
                        <article
                          key={project.id}
                          className={planningStyles.planningBoardCard}
                          data-blocked={project.status === "blocked"}
                          data-dragging={draggingBoardProjectId === project.id}
                          data-drop-target={
                            planningBoardDropTarget?.status === column.id &&
                            planningBoardDropTarget.index === projectIndex
                          }
                          data-running={runningTask !== null}
                          data-selected={settings.selectedProjectId === project.id}
                          draggable
                          data-testid={`planning-board-card-${project.id}`}
                          onClick={() =>
                            void store.updatePlanningSettings({
                              selectedProjectId: project.id,
                              selectedTaskId: projectTasks[0]?.id ?? null,
                            })
                          }
                          onDragEnd={() => clearPlanningBoardDragState()}
                          onDragStart={(event) => {
                            setDraggingBoardProjectId(project.id);
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/planning-project-id", project.id);
                          }}
                          onDragOver={(event) => {
                            const draggedProjectId =
                              event.dataTransfer.getData("text/planning-project-id") || draggingBoardProjectId;
                            if (!draggedProjectId || draggedProjectId === project.id) {
                              return;
                            }
                            event.preventDefault();
                            event.dataTransfer.dropEffect = "move";
                            const rect = event.currentTarget.getBoundingClientRect();
                            const dropAfter = event.clientY > rect.top + rect.height / 2;
                            const rawIndex = projectIndex + (dropAfter ? 1 : 0);
                            setPlanningBoardDropTarget({
                              index: resolvePlanningBoardDropIndex(column.id, columnProjects, rawIndex),
                              status: column.id,
                            });
                          }}
                          onDrop={(event) => {
                            const draggedProjectId =
                              event.dataTransfer.getData("text/planning-project-id") || draggingBoardProjectId;
                            if (!draggedProjectId) {
                              clearPlanningBoardDragState();
                              return;
                            }
                            event.preventDefault();
                            event.stopPropagation();
                            const rect = event.currentTarget.getBoundingClientRect();
                            const dropAfter = event.clientY > rect.top + rect.height / 2;
                            const rawIndex = projectIndex + (dropAfter ? 1 : 0);
                            const dropIndex = resolvePlanningBoardDropIndex(column.id, columnProjects, rawIndex);
                            void reorderPlanningProject(draggedProjectId, column.id, dropIndex);
                            clearPlanningBoardDragState();
                          }}
                        >
                          <div className={planningStyles.planningBoardCardHeader}>
                            <button
                              aria-label={`Open project detail for ${project.title}`}
                              className={planningStyles.planningBoardDetailButton}
                              onClick={(event) => {
                                event.stopPropagation();
                                openPlanningProjectDetail(project.id, projectTasks[0]?.id ?? null);
                              }}
                              type="button"
                            >
                              <span className={planningStyles.planningBoardCardTitle}>{project.title}</span>
                            </button>
                            <div className={planningStyles.planningBoardPriority}>{project.priority.toUpperCase()}</div>
                          </div>
                          <div className={planningStyles.planningBoardStatusRow}>
                            <StatusBadge
                              label={project.status.replace("-", " ")}
                              tone={planningStatusTone(project.status)}
                            />
                            {runningTask ? (
                              <div className={planningStyles.planningBoardRunning}>
                                <span className={planningStyles.planningBoardRunningDot} />
                                <span>{runningTask.title} running</span>
                              </div>
                            ) : (
                              <div className={planningStyles.planningBoardCardMeta}>
                                {completedTaskCount}/{projectTasks.length} tasks
                              </div>
                            )}
                          </div>
                          {project.description ? (
                            <div className={planningStyles.planningBoardDescription}>{project.description}</div>
                          ) : null}
                          <div className={planningStyles.planningBoardProgress}>
                            <div
                              className={planningStyles.planningBoardProgressFill}
                              style={{
                                width: `${projectTasks.length > 0 ? Math.round((completedTaskCount / projectTasks.length) * 100) : 0}%`,
                              }}
                            />
                          </div>
                          <div className={planningStyles.planningBoardCardMeta}>
                            {completedTaskCount}/{projectTasks.length} tasks · {project.priority.toUpperCase()}
                          </div>
                          {visibleLabels.length > 0 ? (
                            <div className={planningStyles.planningBoardTags}>
                              {visibleLabels.map((label) => (
                                <span key={label} className={planningStyles.planningBoardTag}>
                                  {label}
                                </span>
                              ))}
                              {extraLabelCount > 0 ? (
                                <span className={planningStyles.planningBoardTag}>+{extraLabelCount}</span>
                              ) : null}
                            </div>
                          ) : null}
                        </article>
                      );
                    })
                  ) : (
                    <div className={planningStyles.planningBoardEmpty}>No projects in this column.</div>
                  )}
                </div>
              </section>
            );
          })}
          {projects.length === 0 ? (
            <div className={planningStyles.planningBoardEmptyState}>
              <div className={planningStyles.planningEmptyTitle}>No projects yet. Press N to start one.</div>
              <div className={planningStyles.planningEmptyBody}>
                The board stays visible, but there is no run-of-show data on the current day.
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className={planningStyles.planningShell} style={planningTimelineVariables}>
          <div className={planningStyles.planningScale}>
            <div className={planningStyles.planningScaleHead}>
              <span>Project</span>
              <span>
                {formatPlanningHourLabel(Math.floor(timelineStartMinute / 60))} →{" "}
                {formatPlanningHourLabel(Math.floor(timelineEndMinute / 60))}
              </span>
            </div>
            <div className={planningStyles.planningScaleTicks}>
              {timelineMinorTicks.map((minute) => (
                <div
                  key={`planning-half-hour-${minute}`}
                  className={planningStyles.planningScaleMinorTick}
                  style={{
                    left: planningPercentForMinute(minute, timelineStartMinute, timelineRangeMinutes),
                  }}
                />
              ))}
              {timelineTicks.map((hour) => (
                <div
                  key={`planning-hour-${hour}`}
                  className={planningStyles.planningScaleTick}
                  style={{
                    left: planningPercentForMinute(hour * 60, timelineStartMinute, timelineRangeMinutes),
                  }}
                >
                  {formatPlanningHourLabel(hour)}
                </div>
              ))}
            </div>
          </div>
          {showFilterBanner || showSearchZeroResult ? (
            <div className={planningStyles.planningFilterBanner} role="status">
              <span>
                {hasPlanningSearch ? `Search: "${planningSearchQuery.trim()}"` : `Filter: ${settings.viewFilter}`} ·{" "}
                {filteredProjects.length} of {projects.length}
              </span>
              <button
                className={planningStyles.planningFilterClear}
                onClick={() => clearPlanningFilters()}
                type="button"
              >
                Clear
              </button>
            </div>
          ) : null}

          {projects.length === 0 ? (
            <div className={planningStyles.planningEmptyState}>
              <div className={planningStyles.planningEmptyTitle}>No projects yet. Press N to start one.</div>
              <div className={planningStyles.planningEmptyBody}>
                The timeline stays visible, but there is no run-of-show data on the current day.
              </div>
            </div>
          ) : (
            <div className={planningStyles.planningTimeline} ref={planningTimelineRef}>
              <div
                className={planningStyles.planningNowPlayhead}
                data-testid="planning-now-playhead"
                style={{
                  left: `calc(280px + (100% - 280px) * ${planningFractionForMinute(
                    clampedNowMinute,
                    timelineStartMinute,
                    timelineRangeMinutes
                  )})`,
                }}
              />
              {filteredProjects.map((project) => {
                const laneTasks = tasksByProjectId.get(project.id) ?? [];
                const runningTask = laneTasks.find((task) => task.isRunning);
                const subtitle = runningTask
                  ? `${runningTask.title} · running`
                  : `${tasks.filter((task) => task.projectId === project.id).length} tasks`;
                const laneFilteredOut = settings.viewFilter !== "all" && project.status !== settings.viewFilter;

                return (
                  <div
                    key={project.id}
                    className={planningStyles.planningLane}
                    data-filter-dimmed={laneFilteredOut}
                    data-testid={`planning-lane-${project.id}`}
                  >
                    <div className={planningStyles.planningLaneHead}>
                      <div className={planningStyles.planningLaneTitle}>{project.title}</div>
                      <div className={planningStyles.planningLaneMeta}>
                        <StatusBadge
                          label={project.status.replace("-", " ")}
                          tone={planningStatusTone(project.status)}
                        />
                        <span>{subtitle}</span>
                      </div>
                    </div>
                    <div className={planningStyles.planningLaneBody}>
                      <div
                        className={planningStyles.planningLaneDropZone}
                        data-drop-active={planningDropTarget?.projectId === project.id}
                        data-drop-allowed={
                          draggingScheduledTask !== null || draggingUnscheduledTask?.projectId === project.id
                        }
                        data-testid={`planning-lane-body-${project.id}`}
                        onDragLeave={(event) => {
                          if (planningDropTarget?.projectId !== project.id) {
                            return;
                          }
                          const relatedTarget = event.relatedTarget;
                          if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
                            return;
                          }
                          setPlanningDropTarget(null);
                        }}
                        onDragOver={(event) => {
                          const accepted = updatePlanningDropTarget(event, project.id);
                          if (!accepted) {
                            return;
                          }
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                        }}
                        onDrop={(event) => {
                          const taskId =
                            event.dataTransfer.getData("text/planning-scheduled-task-id") ||
                            draggingScheduledTaskId ||
                            event.dataTransfer.getData("text/planning-task-id") ||
                            draggingUnscheduledTaskId;
                          if (!taskId) {
                            return;
                          }

                          const accepted = updatePlanningDropTarget(event, project.id);
                          if (!accepted) {
                            return;
                          }

                          event.preventDefault();
                          const dropMinute = minuteForLaneDrop(event);
                          if (
                            event.dataTransfer.getData("text/planning-scheduled-task-id") ||
                            draggingScheduledTaskId
                          ) {
                            void rescheduleScheduledTaskByDrop(taskId, project.id, dropMinute);
                          } else {
                            void scheduleUnscheduledTask(taskId, project.id, dropMinute);
                          }
                          setDraggingScheduledTaskId(null);
                          setDraggingUnscheduledTaskId(null);
                          setPlanningDropTarget(null);
                        }}
                      />
                      {planningDropTarget?.projectId === project.id ? (
                        <div
                          className={planningStyles.planningDropGhost}
                          style={{
                            left: planningPercentForMinute(
                              planningDropTarget.minute,
                              timelineStartMinute,
                              timelineRangeMinutes
                            ),
                            width: planningWidthPercent(
                              Math.max(15, Math.round(planningScheduledDurationSeconds(draggingTimelineTask) / 60)),
                              timelineRangeMinutes
                            ),
                          }}
                        />
                      ) : null}
                      {laneTasks.map((task) => {
                        const scheduledStart = task.scheduledStart ? new Date(task.scheduledStart) : null;
                        if (!scheduledStart || Number.isNaN(scheduledStart.getTime())) {
                          return null;
                        }
                        const taskStartMinute = planningMinutesForDate(scheduledStart);
                        const taskDurationMinutes = Math.max(
                          15,
                          Math.round((task.scheduledDurationSeconds ?? 900) / 60)
                        );
                        const overlapTitle = planningOverlapTitlesByTaskId.get(task.id) ?? null;
                        return (
                          <button
                            key={task.id}
                            className={planningStyles.planningBlock}
                            data-dragging={draggingScheduledTaskId === task.id}
                            data-overlap={overlapTitle !== null}
                            data-overlap-pulse={planningOverlapPulseTaskId === task.id}
                            data-project-id={task.projectId}
                            data-selected={selectedTimelineTask?.id === task.id}
                            data-running={task.isRunning}
                            data-scheduled-start={task.scheduledStart ?? ""}
                            data-time-label={formatPlanningClockLabel(scheduledStart)}
                            data-status={project.status}
                            draggable
                            onClick={() => selectPlanningTask(task.id, task.projectId)}
                            onDragEnd={() => {
                              setDraggingScheduledTaskId(null);
                              setPlanningDropTarget(null);
                            }}
                            onDragStart={(event) => {
                              setDraggingScheduledTaskId(task.id);
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData("text/planning-scheduled-task-id", task.id);
                              selectPlanningTask(task.id, task.projectId);
                            }}
                            style={{
                              left: planningPercentForMinute(
                                taskStartMinute,
                                timelineStartMinute,
                                timelineRangeMinutes
                              ),
                              width: planningWidthPercent(taskDurationMinutes, timelineRangeMinutes),
                            }}
                            title={
                              overlapTitle
                                ? `${task.title} · ${taskDurationMinutes} min · Overlaps '${overlapTitle}'.`
                                : `${task.title} · ${taskDurationMinutes} min`
                            }
                            type="button"
                          >
                            <span className={planningStyles.planningBlockTitle}>{task.title}</span>
                            <span className={planningStyles.planningBlockMeta}>
                              {taskDurationMinutes} min · {task.priority.toUpperCase()}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {visibleUnscheduledTasks.length > 0 ? (
            <div
              className={planningStyles.planningUnscheduledTray}
              data-all-unscheduled={allTasksUnscheduled}
              data-expanded={unscheduledTrayExpanded}
              data-testid="planning-unscheduled-tray"
              onBlurCapture={(event) => {
                const relatedTarget = event.relatedTarget;
                if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
                  return;
                }
                setTrayExpanded(false);
              }}
              onFocusCapture={() => setTrayExpanded(true)}
              onMouseEnter={() => setTrayExpanded(true)}
              onMouseLeave={() => {
                if (!draggingUnscheduledTask) {
                  setTrayExpanded(false);
                }
              }}
            >
              <button
                aria-expanded={unscheduledTrayExpanded}
                className={planningStyles.planningUnscheduledHead}
                onClick={() => setTrayExpanded((current) => !current)}
                type="button"
              >
                <span>Unscheduled ({visibleUnscheduledTasks.length})</span>
                <span>{unscheduledTrayExpanded ? "Collapse" : "Expand"}</span>
              </button>
              <div className={planningStyles.planningUnscheduledBody}>
                {visibleUnscheduledTasks.map((task) => (
                  <button
                    key={task.id}
                    aria-label={`Unscheduled task ${task.title}`}
                    className={planningStyles.planningUnscheduledChip}
                    draggable
                    onDragEnd={() => {
                      setDraggingUnscheduledTaskId(null);
                      setPlanningDropTarget(null);
                    }}
                    onDragStart={(event) => {
                      setDraggingUnscheduledTaskId(task.id);
                      setTrayExpanded(true);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/planning-task-id", task.id);
                    }}
                    type="button"
                  >
                    {task.title}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
      {planningTimeReportOpen ? (
        <PlanningTimeReportOverlay
          loading={planningTimeReportLoading}
          error={planningTimeReportError}
          report={planningTimeReport}
          onClose={closePlanningTimeReport}
        />
      ) : null}
      {planningProjectDetailOpen && planningProjectDetailProject ? (
        <PlanningProjectDetailOverlay
          activity={planningProjectDetailActivity}
          checklistTotals={planningProjectDetailChecklistTotals}
          onClose={closePlanningProjectDetail}
          onCreateTask={createPlanningProjectDetailTask}
          onAddChecklistItem={createPlanningProjectDetailChecklistItem}
          onToggleChecklistItem={togglePlanningProjectDetailChecklistItem}
          onSelectTask={selectPlanningProjectDetailTask}
          onToggleTaskComplete={togglePlanningProjectDetailTaskComplete}
          progressValue={planningProjectDetailProgressValue}
          project={planningProjectDetailProject}
          selectedTaskId={planningProjectDetailSelectedTask?.id ?? null}
          tasks={planningProjectDetailTasks}
          totalProjectSeconds={planningProjectDetailTotalSeconds}
          totalTaskCount={planningProjectDetailTasks.length}
          completedTaskCount={planningProjectDetailCompletedTaskCount}
        />
      ) : null}
    </div>
  );
}
