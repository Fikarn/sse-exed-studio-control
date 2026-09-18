import planningStyles from "../PlanningWorkspace.module.css";
import { planningLabelledHours, layoutPlanningLane } from "../planningTimelineLayout";
import {
  planningPercentForMinute,
  formatPlanningHourLabel,
  planningFractionForMinute,
  planningScheduledDurationSeconds,
  planningMinutesForDate,
  planningWidthPercent,
  formatPlanningClockLabel,
} from "../planningHelpers";
import { formatPlanningElapsed } from "../planningState";
import { PLANNING_CARD_TOP } from "../planningWorkspaceModel";
import type { PlanningEditor } from "../usePlanningEditor";

/** The timeline: the hour axis and one lane per project. */
export function PlanningTimelineBay({ editor }: { editor: PlanningEditor }) {
  const {
    planningTimelineVariables,
    timelineTicks,
    planningHourWidth,
    timelineStartMinute,
    timelineRangeMinutes,
    planningTimelineRef,
    clampedNowMinute,
    nowLabel,
    filteredProjects,
    tasksByProjectId,
    projectTaskCounts,
    settings,
    planningCardHeight,
    planningCardWidth,
    planningLaneRows,
    planningMeasuredAxisWidth,
    planningDropTarget,
    draggingScheduledTask,
    draggingUnscheduledTask,
    setPlanningDropTarget,
    draggingScheduledTaskId,
    draggingUnscheduledTaskId,
    setDraggingScheduledTaskId,
    setDraggingUnscheduledTaskId,
    draggingTimelineTask,
    planningScreenMeasured,
    planningOverlapTitlesByTaskId,
    planningOverlapPulseTaskId,
    selectedTimelineTask,
  } = editor.view;
  const {
    updatePlanningDropTarget,
    minuteForLaneDrop,
    rescheduleScheduledTaskByDrop,
    scheduleUnscheduledTask,
    selectPlanningTask,
  } = editor.actions;
  return (
    <div className={planningStyles.planningShell} style={planningTimelineVariables}>
      <div className={planningStyles.planningAxis}>
        {timelineTicks.map((hour) => (
          <div
            key={`planning-hour-${hour}`}
            className={planningStyles.planningAxisTick}
            data-labelled={planningLabelledHours(timelineTicks, planningHourWidth).has(hour)}
            data-last={hour === timelineTicks[timelineTicks.length - 1]}
            style={{
              left: planningPercentForMinute(hour * 60, timelineStartMinute, timelineRangeMinutes),
            }}
          >
            {formatPlanningHourLabel(hour)}
          </div>
        ))}
      </div>
      <div className={planningStyles.planningTimeline} ref={planningTimelineRef}>
        <div
          className={planningStyles.planningNowPlayhead}
          data-testid="planning-now-playhead"
          style={{
            left: `calc(var(--planning-label-col) + (100% - var(--planning-label-col)) * ${planningFractionForMinute(
              clampedNowMinute,
              timelineStartMinute,
              timelineRangeMinutes
            )})`,
          }}
        >
          <span className={planningStyles.planningNowLabel}>{nowLabel} now</span>
        </div>
        {filteredProjects.map((project) => {
          const laneTasks = tasksByProjectId.get(project.id) ?? [];
          const runningTask = laneTasks.find((task) => task.isRunning);
          const subtitle = runningTask
            ? `${runningTask.title} · running`
            : `${projectTaskCounts.get(project.id) ?? 0} ${
                (projectTaskCounts.get(project.id) ?? 0) === 1 ? "task" : "tasks"
              } · ${project.status.replace("-", " ")}`;
          const laneFilteredOut = settings.viewFilter !== "all" && project.status !== settings.viewFilter;
          // A card is a box at its start time, not a bar: work out
          // where each one lands before drawing the lane.
          const laneLayout = new Map(
            layoutPlanningLane(
              laneTasks
                .map((task) => {
                  const scheduledStart = task.scheduledStart ? new Date(task.scheduledStart) : null;
                  if (!scheduledStart || Number.isNaN(scheduledStart.getTime())) {
                    return null;
                  }
                  return {
                    durationMinutes: Math.max(1, Math.round(planningScheduledDurationSeconds(task) / 60)),
                    id: task.id,
                    startMinute: planningMinutesForDate(scheduledStart),
                  };
                })
                .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
              {
                cardHeight: planningCardHeight,
                cardWidth: planningCardWidth,
                gap: 8,
                rangeMinutes: timelineRangeMinutes,
                rowCapacity: planningLaneRows,
                startMinute: timelineStartMinute,
                width: planningMeasuredAxisWidth,
              }
            ).map((entry) => [entry.id, entry] as const)
          );

          return (
            <div
              key={project.id}
              className={planningStyles.planningLane}
              data-filter-dimmed={laneFilteredOut}
              data-testid={`planning-lane-${project.id}`}
            >
              <div className={planningStyles.planningLaneHead}>
                <div className={planningStyles.planningLaneTitle}>{project.title}</div>
                <div className={planningStyles.planningLaneMeta}>{subtitle}</div>
              </div>
              <div className={planningStyles.planningLaneBody} data-material="well">
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
                    if (event.dataTransfer.getData("text/planning-scheduled-task-id") || draggingScheduledTaskId) {
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
                {(planningScreenMeasured ? laneTasks : []).map((task) => {
                  const scheduledStart = task.scheduledStart ? new Date(task.scheduledStart) : null;
                  if (!scheduledStart || Number.isNaN(scheduledStart.getTime())) {
                    return null;
                  }
                  const placement = laneLayout.get(task.id);
                  if (!placement) {
                    return null;
                  }
                  const taskDurationMinutes = Math.max(1, Math.round(planningScheduledDurationSeconds(task) / 60));
                  const overlapTitle = planningOverlapTitlesByTaskId.get(task.id) ?? null;
                  const startLabel = formatPlanningClockLabel(scheduledStart);
                  return (
                    <div key={task.id} className={planningStyles.planningTaskGroup}>
                      {/* The duration, drawn from the start time and
                                    clipped at the axis end — the card can hang
                                    left of it, the bar never moves. */}
                      <span
                        aria-hidden="true"
                        className={planningStyles.planningBar}
                        data-blocked={project.status === "blocked"}
                        data-done={task.completed}
                        data-running={task.isRunning}
                        data-testid={`planning-bar-${task.id}`}
                        style={{
                          left: `${placement.barLeft}px`,
                          top: `${PLANNING_CARD_TOP + placement.row * (planningCardHeight + 8)}px`,
                          width: `${placement.barWidth}px`,
                        }}
                      />
                      <button
                        className={planningStyles.planningBlock}
                        data-material="well"
                        data-dragging={draggingScheduledTaskId === task.id}
                        data-hangs-left={placement.hangsLeft}
                        data-overlap={overlapTitle !== null}
                        data-overlap-pulse={planningOverlapPulseTaskId === task.id}
                        data-project-id={task.projectId}
                        data-row={placement.row}
                        data-selected={selectedTimelineTask?.id === task.id}
                        data-running={task.isRunning}
                        data-completed={task.completed}
                        data-scheduled-start={task.scheduledStart ?? ""}
                        data-time-label={startLabel}
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
                          left: `${placement.x}px`,
                          top: `${PLANNING_CARD_TOP + placement.row * (planningCardHeight + 8)}px`,
                        }}
                        title={
                          overlapTitle
                            ? `${task.title} · ${taskDurationMinutes} min · Overlaps '${overlapTitle}'. Drag the card, or press ← or → to move it 15 min.`
                            : `${task.title} · ${taskDurationMinutes} min`
                        }
                        type="button"
                      >
                        <span className={planningStyles.planningBlockTitle}>{task.title}</span>
                        <span className={planningStyles.planningBlockRow}>
                          {/* A narrow card keeps the start and the
                                        duration; the priority and the blocked
                                        word drop in that order, as the mock
                                        drops them (A-planning.html). */}
                          <span className={planningStyles.planningBlockMeta}>
                            {[
                              startLabel,
                              planningCardWidth < 200 ? `${taskDurationMinutes}m` : `${taskDurationMinutes} min`,
                              (task.isRunning || task.completed) && planningCardWidth < 260
                                ? null
                                : task.priority.toUpperCase(),
                              project.status === "blocked" && planningCardWidth >= 200 ? "blocked" : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                          {task.isRunning ? (
                            <span className={planningStyles.planningBlockRun}>
                              ● {formatPlanningElapsed(task.totalSeconds)}
                            </span>
                          ) : task.completed ? (
                            <span className={planningStyles.planningBlockDone}>
                              ✓ {formatPlanningElapsed(task.totalSeconds)}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
