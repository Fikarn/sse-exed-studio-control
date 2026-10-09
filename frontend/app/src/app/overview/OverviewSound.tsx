import type { CSSProperties } from "react";

import { Door, Key, Meter, Room } from "@sse/design-system";

import { audioDeskLockReason, audioWayOut } from "../audio/audioLatches";
import { dbfsToMeterPercent, formatAudioDb } from "../audio/audioFormatting";
import { selectedChannelSendLevel, type AudioWorkspaceViewModel } from "../audio/audioViewModel";
import { METER_PEAK_HOLD_MS } from "../audio/audioConstants";
import { METER_SCALE_MARKS } from "../audio/components/AudioStereoMeter";
import { soundInputs, type OverviewAlert } from "./overviewModel";
import styles from "./OverviewSound.module.css";

// THE SOUND (listen, umber), in the plate: Main Out first, as one raised row
// with its level, DIM and MONO as words and its M, its meter under it; then
// the inputs TotalMix shows (D45), each with its name, its level into Main
// Out and its M, over one meter bridge on the Console's own scale (−60 to 0,
// the −18 line). The Console's canvas paints the meters (`[data-mini-meter-*]`,
// mounted by the page); while the Console is not sure of the desk they are
// gated, as on the Console: they stand still and say why, and the levels
// carry the doubt keyline. Phones 1 and 2 stand on the floor.

export interface OverviewSoundProps {
  alert: OverviewAlert | null;
  audio: AudioWorkspaceViewModel | null;
  onMute: (channelId: string, mute: boolean) => void;
  onMuteOutput: (mixTargetId: string, mute: boolean) => void;
  onOpen: () => void;
}

/** `−10.0` and its unit apart, as the Console prints a level beside its unit. */
function level(value: number) {
  return formatAudioDb(value).replace(/ dB$/, "");
}

/** What the gated meters say, from the Console's own way out. */
function gateWords(label: string) {
  const way = audioWayOut(label);
  if (way === "sync" || way === "failed") return "The meters wait for a Sync from TotalMix.";
  if (way === "setup") return "The meters wait: OSC control is off.";
  return "The meters wait for the audio probe.";
}

export function OverviewSound({ alert, audio, onMute, onMuteOutput, onOpen }: OverviewSoundProps) {
  const mainOut = audio?.mixTargets.find((target) => target.role === "main-out") ?? null;
  const phones = audio?.mixTargets.filter((target) => target.role === "phones-a" || target.role === "phones-b") ?? [];
  const inputs = audio ? soundInputs(audio.channels) : [];
  const gated = audio?.meterSimulationState === "gated";
  const doubt = audio?.valuesInDoubt ?? false;
  const locked = audio ? !audio.actionsAllowed : true;
  const reason = audio ? audioDeskLockReason(audio.status) : "The Console is not read yet.";

  return (
    <div className={styles.plate}>
      <Room
        tone="umber"
        name="The sound"
        job="listen"
        alert={alert}
        floor={48}
        floorContent={
          <div className={styles.floorLine} data-testid="overview-phones">
            {phones.map((target) => (
              <span key={target.id}>
                {target.name} <b>{formatAudioDb(target.volume)}</b>
              </span>
            ))}
            <span>peak hold {(METER_PEAK_HOLD_MS / 1000).toFixed(1)} s</span>
          </div>
        }
        className={styles.room}
        testId="overview-room-sound"
        actions={<Door page="Audio" testId="overview-door-audio" onClick={onOpen} />}
      >
        <div className={styles.body}>
          {!audio || !mainOut ? (
            <p className={styles.waiting}>Reading the Console…</p>
          ) : (
            <>
              <div className={styles.mainRow} data-testid="overview-main-out">
                <span className={styles.kick}>Main Out</span>
                {mainOut.mute ? (
                  <span className={styles.muted}>Muted</span>
                ) : (
                  <span className={styles.mainLevel} data-doubt={doubt ? "" : undefined}>
                    {level(mainOut.volume)}
                    <span className={styles.unit}>dB</span>
                  </span>
                )}
                <span className={styles.mainFacts}>
                  dim {mainOut.dim ? "on" : "off"} · mono {mainOut.mono ? "on" : "off"}
                </span>
                <span className={styles.spacer} />
                <Key
                  mode="toggle"
                  cap="M"
                  engaged={mainOut.mute}
                  locked={locked}
                  reason={reason}
                  take
                  className={styles.mainMute}
                  aria-label={`Mute ${mainOut.name}`}
                  testId="overview-mute-main"
                  onClick={() => onMuteOutput(mainOut.id, !mainOut.mute)}
                />
              </div>
              <div className={styles.mainMeter}>
                <Meter
                  orientation="horizontal"
                  level={0}
                  levelRight={0}
                  empty
                  meterId={mainOut.id}
                  meterKind="mixTarget"
                  label={`${mainOut.name} meter`}
                />
              </div>

              <div className={styles.head}>
                <span className={styles.headTitle}>Inputs</span>
                <span className={styles.headDetail}>as TotalMix shows them</span>
              </div>
              <div className={styles.strips} style={{ "--strips": inputs.length } as CSSProperties}>
                {inputs.map((channel) => (
                  <div key={channel.id} className={styles.strip} data-testid={`overview-strip-${channel.id}`}>
                    <span className={styles.stripName}>{channel.name}</span>
                    {channel.mute ? (
                      <span className={styles.stripMuted}>Muted</span>
                    ) : (
                      <span className={styles.stripLevel} data-doubt={doubt ? "" : undefined}>
                        {level(selectedChannelSendLevel(channel, mainOut.id))}
                        <span className={styles.unit}>dB</span>
                      </span>
                    )}
                    <Key
                      mode="toggle"
                      cap="M"
                      engaged={channel.mute}
                      locked={locked}
                      reason={reason}
                      take
                      className={styles.stripMute}
                      aria-label={`Mute ${channel.name}`}
                      testId={`overview-mute-${channel.id}`}
                      onClick={() => onMute(channel.id, !channel.mute)}
                    />
                  </div>
                ))}
              </div>

              <div
                className={styles.bridge}
                data-well=""
                data-testid="overview-meters"
                data-gated={gated ? "" : undefined}
              >
                <div className={styles.scale} aria-hidden="true">
                  {METER_SCALE_MARKS.map((mark) => (
                    <span
                      key={mark.dbfs}
                      className={styles.mark}
                      data-nominal={mark.dbfs === -18 ? "" : undefined}
                      style={{ "--at": `${100 - dbfsToMeterPercent(mark.dbfs)}%` } as CSSProperties}
                    >
                      <span className={styles.markLabel}>{mark.label}</span>
                    </span>
                  ))}
                </div>
                <div className={styles.slots} style={{ "--strips": inputs.length } as CSSProperties}>
                  {inputs.map((channel) => (
                    <span key={channel.id} className={styles.slotColumn}>
                      <span
                        className={styles.slot}
                        data-mini-meter-kind="channel"
                        data-mini-meter-id={channel.id}
                        data-mini-meter-side="left"
                        data-mini-meter-orientation="vertical"
                        data-meter-track="left"
                        data-testid={`overview-meter-${channel.id}`}
                      />
                    </span>
                  ))}
                </div>
                {gated ? (
                  <p className={styles.gate} data-testid="overview-meters-gated">
                    {gateWords(audio.status.label)}
                  </p>
                ) : null}
              </div>
            </>
          )}
        </div>
      </Room>
    </div>
  );
}
