import test from "node:test";
import assert from "node:assert/strict";

import { checkAvailableDiskSpace, formatBytes } from "./disk-space.mjs";

test("formatBytes reports GiB and MiB values for release preflight output", () => {
  assert.equal(formatBytes(8 * 1024 ** 3), "8.0 GiB");
  assert.equal(formatBytes(512 * 1024 ** 2), "512 MiB");
});

test("checkAvailableDiskSpace returns an actionable failure when free space is below the requirement", () => {
  const result = checkAvailableDiskSpace({
    availableBytes: 116 * 1024 ** 2,
    label: "release build",
    requiredBytes: 8 * 1024 ** 3,
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /release build requires at least 8\.0 GiB/);
  assert.match(result.message, /current filesystem has 116 MiB free/);
  assert.match(result.message, /npm run clean:local/);
});

test("checkAvailableDiskSpace passes when free space meets the requirement", () => {
  const result = checkAvailableDiskSpace({
    availableBytes: 9 * 1024 ** 3,
    label: "release build",
    requiredBytes: 8 * 1024 ** 3,
  });

  assert.deepEqual(result, { ok: true, message: "release build has 9.0 GiB available." });
});
