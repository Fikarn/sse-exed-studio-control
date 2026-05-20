import styles from "../AudioInspector.module.css";
import { deriveSendStatusLabel, formatAudioDb } from "../../audioFormatting";
import { selectedChannelSendLevel, type AudioWorkspaceViewModel } from "../../audioViewModel";
import { AudioSliderControl } from "../AudioSliderControl";
import type { AudioChannelUpdate, AudioSendModeUpdate, SelectedAudioChannel } from "./audioInspectorHelpers";

interface AudioInspectorSendsTabProps {
  clearDraftValueLater: (key: string, delayMs?: number) => void;
  commitChannelContinuous: (request: AudioChannelUpdate) => void;
  getDraftValue: (key: string, fallback: number) => number;
  onSelectMixTarget: (mixTargetId: string) => void;
  onUpdateChannelSendMode: (request: AudioSendModeUpdate) => void;
  selectedChannel: SelectedAudioChannel | null;
  setDraftValue: (key: string, value: number) => void;
  viewModel: AudioWorkspaceViewModel;
}

/**
 * Sends tab body. Renders one send card per mix target with destination
 * select, level slider, value readout, and pre-fader/mute/link/solo mode
 * toggles. Parent owns the `activeTab === "sends"` gate and provides the
 * `<section role="tabpanel">` wrapper so the tab strip's ARIA wiring stays
 * single-sourced in the router.
 */
export function AudioInspectorSendsTab({
  clearDraftValueLater,
  commitChannelContinuous,
  getDraftValue,
  onSelectMixTarget,
  onUpdateChannelSendMode,
  selectedChannel,
  setDraftValue,
  viewModel,
}: AudioInspectorSendsTabProps) {
  if (!selectedChannel) {
    return (
      <div className={styles.emptyInspector}>
        <h3>No channel selected</h3>
        <p>Send levels appear here after a source strip is selected.</p>
      </div>
    );
  }

  return (
    <div className={styles.sendStack}>
      {viewModel.mixTargets.map((mixTarget) => {
        const sendDraftKey = `channel:${selectedChannel.id}:send:${mixTarget.id}`;
        const value = getDraftValue(sendDraftKey, selectedChannelSendLevel(selectedChannel, mixTarget.id));
        const sendMode = selectedChannel.sendModes[mixTarget.id] ?? {
          linkStereo: true,
          mute: false,
          preFader: false,
          solo: false,
        };
        const sendMuted = selectedChannel.mute || sendMode.mute;
        const noSend = value <= 0.01;
        const sendState = sendMuted ? "muted" : noSend ? "none" : "sending";
        const isActive = mixTarget.id === viewModel.selectedMixTargetId;
        const sendStatus = deriveSendStatusLabel({ isActive, noSend, sendMuted });
        return (
          <div
            className={styles.sendCardFull}
            data-active={isActive}
            data-send-state={sendState}
            data-testid={`audio-send-destination-${mixTarget.id}`}
            key={mixTarget.id}
          >
            <div className={styles.sendCardHead}>
              <button
                aria-pressed={isActive}
                className={styles.sendTargetButton}
                data-active={isActive}
                onClick={(event) => {
                  event.preventDefault();
                  onSelectMixTarget(mixTarget.id);
                }}
                type="button"
              >
                {mixTarget.name}
              </button>
              <span className={styles.sendCardTag}>{sendStatus}</span>
            </div>
            <div className={styles.sendCardRoute}>
              <strong>{selectedChannel.name}</strong>
              <span>→</span>
              <strong>{mixTarget.name}</strong>
            </div>
            <AudioSliderControl
              disabled={!viewModel.actionsAllowed}
              label={`${selectedChannel.name} send to ${mixTarget.name}`}
              onCommit={(nextValue) => {
                setDraftValue(sendDraftKey, nextValue);
                commitChannelContinuous({
                  channelId: selectedChannel.id,
                  fader: nextValue,
                  mixTargetId: mixTarget.id,
                });
                clearDraftValueLater(sendDraftKey);
              }}
              onPreview={(nextValue) => setDraftValue(sendDraftKey, nextValue)}
              orientation="horizontal"
              snapUnity
              value={value}
              valueText={formatAudioDb(value)}
            />
            <strong className={styles.sendCardValue}>{formatAudioDb(value)}</strong>
            <div className={styles.sendModeRow}>
              <button
                aria-pressed={sendMode.preFader}
                data-active={sendMode.preFader}
                disabled={!viewModel.actionsAllowed}
                onClick={() =>
                  onUpdateChannelSendMode({
                    channelId: selectedChannel.id,
                    mixTargetId: mixTarget.id,
                    preFader: !sendMode.preFader,
                  })
                }
                type="button"
              >
                Pre fader
              </button>
              <button
                aria-pressed={sendMode.mute}
                data-active={sendMode.mute}
                disabled={!viewModel.actionsAllowed}
                onClick={() =>
                  onUpdateChannelSendMode({
                    channelId: selectedChannel.id,
                    mixTargetId: mixTarget.id,
                    mute: !sendMode.mute,
                  })
                }
                type="button"
              >
                Mute send
              </button>
              <button
                aria-pressed={sendMode.linkStereo}
                data-active={sendMode.linkStereo}
                disabled={!viewModel.actionsAllowed}
                onClick={() =>
                  onUpdateChannelSendMode({
                    channelId: selectedChannel.id,
                    linkStereo: !sendMode.linkStereo,
                    mixTargetId: mixTarget.id,
                  })
                }
                type="button"
              >
                Link L+R
              </button>
              <button
                aria-pressed={sendMode.solo}
                data-active={sendMode.solo}
                disabled={!viewModel.actionsAllowed}
                onClick={() =>
                  onUpdateChannelSendMode({
                    channelId: selectedChannel.id,
                    mixTargetId: mixTarget.id,
                    solo: !sendMode.solo,
                  })
                }
                type="button"
              >
                Solo send
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
