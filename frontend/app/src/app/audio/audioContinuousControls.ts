import { AUDIO_THROTTLE_FADER_MS } from "./audioConstants";

export type ContinuousCommit<T> = (value: T) => void;

export function createThrottledCommit<T>(commit: ContinuousCommit<T>, delayMs = AUDIO_THROTTLE_FADER_MS) {
  let timer: number | null = null;
  let latest: T | null = null;

  const flush = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    if (latest !== null) {
      const value = latest;
      latest = null;
      commit(value);
    }
  };

  const schedule = (value: T) => {
    latest = value;
    if (timer === null) {
      timer = window.setTimeout(flush, delayMs);
    }
  };

  const cancel = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    latest = null;
  };

  return { cancel, flush, schedule };
}
