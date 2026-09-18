import { useEffect } from "react";
import { isEditableTarget } from "../../shellData";
import { planningDateOnly } from "../planningHelpers";
import type { PlanningView } from "./usePlanningView";
import type { PlanningActions } from "./usePlanningActions";

/** The Planning workspace's keyboard shortcuts. */
export function usePlanningShortcuts({ view, actions }: { view: PlanningView; actions: PlanningActions }) {
  const {
    planningTimeReportOpenRef,
    selectedTimelineTaskRef,
    settings,
    setTimelineDay,
    setTimelineOffsetMinutes,
    currentMinute,
    filteredProjects,
    selectedTimelineTask,
    timelineBaseStartMinute,
    timelineDayKey,
    timelineRangeMinutes,
  } = view;
  const {
    closePlanningTimeReport,
    clearPlanningTaskSelection,
    openProjectComposer,
    focusPlanningSearch,
    togglePlanningTimeReport,
    updatePlanningViewFilter,
    snapTimelineToNow,
    showPlanningProject,
    reschedulePlanningTask,
    movePlanningTaskToAdjacentLane,
    pulsePlanningOverlap,
  } = actions;
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
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

      // Visual overhaul A, Slice 6: the plate is always on screen, so Escape
      // does not close it — it takes the task off it.
      if (event.key === "Escape" && selectedTimelineTaskRef.current) {
        clearPlanningTaskSelection();
        event.preventDefault();
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
        showPlanningProject(keyboardSelectedTimelineTask.projectId, keyboardSelectedTimelineTask.id);
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
    clearPlanningTaskSelection,
    closePlanningTimeReport,
    currentMinute,
    focusPlanningSearch,
    filteredProjects,
    movePlanningTaskToAdjacentLane,
    showPlanningProject,
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
    planningTimeReportOpenRef,
    selectedTimelineTaskRef,
    setTimelineDay,
    setTimelineOffsetMinutes,
  ]);
}
