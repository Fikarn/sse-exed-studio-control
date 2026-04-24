import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");
const sourcePath = path.join(packageRoot, "src/source/tokens.json");
const cssPath = path.join(packageRoot, "src/generated/tokens.css");
const tsPath = path.join(packageRoot, "src/generated/tokens.ts");
const docsPath = path.join(packageRoot, "src/generated/token-docs.md");

const flattenTokens = (input, prefix = [], output = []) => {
  for (const [key, value] of Object.entries(input)) {
    if (value && typeof value === "object" && "$value" in value) {
      output.push({
        path: [...prefix, key],
        type: value.$type ?? "unknown",
        value: value.$value,
      });
      continue;
    }

    if (value && typeof value === "object") {
      flattenTokens(value, [...prefix, key], output);
    }
  }

  return output;
};

const renderCss = (tokens) => {
  const lines = ["@layer tokens {", "  :root {"];

  for (const token of tokens) {
    lines.push(`    --${token.path.join("-")}: ${String(token.value).replace(/"/g, "")};`);
  }

  lines.push("  }", "}");
  return `${lines.join("\n")}\n`;
};

const renderTs = (source) => {
  return `export const tokens = ${JSON.stringify(source, null, 2)} as const;\n`;
};

const renderDocs = (tokens) => {
  const rows = tokens
    .map((token) => `| \`${token.path.join(".")}\` | \`${token.type}\` | \`${String(token.value)}\` |`)
    .join("\n");

  return `# Generated Token Reference\n\n| Token | Type | Value |\n| --- | --- | --- |\n${rows}\n`;
};

const main = async () => {
  const raw = await readFile(sourcePath, "utf8");
  const source = JSON.parse(raw);
  const tokens = flattenTokens(source);

  await Promise.all([
    writeFile(cssPath, renderCss(tokens), "utf8"),
    writeFile(tsPath, renderTs(source), "utf8"),
    writeFile(docsPath, renderDocs(tokens), "utf8"),
  ]);
};

await main();
