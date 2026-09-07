// check-operator-copy.mjs — the operator-copy gate (visual overhaul A, Slice 0;
// system §9). Scans the operator-facing strings of the front-end source for
// the words the operator never reads: "engine", "backend", "transport", "IPC",
// "snapshot" outside the Console's scene primitive, "OSC ping", and a raw
// `AUDIO_*` code as the first thing a string says.
//
//   node scripts/check-operator-copy.mjs [--root DIR] [--max N] [--json]
//
// Operator-facing strings are JSX text and string / template literals that
// read as language (they contain a space), minus module specifiers, object
// keys, class names, test ids and other identifiers. "Engine log" stays until
// the engine copy pass renames the feature (system §9); every "snapshot" under
// `frontend/app/src/app/audio/` is the Console's scene primitive and allowed. Hits are
// a ratchet in `scripts/operator-copy.ratchet.json`; the S8 copy pass takes it
// to 0.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const FORBIDDEN = [
  { word: "engine", re: /\bengine\b/i, exempt: /\bengine log\b/i },
  { word: "backend", re: /\bbackend\b/i },
  { word: "transport", re: /\btransport\b/i },
  { word: "IPC", re: /\bIPC\b/ },
  { word: "OSC ping", re: /\bOSC ping\b/i },
  { word: "snapshot", re: /\bsnapshots?\b/i, unlessUnder: "frontend/app/src/app/audio/" },
  { word: "AUDIO_* first", re: /^\s*AUDIO_[A-Z_]+/ },
];

const SKIP_ATTRIBUTES = new Set(["className", "data-testid", "id", "key", "href", "src", "type", "name", "htmlFor"]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "generated") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|stories|d)\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

// Is this string literal something the operator reads?
function isOperatorFacing(node) {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  if (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) return false;
  if (ts.isLiteralTypeNode(parent)) return false;
  if (ts.isJsxAttribute(parent) && SKIP_ATTRIBUTES.has(parent.name.getText())) return false;
  return true;
}

/** @returns {Array<{ file: string, line: number, word: string, text: string }>} */
export function scanSource(text, relativeFile) {
  const hits = [];
  const source = ts.createSourceFile(relativeFile, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const check = (raw, node) => {
    const value = raw.replace(/\s+/g, " ").trim();
    if (!value || !/\s/.test(value) || !/[a-zA-Z]/.test(value)) {
      // A single token is an identifier, not a sentence — unless it is a raw code.
      if (!/^AUDIO_[A-Z_]+$/.test(value)) return;
    }
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    for (const f of FORBIDDEN) {
      if (!f.re.test(value)) continue;
      if (f.exempt && f.exempt.test(value)) continue;
      if (f.unlessUnder && relativeFile.startsWith(f.unlessUnder)) continue;
      hits.push({ file: relativeFile, line, word: f.word, text: value.slice(0, 80) });
    }
  };
  const visit = (node) => {
    if (ts.isJsxText(node)) check(node.getText(), node);
    else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && isOperatorFacing(node))
      check(node.text, node);
    else if (ts.isTemplateExpression(node)) {
      check(node.head.text, node);
      for (const span of node.templateSpans) check(span.literal.text, span.literal);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

export function scanRoots(repoRoot, roots) {
  const hits = [];
  for (const root of roots) {
    const dir = path.join(repoRoot, root);
    for (const file of walk(dir)) {
      const relative = path.relative(repoRoot, file).split(path.sep).join("/");
      hits.push(...scanSource(readFileSync(file, "utf8"), relative));
    }
  }
  return hits;
}

export const DEFAULT_ROOTS = ["frontend/app/src", "frontend/packages/design-system/src"];

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const next = argv[i + 1];
      args[argv[i].slice(2)] = next && !next.startsWith("--") ? next : "1";
    }
  }
  const root = args.root ? path.resolve(args.root) : REPO;
  const hits = scanRoots(root, DEFAULT_ROOTS);
  if (args.json) {
    process.stdout.write(JSON.stringify(hits, null, 1) + "\n");
  } else {
    const byWord = {};
    for (const h of hits) byWord[h.word] = (byWord[h.word] || 0) + 1;
    for (const h of hits) process.stdout.write(`${h.file}:${h.line} [${h.word}] ${h.text}\n`);
    process.stdout.write(
      `\n${hits.length} operator-copy hits (${Object.entries(byWord)
        .map(([w, n]) => `${w} ${n}`)
        .join(", ")})\n`
    );
  }
  const max = args.max !== undefined ? Number(args.max) : null;
  if (max !== null && hits.length > max) {
    process.stderr.write(`operator copy: ${hits.length} hits exceed the ratchet of ${max}\n`);
    process.exit(1);
  }
}
