import { useEffect } from "react";

import styles from "./AudioSignalCanvas.module.css";
import { AudioTieredMixer, type AudioTieredMixerProps } from "./AudioTieredMixer";

// The bay (visual overhaul, the Console): the tiers and nothing over them. A
// latched state is in the cluster's latch slot, the state and its way out in
// the state display, and what the last action said at the cluster's foot, so
// nothing ever shrinks the bay or moves a fader.
export function AudioSignalCanvas(props: AudioTieredMixerProps) {
  useEffect(() => {
    if (!window.__SSE_TEST_RENDER_COUNTS__) return;
    window.__SSE_TEST_RENDER_COUNTS__.audioSignalCanvas =
      (window.__SSE_TEST_RENDER_COUNTS__.audioSignalCanvas ?? 0) + 1;
  });

  return (
    <section className={styles.signalCanvas} data-testid="audio-signal-canvas">
      <AudioTieredMixer {...props} />
    </section>
  );
}
