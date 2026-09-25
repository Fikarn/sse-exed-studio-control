// Whether a qualification lane's `tauri dev` shell is still running (new pages
// program, faster checks, 2026-09-25). On Linux and macOS the lanes start it
// detached, so it leads its own process group — npm, the Tauri CLI, vite,
// cargo and the shell — and close it by signalling that group. Its leader's
// `exitCode` is no answer: a process that died from a signal keeps
// `exitCode === null` for good (Node sets `signalCode` instead), so the lanes
// waited out their whole five-second deadline on every close, ten times a CI
// run. The shell has gone when no process of its group is left; vite on the
// dev port may outlive npm, and the next launch needs that port.

/** True while any process of the shell's group (on Windows: the shell's
 * leader, which `taskkill /T /F` ends with its tree) is still running. */
export function shellStillRunning(child, platform = process.platform, signal = process.kill) {
  if (platform === "win32" || !child.pid) {
    return child.exitCode === null && child.signalCode === null;
  }
  try {
    signal(-child.pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") {
      return false;
    }
    if (error?.code === "EPERM") {
      return true;
    }
    throw error;
  }
}
