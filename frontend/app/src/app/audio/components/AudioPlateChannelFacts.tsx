import { Readouts } from "@sse/design-system";

import { formatAudioDb } from "../audioFormatting";
import type { SelectedAudioChannel } from "./inspector/audioInspectorHelpers";
import type { AudioMixTargetEntry } from "../../shellData";

// Visual overhaul A, Slice 4c (polish §the plate's Channel section): the flags
// the desk reports but the operator could not see anywhere — whether the pair
// is linked, whether the send is pre- or post-fader, and where the compressor
// and the gate stand. Read-only: every one of them is the engine's word.

function processorText(processor: { enabled: boolean; thresholdDb: number; ratio: number }, withRatio: boolean) {
  const state = processor.enabled ? "on" : "off";
  const threshold = `${processor.thresholdDb.toFixed(0)} dB`;
  return withRatio ? `${state} · ${threshold} · ${processor.ratio.toFixed(1)}:1` : `${state} · ${threshold}`;
}

export function AudioPlateChannelFacts({
  selectedChannel,
  selectedMixTarget,
}: {
  selectedChannel: SelectedAudioChannel;
  selectedMixTarget: AudioMixTargetEntry | null;
}) {
  const sendMode = selectedMixTarget ? selectedChannel.sendModes[selectedMixTarget.id] : undefined;
  return (
    <Readouts
      data-testid="audio-plate-channel-facts"
      rows={[
        {
          id: "stereo-link",
          label: "Stereo link",
          value: selectedChannel.stereo ? (sendMode?.linkStereo === false ? "split" : "linked") : "mono source",
        },
        {
          id: "sends",
          label: "Sends",
          value: sendMode?.preFader ? "pre-fader" : "post-fader",
        },
        {
          id: "send-level",
          label: `Send to ${selectedMixTarget?.name ?? "output"}`,
          value: selectedMixTarget
            ? formatAudioDb(selectedChannel.mixLevels[selectedMixTarget.id] ?? 0)
            : "no output selected",
        },
        {
          id: "compressor",
          label: "Compressor",
          value: processorText(selectedChannel.dynamics.compressor, true),
        },
        {
          id: "gate",
          label: "Gate",
          value: processorText(selectedChannel.dynamics.gate, false),
        },
      ]}
    />
  );
}
