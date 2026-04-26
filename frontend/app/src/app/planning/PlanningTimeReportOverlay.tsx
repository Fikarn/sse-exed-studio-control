import { Button, Surface } from "@sse/design-system";

import styles from "../OperatorShell.module.css";
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
    <div className={styles.overlay} role="presentation">
      <Surface
        aria-labelledby="planning-time-report-title"
        aria-modal="true"
        className={`${styles.dialog} ${styles.planningTimeReportDialog}`}
        padding="lg"
        role="dialog"
        tone="raised"
      >
        <div className={styles.planningTimeReportHeader}>
          <div className={styles.planningTimeReportTitleBlock}>
            <div className={styles.planningEyebrow}>Planning report</div>
            <div className={styles.dialogTitle} id="planning-time-report-title">
              Time report
            </div>
            <div className={styles.planningTimeReportTotal}>
              {loading ? "Loading…" : formatPlanningDuration(report?.totalSeconds ?? 0)}
            </div>
            <p className={styles.planningTimeReportSubtitle}>Total tracked time across the current planning dataset.</p>
          </div>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className={styles.planningTimeReportSections}>
          <section className={styles.planningTimeReportSection}>
            <div className={styles.planningTimeReportSectionTitle}>By project</div>
            {error ? (
              <div className={styles.planningTimeReportEmpty}>{error}</div>
            ) : loading ? (
              <div className={styles.planningTimeReportEmpty}>Loading…</div>
            ) : report && report.byProject.length > 0 ? (
              report.byProject.map((entry) => (
                <div key={entry.projectId || entry.title} className={styles.planningTimeReportProjectRow}>
                  <div className={styles.planningTimeReportProjectMeta}>
                    <span>{entry.title}</span>
                    <span>
                      {entry.taskCount} {entry.taskCount === 1 ? "task" : "tasks"} ·{" "}
                      {formatPlanningDuration(entry.totalSeconds)}
                    </span>
                  </div>
                  <div className={styles.planningTimeReportBar}>
                    <div
                      className={styles.planningTimeReportBarFill}
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
              <div className={styles.planningTimeReportEmpty}>No time tracked yet.</div>
            )}
          </section>

          <section className={styles.planningTimeReportSection}>
            <div className={styles.planningTimeReportSectionTitle}>By task</div>
            {error ? (
              <div className={styles.planningTimeReportEmpty}>{error}</div>
            ) : loading ? (
              <div className={styles.planningTimeReportEmpty}>Loading…</div>
            ) : report && report.byTask.length > 0 ? (
              report.byTask.slice(0, 10).map((entry) => (
                <div
                  key={entry.taskId || `${entry.projectId}:${entry.taskTitle}`}
                  className={styles.planningTimeReportTaskRow}
                >
                  <div className={styles.planningTimeReportTaskMeta}>
                    <span>{entry.taskTitle}</span>
                    <span>{entry.projectTitle}</span>
                  </div>
                  <div className={styles.planningTimeReportTaskDuration}>
                    {entry.isRunning ? <span className={styles.planningTimeReportRunningDot} /> : null}
                    <span>{formatPlanningDuration(entry.totalSeconds)}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className={styles.planningTimeReportEmpty}>No time tracked yet.</div>
            )}
          </section>
        </div>
      </Surface>
    </div>
  );
}
