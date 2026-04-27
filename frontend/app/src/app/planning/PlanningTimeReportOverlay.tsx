import { Button, Surface } from "@sse/design-system";

import shellStyles from "../OperatorShell.module.css";
import planningStyles from "./PlanningWorkspace.module.css";
import { formatPlanningDuration, type PlanningTimeReportData } from "./planningHelpers";

export function PlanningTimeReportOverlay({
  error,
  loading,
  onClose,
  report,
}: {
  error: string | null;
  loading: boolean;
  onClose: () => void;
  report: PlanningTimeReportData | null;
}) {
  const largestProjectTotal = report?.byProject[0]?.totalSeconds ?? 1;

  return (
    <div className={shellStyles.overlay} role="presentation">
      <Surface
        aria-labelledby="planning-time-report-title"
        aria-modal="true"
        className={`${shellStyles.dialog} ${planningStyles.planningTimeReportDialog}`}
        padding="lg"
        role="dialog"
        tone="raised"
      >
        <div className={planningStyles.planningTimeReportHeader}>
          <div className={planningStyles.planningTimeReportTitleBlock}>
            <div className={planningStyles.planningEyebrow}>Planning report</div>
            <div className={shellStyles.dialogTitle} id="planning-time-report-title">
              Time report
            </div>
            <div className={planningStyles.planningTimeReportTotal}>
              {loading ? "Loading…" : formatPlanningDuration(report?.totalSeconds ?? 0)}
            </div>
            <p className={planningStyles.planningTimeReportSubtitle}>
              Total tracked time across the current planning dataset.
            </p>
          </div>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className={planningStyles.planningTimeReportSections}>
          <section className={planningStyles.planningTimeReportSection}>
            <div className={planningStyles.planningTimeReportSectionTitle}>By project</div>
            {error ? (
              <div className={planningStyles.planningTimeReportEmpty}>{error}</div>
            ) : loading ? (
              <div className={planningStyles.planningTimeReportEmpty}>Loading…</div>
            ) : report && report.byProject.length > 0 ? (
              report.byProject.map((entry) => (
                <div key={entry.projectId || entry.title} className={planningStyles.planningTimeReportProjectRow}>
                  <div className={planningStyles.planningTimeReportProjectMeta}>
                    <span>{entry.title}</span>
                    <span>
                      {entry.taskCount} {entry.taskCount === 1 ? "task" : "tasks"} ·{" "}
                      {formatPlanningDuration(entry.totalSeconds)}
                    </span>
                  </div>
                  <div className={planningStyles.planningTimeReportBar}>
                    <div
                      className={planningStyles.planningTimeReportBarFill}
                      style={{
                        width: `${Math.max(
                          8,
                          Math.round((entry.totalSeconds / Math.max(1, largestProjectTotal)) * 100)
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className={planningStyles.planningTimeReportEmpty}>No time tracked yet.</div>
            )}
          </section>

          <section className={planningStyles.planningTimeReportSection}>
            <div className={planningStyles.planningTimeReportSectionTitle}>By task</div>
            {error ? (
              <div className={planningStyles.planningTimeReportEmpty}>{error}</div>
            ) : loading ? (
              <div className={planningStyles.planningTimeReportEmpty}>Loading…</div>
            ) : report && report.byTask.length > 0 ? (
              report.byTask.slice(0, 10).map((entry) => (
                <div
                  key={entry.taskId || `${entry.projectId}:${entry.taskTitle}`}
                  className={planningStyles.planningTimeReportTaskRow}
                >
                  <div className={planningStyles.planningTimeReportTaskMeta}>
                    <span>{entry.taskTitle}</span>
                    <span>{entry.projectTitle}</span>
                  </div>
                  <div className={planningStyles.planningTimeReportTaskDuration}>
                    {entry.isRunning ? <span className={planningStyles.planningTimeReportRunningDot} /> : null}
                    <span>{formatPlanningDuration(entry.totalSeconds)}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className={planningStyles.planningTimeReportEmpty}>No time tracked yet.</div>
            )}
          </section>
        </div>
      </Surface>
    </div>
  );
}
