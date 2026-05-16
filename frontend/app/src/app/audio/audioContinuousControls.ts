export type ContinuousCommit<T> = (value: T) => void;

export function createThrottledCommit<T>(commit: ContinuousCommit<T>, delayMs = 75) {
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

  return { flush, schedule };
}
