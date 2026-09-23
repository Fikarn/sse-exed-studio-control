import assert from "node:assert/strict";
import test from "node:test";

import { carriesLaunchNumber, launchNumberOf } from "./tauri-launch-number.mjs";

const status = (engineGeneration) => ({ testBridge: { engineGeneration } });

test("a status carries a launch number only once the test bridge has one", () => {
  assert.equal(launchNumberOf(status(2)), 2);
  for (const missing of [null, undefined, "2", 1.5, Number.NaN]) {
    assert.equal(launchNumberOf(status(missing)), null, String(missing));
  }
  assert.equal(launchNumberOf(null), null);
  assert.equal(launchNumberOf({}), null);
});

test("run 35714853611: a baseline the bridge has not filled in is waited for, never counted as zero", () => {
  const listedInRecovery = status(null);
  // What the lane did: `null + 1` is 1, so a restore that restarted the engine
  // once (launch 1 -> 2) read as a restart too many.
  assert.equal(listedInRecovery.testBridge.engineGeneration + 1, 1);
  assert.equal(carriesLaunchNumber()(listedInRecovery), false);
  assert.equal(carriesLaunchNumber()(status(1)), true);
});

test("the launch after a restart is waited for past the baseline, whatever a status holds meanwhile", () => {
  const afterFirst = carriesLaunchNumber(1);
  assert.equal(afterFirst(status(null)), false);
  assert.equal(afterFirst(status(1)), false, "the previous launch's number, before the bridge caught up");
  assert.equal(afterFirst(status(2)), true);
  assert.equal(afterFirst(status(3)), true, "a skipped number is returned, so the lane's equality check fails on it");
});
