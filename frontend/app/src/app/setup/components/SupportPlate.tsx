import { Danger, Key, PlateHead, Readouts, Section, Segmented } from "@sse/design-system";

import { OPERATOR_UI_SCALES } from "../../operatorLayout";
import type { OperatorTheme } from "../../OperatorLayoutProvider";
import type { OperatorUiScale } from "../../operatorLayout";
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
  protocolVersion: string;
  theme: OperatorTheme;
  uiScale: OperatorUiScale;
  appVersion: string;
  canOpenEngineLog: boolean;
  onExportBackup: () => void;
  onExportDiagnostics: () => void;
  onLoadSamplePlanning: () => void;
  onOpenEngineLog: () => void;
  onRestartBridge: () => void;
  onRestoreLatest: () => void;
  onSelectTheme: (theme: OperatorTheme) => void;
  onSelectUiScale: (scale: OperatorUiScale) => void;
  restoreDisabled: boolean;
}

export function SupportPlate({
  archiveCount,
  backupKind,
  busy = false,
  engineVersion,
  hardwareProfile,
  lastBackupLabel,
  protocolVersion,
  theme,
  uiScale,
  appVersion,
  canOpenEngineLog,
  onExportBackup,
  onExportDiagnostics,
  onLoadSamplePlanning,
  onOpenEngineLog,
  onRestartBridge,
  onRestoreLatest,
  onSelectTheme,
  onSelectUiScale,
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
      </Section>

      <Section
        title="Backups"
        detail={archiveCount === 1 ? "1 archive" : `${archiveCount} archives`}
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

      <Section title="Sample data" detail="asks first" testId="support-sample-data">
        <div className={styles.keys}>
          <Key size="small" disabled={busy} testId="support-load-sample-planning" onClick={onLoadSamplePlanning}>
            Load sample planning
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

      <Danger className={styles.danger}>
        <Key mode="danger" size="small" testId="support-restart-bridge" onClick={onRestartBridge}>
          Restart the hardware link…
        </Key>
      </Danger>
    </div>
  );
}
