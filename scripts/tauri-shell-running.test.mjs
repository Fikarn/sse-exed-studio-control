import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { shellStillRunning } from "./tauri-shell-running.mjs";

const posix = process.platform !== "win32";

async function until(predicate, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await delay(25);
  }
  return predicate();
}

test("Windows: the leader's exit code or signal ends it (taskkill /T /F ends the tree)", () => {
  assert.equal(shellStillRunning({ pid: 1, exitCode: null, signalCode: null }, "win32"), true);
  assert.equal(shellStillRunning({ pid: 1, exitCode: 1, signalCode: null }, "win32"), false);
  assert.equal(shellStillRunning({ pid: 1, exitCode: null, signalCode: "SIGTERM" }, "win32"), false);
});

test("POSIX: the process group decides, whatever the leader's exit code says", () => {
  const leader = { pid: 4242, exitCode: null, signalCode: "SIGTERM" };
  const gone = () => {
    throw Object.assign(new Error("no such process"), { code: "ESRCH" });
  };
  const notOurs = () => {
    throw Object.assign(new Error("not permitted"), { code: "EPERM" });
  };
  const calls = [];
  assert.equal(
    shellStillRunning(leader, "linux", (pid, signal) => calls.push([pid, signal])),
    true
  );
  assert.deepEqual(calls, [[-4242, 0]], "signal 0 to the group asks without sending anything");
  assert.equal(shellStillRunning(leader, "linux", gone), false);
  assert.equal(shellStillRunning(leader, "linux", notOurs), true);
  assert.throws(() =>
    shellStillRunning(leader, "linux", () => {
      throw Object.assign(new Error("odd"), { code: "EINVAL" });
    })
  );
});

test(
  "POSIX, real processes: a group killed by SIGTERM reads as gone, though its leader's exitCode stays null",
  { skip: !posix && "process groups are POSIX" },
  async () => {
    const child = spawn("sh", ["-c", "sleep 30 & exec sleep 30"], { detached: true, stdio: "ignore" });
    await until(() => child.pid !== undefined);
    assert.equal(shellStillRunning(child), true);

    const exited = once(child, "exit");
    process.kill(-child.pid, "SIGTERM");
    await exited;
    // What the lanes polled until 2026-09-25: it never turns non-null after a signal.
    assert.equal(child.exitCode, null);
    assert.equal(child.signalCode, "SIGTERM");
    assert.equal(await until(() => !shellStillRunning(child)), true, "the whole group is gone");
  }
);

test(
  "POSIX, real processes: a member that outlives the leader keeps the shell running until the group is killed",
  { skip: !posix && "process groups are POSIX" },
  async () => {
    // The leader dies on SIGTERM; the background member ignores it, as vite
    // or the shell may outlive npm.
    const child = spawn("sh", ["-c", "(trap '' TERM; sleep 30) & exec sleep 30"], {
      detached: true,
      stdio: "ignore",
    });
    await until(() => child.pid !== undefined);
    await delay(200);

    const exited = once(child, "exit");
    process.kill(-child.pid, "SIGTERM");
    await exited;
    await delay(200);
    assert.equal(shellStillRunning(child), true, "a member of the group is still there");

    process.kill(-child.pid, "SIGKILL");
    assert.equal(await until(() => !shellStillRunning(child)), true);
  }
);
