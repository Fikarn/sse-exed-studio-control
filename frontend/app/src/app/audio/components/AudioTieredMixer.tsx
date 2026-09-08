import type { MouseEvent as ReactMouseEvent } from "react";
import type { ShellStore } from "@sse/engine-client";

import styles from "./AudioTieredMixer.module.css";
import { type AudioControlDraftStore } from "../audioControlDraftStore";
import { audioLockNote } from "../audioFormatting";
import { type AudioChannelGroupSelectionRequest, type AudioWorkspaceViewModel } from "../audioViewModel";
import { AudioChannelLane, AudioOutputLane } from "./AudioMixerLane";
import type { AudioChannelEntry } from "../../shellData";

// Visual overhaul A, Slice 4b: three tiers side by side, each one a title, the
// line that says what it holds and where it sends, and — when the console is
// locked — the reason, right where the operator's hand is.

type AudioChannelUpdate = Parameters<ShellStore["updateAudioChannel"]>[0];
type AudioMixTargetUpdate = Parameters<ShellStore["updateAudioMixTarget"]>[0];

// What a playback strip prints under its format tag: where else it is going,
// so the operator sees the cue sends without selecting the strip.
function otherSendsFor(
  channel: AudioChannelEntry,
  viewModel: AudioWorkspaceViewModel
): { id: string; name: string; level: number }[] {
  return viewModel.hardwareOutputs.mixTargets
    .filter((mixTarget) => mixTarget.id !== viewModel.selectedMixTargetId)
    .slice(0, 2)
    .map((mixTarget) => ({
      id: mixTarget.id,
      name: mixTarget.shortName || mixTarget.name,
      level: channel.mixLevels[mixTarget.id] ?? 0,
    }));
}

export function AudioTieredMixer({
  armedActionKey,
  clearDraftValueLater,
  commitChannelContinuous,
  commitMixTargetContinuous,
  draftStore,
  getDraftValue,
  onClearClip,
  onOpenChannelMenu,
  onResetPeakHolds,
  onSelectChannel,
  onSelectChannelGroup,
  onSelectOutputMixTarget,
  onTogglePeakHold,
  onTogglePhantom,
  peakHoldEnabled,
  setDraftValue,
  onUpdateChannel,
  onUpdateMixTarget,
  viewModel,
}: {
  armedActionKey: string | null;
  clearDraftValueLater: (key: string, delayMs?: number) => void;
  commitChannelContinuous: (request: AudioChannelUpdate) => void;
  commitMixTargetContinuous: (request: AudioMixTargetUpdate) => void;
  draftStore: AudioControlDraftStore;
  getDraftValue: (key: string, fallback: number) => number;
  onClearClip: (channelId: string) => void;
  onOpenChannelMenu: (event: ReactMouseEvent<HTMLElement>, channelId: string) => void;
  onResetPeakHolds: () => void;
  onSelectChannel: (channelId: string | null) => void;
  onSelectChannelGroup: (request: AudioChannelGroupSelectionRequest) => void;
  onSelectOutputMixTarget: (mixTargetId: string) => void;
  onTogglePeakHold: () => void;
  onTogglePhantom: (request: { channelId: string; channelName: string; phantom: boolean }) => void;
  peakHoldEnabled: boolean;
  setDraftValue: (key: string, value: number) => void;
  onUpdateChannel: (request: AudioChannelUpdate) => void;
  onUpdateMixTarget: (request: AudioMixTargetUpdate) => void;
  viewModel: AudioWorkspaceViewModel;
}) {
  return (
    <div className={styles.tieredMixer} data-testid="audio-tiered-mixer">
      {viewModel.sourceTiers.map((tier) => (
        <section className={styles.mixerTier} data-testid={tier.testId} data-tier={tier.id} key={tier.id}>
          <div
            className={styles.tierLabel}
            data-testid={`audio-tier-label-${tier.id}`}
            onClick={() => onSelectChannel(null)}
          >
            <div className={styles.tierHeaderLead}>
              <span className={styles.tierTitle}>{tier.label}</span>
              <span className={styles.tierDetail} data-testid={`audio-tier-bank-pill-${tier.id}`}>
                {tier.channels.length > 0
                  ? viewModel.clampedBankIndex > 0
                    ? `Bank ${viewModel.clampedBankIndex + 1} / ${viewModel.totalBanks} · ch ${
                        viewModel.bankStart + 1
                      }-${Math.min(viewModel.bankStart + viewModel.visibleStripCount, viewModel.channels.length)} of ${
                        viewModel.channels.length
                      }`
                    : tier.meta
                  : "No sources in this bank"}
              </span>
              <span className={styles.tierDetail} data-testid={`audio-tier-mix-for-${tier.id}`}>
                <span data-mix-for-name="full">
                  sends into{" "}
                  {viewModel.selectedMixTarget?.name ?? viewModel.hardwareOutputs.mixTargets[0]?.name ?? "Main Out"}
                </span>
                <span data-mix-for-name="short">
                  →{" "}
                  {viewModel.selectedMixTarget?.shortName ??
                    viewModel.hardwareOutputs.mixTargets[0]?.shortName ??
                    "Main"}
                </span>
              </span>
              {/* The console is locked: the reason stands on the tier the hand
                  is reaching for, not only in the state display. */}
              {viewModel.actionsAllowed ? null : (
                <span
                  className={styles.tierLockNote}
                  data-tone={viewModel.status.tone === "error" ? "error" : "attention"}
                  data-testid={`audio-tier-lock-note-${tier.id}`}
                >
                  {audioLockNote(viewModel.status.label)}
                </span>
              )}
            </div>
            <div className={styles.tierChipRow}>
              {tier.chips.map((chip) => (
                <button
                  aria-pressed={chip.active === true}
                  className={styles.tierChip}
                  data-active={chip.active === true}
                  data-chip={chip.id}
                  data-testid={chip.testId}
                  key={chip.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectChannelGroup({
                      group: chip.id,
                      mode: event.altKey ? "invert" : event.shiftKey ? "toggle" : "single",
                      tierId: tier.id as AudioChannelGroupSelectionRequest["tierId"],
                    });
                  }}
                  type="button"
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>
          <div
            className={styles.tierLaneGrid}
            data-tier={tier.id}
            data-testid={`audio-tier-lanes-${tier.id}`}
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                onSelectChannel(null);
              }
            }}
          >
            {tier.channels.length > 0 ? (
              tier.channels.map((channel) => (
                <AudioChannelLane
                  actionsAllowed={viewModel.actionsAllowed}
                  armedActionKey={armedActionKey}
                  channel={channel}
                  clearDraftValueLater={clearDraftValueLater}
                  commitChannelContinuous={commitChannelContinuous}
                  draftStore={draftStore}
                  feeding={viewModel.feedingChannelIds.includes(channel.id)}
                  getDraftValue={getDraftValue}
                  key={channel.id}
                  lockedReason={viewModel.actionsAllowed ? undefined : (viewModel.status.warningBody ?? undefined)}
                  meterEmpty={viewModel.meterSimulationState === "gated"}
                  onClearClip={onClearClip}
                  onOpenContextMenu={onOpenChannelMenu}
                  onSelect={onSelectChannel}
                  onTogglePhantom={onTogglePhantom}
                  onUpdateChannel={onUpdateChannel}
                  otherSends={otherSendsFor(channel, viewModel)}
                  setDraftValue={setDraftValue}
                  selected={channel.id === viewModel.selectedChannelId}
                  selectedMixTargetId={viewModel.selectedMixTargetId}
                />
              ))
            ) : (
              <div className={styles.emptyTier}>No {tier.shortLabel.toLowerCase()} on this bank.</div>
            )}
          </div>
        </section>
      ))}

      <section
        className={`${styles.mixerTier} ${styles.outputTier}`}
        data-testid={viewModel.hardwareOutputs.testId}
        data-tier={viewModel.hardwareOutputs.id}
      >
        <div
          className={styles.tierLabel}
          data-testid={`audio-tier-label-${viewModel.hardwareOutputs.id}`}
          onClick={() => onSelectChannel(null)}
        >
          <div className={styles.tierHeaderLead}>
            <span className={styles.tierTitle}>{viewModel.hardwareOutputs.label}</span>
            <span className={styles.tierDetail} data-testid="audio-tier-mix-for">
              {viewModel.hardwareOutputs.mixTargets.length} mixes · level · one is the mix the faders send into
            </span>
            {viewModel.actionsAllowed ? null : (
              <span
                className={styles.tierLockNote}
                data-tone={viewModel.status.tone === "error" ? "error" : "attention"}
                data-testid="audio-tier-lock-note-hardware-outputs"
              >
                {audioLockNote(viewModel.status.label)}
              </span>
            )}
          </div>
          {/* C11: the retired ~38px context bar's Peak Hold + Reset controls
              relocate here as a slim eyebrow on the Outputs header (the most
              metered tier). The meter-simulation chip rides along so its
              testid + "TEST METER SIMULATION" label keep their spec coverage
              without the standalone context-bar row. */}
          <div className={styles.tierMeterEyebrow}>
            {viewModel.meterSimulationActive ? (
              <span
                className={styles.tierMeterSimChip}
                data-testid="audio-meter-simulation-chip"
                title={viewModel.meterSimulationDetail}
              >
                {viewModel.meterSimulationLabel}
              </span>
            ) : null}
            <div className={styles.tierPeakHoldSwitch} aria-label="Meter peak hold">
              <button
                aria-pressed={peakHoldEnabled}
                className={styles.tierPeakHoldOption}
                data-active={peakHoldEnabled}
                data-testid="audio-peak-hold-toggle"
                onClick={(event) => {
                  event.stopPropagation();
                  onTogglePeakHold();
                }}
                title={peakHoldEnabled ? "Disable held peak marks" : "Enable held peak marks"}
                type="button"
              >
                Hold
              </button>
              <button
                className={styles.tierPeakHoldOption}
                data-testid="audio-peak-hold-reset"
                onClick={(event) => {
                  event.stopPropagation();
                  onResetPeakHolds();
                }}
                title="Reset held peak marks"
                type="button"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
        <div className={styles.outputLaneGrid} data-testid="audio-tier-lanes-hardware-outputs">
          {viewModel.hardwareOutputs.mixTargets.map((mixTarget) => (
            <AudioOutputLane
              actionsAllowed={viewModel.actionsAllowed}
              clearDraftValueLater={clearDraftValueLater}
              commitMixTargetContinuous={commitMixTargetContinuous}
              draftStore={draftStore}
              getDraftValue={getDraftValue}
              key={mixTarget.id}
              lockedReason={viewModel.actionsAllowed ? undefined : (viewModel.status.warningBody ?? undefined)}
              meterEmpty={viewModel.meterSimulationState === "gated"}
              mixTarget={mixTarget}
              onSelect={onSelectOutputMixTarget}
              onUpdateMixTarget={onUpdateMixTarget}
              setDraftValue={setDraftValue}
              selected={mixTarget.id === viewModel.selectedMixTargetId}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
