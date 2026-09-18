import planningStyles from "../PlanningWorkspace.module.css";
import { StatusBadge, EmptyState } from "@sse/design-system";
import { planningStatusTone } from "../planningHelpers";
import { boardColumns } from "../planningWorkspaceModel";
import type { PlanningEditor } from "../usePlanningEditor";

/** The board: one column per project status. */
export function PlanningBoardBay({ editor }: { editor: PlanningEditor }) {
  const { store } = editor.props;
  const {
    filteredProjects,
    settings,
    planningBoardDropTarget,
    draggingBoardProjectId,
    setPlanningBoardDropTarget,
    tasks,
    setDraggingBoardProjectId,
    projects,
  } = editor.view;
  const { resolvePlanningBoardDropIndex, clearPlanningBoardDragState, reorderPlanningProject, showPlanningProject } =
    editor.actions;
  return (
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
                  No {column.label.toLowerCase()} projects. Press All to see the rest.
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
                        planningBoardDropTarget?.status === column.id && planningBoardDropTarget.index === projectIndex
                      }
                      data-running={runningTask !== null}
                      data-selected={settings.selectedProjectId === project.id}
                      draggable
                      data-testid={`planning-board-card-${project.id}`}
                      role="group"
                      tabIndex={0}
                      aria-roledescription="Draggable kanban card"
                      aria-label={`${project.title}, ${column.label} column, position ${projectIndex + 1} of ${columnProjects.length}. Use arrow keys to move.`}
                      onClick={() =>
                        void store.updatePlanningSettings({
                          selectedProjectId: project.id,
                          selectedTaskId: projectTasks[0]?.id ?? null,
                        })
                      }
                      onKeyDown={(event) => {
                        // CONTROLS-03: keyboard parity for the pointer-drag
                        // verb. Reuses reorderPlanningProject (the drag path)
                        // — presentation-only, no new engine data. Modifier
                        // chords early-return so app/OS shortcuts are untouched.
                        if (event.metaKey || event.ctrlKey || event.altKey) {
                          return;
                        }
                        if (event.key === "Enter" || event.key === " ") {
                          // Only the card itself selects; the nested detail
                          // button keeps its own Enter/Space activation.
                          if (event.target !== event.currentTarget) {
                            return;
                          }
                          event.preventDefault();
                          void store.updatePlanningSettings({
                            selectedProjectId: project.id,
                            selectedTaskId: projectTasks[0]?.id ?? null,
                          });
                          return;
                        }
                        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                          // Reorder within the current status column.
                          const targetIndex = projectIndex + (event.key === "ArrowUp" ? -1 : 1);
                          if (targetIndex < 0 || targetIndex >= columnProjects.length) {
                            return;
                          }
                          event.preventDefault();
                          void reorderPlanningProject(project.id, column.id, targetIndex);
                          return;
                        }
                        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                          // Move to the adjacent status column (append to its end,
                          // matching the column-body pointer drop).
                          const columnIndex = boardColumns.findIndex((entry) => entry.id === column.id);
                          const targetColumnIndex = columnIndex + (event.key === "ArrowLeft" ? -1 : 1);
                          if (targetColumnIndex < 0 || targetColumnIndex >= boardColumns.length) {
                            return;
                          }
                          event.preventDefault();
                          const targetStatus = boardColumns[targetColumnIndex].id;
                          const targetCount = filteredProjects.filter((entry) => entry.status === targetStatus).length;
                          void reorderPlanningProject(project.id, targetStatus, targetCount);
                        }
                      }}
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
                          aria-label={`Show ${project.title} on the plate`}
                          className={planningStyles.planningBoardDetailButton}
                          onClick={(event) => {
                            event.stopPropagation();
                            showPlanningProject(project.id, projectTasks[0]?.id ?? null);
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
                <div className={planningStyles.planningBoardEmpty}>
                  No projects in this column. Drag a card here to move one in.
                </div>
              )}
            </div>
          </section>
        );
      })}
      {projects.length === 0 ? (
        <div className={planningStyles.planningBoardEmptyState}>
          <EmptyState
            title="No projects yet. Press N to start one."
            message="The board stays on screen, but with no projects there is nothing scheduled on this day."
          />
        </div>
      ) : null}
    </div>
  );
}
