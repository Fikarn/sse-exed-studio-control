import { useEffect, useEffectEvent, useRef, useState } from "react";

import { Button, StatusBadge, Surface } from "@sse/design-system";
import type { JsonValue } from "@sse/engine-client";

import type { PlanningActivityEntry, PlanningProjectEntry, PlanningTaskEntry } from "../shellData";
import shellStyles from "../OperatorShell.module.css";
import planningStyles from "./PlanningWorkspace.module.css";
import {
  formatPlanningDuration,
  formatPlanningEnumLabel,
  formatPlanningRelativeTimestamp,
  formatPlanningTaskTimer,
  planningDueDateLabel,
  planningDueDateTone,
  planningStatusTone,
  planningTaskIsBlocked,
  planningTaskStateLabel,
} from "./planningHelpers";

export function PlanningProjectDetailOverlay({
  activity,
  checklistTotals,
  completedTaskCount,
  onClose,
  onAddChecklistItem,
  onCreateTask,
  onToggleChecklistItem,
  onSelectTask,
  onToggleTaskComplete,
  progressValue,
  project,
  selectedTaskId,
  tasks,
  totalProjectSeconds,
  totalTaskCount,
}: {
  activity: PlanningActivityEntry[];
  checklistTotals: { done: number; total: number };
  completedTaskCount: number;
  onClose: () => void;
  onAddChecklistItem: (taskId: string, text: string) => Promise<JsonValue>;
  onCreateTask: (projectId: string, title: string) => Promise<JsonValue>;
  onToggleChecklistItem: (taskId: string, itemId: string, done: boolean) => Promise<void>;
  onSelectTask: (taskId: string, projectId: string) => void;
  onToggleTaskComplete: (taskId: string) => void;
  progressValue: number;
  project: PlanningProjectEntry;
  selectedTaskId: string | null;
  tasks: PlanningTaskEntry[];
  totalProjectSeconds: number;
  totalTaskCount: number;
}) {
  const [taskComposerOpen, setTaskComposerOpen] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [taskCreateBusy, setTaskCreateBusy] = useState(false);
  const [taskCreateError, setTaskCreateError] = useState<string | null>(null);
  const [checklistDrafts, setChecklistDrafts] = useState<Record<string, string>>({});
  const [checklistBusyTaskId, setChecklistBusyTaskId] = useState<string | null>(null);
  const [checklistErrors, setChecklistErrors] = useState<Record<string, string>>({});
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setTaskComposerOpen(false);
    setNewTaskTitle("");
    setTaskCreateBusy(false);
    setTaskCreateError(null);
    setChecklistDrafts({});
    setChecklistBusyTaskId(null);
    setChecklistErrors({});
    dialogRef.current?.focus();
  }, [project.id]);

  const submitNewTask = useEffectEvent(async () => {
    const title = newTaskTitle.trim();
    if (!title) {
      return;
    }

    setTaskCreateBusy(true);
    setTaskCreateError(null);
    try {
      await onCreateTask(project.id, title);
      setNewTaskTitle("");
      setTaskComposerOpen(false);
    } catch (error) {
      setTaskCreateError(error instanceof Error ? error.message : "The task could not be created.");
    } finally {
      setTaskCreateBusy(false);
    }
  });

  const submitChecklistItem = useEffectEvent(async (taskId: string) => {
    const text = (checklistDrafts[taskId] ?? "").trim();
    if (!text) {
      return;
    }

    setChecklistBusyTaskId(taskId);
    setChecklistErrors((current) => {
      const next = { ...current };
      delete next[taskId];
      return next;
    });
    try {
      await onAddChecklistItem(taskId, text);
      setChecklistDrafts((current) => {
        const next = { ...current };
        delete next[taskId];
        return next;
      });
    } catch (error) {
      setChecklistErrors((current) => ({
        ...current,
        [taskId]: error instanceof Error ? error.message : "The checklist item could not be added.",
      }));
    } finally {
      setChecklistBusyTaskId((current) => (current === taskId ? null : current));
    }
  });

  return (
    <div className={shellStyles.overlay} onClick={() => onClose()} role="presentation">
      <Surface
        aria-labelledby="planning-project-detail-title"
        aria-modal="true"
        className={`${shellStyles.dialog} ${planningStyles.planningProjectDetailDialog}`}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onClose();
            event.preventDefault();
          }
        }}
        padding="lg"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        tone="raised"
      >
        <div className={planningStyles.planningProjectDetailHeader}>
          <div className={planningStyles.planningProjectDetailTitleBlock}>
            <div className={planningStyles.planningEyebrow}>Planning project</div>
            <div className={shellStyles.dialogTitle} id="planning-project-detail-title">
              {project.title}
            </div>
            {project.description ? (
              <p className={planningStyles.planningProjectDetailDescription}>{project.description}</p>
            ) : null}
            <div className={planningStyles.planningProjectDetailBadgeRow}>
              <StatusBadge
                label={project.priority.toUpperCase()}
                tone={project.priority === "p0" ? "error" : project.priority === "p1" ? "warning" : "idle"}
              />
              <StatusBadge label={formatPlanningEnumLabel(project.status)} tone={planningStatusTone(project.status)} />
            </div>
          </div>
          <Button onClick={onClose} size="compact" variant="ghost">
            Close
          </Button>
        </div>

        <div className={planningStyles.planningProjectDetailSummaryRow}>
          <div className={planningStyles.planningProjectDetailSummaryChip}>
            <span>Tasks</span>
            <strong>{totalTaskCount > 0 ? `${completedTaskCount}/${totalTaskCount} complete` : "No tasks yet"}</strong>
          </div>
          <div className={planningStyles.planningProjectDetailSummaryChip}>
            <span>Total time</span>
            <strong>{formatPlanningDuration(totalProjectSeconds)}</strong>
          </div>
          <div className={planningStyles.planningProjectDetailSummaryChip}>
            <span>Checklist</span>
            <strong>
              {checklistTotals.total > 0
                ? `${checklistTotals.done}/${checklistTotals.total} done`
                : "No checklist items"}
            </strong>
          </div>
        </div>

        {tasks.length > 0 ? (
          <div className={planningStyles.planningProjectDetailProgress}>
            <div
              className={planningStyles.planningProjectDetailProgressFill}
              style={{ width: `${Math.round(progressValue * 100)}%` }}
            />
          </div>
        ) : null}

        <div className={planningStyles.planningProjectDetailSections}>
          <section className={planningStyles.planningProjectDetailSection}>
            <div className={planningStyles.planningProjectDetailSectionHeader}>
              <div className={planningStyles.planningProjectDetailSectionTitle}>Tasks</div>
              <div className={planningStyles.planningProjectDetailSectionHeaderActions}>
                <div className={planningStyles.planningProjectDetailSectionMeta}>
                  {totalTaskCount} {totalTaskCount === 1 ? "task" : "tasks"}
                </div>
                <Button
                  onClick={() => {
                    if (taskComposerOpen) {
                      setNewTaskTitle("");
                      setTaskCreateError(null);
                    }
                    setTaskComposerOpen((open) => !open);
                  }}
                  size="compact"
                  variant={taskComposerOpen ? "secondary" : "ghost"}
                >
                  {taskComposerOpen ? "Cancel" : "+ Add Task"}
                </Button>
              </div>
            </div>
            {taskComposerOpen ? (
              <form
                className={planningStyles.planningProjectDetailTaskComposer}
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitNewTask();
                }}
              >
                <input
                  aria-label={`New task for ${project.title}`}
                  className={planningStyles.planningProjectDetailTaskComposerInput}
                  onChange={(event) => {
                    setNewTaskTitle(event.target.value);
                    if (taskCreateError) {
                      setTaskCreateError(null);
                    }
                  }}
                  placeholder={`New task for ${project.title}`}
                  type="text"
                  value={newTaskTitle}
                />
                <div className={planningStyles.planningProjectDetailTaskComposerActions}>
                  <Button
                    onClick={() => {
                      setTaskComposerOpen(false);
                      setNewTaskTitle("");
                      setTaskCreateError(null);
                    }}
                    size="compact"
                    type="button"
                    variant="ghost"
                  >
                    Cancel
                  </Button>
                  <Button
                    disabled={taskCreateBusy || newTaskTitle.trim().length === 0}
                    size="compact"
                    type="submit"
                    variant="primary"
                  >
                    {taskCreateBusy ? "Adding…" : "Add Task"}
                  </Button>
                </div>
                {taskCreateError ? (
                  <div className={planningStyles.planningProjectDetailTaskComposerError}>{taskCreateError}</div>
                ) : null}
              </form>
            ) : null}
            {tasks.length > 0 ? (
              <div className={planningStyles.planningProjectDetailTaskList}>
                {tasks.map((task) => {
                  const checklistDoneCount = task.checklist.filter((item) => item.done).length;
                  const dueDateLabel = planningDueDateLabel(task.dueDate);
                  return (
                    <div
                      key={task.id}
                      className={planningStyles.planningProjectDetailTaskCard}
                      data-selected={selectedTaskId === task.id}
                    >
                      <button
                        className={planningStyles.planningProjectDetailTaskCardButton}
                        onClick={() => onSelectTask(task.id, task.projectId)}
                        type="button"
                      >
                        <div className={planningStyles.planningProjectDetailTaskHeader}>
                          <div className={planningStyles.planningProjectDetailTaskTitleRow}>
                            <button
                              aria-label={`Toggle completion for ${task.title}`}
                              className={planningStyles.planningProjectDetailTaskToggle}
                              data-completed={task.completed}
                              onClick={(event) => {
                                event.stopPropagation();
                                onToggleTaskComplete(task.id);
                              }}
                              type="button"
                            >
                              {task.completed ? "✓" : ""}
                            </button>
                            {task.isRunning ? (
                              <span className={planningStyles.planningProjectDetailRunningDot} />
                            ) : null}
                            <span
                              className={planningStyles.planningProjectDetailTaskTitle}
                              data-completed={task.completed}
                            >
                              {task.title}
                            </span>
                          </div>
                          <div className={planningStyles.planningProjectDetailTaskBadgeRow}>
                            <StatusBadge
                              label={planningTaskStateLabel(task)}
                              tone={
                                task.completed
                                  ? "healthy"
                                  : planningTaskIsBlocked(task)
                                    ? "error"
                                    : task.isRunning
                                      ? "connected"
                                      : "idle"
                              }
                            />
                            <StatusBadge
                              label={task.priority.toUpperCase()}
                              tone={task.priority === "p0" ? "error" : task.priority === "p1" ? "warning" : "idle"}
                            />
                          </div>
                        </div>
                        <div className={planningStyles.planningProjectDetailTaskMeta}>
                          <span>{formatPlanningTaskTimer(task.totalSeconds)}</span>
                          {task.checklist.length > 0 ? (
                            <span>
                              {checklistDoneCount}/{task.checklist.length} checklist
                            </span>
                          ) : null}
                          {dueDateLabel ? (
                            <span data-tone={planningDueDateTone(task.dueDate)}>{dueDateLabel}</span>
                          ) : null}
                        </div>
                        {task.description ? (
                          <div className={planningStyles.planningProjectDetailTaskDescription}>{task.description}</div>
                        ) : null}
                      </button>
                      {task.checklist.length > 0 ? (
                        <div className={planningStyles.planningProjectDetailChecklistList}>
                          {task.checklist.map((item) => (
                            <button
                              key={item.id}
                              aria-label={`Toggle checklist item ${item.text} for ${task.title}`}
                              className={planningStyles.planningProjectDetailChecklistItem}
                              data-done={item.done}
                              onClick={(event) => {
                                event.stopPropagation();
                                void onToggleChecklistItem(task.id, item.id, !item.done);
                              }}
                              type="button"
                            >
                              <span className={planningStyles.planningProjectDetailChecklistToggle}>
                                {item.done ? "✓" : ""}
                              </span>
                              <span className={planningStyles.planningProjectDetailChecklistText} data-done={item.done}>
                                {item.text}
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <form
                        className={planningStyles.planningProjectDetailChecklistComposer}
                        onClick={(event) => event.stopPropagation()}
                        onSubmit={(event) => {
                          event.preventDefault();
                          void submitChecklistItem(task.id);
                        }}
                      >
                        <input
                          aria-label={`Checklist item text for ${task.title}`}
                          className={planningStyles.planningProjectDetailChecklistComposerInput}
                          onChange={(event) => {
                            const value = event.target.value;
                            setChecklistDrafts((current) => ({
                              ...current,
                              [task.id]: value,
                            }));
                            if (checklistErrors[task.id]) {
                              setChecklistErrors((current) => {
                                const next = { ...current };
                                delete next[task.id];
                                return next;
                              });
                            }
                          }}
                          placeholder="+ Add checklist item"
                          type="text"
                          value={checklistDrafts[task.id] ?? ""}
                        />
                        <Button
                          aria-label={`Add checklist item for ${task.title}`}
                          disabled={
                            checklistBusyTaskId === task.id || (checklistDrafts[task.id] ?? "").trim().length === 0
                          }
                          size="compact"
                          type="submit"
                          variant="ghost"
                        >
                          {checklistBusyTaskId === task.id ? "Adding…" : "Add"}
                        </Button>
                      </form>
                      {checklistErrors[task.id] ? (
                        <div className={planningStyles.planningProjectDetailChecklistError}>
                          {checklistErrors[task.id]}
                        </div>
                      ) : null}
                      {task.labels.length > 0 ? (
                        <div className={planningStyles.planningProjectDetailTaskLabels}>
                          {task.labels.map((label) => (
                            <span key={`${task.id}:${label}`} className={planningStyles.planningProjectDetailTaskLabel}>
                              {label}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className={planningStyles.planningProjectDetailEmpty}>No tasks yet.</div>
            )}
          </section>

          <section className={planningStyles.planningProjectDetailSection}>
            <div className={planningStyles.planningProjectDetailSectionHeader}>
              <div className={planningStyles.planningProjectDetailSectionTitle}>Recent activity</div>
              <div className={planningStyles.planningProjectDetailSectionMeta}>
                {activity.length > 0 ? `${activity.length} events` : "No events"}
              </div>
            </div>
            {activity.length > 0 ? (
              <div className={planningStyles.planningProjectDetailActivityList}>
                {activity.map((entry) => (
                  <div key={entry.id} className={planningStyles.planningProjectDetailActivityItem}>
                    <div className={planningStyles.planningProjectDetailActivityHeader}>
                      <span>{formatPlanningEnumLabel(entry.action)}</span>
                      <span>{formatPlanningRelativeTimestamp(entry.timestamp)}</span>
                    </div>
                    <div className={planningStyles.planningProjectDetailActivityBody}>
                      {entry.detail || formatPlanningEnumLabel(entry.entityType)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={planningStyles.planningProjectDetailEmpty}>No project activity yet.</div>
            )}
          </section>
        </div>
      </Surface>
    </div>
  );
}
