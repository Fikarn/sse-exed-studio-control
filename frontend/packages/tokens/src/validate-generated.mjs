import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const required = ["generated/tokens.css", "generated/tokens.ts"];

for (const relativePath of required) {
  if (!existsSync(path.join(packageDir, relativePath))) {
    throw new Error(`Missing generated token artifact: ${relativePath}`);
  }
}

console.log("Token generated artifacts are present.");
