import { useMemo, useRef, useState, type CSSProperties } from "react";
import type { ShellStore } from "@sse/engine-client";
import {
  Key,
  MenuButton,
  Meter,
  Readout,
  Section,
  Slider,
  Tooltip,
  type MenuEntry,
  type UseArmResult,
} from "@sse/design-system";

import styles from "./AudioOutputs.module.css";
import { AudioLevelEntryDialog } from "./AudioEntryDialogs";
import { AUDIO_THROTTLE_FADER_MS } from "../audioConstants";
import { type AudioControlDraftStore, useAudioControlDraftValue } from "../audioControlDraftStore";
import { createThrottledCommit } from "../audioContinuousControls";
import { AUDIO_FADER_UNITY, AUDIO_FADER_UNITY_SNAP, audioLockNote, formatAudioDb, meterFill } from "../audioFormatting";
import type { AudioWorkspaceViewModel } from "../audioViewModel";
import type { AudioMixTargetEntry } from "../../shellData";

// The visual overhaul's Console pull request (graft 1, the owner's choice): the
// outputs are one take-time block in the cluster, beside DIM and MONO. Each
// output is one row: the key that makes it the mix target (yellow while it is),
// its level, M, its menu, then its fader and its meter. The output level has
// this one home; the bay holds the sources only, and the plate no fader.

type AudioMixTargetUpdate = Parameters<ShellStore["updateAudioMixTarget"]>[0];

export interface AudioOutputsProps {
  arm: UseArmResult;
  clearDraftValueLater: (key: string, delayMs?: number) => void;
  commitMixTargetContinuous: (request: AudioMixTargetUpdate) => void;
  draftStore: AudioControlDraftStore;
  getDraftValue: (key: string, fallback: number) => number;
  onResetPeakHolds: () => void;
  onSelectMixTarget: (mixTargetId: string) => void;
  onShowOutput: (mixTargetId: string) => void;
  onUpdateMixTarget: (request: AudioMixTargetUpdate) => void;
  setDraftValue: (key: string, value: number) => void;
  viewModel: AudioWorkspaceViewModel;
}

export function AudioOutputs({
  arm,
  clearDraftValueLater,
  commitMixTargetContinuous,
  draftStore,
  getDraftValue,
  onResetPeakHolds,
  onSelectMixTarget,
  onShowOutput,
  onUpdateMixTarget,
  setDraftValue,
  viewModel,
}: AudioOutputsProps) {
  const actionsAllowed = viewModel.actionsAllowed;
  const lockedReason = actionsAllowed
    ? undefined
    : (viewModel.status.warningBody ?? `The desk is ${viewModel.status.label}.`);
  // Dim and mono are the control room's, Main Out's alone, whichever output
  // is the mix target: TotalMix has none for the phones, and the deck's DIM
  // dims Main Out too (the owner's decision, 2026-09-28).
  const mainOut = viewModel.mixTargets.find((mixTarget) => mixTarget.role === "main-out") ?? null;

  return (
    <Section
      title={
        <Tooltip
          content="The lit output is the mix target: the strips' faders set the sends into it. DIM and MONO are Main Out's."
          placement="right"
        >
          <span>Outputs</span>
        </Tooltip>
      }
      detail={
        actionsAllowed ? undefined : (
          // The console is locked: the reason stands where the hand reaches.
          <span
            className={styles.lockNote}
            data-tone={viewModel.status.tone === "error" ? "error" : "attention"}
            data-testid="audio-tier-lock-note-hardware-outputs"
          >
            {audioLockNote(viewModel.status.label)}
          </span>
        )
      }
      className={styles.outputs}
      data-tier={viewModel.hardwareOutputs.id}
      testId={viewModel.hardwareOutputs.testId}
    >
      <div className={styles.monitorRow}>
        <Key
          mode="toggle"
          cap="Dim"
          hint="−20 dB"
          engaged={mainOut?.dim ?? false}
          locked={!actionsAllowed}
          reason={lockedReason}
          size="tall"
          take
          testId="audio-monitor-dim"
          data-active={mainOut?.dim ?? false}
          data-control="dim"
          onClick={() => mainOut && onUpdateMixTarget({ mixTargetId: mainOut.id, dim: !mainOut.dim })}
        />
        <Key
          mode="toggle"
          cap="Mono"
          engaged={mainOut?.mono ?? false}
          locked={!actionsAllowed}
          reason={lockedReason}
          size="tall"
          take
          testId="audio-monitor-mono"
          data-active={mainOut?.mono ?? false}
          data-control="mono"
          onClick={() => mainOut && onUpdateMixTarget({ mixTargetId: mainOut.id, mono: !mainOut.mono })}
        />
      </div>

      <div
        className={styles.rows}
        data-tier={viewModel.hardwareOutputs.id}
        data-testid="audio-tier-lanes-hardware-outputs"
      >
        {viewModel.hardwareOutputs.mixTargets.map((mixTarget) => (
          <AudioOutputRow
            key={mixTarget.id}
            arm={arm}
            actionsAllowed={actionsAllowed}
            clearDraftValueLater={clearDraftValueLater}
            commitMixTargetContinuous={commitMixTargetContinuous}
            doubt={viewModel.valuesInDoubt}
            draftStore={draftStore}
            getDraftValue={getDraftValue}
            lockedReason={lockedReason}
            menuLock={actionsAllowed ? null : `desk ${viewModel.status.label}`}
            meterEmpty={viewModel.meterSimulationState === "gated"}
            meterStale={String(viewModel.audioSnapshot.meteringState ?? "").toLowerCase() === "stale"}
            mixTarget={mixTarget}
            onResetPeakHolds={onResetPeakHolds}
            onSelectMixTarget={onSelectMixTarget}
            onShowOutput={onShowOutput}
            onUpdateMixTarget={onUpdateMixTarget}
            setDraftValue={setDraftValue}
            targeted={mixTarget.id === viewModel.selectedMixTargetId}
          />
        ))}
      </div>
    </Section>
  );
}

function AudioOutputRow({
  arm,
  actionsAllowed,
  clearDraftValueLater,
  commitMixTargetContinuous,
  doubt,
  draftStore,
  getDraftValue,
  lockedReason,
  menuLock,
  meterEmpty,
  meterStale,
  mixTarget,
  onResetPeakHolds,
  onSelectMixTarget,
  onShowOutput,
  onUpdateMixTarget,
  setDraftValue,
  targeted,
}: {
  arm: UseArmResult;
  actionsAllowed: boolean;
  clearDraftValueLater: (key: string, delayMs?: number) => void;
  commitMixTargetContinuous: (request: AudioMixTargetUpdate) => void;
  /** The desk has not confirmed the level: the readout carries the dashed yellow keyline (DESIGN.md §4). */
  doubt: boolean;
  draftStore: AudioControlDraftStore;
  getDraftValue: (key: string, fallback: number) => number;
  lockedReason?: string;
  /** The menu's short reason for a locked item ("desk NOT VERIFIED"); null when unlocked. */
  menuLock: string | null;
  meterEmpty: boolean;
  meterStale: boolean;
  mixTarget: AudioMixTargetEntry;
  onResetPeakHolds: () => void;
  onSelectMixTarget: (mixTargetId: string) => void;
  onShowOutput: (mixTargetId: string) => void;
  onUpdateMixTarget: (request: AudioMixTargetUpdate) => void;
  setDraftValue: (key: string, value: number) => void;
  targeted: boolean;
}) {
  const rowRef = useRef<HTMLElement | null>(null);
  const [entryOpen, setEntryOpen] = useState(false);
  const isMainOut = mixTarget.role === "main-out";
  const volumeDraftKey = `mixTarget:${mixTarget.id}:volume`;
  const volume = useAudioControlDraftValue(draftStore, volumeDraftKey, getDraftValue(volumeDraftKey, mixTarget.volume));
  const throttledVolumeCommit = useMemo(
    () => createThrottledCommit<AudioMixTargetUpdate>(commitMixTargetContinuous, AUDIO_THROTTLE_FADER_MS),
    [commitMixTargetContinuous]
  );
  const commitVolume = (value: number) => {
    setDraftValue(volumeDraftKey, value);
    throttledVolumeCommit.schedule({ mixTargetId: mixTarget.id, volume: value });
    throttledVolumeCommit.flush();
    clearDraftValueLater(volumeDraftKey);
  };

  // The output's menu (DESIGN.md §9): what the row's keys do, and what they
  // do not show — the level by number, unity, the plate's meter.
  const items: MenuEntry[] = [
    {
      id: "target",
      label: "Make mix target",
      onSelect: () => onSelectMixTarget(mixTarget.id),
      disabledReason: targeted ? "it is the mix target" : menuLock,
      testId: `audio-output-menu-target-${mixTarget.id}`,
    },
    {
      id: "level",
      label: "Set level…",
      value: formatAudioDb(volume),
      onSelect: () => setEntryOpen(true),
      disabledReason: menuLock,
    },
    {
      id: "unity",
      label: "Set to 0 dB",
      onSelect: () => onUpdateMixTarget({ mixTargetId: mixTarget.id, volume: AUDIO_FADER_UNITY }),
      disabledReason: menuLock ?? (mixTarget.volume === AUDIO_FADER_UNITY ? "at 0 dB" : null),
    },
    {
      kind: "check",
      id: "mute",
      label: "Mute",
      checked: mixTarget.mute,
      onCheckedChange: (mute) => onUpdateMixTarget({ mixTargetId: mixTarget.id, mute }),
      disabledReason: menuLock,
    },
    ...(isMainOut
      ? ([
          {
            kind: "check",
            id: "dim",
            label: "Dim",
            checked: mixTarget.dim,
            onWord: "−20 dB",
            onCheckedChange: (dim: boolean) => onUpdateMixTarget({ mixTargetId: mixTarget.id, dim }),
            disabledReason: menuLock,
          },
          {
            kind: "check",
            id: "mono",
            label: "Mono",
            checked: mixTarget.mono,
            onCheckedChange: (mono: boolean) => onUpdateMixTarget({ mixTargetId: mixTarget.id, mono }),
            disabledReason: menuLock,
          },
        ] satisfies MenuEntry[])
      : []),
    { kind: "divider", id: "divider" },
    {
      id: "plate",
      label: "Show in the plate",
      onSelect: () => onShowOutput(mixTarget.id),
      testId: `audio-output-menu-plate-${mixTarget.id}`,
    },
    { id: "peaks", label: "Reset peaks", onSelect: onResetPeakHolds },
  ];

  return (
    <article
      ref={rowRef}
      className={styles.row}
      data-audio-output-id={mixTarget.id}
      data-role={mixTarget.role}
      data-selected={targeted}
      data-testid={`audio-output-${mixTarget.id}`}
    >
      <Key
        mode="toggle"
        layout="stack"
        engaged={targeted}
        hint={targeted ? "mix target" : undefined}
        locked={!actionsAllowed}
        reason={lockedReason}
        size="large"
        take
        className={styles.targetKey}
        testId={`audio-mix-target-${mixTarget.id}`}
        aria-label={`Make ${mixTarget.name} the mix target`}
        aria-pressed={targeted}
        onClick={() => onSelectMixTarget(mixTarget.id)}
      >
        <span className={styles.targetName} data-testid={`audio-lane-name-${mixTarget.id}`}>
          {mixTarget.name}
        </span>
      </Key>
      {/* The visual overhaul's polish (2026-10-05): a level the desk has not
          confirmed is drawn in doubt, as the strips' are. */}
      <Readout
        className={styles.level}
        size="readout"
        align="right"
        value={formatAudioDb(volume).replace(/ dB$/, "")}
        unit="dB"
        doubt={doubt}
        testId={`audio-lane-readout-${mixTarget.id}`}
      />
      <Key
        mode="toggle"
        cap="M"
        engaged={mixTarget.mute}
        locked={!actionsAllowed}
        reason={lockedReason}
        size="large"
        take
        className={styles.muteKey}
        data-control="mute"
        data-active={mixTarget.mute}
        aria-label={`Mute ${mixTarget.name}`}
        aria-pressed={mixTarget.mute}
        onClick={() => onUpdateMixTarget({ mixTargetId: mixTarget.id, mute: !mixTarget.mute })}
      />
      <span className={styles.menu}>
        <MenuButton
          buttonLabel={`${mixTarget.name} menu`}
          buttonTestId={`audio-lane-menu-${mixTarget.id}`}
          contextTarget={rowRef}
          size="sm"
          menu={{ head: { title: mixTarget.name, detail: targeted ? "the mix target" : undefined }, items, arm }}
        />
      </span>
      <Slider
        className={styles.fader}
        label={`${mixTarget.name} output level`}
        value={volume}
        unity={AUDIO_FADER_UNITY}
        snapUnity
        unitySnap={AUDIO_FADER_UNITY_SNAP}
        locked={!actionsAllowed}
        take
        valueText={formatAudioDb(volume)}
        onRequestTypedEntry={actionsAllowed ? () => setEntryOpen(true) : undefined}
        onChange={(value) => {
          setDraftValue(volumeDraftKey, value);
          throttledVolumeCommit.schedule({ mixTargetId: mixTarget.id, volume: value });
        }}
        onCommit={commitVolume}
      />
      <Meter
        className={styles.meter}
        label={`${mixTarget.name} meter`}
        level={meterFill(mixTarget.meterLeft)}
        levelRight={meterFill(isMainOut && mixTarget.mono ? mixTarget.meterLeft : mixTarget.meterRight)}
        peak={meterFill(mixTarget.peakHoldLeft)}
        peakRight={meterFill(mixTarget.peakHoldRight)}
        orientation="horizontal"
        empty={meterEmpty}
        stale={meterStale}
        meterId={mixTarget.id}
        meterKind="mixTarget"
        testId={`audio-lane-meter-${mixTarget.id}`}
        style={{ "--master-meter-height": "16px" } as CSSProperties}
      />
      {entryOpen ? (
        <AudioLevelEntryDialog
          title={`Set ${mixTarget.name} output level`}
          value={volume}
          onCancel={() => setEntryOpen(false)}
          onConfirm={(next) => {
            setEntryOpen(false);
            commitVolume(next);
          }}
        />
      ) : null}
    </article>
  );
}
