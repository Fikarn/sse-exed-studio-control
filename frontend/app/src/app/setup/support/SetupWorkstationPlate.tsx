import { SupportPlate } from "../components/SupportPlate";
import { describeBackupKind, formatBackupTimestamp } from "../../shellData";
import { enterStudioFullscreen, resetWindowLayout } from "../../shellCommands";
import { APP_VERSION } from "../setupPilotModel";
import type { SetupPilot } from "../useSetupPilot";

/** The Prompter XL as `health.snapshot`'s `checks.prompter` carries it (new pages
 *  program, Slice 6a): its word, its mode, its tone; `null` before it is known. */
export function prompterXlRow(
  healthSnapshot: Record<string, unknown> | null
): { value: string; tone: "ok" | "attention" | "error" } | null {
  const checks = healthSnapshot?.checks;
  const check = checks && typeof checks === "object" ? (checks as Record<string, unknown>).prompter : undefined;
  const screen = check && typeof check === "object" ? (check as Record<string, unknown>).screen : undefined;
  if (!screen || typeof screen !== "object") return null;
  const { word, tone, width, height, refreshHz } = screen as Record<string, unknown>;
  if (typeof word !== "string") return null;
  const parts = [word.toLowerCase()];
  if (typeof width === "number" && typeof height === "number") parts.push(`${width}×${height}`);
  if (typeof refreshHz === "number") parts.push(`${refreshHz} Hz`);
  return { value: parts.join(" · "), tone: tone === "error" ? "error" : tone === "attention" ? "attention" : "ok" };
}

/** The plate's wiring: the workstation's facts, the light outputs switch, the
 *  recent actions, scale and the window, and the backup and diagnostics
 *  keys. */
export function SetupWorkstationPlate({ editor }: { editor: SetupPilot }) {
  const { commissioningSnapshot, healthSnapshot, lightOutputsArmed, onRequestRestart } = editor.props;
  const { backups, lastBackup, busyAction, runtime, recentActions, uiScale, setUiScale, setRestorePrompt } =
    editor.state;
  const { engineLogPath, openEngineLog } = editor.chrome;
  const { performAction, exportSupportBackup, exportDiagnostics, setLightOutputsArmed, verifyBackup } = editor.actions;
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
      prompterXl={prompterXlRow(healthSnapshot)}
      protocolVersion={String(runtime?.protocol ?? runtime?.protocolVersion ?? "2")}
      recentActions={recentActions}
      restoreDisabled={!lastBackup}
      uiScale={uiScale}
      onExportBackup={() => void performAction("support-export-main", exportSupportBackup)}
      onExportDiagnostics={() => void performAction("export-shell-diagnostics", exportDiagnostics)}
      onOpenEngineLog={openEngineLog}
      onRestartBridge={onRequestRestart}
      // A restore asks first, and says what it replaces (SetupPilotDialogs).
      onRestoreLatest={() => {
        if (!lastBackup) return;
        setRestorePrompt({ actionId: "restore-latest", path: lastBackup.path });
      }}
      onSelectUiScale={setUiScale}
      // New pages program, Slice 3 (decision 2): a window key says nothing when
      // the window moves; a refusal carries the native shell's sentence to the
      // message line, as every other Setup / Support failure does.
      onEnterStudioFullscreen={() => void performAction("window-studio-fullscreen", enterStudioFullscreen)}
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
