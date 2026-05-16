import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import type { ShellStore } from "@sse/engine-client";
import { ArrowRight, Mic, Play } from "lucide-react";

import styles from "../AudioWorkspace.module.css";
import {
  selectedChannelSendLevel,
  type AudioChannelGroupSelectionRequest,
  type AudioWorkspaceViewModel,
} from "../audioViewModel";
import { AudioChannelLane, AudioOutputLane } from "./AudioMixerLane";

type AudioChannelUpdate = Parameters<ShellStore["updateAudioChannel"]>[0];
type AudioMixTargetUpdate = Parameters<ShellStore["updateAudioMixTarget"]>[0];

const TIER_ICONS = {
  "hardware-inputs": Mic,
  "software-playback": Play,
  "hardware-outputs": ArrowRight,
};

const TIER_NUMBERS = {
  "hardware-inputs": "01",
  "software-playback": "02",
  "hardware-outputs": "03",
};

function TierIcon({ tierId }: { tierId: string }) {
  const Icon = TIER_ICONS[tierId as keyof typeof TIER_ICONS];
  return Icon ? (
    <span className={styles.tierIcon}>
      <Icon size={18} strokeWidth={1.6} aria-hidden="true" />
    </span>
  ) : null;
}

function AudioRoutingOverlay({ viewModel }: { viewModel: AudioWorkspaceViewModel }) {
  const channel = viewModel.selectedChannel;
  const mixTarget = viewModel.selectedMixTarget;
  if (!channel || !mixTarget || !viewModel.feedingChannelIds.includes(channel.id)) {
    return null;
  }

  const sendLevel = selectedChannelSendLevel(channel, viewModel.selectedMixTargetId);
  const sourceY = channel.role === "playback-pair" ? 55 : 22;
  const outputY = 86;
  const strength = Math.max(0.18, Math.min(1, sendLevel));

  return (
    <svg
      className={styles.routingOverlay}
      data-source-channel-id={channel.id}
      data-target-mix-id={mixTarget.id}
      data-testid="audio-routing-overlay"
      style={{ "--routing-strength": strength.toFixed(3) } as CSSProperties}
      viewBox="0 0 100 100"
      aria-hidden="true"
    >
      <path d={`M 12 ${sourceY} C 42 ${sourceY}, 58 ${outputY}, 88 ${outputY}`} />
      <circle cx="88" cy={outputY} r="1.6" />
    </svg>
  );
}

export function AudioTieredMixer({
  clearDraftValue,
  commitChannelContinuous,
  commitMixTargetContinuous,
  getDraftValue,
  onClearClip,
  onOpenChannelMenu,
  onSelectChannel,
  onSelectChannelGroup,
  onSelectMixTarget,
  setDraftValue,
  onUpdateChannel,
  onUpdateMixTarget,
  viewModel,
}: {
  clearDraftValue: (key: string) => void;
  commitChannelContinuous: (request: AudioChannelUpdate) => void;
  commitMixTargetContinuous: (request: AudioMixTargetUpdate) => void;
  getDraftValue: (key: string, fallback: number) => number;
  onClearClip: (channelId: string) => void;
  onOpenChannelMenu: (event: ReactMouseEvent<HTMLElement>, channelId: string) => void;
  onSelectChannel: (channelId: string | null) => void;
  onSelectChannelGroup: (request: AudioChannelGroupSelectionRequest) => void;
  onSelectMixTarget: (mixTargetId: string) => void;
  setDraftValue: (key: string, value: number) => void;
  onUpdateChannel: (request: AudioChannelUpdate) => void;
  onUpdateMixTarget: (request: AudioMixTargetUpdate) => void;
  viewModel: AudioWorkspaceViewModel;
}) {
  return (
    <div className={styles.tieredMixer} data-testid="audio-tiered-mixer">
      <AudioRoutingOverlay viewModel={viewModel} />
      {viewModel.sourceTiers.map((tier) => (
        <section className={styles.mixerTier} data-testid={tier.testId} data-tier={tier.id} key={tier.id}>
          <div
            className={styles.tierLabel}
            data-testid={`audio-tier-label-${tier.id}`}
            onClick={() => onSelectChannel(null)}
          >
            <div className={styles.tierTitleBlock}>
              <TierIcon tierId={tier.id} />
              <span className={styles.tierNum}>{TIER_NUMBERS[tier.id as keyof typeof TIER_NUMBERS]}</span>
              <span>{tier.label}</span>
            </div>
            <div className={styles.tierChipRow}>
              {tier.chips.map((chip) => (
                <button
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
            <small>
              {tier.channels.length > 0
                ? viewModel.clampedBankIndex > 0
                  ? `Bank ${viewModel.clampedBankIndex + 1} / ${viewModel.totalBanks}`
                  : tier.meta
                : "No sources in this bank"}
            </small>
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
              tier.channels.map((channel, index) => (
                <AudioChannelLane
                  actionsAllowed={viewModel.actionsAllowed}
                  channel={channel}
                  clearDraftValue={clearDraftValue}
                  commitChannelContinuous={commitChannelContinuous}
                  feeding={viewModel.feedingChannelIds.includes(channel.id)}
                  getDraftValue={getDraftValue}
                  index={index}
                  key={channel.id}
                  onClearClip={onClearClip}
                  onOpenContextMenu={onOpenChannelMenu}
                  onSelect={onSelectChannel}
                  onUpdateChannel={onUpdateChannel}
                  setDraftValue={setDraftValue}
                  selected={channel.id === viewModel.selectedChannelId}
                  selectedMixTargetId={viewModel.selectedMixTargetId}
                  simulatedMeters={viewModel.meterSimulationActive}
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
          <div className={styles.tierTitleBlock}>
            <span className={styles.tierIcon}>
              <ArrowRight size={18} strokeWidth={1.6} aria-hidden="true" />
            </span>
            <span className={styles.tierNum}>03</span>
            <span>{viewModel.hardwareOutputs.label}</span>
          </div>
          <div className={styles.tierChipRow}>
            <span className={styles.tierChip} data-active="true">
              Main
            </span>
            <span className={styles.tierChip}>Cue</span>
          </div>
          <small>{viewModel.hardwareOutputs.mixTargets.length} dest · selecting one sets the active mix</small>
        </div>
        <div className={styles.outputLaneGrid}>
          {viewModel.hardwareOutputs.mixTargets.map((mixTarget, index) => (
            <AudioOutputLane
              actionsAllowed={viewModel.actionsAllowed}
              clearDraftValue={clearDraftValue}
              commitMixTargetContinuous={commitMixTargetContinuous}
              getDraftValue={getDraftValue}
              index={index}
              key={mixTarget.id}
              mixTarget={mixTarget}
              onSelect={(mixTargetId) => {
                onSelectChannel(null);
                onSelectMixTarget(mixTargetId);
              }}
              onUpdateMixTarget={onUpdateMixTarget}
              setDraftValue={setDraftValue}
              selected={mixTarget.id === viewModel.selectedMixTargetId}
              simulatedMeters={viewModel.meterSimulationActive}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
