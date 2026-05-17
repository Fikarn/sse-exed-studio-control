import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

import type { AudioSnapshot, ShellStore } from "@sse/engine-client";
import type { PaletteAction } from "@sse/design-system";

import styles from "./AudioWorkspace.module.css";
import { AUDIO_FADER_UNITY, type AudioDensityMode, type AudioFeedbackTone } from "./audioFormatting";
import {
  buildAudioPaletteRegistrationSignature,
  buildAudioViewModel,
  type AudioChannelGroup,
  type AudioChannelGroupSelectionRequest,
  type AudioChannelGroupSelections,
  type AudioWorkspaceViewModel,
} from "./audioViewModel";
import { AudioContextMenu } from "./components/AudioContextMenu";
import { AudioHealthBar } from "./components/AudioHealthBar";
import { AudioInspector, type InspectorTab } from "./components/AudioInspector";
import { AudioRail } from "./components/AudioRail";
import { AudioSignalCanvas } from "./components/AudioSignalCanvas";
import { isEditableTarget, type AudioChannelEntry, type SnapshotRecord } from "../shellData";
import { useLiveCallback } from "../shared/useLiveCallback";
import { usePalette } from "../shared/paletteContext";

interface AudioWorkspaceProps {
  appSnapshot: SnapshotRecord | null;
  audioSnapshot: AudioSnapshot | null;
  store: ShellStore;
}

interface AudioWorkspaceFeedback {
  message: string;
  tone: AudioFeedbackTone;
}

type AudioChannelUpdate = Parameters<ShellStore["updateAudioChannel"]>[0];
type AudioDynamicsUpdate = Parameters<ShellStore["updateAudioChannelDynamics"]>[0];
type AudioEqUpdate = Parameters<ShellStore["updateAudioChannelEq"]>[0];
type AudioSendModeUpdate = Parameters<ShellStore["updateAudioChannelSendMode"]>[0];
type AudioMixTargetUpdate = Parameters<ShellStore["updateAudioMixTarget"]>[0];

interface AudioContextMenuState {
  channelId: string;
  x: number;
  y: number;
}

interface AudioPaletteRegistrationModel {
  allSelectableChannels: AudioChannelEntry[];
  mixTargets: AudioWorkspaceViewModel["mixTargets"];
  selectedChannel: AudioWorkspaceViewModel["selectedChannel"];
  selectedMixTargetId: AudioWorkspaceViewModel["selectedMixTargetId"];
  selectedSnapshot: AudioWorkspaceViewModel["selectedSnapshot"];
  snapshots: AudioWorkspaceViewModel["snapshots"];
}

const EMPTY_CHANNEL_GROUP_SELECTIONS: AudioChannelGroupSelections = {
  "hardware-inputs": [],
  "software-playback": [],
};

export function AudioWorkspace({ appSnapshot, audioSnapshot, store }: AudioWorkspaceProps) {
  const { register } = usePalette();
  const [density, setDensity] = useState<AudioDensityMode>("desktop");
  const [activeChannelGroups, setActiveChannelGroups] =
    useState<AudioChannelGroupSelections>(EMPTY_CHANNEL_GROUP_SELECTIONS);
  const [bankIndex, setBankIndex] = useState(0);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<AudioWorkspaceFeedback | null>(null);
  const [recentlyRecalledSnapshotId, setRecentlyRecalledSnapshotId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<AudioContextMenuState | null>(null);
  const [controlDrafts, setControlDrafts] = useState<Record<string, number>>({});
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("channel");
  const warningBandRef = useRef<HTMLDivElement | null>(null);
  const recallPulseTimerRef = useRef<number | null>(null);

  const viewModel = useMemo(() => {
    if (!audioSnapshot) return null;
    return buildAudioViewModel({ activeChannelGroups, appSnapshot, audioSnapshot, bankIndex, density });
  }, [activeChannelGroups, appSnapshot, audioSnapshot, bankIndex, density]);

  useEffect(() => {
    if (!viewModel || bankIndex === viewModel.clampedBankIndex) {
      return;
    }
    setBankIndex(viewModel.clampedBankIndex);
  }, [bankIndex, viewModel]);

  useEffect(() => {
    const recalledSnapshotId =
      typeof audioSnapshot?.lastRecalledSnapshotId === "string" ? audioSnapshot.lastRecalledSnapshotId : null;

    if (!recalledSnapshotId || !audioSnapshot?.lastSnapshotRecallAt) {
      return;
    }

    setRecentlyRecalledSnapshotId(recalledSnapshotId);
    if (recallPulseTimerRef.current !== null) {
      window.clearTimeout(recallPulseTimerRef.current);
    }
    recallPulseTimerRef.current = window.setTimeout(() => {
      setRecentlyRecalledSnapshotId(null);
      recallPulseTimerRef.current = null;
    }, 1500);
  }, [audioSnapshot?.lastRecalledSnapshotId, audioSnapshot?.lastSnapshotRecallAt]);

  useEffect(() => {
    return () => {
      if (recallPulseTimerRef.current !== null) {
        window.clearTimeout(recallPulseTimerRef.current);
      }
    };
  }, []);

  const performAction = useLiveCallback(async (actionId: string, runner: () => Promise<void>) => {
    setBusyAction(actionId);
    setFeedback(null);
    try {
      await runner();
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "The audio action could not be completed.",
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  });

  const getDraftValue = useLiveCallback((key: string, fallback: number) =>
    typeof controlDrafts[key] === "number" ? controlDrafts[key] : fallback
  );

  const setDraftValue = useLiveCallback((key: string, value: number) => {
    setControlDrafts((current) => ({ ...current, [key]: value }));
  });

  const clearDraftValue = useLiveCallback((key: string) => {
    setControlDrafts((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  });

  const syncAudio = useLiveCallback(() => {
    void performAction("audio-sync", async () => {
      await store.syncAudio();
    });
  });

  const recallSnapshot = useLiveCallback((snapshotId: string) => {
    void performAction(`audio-snapshot-${snapshotId}`, async () => {
      await store.recallAudioSnapshot(snapshotId);
    });
  });

  const recallCurrentSnapshot = useLiveCallback(() => {
    if (!viewModel?.selectedSnapshot) return;
    void performAction("audio-current-snapshot", async () => {
      await store.recallAudioSnapshot(viewModel.selectedSnapshot!.id);
    });
  });

  const captureSnapshot = useLiveCallback(() => {
    if (!viewModel) return;
    const usedSlots = new Set(viewModel.snapshots.map((snapshot) => snapshot.oscIndex));
    const slotIndex = Array.from({ length: 8 }, (_, index) => index).find((index) => !usedSlots.has(index));
    if (slotIndex === undefined) {
      setFeedback({ message: "All audio snapshot slots are populated.", tone: "info" });
      return;
    }
    void performAction("audio-snapshot-capture", async () => {
      await store.createAudioSnapshot({
        captureCurrentState: true,
        name: `Snapshot ${slotIndex + 1}`,
        oscIndex: slotIndex,
      });
    });
  });

  const saveSnapshot = useLiveCallback((snapshotId: string) => {
    void performAction(`audio-snapshot-save-${snapshotId}`, async () => {
      await store.updateAudioSnapshot({ snapshotId, captureCurrentState: true });
    });
  });

  const saveCurrentSnapshot = useLiveCallback(() => {
    if (!viewModel?.selectedSnapshot) return;
    saveSnapshot(viewModel.selectedSnapshot.id);
  });

  const renameSnapshot = useLiveCallback((snapshotId: string, currentName: string) => {
    const nextName = window.prompt("Rename audio snapshot", currentName);
    if (nextName === null || !nextName.trim() || nextName.trim() === currentName) return;
    void performAction(`audio-snapshot-rename-${snapshotId}`, async () => {
      await store.updateAudioSnapshot({ snapshotId, name: nextName.trim() });
    });
  });

  const renameChannel = useLiveCallback((channelId: string, currentName: string) => {
    const nextName = window.prompt("Rename audio channel", currentName);
    if (nextName === null || !nextName.trim() || nextName.trim() === currentName) return;
    updateChannel({ channelId, name: nextName.trim() });
  });

  const deleteSnapshot = useLiveCallback((snapshotId: string, snapshotName: string) => {
    if (!window.confirm(`Delete audio snapshot "${snapshotName}"?`)) return;
    void performAction(`audio-snapshot-delete-${snapshotId}`, async () => {
      await store.deleteAudioSnapshot({ snapshotId });
    });
  });

  const selectChannel = useLiveCallback((channelId: string | null) => {
    setContextMenu(null);
    void store.updateAudioSettings({ selectedChannelId: channelId });
  });

  const selectMixTarget = useLiveCallback((mixTargetId: string) => {
    void store.updateAudioSettings({ selectedMixTargetId: mixTargetId });
  });

  const selectChannelGroup = useLiveCallback(({ group, mode, tierId }: AudioChannelGroupSelectionRequest) => {
    const availableGroups = (tierId === "hardware-inputs"
      ? viewModel?.hardwareInputs.chips
      : viewModel?.softwarePlayback.chips
    )?.map((chip) => chip.id as AudioChannelGroup) ?? [group];
    setActiveChannelGroups((current) => {
      const selected = new Set(current[tierId]);
      if (mode === "invert") {
        for (const availableGroup of availableGroups) {
          if (selected.has(availableGroup)) {
            selected.delete(availableGroup);
          } else {
            selected.add(availableGroup);
          }
        }
      } else if (mode === "toggle") {
        if (selected.has(group)) {
          selected.delete(group);
        } else {
          selected.add(group);
        }
      } else {
        const isActive = selected.has(group);
        selected.clear();
        if (!isActive) {
          selected.add(group);
        }
      }

      return {
        ...current,
        [tierId]: availableGroups.filter((availableGroup) => selected.has(availableGroup)),
      };
    });
    setBankIndex(0);
  });

  const updateChannel = useLiveCallback((request: AudioChannelUpdate) => {
    void performAction(`audio-channel-${request.channelId}`, async () => {
      await store.updateAudioChannel(request);
    });
  });

  const updateChannelEq = useLiveCallback((request: AudioEqUpdate) => {
    void performAction(`audio-channel-eq-${request.channelId}`, async () => {
      await store.updateAudioChannelEq(request);
    });
  });

  const updateChannelDynamics = useLiveCallback((request: AudioDynamicsUpdate) => {
    void performAction(`audio-channel-dynamics-${request.channelId}`, async () => {
      await store.updateAudioChannelDynamics(request);
    });
  });

  const updateChannelSendMode = useLiveCallback((request: AudioSendModeUpdate) => {
    void performAction(`audio-channel-send-${request.channelId}-${request.mixTargetId}`, async () => {
      await store.updateAudioChannelSendMode(request);
    });
  });

  const updateMixTarget = useLiveCallback((request: AudioMixTargetUpdate) => {
    void performAction(`audio-output-${request.mixTargetId}`, async () => {
      await store.updateAudioMixTarget(request);
    });
  });

  const clearAllSolo = useLiveCallback(() => {
    if (!viewModel) return;
    for (const channel of viewModel.channels.filter((entry) => entry.solo)) {
      updateChannel({ channelId: channel.id, solo: false });
    }
  });

  const clearSolo = useLiveCallback((channelId: string) => {
    updateChannel({ channelId, solo: false });
  });

  const clearClips = useLiveCallback((channelId?: string) => {
    void performAction(channelId ? `audio-clear-clip-${channelId}` : "audio-clear-clips", async () => {
      await store.clearAudioClips(channelId ? { channelId } : {});
    });
  });

  const commitChannelContinuous = useLiveCallback((request: AudioChannelUpdate) => {
    void store.updateAudioChannel(request).catch((error) => {
      setFeedback({
        message: error instanceof Error ? error.message : "The audio control could not be updated.",
        tone: "error",
      });
    });
  });

  const commitMixTargetContinuous = useLiveCallback((request: AudioMixTargetUpdate) => {
    void store.updateAudioMixTarget(request).catch((error) => {
      setFeedback({
        message: error instanceof Error ? error.message : "The audio output could not be updated.",
        tone: "error",
      });
    });
  });

  const openChannelContextMenu = useLiveCallback((event: ReactMouseEvent<HTMLElement>, channelId: string) => {
    event.preventDefault();
    event.stopPropagation();
    void store.updateAudioSettings({ selectedChannelId: channelId });
    setContextMenu({ channelId, x: event.clientX, y: event.clientY });
  });

  const previousBank = useLiveCallback(() => {
    setBankIndex((current) => Math.max(0, current - 1));
  });

  const nextBank = useLiveCallback(() => {
    const maxBankIndex = Math.max(0, (viewModel?.totalBanks ?? 1) - 1);
    setBankIndex((current) => Math.min(maxBankIndex, current + 1));
  });

  const setViewMode = useLiveCallback((viewMode: "submix" | "master") => {
    void store.updateAudioSettings({ viewMode });
  });

  const toggleViewMode = useLiveCallback(() => {
    if (!viewModel?.capabilities.canUseMasterView) return;
    setViewMode(viewModel.viewMode === "master" ? "submix" : "master");
  });

  const visibleSelectableChannels = useMemo(() => {
    if (!viewModel) return [];
    return [...viewModel.hardwareInputs.channels, ...viewModel.softwarePlayback.channels];
  }, [viewModel]);

  const allSelectableChannels = useMemo(() => {
    if (!viewModel) return [];
    return [
      ...viewModel.channels.filter((channel) => channel.role !== "playback-pair"),
      ...viewModel.channels.filter((channel) => channel.role === "playback-pair"),
    ];
  }, [viewModel]);

  const orderedSelectableSources = useMemo(() => {
    if (!viewModel) return [];
    return [
      ...viewModel.channels
        .filter((channel) => channel.role !== "playback-pair")
        .map((channel) => ({ id: channel.id, kind: "channel" as const })),
      ...viewModel.channels
        .filter((channel) => channel.role === "playback-pair")
        .map((channel) => ({ id: channel.id, kind: "channel" as const })),
      ...viewModel.mixTargets.map((mixTarget) => ({ id: mixTarget.id, kind: "output" as const })),
    ];
  }, [viewModel]);
  const paletteRegistrationSignature = viewModel
    ? buildAudioPaletteRegistrationSignature(viewModel, allSelectableChannels)
    : "";
  const paletteRegistrationRef = useRef<{
    model: AudioPaletteRegistrationModel | null;
    signature: string;
  }>({ model: null, signature: "" });
  if (paletteRegistrationRef.current.signature !== paletteRegistrationSignature) {
    paletteRegistrationRef.current = {
      model: viewModel
        ? {
            allSelectableChannels,
            mixTargets: viewModel.mixTargets,
            selectedChannel: viewModel.selectedChannel,
            selectedMixTargetId: viewModel.selectedMixTargetId,
            selectedSnapshot: viewModel.selectedSnapshot,
            snapshots: viewModel.snapshots,
          }
        : null,
      signature: paletteRegistrationSignature,
    };
  }
  const paletteRegistrationModel = paletteRegistrationRef.current.model;

  const handleKeyDown = useLiveCallback((event: KeyboardEvent) => {
    if (!viewModel || event.defaultPrevented) {
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key === "Escape" && contextMenu) {
      setContextMenu(null);
      event.preventDefault();
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key === "Escape") {
      if (inspectorTab !== "channel") {
        setInspectorTab("channel");
        event.preventDefault();
        return;
      }
      if (viewModel.selectedChannelId) {
        selectChannel(null);
        event.preventDefault();
      }
      return;
    }

    if (isEditableTarget(event.target)) {
      return;
    }

    if (!event.metaKey && !event.ctrlKey && event.altKey && event.key.toLowerCase() === "c") {
      clearClips();
      event.preventDefault();
      return;
    }

    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "s") {
      saveCurrentSnapshot();
      event.preventDefault();
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "v") {
      toggleViewMode();
      event.preventDefault();
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key === "[") {
      previousBank();
      event.preventDefault();
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key === "]") {
      nextBank();
      event.preventDefault();
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.shiftKey && /^Digit[1-8]$/.test(event.code)) {
      const snapshot = viewModel.snapshots[Number(event.code.replace("Digit", "")) - 1];
      if (snapshot) {
        recallSnapshot(snapshot.id);
        event.preventDefault();
      }
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && /^Digit[1-8]$/.test(event.code)) {
      const channel = visibleSelectableChannels[Number(event.code.replace("Digit", "")) - 1];
      if (channel) {
        selectChannel(channel.id);
        event.preventDefault();
      }
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "m") {
      if (viewModel.selectedChannel) {
        updateChannel({
          channelId: viewModel.selectedChannel.id,
          mute: !viewModel.selectedChannel.mute,
        });
        event.preventDefault();
      }
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "s") {
      if (viewModel.selectedChannel) {
        updateChannel({
          channelId: viewModel.selectedChannel.id,
          solo: !viewModel.selectedChannel.solo,
        });
        event.preventDefault();
      }
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "u") {
      if (viewModel.selectedChannel && viewModel.selectedMixTargetId) {
        updateChannel({
          channelId: viewModel.selectedChannel.id,
          fader: AUDIO_FADER_UNITY,
          mixTargetId: viewModel.selectedMixTargetId,
        });
        event.preventDefault();
      }
      return;
    }

    if (
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    ) {
      if (orderedSelectableSources.length > 0) {
        const currentIndex = orderedSelectableSources.findIndex((entry) =>
          viewModel.selectedChannelId
            ? entry.kind === "channel" && entry.id === viewModel.selectedChannelId
            : entry.kind === "output" && entry.id === viewModel.selectedMixTargetId
        );
        const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
        const nextIndex =
          currentIndex < 0
            ? direction > 0
              ? 0
              : orderedSelectableSources.length - 1
            : Math.max(0, Math.min(orderedSelectableSources.length - 1, currentIndex + direction));
        const nextSource = orderedSelectableSources[nextIndex];
        if (nextSource?.kind === "channel") {
          selectChannel(nextSource.id);
        } else if (nextSource?.kind === "output") {
          selectChannel(null);
          selectMixTarget(nextSource.id);
        }
        event.preventDefault();
      }
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key === "Enter") {
      if (warningBandRef.current && document.activeElement === warningBandRef.current && viewModel.actionsAllowed) {
        syncAudio();
        event.preventDefault();
      }
      return;
    }
  });

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (!paletteRegistrationModel) return;
    const {
      allSelectableChannels: paletteChannels,
      mixTargets: paletteMixTargets,
      selectedChannel: paletteSelectedChannel,
      selectedMixTargetId: paletteSelectedMixTargetId,
      selectedSnapshot: paletteSelectedSnapshot,
      snapshots: paletteSnapshots,
    } = paletteRegistrationModel;

    const channelActions: PaletteAction[] = paletteChannels.map((channel, index) => ({
      id: `audio:channel:${channel.id}`,
      label: `Select ${channel.name}`,
      group: "Channels",
      keywords: ["audio", "channel", "source", channel.name, channel.shortName, channel.role],
      shortcut: index < 8 ? `${index + 1}` : undefined,
      action: () => selectChannel(channel.id),
    }));

    const outputActions: PaletteAction[] = paletteMixTargets.map((mixTarget) => ({
      id: `audio:mix-target:${mixTarget.id}`,
      label: `Switch active mix to ${mixTarget.name}`,
      group: "Outputs",
      keywords: ["audio", "mix", "target", "submix", "output", mixTarget.name, mixTarget.shortName, mixTarget.role],
      action: () => {
        selectChannel(null);
        selectMixTarget(mixTarget.id);
      },
    }));

    const snapshotActions: PaletteAction[] = paletteSnapshots.slice(0, 8).map((snapshot, index) => ({
      id: `audio:snapshot:${snapshot.id}`,
      label: `Recall snapshot ${index + 1}`,
      group: "Snapshots",
      keywords: ["audio", "snapshot", "recall", snapshot.name, `${index + 1}`],
      shortcut: `⇧${index + 1}`,
      action: () => recallSnapshot(snapshot.id),
    }));

    const actionActions: PaletteAction[] = [
      {
        id: "audio:sync",
        label: "Sync console",
        group: "Actions",
        keywords: ["audio", "osc", "sync", "console"],
        action: syncAudio,
      },
      {
        id: "audio:bank:previous",
        label: "Previous bank",
        group: "Actions",
        keywords: ["audio", "mixer", "bank", "previous"],
        shortcut: "[",
        action: previousBank,
      },
      {
        id: "audio:bank:next",
        label: "Next bank",
        group: "Actions",
        keywords: ["audio", "mixer", "bank", "next"],
        shortcut: "]",
        action: nextBank,
      },
      {
        id: "audio:view:toggle",
        label: "Toggle Master/Submix view",
        group: "Actions",
        keywords: ["audio", "view", "master", "submix", "toggle master submix"],
        shortcut: "V",
        action: toggleViewMode,
      },
      {
        id: "audio:view:submix",
        label: "Show Submix view",
        group: "Actions",
        keywords: ["audio", "view", "submix"],
        action: () => setViewMode("submix"),
      },
      {
        id: "audio:view:master",
        label: "Show Master view",
        group: "Actions",
        keywords: ["audio", "view", "master"],
        action: () => setViewMode("master"),
      },
      {
        id: "audio:clear-selected-channel",
        label: "Clear selected channel",
        group: "Actions",
        keywords: ["audio", "selection", "clear", "esc"],
        shortcut: "Esc",
        action: () => selectChannel(null),
      },
      {
        id: "audio:clear-all-solo",
        label: "Clear all solo",
        group: "Actions",
        keywords: ["audio", "solo", "clear"],
        action: clearAllSolo,
      },
      {
        id: "audio:clear-clips",
        label: "Clear clips",
        group: "Actions",
        keywords: ["audio", "clip", "clear", "reset"],
        shortcut: "⌥C",
        action: () => clearClips(),
      },
      {
        id: "audio:clear-selected-clip",
        label: "Clear selected channel clip",
        group: "Actions",
        keywords: [
          "audio",
          "clip",
          "clear",
          "selected",
          "clear selected channel clip",
          "clear selected audio clip",
          paletteSelectedChannel?.name ?? "",
        ],
        action: () => {
          if (paletteSelectedChannel) {
            clearClips(paletteSelectedChannel.id);
          }
        },
      },
      {
        id: "audio:rename-selected-channel",
        label: "Rename selected channel",
        group: "Actions",
        keywords: [
          "audio",
          "rename",
          "channel",
          "selected",
          "rename selected channel",
          "rename selected audio",
          paletteSelectedChannel?.name ?? "",
        ],
        action: () => {
          if (paletteSelectedChannel) {
            renameChannel(paletteSelectedChannel.id, paletteSelectedChannel.name);
          }
        },
      },
      {
        id: "audio:toggle-selected-polarity",
        label: "Toggle selected polarity",
        group: "Actions",
        keywords: [
          "audio",
          "phase",
          "polarity",
          "invert",
          "selected",
          "toggle selected polarity",
          "toggle selected audio polarity",
          paletteSelectedChannel?.name ?? "",
        ],
        action: () => {
          if (paletteSelectedChannel) {
            updateChannel({
              channelId: paletteSelectedChannel.id,
              phase: !paletteSelectedChannel.phase,
            });
          }
        },
      },
      {
        id: "audio:snapshot:capture",
        label: "Capture new snapshot",
        group: "Actions",
        keywords: ["audio", "snapshot", "capture", "new"],
        action: captureSnapshot,
      },
      {
        id: "audio:snapshot:save-current",
        label: "Save current snapshot",
        group: "Actions",
        keywords: ["audio", "snapshot", "save", paletteSelectedSnapshot?.name ?? ""],
        shortcut: "⌘S",
        action: saveCurrentSnapshot,
      },
      {
        id: "audio:reset-selected-fader",
        label: "Reset selected fader to unity",
        group: "Actions",
        keywords: [
          "audio",
          "reset",
          "selected",
          "fader",
          "unity",
          "reset selected fader",
          "reset selected audio",
          paletteSelectedChannel?.name ?? "",
        ],
        shortcut: "U",
        action: () => {
          if (paletteSelectedChannel && paletteSelectedMixTargetId) {
            updateChannel({
              channelId: paletteSelectedChannel.id,
              fader: AUDIO_FADER_UNITY,
              mixTargetId: paletteSelectedMixTargetId,
            });
          }
        },
      },
      ...paletteChannels.flatMap((channel): PaletteAction[] => [
        {
          id: `audio:solo:${channel.id}`,
          label: `Solo ${channel.name}`,
          group: "Actions",
          keywords: ["audio", "solo", channel.name, channel.shortName, channel.role],
          action: () => {
            updateChannel({
              channelId: channel.id,
              solo: !channel.solo,
            });
          },
        },
        {
          id: `audio:mute:${channel.id}`,
          label: `Mute ${channel.name}`,
          group: "Actions",
          keywords: ["audio", "mute", channel.name, channel.shortName, channel.role],
          action: () => {
            updateChannel({
              channelId: channel.id,
              mute: !channel.mute,
            });
          },
        },
      ]),
    ];
    const audioActions: PaletteAction[] = [...channelActions, ...outputActions, ...snapshotActions, ...actionActions];

    return register(audioActions);
  }, [
    clearAllSolo,
    clearClips,
    captureSnapshot,
    saveCurrentSnapshot,
    nextBank,
    previousBank,
    recallSnapshot,
    register,
    renameChannel,
    selectChannel,
    selectMixTarget,
    setViewMode,
    syncAudio,
    toggleViewMode,
    updateChannel,
    paletteRegistrationModel,
  ]);

  if (!viewModel) {
    return (
      <div className={styles.audioShell} data-testid="audio-workspace">
        <section className={styles.loadingPanel}>
          <span className={styles.eyebrow}>Audio</span>
          <h1>Loading audio snapshot.</h1>
          <div className={styles.loadingGrid}>
            {Array.from({ length: 16 }, (_, index) => (
              <span key={`audio-loading-${index}`} />
            ))}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div
      className={styles.audioShell}
      data-density={density}
      data-output-role={viewModel.selectedMixTarget?.role ?? "main-out"}
      data-testid="audio-workspace"
      data-view-mode={viewModel.viewMode}
    >
      {feedback ? (
        <div className={styles.feedbackBanner} data-tone={feedback.tone} role="status">
          {feedback.message}
        </div>
      ) : null}

      <div className={styles.audioBody}>
        <AudioRail
          clearDraftValue={clearDraftValue}
          commitMixTargetContinuous={commitMixTargetContinuous}
          getDraftValue={getDraftValue}
          onRecallCurrentSnapshot={recallCurrentSnapshot}
          onSelectMixTarget={selectMixTarget}
          onSync={syncAudio}
          setDraftValue={setDraftValue}
          onUpdateMixTarget={updateMixTarget}
          viewModel={viewModel}
        />
        <AudioSignalCanvas
          busyAction={busyAction}
          clearDraftValue={clearDraftValue}
          commitChannelContinuous={commitChannelContinuous}
          commitMixTargetContinuous={commitMixTargetContinuous}
          density={density}
          getDraftValue={getDraftValue}
          onOpenChannelMenu={openChannelContextMenu}
          onClearAllSolo={clearAllSolo}
          onClearClips={clearClips}
          onClearSolo={clearSolo}
          onCaptureSnapshot={captureSnapshot}
          onDeleteSnapshot={deleteSnapshot}
          onRecallSnapshot={recallSnapshot}
          onRenameSnapshot={renameSnapshot}
          onSaveSnapshot={saveSnapshot}
          onSelectChannel={selectChannel}
          onSelectChannelGroup={selectChannelGroup}
          onSelectMixTarget={selectMixTarget}
          onSetDensity={setDensity}
          onSetViewMode={setViewMode}
          setDraftValue={setDraftValue}
          onUpdateChannel={updateChannel}
          onUpdateMixTarget={updateMixTarget}
          recentlyRecalledSnapshotId={recentlyRecalledSnapshotId}
          statusWarningRef={warningBandRef}
          viewModel={viewModel}
        />
        <AudioInspector
          clearDraftValue={clearDraftValue}
          commitChannelContinuous={commitChannelContinuous}
          commitMixTargetContinuous={commitMixTargetContinuous}
          getDraftValue={getDraftValue}
          activeTab={inspectorTab}
          onActiveTabChange={setInspectorTab}
          onSelectMixTarget={selectMixTarget}
          setDraftValue={setDraftValue}
          onUpdateChannelDynamics={updateChannelDynamics}
          onUpdateChannelEq={updateChannelEq}
          onUpdateChannelSendMode={updateChannelSendMode}
          onUpdateChannel={updateChannel}
          onUpdateMixTarget={updateMixTarget}
          viewModel={viewModel}
        />
      </div>

      <AudioContextMenu
        actionsAllowed={viewModel.actionsAllowed}
        channel={viewModel.channels.find((entry) => entry.id === contextMenu?.channelId) ?? null}
        onClose={() => setContextMenu(null)}
        onRename={renameChannel}
        onResetUnity={(channelId) =>
          updateChannel({
            channelId,
            fader: AUDIO_FADER_UNITY,
            mixTargetId: viewModel.selectedMixTargetId ?? undefined,
          })
        }
        onTogglePhase={(channelId, next) => updateChannel({ channelId, phase: next })}
        position={contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null}
      />

      <AudioHealthBar viewModel={viewModel} />
    </div>
  );
}
