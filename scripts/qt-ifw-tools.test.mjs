import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { resolveQtIfwTools } from "./qt-ifw-tools.mjs";

function touch(filePath) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, "", "utf8");
}

test("resolveQtIfwTools finds local .tools/qt-ifw installs", () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "sse-qt-ifw-local-"));
  const qtBinDir = path.join(rootDir, ".tools/qt-ifw/Tools/QtInstallerFramework/4.7/bin");
  const binaryCreator = path.join(qtBinDir, process.platform === "win32" ? "binarycreator.exe" : "binarycreator");
  const repoGen = path.join(qtBinDir, process.platform === "win32" ? "repogen.exe" : "repogen");
  touch(binaryCreator);
  touch(repoGen);

  const resolved = resolveQtIfwTools({ rootDir, env: {}, pathLookup: () => null });

  assert.equal(resolved.binaryCreator?.value, binaryCreator);
  assert.equal(resolved.binaryCreator?.source, ".tools/qt-ifw 4.7");
  assert.equal(resolved.repoGen?.value, repoGen);
  assert.equal(resolved.repoGen?.source, ".tools/qt-ifw 4.7");
  assert.equal(resolved.complete, true);
});

test("resolveQtIfwTools prefers explicit environment variables", () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "sse-qt-ifw-env-"));
  const binaryCreator = path.join(rootDir, "custom/bin/binarycreator");
  const repoGen = path.join(rootDir, "custom/bin/repogen");
  touch(binaryCreator);
  touch(repoGen);

  const resolved = resolveQtIfwTools({
    rootDir,
    env: {
      SSE_QT_IFW_BINARYCREATOR: binaryCreator,
      SSE_QT_IFW_REPOGEN: repoGen,
    },
    pathLookup: () => {
      throw new Error("PATH lookup should not run when env vars are valid");
    },
  });

  assert.deepEqual(resolved.binaryCreator, { source: "SSE_QT_IFW_BINARYCREATOR", value: binaryCreator });
  assert.deepEqual(resolved.repoGen, { source: "SSE_QT_IFW_REPOGEN", value: repoGen });
  assert.equal(resolved.complete, true);
});
