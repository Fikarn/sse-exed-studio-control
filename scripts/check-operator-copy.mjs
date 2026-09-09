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
// the engine copy pass renames the feature (system §9); a "snapshot" that names
// audio or the Console is that scene primitive and allowed.
//
// Slice 8 took the program to 0 and tightened the gate to the rule it enforces:
// the live client (`engine-client/src/store`) is scanned, because its
// startup-failure sentences are printed verbatim to the operator; the fixture
// transport is not, because it is a browser test double standing in for what
// the Rust process says (the engine copy pass, F4, owns those); a lone
// `AUDIO_*` code counts only where it is rendered, not where it is compared
// against; and "snapshot" is judged by context rather than by directory. The
// ratchet in `scripts/operator-copy.ratchet.json` is 0 and may not rise.
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
  // "snapshot" is allowed only for the Console's scene primitive. Slice 8: that
  // is a rule about context, not about a directory — the shortcut overlay and
  // the command palette describe the Console's snapshots from outside
  // `app/audio/`, and calling them anything else would disagree with the
  // surface they describe. A string that names audio or the Console is talking
  // about the primitive; every other "snapshot" is still a hit.
  {
    word: "snapshot",
    re: /\bsnapshots?\b/i,
    unlessUnder: "frontend/app/src/app/audio/",
    exempt: /\b(audio|console)\b/i,
  },
  // A raw code never leads what the operator reads. Slice 8: a lone code that is
  // compared against rather than printed is a value, not copy, so it counts only
  // where it is rendered. A code inside a sentence is a hit wherever it appears.
  { word: "AUDIO_* first", re: /^\s*AUDIO_[A-Z_]+/, printedOnly: true },
];

const SKIP_ATTRIBUTES = new Set(["className", "data-testid", "id", "key", "href", "src", "type", "name", "htmlFor"]);

// Slice 8: the live client is scanned too. Its startup-failure sentences are
// printed verbatim by the recovery display, so they are operator copy even
// though they are not in the app. `fixtureTransport.ts` is the browser test
// double — its strings stand in for what the Rust process would say, never run
// on the workstation, and are the engine copy pass's (F4) to rename.
export const SKIP_FILES = new Set(["frontend/packages/engine-client/src/transports/fixtureTransport.ts"]);

export const DEFAULT_ROOTS = [
  "frontend/app/src",
  "frontend/packages/design-system/src",
  "frontend/packages/engine-client/src",
];

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
  const check = (raw, node, printed) => {
    const value = raw.replace(/\s+/g, " ").trim();
    const loneCode = /^AUDIO_[A-Z_]+$/.test(value);
    if (!value || !/\s/.test(value) || !/[a-zA-Z]/.test(value)) {
      // A single token is an identifier, not a sentence — unless it is a raw code.
      if (!loneCode) return;
    }
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    for (const f of FORBIDDEN) {
      if (!f.re.test(value)) continue;
      if (f.exempt && f.exempt.test(value)) continue;
      if (f.unlessUnder && relativeFile.startsWith(f.unlessUnder)) continue;
      if (f.printedOnly && loneCode && !printed) continue;
      hits.push({ file: relativeFile, line, word: f.word, text: value.slice(0, 80) });
    }
  };
  // Is this literal rendered, or compared against and stored? Anything inside
  // JSX is printed; an operand of a comparison or a `switch` is not.
  const isPrinted = (node) => {
    for (let current = node.parent; current; current = current.parent) {
      if (ts.isBinaryExpression(current) || ts.isCaseClause(current) || ts.isSwitchStatement(current)) return false;
      if (
        ts.isJsxElement(current) ||
        ts.isJsxSelfClosingElement(current) ||
        ts.isJsxExpression(current) ||
        ts.isJsxAttribute(current)
      )
        return true;
    }
    return false;
  };
  const visit = (node) => {
    if (ts.isJsxText(node)) check(node.getText(), node, true);
    else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && isOperatorFacing(node))
      check(node.text, node, isPrinted(node));
    else if (ts.isTemplateExpression(node)) {
      check(node.head.text, node, isPrinted(node));
      for (const span of node.templateSpans) check(span.literal.text, span.literal, isPrinted(node));
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
      if (SKIP_FILES.has(relative)) continue;
      hits.push(...scanSource(readFileSync(file, "utf8"), relative));
    }
  }
  return hits;
}

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
