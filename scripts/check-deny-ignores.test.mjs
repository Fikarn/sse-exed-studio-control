import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { denyIgnoreProblems, parseDenyIgnores } from "./check-deny-ignores.mjs";

// Production readiness 2026-09, Slice 12 (finding F17) — cargo-deny keeps no
// time, so this keeps it: every ignored advisory carries a "review by" date.

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(scriptsDir, "check-deny-ignores.mjs");
const TODAY = "2026-09-17";

const config = (...ignoreLines) =>
  [
    "[graph]",
    "all-features = true",
    "",
    "[advisories]",
    'yanked = "deny"',
    "ignore = [",
    ...ignoreLines,
    "]",
    "",
    "[licenses]",
    'allow = ["MIT"]',
    "",
  ].join("\n");
const glib = (reviewBy) =>
  `    { id = "RUSTSEC-2024-0429", reason = "glib 0.18 is pinned by Tauri's GTK3 stack; Linux runners only. review by ${reviewBy}" },`;

test("reads the ignored advisories with their reasons and dates", () => {
  const { entries, problems } = parseDenyIgnores(
    config(
      "    # a comment between entries is fine",
      glib("2026-12-15"),
      '    { crate = "left-pad@1.0.0", reason = "yanked for a rename, the code is unchanged. review by 2026-10-01." }'
    )
  );
  assert.deepEqual(problems, []);
  assert.deepEqual(
    entries.map(({ kind, name, reviewBy }) => [kind, name, reviewBy]),
    [
      ["id", "RUSTSEC-2024-0429", "2026-12-15"],
      ["crate", "left-pad@1.0.0", "2026-10-01"],
    ]
  );
  assert.equal(entries[0].reason, "glib 0.18 is pinned by Tauri's GTK3 stack; Linux runners only.");
  assert.deepEqual(denyIgnoreProblems(config(glib("2026-12-15")), TODAY), []);
});

test("an empty list, in either spelling, and a config without one are fine", () => {
  for (const text of [
    config(),
    "[advisories]\nignore = []\n",
    "[advisories]\nignore = [] # nothing\n",
    '[advisories]\nyanked = "deny"\n',
  ]) {
    assert.deepEqual(parseDenyIgnores(text), { entries: [], problems: [] });
  }
});

test("a passed date fails, and so does one set too far out", () => {
  assert.match(denyIgnoreProblems(config(glib("2026-09-16")), TODAY)[0], /RUSTSEC-2024-0429: expired on 2026-09-16/);
  assert.deepEqual(denyIgnoreProblems(config(glib(TODAY)), TODAY), []);
  assert.match(denyIgnoreProblems(config(glib("2027-09-17")), TODAY)[0], /at most 90 days ahead/);
  assert.match(denyIgnoreProblems(config(glib("2026-02-31")), "2026-02-01")[0], /not a YYYY-MM-DD calendar day/);
});

test("an entry the reader cannot read is a failure, never a skipped line", () => {
  const unreadable = [
    '    "RUSTSEC-2024-0429",',
    '    { id = "RUSTSEC-2024-0429" },',
    '    { id = "RUSTSEC-2024-0429", reason = "split',
    '    { reason = "glib 0.18 is pinned by the GTK3 stack. review by 2026-12-15", id = "RUSTSEC-2024-0429" },',
  ];
  for (const line of unreadable) {
    const { entries, problems } = parseDenyIgnores(config(line));
    assert.deepEqual(entries, [], line);
    assert.match(problems[0], /line 7: not readable as/, line);
  }

  assert.match(
    parseDenyIgnores(
      config('    { id = "RUSTSEC-2024-0429", reason = "glib 0.18 is pinned by the GTK3 stack; Linux only." },')
    ).problems[0],
    /must end with "review by YYYY-MM-DD"/
  );
  assert.match(
    parseDenyIgnores(config('    { id = "RUSTSEC-2024-0429", reason = "fine. review by 2026-12-15" },')).problems[0],
    /must say why the advisory is acceptable here/
  );
  assert.match(parseDenyIgnores('[advisories]\nignore = ["RUSTSEC-2024-0429"]\n').problems[0], /one entry per line/);
  assert.match(parseDenyIgnores("[advisories]\nignore = [\n" + glib("2026-12-15")).problems[0], /never closed/);
});

test("only the advisories section is read", () => {
  const text = [
    "[bans]",
    "skip = [",
    '    { crate = "syn@1.0.109", reason = "no date here, and none needed" },',
    "]",
    "",
    "[advisories]",
    "ignore = []",
    "",
  ].join("\n");
  assert.deepEqual(parseDenyIgnores(text), { entries: [], problems: [] });
});

test("the committed deny.toml is written the way the reader needs", () => {
  const committed = readFileSync(path.join(scriptsDir, "..", "native", "deny.toml"), "utf8");
  const { entries, problems } = parseDenyIgnores(committed);
  // How it is written only. Whether a date has passed is the `supply-chain`
  // job's to say — a date must not turn `scripts:test` red by itself.
  assert.deepEqual(problems, []);
  for (const entry of entries) assert.match(entry.reviewBy, /^\d{4}-\d{2}-\d{2}$/);
});

test("the command exits 1 on a passed date, 0 on a current one, 2 without a config", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "sse-deny-ignores-"));
  const run = (text) => {
    const file = path.join(dir, "deny.toml");
    writeFileSync(file, text, "utf8");
    return spawnSync(process.execPath, [scriptPath, `--config=${file}`], { encoding: "utf8" });
  };

  const passed = run(config(glib("2020-01-01")));
  assert.equal(passed.status, 1);
  assert.match(passed.stderr, /deny\.toml line 7: RUSTSEC-2024-0429: expired on 2020-01-01/);
  assert.match(passed.stderr, /Look at the advisory again/);

  const none = run(config());
  assert.equal(none.status, 0, none.stderr);
  assert.match(none.stdout, /no advisory is ignored/);

  const missing = spawnSync(process.execPath, [scriptPath, `--config=${path.join(dir, "absent.toml")}`], {
    encoding: "utf8",
  });
  assert.equal(missing.status, 2);
});
