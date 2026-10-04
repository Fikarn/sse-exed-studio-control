import type { ShellStore } from "@sse/engine-client";
import type { MenuContent, MenuDestructiveItem, MenuEntry } from "@sse/design-system";

import { clampPreampGain } from "./AudioEntryDialogs";
import { audioPhantomKey } from "../audioArming";
import { formatAudioDb } from "../audioFormatting";
import {
  audioChannelSupportsAutoSet,
  audioChannelSupportsGain,
  audioChannelSupportsInstrument,
  audioChannelSupportsPhantom,
  audioChannelSupportsPhase,
  getAudioChannelGroup,
} from "../audioViewModel";
import type { AudioChannelEntry, AudioMixTargetEntry } from "../../shellData";

// A channel's menu (DESIGN.md §9; Atrium's "What moved where"), one menu for
// the strip's ⋯, a right-click on the strip and the plate's title ⋯: the level
// and the gain by number, the sends' modes, the preamp's switches, the clip.
// The destructive item is the existing 48 V arm, in place.

type AudioChannelUpdate = Parameters<ShellStore["updateAudioChannel"]>[0];
type AudioSendModeUpdate = Parameters<ShellStore["updateAudioChannelSendMode"]>[0];

const DEFAULT_SEND_MODE = { linkStereo: true, mute: false, preFader: false, solo: false };

function inputPreampNumber(channelId: string) {
  const raw = Number(channelId.match(/\d+/g)?.at(-1) ?? 1);
  if (!Number.isFinite(raw)) return 1;
  return raw >= 9 ? raw - 8 : raw;
}

/** What the desk says this strip is: its preamp and input type, or its format and group. */
export function channelSubtitle(channel: AudioChannelEntry) {
  if (audioChannelSupportsGain(channel)) {
    return `Preamp ${inputPreampNumber(channel.id)} · ${channel.instrument ? "Hi-Z" : "mic"}`;
  }
  const group = getAudioChannelGroup(channel);
  return `${channel.stereo ? "Stereo" : "Mono"}${group ? ` · ${group}` : ""}`;
}

/** A send's modes, as the desk reports them or TotalMix's defaults. */
export function channelSendMode(channel: AudioChannelEntry, mixTargetId: string | null) {
  return (mixTargetId ? channel.sendModes[mixTargetId] : undefined) ?? DEFAULT_SEND_MODE;
}

export interface ChannelMenuArgs {
  channel: AudioChannelEntry;
  /** The preamp's gain as shown (the draft while it moves). */
  gain: number;
  /** The send into the mix target as shown (the draft while it moves). */
  sendLevel: number;
  selectedMixTarget: AudioMixTargetEntry | null;
  mixTargets: readonly AudioMixTargetEntry[];
  /** The short reason for a locked item ("desk NOT VERIFIED"); null when unlocked. */
  menuLock: string | null;
  onRequestLevel: () => void;
  onRequestGain: () => void;
  onResetToUnity: (channelId: string) => void;
  onClearClip: (channelId: string) => void;
  onUpdateChannel: (request: AudioChannelUpdate) => void;
  onUpdateChannelSendMode: (request: AudioSendModeUpdate) => void;
  testIdPrefix: string;
}

export function buildChannelMenu({
  channel,
  gain,
  sendLevel,
  selectedMixTarget,
  mixTargets,
  menuLock,
  onRequestLevel,
  onRequestGain,
  onResetToUnity,
  onClearClip,
  onUpdateChannel,
  onUpdateChannelSendMode,
  testIdPrefix,
}: ChannelMenuArgs): Omit<MenuContent, "arm"> {
  const targetId = selectedMixTarget?.id ?? null;
  const targetName = selectedMixTarget?.name ?? "the mix target";
  const noTarget = targetId ? null : "no mix target";
  const targetMode = channelSendMode(channel, targetId);
  const check = (entry: Omit<Extract<MenuEntry, { kind: "check" }>, "kind">): MenuEntry => ({
    kind: "check",
    ...entry,
  });

  const items: MenuEntry[] = [
    {
      id: "level",
      label: "Set fader level…",
      value: formatAudioDb(sendLevel),
      onSelect: onRequestLevel,
      disabledReason: menuLock ?? noTarget,
      testId: `${testIdPrefix}-level`,
    },
    {
      id: "unity",
      label: `Set ${targetName} send to 0 dB`,
      onSelect: () => onResetToUnity(channel.id),
      disabledReason: menuLock ?? noTarget,
      testId: `${testIdPrefix}-unity`,
    },
  ];
  if (audioChannelSupportsGain(channel)) {
    items.push({
      id: "gain",
      label: "Set preamp gain…",
      value: `${clampPreampGain(gain)} dB`,
      onSelect: onRequestGain,
      disabledReason: menuLock,
      testId: `${testIdPrefix}-gain`,
    });
  }
  items.push({ kind: "divider", id: "sends" });
  items.push(
    check({
      id: "pre-fader",
      label: `Pre fader for ${targetName}`,
      checked: targetMode.preFader,
      onCheckedChange: (preFader) =>
        targetId && onUpdateChannelSendMode({ channelId: channel.id, mixTargetId: targetId, preFader }),
      disabledReason: menuLock ?? noTarget,
    })
  );
  if (channel.stereo) {
    items.push(
      check({
        id: "link",
        label: `Link L+R for ${targetName}`,
        checked: targetMode.linkStereo,
        onCheckedChange: (linkStereo) =>
          targetId && onUpdateChannelSendMode({ channelId: channel.id, mixTargetId: targetId, linkStereo }),
        disabledReason: menuLock ?? noTarget,
      })
    );
  }
  // Every mix's send mute, the target's too: a send muted while another mix
  // was the target is still shown and can be cleared (the review of #299).
  for (const mixTarget of mixTargets) {
    items.push(
      check({
        id: `mute-send-${mixTarget.id}`,
        label: `Mute send to ${mixTarget.name}`,
        checked: channelSendMode(channel, mixTarget.id).mute,
        onCheckedChange: (mute) => onUpdateChannelSendMode({ channelId: channel.id, mixTargetId: mixTarget.id, mute }),
        disabledReason: menuLock,
      })
    );
  }
  items.push({ kind: "divider", id: "channel" });
  if (audioChannelSupportsInstrument(channel)) {
    items.push(
      check({
        id: "hi-z",
        label: "Hi-Z",
        checked: channel.instrument,
        onCheckedChange: (instrument) => onUpdateChannel({ channelId: channel.id, instrument }),
        disabledReason: menuLock,
      })
    );
  }
  if (audioChannelSupportsPhase(channel)) {
    items.push(
      check({
        id: "polarity",
        label: "Polarity",
        checked: channel.phase,
        onWord: "flipped",
        offWord: "normal",
        onCheckedChange: (phase) => onUpdateChannel({ channelId: channel.id, phase }),
        disabledReason: menuLock,
      })
    );
  }
  if (audioChannelSupportsAutoSet(channel)) {
    items.push(
      check({
        id: "autoset",
        label: "AutoSet",
        checked: channel.autoSet,
        onCheckedChange: (autoSet) => onUpdateChannel({ channelId: channel.id, autoSet }),
        disabledReason: menuLock,
      })
    );
  }
  items.push({
    id: "clear-clip",
    label: "Clear clip",
    onSelect: () => onClearClip(channel.id),
    disabledReason: channel.clip ? null : "no clip held",
    testId: `${testIdPrefix}-clear-clip`,
  });

  // 48 V off is the strip's one destructive command: it arms in place in the
  // open menu and shares the Console's arm with every key on the page. 48 V on
  // is the strip's hazard key, which arms the same way.
  const destructive: MenuDestructiveItem | undefined =
    audioChannelSupportsPhantom(channel) && channel.phantom
      ? {
          id: audioPhantomKey(channel.id, false),
          label: "Turn 48 V off…",
          armedLabel: "Press again to turn 48 V off",
          onConfirm: () => onUpdateChannel({ channelId: channel.id, phantom: false }),
          disabledReason: menuLock,
          testId: `${testIdPrefix}-phantom`,
        }
      : undefined;

  return { head: { title: channel.name, detail: channelSubtitle(channel) }, items, destructive };
}
