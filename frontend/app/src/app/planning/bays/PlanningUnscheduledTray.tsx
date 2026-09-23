import { Well } from "@sse/design-system";
import planningStyles from "../PlanningWorkspace.module.css";
import type { PlanningEditor } from "../usePlanningEditor";

/** The tray of tasks that have no time yet (timeline only). */
export function PlanningUnscheduledTray({ editor }: { editor: PlanningEditor }) {
  const {
    visibleUnscheduledTasks,
    settings,
    allTasksUnscheduled,
    unscheduledTrayExpanded,
    setTrayExpanded,
    draggingUnscheduledTask,
    setDraggingUnscheduledTaskId,
    setPlanningDropTarget,
    projectTitles,
  } = editor.view;
  const { selectPlanningTask } = editor.actions;
  return (
    <>
      {visibleUnscheduledTasks.length > 0 && settings.modeSection === "timeline" ? (
        <Well
          radius="screen"
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
            <span>
              Unscheduled · {visibleUnscheduledTasks.length} {visibleUnscheduledTasks.length === 1 ? "task" : "tasks"}
            </span>
            <span>{unscheduledTrayExpanded ? "Collapse the tray" : "Expand the tray"}</span>
          </button>
          <div className={planningStyles.planningUnscheduledBody}>
            {visibleUnscheduledTasks.map((task) => (
              <button
                key={task.id}
                aria-label={`Select ${task.title}, unscheduled`}
                className={planningStyles.planningUnscheduledChip}
                data-material="well"
                draggable
                onClick={() => selectPlanningTask(task.id, task.projectId)}
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
                <span className={planningStyles.planningUnscheduledTitle}>{task.title}</span>
                <span className={planningStyles.planningUnscheduledMeta}>
                  {projectTitles.get(task.projectId) ?? task.projectId} · {task.priority.toUpperCase()}
                </span>
              </button>
            ))}
            <span className={planningStyles.planningUnscheduledHint}>
              Drag a card onto a lane to put it on the day.
            </span>
          </div>
        </Well>
      ) : null}
    </>
  );
}
