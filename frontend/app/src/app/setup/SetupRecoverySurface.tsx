import { useCallback, useEffect, useId, useMemo, useState } from "react";

import { Field, Key, LampWord, Readouts, Section, type LampTone } from "@sse/design-system";
import type { JsonValue, ShellStore, StartupFailure } from "@sse/engine-client";

import {
  asRecord,
  describeBackupKind,
  formatBackupTimestamp,
  getSupportBackups,
  healthCheckTone,
  RESTORE_HOLD_SENTENCE,
  type SnapshotRecord,
  withRestoreDetail,
} from "../shellData";
import { exportShellDiagnostics, openShellPath, resetWindowLayout } from "../shellCommands";
import { RestoreConfirmDialog, restoreKindOf, type RestorePrompt } from "./components/RestoreConfirmDialog";
import { useLiveCallback } from "../shared/useLiveCallback";
import { PreReadyState } from "../startup/PreReadyState";
import styles from "./SetupRecoverySurface.module.css";
import {
  type ActionFeedback,
  formatFailureCode,
  formatFailureStage,
  formatFileSize,
  formatPathLabel,
  getFailureTitle,
  readLogExcerpt,
} from "../startup/startupHelpers";

// Local helper. Round-trips an `unknown` through JSON so it can be embedded
// in the diagnostics report without leaking class identity / non-serialisable
// state.
function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
}

/** The backups a page of the list shows: the bay never scrolls, so the list pages. */
const BACKUPS_A_PAGE = 8;
/** The log's last lines the plate has room for. */
const LOG_LINES = 12;

/** A check of the hardware, as the recovery plate prints it: one word with its lamp. */
function checkWord(status: unknown, failed: boolean): { word: string; tone: LampTone } {
  // Nothing was read: a start that failed reads no health at all (the
  // handshake fails before it), so the three say so, not doubt.
  if (status === undefined) return failed ? { word: "not read", tone: "off" } : { word: "pending", tone: "off" };
  const tone = healthCheckTone(status);
  if (tone === "ok") return { word: "ready", tone: "ok" };
  if (tone === "error") return { word: "failed", tone: "error" };
  if (tone === "attention") return { word: "needs attention", tone: "attention" };
  return { word: "pending", tone: "off" };
}

export function SetupRecoverySurface({
  appSnapshot,
  failure,
  healthSnapshot,
  liveTransportRequested,
  onRequestRestart,
  store,
  supportSnapshot,
}: {
  appSnapshot: SnapshotRecord | null;
  failure: StartupFailure | null;
  healthSnapshot: SnapshotRecord | null;
  liveTransportRequested: boolean;
  onRequestRestart: () => void;
  store: ShellStore;
  supportSnapshot: SnapshotRecord | null;
}) {
  const runtime = asRecord(appSnapshot?.runtime);
  const runtimePaths = {
    ...Object.fromEntries(
      Object.entries(asRecord(runtime?.paths) ?? {}).flatMap(([key, value]) =>
        typeof value === "string" ? [[key, value]] : []
      )
    ),
    ...Object.fromEntries(
      Object.entries(failure?.paths ?? {}).flatMap(([key, value]) => (typeof value === "string" ? [[key, value]] : []))
    ),
  };
  const backups = useMemo(() => getSupportBackups(supportSnapshot), [supportSnapshot]);
  const [restorePath, setRestorePath] = useState("");
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const pathFieldId = useId();
  // A restore asks first, and says what it replaces (2026-09-28).
  const [restorePrompt, setRestorePrompt] = useState<RestorePrompt | null>(null);
  const cancelRestore = useCallback(() => setRestorePrompt(null), []);
  // `Restore latest` takes the newest database backup, never an archive
  // (Found, to check, 2026-09-29): a database backup brings back all the saved
  // data, and it is the one kind the hardware link restores while the saved
  // data does not open. It took the newest of either kind until then, and an
  // archive was refused.
  const lastBackup = backups.find((backup) => backup.kind === "database") ?? null;
  const storageFailed = failure?.code === "STORAGE_CORRUPT" || failure?.code === "STORAGE_MIGRATION_FAILED";
  const summary =
    failure?.message ??
    String(
      healthSnapshot?.summary ?? "Studio Control needs operator recovery. Retry startup, or restore the latest backup."
    );
  const detailEntries = Object.entries(asRecord(healthSnapshot?.details) ?? {});
  const pathEntries = Object.entries(runtimePaths);
  const recentLogExcerpt = readLogExcerpt(healthSnapshot?.recentLogExcerpt).slice(-LOG_LINES);
  // The hardware link answers the backup requests here only in recovery
  // mode — after a storage failure it stays up for exactly that (2026-09
  // production readiness, Slice 7 — F20); after any other failure it is gone.
  const engineRequestsAvailable = failure === null || storageFailed;
  const busy = busyAction !== null;
  const chosenPath = restorePath.trim();
  // While the saved data does not open only a database backup restores: an
  // archive in the field is locked here, with the reason on screen, rather
  // than refused by the hardware link after the question.
  const archiveRefused = storageFailed && chosenPath !== "" && restoreKindOf(chosenPath, backups) === "archive";
  // Slice 8 (system §9): name the hardware. The deck, the bridge and the desk.
  const diagnosticsChecks = [
    { key: "controlSurface", label: "The deck" },
    { key: "lighting", label: "The bridge" },
    { key: "audio", label: "The desk" },
  ].map(({ key, label }) => {
    const check = asRecord(asRecord(healthSnapshot?.checks)?.[key]);
    return {
      detail: String(check?.summary ?? `${label} reported nothing at startup.`),
      label,
      ...checkWord(check?.status, failure !== null),
    };
  });
  // What the restore can do here, said before the keys, so a locked key never
  // reads as one that would work.
  const restoreHint = storageFailed
    ? "While the saved data does not open, only a database backup can be restored. The hardware link restarts into it."
    : !engineRequestsAvailable
      ? failure?.code === "PROTOCOL_MISMATCH"
        ? "Nothing can be restored until the app and the hardware link are the same version."
        : "Nothing can be restored from here: retry the start, or restore from Setup / Support once Studio Control is back."
      : String(
          supportSnapshot?.restoreSummary ?? "Restore a backup archive or a database backup from the backups folder."
        );

  const pages = Math.max(1, Math.ceil(backups.length / BACKUPS_A_PAGE));
  useEffect(() => {
    if (page > pages - 1) setPage(pages - 1);
  }, [page, pages]);
  const shown = backups.slice(page * BACKUPS_A_PAGE, page * BACKUPS_A_PAGE + BACKUPS_A_PAGE);

  useEffect(() => {
    if (!lastBackup?.path) {
      return;
    }

    setRestorePath((current) => current || lastBackup.path);
  }, [lastBackup?.path]);

  const performAction = useLiveCallback(
    async (actionId: string, onRun: () => Promise<ActionFeedback | null | void>) => {
      setBusyAction(actionId);
      setFeedback(null);

      try {
        const result = await onRun();
        if (result) {
          setFeedback(result);
        }
      } catch (error) {
        setFeedback({
          message: error instanceof Error ? error.message : "The incident recovery action failed.",
          tone: "error",
        });
      } finally {
        setBusyAction(null);
      }
    }
  );

  const openReferencePath = async (label: string, path: string) => {
    const openedPath = await openShellPath(path);
    return {
      message: `${label} opened at ${openedPath}.`,
      tone: "info" as const,
    };
  };

  const exportDiagnostics = async () => {
    const report: Record<string, JsonValue> = {
      appSnapshot: toJsonValue(appSnapshot),
      failure: toJsonValue(failure),
      generatedAt: new Date().toISOString(),
      healthSnapshot: toJsonValue(healthSnapshot),
      liveTransportRequested,
      supportSnapshot: toJsonValue(supportSnapshot),
    };
    const path = await exportShellDiagnostics(report);
    return {
      message: `Diagnostics exported to ${path}.`,
      tone: "ok" as const,
    };
  };

  const restoreBackup = async (path: string) => {
    const result = asRecord(await store.restoreSupportBackup(path));
    return {
      message: `${withRestoreDetail(
        result?.requiresRestart === true
          ? `Database backup restored from ${String(result?.sourcePath ?? path)}; the hardware link restarted into it.`
          : `Restore requested from ${String(result?.sourcePath ?? path)}.`,
        result
      )} ${RESTORE_HOLD_SENTENCE}`,
      tone: "ok" as const,
    };
  };

  const folder = (label: string, path: string, actionId: string, testId: string) => (
    <Key
      size="small"
      disabled={!path.trim() || busy}
      testId={testId}
      onClick={() => void performAction(actionId, () => openReferencePath(label, path))}
    >
      {label}
    </Key>
  );

  return (
    // The one recovery screen, whichever page was open (2026-09-28). The
    // shell (overhaul 3): the display, its one way out (Retry startup), the
    // window's key under it and the message line in the cluster; what to do in
    // the bay (the sentence whole, the restore, the backups, where things
    // are); what the hardware reported on the plate. The visual overhaul
    // (2026-10-05): one key family, the design system's `Key`; no tooltips, so
    // everything is read without hovering.
    <PreReadyState
      tone="error"
      word={getFailureTitle(failure).toUpperCase()}
      sentence={summary}
      code={failure?.code ?? undefined}
      meta={`${formatFailureCode(failure)} · ${failure ? `at ${formatFailureStage(failure.stage)}` : "while running"}`}
      actions={
        <Key size="small" mode="primary" testId="setup-recovery-retry" onClick={onRequestRestart}>
          Retry startup
        </Key>
      }
      testId="setup-recovery-surface"
      cluster={
        <>
          <div className={styles.keys} data-testid="setup-recovery-keys">
            <Key
              size="small"
              disabled={busy}
              testId="setup-recovery-window-reset"
              onClick={() => void performAction("reset-window-layout", resetWindowLayout)}
            >
              Reset the window layout
            </Key>
          </div>
          {feedback ? (
            <div
              aria-live="polite"
              className={styles.feedback}
              data-testid="setup-recovery-feedback"
              data-tone={feedback.tone}
              role="status"
            >
              <LampWord
                tone={feedback.tone === "ok" ? "ok" : feedback.tone === "error" ? "error" : "info"}
                cap={false}
                className={styles.feedbackWords}
              >
                {feedback.message}
              </LampWord>
            </div>
          ) : null}
        </>
      }
      plate={
        <div className={styles.column} data-testid="setup-recovery-diagnostics">
          <Section title="Diagnostics">
            <ul className={styles.checks}>
              {diagnosticsChecks.map((check) => (
                <li key={check.label} className={styles.check}>
                  <span className={styles.checkTitle}>{check.label}</span>
                  <LampWord tone={check.tone} className={styles.checkWord}>
                    {check.word}
                  </LampWord>
                  <span className={styles.hint}>{check.detail}</span>
                </li>
              ))}
            </ul>
            <div className={styles.keys}>
              <Key
                size="small"
                disabled={busy}
                testId="setup-recovery-export-diagnostics"
                onClick={() => void performAction("export-diagnostics-card", exportDiagnostics)}
              >
                {busyAction === "export-diagnostics-card" ? "Working…" : "Export diagnostics"}
              </Key>
              <Key
                size="small"
                disabled={!String(runtimePaths.logFilePath ?? "").trim() || busy}
                testId="setup-recovery-open-log"
                onClick={() =>
                  void performAction("open-engine-log-card", () =>
                    openReferencePath("The log", String(runtimePaths.logFilePath ?? ""))
                  )
                }
              >
                Open the log
              </Key>
            </div>
          </Section>

          <Section title="Recovery evidence">
            {detailEntries.length > 0 ? (
              <ul className={styles.list} data-testid="setup-recovery-evidence">
                {detailEntries.map(([key, value]) => (
                  <li key={key}>
                    <span className={styles.listLabel}>{formatPathLabel(key)}</span>
                    <span className={styles.hint}>{String(value)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.hint}>
                Startup failed before Studio Control could write detailed incident evidence.
              </p>
            )}
          </Section>

          <Section title="File paths">
            <ul className={styles.list} data-testid="setup-recovery-paths">
              {pathEntries.length > 0 ? (
                pathEntries.map(([key, value]) => (
                  <li key={key}>
                    <span className={styles.listLabel}>{formatPathLabel(key)}</span>
                    <span className={styles.hint}>{value}</span>
                  </li>
                ))
              ) : (
                <li>
                  <span className={styles.hint}>No file paths were attached to this startup failure.</span>
                </li>
              )}
            </ul>
          </Section>

          {recentLogExcerpt.length > 0 ? (
            <Section title="The log's last lines" testId="setup-recovery-log">
              <pre className={styles.log}>{recentLogExcerpt.join("\n")}</pre>
            </Section>
          ) : null}
        </div>
      }
    >
      <div className={styles.column} data-testid="setup-recovery-cards">
        <Section title="What went wrong?">
          {/* The hardware link's sentence whole, and its code: the state
              display keeps two lines of the sentence and gives the code's
              slot away when the sentence takes both. */}
          <p className={styles.sentence} data-testid="setup-recovery-sentence">
            {summary}
          </p>
          {failure?.code ? (
            <p className={styles.code} data-testid="setup-recovery-code">
              {failure.code}
            </p>
          ) : null}
          {failure?.code === "PROTOCOL_MISMATCH" ? (
            <Readouts
              className={styles.facts}
              rows={[
                { id: "requested", label: "Requested protocol", value: failure.requestedProtocol ?? "unknown" },
                { id: "reported", label: "Reported protocol", value: failure.supportedProtocol ?? "unknown" },
              ]}
            />
          ) : null}
        </Section>

        <Section title="Restore">
          <div className={styles.restore}>
            <div className={styles.latest}>
              <Readouts
                rows={[
                  {
                    id: "latest",
                    label: "Latest database backup",
                    value: lastBackup ? formatBackupTimestamp(lastBackup.modifiedAt) : "No database backup yet",
                  },
                ]}
              />
              {/* What a restore can do here stays on screen, with a lock's reason. */}
              <p className={styles.hint} data-testid="setup-recovery-restore-hint">
                {restoreHint}
              </p>
            </div>
            <Field
              className={styles.field}
              label={<label htmlFor={pathFieldId}>Restore from path</label>}
              value={
                <input
                  id={pathFieldId}
                  className={styles.input}
                  autoComplete="off"
                  placeholder={String(runtimePaths.backupDir ?? "a file inside the backups folder")}
                  value={restorePath}
                  data-testid="setup-recovery-path-field"
                  onChange={(event) => setRestorePath(event.target.value)}
                />
              }
            />
          </div>
          <div className={styles.keys}>
            <Key
              disabled={!engineRequestsAvailable || !lastBackup || busy}
              testId="setup-recovery-restore-latest"
              onClick={() => {
                if (!lastBackup) {
                  return;
                }
                setRestorePrompt({ actionId: "restore-latest", path: lastBackup.path });
              }}
            >
              Restore latest…
            </Key>
            <Key
              disabled={!engineRequestsAvailable || !chosenPath || archiveRefused || busy}
              testId="setup-recovery-restore-path"
              onClick={() => setRestorePrompt({ actionId: "restore-path", path: chosenPath })}
            >
              Restore path…
            </Key>
          </div>
          {archiveRefused ? (
            <p className={styles.reason} data-testid="setup-recovery-archive-refused">
              The path is a backup archive. While the saved data does not open, choose a database backup.
            </p>
          ) : null}
        </Section>

        <Section
          title="Backups"
          detail={backups.length > 0 ? (backups.length === 1 ? "1 backup" : `${backups.length} backups`) : undefined}
        >
          {backups.length > 0 ? (
            <ol className={styles.backups}>
              {shown.map((backup, offset) => {
                const index = page * BACKUPS_A_PAGE + offset;
                const chosen = backup.path === chosenPath;
                return (
                  <li key={backup.path}>
                    {/* A press puts the backup's path in the field; nothing is restored. */}
                    <button
                      className={styles.backupRow}
                      aria-pressed={chosen}
                      data-selected={chosen ? "" : undefined}
                      data-testid={`setup-recovery-backup-${index}`}
                      onClick={() => setRestorePath(backup.path)}
                      type="button"
                    >
                      <span className={styles.backupName}>{backup.name}</span>
                      <span className={styles.backupMeta}>
                        {formatBackupTimestamp(backup.modifiedAt)} · {formatFileSize(backup.sizeBytes)} ·{" "}
                        {describeBackupKind(backup.kind)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className={styles.hint}>
              No backup list was published before startup failed. Name a file inside the backups folder above and
              restore it directly.
            </p>
          )}
          {pages > 1 ? (
            <div className={styles.pager}>
              <Key
                size="small"
                aria-label="Newer backups"
                disabled={page === 0}
                testId="setup-recovery-backups-newer"
                onClick={() => setPage((current) => Math.max(0, current - 1))}
              >
                ‹
              </Key>
              <span className={styles.pagerPlace}>
                {page + 1} / {pages}
              </span>
              <Key
                size="small"
                aria-label="Older backups"
                disabled={page >= pages - 1}
                testId="setup-recovery-backups-older"
                onClick={() => setPage((current) => Math.min(pages - 1, current + 1))}
              >
                ›
              </Key>
            </div>
          ) : null}
        </Section>

        <Section title="Where things are">
          <div className={styles.keys}>
            {folder("Backups", String(runtimePaths.backupDir ?? ""), "open-archive", "setup-recovery-open-backups")}
            {folder("App data", String(runtimePaths.appDataDir ?? ""), "open-app-data", "setup-recovery-open-app-data")}
            {folder(
              "Diagnostics",
              String(runtimePaths.exportsDir ?? runtimePaths.appDataDir ?? ""),
              "open-diagnostics",
              "setup-recovery-open-diagnostics"
            )}
            {folder("Logs", String(runtimePaths.logsDir ?? ""), "open-logs", "setup-recovery-open-logs")}
          </div>
        </Section>
      </div>

      {restorePrompt ? (
        <RestoreConfirmDialog
          backups={backups}
          busy={busy}
          prompt={restorePrompt}
          onCancel={cancelRestore}
          onConfirm={() => {
            setRestorePrompt(null);
            void performAction(restorePrompt.actionId, () => restoreBackup(restorePrompt.path));
          }}
        />
      ) : null}
    </PreReadyState>
  );
}
