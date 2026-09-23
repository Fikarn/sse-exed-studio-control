import { PlanningLoadingSurface } from "./bays/PlanningLoadingSurface";
import { PlanningClusterRegion } from "./bays/PlanningClusterRegion";
import { PlanningScreenHead } from "./bays/PlanningScreenHead";
import planningStyles from "./PlanningWorkspace.module.css";
import { ShellRegion, EmptyState, Screen } from "@sse/design-system";
import { PlanningBoardBay } from "./bays/PlanningBoardBay";
import { PlanningTimelineBay } from "./bays/PlanningTimelineBay";
import { PlanningUnscheduledTray } from "./bays/PlanningUnscheduledTray";
import { PlanningPlate } from "./components/PlanningPlate";
import { PlanningFooter } from "./components/PlanningFooter";
import { PlanningTimeReportOverlay } from "./PlanningTimeReportOverlay";
import { planningFilters, type PlanningWorkspaceSurfaceProps } from "./planningWorkspaceModel";
import { usePlanningEditor } from "./usePlanningEditor";

/** The Planning workspace. It assembles; it owns nothing. State and handlers
 *  live in `usePlanningEditor`, the bays under `bays/` draw them. */
export function PlanningWorkspaceSurface(props: PlanningWorkspaceSurfaceProps) {
  const editor = usePlanningEditor(props);
  const { planningSnapshot } = props;
  const {
    settings,
    projects,
    showFilterBanner,
    showSearchZeroResult,
    hasPlanningSearch,
    planningSearchQuery,
    filteredProjects,
    planningFeedback,
    plateActivity,
    planningBusyAction,
    plateProject,
    plateTasks,
    plateSelectedTask,
    dayFacts,
    viewDayLabel,
    planningTimeReportOpen,
    planningTimeReportLoading,
    planningTimeReportError,
    planningTimeReport,
  } = editor.view;
  const {
    clearPlanningFilters,
    createPlanningProjectDetailChecklistItem,
    createPlanningProjectDetailTask,
    deletePlanningTaskById,
    selectPlanningTask,
    togglePlanningProjectDetailChecklistItem,
    togglePlanningProjectDetailTaskComplete,
    togglePlanningTaskTimer,
    closePlanningTimeReport,
  } = editor.actions;
  if (!planningSnapshot) {
    return <PlanningLoadingSurface editor={editor} />;
  }

  const planningCluster = <PlanningClusterRegion editor={editor} />;
  const planningScreenHead = <PlanningScreenHead editor={editor} />;

  return (
    <div
      aria-label="Planning workspace"
      className={planningStyles.planningWorkspace}
      data-testid="planning-workspace"
      role="region"
    >
      <ShellRegion region="cluster">{planningCluster}</ShellRegion>

      <div className={planningStyles.planningBody}>
        <main className={planningStyles.planningBay} data-region="timeline">
          <Screen head={planningScreenHead} testId="planning-screen">
            {settings.modeSection === "board" ? (
              <PlanningBoardBay editor={editor} />
            ) : projects.length === 0 ? (
              <div className={planningStyles.planningEmptyState}>
                <EmptyState
                  title="No projects yet. Press N to start one."
                  message="The timeline stays on screen, but with no projects there is nothing scheduled on this day."
                />
              </div>
            ) : (
              <PlanningTimelineBay editor={editor} />
            )}
          </Screen>

          <PlanningUnscheduledTray editor={editor} />

          {showFilterBanner || showSearchZeroResult ? (
            <div className={planningStyles.planningFilterBanner} role="status">
              <span>
                {hasPlanningSearch
                  ? `Search: "${planningSearchQuery.trim()}"`
                  : `Filter: ${planningFilters.find((filter) => filter.value === settings.viewFilter)?.label ?? settings.viewFilter}`}{" "}
                · {filteredProjects.length} of {projects.length} projects
              </span>
              <button
                className={planningStyles.planningFilterClear}
                data-material="key"
                onClick={() => clearPlanningFilters()}
                type="button"
              >
                Clear
              </button>
            </div>
          ) : null}

          {planningFeedback ? (
            <div className={planningStyles.planningToolbarNotice} data-tone={planningFeedback.tone} role="status">
              {planningFeedback.message}
            </div>
          ) : null}
        </main>

        <aside className={planningStyles.planningPlateColumn} data-material="plate" data-region="inspector">
          <PlanningPlate
            activity={plateActivity}
            busy={planningBusyAction !== null}
            project={plateProject}
            projectTasks={plateTasks}
            selectedTask={plateSelectedTask}
            onAddChecklistItem={createPlanningProjectDetailChecklistItem}
            onCreateTask={createPlanningProjectDetailTask}
            onDeleteTask={(taskId) => void deletePlanningTaskById(taskId)}
            onSelectTask={selectPlanningTask}
            onToggleChecklistItem={togglePlanningProjectDetailChecklistItem}
            onToggleTaskComplete={togglePlanningProjectDetailTaskComplete}
            onToggleTimer={(taskId, running) => void togglePlanningTaskTimer(taskId, running)}
          />
        </aside>
      </div>

      <ShellRegion region="footer">
        <PlanningFooter facts={dayFacts} viewDayLabel={viewDayLabel} />
      </ShellRegion>

      {planningTimeReportOpen ? (
        <PlanningTimeReportOverlay
          loading={planningTimeReportLoading}
          error={planningTimeReportError}
          report={planningTimeReport}
          onClose={closePlanningTimeReport}
        />
      ) : null}
    </div>
  );
}
