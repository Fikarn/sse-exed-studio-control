import { useCallback, useEffect, useId, useMemo, useState } from "react";

import { Field, Key, LampWord, Readouts, Section } from "@sse/design-system";
import type { JsonValue, ShellStore, StartupFailure } from "@sse/engine-client";

import {
  asRecord,
  describeBackupKind,
  formatBackupTimestamp,
  getSupportBackups,
  RESTORE_HOLD_SENTENCE,
  type SnapshotRecord,
  withRestoreDetail,
} from "../shellData";
import { exportShellDiagnostics, openShellPath, resetWindowLayout } from "../shellCommands";
import { RestoreConfirmDialog, restoreKindOf, type RestorePrompt } from "./components/RestoreConfirmDialog";
import { useLiveCallback } from "../shared/useLiveCallback";
import { HardwareChecks } from "../startup/HardwareChecks";
import { PreReadyState } from "../startup/PreReadyState";
import styles from "./SetupRecoverySurface.module.css";
import {
  type ActionFeedback,
  formatFailureMeta,
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

/** Why Restore path is locked for an archive, under the key and as its reason. */
const ARCHIVE_REFUSED = "The path is a backup archive. While the saved data does not open, choose a database backup.";

/** The places "Where things are" lists, in this order; any other the hardware link sends follows them. */
const PLACE_ORDER = ["backupDir", "appDataDir", "logsDir", "logFilePath", "dbPath", "exportsDir"];
/** The folders a key opens, on the folder's own row: the action and the key's test id (the ids from before). */
const FOLDER_KEYS: Record<string, { actionId: string; testId: string }> = {
  backupDir: { actionId: "open-archive", testId: "setup-recovery-open-backups" },
  appDataDir: { actionId: "open-app-data", testId: "setup-recovery-open-app-data" },
  logsDir: { actionId: "open-logs", testId: "setup-recovery-open-logs" },
  exportsDir: { actionId: "open-diagnostics", testId: "setup-recovery-open-diagnostics" },
};
const placeRank = (key: string) => {
  const rank = PLACE_ORDER.indexOf(key);
  return rank === -1 ? PLACE_ORDER.length : rank;
};

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
  // The visual overhaul's polish (2026-10-05): the page's own sentence fits
  // the display's two lines; Retry startup, beside it, names the first way out.
  const summary =
    failure?.message ??
    String(healthSnapshot?.summary ?? "Studio Control did not start. If a retry fails, restore a backup.");
  const detailEntries = Object.entries(asRecord(healthSnapshot?.details) ?? {});
  const pathEntries = Object.entries(runtimePaths).sort(([left], [right]) => placeRank(left) - placeRank(right));
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
          message: error instanceof Error ? error.message : "The action failed.",
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

  // A folder's key, on its row: the row names the place, so the key reads
  // `Open`, and its accessible name says which.
  const folder = (name: string, path: string, actionId: string, testId: string) => (
    <Key
      size="small"
      aria-label={`Open ${name.toLowerCase()}`}
      disabled={!path.trim() || busy}
      testId={testId}
      onClick={() => void performAction(actionId, () => openReferencePath(name, path))}
    >
      Open
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
      meta={formatFailureMeta(failure)}
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
            {/* The visual overhaul's polish (2026-10-05): the start-up plate's
                list as well; a check never read is its name and NOT READ. */}
            <HardwareChecks healthSnapshot={healthSnapshot} failed={failure !== null} />
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
              <p className={styles.hint}>Startup failed before the hardware link reported what happened.</p>
            )}
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
          {/* The visual overhaul's polish (2026-10-05): each key under what it
              acts on, Restore latest under the latest backup and Restore path
              under the field (they stood together under the left half, 700 px
              from the field). A refusal is the locked form, its reason the
              sentence printed above it; `disabled` is only the busy moment. */}
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
            <div className={styles.keys}>
              <Key
                locked={!engineRequestsAvailable || !lastBackup}
                reason={!engineRequestsAvailable ? restoreHint : "No database backup yet."}
                disabled={busy}
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
            </div>
            <div className={styles.pathKeys}>
              <Key
                locked={!engineRequestsAvailable || !chosenPath || archiveRefused}
                reason={
                  archiveRefused
                    ? ARCHIVE_REFUSED
                    : !engineRequestsAvailable
                      ? restoreHint
                      : "Name a file inside the backups folder."
                }
                disabled={busy}
                testId="setup-recovery-restore-path"
                onClick={() => setRestorePrompt({ actionId: "restore-path", path: chosenPath })}
              >
                Restore path…
              </Key>
              {archiveRefused ? (
                <p className={styles.reason} data-testid="setup-recovery-archive-refused">
                  {ARCHIVE_REFUSED}
                </p>
              ) : null}
            </div>
          </div>
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
                    {/* A press puts the backup's path in the field; nothing is restored.
                        The visual overhaul's polish (2026-10-05): the row leads
                        with the backup's local time and kind, as Support's and
                        the restore question name it; the file name (its time in
                        UTC, which read against the local one) follows, quiet. */}
                    <button
                      className={styles.backupRow}
                      aria-pressed={chosen}
                      data-selected={chosen ? "" : undefined}
                      data-testid={`setup-recovery-backup-${index}`}
                      onClick={() => setRestorePath(backup.path)}
                      type="button"
                    >
                      <span className={styles.backupWhen}>
                        {formatBackupTimestamp(backup.modifiedAt)} · {describeBackupKind(backup.kind)}
                      </span>
                      <span className={styles.backupMeta} data-cut-by-design="">
                        {formatFileSize(backup.sizeBytes)} · {backup.name}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className={styles.hint}>
              No backup list came before startup failed. Type a backup's path in the field above and restore it.
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

        {/* The visual overhaul's polish (2026-10-05): one list of the places,
            each path on its row with the key that opens its folder. The bay's
            keys and the plate's File paths named the same folders twice, and
            the exports folder by two names. */}
        <Section title="Where things are">
          <ul className={styles.places} data-testid="setup-recovery-paths">
            {pathEntries.length > 0 ? (
              pathEntries.map(([key, value]) => {
                const name = formatPathLabel(key);
                const path = String(value);
                const opens = FOLDER_KEYS[key];
                return (
                  <li key={key} className={styles.place}>
                    <span className={styles.placeName}>{name}</span>
                    <span className={styles.placePath}>{path}</span>
                    {opens ? folder(name, path, opens.actionId, opens.testId) : null}
                  </li>
                );
              })
            ) : (
              <li className={styles.place}>
                <span className={`${styles.hint} ${styles.placeNone}`}>
                  No file paths were attached to this startup failure.
                </span>
              </li>
            )}
          </ul>
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
