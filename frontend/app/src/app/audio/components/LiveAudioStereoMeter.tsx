import { useChannelMeterSample, useMixTargetMeterSample } from "@sse/engine-client";

import { useMeterStore } from "./meterStoreContext";
import { AudioStereoMeter } from "./AudioStereoMeter";

interface CommonProps {
  showPeakReadout?: boolean;
  showReadout?: boolean;
  showScale?: boolean;
}

interface ChannelProps extends CommonProps {
  channelId: string;
  mixTargetId?: undefined;
}

interface MixTargetProps extends CommonProps {
  mixTargetId: string;
  channelId?: undefined;
}

export function LiveAudioStereoMeter(props: ChannelProps | MixTargetProps) {
  const store = useMeterStore();
  const channelSample = useChannelMeterSample(store, props.channelId ?? "");
  const mixTargetSample = useMixTargetMeterSample(store, props.mixTargetId ?? "");
  const sample = props.channelId ? channelSample : mixTargetSample;

  return (
    <AudioStereoMeter
      clip={sample.clip}
      left={sample.l}
      right={sample.r}
      peakLeft={sample.peakL}
      peakRight={sample.peakR}
      showPeakReadout={props.showPeakReadout}
      showReadout={props.showReadout}
      showScale={props.showScale}
    />
  );
}
