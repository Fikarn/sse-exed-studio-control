import { useMemo, useState, useDeferredValue, useRef, useEffect, type CSSProperties } from "react";
import {
  getPlanningProjects,
  getPlanningTasks,
  getPlanningActivityLog,
  getPlanningSettings,
  asRecord,
  type PlanningTaskEntry,
} from "../../shellData";
import {
  planningDateOnly,
  planningNormalizedSearchText,
  type PlanningTimeReportData,
  type PlanningBoardStatus,
  planningDateKey,
  planningMinutesForDate,
  comparePlanningDates,
  formatPlanningClockLabel,
  formatPlanningDateLabel,
  planningProjectMatchesSearch,
  buildPlanningLaneOverlapMap,
} from "../planningHelpers";
import type { ActionFeedback } from "../../startup/startupHelpers";
import { derivePlanningDayFacts } from "../planningState";
import { planningLaneRowCapacity } from "../planningTimelineLayout";
import {
  PLANNING_LABEL_WIDTH,
  planningCardSize,
  PLANNING_CARD_TOP,
  type PlanningWorkspaceSurfaceProps,
} from "../planningWorkspaceModel";

/** The day in view: what the snapshot holds, the clock, the search and the
 *  filter, the drag in progress, the measured screen, and everything derived
 *  from them - which tasks are on the timeline, the plate's project, the day's
 *  facts, the timeline's geometry. */
export function usePlanningView({ props }: { props: PlanningWorkspaceSurfaceProps }) {
  const { planningSnapshot, appSnapshot } = props;
  const projects = useMemo(() => getPlanningProjects(planningSnapshot), [planningSnapshot]);
  const tasks = useMemo(() => getPlanningTasks(planningSnapshot), [planningSnapshot]);
  const activityLog = useMemo(() => getPlanningActivityLog(planningSnapshot), [planningSnapshot]);
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
  // Visual overhaul A, Slice 6: the cards are fixed-width boxes pinned to a
  // start time, so the screen has to be measured before they can be placed.
  const [planningTimelineViewportWidth, setPlanningTimelineViewportWidth] = useState<number | null>(null);
  const newProjectTitleRef = useRef<HTMLInputElement | null>(null);
  const planningSearchInputRef = useRef<HTMLInputElement | null>(null);
  const planningOverlapPulseTimerRef = useRef<number | null>(null);
  const planningTimeReportOpenRef = useRef(false);
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
      setPlanningTimelineViewportWidth(null);
      return;
    }

    const timelineElement = planningTimelineRef.current;
    if (!timelineElement) {
      return;
    }

    const updateViewportHeight = () => {
      const rect = timelineElement.getBoundingClientRect();
      setPlanningTimelineViewportHeight(rect.height);
      setPlanningTimelineViewportWidth(rect.width);
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
  // Visual overhaul A, Slice 6 (plan D1): the plate is always on screen, so
  // what the retired project-detail dialog derived is derived here instead —
  // the project in front of the operator, its tasks, and the day's activity on
  // any of them.
  const plateProject =
    (settings.selectedProjectId ? projects.find((project) => project.id === settings.selectedProjectId) : null) ??
    (selectedTask ? projects.find((project) => project.id === selectedTask.projectId) : null) ??
    filteredProjects[0] ??
    projects[0] ??
    null;
  const plateTasks = useMemo(
    () =>
      plateProject
        ? tasks.filter((task) => task.projectId === plateProject.id).sort((left, right) => left.order - right.order)
        : [],
    [plateProject, tasks]
  );
  const plateTaskIds = useMemo(() => new Set(plateTasks.map((task) => task.id)), [plateTasks]);
  const plateSelectedTask = settings.selectedTaskId
    ? (plateTasks.find((task) => task.id === settings.selectedTaskId) ?? null)
    : null;
  const plateActivity = useMemo(
    () =>
      plateProject
        ? activityLog.filter((entry) => entry.entityId === plateProject.id || plateTaskIds.has(entry.entityId))
        : [],
    [activityLog, plateProject, plateTaskIds]
  );

  // Visual overhaul A, Slice 6: one derivation of the day, printed in the
  // state display, the footer and the "Tracked today" list — the numbers the
  // toolbar's four chips used to carry, counted from the same snapshot.
  const dayFacts = useMemo(
    () => derivePlanningDayFacts({ day: timelineDay, now, projects, tasks }),
    [now, projects, tasks, timelineDay]
  );
  const projectTaskCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of tasks) {
      counts.set(task.projectId, (counts.get(task.projectId) ?? 0) + 1);
    }
    return counts;
  }, [tasks]);
  const projectTitles = useMemo(
    () => new Map(projects.map((project) => [project.id, project.title] as const)),
    [projects]
  );
  const timelineTicks = Array.from(
    { length: Math.ceil(timelineRangeMinutes / 60) + 1 },
    (_, index) => Math.floor(timelineStartMinute / 60) + index
  );
  const timelineMinorTicks = Array.from(
    { length: Math.max(0, Math.floor(timelineRangeMinutes / 30) - 1) },
    (_, index) => timelineStartMinute + (index + 1) * 30
  ).filter((minute) => minute % 60 !== 0);
  const planningMeasuredAxisWidth = Math.max(0, (planningTimelineViewportWidth ?? 0) - PLANNING_LABEL_WIDTH);
  const { height: planningCardHeight, width: planningCardWidth } = planningCardSize(planningMeasuredAxisWidth);
  const timelineLaneHeight = (() => {
    // PLA-03/DENSITY-03 kept, with A's rule on top (A-planning.html): the band
    // divides evenly between the lanes, as the mock's `laneH = (H - axis) /
    // lanes` does, so a card and its second row have room. The old 150 px
    // ceiling is gone — it left a dead band under five lanes on the studio
    // monitor. Dense boards still floor at the card's own height.
    const fallbackLaneHeight = 96;
    if (!planningTimelineViewportHeight || filteredProjects.length === 0) {
      return fallbackLaneHeight;
    }

    const filledLaneHeight = Math.floor(planningTimelineViewportHeight / filteredProjects.length);
    return Math.max(PLANNING_CARD_TOP + planningCardHeight + 8, filledLaneHeight);
  })();
  const planningLaneRows = planningLaneRowCapacity(timelineLaneHeight, planningCardHeight, PLANNING_CARD_TOP, 8);
  const planningHourWidth = planningMeasuredAxisWidth / Math.max(1, timelineRangeMinutes / 60);
  // A card is placed from a measurement, so it waits for one: drawing before
  // the screen has been measured would pile every card on the axis start.
  const planningScreenMeasured = planningMeasuredAxisWidth > 0;
  const planningTimelineVariables = {
    "--planning-card-height": `${planningCardHeight}px`,
    "--planning-card-top": `${PLANNING_CARD_TOP}px`,
    "--planning-card-width": `${planningCardWidth}px`,
    "--planning-half-hour-count": String(Math.max(1, Math.round(timelineRangeMinutes / 30))),
    "--planning-hour-count": String(Math.max(1, Math.round(timelineRangeMinutes / 60))),
    "--planning-lane-height": `${timelineLaneHeight}px`,
    // PLA-09: single source for the label column shared by the scale header, lane
    // bodies, loading skeleton, and the playhead calc() below — keeps them grid-aligned.
    // Visual overhaul A, Slice 6: 176 px, the mock's label column at 2560.
    "--planning-label-col": `${PLANNING_LABEL_WIDTH}px`,
  } as CSSProperties;
  const hasPlanningSearch = deferredPlanningSearchQuery.length > 0;
  const showSearchZeroResult = hasPlanningSearch && filteredProjects.length === 0;
  const showFilterBanner = settings.viewFilter !== "all";
  return {
    projects,
    tasks,
    settings,
    loadingModeSection,
    timelineDay,
    setTimelineDay,
    setTimelineOffsetMinutes,
    planningBusyAction,
    setPlanningBusyAction,
    planningFeedback,
    setPlanningFeedback,
    planningSearchQuery,
    setPlanningSearchQuery,
    projectComposerOpen,
    setProjectComposerOpen,
    newProjectTitle,
    setNewProjectTitle,
    planningTimeReportOpen,
    setPlanningTimeReportOpen,
    planningTimeReportLoading,
    setPlanningTimeReportLoading,
    planningTimeReportError,
    setPlanningTimeReportError,
    planningTimeReport,
    setPlanningTimeReport,
    planningOverlapPulseTaskId,
    setPlanningOverlapPulseTaskId,
    setTrayExpanded,
    draggingScheduledTaskId,
    setDraggingScheduledTaskId,
    draggingUnscheduledTaskId,
    setDraggingUnscheduledTaskId,
    draggingBoardProjectId,
    setDraggingBoardProjectId,
    planningDropTarget,
    setPlanningDropTarget,
    planningBoardDropTarget,
    setPlanningBoardDropTarget,
    planningSearchInputRef,
    planningOverlapPulseTimerRef,
    planningTimeReportOpenRef,
    planningTimelineRef,
    selectedTimelineTaskRef,
    timelineBaseStartMinute,
    timelineRangeMinutes,
    timelineStartMinute,
    timelineEndMinute,
    timelineDayKey,
    currentMinute,
    clampedNowMinute,
    nowLabel,
    viewDayLabel,
    viewIsToday,
    filteredProjects,
    visibleUnscheduledTasks,
    allTasksUnscheduled,
    draggingScheduledTask,
    draggingUnscheduledTask,
    draggingTimelineTask,
    unscheduledTrayExpanded,
    selectedTimelineTask,
    tasksByProjectId,
    planningOverlapTitlesByTaskId,
    plateProject,
    plateTasks,
    plateSelectedTask,
    plateActivity,
    dayFacts,
    projectTaskCounts,
    projectTitles,
    timelineTicks,
    timelineMinorTicks,
    planningMeasuredAxisWidth,
    planningCardHeight,
    planningCardWidth,
    planningLaneRows,
    planningHourWidth,
    planningScreenMeasured,
    planningTimelineVariables,
    hasPlanningSearch,
    showSearchZeroResult,
    showFilterBanner,
  };
}

export type PlanningView = ReturnType<typeof usePlanningView>;
