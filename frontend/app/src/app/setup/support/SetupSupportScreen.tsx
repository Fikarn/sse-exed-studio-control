import { SetupStepScreen, SetupFactCard, SetupRecordHeading } from "../components/SetupStepScreen";
import { WindowKeys } from "../components/SupportPlate";
import { formatBackupTimestamp, describeBackupKind } from "../../shellData";
import styles from "../SetupSupportPilot.module.css";
import { Key, Section } from "@sse/design-system";
import { formatFileSize } from "../setupPilotModel";
import type { SetupPilot } from "../useSetupPilot";
import { windowKeyActions } from "./windowKeyActions";

/** Support mode's screen: backup and recovery - export, verify, restore, and
 *  the backups on disk; below the studio surface, Workstation's window keys
 *  under it. */
export function SetupSupportScreen({ editor }: { editor: SetupPilot }) {
  const { supportSnapshot } = editor.props;
  const { bayHead } = editor.chrome;
  const { backups, lastBackup, setRestorePath, runtimePaths, restorePath, busyAction } = editor.state;
  const { performAction, exportSupportBackup, verifyBackup, restoreBackup, openReferencePath } = editor.actions;
  return (
    <>
      <SetupStepScreen
        head={bayHead}
        eyebrow="Support"
        title="Backup and recovery"
        lead="What went wrong? Verify a backup, restore a backup archive or a database backup from the backups folder, then run the deck, bridge and desk probes again before resuming operator work."
        rules={[
          {
            id: "restore",
            text: String(
              supportSnapshot?.restoreSummary ??
                "Restore a backup archive or a database backup from the backups folder."
            ),
            tone: backups.length > 0 ? "ok" : "attention",
          },
          {
            id: "install",
            text: "Keep the workstation on the packaged installer and update-repository path rather than ad hoc local binaries. On macOS, right-click the app and choose Open to clear Gatekeeper once; on Windows, choose More info then Run anyway if SmartScreen intervenes.",
            tone: "off",
          },
        ]}
        facts={
          <>
            <SetupFactCard
              label="Latest backup"
              value={lastBackup ? formatBackupTimestamp(lastBackup.modifiedAt) : "No backup exported yet"}
              standing={backups.length > 0 ? `${backups.length} backups` : "empty backup history"}
              tone={backups.length > 0 ? "ok" : "attention"}
            />
            <label className={styles.field}>
              <span>Restore from path</span>
              <input
                className={styles.textField}
                onChange={(event) => setRestorePath(event.target.value)}
                placeholder={String(runtimePaths?.backupDir ?? "a file inside the backups folder")}
                value={restorePath}
              />
            </label>
          </>
        }
        actions={
          <>
            <Key
              mode="primary"
              take
              disabled={busyAction !== null}
              testId="support-export-first"
              onClick={() =>
                void performAction(
                  backups.length > 0 ? "support-export-main" : "support-export-first",
                  exportSupportBackup
                )
              }
            >
              {backups.length > 0 ? "Export a backup now" : "Export first backup"}
            </Key>
            <Key
              take
              disabled={!restorePath.trim() || busyAction !== null}
              testId="support-verify-path"
              onClick={() => void performAction("verify-backup", () => verifyBackup(restorePath.trim()))}
            >
              Verify path
            </Key>
            <Key
              take
              disabled={!restorePath.trim() || busyAction !== null}
              testId="support-restore-path"
              onClick={() => void performAction("restore-path", () => restoreBackup(restorePath.trim()))}
            >
              Restore path
            </Key>
          </>
        }
        note="Restoring replaces the workstation's saved data; a database backup restarts the hardware link. Export a backup first."
        record={
          <>
            <SetupRecordHeading>Backups</SetupRecordHeading>
            <div className={styles.backupList}>
              {backups.length > 0 ? (
                backups.map((backup) => (
                  <button
                    key={backup.path}
                    className={styles.backupRow}
                    onClick={() => setRestorePath(backup.path)}
                    type="button"
                  >
                    <span>
                      <strong>{backup.name}</strong>
                      <small>{backup.path}</small>
                    </span>
                    <span className={styles.metaCopy}>
                      {formatBackupTimestamp(backup.modifiedAt)} · {formatFileSize(backup.sizeBytes)} ·{" "}
                      {describeBackupKind(backup.kind)}
                    </span>
                  </button>
                ))
              ) : (
                <div className={styles.emptyState}>
                  No backups yet. Export first backup before any destructive support work.
                </div>
              )}
            </div>
            <SetupRecordHeading>Where things are</SetupRecordHeading>
            <div className={styles.supportRailButtons}>
              <button
                className={styles.railButton}
                onClick={() =>
                  void performAction("open-archive-path", () =>
                    openReferencePath("Archive", String(supportSnapshot?.backupDir ?? runtimePaths?.backupDir ?? ""))
                  )
                }
                type="button"
              >
                Archive
              </button>
              <button
                className={styles.railButton}
                disabled={!String(runtimePaths?.updateRepositoryPath ?? "").trim()}
                onClick={() =>
                  void performAction("open-update-repo", () =>
                    openReferencePath("Update folder", String(runtimePaths?.updateRepositoryPath ?? ""))
                  )
                }
                type="button"
              >
                Update folder
              </button>
              <button
                className={styles.railButton}
                disabled={!String(runtimePaths?.appDataDir ?? "").trim()}
                onClick={() =>
                  void performAction("open-app-data", () =>
                    openReferencePath("App data", String(runtimePaths?.appDataDir ?? ""))
                  )
                }
                type="button"
              >
                App data
              </button>
              <button
                className={styles.railButton}
                disabled={!String(runtimePaths?.exportsDir ?? runtimePaths?.appDataDir ?? "").trim()}
                onClick={() =>
                  void performAction("open-diagnostics-dir", () =>
                    openReferencePath("Diagnostics", String(runtimePaths?.exportsDir ?? runtimePaths?.appDataDir ?? ""))
                  )
                }
                type="button"
              >
                Diagnostics
              </button>
              <button
                className={styles.railButton}
                disabled={!String(runtimePaths?.logsDir ?? "").trim()}
                onClick={() =>
                  void performAction("open-logs", () => openReferencePath("Logs", String(runtimePaths?.logsDir ?? "")))
                }
                type="button"
              >
                Logs
              </button>
            </div>
          </>
        }
        testId="setup-screen-support"
      />
      {/* New pages program, Slice 3 (review finding 22): below the studio
          surface the Support plate is not drawn, and its window keys went with
          it, in the very window "Windowed" makes. The bay draws Workstation's
          window row here then, wired as the plate's is. At the studio surface
          this copy is not drawn and the plate's is the one on screen, so no
          studio board moves (SetupSupportPilot.module.css). */}
      <div className={styles.compactWorkstation} data-testid="support-bay-workstation">
        <Section title="Workstation" detail="applies to every workspace">
          <WindowKeys
            busy={busyAction !== null}
            testIdPrefix="support-bay-window"
            {...windowKeyActions(performAction)}
          />
        </Section>
      </div>
    </>
  );
}
