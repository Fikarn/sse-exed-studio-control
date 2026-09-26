import { SupportPlate } from "../components/SupportPlate";
import { describeBackupKind, formatBackupTimestamp } from "../../shellData";
import { enterStudioFullscreen, resetWindowLayout, switchToWindowedLayout } from "../../shellCommands";
import { APP_VERSION } from "../setupPilotModel";
import type { SetupPilot } from "../useSetupPilot";

/** The plate's wiring: the workstation's facts, the light outputs switch, the
 *  recent actions, theme, scale and the window, and the backup and diagnostics
 *  keys. */
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
      protocolVersion={String(runtime?.protocol ?? runtime?.protocolVersion ?? "2")}
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
      // New pages program, Slice 3 (decision 2): a window key says nothing when
      // the window moves; a refusal carries the native shell's sentence to the
      // message line, as every other Setup / Support failure does.
      onEnterStudioFullscreen={() => void performAction("window-studio-fullscreen", enterStudioFullscreen)}
      onUseWindowedLayout={() => void performAction("window-windowed", switchToWindowedLayout)}
      onResetWindowLayout={() => void performAction("window-reset", resetWindowLayout)}
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
