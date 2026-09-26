import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_ROOTS,
  KEY_HANDLERS,
  KEY_LISTENERS,
  MODIFIER_READERS,
  formatHit,
  scanRoots,
  scanSource,
  scanStylesheet,
} from "./check-no-shortcuts.mjs";

// The new pages program's Slice 3 (D6): Studio Control binds no key of its own
// and advertises none. The scanner's rules are tested on inline sources; the
// program holds at 0 hits, with no ratchet.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = "frontend/app/src/app/x.tsx";
const rules = (hits) => hits.map((hit) => hit.rule);
const none = { keyListeners: {}, keyHandlers: {}, modifierReaders: {} };

test("Studio Control binds no key of its own and advertises none", () => {
  const hits = scanRoots(repoRoot, DEFAULT_ROOTS);
  assert.deepEqual(
    hits.map(formatHit),
    [],
    `${hits.length} key bindings or key hints — see scripts/check-no-shortcuts.mjs`
  );
});

test("every allowed place is a file that still has what it is allowed", () => {
  const lists = [
    ["KEY_LISTENERS", KEY_LISTENERS, "key-listener"],
    ["KEY_HANDLERS", KEY_HANDLERS, "key-handler"],
    ["MODIFIER_READERS", MODIFIER_READERS, "modifier"],
  ];
  for (const [listName, list, rule] of lists) {
    for (const [file, reason] of Object.entries(list)) {
      assert.ok(reason.trim().length > 10, `${listName} ${file} says why it is plain keyboard operation`);
      const full = path.join(repoRoot, file);
      assert.ok(existsSync(full), `${listName} names ${file}, which does not exist`);
      const found = scanSource(readFileSync(full, "utf8"), file, none).filter((hit) => hit.rule === rule);
      assert.ok(found.length > 0, `${listName} names ${file}, which has no ${rule} any more — take it off the list`);
    }
  }
});

test("a key listener outside the allowed places is a hit, whatever it listens on", () => {
  const source = `
    window.addEventListener("keydown", onKey);
    document.addEventListener("keyup", onKey);
    dialog.addEventListener("keypress", onKey);
    window.onkeydown = onKey;
    window.addEventListener("pointerdown", onPointer);`;
  assert.deepEqual(rules(scanSource(source, APP, none)), [
    "key-listener",
    "key-listener",
    "key-listener",
    "key-listener",
  ]);
  const allowed = { ...none, keyListeners: { [APP]: "Esc closes the dialog" } };
  assert.deepEqual(scanSource(source, APP, allowed), []);
});

test("a key handler on an element, or in an object of props, outside the allowed places is a hit", () => {
  const source = `
    export const A = () => <div onKeyDown={onKey} onKeyUpCapture={onKey} onClick={onClick} />;
    const props = { onKeyDown: onKey, onKeyUp };
    const more = { onKeyPress(event) { return event; } };`;
  assert.deepEqual(rules(scanSource(source, APP, none)), [
    "key-handler",
    "key-handler",
    "key-handler",
    "key-handler",
    "key-handler",
  ]);
  const allowed = { ...none, keyHandlers: { [APP]: "the arrows on a focused slider" } };
  assert.deepEqual(scanSource(source, APP, allowed), []);
});

test("reading a modifier key is a hit, pointer events included (decision 10)", () => {
  const source = `
    const add = event.shiftKey;
    if (event.ctrlKey || event.altKey || event.metaKey) fine();
    const { shiftKey } = event;
    const { altKey: alt } = event;
    const held = event["metaKey"];
    const caps = event.getModifierState("CapsLock");`;
  assert.deepEqual(rules(scanSource(source, APP, none)), [
    "modifier",
    "modifier",
    "modifier",
    "modifier",
    "modifier",
    "modifier",
    "modifier",
    "modifier",
  ]);
  const allowed = { ...none, modifierReaders: { [APP]: "Shift+Tab keeps focus inside the dialog" } };
  assert.deepEqual(scanSource(source, APP, allowed), []);
});

test("<kbd>, aria-keyshortcuts, accessKey and names about shortcuts are hits", () => {
  const hits = scanSource(
    `import { formatShortcut } from "./shared/shortcutGlyphs";
     export const K = () => <p>Save <kbd>S</kbd><button aria-keyshortcuts="Control+S" accessKey="s">Go</button></p>;
     const props = { "aria-keyshortcuts": "M" };`,
    APP,
    none
  );
  assert.deepEqual(rules(hits).sort(), ["kbd", "kbd", "key-attribute", "key-attribute", "key-attribute"]);
  assert.deepEqual(rules(scanSource("export const x = 1;", "frontend/app/src/app/shared/ShortcutOverlay.tsx", none)), [
    "kbd",
  ]);
});

test("a kbd selector, a kbd class or a shortcut class in a stylesheet is a hit; comments are not", () => {
  const css = `/* the kbd chips */
.key kbd { color: red; }
kbd, code { font: inherit; }
.hint .kbd { margin: 0; }
.captionShortcuts { gap: 4px; }
.keyboardFocus { outline: 0; }`;
  const hits = scanStylesheet(css, "frontend/packages/design-system/src/components/Key.module.css");
  assert.deepEqual(
    hits.map((hit) => hit.line),
    [2, 3, 4, 5]
  );
});

test("copy that names a key is a hit", () => {
  const hints = [
    "Press P to leave patch mode.",
    "Hold · T",
    "Hold to talk to the monitor output; release to stop. Or hold T.",
    "Talkback could not be changed. Release T and press it again.",
    "Press 1–8, click a strip, or use the command palette to select a source.",
    "Mute Host (M)",
    "Open full DMX monitor (Ctrl+Shift+M)",
    "ARMED · press again · Esc cancels",
    "Could not stop the Find sequence. Press Esc to try again.",
    "Click a chip to focus that fixture · Shift-click to remove it from the selection.",
    "Stage plot. Use Tab to focus a fixture, then arrow keys to nudge its position.",
    "No scene is active. Press ⇧S to save the rig as a new scene.",
    "Shift 1–8",
    "… — press to type a value, arrows to nudge",
    "Rename with F2",
    "Show keyboard shortcuts",
    "Open the command palette",
  ];
  for (const hint of hints) {
    const hits = scanSource(`const t = ${JSON.stringify(hint)};`, APP, none);
    assert.deepEqual(rules(hits), ["key-hint"], hint);
  }
  assert.deepEqual(rules(scanSource(`export const A = () => <p>Press P to leave patch mode.</p>;`, APP, none)), [
    "key-hint",
  ]);
  assert.deepEqual(rules(scanSource("const t = `Undid ${label} · Ctrl+Shift+Z to redo`;", APP, none)), ["key-hint"]);
});

test("a key alone is a hit where it can only be a key: a combination, a glyph, a key's small print", () => {
  const source = `
    const a = "Ctrl+K";
    export const B = () => <Key cap="Shortcuts" hint="?" />;
    const c = { hint: "P", label: "Patch" };
    const d = "⌘";`;
  assert.deepEqual(rules(scanSource(source, APP, none)), ["key-hint", "key-hint", "key-hint", "key-hint", "key-hint"]);
});

test("the words the program keeps are not hits", () => {
  const kept = [
    "Press Patch to leave patch mode.",
    "Press Stop again.",
    "Press the lit key again.",
    "press twice",
    "ARMED · press again",
    "Press Sync from TotalMix to read the desk.",
    "Press Lighting again.",
    "Press a button or dial on the Stream Deck.",
    "Hold",
    "Release Talkback and press it again.",
    "Reset to 0 dB",
    "Fixture symbol key",
    "Undid ‘Key light’.",
    "Previous bank",
    "Add to selection",
    "Type a value between 0 and 100.",
    "Shift the scene by one.",
  ];
  for (const words of kept) {
    assert.deepEqual(scanSource(`const t = ${JSON.stringify(words)};`, APP, none), [], words);
  }
  // The strip keys' caps, and key names the code compares against.
  assert.deepEqual(
    scanSource(
      `export const S = () => <Key cap="M" /><Key cap="S" />;
       if (event.key === "Escape" || event.key === "Enter") close();
       switch (event.key) { case "ArrowUp": up(); }
       const keys = new Set(["Home", "End", "PageUp", "PageDown"]);`,
      APP,
      none
    ),
    []
  );
});

test("the native shell switches the web view's own keys off, with one exception to the unsafe rule (decision 12)", () => {
  const shell = readFileSync(path.join(repoRoot, "native/tauri-shell/src/main.rs"), "utf8");
  // The setting itself, false, and never turned back on.
  // (assert.ok, not assert.match: a failure names the rule, not the whole file.)
  assert.ok(/\.SetAreBrowserAcceleratorKeysEnabled\(false\)/.test(shell), "main.rs sets the browser keys off");
  assert.ok(!/SetAreBrowserAcceleratorKeysEnabled\(true\)/.test(shell), "main.rs never sets them on");
  // Applied to the main window in the builder's setup, before anything else there.
  const setup = shell.slice(shell.indexOf(".setup(|app| {"));
  assert.ok(setup.length > 0, "main.rs has a .setup(|app| { … }) block");
  const firstStatements = setup.slice(0, setup.indexOf("restore_or_route_initial_window"));
  assert.ok(
    /switch_off_browser_keys\(app\.handle\(\), &window\);/.test(firstStatements),
    "setup switches the browser keys off before it routes the window"
  );
  // `unsafe` is lifted for the one function that makes the COM calls, and nowhere else in the shell.
  const shellSources = ["main.rs", "engine.rs", "shell_log.rs"].map((file) =>
    readFileSync(path.join(repoRoot, "native/tauri-shell/src", file), "utf8")
  );
  const allowances = shellSources.join("\n").match(/#\[allow\(unsafe_code\)\]/g) ?? [];
  assert.equal(allowances.length, 1, "one #[allow(unsafe_code)] in the shell");
  assert.ok(
    /#\[allow\(unsafe_code\)\]\s*\nfn set_browser_accelerator_keys_off\(/.test(shell),
    "the one #[allow(unsafe_code)] sits on set_browser_accelerator_keys_off"
  );
  // The shell's lints are the workspace's, with unsafe_code at deny (a forbid cannot be lifted for one item).
  const workspace = readFileSync(path.join(repoRoot, "native/Cargo.toml"), "utf8");
  const crate = readFileSync(path.join(repoRoot, "native/tauri-shell/Cargo.toml"), "utf8");
  const lintTable = (text, header) => {
    const start = text.indexOf(`[${header}]`);
    assert.ok(start >= 0, `[${header}] is there`);
    const body = text.slice(start + header.length + 2);
    const end = body.search(/^\[/m);
    return (end >= 0 ? body.slice(0, end) : body)
      .split("\n")
      .map((line) => line.replace(/#.*/, "").trim())
      .filter(Boolean)
      .sort();
  };
  assert.deepEqual(lintTable(workspace, "workspace.lints.rust"), ['unsafe_code = "forbid"']);
  assert.deepEqual(lintTable(crate, "lints.rust"), ['unsafe_code = "deny"']);
  assert.deepEqual(lintTable(crate, "lints.clippy"), lintTable(workspace, "workspace.lints.clippy"));
});

test("identifiers, module specifiers and test ids are not copy", () => {
  assert.deepEqual(
    scanSource(
      `import { Esc } from "./keys/Esc-press-P";
       export const T = () => <div data-testid="press-p-to-leave" className="hold-t">ok</div>;
       const map = { "Press P": 1 };`,
      APP,
      none
    ),
    []
  );
});
