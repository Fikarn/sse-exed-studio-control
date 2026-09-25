import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Faster checks (new pages program, 2026-09-25): what the dev-checks workflow
// promises about when it runs and what it caches, held here so an edit cannot
// quietly undo it. Read as text: no YAML parser is a dependency of the repo.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflow = readFileSync(path.join(root, ".github", "workflows", "dev-checks.yml"), "utf8");
const toolchainFile = readFileSync(path.join(root, "native", "rust-toolchain.toml"), "utf8");
const channel = /^channel\s*=\s*"([^"]+)"/m.exec(toolchainFile)?.[1];

/** Each job's block of text, by its name under `jobs:`. */
function jobs() {
  const body = workflow.slice(workflow.indexOf("\njobs:\n") + "\njobs:\n".length);
  const blocks = {};
  let name = null;
  for (const line of body.split("\n")) {
    const header = /^ {2}([a-z0-9-]+):\s*$/.exec(line);
    if (header) {
      name = header[1];
      blocks[name] = "";
    } else if (name) {
      blocks[name] += `${line}\n`;
    }
  }
  return blocks;
}

test("one run per commit: the workflow runs on the push of every branch, and on nothing else", () => {
  const on = workflow
    .slice(workflow.indexOf("\non:\n"), workflow.indexOf("\npermissions:"))
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
  assert.match(on, /\n {2}push:\n {4}branches: \["\*\*"\]\n/);
  assert.doesNotMatch(on, /pull_request/);
  assert.doesNotMatch(on, /dependabot/, "Dependabot's branches run on their pushes too");
});

test("the ten required checks are all jobs of the workflow", () => {
  const required = [
    "format-protocol",
    "lint",
    "frontend-typecheck",
    "rust",
    "frontend-test",
    "frontend-e2e",
    "rust-coverage",
    "tauri-foundation",
    "qualification",
    "supply-chain",
  ];
  assert.deepEqual(Object.keys(jobs()).sort(), [...required].sort());
});

test("every Rust job installs the project's toolchain alone, and saves its cache from main only", () => {
  assert.ok(channel, "native/rust-toolchain.toml names a channel");
  const action = readFileSync(path.join(root, ".github", "actions", "setup-rust", "action.yml"), "utf8");
  assert.match(action, /native\/rust-toolchain\.toml/);
  assert.match(action, /rustup toolchain uninstall/);
  assert.doesNotMatch(workflow, /dtolnay\/rust-toolchain/);

  const rustJobs = Object.entries(jobs()).filter(([, block]) => block.includes("Swatinem/rust-cache"));
  assert.deepEqual(rustJobs.map(([name]) => name).sort(), [
    "qualification",
    "rust",
    "rust-coverage",
    "tauri-foundation",
  ]);
  for (const [name, block] of rustJobs) {
    assert.ok(
      block.indexOf("uses: ./.github/actions/setup-rust") > -1 &&
        block.indexOf("uses: ./.github/actions/setup-rust") < block.indexOf("Swatinem/rust-cache"),
      `${name} sets up the project's Rust before its cache`
    );
    assert.match(block, /save-if: \$\{\{ github\.ref == 'refs\/heads\/main' \}\}/, `${name} saves from main only`);
  }
  assert.match(jobs()["supply-chain"], new RegExp(`rust-version: "${channel.replaceAll(".", "\\.")}"`));
});

test("qualification starts with the others, on a cache of its own", () => {
  const block = jobs().qualification;
  assert.doesNotMatch(block, /^ {4}needs:/m);
  assert.match(block, /shared-key: qualification\n/);
});

test("the frontend tests run once, with coverage, and native:check is left to clippy", () => {
  assert.match(jobs()["frontend-test"], /- run: npm run frontend:test:coverage\n/);
  assert.doesNotMatch(jobs()["frontend-test"], /- run: npm run frontend:test\n/);
  assert.doesNotMatch(jobs().rust, /native:check/);
  assert.match(jobs().rust, /- run: npm run rust:clippy\n/);
});
