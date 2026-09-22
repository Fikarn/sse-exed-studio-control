// The engine's launch number as a qualification lane sees it (2026-09-22,
// after run 35714853611). The shell counts engine launches (`generation` in
// `engine_summary`), and the test bridge copies that count into the status
// file only after the fact: it fetches `engine_summary` after each change of
// lifecycle or last event, and the number is `null` until the first fetch
// returns (`frontend/app/src/app/tauriShellTestBridge.ts`). So a status can
// carry no number yet, or the previous launch's. A lane that counts launches
// starts from a number it waited for and waits for the next one; it never
// does arithmetic on whatever one status happened to hold.

/** The launch number a status carries, or `null` while it carries none. */
export function launchNumberOf(status) {
  const generation = status?.testBridge?.engineGeneration;
  return Number.isInteger(generation) ? generation : null;
}

/**
 * A `waitForStatus` predicate: true once the status carries a launch number,
 * and a number past `after` when `after` is given.
 */
export function carriesLaunchNumber(after = null) {
  return (status) => {
    const launch = launchNumberOf(status);
    return launch !== null && (after === null || launch > after);
  };
}
