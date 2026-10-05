import { useEffect, useRef, useState } from "react";

import { Key, MenuButton, type UseArmResult } from "@sse/design-system";

import { SetupField, SetupFactCard, SetupRecordHeading, SetupStepScreen } from "../components/SetupStepScreen";
import { formatBackupTimestamp, describeBackupKind, type SupportBackupEntry } from "../../shellData";
import { formatFileSize } from "../setupPilotModel";
import type { SetupPilot } from "../useSetupPilot";
import { buildBackupMenu } from "./supportMenus";
import styles from "./SetupSupportScreen.module.css";

/** The backups a page of the list shows: the bay never scrolls, so the list pages. */
export const BACKUPS_A_PAGE = 8;

function BackupRow({
  backup,
  index,
  chosen,
  busy,
  arm,
  onChoose,
  onVerify,
  onRestore,
}: {
  backup: SupportBackupEntry;
  index: number;
  chosen: boolean;
  busy: boolean;
  arm: UseArmResult;
  onChoose: () => void;
  onVerify: () => void;
  onRestore: () => void;
}) {
  const rowRef = useRef<HTMLLIElement | null>(null);
  return (
    <li ref={rowRef} className={styles.backupRow} data-selected={chosen ? "" : undefined}>
      {/* A press puts the backup's path in the field; nothing is restored. */}
      <button
        type="button"
        className={styles.backupPick}
        aria-pressed={chosen}
        data-testid={`support-backup-${index}`}
        onClick={onChoose}
      >
        <span className={styles.backupName}>{backup.name}</span>
        <span className={styles.backupMeta}>
          {formatBackupTimestamp(backup.modifiedAt)} · {formatFileSize(backup.sizeBytes)} ·{" "}
          {describeBackupKind(backup.kind)}
        </span>
      </button>
      <MenuButton
        buttonLabel={`${backup.name} menu`}
        buttonTestId={`support-backup-menu-${index}`}
        className={styles.rowMenu}
        contextTarget={rowRef}
        menu={{
          ...buildBackupMenu({
            backup,
            chosen,
            busy,
            onChoose,
            onVerify,
            onRestore,
            testIdPrefix: `support-backup-menu-${index}`,
          }),
          arm,
        }}
      />
    </li>
  );
}

/** Support mode's screen: backup and recovery: export, verify, restore, and the backups on disk. */
export function SetupSupportScreen({ editor }: { editor: SetupPilot }) {
  const { supportSnapshot } = editor.props;
  const { bayHead } = editor.chrome;
  const { backups, lastBackup, setRestorePath, runtimePaths, restorePath, busyAction, setRestorePrompt, arm } =
    editor.state;
  const { performAction, exportSupportBackup, verifyBackup, openReferencePath } = editor.actions;
  const busy = busyAction !== null;
  const pages = Math.max(1, Math.ceil(backups.length / BACKUPS_A_PAGE));
  const [page, setPage] = useState(0);
  useEffect(() => {
    if (page > pages - 1) setPage(pages - 1);
  }, [page, pages]);
  const shown = backups.slice(page * BACKUPS_A_PAGE, page * BACKUPS_A_PAGE + BACKUPS_A_PAGE);
  const chosenPath = restorePath.trim();
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
    <SetupStepScreen
      head={bayHead}
      eyebrow="Support"
      title="Backup and recovery"
      lead={String(
        supportSnapshot?.restoreSummary ??
          "Verify a backup, or restore a backup archive or a database backup from the backups folder; then run the probes again before going back to work."
      )}
      facts={
        <>
          <SetupFactCard
            label="Latest backup"
            value={lastBackup ? formatBackupTimestamp(lastBackup.modifiedAt) : "None yet"}
            standing={backups.length === 1 ? "1 backup" : `${backups.length} backups`}
            tone={backups.length > 0 ? "ok" : "attention"}
          />
          <SetupField
            label="Restore from path"
            wide
            placeholder={String(runtimePaths?.backupDir ?? "a file inside the backups folder")}
            value={restorePath}
            testId="support-restore-path-field"
            onChange={(event) => setRestorePath(event.target.value)}
          />
        </>
      }
      actions={
        <>
          <Key
            mode="primary"
            size="large"
            disabled={busy}
            testId="support-export-first"
            onClick={() =>
              void performAction(
                backups.length > 0 ? "support-export-main" : "support-export-first",
                exportSupportBackup
              )
            }
          >
            {backups.length > 0 ? "Export a backup now" : "Export the first backup"}
          </Key>
          <Key
            size="large"
            disabled={!chosenPath || busy}
            testId="support-verify-path"
            onClick={() => void performAction("verify-backup", () => verifyBackup(chosenPath))}
          >
            Verify path
          </Key>
          <Key
            size="large"
            disabled={!chosenPath || busy}
            testId="support-restore-path"
            onClick={() => setRestorePrompt({ actionId: "restore-path", path: chosenPath })}
          >
            Restore path…
          </Key>
        </>
      }
      // What a restore changes stays on screen.
      note="A restore asks first: it replaces the saved data, and a database backup restarts the hardware link. Export a backup before you restore."
      record={
        <>
          <SetupRecordHeading>Backups</SetupRecordHeading>
          {backups.length > 0 ? (
            <ol className={styles.backupList} data-testid="support-backup-list">
              {shown.map((backup, offset) => {
                const index = page * BACKUPS_A_PAGE + offset;
                return (
                  <BackupRow
                    key={backup.path}
                    backup={backup}
                    index={index}
                    chosen={backup.path === chosenPath}
                    busy={busy}
                    arm={arm}
                    onChoose={() => setRestorePath(backup.path)}
                    onVerify={() => void performAction("verify-backup", () => verifyBackup(backup.path))}
                    onRestore={() => setRestorePrompt({ actionId: "restore-path", path: backup.path })}
                  />
                );
              })}
            </ol>
          ) : (
            <p className={styles.empty}>No backups yet. Export the first one before any restore.</p>
          )}
          {pages > 1 ? (
            <div className={styles.pager} data-testid="support-backup-pager">
              <Key
                size="small"
                aria-label="Newer backups"
                disabled={page === 0}
                testId="support-backup-newer"
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
                testId="support-backup-older"
                onClick={() => setPage((current) => Math.min(pages - 1, current + 1))}
              >
                ›
              </Key>
            </div>
          ) : null}
          <SetupRecordHeading>Where things are</SetupRecordHeading>
          <div className={styles.folders}>
            {folder(
              "Backups",
              String(supportSnapshot?.backupDir ?? runtimePaths?.backupDir ?? ""),
              "open-archive-path",
              "support-open-backups"
            )}
            {folder("App data", String(runtimePaths?.appDataDir ?? ""), "open-app-data", "support-open-app-data")}
            {folder(
              "Diagnostics",
              String(runtimePaths?.exportsDir ?? runtimePaths?.appDataDir ?? ""),
              "open-diagnostics-dir",
              "support-open-diagnostics"
            )}
            {folder("Logs", String(runtimePaths?.logsDir ?? ""), "open-logs", "support-open-logs")}
          </div>
        </>
      }
      testId="setup-screen-support"
    />
  );
}
