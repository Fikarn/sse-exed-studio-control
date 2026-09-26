// check-no-shortcuts.mjs — the new pages program's Slice 3 guard (decision D6,
// the operator's of 2026-09-24, with the twelve decisions of 2026-09-26 in
// `docs/plans/new-pages-2026-09-s3-inventory.md`): Studio Control binds no key
// of its own and advertises none.
//
//   node scripts/check-no-shortcuts.mjs [--root DIR] [--json]
//
// Plain keyboard operation stays: Tab moves focus, Enter or Space presses the
// focused control, typing in a field, the arrows (with Home, End, Page Up and
// Page Down) on a focused slider or list, and Esc on a dialog, a drawer, a popup
// or an armed key. So a key listener is allowed only in the files listed below,
// each with the reason it is plain keyboard operation, and nothing reads a
// modifier key but a dialog's Shift+Tab focus trap. A new key handler fails this
// guard until its file is listed here with its reason, where review sees it.
//
// Rules (each hit names the file, the line, the rule and the text):
//   key-listener     `addEventListener("keydown" | "keyup" | "keypress", …)` on
//                    any target, or an `onkeydown`-style assignment, outside
//                    KEY_LISTENERS;
//   key-handler      a JSX `onKeyDown` / `onKeyUp` / `onKeyPress` (or their
//                    `…Capture`), or an object property of that name, outside
//                    KEY_HANDLERS;
//   modifier         a read of `shiftKey`, `ctrlKey`, `altKey`, `metaKey` or
//                    `getModifierState` outside MODIFIER_READERS — a key held
//                    while pointing is a shortcut too (decision 10);
//   kbd              a `<kbd>` element, a `kbd` selector or class in a
//                    stylesheet, or a name with "shortcut" in it (a file, a
//                    component, a hook, a prop or a class);
//   key-attribute    `aria-keyshortcuts` or `accessKey`, which advertise a key;
//   key-hint         operator copy that names a key: a modifier combination
//                    ("Ctrl+K", "Shift-click"), a key glyph (⌘ ⇧ ⌥ ⌃), "Esc",
//                    "Press P", "Hold · T", "(M)", a function key, Tab or Enter
//                    as a key, the arrow keys, "shortcut", "command palette",
//                    or a single key as a key's small print (`hint="?"`).
//
// The operator-facing test is the operator-copy gate's (`check-operator-copy.mjs`):
// JSX text and string literals, minus module specifiers, object keys, class
// names, test ids and other identifiers. Tests are not scanned: they press keys
// to prove that nothing answers them.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import { isOperatorFacing } from "./check-operator-copy.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULT_ROOTS = [
  "frontend/app/src",
  "frontend/packages/design-system/src",
  "frontend/packages/engine-client/src",
  "frontend/packages/shared-graphics/src",
];

// Where a key listener on a window, a document or an element is plain keyboard
// operation. Each entry says why.
export const KEY_LISTENERS = {
  "frontend/packages/design-system/src/components/Dialog.tsx":
    "Esc closes the dialog and Tab stays inside it, while focus is in the dialog (D6)",
  "frontend/packages/design-system/src/components/Drawer.tsx": "Esc closes the open drawer (D6)",
  "frontend/packages/design-system/src/components/useArm.ts":
    "Esc cancels the armed key, registered only while a key is armed (D6)",
  "frontend/app/src/app/shared/ShellDialog.tsx":
    "Esc closes the shell's dialog (Close Studio Control?, Restart the hardware link?) wherever focus is, and Tab stays inside it (D6)",
  "frontend/app/src/app/audio/hooks/useAudioArming.ts":
    "Esc cancels the Console's armed key (48 V, snapshot recall and save), registered only while one is armed (D6)",
};

// Where a JSX key handler is plain keyboard operation on the focused control.
export const KEY_HANDLERS = {
  "frontend/packages/design-system/src/components/ColorPicker.tsx":
    "the colour picker popup: the arrows, Home and End move over the swatches, Enter or Space picks one, Esc closes it (decision 11)",
  "frontend/packages/design-system/src/components/ContextMenu.tsx":
    "the right-click menu: the arrows, Home and End move over its items, Enter or Space picks one, Esc closes it (decision 11)",
  "frontend/packages/design-system/src/components/InlineRename.tsx":
    "the rename field: Enter confirms, Esc puts the old name back (decision 11)",
  "frontend/packages/design-system/src/components/MultiValueSlider.tsx":
    "the bulk plate's value-or-change field: Enter applies what was typed, the field having no Apply key (decision 11)",
  "frontend/packages/design-system/src/components/ScrubLabel.tsx":
    "a focused scrub label is a slider: the arrows, Home, End, Page Up and Page Down (decision 9)",
  "frontend/packages/design-system/src/components/ScrubSlider.tsx":
    "a focused slider: the arrows, Home, End, Page Up and Page Down, and Enter for typed entry (decision 9)",
  "frontend/packages/design-system/src/components/SegmentedControl.tsx":
    "a focused segmented switch is a list: the arrows, Home and End choose a segment (D6)",
  "frontend/packages/design-system/src/components/Slider.tsx":
    "a focused slider or fader: the arrows, Home and End, and Enter for typed entry (decision 9)",
  "frontend/packages/design-system/src/components/Toolbar.tsx":
    "a focused toolbar is a list: the arrows, Home and End move between its keys (D6)",
  "frontend/app/src/app/audio/components/AudioKnob.tsx":
    "a focused knob is a slider: the arrows, Home, End, Page Up and Page Down, and Enter for typed entry (decision 9)",
  "frontend/app/src/app/audio/components/AudioSliderControl.tsx":
    "a focused send or level slider: the arrows, Home, End, Page Up and Page Down, and Enter for typed entry (decision 9)",
  "frontend/app/src/app/audio/hooks/useMomentaryTalkback.ts":
    "Space or Enter held on the focused Talkback key holds talkback, as the pointer does (D6, D7)",
  "frontend/app/src/app/lighting/components/FixtureMarker.tsx":
    "Enter or Space presses the focused fixture marker (D6)",
  "frontend/app/src/app/lighting/components/GroupChip.tsx":
    "Enter or Space presses the focused group chip (D8), and the chips' keyboard reorder: Space picks one up, the arrows move it, Space or Enter drops it, Esc puts it back (decision 11)",
  "frontend/app/src/app/lighting/components/InspectorFixture.tsx": "Enter confirms a typed Position field (D6)",
  "frontend/app/src/app/lighting/components/InspectorPatch.tsx":
    "the patch start-channel field: Enter confirms, Esc puts the old value back (decision 11)",
  "frontend/app/src/app/lighting/components/LightingSearchField.tsx":
    "the search field's Recent list: the arrows move over it, Enter recalls the scene it shows, Esc closes it (decision 11)",
  "frontend/app/src/app/lighting/components/SceneTile.tsx":
    "Enter or Space presses the focused scene tile or its pin (D8), and the tiles' keyboard reorder (decision 11)",
  "frontend/app/src/app/lighting/components/TalentMarkMarker.tsx":
    "the arrows move a focused talent mark 0.1 m, the only keyboard way to move one (decision 9)",
};

// Where reading a modifier key is allowed: Shift+Tab keeps focus inside a dialog.
export const MODIFIER_READERS = {
  "frontend/packages/design-system/src/components/Dialog.tsx": "Shift+Tab keeps focus inside the dialog (D6)",
  "frontend/app/src/app/shared/ShellDialog.tsx": "Shift+Tab keeps focus inside the shell's dialog (D6)",
};

const KEY_EVENTS = new Set(["keydown", "keyup", "keypress"]);
const KEY_PROPERTIES = new Set(["onkeydown", "onkeyup", "onkeypress"]);
const HANDLER_NAMES = new Set([
  "onKeyDown",
  "onKeyDownCapture",
  "onKeyUp",
  "onKeyUpCapture",
  "onKeyPress",
  "onKeyPressCapture",
]);
const MODIFIERS = new Set(["shiftKey", "ctrlKey", "altKey", "metaKey", "getModifierState"]);
const KEY_ATTRIBUTES = new Set(["aria-keyshortcuts", "accessKey", "accesskey"]);
// A key's small print, or a property that carries a key: one key token there is
// a hint ("?", "P", "Esc"); words are not ("press twice").
const HINT_SLOTS = new Set(["hint", "shortcut", "kbd", "keyHint"]);
const SINGLE_KEY = /^(?:[A-Z0-9?/[\]]|F\d{1,2}|Esc|Escape|Tab|Enter|Return|Space|Home|End|PgUp|PgDn)$/;

// Copy of more than one word.
export const HINT_PATTERNS = [
  { name: "a modifier combination", re: /\b(?:ctrl|cmd|shift|alt|meta)\s*[+-]\s*\w/i },
  { name: "a modifier combination", re: /\bmod\s*\+\s*\w/i },
  { name: "a modifier combination", re: /\b(?:Ctrl|Cmd|Shift|Alt)\s+(?:[A-Z0-9]|F\d{1,2})(?!\w)/ },
  { name: "a key glyph", re: /[⌘⇧⌥⌃]/ },
  { name: "Esc", re: /\besc(?:ape)?\b/i },
  {
    name: "a key to press",
    re: /\b(?:[Pp]ress|[Hh]old|[Tt]ap|[Hh]it|[Rr]elease)\s*(?:·\s*)?(?:[A-Z0-9?/[\]]|F\d{1,2})(?!\w)/,
  },
  {
    name: "a key to press",
    re: /\b(?:[Pp]ress|[Hh]old|[Tt]ap|[Hh]it|[Uu]se|[Tt]ype)\s+(?:the\s+)?(?:Tab|Enter|Return|Space|Spacebar|Backspace|PgUp|PgDn|Page Up|Page Down|[Aa]rrow keys?)\b/,
  },
  { name: "a key in brackets", re: /\((?:[A-Z]|F\d{1,2}|Tab|Enter|Space|[?/[\]]|(?:Ctrl|Cmd|Shift|Alt)\+[^)]*)\)/ },
  { name: "a function key", re: /\bF(?:[1-9]|1[0-2])\b/ },
  {
    name: "the arrow keys",
    re: /\barrow keys?\b|\barrows? (?:keys? )?to (?:nudge|move|step|adjust|change|select|walk)\b/i,
  },
  { name: "shortcut", re: /\bshortcuts?\b|\bhot ?keys?\b|\bkey ?bindings?\b/i },
  { name: "the command palette", re: /\bcommand palette\b/i },
];

// Copy of one word: only what cannot be anything but a key.
export const TOKEN_PATTERNS = [
  { name: "a modifier combination", re: /^(?:ctrl|cmd|shift|alt|meta|mod)[+-]\S+$/i },
  { name: "a key glyph", re: /[⌘⇧⌥⌃]/ },
  { name: "shortcut", re: /^(?:keyboard)?shortcuts?$/i },
];

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (["node_modules", "dist", "generated", "storybook-static"].includes(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|css)$/.test(entry) && !/\.(test|spec|d)\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const lineOf = (text, index) => text.slice(0, index).split("\n").length;
const clip = (value) => value.replace(/\s+/g, " ").trim().slice(0, 80);

// An operand of a comparison or a `case` is a value the code tests for (an
// `event.key` name, say), not copy.
function isCompared(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isCaseClause(current)) return true;
    if (ts.isBinaryExpression(current)) {
      const kind = current.operatorToken.kind;
      return (
        kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
        kind === ts.SyntaxKind.EqualsEqualsToken ||
        kind === ts.SyntaxKind.ExclamationEqualsToken
      );
    }
    if (ts.isStatement(current) || ts.isJsxAttribute(current) || ts.isPropertyAssignment(current)) return false;
  }
  return false;
}

function nameOf(node) {
  const name = node.name;
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isJsxNamespacedName?.(name)) return `${name.namespace.text}:${name.name.text}`;
  return name.getText();
}

/** @returns {Array<{ file: string, line: number, rule: string, text: string }>} */
export function scanStylesheet(text, relativeFile) {
  const hits = [];
  // Comments go; their characters become spaces so the lines stay where they are.
  const code = text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
  const patterns = [
    { re: /(^|[\s,>+~(){}])kbd(?![\w-])/g, what: "a kbd selector" },
    { re: /\.kbd(?![\w-])/g, what: "a kbd class" },
    { re: /\.[\w-]*shortcut[\w-]*/gi, what: "a shortcut class" },
  ];
  for (const { re, what } of patterns) {
    for (const match of code.matchAll(re)) {
      // The kbd selector's pattern takes the character before it, which may end the line above.
      const index = match.index + (match[1]?.length ?? 0);
      hits.push({ file: relativeFile, line: lineOf(code, index), rule: "kbd", text: `${what}: ${clip(match[0])}` });
    }
  }
  return hits;
}

/** @returns {Array<{ file: string, line: number, rule: string, text: string }>} */
export function scanSource(text, relativeFile, allowed = {}) {
  const keyListeners = allowed.keyListeners ?? KEY_LISTENERS;
  const keyHandlers = allowed.keyHandlers ?? KEY_HANDLERS;
  const modifierReaders = allowed.modifierReaders ?? MODIFIER_READERS;
  const hits = [];
  const source = ts.createSourceFile(relativeFile, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const at = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const hit = (node, rule, what) => hits.push({ file: relativeFile, line: at(node), rule, text: clip(what) });
  const namesSeen = new Set();

  if (/shortcut/i.test(path.basename(relativeFile))) {
    hits.push({
      file: relativeFile,
      line: 1,
      rule: "kbd",
      text: `a file named for shortcuts: ${path.basename(relativeFile)}`,
    });
  }

  const checkCopy = (raw, node, slot) => {
    const value = raw.replace(/\s+/g, " ").trim();
    if (!value) return;
    if (slot && HINT_SLOTS.has(slot) && SINGLE_KEY.test(value)) {
      hit(node, "key-hint", `a key as ${slot}: ${value}`);
      return;
    }
    const patterns = /\s/.test(value) ? HINT_PATTERNS : isCompared(node) ? [] : TOKEN_PATTERNS;
    for (const pattern of patterns) {
      if (pattern.re.test(value)) {
        hit(node, "key-hint", `${pattern.name}: ${value}`);
        return;
      }
    }
  };

  // The name of the attribute or property a literal is the value of, if any.
  const slotOf = (node) => {
    const parent = node.parent;
    if (parent && ts.isJsxAttribute(parent)) return nameOf(parent);
    if (parent && ts.isJsxExpression(parent) && parent.parent && ts.isJsxAttribute(parent.parent)) {
      return nameOf(parent.parent);
    }
    if (parent && ts.isPropertyAssignment(parent) && parent.initializer === node) return nameOf(parent);
    return null;
  };

  const visit = (node) => {
    // Key listeners.
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "addEventListener" &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      KEY_EVENTS.has(node.arguments[0].text) &&
      !(relativeFile in keyListeners)
    ) {
      hit(node, "key-listener", node.getText(source));
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      KEY_PROPERTIES.has(node.left.name.text) &&
      !(relativeFile in keyListeners)
    ) {
      hit(node, "key-listener", node.getText(source));
    }

    // Key handlers on elements, and objects that carry one.
    if (
      (ts.isJsxAttribute(node) ||
        ts.isPropertyAssignment(node) ||
        ts.isShorthandPropertyAssignment(node) ||
        (ts.isMethodDeclaration(node) && ts.isObjectLiteralExpression(node.parent))) &&
      HANDLER_NAMES.has(nameOf(node) ?? "") &&
      !(relativeFile in keyHandlers)
    ) {
      hit(node, "key-handler", node.getText(source));
    }

    // Modifier keys.
    if (
      (ts.isPropertyAccessExpression(node) && MODIFIERS.has(node.name.text)) ||
      (ts.isElementAccessExpression(node) &&
        ts.isStringLiteralLike(node.argumentExpression) &&
        MODIFIERS.has(node.argumentExpression.text)) ||
      (ts.isBindingElement(node) && MODIFIERS.has((node.propertyName ?? node.name).getText(source)))
    ) {
      if (!(relativeFile in modifierReaders)) hit(node, "modifier", node.getText(source));
    }

    // <kbd>, and names that are about shortcuts.
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === "kbd") {
      hit(node, "kbd", "a <kbd> element");
    }
    // A tag's or an attribute's own name is judged by the rules above, not as a name.
    const tagOrAttributeName =
      node.parent &&
      ((ts.isJsxAttribute(node.parent) && node.parent.name === node) ||
        ((ts.isJsxOpeningElement(node.parent) ||
          ts.isJsxClosingElement(node.parent) ||
          ts.isJsxSelfClosingElement(node.parent)) &&
          node.parent.tagName === node));
    if (
      ts.isIdentifier(node) &&
      !tagOrAttributeName &&
      (/shortcut/i.test(node.text) || node.text === "kbd") &&
      !namesSeen.has(node.text)
    ) {
      namesSeen.add(node.text);
      hit(node, "kbd", `a name: ${node.text}`);
    }

    // Attributes that advertise a key.
    if ((ts.isJsxAttribute(node) || ts.isPropertyAssignment(node)) && KEY_ATTRIBUTES.has(nameOf(node) ?? "")) {
      hit(node, "key-attribute", node.getText(source));
    }

    // Copy.
    if (ts.isJsxText(node)) checkCopy(node.getText(source), node, null);
    else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && isOperatorFacing(node)) {
      checkCopy(node.text, node, slotOf(node));
    } else if (ts.isTemplateExpression(node)) {
      checkCopy(
        [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" … "),
        node,
        slotOf(node)
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

export function scanRoots(repoRoot, roots = DEFAULT_ROOTS) {
  const hits = [];
  for (const root of roots) {
    for (const file of walk(path.join(repoRoot, root))) {
      const relative = path.relative(repoRoot, file).split(path.sep).join("/");
      const text = readFileSync(file, "utf8");
      hits.push(...(relative.endsWith(".css") ? scanStylesheet(text, relative) : scanSource(text, relative)));
    }
  }
  return hits;
}

export const formatHit = (hit) => `${hit.file}:${hit.line} [${hit.rule}] ${hit.text}`;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const rootIndex = argv.indexOf("--root");
  const root = rootIndex >= 0 && argv[rootIndex + 1] ? path.resolve(argv[rootIndex + 1]) : REPO;
  const hits = scanRoots(root);
  if (argv.includes("--json")) {
    process.stdout.write(JSON.stringify(hits, null, 1) + "\n");
  } else {
    for (const found of hits) process.stdout.write(formatHit(found) + "\n");
    process.stdout.write(`\n${hits.length} key bindings or key hints\n`);
  }
  if (hits.length > 0) process.exitCode = 1;
}
