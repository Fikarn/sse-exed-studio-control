import assert from "node:assert/strict";
import test from "node:test";

import { shellStillRunning } from "./tauri-shell-running.mjs";

test("the leader's exit code or signal ends it (taskkill /T /F ends the tree)", () => {
  assert.equal(shellStillRunning({ pid: 1, exitCode: null, signalCode: null }), true);
  assert.equal(shellStillRunning({ pid: 1, exitCode: 1, signalCode: null }), false);
  assert.equal(shellStillRunning({ pid: 1, exitCode: null, signalCode: "SIGTERM" }), false);
});
