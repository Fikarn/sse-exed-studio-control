import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(packageDir, "fixtures.json");
const fixtures = JSON.parse(readFileSync(fixturePath, "utf8"));
const required = [
  "setup-required",
  "setup-ready",
  "lighting-populated",
  "audio-populated",
  "planning-empty",
  "planning-populated",
];

for (const key of required) {
  if (!(key in fixtures)) {
    throw new Error(`Missing required fixture scenario: ${key}`);
  }
}

console.log(`Validated ${Object.keys(fixtures).length} fixture scenarios.`);
