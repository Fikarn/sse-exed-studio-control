// Whether a qualification lane's `tauri dev` shell is still running (new pages
// program, faster checks, 2026-09-25). The lanes end it with `taskkill /T /F`,
// which ends its whole tree: npm, the Tauri CLI, vite, cargo and the shell.
// A process that died from a signal keeps `exitCode === null` for good (Node
// sets `signalCode` instead), so both are read.

/** True while the shell's leader is still running. */
export function shellStillRunning(child) {
  return child.exitCode === null && child.signalCode === null;
}
