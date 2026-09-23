// 2026-09 production readiness, Slice 9 (finding F10): the test-only fault the
// `?crash=<workspace>` parameter arms (fixture double only — see
// `createShellEnvironment`, which also hands Playwright the way to disarm it).
// It throws while it renders until it is disarmed, which stands for the fault
// going away before the operator presses "Reload this area".

let disarmed = false;

export function disarmWorkspaceCrash() {
  disarmed = true;
}

export function WorkspaceCrashProbe({ area }: { area: string }) {
  if (!disarmed) {
    throw new Error(`Test fault: the ${area} workspace was told to fail while rendering.`);
  }
  return null;
}
