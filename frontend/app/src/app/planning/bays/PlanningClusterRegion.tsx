import { PlanningCluster } from "../components/PlanningCluster";
import type { PlanningEditor } from "../usePlanningEditor";

/** The shell's cluster region for Planning: the day's state and its keys. */
export function PlanningClusterRegion({ editor }: { editor: PlanningEditor }) {
  const {
    planningBusyAction,
    projectComposerOpen,
    newProjectTitle,
    dayFacts,
    settings,
    projects,
    projectTaskCounts,
    projectTitles,
    plateProject,
    planningTimeReportOpen,
    viewDayLabel,
    viewIsToday,
    setNewProjectTitle,
  } = editor.view;
  const {
    closeProjectComposer,
    createPlanningProject,
    exportPlanningBackup,
    stepPlanningDay,
    openProjectComposer,
    togglePlanningTimeReport,
    togglePlanningMode,
    showPlanningProject,
    snapTimelineToNow,
    togglePlanningTaskTimer,
  } = editor.actions;
  const planningCluster = (
    <PlanningCluster
      busy={planningBusyAction !== null}
      composerOpen={projectComposerOpen}
      composerTitle={newProjectTitle}
      facts={dayFacts}
      modeSection={settings.modeSection}
      projects={projects}
      projectTaskCounts={projectTaskCounts}
      projectTitles={projectTitles}
      selectedProjectId={plateProject?.id ?? null}
      timeReportOpen={planningTimeReportOpen}
      viewDayLabel={viewDayLabel}
      viewIsToday={viewIsToday}
      onComposerCancel={closeProjectComposer}
      onComposerSubmit={() => void createPlanningProject()}
      onComposerTitleChange={setNewProjectTitle}
      onExportBackup={() => void exportPlanningBackup()}
      onNextDay={() => stepPlanningDay(1)}
      onOpenComposer={openProjectComposer}
      onOpenTimeReport={togglePlanningTimeReport}
      onPreviousDay={() => stepPlanningDay(-1)}
      onSelectMode={togglePlanningMode}
      onSelectProject={(projectId) => showPlanningProject(projectId)}
      onSnapToToday={snapTimelineToNow}
      onStopTimer={(taskId) => void togglePlanningTaskTimer(taskId, true)}
    />
  );
  return planningCluster;
}
