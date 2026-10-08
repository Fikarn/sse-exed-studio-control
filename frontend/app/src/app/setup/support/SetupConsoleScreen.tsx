import { Key } from "@sse/design-system";
import type { AudioSnapshot } from "@sse/engine-client";

import { getAudioChannels, type AudioChannelEntry } from "../../shellData";
import { SetupRecordRow, SetupRecordSection, SetupStepScreen } from "../components/SetupStepScreen";
import type { SetupPilot } from "../useSetupPilot";
import styles from "./SetupConsoleScreen.module.css";

// Setup / Support's fourth screen (2026-10-08, the walk's finding 3): what
// Studio Control needs for the desk beyond the runner's audio probe. TotalMix's
// Channel Layout hides the channels nobody uses (Line 1 to 8 and the playback
// pairs 9/10 and 11/12 since 2026-09-03), and a write to a hidden channel is
// dropped unanswered, so a press on one of those strips left the Console
// reading ASSUMED. TotalMix's dump does not say which channels it hides, so the
// owner names them here: the hardware link saves the list as a setting, the
// Console locks those strips with the sentence, and the deck's AUDIO banks
// leave them out. The list is empty on new saved data; TotalMix's layout
// changes rarely. Nothing on this screen is sent to TotalMix.

/** The strips as the screen groups them: the desk's inputs, then its playback pairs. */
function stripGroups(channels: AudioChannelEntry[]) {
  return [
    { id: "inputs", label: "Inputs", channels: channels.filter((channel) => channel.role !== "playback-pair") },
    { id: "playback", label: "Playback", channels: channels.filter((channel) => channel.role === "playback-pair") },
  ];
}

export interface SetupConsoleScreenProps {
  editor: SetupPilot;
  audioSnapshot: AudioSnapshot | null;
}

export function SetupConsoleScreen({ editor, audioSnapshot }: SetupConsoleScreenProps) {
  const { store } = editor.props;
  const { busyAction } = editor.state;
  const { performAction } = editor.actions;
  const busy = busyAction !== null;
  const channels = getAudioChannels(audioSnapshot);
  const hidden = channels.filter((channel) => channel.hidden);

  // A press sends the whole list, as the hardware link takes it: the strip
  // put on or taken off, and every other strip as it stands.
  const toggle = (channel: AudioChannelEntry) =>
    void performAction(`console-hidden-${channel.id}`, async () => {
      const next = channels
        .filter((entry) => (entry.id === channel.id ? !channel.hidden : entry.hidden))
        .map((entry) => entry.id);
      await store.updateAudioSettings({ hiddenChannelIds: next });
      return {
        message: channel.hidden
          ? `${channel.name} is off the list: the Console offers it again, and the deck shows it.`
          : `${channel.name} is on the list: locked on the Console and left off the deck until TotalMix shows it again.`,
        tone: "ok" as const,
      };
    });

  return (
    <SetupStepScreen
      title="Console setup"
      lead="What Studio Control needs for the desk beyond the audio probe: which strips TotalMix hides. TotalMix drops a change to a hidden channel without a word, so the Console locks a strip on this list and the deck leaves it out. Nothing here is sent to TotalMix."
      rules={[
        {
          id: "layout",
          text: "TotalMix's Channel Layout decides what is hidden; this list only tells Studio Control. Press a strip when TotalMix hides its channel, and again when it shows it.",
        },
      ]}
      facts={
        audioSnapshot ? (
          <div className={styles.lists} data-testid="setup-console-strips">
            {stripGroups(channels).map((group) => (
              <section
                key={group.id}
                className={styles.group}
                aria-label={group.label}
                data-testid={`setup-console-${group.id}`}
              >
                <span className={styles.groupLabel}>{group.label}</span>
                <div className={styles.strips}>
                  {group.channels.map((channel) => (
                    <Key
                      key={channel.id}
                      mode="toggle"
                      engaged={channel.hidden}
                      disabled={busy}
                      aria-pressed={channel.hidden}
                      title={
                        channel.hidden
                          ? `TotalMix hides ${channel.name}: press to take it off the list.`
                          : `Press when TotalMix hides ${channel.name}.`
                      }
                      testId={`setup-console-strip-${channel.id}`}
                      onClick={() => toggle(channel)}
                    >
                      {channel.name}
                    </Key>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <p className={styles.waiting} data-testid="setup-console-waiting">
            Reading the Console…
          </p>
        )
      }
      note="A press saves the list at once and sends nothing to TotalMix. A lit strip is on the list."
      record={
        <>
          <SetupRecordSection title="TotalMix" testId="setup-console-record-totalmix">
            <SetupRecordRow
              label="Address"
              value={
                audioSnapshot
                  ? `${audioSnapshot.sendHost}:${audioSnapshot.sendPort} · receive ${audioSnapshot.receivePort}`
                  : "—"
              }
              testId="setup-console-address"
            />
            <SetupRecordRow label="Set in" value="the runner's Probe hardware step" />
          </SetupRecordSection>
          <SetupRecordSection
            title="Strips TotalMix hides"
            detail={hidden.length === 0 ? undefined : hidden.length === 1 ? "1 strip" : `${hidden.length} strips`}
            testId="setup-console-record-hidden"
          >
            {hidden.length > 0 ? (
              hidden.map((channel) => (
                <SetupRecordRow
                  key={channel.id}
                  label={channel.name}
                  value="locked on the Console · off the deck"
                  testId={`setup-console-hidden-${channel.id}`}
                />
              ))
            ) : (
              <p className={styles.empty} data-testid="setup-console-hidden-none">
                None: the Console offers every strip, and the deck shows them all.
              </p>
            )}
          </SetupRecordSection>
        </>
      }
      testId="setup-screen-console"
    />
  );
}
