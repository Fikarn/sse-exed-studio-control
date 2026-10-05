import {
  Danger,
  Key,
  LampWord,
  MenuButton,
  PlateHead,
  Readouts,
  Section,
  Segmented,
  Tooltip,
  type UseArmResult,
} from "@sse/design-system";

import { OPERATOR_UI_SCALES } from "../../operatorLayout";
import type { OperatorUiScale } from "../../operatorLayout";
import { buildSupportPlateMenu } from "../support/supportMenus";
import { RecentActions, type RecentAction } from "./RecentActions";
import styles from "./SupportPlate.module.css";

// Support, on the shell's plate (the visual overhaul, 2026-10-05): always here,
// whatever the bay shows. The workstation's own settings, the backup the
// operator would restore from, the two things that show what went wrong, what
// version everything is, what was done last, and the one coral command. Every
// section is on screen at once and nothing scrolls; the helper sentences are
// the section words' tooltips. The plate title's ⋯ holds every command of the
// plate but the switches.

export interface SupportPlateProps {
  /** The page's arm: the menu takes it, so two keys are never armed at once. */
  arm: UseArmResult;
  archiveCount: number;
  backupKind: string;
  busy?: boolean;
  engineVersion: string;
  hardwareProfile: string;
  lastBackupLabel: string;
  /** 2026-09 production readiness, Slice 11 (F31): whether the light outputs
   *  are armed, as the lighting state says; `null` until it has been read. */
  lightOutputsArmed: boolean | null;
  /** New pages program, Slice 6a: the Prompter XL as Windows reports it
   *  (`CONNECTED · 1920×1080 · 60 Hz`), with its tone; `null` before the
   *  hardware link has said. */
  prompterXl?: { value: string; tone: "ok" | "attention" | "error" } | null;
  protocolVersion: string;
  /** Slice 11 (F30): the action log's newest rows, newest first. */
  recentActions: readonly RecentAction[];
  uiScale: OperatorUiScale;
  appVersion: string;
  canOpenEngineLog: boolean;
  onExportBackup: () => void;
  onExportDiagnostics: () => void;
  onOpenEngineLog: () => void;
  onRestartBridge: () => void;
  onRestoreLatest: () => void;
  onSelectUiScale: (scale: OperatorUiScale) => void;
  /** New pages program, Slice 3 (D6, decision 2): the window keys. The native
   *  shell moves the window and keeps the choice for the next launch; outside
   *  the installed app they do nothing. */
  onEnterStudioFullscreen: () => void;
  onResetWindowLayout: () => void;
  onSetLightOutputsArmed: (armed: boolean) => void;
  /** 2026-09 production readiness, Slice 7 (F20): checks the latest backup
   *  without changing anything; the answer lands in the pilot's feedback. */
  onVerifyBackup: () => void;
  restoreDisabled: boolean;
}

/** A section's word with its helper sentence as the tooltip. */
function SectionWord({ word, tip }: { word: string; tip: string }) {
  return (
    <Tooltip content={tip} placement="left">
      <span>{word}</span>
    </Tooltip>
  );
}

export function SupportPlate({
  arm,
  archiveCount,
  backupKind,
  busy = false,
  engineVersion,
  hardwareProfile,
  lastBackupLabel,
  lightOutputsArmed,
  prompterXl = null,
  protocolVersion,
  recentActions,
  uiScale,
  appVersion,
  canOpenEngineLog,
  onExportBackup,
  onExportDiagnostics,
  onOpenEngineLog,
  onRestartBridge,
  onRestoreLatest,
  onSelectUiScale,
  onEnterStudioFullscreen,
  onResetWindowLayout,
  onSetLightOutputsArmed,
  onVerifyBackup,
  restoreDisabled,
}: SupportPlateProps) {
  const noBackupReason = restoreDisabled ? "no backup yet" : null;
  // Held is not a blackout: the rig keeps its last look, or does what the
  // bridge does when its source goes away. The words say what is sent, never
  // what the room looks like.
  const outputs =
    lightOutputsArmed === null
      ? { word: "NOT READ", tone: "off" as const, sentence: "The light outputs have not been read yet." }
      : lightOutputsArmed
        ? { word: "ARMED", tone: "ok" as const, sentence: "Armed: the rig follows the app." }
        : {
            word: "HELD",
            tone: "attention" as const,
            sentence: "Held: nothing is sent to the rig until the outputs are armed.",
          };

  return (
    <div className={styles.plate} data-testid="support-plate" aria-label="Support">
      <PlateHead
        title={
          <Tooltip
            content="Workstation settings, backups and diagnostics. Always here, whatever the bay shows."
            placement="left"
          >
            <span>Support</span>
          </Tooltip>
        }
        action={
          <MenuButton
            buttonLabel="Support menu"
            buttonTestId="support-plate-menu"
            menu={{
              ...buildSupportPlateMenu({
                busy,
                noBackupReason,
                canOpenLog: canOpenEngineLog,
                onExportBackup,
                onVerifyLatest: onVerifyBackup,
                onRestoreLatest,
                onExportDiagnostics,
                onOpenLog: onOpenEngineLog,
                onStudioFullscreen: onEnterStudioFullscreen,
                onResetWindowLayout,
              }),
              arm,
            }}
          />
        }
        testId="support-plate-head"
      />

      <Section
        title={<SectionWord word="Workstation" tip="These settings apply to every page." />}
        testId="support-workstation"
      >
        <div className={styles.row}>
          <span className={styles.label}>UI scale</span>
          <Segmented label="UI scale" className={styles.segmented} testId="support-scale-switch">
            {OPERATOR_UI_SCALES.map((scale) => (
              <Key
                key={scale}
                mode="segmented"
                selected={uiScale === scale}
                aria-pressed={uiScale === scale}
                aria-label={`UI scale ${scale} %`}
                testId={`support-scale-${scale}`}
                onClick={() => onSelectUiScale(scale)}
              >
                {String(scale)}
              </Key>
            ))}
          </Segmented>
        </div>
        {/* New pages program, Slice 3 (D6, decision 2): the window commands.
            They are commands, not a switch, so no key is lit; a refusal lands
            in the pilot's message line. The window is kept for the next
            launch. */}
        <div role="group" aria-label="Window" className={styles.windowKeys} data-testid="support-window-keys">
          <Key size="small" disabled={busy} testId="support-window-studio-fullscreen" onClick={onEnterStudioFullscreen}>
            Studio fullscreen
          </Key>
          <Tooltip
            content="Forgets where the window was and puts it fullscreen on the studio display. The window is kept for the next launch."
            placement="left"
          >
            <span className={styles.keyCell}>
              <Key size="small" disabled={busy} testId="support-window-reset" onClick={onResetWindowLayout}>
                Reset the window layout
              </Key>
            </span>
          </Tooltip>
        </div>
        <div className={styles.row} data-testid="support-outputs">
          <Tooltip content={outputs.sentence} placement="left">
            <span className={styles.label}>Light outputs</span>
          </Tooltip>
          <LampWord tone={outputs.tone} className={styles.outputsWord} testId="support-outputs-word">
            {outputs.word}
          </LampWord>
        </div>
        {/* One press: arming sends the current state at once (F31). */}
        <Segmented label="Light outputs" className={styles.segmented} testId="support-outputs-switch">
          <Key
            mode="segmented"
            disabled={busy || lightOutputsArmed === null}
            selected={lightOutputsArmed === true}
            aria-pressed={lightOutputsArmed === true}
            testId="support-outputs-armed"
            onClick={() => onSetLightOutputsArmed(true)}
          >
            Armed
          </Key>
          <Key
            mode="segmented"
            disabled={busy || lightOutputsArmed === null}
            selected={lightOutputsArmed === false}
            aria-pressed={lightOutputsArmed === false}
            testId="support-outputs-held"
            onClick={() => onSetLightOutputsArmed(false)}
          >
            Held
          </Key>
        </Segmented>
        {prompterXl ? (
          <Readouts
            data-testid="support-prompter-xl"
            rows={[
              {
                id: "prompter-xl",
                label: "Prompter XL",
                value: prompterXl.value,
                tone: prompterXl.tone === "ok" ? undefined : prompterXl.tone,
              },
            ]}
          />
        ) : null}
      </Section>

      <Section
        title={<SectionWord word="Backups" tip="Export one before any restore. A restore asks first." />}
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
            Restore latest…
          </Key>
          <Key size="small" disabled={busy || restoreDisabled} testId="support-verify-latest" onClick={onVerifyBackup}>
            Verify latest
          </Key>
        </div>
        {restoreDisabled ? (
          <p className={styles.reason} data-testid="support-backups-reason">
            Nothing to restore or verify yet: no backup has been exported.
          </p>
        ) : null}
      </Section>

      <Section title={<SectionWord word="Diagnostics" tip="What happened, in a file." />} testId="support-diagnostics">
        <div className={styles.keys}>
          <Key size="small" disabled={busy} testId="support-export-diagnostics" onClick={onExportDiagnostics}>
            Export diagnostics
          </Key>
          <Key size="small" disabled={busy || !canOpenEngineLog} testId="support-engine-log" onClick={onOpenEngineLog}>
            Open the log
          </Key>
        </div>
      </Section>

      <Section title={<SectionWord word="About" tip="This workstation." />} testId="support-about">
        <Readouts
          rows={[
            { id: "app", label: "Studio Control", value: appVersion },
            { id: "engine", label: "Hardware link", value: `${engineVersion} · protocol ${protocolVersion}` },
            { id: "hardware", label: "Hardware profile", value: hardwareProfile },
          ]}
        />
        {/* NDI's SDK asks for its trademark line and its address; the address is
            words, for this app opens no page outside it. */}
        <p className={styles.fine} data-testid="support-about-ndi">
          NDI® is a registered trademark of Vizrt NDI AB · ndi.video
        </p>
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
