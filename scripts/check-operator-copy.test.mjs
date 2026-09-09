import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { DEFAULT_ROOTS, scanRoots, scanSource } from "./check-operator-copy.mjs";

// Visual overhaul A, Slice 0 — the operator-copy gate. The scanner's rules are
// unit-tested on inline sources, and the program's hit count is a ratchet
// (`scripts/operator-copy.ratchet.json`) that may only fall; the S8 copy pass
// takes it to 0.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ratchet = JSON.parse(readFileSync(path.join(repoRoot, "scripts", "operator-copy.ratchet.json"), "utf8"));

test("flags the forbidden words in JSX text and string literals", () => {
  const hits = scanSource(
    `export function X() { return <p title="The engine is restarting">Waiting for the backend transport over IPC</p>; }
     const a = "Console did not answer OSC ping";
     const b = \`Recall failed: \${code} · check the snapshot\`;`,
    "frontend/app/src/app/x.tsx"
  );
  const words = hits.map((h) => h.word).sort();
  assert.deepEqual(words, ["IPC", "OSC ping", "backend", "engine", "snapshot", "transport"]);
});

test("ignores identifiers, module specifiers, object keys and test ids", () => {
  const hits = scanSource(
    `import { engine } from "@sse/engine-client";
     const request = client.request("audio.snapshot");
     const map = { "engine transport": 1 };
     export const Y = () => <div data-testid="engine-transport" className="engine ipc">ok</div>;`,
    "frontend/app/src/app/y.tsx"
  );
  assert.deepEqual(hits, []);
});

test("keeps 'Engine log' and the Console's own snapshots", () => {
  assert.deepEqual(scanSource(`const t = "Open the Engine log";`, "frontend/app/src/app/z.ts"), []);
  assert.deepEqual(scanSource(`const t = "Recall snapshot 3";`, "frontend/app/src/app/audio/AudioWorkspace.tsx"), []);
  assert.equal(scanSource(`const t = "Recall snapshot 3";`, "frontend/app/src/app/lighting/L.tsx").length, 1);
});

test("a raw AUDIO_* code as the first thing read is a hit", () => {
  // Slice 8: a lone code counts where it is RENDERED. `const t = "AUDIO_..."`
  // on its own used to count too, which made every comparison against an
  // engine code a copy hit; the rule is about what the operator reads.
  const hits = scanSource(
    `export const A = () => <p>AUDIO_SYNC_FAILED · the desk refused the sync</p>;
     export const B = () => <p title="AUDIO_SYNC_FAILED">ok</p>;
     const u = "Failed with AUDIO_SYNC_FAILED";`,
    "frontend/app/src/a.tsx"
  );
  assert.deepEqual(
    hits.map((h) => h.word),
    ["AUDIO_* first", "AUDIO_* first"]
  );
});

test("a lone AUDIO_* code compared against is a value, not copy", () => {
  assert.deepEqual(
    scanSource(
      `const refused = String(snapshot.lastActionCode) === "AUDIO_TALKBACK_REFUSED";
       switch (code) { case "AUDIO_SYNC_FAILED": return 1; }
       const CODES = new Set(["AUDIO_SYNC_FAILED"]);`,
      "frontend/app/src/app/audio/x.tsx"
    ),
    []
  );
});

test("the Console's snapshots are named as such outside app/audio", () => {
  // The shortcut overlay and the command palette describe the Console's scene
  // primitive from outside `app/audio/`; a string that names audio or the
  // Console is talking about that primitive, and anything else is a hit.
  assert.deepEqual(
    scanSource(`const t = "Arm or apply audio snapshot recall";`, "frontend/app/src/app/shared/S.tsx"),
    []
  );
  assert.equal(scanSource(`const t = "Loading app snapshot";`, "frontend/app/src/app/shared/S.tsx").length, 1);
});

test("the program's operator-copy hits do not exceed the ratchet", () => {
  const hits = scanRoots(repoRoot, DEFAULT_ROOTS);
  assert.ok(
    hits.length <= ratchet.maxHits,
    `${hits.length} operator-copy hits exceed the ratchet of ${ratchet.maxHits}:\n` +
      hits
        .slice(0, 20)
        .map((h) => `${h.file}:${h.line} [${h.word}] ${h.text}`)
        .join("\n")
  );
});
