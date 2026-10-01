import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ndiLibraryRefusal, readNdiPin, sdkLibraryPath } from "./ndi-library.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the pin names NDI's library, its version and its SHA-256", () => {
  const pin = readNdiPin(repoRoot);
  assert.equal(pin.file, "Processing.NDI.Lib.x64.dll");
  assert.match(pin.sha256, /^[0-9a-f]{64}$/);
  assert.match(pin.version, /^6\./);
});

test("the SDK's library is found in the SDK's folder, by the installer's variable or its default", () => {
  const pin = { file: "Processing.NDI.Lib.x64.dll", version: "6.3.2.0", sha256: "0".repeat(64) };
  assert.equal(
    sdkLibraryPath({ NDI_SDK_DIR: "D:\\NDI SDK" }, pin),
    "D:\\NDI SDK\\Bin\\x64\\Processing.NDI.Lib.x64.dll"
  );
  assert.equal(
    sdkLibraryPath({ ProgramFiles: "C:\\Program Files" }, pin),
    "C:\\Program Files\\NDI\\NDI 6 SDK\\Bin\\x64\\Processing.NDI.Lib.x64.dll"
  );
  assert.equal(sdkLibraryPath({}, pin), "C:\\Program Files\\NDI\\NDI 6 SDK\\Bin\\x64\\Processing.NDI.Lib.x64.dll");
});

test("only a file of the pinned name and hash is taken", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "sse-ndi-pin-"));
  try {
    const bytes = Buffer.from("a stand-in for the library");
    const library = path.join(dir, "Processing.NDI.Lib.x64.dll");
    writeFileSync(library, bytes);
    const pin = {
      file: "Processing.NDI.Lib.x64.dll",
      version: "6.3.2.0",
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    assert.equal(ndiLibraryRefusal(library, pin), null);

    assert.match(ndiLibraryRefusal(library, { ...pin, sha256: "f".repeat(64) }) ?? "", /is not the pinned NDI library/);
    assert.match(ndiLibraryRefusal(path.join(dir, "missing", pin.file), pin) ?? "", /install the NDI SDK 6\.3\.2\.0/);
    const other = path.join(dir, "other.dll");
    writeFileSync(other, bytes);
    assert.match(ndiLibraryRefusal(other, pin) ?? "", /is not NDI's library/);
    assert.match(ndiLibraryRefusal(dir + path.sep, { ...pin, file: path.basename(dir) }) ?? "", /is not a file/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
