import { useEffect, useMemo, useState } from "react";

import { Button, StatusBadge, Surface } from "@sse/design-system";
import type { JsonValue, ShellStore, StartupFailure } from "@sse/engine-client";

import {
  asRecord,
  asStatusTone,
  formatBackupTimestamp,
  getSupportBackups,
  mapStatusBadgeTone,
  type SnapshotRecord,
} from "../shellData";
import { exportShellDiagnostics, openShellPath } from "../shellCommands";
import { useLiveCallback } from "../shared/useLiveCallback";
import styles from "../OperatorShell.module.css";
import {
  type ActionFeedback,
  feedbackBadgeTone,
  formatFileSize,
  formatPathLabel,
  getFailureTitle,
} from "../startup/startupHelpers";

// Local helper. Round-trips an `unknown` through JSON so it can be embedded
// in the diagnostics report without leaking class identity / non-serialisable
// state.
function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
}

export function SetupRecoverySurface({
  appSnapshot,
  failure,
  healthSnapshot,
  liveTransportRequested,
  onRequestRestart,
  onShowShortcuts,
  store,
  supportSnapshot,
}: {
  appSnapshot: SnapshotRecord | null;
  failure: StartupFailure | null;
  healthSnapshot: SnapshotRecord | null;
  liveTransportRequested: boolean;
  onRequestRestart: () => void;
  onShowShortcuts: () => void;
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
  const startup = asRecord(appSnapshot?.startup);
  const canReturnToConsole = String(startup?.targetSurface ?? "commissioning") === "dashboard";
  const backups = useMemo(() => getSupportBackups(supportSnapshot), [supportSnapshot]);
  const [restorePath, setRestorePath] = useState("");
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const lastBackup = backups[0] ?? null;
  const summary = failure?.message ?? String(healthSnapshot?.summary ?? "The shell needs operator recovery.");
  const detailEntries = Object.entries(asRecord(healthSnapshot?.details) ?? {});
  const pathEntries = Object.entries(runtimePaths);
  const engineRequestsAvailable = failure?.code !== "PROTOCOL_MISMATCH";
  const diagnosticsChecks = [
    { key: "controlSurface", label: "Control surface" },
    { key: "lighting", label: "DMX" },
    { key: "audio", label: "OSC" },
  ].map(({ key, label }) => {
    const check = asRecord(asRecord(healthSnapshot?.checks)?.[key]);
    return {
      detail: String(check?.summary ?? "No startup snapshot from this adapter was published."),
      label,
      tone: asStatusTone(check?.status, failure ? "attention" : "info"),
    };
  });

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
    const path = await exportShellDiagnostics(
      report,
      typeof runtimePaths.logsDir === "string" ? runtimePaths.logsDir : undefined
    );
    return {
      message: `Shell diagnostics exported to ${path}.`,
      tone: "ok" as const,
    };
  };

  const restoreBackup = async (path: string) => {
    const result = asRecord(await store.restoreSupportBackup(path));
    return {
      message: `Restore requested from ${String(result?.sourcePath ?? path)}.`,
      tone: "ok" as const,
    };
  };

  return (
    <div className={styles.setupRecoveryShell}>
      {feedback ? (
        <div aria-live="polite" className={styles.setupFeedbackBanner} data-tone={feedback.tone} role="status">
          <StatusBadge
            label={feedback.tone === "ok" ? "Updated" : feedback.tone === "error" ? "Attention" : "Info"}
            tone={feedbackBadgeTone(feedback.tone)}
          />
          <span>{feedback.message}</span>
        </div>
      ) : null}

      <div className={styles.setupUtilityRow}>
        <div className={styles.setupUtilityActions}>
          <Button
            disabled={!canReturnToConsole}
            onClick={() => {
              void store.setWorkspace("planning");
            }}
            variant="ghost"
          >
            Back to Console
          </Button>
        </div>
        <div className={styles.setupUtilityMeta}>
          <div className={styles.setupUtilityEyebrow}>Setup / Support</div>
          <div className={styles.setupUtilityTitle}>Incident recovery</div>
        </div>
        <div className={styles.setupUtilityActions}>
          <Button disabled size="compact" variant="secondary">
            Runner
          </Button>
          <Button size="compact" variant="primary">
            Support
          </Button>
          <Button onClick={onShowShortcuts} size="compact" variant="ghost">
            Shortcuts
          </Button>
        </div>
      </div>

      <div className={styles.setupIncidentGrid}>
        <Surface className={styles.setupIncidentHero} padding="lg" tone="raised">
          <div className={styles.setupIncidentPrompt}>What went wrong?</div>
          <div className={styles.setupIncidentHeader}>
            <div>
              <div className={styles.setupIncidentEyebrow}>Restore</div>
              <h1 className={styles.setupIncidentTitle}>{getFailureTitle(failure)}</h1>
              <p className={styles.setupIncidentBody}>{summary}</p>
            </div>
            <StatusBadge label={failure?.code ?? "startup-failed"} tone="error" />
          </div>

          {failure?.code === "PROTOCOL_MISMATCH" ? (
            <div className={styles.setupIncidentMetaGrid}>
              <div className={styles.setupIncidentMetaCard}>
                <div className={styles.setupIncidentMetaLabel}>Requested protocol</div>
                <div className={styles.setupIncidentMetaValue}>{failure.requestedProtocol ?? "unknown"}</div>
              </div>
              <div className={styles.setupIncidentMetaCard}>
                <div className={styles.setupIncidentMetaLabel}>Reported protocol</div>
                <div className={styles.setupIncidentMetaValue}>{failure.supportedProtocol ?? "unknown"}</div>
              </div>
            </div>
          ) : null}

          <div className={styles.setupIncidentRestoreGrid}>
            <div className={styles.setupIncidentHighlight}>
              <span className={styles.setupIncidentMetaLabel}>Latest backup</span>
              <strong>{lastBackup ? formatBackupTimestamp(lastBackup.modifiedAt) : "No backup exported yet"}</strong>
              <span className={styles.setupIncidentHint}>
                {String(
                  supportSnapshot?.restoreSummary ??
                    (engineRequestsAvailable
                      ? "Restore from a native support archive or a legacy db.json export."
                      : "Protocol recovery is read-only until the shell and engine agree on the contract.")
                )}
              </span>
            </div>
            <label className={styles.setupIncidentField}>
              <span className={styles.setupIncidentMetaLabel}>Restore from path</span>
              <input
                className={styles.setupIncidentInput}
                onChange={(event) => setRestorePath(event.target.value)}
                placeholder={String(runtimePaths.backupDir ?? "/path/to/backup.json")}
                value={restorePath}
              />
            </label>
          </div>

          <div className={styles.setupIncidentActions}>
            <Button onClick={onRequestRestart} variant="primary">
              Retry startup
            </Button>
            <Button
              disabled={busyAction !== null}
              onClick={() => {
                void performAction("export-diagnostics", exportDiagnostics);
              }}
              variant="secondary"
            >
              {busyAction === "export-diagnostics" ? "Working…" : "Export diagnostics"}
            </Button>
            <Button
              disabled={!engineRequestsAvailable || !lastBackup || busyAction !== null}
              onClick={() => {
                if (!lastBackup) {
                  return;
                }
                void performAction("restore-latest", () => restoreBackup(lastBackup.path));
              }}
              variant="secondary"
            >
              Restore latest
            </Button>
            <Button
              disabled={!engineRequestsAvailable || !restorePath.trim() || busyAction !== null}
              onClick={() => {
                void performAction("restore-path", () => restoreBackup(restorePath.trim()));
              }}
              variant="ghost"
            >
              Restore path
            </Button>
          </div>

          <div className={styles.setupIncidentBackupList}>
            {backups.length > 0 ? (
              backups.map((backup) => (
                <button
                  key={backup.path}
                  className={styles.setupIncidentBackupRow}
                  onClick={() => setRestorePath(backup.path)}
                  type="button"
                >
                  <span>
                    <strong>{backup.name}</strong>
                    <small>{backup.path}</small>
                  </span>
                  <span className={styles.setupIncidentHint}>
                    {formatBackupTimestamp(backup.modifiedAt)} · {formatFileSize(backup.sizeBytes)}
                  </span>
                </button>
              ))
            ) : (
              <div className={styles.setupIncidentEmptyState}>
                No backup list was published before startup failed. Use the archive path below or restore a known file
                directly.
              </div>
            )}
          </div>

          <div className={styles.setupIncidentReferencePanel}>
            <div className={styles.setupIncidentSectionLabel}>Reference paths</div>
            <div className={styles.setupIncidentRailButtons}>
              <button
                className={styles.setupIncidentRailButton}
                disabled={!String(runtimePaths.backupDir ?? "").trim()}
                onClick={() => {
                  void performAction("open-archive", () =>
                    openReferencePath("Archive", String(runtimePaths.backupDir ?? ""))
                  );
                }}
                type="button"
              >
                Archive
              </button>
              <button
                className={styles.setupIncidentRailButton}
                disabled={!String(runtimePaths.updateRepositoryPath ?? "").trim()}
                onClick={() => {
                  void performAction("open-update-repo", () =>
                    openReferencePath("Update repo", String(runtimePaths.updateRepositoryPath ?? ""))
                  );
                }}
                type="button"
              >
                Update repo
              </button>
              <button
                className={styles.setupIncidentRailButton}
                disabled={!String(runtimePaths.appDataDir ?? "").trim()}
                onClick={() => {
                  void performAction("open-app-data", () =>
                    openReferencePath("App data", String(runtimePaths.appDataDir ?? ""))
                  );
                }}
                type="button"
              >
                App data
              </button>
              <button
                className={styles.setupIncidentRailButton}
                disabled={!String(runtimePaths.logsDir ?? runtimePaths.appDataDir ?? "").trim()}
                onClick={() => {
                  void performAction("open-diagnostics", () =>
                    openReferencePath("Diagnostics", String(runtimePaths.logsDir ?? runtimePaths.appDataDir ?? ""))
                  );
                }}
                type="button"
              >
                Diagnostics
              </button>
              <button
                className={styles.setupIncidentRailButton}
                disabled={!String(runtimePaths.logsDir ?? "").trim()}
                onClick={() => {
                  void performAction("open-logs", () => openReferencePath("Logs", String(runtimePaths.logsDir ?? "")));
                }}
                type="button"
              >
                Logs
              </button>
            </div>
          </div>
        </Surface>

        <Surface className={styles.setupIncidentCard} padding="lg" tone="raised">
          <div className={styles.setupIncidentSectionLabel}>Diagnostics</div>
          <div className={styles.setupIncidentCheckGrid}>
            {diagnosticsChecks.map((check) => (
              <div key={check.label} className={styles.setupIncidentCheckCard}>
                <div className={styles.setupIncidentCheckHeader}>
                  <div className={styles.setupIncidentCheckTitle}>{check.label}</div>
                  <StatusBadge
                    label={check.tone === "ok" ? "ready" : check.tone}
                    tone={mapStatusBadgeTone(check.tone)}
                  />
                </div>
                <div className={styles.setupIncidentHint}>{check.detail}</div>
              </div>
            ))}
          </div>

          <div className={styles.setupIncidentSubsection}>
            <div className={styles.setupIncidentMetaLabel}>Recovery evidence</div>
            {detailEntries.length > 0 ? (
              <ul className={styles.setupIncidentDetailList}>
                {detailEntries.map(([key, value]) => (
                  <li key={key}>
                    <span className={styles.setupIncidentMetaLabel}>{formatPathLabel(key)}</span>
                    <span className={styles.setupIncidentHint}>{String(value)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className={styles.setupIncidentHint}>
                Startup failed before the engine could publish detailed incident evidence.
              </div>
            )}
          </div>

          <div className={styles.setupIncidentActions}>
            <Button
              disabled={busyAction !== null}
              onClick={() => {
                void performAction("export-diagnostics-card", exportDiagnostics);
              }}
              variant="secondary"
            >
              {busyAction === "export-diagnostics-card" ? "Working…" : "Export diagnostics"}
            </Button>
            <Button
              disabled={!String(runtimePaths.logFilePath ?? "").trim() || busyAction !== null}
              onClick={() => {
                void performAction("open-engine-log-card", () =>
                  openReferencePath("Engine log", String(runtimePaths.logFilePath ?? ""))
                );
              }}
              variant="ghost"
            >
              Engine log
            </Button>
          </div>

          <div className={styles.setupIncidentSubsection}>
            <div className={styles.setupIncidentMetaLabel}>Runtime paths</div>
            <ul className={styles.setupIncidentDetailList}>
              {pathEntries.length > 0 ? (
                pathEntries.map(([key, value]) => (
                  <li key={key}>
                    <span className={styles.setupIncidentMetaLabel}>{formatPathLabel(key)}</span>
                    <span className={styles.setupIncidentHint}>{value}</span>
                  </li>
                ))
              ) : (
                <li>
                  <span className={styles.setupIncidentHint}>
                    No runtime paths were attached to this startup failure.
                  </span>
                </li>
              )}
            </ul>
          </div>
        </Surface>

        <Surface className={styles.setupIncidentCard} padding="lg" tone="raised">
          <div className={styles.setupIncidentSectionLabel}>Install & Update</div>
          <div className={styles.setupIncidentInfoList}>
            <div>
              <strong>macOS</strong>
              <span>
                If the app is blocked, right-click the app, choose Open, then confirm once to clear Gatekeeper for
                future launches.
              </span>
            </div>
            <div>
              <strong>Windows</strong>
              <span>If SmartScreen intervenes, choose More info, then Run anyway.</span>
            </div>
            <div>
              <strong>Update posture</strong>
              <span>
                Keep the workstation on the packaged installer and maintenance-tool path rather than ad hoc local
                binaries while incident recovery is in progress.
              </span>
            </div>
          </div>
        </Surface>
      </div>
    </div>
  );
}
