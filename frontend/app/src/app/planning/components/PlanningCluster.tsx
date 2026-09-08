import { useEffect, useRef } from "react";

import { Key, Lamp, Section, Segmented, StateDisplay, Well } from "@sse/design-system";

import type { PlanningProjectEntry } from "../../shellData";
import { formatPlanningClockLabel } from "../planningHelpers";
import { derivePlanningState, formatPlanningElapsed, type PlanningDayFacts } from "../planningState";
import styles from "./PlanningCluster.module.css";

// Visual overhaul A, Slice 6 (system §2, §7, plan Slice 6): Planning's cluster.
// The day's state first and fixed — is anything late, is anything blocked, how
// much is left — then the timers that are running right now with the key that
// stops them, the view and the day, the projects that own the lanes, what the
// timers have put on each project today, and the standing actions at the foot.

export interface PlanningClusterProps {
  busy?: boolean;
  facts: PlanningDayFacts;
  modeSection: "timeline" | "board";
  projects: readonly PlanningProjectEntry[];
  projectTaskCounts: ReadonlyMap<string, number>;
  projectTitles: ReadonlyMap<string, string>;
  selectedProjectId: string | null;
  viewDayLabel: string;
  viewIsToday: boolean;
  composerOpen: boolean;
  composerTitle: string;
  onComposerTitleChange: (value: string) => void;
  onComposerSubmit: () => void;
  onComposerCancel: () => void;
  onOpenComposer: () => void;
  onExportBackup: () => void;
  onNextDay: () => void;
  onPreviousDay: () => void;
  onSelectMode: (mode: "timeline" | "board") => void;
  onSelectProject: (projectId: string) => void;
  onSnapToToday: () => void;
  onStopTimer: (taskId: string) => void;
  onOpenTimeReport: () => void;
  timeReportOpen: boolean;
}

function projectStatusWord(status: string) {
  return status.replace("-", " ");
}

function projectLampTone(status: string) {
  if (status === "blocked") return "error" as const;
  if (status === "in-progress") return "attention" as const;
  if (status === "done") return "ok" as const;
  return "off" as const;
}

export function PlanningCluster({
  busy = false,
  facts,
  modeSection,
  projects,
  projectTaskCounts,
  projectTitles,
  selectedProjectId,
  viewDayLabel,
  viewIsToday,
  composerOpen,
  composerTitle,
  onComposerTitleChange,
  onComposerSubmit,
  onComposerCancel,
  onOpenComposer,
  onExportBackup,
  onNextDay,
  onPreviousDay,
  onSelectMode,
  onSelectProject,
  onSnapToToday,
  onStopTimer,
  onOpenTimeReport,
  timeReportOpen,
}: PlanningClusterProps) {
  const state = derivePlanningState(facts);
  const runningTasks = facts.runningTasks;
  // Opening the composer puts the caret in it, as the toolbar's did.
  const composerInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!composerOpen) return;
    composerInputRef.current?.focus();
    composerInputRef.current?.select();
  }, [composerOpen]);

  return (
    <div className={styles.cluster} data-planning-cluster="" data-testid="planning-cluster">
      <StateDisplay
        tone={state.tone}
        word={state.word}
        sentence={state.sentence}
        meta={state.meta}
        data-toolbar-primary="title"
        testId="planning-state-display"
      />

      {runningTasks.length > 0 ? (
        <Section
          className={styles.section}
          title="Running"
          detail={`${runningTasks.length} ${runningTasks.length === 1 ? "timer" : "timers"}`}
          testId="planning-running-section"
        >
          {runningTasks.map((task) => {
            const started = task.lastStarted ? new Date(task.lastStarted) : null;
            const startedLabel =
              started && !Number.isNaN(started.getTime()) ? `started ${formatPlanningClockLabel(started)}` : "started";
            return (
              <Well key={task.id} className={styles.timer} data-testid={`planning-running-timer-${task.id}`}>
                <div className={styles.timerName}>
                  <Lamp tone="ok" />
                  <span className={styles.timerTitle}>{task.title}</span>
                </div>
                <div className={styles.timerMeta}>
                  {projectTitles.get(task.projectId) ?? task.projectId} · {startedLabel} ·{" "}
                  <span className={styles.timerElapsed}>{formatPlanningElapsed(task.totalSeconds)}</span>
                </div>
                <Key
                  size="small"
                  take
                  disabled={busy}
                  testId={`planning-stop-timer-${task.id}`}
                  aria-label={`Stop the timer on ${task.title}`}
                  onClick={() => onStopTimer(task.id)}
                >
                  Stop
                </Key>
              </Well>
            );
          })}
        </Section>
      ) : null}

      <Segmented label="Planning mode" className={styles.viewSwitch} testId="planning-mode-switch">
        <Key
          mode="segmented"
          cap="Timeline"
          take
          engaged={modeSection === "timeline"}
          role="radio"
          aria-checked={modeSection === "timeline"}
          testId="planning-mode-timeline"
          onClick={() => onSelectMode("timeline")}
        />
        <Key
          mode="segmented"
          cap="Board"
          take
          engaged={modeSection === "board"}
          role="radio"
          aria-checked={modeSection === "board"}
          testId="planning-mode-board"
          onClick={() => onSelectMode("board")}
        />
      </Segmented>

      <div className={styles.day} role="group" aria-label="Day">
        <Key size="small" take aria-label="Previous day" testId="planning-day-previous" onClick={onPreviousDay}>
          ‹
        </Key>
        {/* The day, long enough to read on the studio monitor and short
            enough to fit the narrower chrome (A-planning.html's .long/.short). */}
        <Key
          take
          className={styles.dayKey}
          testId="planning-day-today"
          aria-label={viewIsToday ? `Today · ${facts.dayLabel}` : `Go to today, showing ${viewDayLabel}`}
          onClick={onSnapToToday}
        >
          <span className={styles.dayLong}>{viewIsToday ? `Today · ${facts.dayLabel}` : viewDayLabel}</span>
          <span className={styles.dayShort}>{viewIsToday ? `Today · ${facts.dayShortLabel}` : viewDayLabel}</span>
        </Key>
        <Key size="small" take aria-label="Next day" testId="planning-day-next" onClick={onNextDay}>
          ›
        </Key>
      </div>

      <Section
        className={styles.section}
        title="Projects"
        detail={`${projects.length} · one lane each`}
        testId="planning-projects-section"
        actions={
          composerOpen ? null : (
            <Key
              size="small"
              data-toolbar-primary="add"
              testId="planning-new-project"
              disabled={busy}
              onClick={onOpenComposer}
            >
              New project
            </Key>
          )
        }
      >
        {composerOpen ? (
          <div className={styles.composer} data-testid="planning-project-composer">
            <input
              aria-label="New project title"
              className={styles.composerInput}
              data-well=""
              disabled={busy}
              onChange={(event) => onComposerTitleChange(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onComposerSubmit();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  onComposerCancel();
                }
              }}
              placeholder="New project title"
              ref={composerInputRef}
              type="text"
              value={composerTitle}
            />
            <div className={styles.composerKeys}>
              <Key
                size="small"
                mode="primary"
                disabled={composerTitle.trim().length === 0 || busy}
                testId="planning-add-project"
                onClick={onComposerSubmit}
              >
                Add project
              </Key>
              <Key size="small" disabled={busy} testId="planning-cancel-project" onClick={onComposerCancel}>
                Cancel
              </Key>
            </div>
          </div>
        ) : null}
        <div className={styles.projects}>
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              className={styles.project}
              data-material="key"
              data-selected={selectedProjectId === project.id}
              data-status={project.status}
              data-testid={`planning-project-key-${project.id}`}
              onClick={() => onSelectProject(project.id)}
            >
              <Lamp tone={projectLampTone(project.status)} />
              <span className={styles.projectName}>{project.title}</span>
              <span className={styles.projectMeta}>
                {projectTaskCounts.get(project.id) ?? 0} tasks · {project.priority.toUpperCase()}
                {project.description ? ` · ${project.description}` : ""}
              </span>
              <span className={styles.projectStatus} data-status={project.status}>
                {projectStatusWord(project.status)}
              </span>
            </button>
          ))}
        </div>
      </Section>

      {facts.trackedByProject.length > 0 ? (
        <Section
          className={styles.section}
          title="Tracked today"
          detail="by project · from the timers"
          testId="planning-tracked-section"
          actions={
            <Key
              size="small"
              mode="toggle"
              engaged={timeReportOpen}
              aria-pressed={timeReportOpen}
              testId="planning-time-report"
              onClick={onOpenTimeReport}
            >
              Time report
            </Key>
          }
        >
          <dl className={styles.tracked}>
            {facts.trackedByProject.map((entry) => (
              <div key={entry.projectId} className={styles.trackedRow}>
                <dt>{entry.title}</dt>
                <dd>{formatPlanningElapsed(entry.seconds)}</dd>
              </div>
            ))}
            <div className={styles.trackedRow} data-total="">
              <dt>Today</dt>
              <dd data-testid="planning-tracked-total">{formatPlanningElapsed(facts.trackedTotalSeconds)}</dd>
            </div>
          </dl>
        </Section>
      ) : null}

      {/* The mock's `New task N` key lives on the plate instead: a task is
          created inside a project, and the plate is where the project in front
          of the operator is. `N` stays on New project, where it already was. */}
      <Section className={styles.actions} title="Day" testId="planning-standing-actions">
        <div className={styles.actionRow}>
          <Key
            size="small"
            mode="toggle"
            engaged={modeSection === "board"}
            cap="Board view"
            hint="Shift B"
            testId="planning-board-view"
            onClick={() => onSelectMode(modeSection === "board" ? "timeline" : "board")}
          />
          <Key size="small" disabled={busy} testId="planning-backup" onClick={onExportBackup}>
            Backup
          </Key>
        </div>
      </Section>
    </div>
  );
}
