import { Danger, Key, PlateHead, Readouts, Section, Segmented } from "@sse/design-system";

import { OPERATOR_UI_SCALES } from "../../operatorLayout";
import type { OperatorTheme } from "../../OperatorLayoutProvider";
import type { OperatorUiScale } from "../../operatorLayout";
import { RecentActions, type RecentAction } from "./RecentActions";
import styles from "./SupportPlate.module.css";

// Visual overhaul A, Slice 7 (A-setup.html's plate): Support is always here,
// whatever step the runner is on — the workstation's own settings, the backup
// the operator would restore from, the two things a support ticket needs, the
// sample data that asks first, what version everything is, and the one red
// command on the surface.

// Dim control room first, then the two the room can be lit for.
const THEME_ORDER: readonly OperatorTheme[] = ["studio", "graphite", "bone"];

const THEME_LABELS: Record<OperatorTheme, string> = {
  bone: "Bone",
  graphite: "Graphite",
  studio: "Studio",
};

const THEME_HINTS: Record<OperatorTheme, string> = {
  bone: "daylight",
  graphite: "neutral",
  studio: "dim control room",
};

export interface SupportPlateProps {
  archiveCount: number;
  backupKind: string;
  busy?: boolean;
  engineVersion: string;
  hardwareProfile: string;
  lastBackupLabel: string;
  /** 2026-09 production readiness, Slice 11 (F31): whether the light outputs
   *  are armed, as the lighting state says; `null` until it has been read. */
  lightOutputsArmed: boolean | null;
  protocolVersion: string;
  /** Slice 11 (F30): the action log's newest rows, newest first. */
  recentActions: readonly RecentAction[];
  theme: OperatorTheme;
  uiScale: OperatorUiScale;
  appVersion: string;
  canOpenEngineLog: boolean;
  onExportBackup: () => void;
  onExportDiagnostics: () => void;
  onOpenEngineLog: () => void;
  onRestartBridge: () => void;
  onRestoreLatest: () => void;
  onSelectTheme: (theme: OperatorTheme) => void;
  onSelectUiScale: (scale: OperatorUiScale) => void;
  /** New pages program, Slice 3 (D6, decision 2): the window keys. The native
   *  shell moves the window and keeps the choice for the next launch; outside
   *  the installed app they do nothing. */
  onEnterStudioFullscreen: () => void;
  onUseWindowedLayout: () => void;
  onResetWindowLayout: () => void;
  onSetLightOutputsArmed: (armed: boolean) => void;
  /** 2026-09 production readiness, Slice 7 (F20): checks the latest backup
   *  without changing anything; the answer lands in the pilot's feedback. */
  onVerifyBackup: () => void;
  restoreDisabled: boolean;
}

export function SupportPlate({
  archiveCount,
  backupKind,
  busy = false,
  engineVersion,
  hardwareProfile,
  lastBackupLabel,
  lightOutputsArmed,
  protocolVersion,
  recentActions,
  theme,
  uiScale,
  appVersion,
  canOpenEngineLog,
  onExportBackup,
  onExportDiagnostics,
  onOpenEngineLog,
  onRestartBridge,
  onRestoreLatest,
  onSelectTheme,
  onSelectUiScale,
  onEnterStudioFullscreen,
  onUseWindowedLayout,
  onResetWindowLayout,
  onSetLightOutputsArmed,
  onVerifyBackup,
  restoreDisabled,
}: SupportPlateProps) {
  return (
    <div className={styles.plate} data-testid="support-plate" aria-label="Support">
      <PlateHead
        title="Support"
        sub="Workstation settings, backups and diagnostics · always here, whatever step the runner is on"
        testId="support-plate-head"
      />

      <Section title="Workstation" detail="applies to every workspace" testId="support-workstation">
        <Readouts rows={[{ id: "theme", label: "Theme", value: THEME_HINTS[theme] }]} />
        <Segmented label="Theme" className={styles.segmented} testId="support-theme-switch">
          {THEME_ORDER.map((entry) => (
            <Key
              key={entry}
              mode="segmented"
              cap={THEME_LABELS[entry]}
              take
              engaged={theme === entry}
              aria-pressed={theme === entry}
              testId={`support-theme-${entry}`}
              onClick={() => onSelectTheme(entry)}
            />
          ))}
        </Segmented>
        <Readouts rows={[{ id: "scale", label: "UI scale", value: `${uiScale} %` }]} />
        <Segmented label="UI scale" className={styles.segmented} testId="support-scale-switch">
          {OPERATOR_UI_SCALES.map((scale) => (
            <Key
              key={scale}
              mode="segmented"
              cap={String(scale)}
              take
              engaged={uiScale === scale}
              aria-pressed={uiScale === scale}
              aria-label={`UI scale ${scale} %`}
              testId={`support-scale-${scale}`}
              onClick={() => onSelectUiScale(scale)}
            />
          ))}
        </Segmented>
        {/* New pages program, Slice 3 (D6, decision 2): the three window
            commands the command palette held. They are commands, not a switch:
            nothing reports which layout the window is in, so no key is lit. A
            refusal lands in the pilot's message line. */}
        <Readouts rows={[{ id: "window", label: "Window", value: "kept for the next launch" }]} />
        <div role="group" aria-label="Window" className={styles.windowKeys} data-testid="support-window-keys">
          <Key size="small" disabled={busy} testId="support-window-studio-fullscreen" onClick={onEnterStudioFullscreen}>
            Studio fullscreen
          </Key>
          <Key size="small" disabled={busy} testId="support-window-windowed" onClick={onUseWindowedLayout}>
            Windowed
          </Key>
          <Key size="small" disabled={busy} testId="support-window-reset" onClick={onResetWindowLayout}>
            Reset the window layout
          </Key>
        </div>
        {/* Held is not a blackout: the rig keeps its last look, or does what
            the bridge does when its source goes away. The words say what is
            sent, never what the room looks like. */}
        <Readouts
          rows={[
            {
              id: "light-outputs",
              label: "Light outputs",
              tone: lightOutputsArmed === false ? "attention" : undefined,
              value:
                lightOutputsArmed === null
                  ? "not read yet"
                  : lightOutputsArmed
                    ? "the rig follows the app"
                    : "nothing is sent to the rig",
            },
          ]}
        />
        <Segmented label="Light outputs" className={styles.segmented} testId="support-outputs-switch">
          <Key
            mode="segmented"
            cap="Armed"
            take
            disabled={busy || lightOutputsArmed === null}
            engaged={lightOutputsArmed === true}
            aria-pressed={lightOutputsArmed === true}
            testId="support-outputs-armed"
            onClick={() => onSetLightOutputsArmed(true)}
          />
          <Key
            mode="segmented"
            cap="Held"
            take
            disabled={busy || lightOutputsArmed === null}
            engaged={lightOutputsArmed === false}
            aria-pressed={lightOutputsArmed === false}
            testId="support-outputs-held"
            onClick={() => onSetLightOutputsArmed(false)}
          />
        </Segmented>
      </Section>

      <Section
        title="Backups"
        detail={archiveCount === 1 ? "1 backup" : `${archiveCount} backups`}
        testId="support-backups"
      >
        <Readouts
          rows={[
            { id: "latest", label: "Latest", value: lastBackupLabel },
            { id: "kind", label: "Kind", value: backupKind },
          ]}
        />
        <div className={styles.keys}>
          <Key size="small" disabled={busy} testId="support-export-backup" onClick={onExportBackup}>
            Export backup
          </Key>
          <Key
            size="small"
            disabled={busy || restoreDisabled}
            testId="support-restore-latest"
            onClick={onRestoreLatest}
          >
            Restore latest
          </Key>
          <Key size="small" disabled={busy || restoreDisabled} testId="support-verify-latest" onClick={onVerifyBackup}>
            Verify latest
          </Key>
        </div>
      </Section>

      <Section title="Diagnostics" detail="for a support ticket" testId="support-diagnostics">
        <div className={styles.keys}>
          <Key size="small" disabled={busy} testId="support-export-diagnostics" onClick={onExportDiagnostics}>
            Export diagnostics
          </Key>
          <Key size="small" disabled={busy || !canOpenEngineLog} testId="support-engine-log" onClick={onOpenEngineLog}>
            Engine log
          </Key>
        </div>
      </Section>

      <Section title="About" detail="this workstation" testId="support-about">
        <Readouts
          rows={[
            { id: "app", label: "Studio Control", value: appVersion },
            { id: "engine", label: "Hardware link", value: `${engineVersion} · protocol ${protocolVersion}` },
            { id: "hardware", label: "Hardware profile", value: hardwareProfile },
          ]}
        />
      </Section>

      <RecentActions actions={recentActions} />

      <Danger className={styles.danger}>
        <Key mode="danger" size="small" testId="support-restart-bridge" onClick={onRestartBridge}>
          Restart the hardware link…
        </Key>
      </Danger>
    </div>
  );
}
