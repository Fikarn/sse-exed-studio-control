import { useEffect, useState } from "react";

import { ConfirmDialog, Danger, Field, Fields, Key, PlateHead, Section, Well } from "@sse/design-system";
import type { JsonValue } from "@sse/engine-client";

import type { PlanningActivityEntry, PlanningProjectEntry, PlanningTaskEntry } from "../../shellData";
import { useLiveCallback } from "../../shared/useLiveCallback";
import {
  formatPlanningClockLabel,
  formatPlanningEnumLabel,
  formatPlanningRelativeTimestamp,
  planningDueDateLabel,
  planningScheduledDurationSeconds,
  planningTaskStateLabel,
} from "../planningHelpers";
import { formatPlanningElapsed } from "../planningState";
import styles from "./PlanningPlate.module.css";

// Visual overhaul A, Slice 6 (A-planning.html's plate; plan D1): the task in
// front of the operator, always on screen — no dialog to open and nothing to
// close. The head names the task and the project it belongs to, the live key
// says whether its timer is running and stops it, the schedule prints what the
// engine holds, and the project's other tasks, the day's activity and the one
// red command follow. It keeps the retired project-detail overlay's controls
// and their names, so what worked in the dialog works here.

export interface PlanningPlateProps {
  activity: readonly PlanningActivityEntry[];
  busy?: boolean;
  project: PlanningProjectEntry | null;
  projectTasks: readonly PlanningTaskEntry[];
  selectedTask: PlanningTaskEntry | null;
  onAddChecklistItem: (taskId: string, text: string) => Promise<JsonValue>;
  onCreateTask: (projectId: string, title: string) => Promise<JsonValue>;
  onDeleteTask?: (taskId: string) => void;
  onSelectTask: (taskId: string, projectId: string) => void;
  onToggleChecklistItem: (taskId: string, itemId: string, done: boolean) => Promise<void>;
  onToggleTaskComplete: (taskId: string) => void;
  onToggleTimer: (taskId: string, running: boolean) => void;
}

function taskEndLabel(task: PlanningTaskEntry) {
  if (!task.scheduledStart) return "—";
  const start = new Date(task.scheduledStart);
  if (Number.isNaN(start.getTime())) return "—";
  return formatPlanningClockLabel(new Date(start.getTime() + planningScheduledDurationSeconds(task) * 1000));
}

function taskStartLabel(task: PlanningTaskEntry) {
  if (!task.scheduledStart) return "unscheduled";
  const start = new Date(task.scheduledStart);
  return Number.isNaN(start.getTime()) ? "unscheduled" : formatPlanningClockLabel(start);
}

export function PlanningPlate({
  activity,
  busy = false,
  project,
  projectTasks,
  selectedTask,
  onAddChecklistItem,
  onCreateTask,
  onDeleteTask,
  onSelectTask,
  onToggleChecklistItem,
  onToggleTaskComplete,
  onToggleTimer,
}: PlanningPlateProps) {
  const [taskComposerOpen, setTaskComposerOpen] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [taskCreateBusy, setTaskCreateBusy] = useState(false);
  const [taskCreateError, setTaskCreateError] = useState<string | null>(null);
  const [checklistDrafts, setChecklistDrafts] = useState<Record<string, string>>({});
  const [checklistBusyTaskId, setChecklistBusyTaskId] = useState<string | null>(null);
  const [checklistErrors, setChecklistErrors] = useState<Record<string, string>>({});
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    setTaskComposerOpen(false);
    setNewTaskTitle("");
    setTaskCreateBusy(false);
    setTaskCreateError(null);
    setChecklistDrafts({});
    setChecklistBusyTaskId(null);
    setChecklistErrors({});
    setConfirmingDelete(false);
  }, [project?.id]);

  const submitNewTask = useLiveCallback(async () => {
    const title = newTaskTitle.trim();
    if (!title || !project) return;

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

  const submitChecklistItem = useLiveCallback(async (taskId: string) => {
    const text = (checklistDrafts[taskId] ?? "").trim();
    if (!text) return;

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

  const renderChecklist = (task: PlanningTaskEntry) => (
    <>
      {task.checklist.map((item) => (
        <button
          key={item.id}
          aria-label={`Toggle checklist item ${item.text} for ${task.title}`}
          className={styles.check}
          data-done={item.done}
          onClick={(event) => {
            event.stopPropagation();
            void onToggleChecklistItem(task.id, item.id, !item.done);
          }}
          type="button"
        >
          <span className={styles.checkBox}>{item.done ? "✓" : ""}</span>
          <span className={styles.checkText} data-done={item.done}>
            {item.text}
          </span>
        </button>
      ))}
      <form
        className={styles.checkComposer}
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void submitChecklistItem(task.id);
        }}
      >
        <input
          aria-label={`Checklist item text for ${task.title}`}
          className={styles.checkInput}
          data-well=""
          onChange={(event) => {
            const value = event.target.value;
            setChecklistDrafts((current) => ({ ...current, [task.id]: value }));
            if (checklistErrors[task.id]) {
              setChecklistErrors((current) => {
                const next = { ...current };
                delete next[task.id];
                return next;
              });
            }
          }}
          placeholder="Add checklist item"
          type="text"
          value={checklistDrafts[task.id] ?? ""}
        />
        <Key
          size="small"
          type="submit"
          aria-label={`Add checklist item for ${task.title}`}
          disabled={checklistBusyTaskId === task.id || (checklistDrafts[task.id] ?? "").trim().length === 0}
        >
          {checklistBusyTaskId === task.id ? "Adding…" : "Add item"}
        </Key>
      </form>
      {checklistErrors[task.id] ? <div className={styles.error}>{checklistErrors[task.id]}</div> : null}
    </>
  );

  if (!project) {
    return (
      <div className={styles.plate} data-testid="planning-project-detail" aria-label="Planning task">
        <PlateHead title="No project selected" sub="Select a lane or a card to put a task here" />
      </div>
    );
  }

  const completedTaskCount = projectTasks.filter((task) => task.completed).length;
  const checklistTotals = projectTasks.reduce(
    (totals, task) => ({
      done: totals.done + task.checklist.filter((item) => item.done).length,
      total: totals.total + task.checklist.length,
    }),
    { done: 0, total: 0 }
  );
  const selectedChecklistDone = selectedTask ? selectedTask.checklist.filter((item) => item.done).length : 0;

  return (
    <div className={styles.plate} data-testid="planning-project-detail" aria-label={project.title}>
      <PlateHead
        title={selectedTask ? selectedTask.title : project.title}
        sub={
          selectedTask
            ? [
                project.title,
                planningTaskStateLabel(selectedTask).toLowerCase(),
                selectedTask.priority.toUpperCase(),
                ...selectedTask.labels,
              ].join(" · ")
            : `${formatPlanningEnumLabel(project.status)} · ${project.priority.toUpperCase()}${
                project.description ? ` · ${project.description}` : ""
              }`
        }
        testId="planning-plate-head"
      />

      {selectedTask ? (
        <div className={styles.liveKeys}>
          <Key
            live={selectedTask.isRunning}
            take
            disabled={busy}
            cap={selectedTask.isRunning ? "Running" : "Start timer"}
            hint={
              selectedTask.isRunning
                ? `${formatPlanningElapsed(selectedTask.totalSeconds)} · stop`
                : formatPlanningElapsed(selectedTask.totalSeconds)
            }
            aria-pressed={selectedTask.isRunning}
            aria-label={
              selectedTask.isRunning
                ? `Timer running ${formatPlanningElapsed(selectedTask.totalSeconds)}, press to stop`
                : `Start the timer on ${selectedTask.title}`
            }
            testId="planning-plate-timer"
            onClick={() => onToggleTimer(selectedTask.id, selectedTask.isRunning)}
          />
          <Key
            take
            disabled={busy}
            engaged={selectedTask.completed}
            aria-pressed={selectedTask.completed}
            testId="planning-plate-complete"
            aria-label={`Mark ${selectedTask.title} ${selectedTask.completed ? "not done" : "done"}`}
            onClick={() => onToggleTaskComplete(selectedTask.id)}
          >
            {selectedTask.completed ? "Mark not done" : "Mark done"}
          </Key>
        </div>
      ) : null}

      {selectedTask ? (
        <Section
          title="Schedule"
          detail={selectedTask.scheduledStart ? "drag the card to move it" : "not on the day yet"}
          testId="planning-plate-schedule"
        >
          <Fields>
            <Field label="Start" value={taskStartLabel(selectedTask)} />
            <Field label="Duration" value={`${Math.round(planningScheduledDurationSeconds(selectedTask) / 60)} min`} />
            <Field label="Ends" value={taskEndLabel(selectedTask)} />
            <Field label="Due" value={planningDueDateLabel(selectedTask.dueDate) ?? "—"} />
            <Field label="Priority" value={selectedTask.priority.toUpperCase()} />
            <Field label="Status" value={planningTaskStateLabel(selectedTask).toLowerCase()} />
          </Fields>
        </Section>
      ) : null}

      {selectedTask ? (
        <Section
          title="Checklist"
          detail={
            selectedTask.checklist.length > 0
              ? `${selectedChecklistDone} of ${selectedTask.checklist.length} done`
              : "nothing on it yet"
          }
          testId="planning-plate-checklist"
        >
          {renderChecklist(selectedTask)}
        </Section>
      ) : null}

      {selectedTask ? (
        <Section
          title="Notes"
          detail={selectedTask.description ? "as written" : "none yet"}
          testId="planning-plate-notes"
        >
          <Well className={styles.notes}>
            {selectedTask.description || "Add a note for whoever picks this up next."}
          </Well>
        </Section>
      ) : null}

      <Section
        title="Tasks"
        detail={
          projectTasks.length > 0
            ? `${completedTaskCount}/${projectTasks.length} complete · ${
                checklistTotals.total > 0
                  ? `${checklistTotals.done}/${checklistTotals.total} checklist`
                  : "no checklist items"
              }`
            : "No tasks yet"
        }
        testId="planning-plate-tasks"
        actions={
          <Key
            size="small"
            testId="planning-plate-add-task"
            onClick={() => {
              if (taskComposerOpen) {
                setNewTaskTitle("");
                setTaskCreateError(null);
              }
              setTaskComposerOpen((open) => !open);
            }}
          >
            {taskComposerOpen ? "Cancel" : "Add task"}
          </Key>
        }
      >
        {taskComposerOpen ? (
          <form
            className={styles.taskComposer}
            onSubmit={(event) => {
              event.preventDefault();
              void submitNewTask();
            }}
          >
            <input
              aria-label={`New task for ${project.title}`}
              className={styles.checkInput}
              data-well=""
              onChange={(event) => {
                setNewTaskTitle(event.target.value);
                if (taskCreateError) setTaskCreateError(null);
              }}
              placeholder={`New task for ${project.title}`}
              type="text"
              value={newTaskTitle}
            />
            <Key
              size="small"
              mode="primary"
              type="submit"
              disabled={taskCreateBusy || newTaskTitle.trim().length === 0}
            >
              {taskCreateBusy ? "Adding…" : "Add Task"}
            </Key>
            {taskCreateError ? <div className={styles.error}>{taskCreateError}</div> : null}
          </form>
        ) : null}

        {projectTasks.length > 0 ? (
          <div className={styles.taskList}>
            {projectTasks.map((task) => {
              const dueDateLabel = planningDueDateLabel(task.dueDate);
              const isSelected = selectedTask?.id === task.id;
              return (
                <div
                  key={task.id}
                  className={styles.task}
                  data-selected={isSelected}
                  data-testid={`planning-plate-task-${task.id}`}
                >
                  <div className={styles.taskRow}>
                    <button
                      aria-label={`Toggle completion for ${task.title}`}
                      className={styles.taskToggle}
                      data-completed={task.completed}
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleTaskComplete(task.id);
                      }}
                      type="button"
                    >
                      {task.completed ? "✓" : ""}
                    </button>
                    <button
                      className={styles.taskButton}
                      onClick={() => onSelectTask(task.id, task.projectId)}
                      type="button"
                    >
                      <span className={styles.taskTitle} data-completed={task.completed}>
                        {task.title}
                      </span>
                      <span className={styles.taskMeta}>
                        {[
                          taskStartLabel(task),
                          planningTaskStateLabel(task).toLowerCase(),
                          task.priority.toUpperCase(),
                          task.totalSeconds > 0 ? formatPlanningElapsed(task.totalSeconds) : null,
                          dueDateLabel,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </button>
                    {task.isRunning ? <span className={styles.taskRunning}>● running</span> : null}
                  </div>
                  {/* The task the operator is looking at keeps its checklist in
                      the Checklist section above; the others carry theirs here,
                      so a checklist item is never printed twice. */}
                  {isSelected ? null : <div className={styles.taskChecklist}>{renderChecklist(task)}</div>}
                </div>
              );
            })}
          </div>
        ) : (
          <div className={styles.empty}>No tasks yet.</div>
        )}
      </Section>

      <Section
        title="Activity"
        detail={activity.length > 0 ? `${activity.length} events` : "No events"}
        testId="planning-plate-activity"
      >
        {activity.length > 0 ? (
          <div className={styles.activity}>
            {activity.map((entry) => (
              <div key={entry.id} className={styles.activityRow}>
                <span className={styles.activityTime}>{formatPlanningRelativeTimestamp(entry.timestamp)}</span>
                <span>
                  {formatPlanningEnumLabel(entry.action)}{" "}
                  <span className={styles.activityDetail}>
                    · {entry.detail || formatPlanningEnumLabel(entry.entityType)}
                  </span>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.empty}>No project activity yet.</div>
        )}
      </Section>

      {onDeleteTask && selectedTask ? (
        <Danger className={styles.danger}>
          <Key
            mode="danger"
            size="small"
            disabled={busy}
            testId="planning-plate-delete-task"
            onClick={() => setConfirmingDelete(true)}
          >
            Delete task…
          </Key>
        </Danger>
      ) : null}

      {confirmingDelete && onDeleteTask && selectedTask ? (
        <ConfirmDialog
          title="Delete task?"
          body={
            <>
              This removes <strong>{selectedTask.title}</strong> from {project.title}, with its checklist and the time
              its timer has put on it.
            </>
          }
          confirmLabel="Delete task"
          danger
          onConfirm={() => {
            setConfirmingDelete(false);
            onDeleteTask(selectedTask.id);
          }}
          onCancel={() => setConfirmingDelete(false)}
        />
      ) : null}
    </div>
  );
}
