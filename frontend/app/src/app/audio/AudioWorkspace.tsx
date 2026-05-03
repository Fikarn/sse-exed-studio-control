import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { Button, StatusBadge, Surface } from "@sse/design-system";
import type { AudioSnapshot, ShellStore } from "@sse/engine-client";

import styles from "./AudioWorkspace.module.css";
import { useLiveCallback } from "../shared/useLiveCallback";
import {
  formatBackupTimestamp,
  getAudioChannels,
  getAudioMixTargets,
  getAudioSnapshots,
  isEditableTarget,
  mapStatusBadgeTone,
  type AudioChannelEntry,
  type SnapshotRecord,
} from "../shellData";

type AudioDensityMode = "overview" | "precision";
type FeedbackTone = "error" | "info" | "ok";

interface AudioWorkspaceProps {
  appSnapshot: SnapshotRecord | null;
  audioSnapshot: AudioSnapshot | null;
  store: ShellStore;
}

interface AudioWorkspaceFeedback {
  message: string;
  tone: FeedbackTone;
}

function formatAudioDb(value: number) {
  if (value <= 0) {
    return "-∞ dB";
  }

  const db = Math.max(0, Math.min(1, value)) * 18 - 18;
  return `${db.toFixed(1)} dB`;
}

function formatAudioRole(role: string) {
  switch (role) {
    case "front-preamp":
      return "Mic pre";
    case "rear-line":
      return "Rear line";
    case "playback-pair":
      return "Playback";
    case "main-out":
      return "Monitor";
    case "phones-a":
      return "Phones A";
    case "phones-b":
      return "Phones B";
    default:
      return role.replace(/-/g, " ");
  }
}

function audioChannelSupportsGain(channel: AudioChannelEntry) {
  return channel.role === "front-preamp";
}

function audioChannelSupportsPhantom(channel: AudioChannelEntry) {
  return channel.role === "front-preamp";
}

function audioChannelSupportsPad(channel: AudioChannelEntry) {
  return channel.role === "front-preamp";
}

function audioChannelSupportsInstrument(channel: AudioChannelEntry) {
  return channel.role === "front-preamp";
}

function audioChannelSupportsAutoSet(channel: AudioChannelEntry) {
  return channel.role === "front-preamp";
}

function audioChannelSupportsPhase(channel: AudioChannelEntry) {
  return channel.role !== "playback-pair";
}

function formatAudioActionFailureTitle(snapshot: SnapshotRecord | null) {
  const lastActionCode =
    typeof snapshot?.lastActionCode === "string" && snapshot.lastActionCode.trim().length > 0
      ? snapshot.lastActionCode
      : null;

  if (!lastActionCode) {
    return "ACTION FAILED";
  }

  return lastActionCode
    .replace(/^AUDIO_/, "")
    .replace(/_/g, " ")
    .trim();
}

function describeAudioStatus(snapshot: SnapshotRecord | null) {
  const lastActionFailed = String(snapshot?.lastActionStatus ?? "idle") === "failed";

  if (snapshot?.oscEnabled === false) {
    return {
      label: "DISABLED",
      warningBody: "OSC DISABLED - page is read-only until transport is re-enabled.",
      warningTitle: "OSC DISABLED",
    };
  }

  if (String(snapshot?.status ?? "not-verified") === "attention") {
    return {
      label: "OFFLINE",
      warningBody: "CONSOLE UNREACHABLE - audio may still be passing, but control state is not current.",
      warningTitle: "CONSOLE UNREACHABLE",
    };
  }

  if (String(snapshot?.status ?? "not-verified") !== "ready" || snapshot?.verified !== true) {
    return {
      label: "NOT VERIFIED",
      warningBody: "OSC NOT VERIFIED - run Sync before trusting recall or current fader state.",
      warningTitle: "OSC NOT VERIFIED",
    };
  }

  if (String(snapshot?.consoleStateConfidence ?? "unknown") === "assumed") {
    return {
      label: "ASSUMED",
      warningBody:
        "STATE ASSUMED - using last synced console state. Run Sync before trusting recall or current fader state.",
      warningTitle: "STATE ASSUMED",
    };
  }

  if (lastActionFailed) {
    const warningTitle = formatAudioActionFailureTitle(snapshot);
    return {
      label: "ACTION FAILED",
      warningBody:
        String(snapshot?.lastActionMessage ?? "The last audio action failed.") || "The last audio action failed.",
      warningTitle,
    };
  }

  return {
    label: "VERIFIED",
    warningBody: null,
    warningTitle: null,
  };
}

function selectedChannelSendLevel(channel: AudioChannelEntry | null, mixTargetId: string | null) {
  if (!channel || !mixTargetId) {
    return 0;
  }

  return typeof channel.mixLevels[mixTargetId] === "number" ? channel.mixLevels[mixTargetId] : channel.fader;
}

function meterBridgeLevelStyle(channel: AudioChannelEntry, selected: boolean): CSSProperties {
  return {
    "--audio-meter-left": `${Math.round(channel.meterLeft * 100)}%`,
    "--audio-meter-right": `${Math.round(channel.meterRight * 100)}%`,
    "--audio-meter-peak": `${Math.round(channel.peakHold * 100)}%`,
    "--audio-meter-selected": selected ? "1" : "0",
  } as CSSProperties;
}

export function AudioWorkspace({ appSnapshot, audioSnapshot, store }: AudioWorkspaceProps) {
  const channels = useMemo(() => getAudioChannels(audioSnapshot), [audioSnapshot]);
  const mixTargets = useMemo(() => getAudioMixTargets(audioSnapshot), [audioSnapshot]);
  const snapshots = useMemo(() => getAudioSnapshots(audioSnapshot), [audioSnapshot]);
  const [density, setDensity] = useState<AudioDensityMode>("overview");
  const [bankIndex, setBankIndex] = useState(0);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<AudioWorkspaceFeedback | null>(null);
  const [recentlyRecalledSnapshotId, setRecentlyRecalledSnapshotId] = useState<string | null>(null);
  const warningBandRef = useRef<HTMLDivElement | null>(null);
  const recallPulseTimerRef = useRef<number | null>(null);

  const status = describeAudioStatus(audioSnapshot);
  const selectedMixTargetId =
    typeof audioSnapshot?.selectedMixTargetId === "string"
      ? audioSnapshot.selectedMixTargetId
      : (mixTargets[0]?.id ?? null);
  const selectedMixTarget = mixTargets.find((entry) => entry.id === selectedMixTargetId) ?? mixTargets[0] ?? null;
  const selectedChannelId =
    typeof audioSnapshot?.selectedChannelId === "string" ? audioSnapshot.selectedChannelId : null;
  const selectedChannel = channels.find((entry) => entry.id === selectedChannelId) ?? null;
  const fadersPerBank = Math.max(
    1,
    Math.min(24, typeof audioSnapshot?.fadersPerBank === "number" ? audioSnapshot.fadersPerBank : 12)
  );
  const visibleStripCount = Math.min(density === "overview" ? 12 : 8, fadersPerBank);
  const totalBanks = Math.max(1, Math.ceil(channels.length / visibleStripCount));
  const clampedBankIndex = Math.min(bankIndex, totalBanks - 1);
  const bankStart = clampedBankIndex * visibleStripCount;
  const visibleChannels = channels.slice(bankStart, bankStart + visibleStripCount);
  const selectedSnapshot =
    snapshots.find((entry) => entry.id === audioSnapshot?.lastRecalledSnapshotId) ??
    snapshots.find((entry) => entry.lastRecalled) ??
    null;
  const audioActionsAllowed =
    audioSnapshot?.oscEnabled === true && String(audioSnapshot?.status ?? "not-verified") === "ready";

  useEffect(() => {
    if (bankIndex !== clampedBankIndex) {
      setBankIndex(clampedBankIndex);
    }
  }, [bankIndex, clampedBankIndex]);

  useEffect(() => {
    if (!selectedChannelId) {
      return;
    }

    const selectedIndex = channels.findIndex((entry) => entry.id === selectedChannelId);
    if (selectedIndex < 0) {
      return;
    }

    const nextBankIndex = Math.floor(selectedIndex / visibleStripCount);
    if (nextBankIndex !== clampedBankIndex) {
      setBankIndex(nextBankIndex);
    }
  }, [channels, clampedBankIndex, selectedChannelId, visibleStripCount]);

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

  const handleKeyDown = useLiveCallback((event: KeyboardEvent) => {
    if (event.defaultPrevented || isEditableTarget(event.target)) {
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "v") {
      setDensity((current) => (current === "overview" ? "precision" : "overview"));
      event.preventDefault();
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key === "[") {
      setBankIndex((current) => Math.max(0, current - 1));
      event.preventDefault();
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key === "]") {
      setBankIndex((current) => Math.min(totalBanks - 1, current + 1));
      event.preventDefault();
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.shiftKey) {
      if (/^Digit[1-8]$/.test(event.code)) {
        const snapshot = snapshots[Number(event.code.replace("Digit", "")) - 1];
        if (snapshot) {
          void performAction(`audio-snapshot-${snapshot.id}`, async () => {
            await store.recallAudioSnapshot(snapshot.id);
          });
          event.preventDefault();
        }
        return;
      }
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && /^Digit[1-8]$/.test(event.code)) {
      const channel = visibleChannels[Number(event.code.replace("Digit", "")) - 1];
      if (channel) {
        void store.updateAudioSettings({ selectedChannelId: channel.id });
        event.preventDefault();
      }
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "m") {
      if (selectedChannel) {
        void performAction(`audio-mute-${selectedChannel.id}`, async () => {
          await store.updateAudioChannel({
            channelId: selectedChannel.id,
            mute: !selectedChannel.mute,
          });
        });
        event.preventDefault();
      }
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "s") {
      if (selectedChannel) {
        void performAction(`audio-solo-${selectedChannel.id}`, async () => {
          await store.updateAudioChannel({
            channelId: selectedChannel.id,
            solo: !selectedChannel.solo,
          });
        });
        event.preventDefault();
      }
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key === "ArrowUp") {
      if (visibleChannels.length > 0) {
        const selectedIndex = visibleChannels.findIndex((entry) => entry.id === selectedChannelId);
        const nextIndex = selectedIndex <= 0 ? 0 : selectedIndex - 1;
        void store.updateAudioSettings({ selectedChannelId: visibleChannels[nextIndex]?.id ?? null });
        event.preventDefault();
      }
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key === "ArrowDown") {
      if (visibleChannels.length > 0) {
        const selectedIndex = visibleChannels.findIndex((entry) => entry.id === selectedChannelId);
        const nextIndex = selectedIndex < 0 ? 0 : Math.min(visibleChannels.length - 1, selectedIndex + 1);
        void store.updateAudioSettings({ selectedChannelId: visibleChannels[nextIndex]?.id ?? null });
        event.preventDefault();
      }
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key === "ArrowLeft") {
      if (mixTargets.length > 0 && selectedMixTarget) {
        const selectedIndex = mixTargets.findIndex((entry) => entry.id === selectedMixTarget.id);
        const nextIndex = selectedIndex <= 0 ? 0 : selectedIndex - 1;
        void store.updateAudioSettings({
          selectedMixTargetId: mixTargets[nextIndex]?.id,
        });
        event.preventDefault();
      }
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key === "ArrowRight") {
      if (mixTargets.length > 0 && selectedMixTarget) {
        const selectedIndex = mixTargets.findIndex((entry) => entry.id === selectedMixTarget.id);
        const nextIndex = Math.min(mixTargets.length - 1, selectedIndex + 1);
        void store.updateAudioSettings({
          selectedMixTargetId: mixTargets[nextIndex]?.id,
        });
        event.preventDefault();
      }
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key === "Enter") {
      if (warningBandRef.current && document.activeElement === warningBandRef.current && audioActionsAllowed) {
        void performAction("audio-sync-warning", async () => {
          await store.syncAudio();
        });
        event.preventDefault();
      }
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key === "Escape") {
      if (selectedChannelId) {
        void store.updateAudioSettings({ selectedChannelId: null });
        event.preventDefault();
      }
    }
  });

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const stripGridStyle = {
    "--audio-strip-count": String(Math.max(1, visibleChannels.length)),
  } as CSSProperties;

  if (!audioSnapshot) {
    return (
      <div className={styles.audioShell} data-testid="audio-workspace">
        <section className={`${styles.audioToolbar} ${styles.audioLoadingCard}`}>
          <div className={styles.audioLoadingBar} />
          <div className={styles.audioLoadingChipRow}>
            <div className={styles.audioLoadingChip} />
            <div className={styles.audioLoadingChip} />
            <div className={styles.audioLoadingChip} />
          </div>
        </section>
        <section className={`${styles.audioMeterBridge} ${styles.audioLoadingCard}`}>
          <div className={styles.audioLoadingBridgeTitle}>Loading audio snapshot.</div>
          <div className={styles.audioLoadingBridgeGrid}>
            {Array.from({ length: 12 }, (_, index) => (
              <div key={`audio-loading-meter-${index}`} className={styles.audioLoadingMeter} />
            ))}
          </div>
        </section>
        <div className={styles.audioMainGrid}>
          <aside className={`${styles.audioRail} ${styles.audioLoadingCard}`}>
            <div className={styles.audioLoadingRailSection} />
            <div className={styles.audioLoadingRailSection} />
          </aside>
          <section className={`${styles.audioDesk} ${styles.audioLoadingCard}`}>
            <div className={styles.audioLoadingStripGrid}>
              {Array.from({ length: 12 }, (_, index) => (
                <div key={`audio-loading-strip-${index}`} className={styles.audioLoadingStrip} />
              ))}
            </div>
          </section>
          <aside className={`${styles.audioInspectorColumn} ${styles.audioLoadingCard}`}>
            <div className={styles.audioLoadingInspectorCard} />
            <div className={styles.audioLoadingInspectorCard} />
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.audioShell} data-density={density} data-testid="audio-workspace">
      <section className={`${styles.audioToolbar} ${styles.audioCard}`}>
        <div className={styles.audioToolbarIdentity}>
          <div className={styles.audioToolbarEyebrow}>Editing mix target</div>
          <div className={styles.audioToolbarTitle}>{selectedMixTarget ? selectedMixTarget.name : "Audio"}</div>
          <div className={styles.audioToolbarSubtitle}>
            {String(appSnapshot?.summary ?? audioSnapshot.summary ?? "Audio desk active.")}
          </div>
        </div>
        <div className={styles.audioToolbarCluster}>
          <StatusBadge
            label={status.label}
            tone={mapStatusBadgeTone(
              status.label === "VERIFIED"
                ? "ok"
                : status.label === "ASSUMED"
                  ? "attention"
                  : status.label === "OFFLINE"
                    ? "error"
                    : "attention"
            )}
          />
          <span className={styles.audioToolbarMeta}>
            Last sync{" "}
            {audioSnapshot.lastConsoleSyncAt
              ? formatBackupTimestamp(String(audioSnapshot.lastConsoleSyncAt))
              : "not yet"}
          </span>
          <Button
            disabled={!audioActionsAllowed || busyAction === "audio-sync"}
            onClick={() => {
              void performAction("audio-sync", async () => {
                await store.syncAudio();
              });
            }}
            size="compact"
            variant="secondary"
          >
            Sync
          </Button>
        </div>
        <div className={styles.audioToolbarCluster}>
          <Button
            disabled={clampedBankIndex === 0}
            onClick={() => setBankIndex((current) => Math.max(0, current - 1))}
            size="compact"
            variant="ghost"
          >
            [
          </Button>
          <div className={styles.audioToolbarPill}>
            Bank {clampedBankIndex + 1} / {totalBanks}
          </div>
          <div className={styles.audioDensityToggle}>
            <button
              className={styles.audioDensityButton}
              data-active={density === "overview"}
              onClick={() => setDensity("overview")}
              type="button"
            >
              Overview
            </button>
            <button
              className={styles.audioDensityButton}
              data-active={density === "precision"}
              onClick={() => setDensity("precision")}
              type="button"
            >
              Precision
            </button>
          </div>
          <Button
            disabled={clampedBankIndex >= totalBanks - 1}
            onClick={() => setBankIndex((current) => Math.min(totalBanks - 1, current + 1))}
            size="compact"
            variant="ghost"
          >
            ]
          </Button>
        </div>
        <div className={styles.audioToolbarSnapshot}>
          <div className={styles.audioToolbarEyebrow}>Current snapshot</div>
          <div className={styles.audioToolbarSnapshotRow}>
            <span className={styles.audioToolbarSnapshotName} data-testid="audio-toolbar-current-snapshot">
              {selectedSnapshot ? `Recalled ${selectedSnapshot.name}` : "No recall yet"}
            </span>
            <Button
              disabled={!selectedSnapshot || !audioActionsAllowed || busyAction === "audio-current-snapshot"}
              onClick={() => {
                if (!selectedSnapshot) {
                  return;
                }
                void performAction("audio-current-snapshot", async () => {
                  await store.recallAudioSnapshot(selectedSnapshot.id);
                });
              }}
              size="compact"
              variant="primary"
            >
              Recall
            </Button>
          </div>
        </div>
      </section>

      {status.warningBody ? (
        <div
          className={styles.audioWarningBand}
          data-testid="audio-warning-band"
          ref={warningBandRef}
          role="status"
          tabIndex={0}
        >
          <div className={styles.audioWarningLabel}>{status.warningTitle}</div>
          <div className={styles.audioWarningBody}>{status.warningBody}</div>
          <div className={styles.audioWarningHint}>Enter to sync · V toggles density · Esc clears selection</div>
        </div>
      ) : null}

      {feedback ? (
        <div className={styles.audioFeedbackBanner} data-tone={feedback.tone} role="status">
          {feedback.message}
        </div>
      ) : null}

      <section className={`${styles.audioMeterBridge} ${styles.audioCard}`} data-testid="audio-meter-bridge">
        {channels.map((channel) => {
          const selected = channel.id === selectedChannelId;
          return (
            <button
              key={channel.id}
              className={styles.audioMeterTile}
              data-clip={channel.clip}
              data-selected={selected}
              data-testid={`audio-meter-${channel.id}`}
              onClick={() => {
                void store.updateAudioSettings({ selectedChannelId: channel.id });
              }}
              style={meterBridgeLevelStyle(channel, selected)}
              type="button"
            >
              <div className={styles.audioMeterName}>{channel.name}</div>
              <div className={styles.audioMeterShort}>{channel.shortName}</div>
              <div className={styles.audioMeterBars}>
                <span className={styles.audioMeterBar} data-side="left" />
                <span className={styles.audioMeterBar} data-side="right" />
                <span className={styles.audioMeterPeak} />
              </div>
              <div className={styles.audioMeterMeta}>
                <span>{channel.stereo ? "ST" : "MONO"}</span>
                {channel.clip ? <span>CLIP</span> : null}
              </div>
            </button>
          );
        })}
      </section>

      <div className={styles.audioMainGrid}>
        <aside className={`${styles.audioRail} ${styles.audioCard}`}>
          <div className={styles.audioRailSection}>
            <div className={styles.audioRailHeader}>
              <div>
                <div className={styles.audioRailEyebrow}>Mix targets</div>
                <div className={styles.audioRailTitle}>Submix first</div>
              </div>
            </div>
            <div className={styles.audioMixTargetList}>
              {mixTargets.map((mixTarget) => (
                <button
                  key={mixTarget.id}
                  className={styles.audioMixTargetRow}
                  data-selected={mixTarget.id === selectedMixTargetId}
                  data-testid={`audio-mix-target-${mixTarget.id}`}
                  onClick={() => {
                    void store.updateAudioSettings({ selectedMixTargetId: mixTarget.id });
                  }}
                  type="button"
                >
                  <div>
                    <div className={styles.audioMixTargetName}>{mixTarget.name}</div>
                    <div className={styles.audioMixTargetMeta}>{formatAudioRole(mixTarget.role)}</div>
                  </div>
                  <div className={styles.audioMixTargetChips}>
                    {mixTarget.id === selectedMixTargetId ? (
                      <span className={styles.audioChip} data-tone="selected">
                        Selected
                      </span>
                    ) : null}
                    {mixTarget.mute ? <span className={styles.audioChip}>Mute</span> : null}
                    {mixTarget.dim ? <span className={styles.audioChip}>Dim</span> : null}
                    {mixTarget.talkback ? <span className={styles.audioChip}>Talk</span> : null}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className={styles.audioRailSection}>
            <div className={styles.audioRailHeader}>
              <div>
                <div className={styles.audioRailEyebrow}>Snapshots</div>
                <div className={styles.audioRailTitle}>Shift + 1-8</div>
              </div>
            </div>
            <div className={styles.audioSnapshotList}>
              {snapshots.map((snapshot) => (
                <div
                  key={snapshot.id}
                  className={styles.audioSnapshotRow}
                  data-current={snapshot.lastRecalled}
                  data-flash={recentlyRecalledSnapshotId === snapshot.id}
                  data-testid={`audio-snapshot-${snapshot.id}`}
                >
                  <div>
                    <div className={styles.audioSnapshotName}>{snapshot.name}</div>
                    <div className={styles.audioSnapshotMeta}>
                      Slot {snapshot.oscIndex + 1}
                      {snapshot.lastRecalledAt ? ` · ${formatBackupTimestamp(snapshot.lastRecalledAt)}` : ""}
                    </div>
                  </div>
                  <Button
                    disabled={!audioActionsAllowed || busyAction === `audio-snapshot-${snapshot.id}`}
                    onClick={() => {
                      void performAction(`audio-snapshot-${snapshot.id}`, async () => {
                        await store.recallAudioSnapshot(snapshot.id);
                      });
                    }}
                    size="compact"
                    variant={snapshot.lastRecalled ? "primary" : "ghost"}
                  >
                    Recall
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <section className={`${styles.audioDesk} ${styles.audioCard}`}>
          <div className={styles.audioDeskHeader}>
            <div>
              <div className={styles.audioDeskTitle}>
                {density === "overview" ? "Overview density" : "Precision density"} · bank {clampedBankIndex + 1}
              </div>
              <div className={styles.audioDeskSubtitle}>
                Strips {bankStart + 1}-{Math.min(channels.length, bankStart + visibleStripCount)}
              </div>
            </div>
            <div className={styles.audioDeskHint}>1-8 select · M mute · S solo · V density</div>
          </div>
          <div className={styles.audioStripGrid} style={stripGridStyle}>
            {visibleChannels.map((channel) => {
              const selected = channel.id === selectedChannelId;
              const sendLevel = selectedChannelSendLevel(channel, selectedMixTargetId);
              return (
                <div
                  key={channel.id}
                  className={styles.audioStrip}
                  data-selected={selected}
                  data-testid={`audio-strip-${channel.id}`}
                  onClick={() => {
                    void store.updateAudioSettings({ selectedChannelId: channel.id });
                  }}
                >
                  <div className={styles.audioStripHeader}>
                    <div>
                      <div className={styles.audioStripName}>{channel.name}</div>
                      <div className={styles.audioStripMeta}>{formatAudioRole(channel.role)}</div>
                    </div>
                    <div className={styles.audioStripBadge}>{channel.stereo ? "ST" : "M"}</div>
                  </div>
                  <div className={styles.audioStripMeterWell}>
                    <div className={styles.audioStripMeterPair}>
                      <span className={styles.audioStripMeterTrack}>
                        <span
                          className={styles.audioStripMeterFill}
                          style={{ height: `${Math.round(channel.meterLeft * 100)}%` }}
                        />
                        <span
                          className={styles.audioStripMeterPeak}
                          style={{ bottom: `${Math.round(channel.peakHold * 100)}%` }}
                        />
                      </span>
                      <span className={styles.audioStripMeterTrack}>
                        <span
                          className={styles.audioStripMeterFill}
                          style={{
                            height: `${Math.round(channel.stereo ? channel.meterRight : channel.meterLevel * 0.8)}%`,
                          }}
                        />
                        <span
                          className={styles.audioStripMeterPeak}
                          style={{ bottom: `${Math.round(channel.peakHold * 100)}%` }}
                        />
                      </span>
                    </div>
                    <div className={styles.audioStripFaderValue}>{formatAudioDb(sendLevel)}</div>
                    <input
                      aria-label={`${channel.name} send level`}
                      className={styles.audioStripFader}
                      max={1}
                      min={0}
                      onChange={(event) => {
                        void store.updateAudioChannel({
                          channelId: channel.id,
                          fader: Number(event.currentTarget.value),
                          mixTargetId: selectedMixTargetId ?? undefined,
                        });
                      }}
                      step={0.01}
                      type="range"
                      value={sendLevel}
                    />
                  </div>
                  <div className={styles.audioStripActions}>
                    <button
                      className={styles.audioStripToggle}
                      data-active={channel.mute}
                      onClick={(event) => {
                        event.stopPropagation();
                        void store.updateAudioChannel({ channelId: channel.id, mute: !channel.mute });
                      }}
                      type="button"
                    >
                      Mute
                    </button>
                    <button
                      className={styles.audioStripToggle}
                      data-active={channel.solo}
                      onClick={(event) => {
                        event.stopPropagation();
                        void store.updateAudioChannel({ channelId: channel.id, solo: !channel.solo });
                      }}
                      type="button"
                    >
                      Solo
                    </button>
                  </div>
                  <div className={styles.audioStripFooter}>
                    {audioChannelSupportsGain(channel) ? (
                      <span className={styles.audioChip}>{channel.gain} dB</span>
                    ) : null}
                    {channel.pad ? <span className={styles.audioChip}>Pad</span> : null}
                    {channel.instrument ? <span className={styles.audioChip}>Inst</span> : null}
                    {channel.autoSet ? <span className={styles.audioChip}>Auto</span> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <aside className={styles.audioInspectorColumn}>
          <Surface className={`${styles.audioCard} ${styles.audioInspectorCard}`} padding="lg" tone="raised">
            <div className={styles.audioInspectorHeader}>
              <div>
                <div className={styles.audioInspectorEyebrow}>Control room</div>
                <div className={styles.audioInspectorTitle}>Monitor confidence</div>
              </div>
              <StatusBadge label="Live" tone="healthy" />
            </div>
            <div className={styles.audioControlRoomGrid}>
              <div className={styles.audioControlRoomCell}>
                <div className={styles.audioControlRoomLabel}>Monitor target</div>
                <div className={styles.audioControlRoomValue}>{selectedMixTarget?.name ?? "Main Out"}</div>
                <div className={styles.audioControlRoomMeta}>
                  {formatAudioRole(selectedMixTarget?.role ?? "main-out")}
                </div>
              </div>
              <div className={styles.audioControlRoomCell}>
                <div className={styles.audioControlRoomLabel}>Console state</div>
                <div className={styles.audioControlRoomValue}>
                  {String(audioSnapshot.consoleStateConfidence ?? "unknown")}
                </div>
                <div className={styles.audioControlRoomMeta}>
                  {audioSnapshot.lastConsoleSyncAt
                    ? `Last sync ${formatBackupTimestamp(String(audioSnapshot.lastConsoleSyncAt))}`
                    : "No sync recorded yet"}
                </div>
              </div>
              <div className={styles.audioControlRoomCell}>
                <div className={styles.audioControlRoomLabel}>Snapshot</div>
                <div className={styles.audioControlRoomValue}>{selectedSnapshot?.name ?? "No recall yet"}</div>
                <div className={styles.audioControlRoomMeta}>
                  {audioSnapshot.lastSnapshotRecallAt
                    ? `Recalled ${formatBackupTimestamp(String(audioSnapshot.lastSnapshotRecallAt))}`
                    : "Recall-first rail is idle"}
                </div>
              </div>
              <div className={styles.audioControlRoomCell}>
                <div className={styles.audioControlRoomLabel}>Last action</div>
                <div className={styles.audioControlRoomValue}>{String(audioSnapshot.lastActionStatus ?? "idle")}</div>
                <div className={styles.audioControlRoomMeta}>
                  {audioSnapshot.lastActionCode
                    ? `${String(audioSnapshot.lastActionCode)} · ${String(audioSnapshot.lastActionMessage ?? "No action recorded yet.")}`
                    : String(audioSnapshot.lastActionMessage ?? "No action recorded yet.")}
                </div>
              </div>
            </div>
            <div className={styles.audioControlRoomSection}>
              <label className={styles.audioInspectorField}>
                <span className={styles.audioInspectorFieldLabel}>Monitor level</span>
                <input
                  aria-label="Monitor level"
                  className={styles.audioInspectorRange}
                  disabled={!selectedMixTarget || !audioActionsAllowed}
                  max={1}
                  min={0}
                  onChange={(event) => {
                    if (!selectedMixTarget) {
                      return;
                    }
                    void store.updateAudioMixTarget({
                      mixTargetId: selectedMixTarget.id,
                      volume: Number(event.currentTarget.value),
                    });
                  }}
                  step={0.01}
                  type="range"
                  value={selectedMixTarget?.volume ?? 0}
                />
                <span className={styles.audioInspectorFieldValue}>{formatAudioDb(selectedMixTarget?.volume ?? 0)}</span>
              </label>
              <div className={styles.audioInspectorButtonGrid}>
                <button
                  className={styles.audioInspectorToggle}
                  data-active={selectedMixTarget?.dim === true}
                  disabled={!selectedMixTarget || !audioActionsAllowed}
                  onClick={() => {
                    if (!selectedMixTarget) {
                      return;
                    }
                    void store.updateAudioMixTarget({
                      mixTargetId: selectedMixTarget.id,
                      dim: !selectedMixTarget.dim,
                    });
                  }}
                  type="button"
                >
                  Dim
                </button>
                <button
                  className={styles.audioInspectorToggle}
                  data-active={selectedMixTarget?.mono === true}
                  disabled={!selectedMixTarget || !audioActionsAllowed}
                  onClick={() => {
                    if (!selectedMixTarget) {
                      return;
                    }
                    void store.updateAudioMixTarget({
                      mixTargetId: selectedMixTarget.id,
                      mono: !selectedMixTarget.mono,
                    });
                  }}
                  type="button"
                >
                  Mono
                </button>
                <button
                  className={styles.audioInspectorToggle}
                  data-active={selectedMixTarget?.talkback === true}
                  disabled={!selectedMixTarget || !audioActionsAllowed}
                  onClick={() => {
                    if (!selectedMixTarget) {
                      return;
                    }
                    void store.updateAudioMixTarget({
                      mixTargetId: selectedMixTarget.id,
                      talkback: !selectedMixTarget.talkback,
                    });
                  }}
                  type="button"
                >
                  Talkback
                </button>
              </div>
            </div>
          </Surface>

          <Surface className={`${styles.audioCard} ${styles.audioInspectorCard}`} padding="lg" tone="raised">
            {selectedChannel ? (
              <>
                <div className={styles.audioInspectorHeader}>
                  <div>
                    <div className={styles.audioInspectorEyebrow}>Selected channel</div>
                    <div className={styles.audioInspectorTitle}>{selectedChannel.name}</div>
                    <div className={styles.audioInspectorMeta}>
                      {formatAudioRole(selectedChannel.role)} · {selectedChannel.stereo ? "Stereo" : "Mono"}
                    </div>
                  </div>
                  <div className={styles.audioChipRow}>
                    <span className={styles.audioChip}>{selectedChannel.shortName}</span>
                    {selectedChannel.clip ? <span className={styles.audioChip}>Clip</span> : null}
                  </div>
                </div>
                <div className={styles.audioInspectorFieldGrid}>
                  <label className={styles.audioInspectorField}>
                    <span className={styles.audioInspectorFieldLabel}>Fader</span>
                    <input
                      aria-label={`${selectedChannel.name} fader`}
                      className={styles.audioInspectorRange}
                      disabled={!audioActionsAllowed}
                      max={1}
                      min={0}
                      onChange={(event) => {
                        void store.updateAudioChannel({
                          channelId: selectedChannel.id,
                          fader: Number(event.currentTarget.value),
                          mixTargetId: selectedMixTargetId ?? undefined,
                        });
                      }}
                      step={0.01}
                      type="range"
                      value={selectedChannelSendLevel(selectedChannel, selectedMixTargetId)}
                    />
                    <span className={styles.audioInspectorFieldValue}>
                      {formatAudioDb(selectedChannelSendLevel(selectedChannel, selectedMixTargetId))}
                    </span>
                  </label>
                  <label className={styles.audioInspectorField}>
                    <span className={styles.audioInspectorFieldLabel}>Gain</span>
                    <input
                      aria-label={`${selectedChannel.name} gain`}
                      className={styles.audioInspectorRange}
                      disabled={!audioChannelSupportsGain(selectedChannel) || !audioActionsAllowed}
                      max={75}
                      min={0}
                      onChange={(event) => {
                        void store.updateAudioChannel({
                          channelId: selectedChannel.id,
                          gain: Number(event.currentTarget.value),
                        });
                      }}
                      step={1}
                      type="range"
                      value={selectedChannel.gain}
                    />
                    <span className={styles.audioInspectorFieldValue}>
                      {audioChannelSupportsGain(selectedChannel) ? `${selectedChannel.gain} dB` : "n/a"}
                    </span>
                  </label>
                  <label className={styles.audioInspectorField}>
                    <span className={styles.audioInspectorFieldLabel}>Mix send</span>
                    <input
                      aria-label={`${selectedChannel.name} mix send`}
                      className={styles.audioInspectorRange}
                      disabled={!audioActionsAllowed}
                      max={1}
                      min={0}
                      onChange={(event) => {
                        void store.updateAudioChannel({
                          channelId: selectedChannel.id,
                          fader: Number(event.currentTarget.value),
                          mixTargetId: selectedMixTargetId ?? undefined,
                        });
                      }}
                      step={0.01}
                      type="range"
                      value={selectedChannelSendLevel(selectedChannel, selectedMixTargetId)}
                    />
                    <span className={styles.audioInspectorFieldValue}>{selectedMixTarget?.shortName ?? "MAIN"}</span>
                  </label>
                </div>
                <div className={styles.audioInspectorButtonGrid}>
                  <button
                    className={styles.audioInspectorToggle}
                    data-active={selectedChannel.mute}
                    disabled={!audioActionsAllowed}
                    onClick={() => {
                      void store.updateAudioChannel({
                        channelId: selectedChannel.id,
                        mute: !selectedChannel.mute,
                      });
                    }}
                    type="button"
                  >
                    Mute
                  </button>
                  <button
                    className={styles.audioInspectorToggle}
                    data-active={selectedChannel.solo}
                    disabled={!audioActionsAllowed}
                    onClick={() => {
                      void store.updateAudioChannel({
                        channelId: selectedChannel.id,
                        solo: !selectedChannel.solo,
                      });
                    }}
                    type="button"
                  >
                    Solo
                  </button>
                  {audioChannelSupportsPhantom(selectedChannel) ? (
                    <button
                      className={styles.audioInspectorToggle}
                      data-active={selectedChannel.phantom}
                      disabled={!audioActionsAllowed}
                      onClick={() => {
                        void store.updateAudioChannel({
                          channelId: selectedChannel.id,
                          phantom: !selectedChannel.phantom,
                        });
                      }}
                      type="button"
                    >
                      Phantom
                    </button>
                  ) : null}
                  {audioChannelSupportsPad(selectedChannel) ? (
                    <button
                      className={styles.audioInspectorToggle}
                      data-active={selectedChannel.pad}
                      disabled={!audioActionsAllowed}
                      onClick={() => {
                        void store.updateAudioChannel({
                          channelId: selectedChannel.id,
                          pad: !selectedChannel.pad,
                        });
                      }}
                      type="button"
                    >
                      Pad
                    </button>
                  ) : null}
                  {audioChannelSupportsInstrument(selectedChannel) ? (
                    <button
                      className={styles.audioInspectorToggle}
                      data-active={selectedChannel.instrument}
                      disabled={!audioActionsAllowed}
                      onClick={() => {
                        void store.updateAudioChannel({
                          channelId: selectedChannel.id,
                          instrument: !selectedChannel.instrument,
                        });
                      }}
                      type="button"
                    >
                      Instrument
                    </button>
                  ) : null}
                  {audioChannelSupportsPhase(selectedChannel) ? (
                    <button
                      className={styles.audioInspectorToggle}
                      data-active={selectedChannel.phase}
                      disabled={!audioActionsAllowed}
                      onClick={() => {
                        void store.updateAudioChannel({
                          channelId: selectedChannel.id,
                          phase: !selectedChannel.phase,
                        });
                      }}
                      type="button"
                    >
                      Phase
                    </button>
                  ) : null}
                  {audioChannelSupportsAutoSet(selectedChannel) ? (
                    <button
                      className={styles.audioInspectorToggle}
                      data-active={selectedChannel.autoSet}
                      disabled={!audioActionsAllowed}
                      onClick={() => {
                        void store.updateAudioChannel({
                          channelId: selectedChannel.id,
                          autoSet: !selectedChannel.autoSet,
                        });
                      }}
                      type="button"
                    >
                      Auto-set
                    </button>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <div className={styles.audioInspectorHeader}>
                  <div>
                    <div className={styles.audioInspectorEyebrow}>No selection posture</div>
                    <div className={styles.audioInspectorTitle}>Desk help</div>
                  </div>
                  <span className={styles.audioChip}>Esc</span>
                </div>
                <div className={styles.audioNoSelectionCopy}>
                  If no channel is selected, the lower right panel falls back to mix context, last recall, sync status,
                  and a small keyboard cheat sheet. That keeps the desk useful before the operator drills into a strip.
                </div>
                <div className={styles.audioChipRow}>
                  <span className={styles.audioChip}>1-8 select</span>
                  <span className={styles.audioChip}>[ ] bank</span>
                  <span className={styles.audioChip}>V density</span>
                  <span className={styles.audioChip}>M mute</span>
                  <span className={styles.audioChip}>S solo</span>
                </div>
              </>
            )}
          </Surface>
        </aside>
      </div>
    </div>
  );
}
