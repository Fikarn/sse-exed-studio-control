import { useRef } from "react";
import type { ShellStore } from "@sse/engine-client";
import { Key, MenuButton, Tooltip, type MenuEntry, type UseArmResult } from "@sse/design-system";

import styles from "./AudioTieredMixer.module.css";
import { type AudioControlDraftStore } from "../audioControlDraftStore";
import { audioLockNote, dbfsToMeterPercent } from "../audioFormatting";
import { METER_NOMINAL_DBFS } from "../audioMeterDisplayModel";
import {
  type AudioChannelGroupSelectionRequest,
  type AudioGroupTierId,
  type AudioTierViewModel,
  type AudioWorkspaceViewModel,
} from "../audioViewModel";
import { AudioChannelLane } from "./AudioMixerLane";
import { METER_SCALE_MARKS } from "./AudioStereoMeter";

// The bay (visual overhaul, the Console): the sources only, Inputs (4 a bank)
// and Playback (6), side by side; the outputs live in the cluster. Each tier is
// its head (the Adelia word over the heavy rule, the bank keys on Inputs, the
// lock reason when the console is locked, the group filter's words while one
// is on, the tier's ⋯), then the scale gutter and the strips. The tiers keep
// their widths whatever a bank holds, so a strip never moves when the bank
// changes. The gutter prints the meters' scale (the Console's strip,
// 2026-10-11, D50): the meter is the strip's hero; the fader names its own
// unity beside its notch.

type AudioChannelUpdate = Parameters<ShellStore["updateAudioChannel"]>[0];

export interface AudioTieredMixerProps {
  arm: UseArmResult;
  armedActionKey: string | null;
  clearDraftValueLater: (key: string, delayMs?: number) => void;
  commitChannelContinuous: (request: AudioChannelUpdate) => void;
  draftStore: AudioControlDraftStore;
  getDraftValue: (key: string, fallback: number) => number;
  onClearChannelGroups: (tierId: AudioGroupTierId) => void;
  onClearClip: (channelId: string) => void;
  onNextBank: () => void;
  onPreviousBank: () => void;
  onResetToUnity: (channelId: string) => void;
  onSelectChannel: (channelId: string | null) => void;
  onSelectChannelGroup: (request: AudioChannelGroupSelectionRequest) => void;
  onTogglePhantom: (request: { channelId: string; channelName: string; phantom: boolean }) => void;
  onUpdateChannel: (request: AudioChannelUpdate) => void;
  setDraftValue: (key: string, value: number) => void;
  viewModel: AudioWorkspaceViewModel;
}

export function AudioTieredMixer(props: AudioTieredMixerProps) {
  const { viewModel } = props;
  return (
    <div className={styles.tieredMixer} data-testid="audio-tiered-mixer">
      {viewModel.sourceTiers.map((tier) => (
        <AudioTier key={tier.id} tier={tier} {...props} />
      ))}
    </div>
  );
}

function AudioTier({
  arm,
  armedActionKey,
  clearDraftValueLater,
  commitChannelContinuous,
  draftStore,
  getDraftValue,
  onClearChannelGroups,
  onClearClip,
  onNextBank,
  onPreviousBank,
  onResetToUnity,
  onSelectChannel,
  onSelectChannelGroup,
  onTogglePhantom,
  onUpdateChannel,
  setDraftValue,
  tier,
  viewModel,
}: AudioTieredMixerProps & { tier: AudioTierViewModel }) {
  const headRef = useRef<HTMLDivElement | null>(null);
  const tierId = tier.id as AudioGroupTierId;
  const isInputs = tier.id === "hardware-inputs";
  const litGroups = tier.chips.filter((chip) => chip.active);
  const lockedReason = viewModel.actionsAllowed ? undefined : (viewModel.status.warningBody ?? undefined);
  const menuLock = viewModel.actionsAllowed ? null : `desk ${viewModel.status.label}`;

  // The tier's ⋯ (Atrium): the group filter, which replaces the chips. A lit
  // filter is said in the head's words, so a hidden strip is never a mystery.
  const filterItems: MenuEntry[] = [
    { kind: "label", id: "show", label: "Show" },
    ...tier.chips.map(
      (chip) =>
        ({
          kind: "check",
          id: chip.id,
          label: chip.label,
          checked: chip.active === true,
          onCheckedChange: () => onSelectChannelGroup({ group: chip.id, tierId }),
          testId: chip.testId,
        }) satisfies MenuEntry
    ),
    { kind: "divider", id: "all-divider" },
    {
      id: "all",
      label: "Show all",
      onSelect: () => onClearChannelGroups(tierId),
      disabledReason: litGroups.length === 0 ? "nothing hidden" : null,
      testId: `audio-tier-show-all-${tierId === "hardware-inputs" ? "inputs" : "playback"}`,
    },
  ];

  return (
    <section
      className={styles.tier}
      data-testid={tier.testId}
      data-tier={tier.id}
      data-size={isInputs ? "inputs" : "playback"}
    >
      <div
        ref={headRef}
        className={styles.head}
        data-testid={`audio-tier-label-${tier.id}`}
        // A press on the head's floor lets the selected strip go.
        onClick={() => onSelectChannel(null)}
      >
        <span className={styles.title}>{tier.label}</span>
        {isInputs && viewModel.totalBanks > 1 ? (
          // The bank keys page both tiers (new pages program, Slice 3, decision
          // 3). Paging is not a press on the head: nothing in the pair lets the
          // selected strip go. The visual overhaul's polish (2026-10-05): the
          // keys are the design system's small Key with ‹ and ›, as every other
          // page's pager (they were icon buttons with chevrons); an end of the
          // banks is disabled, not locked, for paging is never refused.
          <span className={styles.bank} data-testid="audio-bank-keys" onClick={(event) => event.stopPropagation()}>
            <Key
              size="small"
              testId="audio-bank-previous"
              aria-label="Previous bank"
              disabled={viewModel.clampedBankIndex <= 0}
              onClick={onPreviousBank}
            >
              ‹
            </Key>
            <Tooltip content={tier.bankReadout} placement="bottom">
              <span className={styles.bankReadout} data-testid={`audio-tier-bank-pill-${tier.id}`}>
                {viewModel.clampedBankIndex + 1} / {viewModel.totalBanks}
              </span>
            </Tooltip>
            <Key
              size="small"
              testId="audio-bank-next"
              aria-label="Next bank"
              disabled={viewModel.clampedBankIndex >= viewModel.totalBanks - 1}
              onClick={onNextBank}
            >
              ›
            </Key>
          </span>
        ) : null}
        <span className={styles.detail}>
          {viewModel.actionsAllowed ? null : (
            // The console is locked: the reason stands on the tier the hand is
            // reaching for, not only in the state display.
            <span
              className={styles.lockNote}
              data-tone={viewModel.status.tone === "error" ? "error" : "attention"}
              data-testid={`audio-tier-lock-note-${tier.id}`}
            >
              {audioLockNote(viewModel.status.label)}
            </span>
          )}
          {litGroups.length > 0 ? (
            <span className={styles.filter} data-testid={`audio-tier-filter-${tier.id}`}>
              {litGroups.map((chip) => chip.label).join(", ")} only
            </span>
          ) : null}
        </span>
        <span className={styles.actions} onClick={(event) => event.stopPropagation()}>
          <MenuButton
            buttonLabel={`${tier.label} menu`}
            buttonTestId={`audio-tier-menu-${tier.id}`}
            contextTarget={headRef}
            size="sm"
            menu={{ head: { title: tier.label, detail: "group filter" }, items: filterItems, arm }}
          />
        </span>
      </div>

      <div className={styles.body}>
        {/* The meters' scale, once per tier, on the strips' rows: dBFS over
            the peaks' column, the marks against the meters' travel. */}
        <div className={styles.gutter} aria-hidden="true">
          <span className={styles.scaleUnit}>dBFS</span>
          <span className={styles.scale} data-strip-scale="">
            {METER_SCALE_MARKS.map((mark) => (
              <span
                key={mark.dbfs}
                className={styles.scaleMark}
                data-strip-scale-mark={mark.label}
                data-nominal={mark.dbfs === METER_NOMINAL_DBFS ? "" : undefined}
                style={{ bottom: `${dbfsToMeterPercent(mark.dbfs).toFixed(2)}%` }}
              >
                {mark.label}
              </span>
            ))}
          </span>
        </div>
        <div
          className={styles.lanes}
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
                arm={arm}
                armedActionKey={armedActionKey}
                channel={channel}
                clearDraftValueLater={clearDraftValueLater}
                commitChannelContinuous={commitChannelContinuous}
                doubt={viewModel.valuesInDoubt}
                draftStore={draftStore}
                feeding={viewModel.feedingChannelIds.includes(channel.id)}
                getDraftValue={getDraftValue}
                key={channel.id}
                lockedReason={lockedReason}
                menuLock={menuLock}
                meterEmpty={viewModel.meterSimulationState === "gated"}
                onClearClip={onClearClip}
                onResetToUnity={onResetToUnity}
                onSelect={onSelectChannel}
                onTogglePhantom={onTogglePhantom}
                onUpdateChannel={onUpdateChannel}
                setDraftValue={setDraftValue}
                selected={channel.id === viewModel.selectedChannelId}
                selectedMixTarget={viewModel.selectedMixTarget}
              />
            ))
          ) : (
            <div className={styles.emptyTier}>No {tier.shortLabel.toLowerCase()} on this bank.</div>
          )}
        </div>
      </div>
    </section>
  );
}
