import { SupportPlate } from "../components/SupportPlate";
import { describeBackupKind, formatBackupTimestamp } from "../../shellData";
import { APP_VERSION } from "../setupPilotModel";
import type { SetupPilot } from "../useSetupPilot";

/** The plate's wiring: the workstation's facts, the light outputs switch, the
 *  recent actions, theme and scale, and the backup and diagnostics keys. */
export function SetupWorkstationPlate({ editor }: { editor: SetupPilot }) {
  const { commissioningSnapshot, lightOutputsArmed, onRequestRestart } = editor.props;
  const { backups, lastBackup, busyAction, runtime, recentActions, theme, uiScale, setTheme, setUiScale } =
    editor.state;
  const { engineLogPath, openEngineLog } = editor.chrome;
  const { performAction, exportSupportBackup, exportDiagnostics, restoreBackup, setLightOutputsArmed, verifyBackup } =
    editor.actions;
  return (
    <SupportPlate
      appVersion={APP_VERSION}
      archiveCount={backups.length}
      backupKind={lastBackup ? describeBackupKind(lastBackup.kind) : "none yet"}
      busy={busyAction !== null}
      canOpenEngineLog={engineLogPath.trim().length > 0}
      engineVersion={String(runtime?.engineVersion ?? "—")}
      hardwareProfile={String(commissioningSnapshot?.hardwareProfile ?? "Unavailable")}
      lastBackupLabel={lastBackup ? formatBackupTimestamp(lastBackup.modifiedAt) : "no backup exported yet"}
      lightOutputsArmed={lightOutputsArmed}
      protocolVersion={String(runtime?.protocol ?? runtime?.protocolVersion ?? "1")}
      recentActions={recentActions}
      restoreDisabled={!lastBackup}
      theme={theme}
      uiScale={uiScale}
      onExportBackup={() => void performAction("support-export-main", exportSupportBackup)}
      onExportDiagnostics={() => void performAction("export-shell-diagnostics", exportDiagnostics)}
      onOpenEngineLog={openEngineLog}
      onRestartBridge={onRequestRestart}
      onRestoreLatest={() => {
        if (!lastBackup) return;
        void performAction("restore-latest", () => restoreBackup(lastBackup.path));
      }}
      onSelectTheme={setTheme}
      onSelectUiScale={setUiScale}
      onSetLightOutputsArmed={(armed) => {
        if (armed === lightOutputsArmed) return;
        void performAction("light-outputs", () => setLightOutputsArmed(armed));
      }}
      onVerifyBackup={() => {
        if (!lastBackup) return;
        void performAction("verify-backup", () => verifyBackup(lastBackup.path));
      }}
    />
  );
}
