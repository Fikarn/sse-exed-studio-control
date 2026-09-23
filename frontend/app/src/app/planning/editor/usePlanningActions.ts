import { useLiveCallback } from "../../shared/useLiveCallback";
import {
  planningDateOnly,
  findPlanningOverlapTaskTitle,
  planningScheduledDurationSeconds,
  type PlanningBoardStatus,
  planningDateForMinute,
  parsePlanningTimeReport,
  PLANNING_OVERLAP_PULSE_MS,
} from "../planningHelpers";
import { type PlanningProjectEntry, asRecord } from "../../shellData";
import type { DragEvent as ReactDragEvent } from "react";
import type { PlanningWorkspaceSurfaceProps } from "../planningWorkspaceModel";
import type { PlanningView } from "./usePlanningView";

/** What the operator can do in Planning: select, time, reschedule, move
 *  between lanes, drag and drop, create a project, export, filter, and the time
 *  report. */
export function usePlanningActions({ props, view }: { props: PlanningWorkspaceSurfaceProps; view: PlanningView }) {
  const { store } = props;
  const {
    settings,
    selectedTimelineTaskRef,
    tasks,
    setPlanningBusyAction,
    setPlanningFeedback,
    setTimelineDay,
    filteredProjects,
    setDraggingBoardProjectId,
    setPlanningBoardDropTarget,
    projects,
    draggingBoardProjectId,
    timelineStartMinute,
    timelineRangeMinutes,
    timelineEndMinute,
    draggingScheduledTask,
    setPlanningDropTarget,
    draggingUnscheduledTask,
    timelineDay,
    currentMinute,
    setTimelineOffsetMinutes,
    timelineBaseStartMinute,
    setProjectComposerOpen,
    setNewProjectTitle,
    newProjectTitle,
    planningSearchInputRef,
    setPlanningSearchQuery,
    setPlanningTimeReportLoading,
    setPlanningTimeReportError,
    setPlanningTimeReport,
    planningTimeReportOpenRef,
    setPlanningTimeReportOpen,
    planningOverlapPulseTimerRef,
    setPlanningOverlapPulseTaskId,
  } = view;
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

  // Visual overhaul A, Slice 6: what used to open the project-detail dialog now
  // puts the project on the plate — the plate is always there, so there is
  // nothing to open and nothing to close.
  const showPlanningProject = useLiveCallback((projectId: string, taskId?: string | null) => {
    const projectTasks = tasks
      .filter((task) => task.projectId === projectId)
      .sort((left, right) => left.order - right.order);
    const nextTaskId = taskId ?? projectTasks[0]?.id ?? null;

    void store.updatePlanningSettings({
      selectedProjectId: projectId,
      selectedTaskId: nextTaskId,
    });
  });

  const clearPlanningTaskSelection = useLiveCallback(() => {
    selectedTimelineTaskRef.current = null;
    void store.updatePlanningSettings({ selectedTaskId: null });
  });

  const togglePlanningTaskTimer = useLiveCallback(async (taskId: string, running: boolean) => {
    const task = tasks.find((entry) => entry.id === taskId) ?? null;
    setPlanningBusyAction(`timer-${taskId}`);
    try {
      await store.setPlanningTaskTimer(taskId, running ? "stop" : "start");
      setPlanningFeedback({
        message: running
          ? `Stopped the timer on '${task?.title ?? "the task"}'.`
          : `Started the timer on '${task?.title ?? "the task"}'.`,
        tone: "ok",
      });
    } catch (error) {
      setPlanningFeedback({
        message:
          error instanceof Error
            ? error.message
            : "The timer could not be changed. Press the timer key on the plate again.",
        tone: "error",
      });
    } finally {
      setPlanningBusyAction(null);
    }
  });

  const deletePlanningTaskById = useLiveCallback(async (taskId: string) => {
    const task = tasks.find((entry) => entry.id === taskId) ?? null;
    setPlanningBusyAction(`task-delete-${taskId}`);
    try {
      await store.deletePlanningTask(taskId);
      setPlanningFeedback({ message: `Deleted '${task?.title ?? "the task"}'.`, tone: "info" });
    } catch (error) {
      setPlanningFeedback({
        message:
          error instanceof Error
            ? error.message
            : "The task could not be deleted. Press Delete task… on the plate again.",
        tone: "error",
      });
    } finally {
      setPlanningBusyAction(null);
    }
  });

  const stepPlanningDay = useLiveCallback((direction: -1 | 1) => {
    setTimelineDay((current) => {
      const next = new Date(current);
      next.setDate(next.getDate() + direction);
      return planningDateOnly(next);
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
        message: error instanceof Error ? error.message : "The project could not be created. Press Add project again.",
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
        message:
          error instanceof Error
            ? error.message
            : "The support backup could not be exported. Press Export backup again.",
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
        error instanceof Error
          ? error.message
          : "The time report could not be loaded. Press Close, then Time report to try again."
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
  return {
    togglePlanningMode,
    updatePlanningViewFilter,
    selectPlanningTask,
    showPlanningProject,
    clearPlanningTaskSelection,
    togglePlanningTaskTimer,
    deletePlanningTaskById,
    stepPlanningDay,
    togglePlanningProjectDetailTaskComplete,
    createPlanningProjectDetailTask,
    createPlanningProjectDetailChecklistItem,
    togglePlanningProjectDetailChecklistItem,
    reschedulePlanningTask,
    movePlanningTaskToAdjacentLane,
    reorderPlanningProject,
    clearPlanningBoardDragState,
    resolvePlanningBoardDropIndex,
    minuteForLaneDrop,
    updatePlanningDropTarget,
    rescheduleScheduledTaskByDrop,
    scheduleUnscheduledTask,
    snapTimelineToNow,
    openProjectComposer,
    closeProjectComposer,
    createPlanningProject,
    exportPlanningBackup,
    focusPlanningSearch,
    clearPlanningFilters,
    closePlanningTimeReport,
    togglePlanningTimeReport,
    pulsePlanningOverlap,
  };
}

export type PlanningActions = ReturnType<typeof usePlanningActions>;
