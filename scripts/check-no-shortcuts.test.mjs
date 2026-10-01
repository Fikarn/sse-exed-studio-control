import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
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
    "Hold to run; release to stop. Or hold T.",
    "The key could not be changed. Release T and press it again.",
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
  // The shapes the program's own code used, with the key interpolated (the review of Slice 3).
  for (const source of [
    "export const S = () => <button title={`Recall view ${n} · Shift+${n}. Right-click for options.`} />;",
    "toast.push({ message: `Saved view ${n}. Shift+${n} recalls it.` });",
    "const t = `Save view ${n} · Ctrl + Shift + ${n}`;",
  ]) {
    assert.deepEqual(rules(scanSource(source, APP, none)), ["key-hint"], source);
  }
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
    "Could not clear Highlight and Solo. Open Lighting and press the lit Highlight or Solo key.",
    "press twice",
    "ARMED · press again",
    "Press Sync from TotalMix to read the desk.",
    "Press Lighting again.",
    "Press a button or dial on the Stream Deck.",
    "Hold",
    "Release the key and press it again.",
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
  // Templates whose placeholders are not keys: an id, SVG geometry, a test id, a control's name.
  for (const source of [
    "const a = `not in the catalog (${id})`;",
    "const b = `translate(${x} ${y}) scale(${z})`;",
    "export const C = () => <div data-testid={`audio-snapshot-meta-${id}`} />;",
    "const d = `Press ${label} again.`;",
  ]) {
    assert.deepEqual(scanSource(source, APP, none), [], source);
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

// Where the shell may use `unsafe`: a function each, with its reason, and the blocks it holds.
// Anything else fails the build (`unsafe_code = "deny"`), and a block more fails this test.
// A file is named by its path in the shell's crate.
const SHELL_UNSAFE = [
  {
    file: "src/shell_browser_keys.rs",
    item: "fn set_browser_accelerator_keys_off(",
    blocks: 1,
    reason: "WebView2's settings are COM calls, which the windows bindings mark unsafe (decision 12).",
    // The whole module is compiled on Windows alone.
    onWindowsAlone: (_source, main) => /#\[cfg\(windows\)\]\s*\nmod shell_browser_keys;/.test(main),
  },
  {
    file: "src/shell_displays.rs",
    item: "pub(crate) fn read_display_paths(",
    blocks: 6,
    reason:
      "Windows' display configuration is read through calls of user32 that fill lists and unions (the Prompter XL's window).",
    // The function is; another system has one of its own, which reads nothing.
    onWindowsAlone: (source) =>
      source.includes("#[cfg(windows)]\n#[allow(unsafe_code)]\npub(crate) fn read_display_paths(") &&
      source.includes("#[cfg(not(windows))]\npub(crate) fn read_display_paths("),
  },
  // The native picture layer (D30): the whole module is compiled on Windows alone.
  ...[
    [
      "fn create_layer(",
      "DirectComposition's device, target and visual are COM calls, made on a Direct3D device of the layer's own.",
    ],
    [
      "fn new_surface(",
      "A composition surface handle is made by a call of dcomp and put into the visual by COM calls.",
    ],
    [
      "fn hand_over(",
      "The surface's handle is duplicated into the pictures helper's process, which is opened for that alone.",
    ],
    ["fn release(", "The surface is taken out of the visual by COM calls and the shell's handle to it is closed."],
    ["fn show(", "The visual is moved, shown and hidden by COM calls on the layer's own thread."],
    [
      "fn let_go_of_helper(",
      "The helper's process, held open since the hand-over, is closed, and a copy the helper was never told of is closed in it.",
    ],
  ].map(([item, reason]) => ({
    file: "src/shell_picture_layer.rs",
    item,
    blocks: 1,
    reason,
    onWindowsAlone: (_source, main) => /#\[cfg\(windows\)\]\s*\nmod shell_picture_layer;/.test(main),
  })),
];

// Where the pictures helper may use `unsafe`: the renderer's Direct3D calls (D30) and NDI's
// library's calls (D33), a function each, in modules compiled on Windows alone. The same rules
// as the shell's list.
const PICTURES_UNSAFE = [
  ...[
    [
      "fn compile(",
      "The shaders are compiled by a call of d3dcompiler that hands back blobs read by pointer and length.",
    ],
    [
      "fn open_renderer(",
      "The Direct3D device, its shaders, samplers and buffer are made by COM calls with out-values.",
    ],
    ["fn open_chain(", "The swap chain is made on the composition surface whose handle the shell handed over."],
    ["fn chain_target(", "The swap chain's buffer is taken and viewed as a render target by COM calls."],
    ["fn resize_chain(", "The swap chain's buffers are resized by a COM call, with no view of them held."],
    ["fn make_source(", "A camera's frame texture and its view are made by COM calls with out-values."],
    ["fn make_converted(", "A camera's picture texture, its target and its view are made by COM calls."],
    ["fn convert(", "A frame's bytes are uploaded by pointer and drawn into the camera's picture by COM calls."],
    ["fn compose(", "The scene is drawn into the swap chain's buffer and presented by COM calls."],
    ["fn read_statistics(", "The swap chain's present count is read by a COM call, for the minute's log line."],
    [
      "fn close_surface(",
      "The helper's copy of the composition surface's handle is closed, once, by a call of kernel32.",
    ],
  ].map(([item, reason]) => ({
    file: "src/renderer.rs",
    item,
    blocks: 1,
    reason,
    onWindowsAlone: (_source, main) => /#\[cfg\(windows\)\]\s*\nmod renderer;/.test(main),
  })),
  ...[
    [
      "fn load_functions(",
      "NDI's library is loaded by its full path and never freed, and each function is taken by its name with its declared type.",
    ],
    ["fn start_library(", "The library is started and its version, a string it keeps, is copied."],
    ["fn find_open(", "NDI's search is made from settings that live across the call."],
    [
      "fn find_look(",
      "The search waits, and the list of sources it returns is copied, string by string, before the next call.",
    ],
    ["fn find_close(", "The search is destroyed once, from its owner's drop, on its own thread."],
    ["fn receiver_open(", "A receiver is made from settings whose strings live for the receiver's whole life."],
    [
      "fn receiver_capture(",
      "A frame is captured into owned out-values; its picture is read by pointer only within the size its checked rows give, and freed.",
    ],
    ["fn receiver_counters(", "The receiver's counts are read into owned out-values, for the minute's log line."],
    ["fn receiver_close(", "The receiver is destroyed once, from its owner's drop, with none of its frames held."],
  ].map(([item, reason]) => ({
    file: "src/ndi_library.rs",
    item,
    blocks: 1,
    reason,
    onWindowsAlone: (_source, main) => /#\[cfg\(windows\)\]\s*\nmod ndi_library;/.test(main),
  })),
];

const rustFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? rustFiles(path.join(dir, entry.name))
      : entry.name.endsWith(".rs")
        ? [path.join(dir, entry.name)]
        : []
  );

/** A crate's Rust files (its sources, their folders, build.rs), each with its path in the crate. */
function crateSources(crate) {
  const crateDir = path.join(repoRoot, "native", crate);
  return [...rustFiles(path.join(crateDir, "src")), path.join(crateDir, "build.rs")]
    .filter((file) => existsSync(file))
    .map((file) => [path.relative(crateDir, file).split(path.sep).join("/"), readFileSync(file, "utf8")]);
}

// An unsafe block, function, impl, trait or extern block. A function pointer's type (`unsafe extern
// "C" fn(…)`, with no name) is no unsafe code: only a call through it is, and that stands in a
// listed block.
const UNSAFE_ITEM = /\bunsafe\s*(?:\{|fn\b|impl\b|trait\b|extern\b(?!\s*"[^"]*"\s*fn\s*\())/g;

/**
 * `unsafe` is lifted for the functions of `allowances`, and nowhere else in the crate: its Rust
 * files name the lint once for each, in any form (allow, expect, warn, a crate-wide #![…], a
 * list, cfg_attr), and hold the blocks the list says, each under a comment that says why it is sound.
 */
function assertUnsafeOnlyWhereListed(sources, allowances, main) {
  const lintNames = (source) => (source.match(/\bunsafe_code\b/g) ?? []).length;
  const unsafeItems = (source) => (source.match(UNSAFE_ITEM) ?? []).length;
  for (const [name, source] of sources) {
    const listed = allowances.filter((allowance) => allowance.file === name);
    assert.equal(lintNames(source), listed.length, `${name} names unsafe_code once for each of its allowances`);
    assert.equal(
      unsafeItems(source),
      listed.reduce((sum, allowance) => sum + allowance.blocks, 0),
      `${name} holds the unsafe blocks its allowances say`
    );
    for (const allowance of listed) {
      assert.ok(allowance.reason.length > 40, `${allowance.item} says why`);
      assert.ok(
        source.includes(`#[allow(unsafe_code)]\n${allowance.item}`),
        `the #[allow(unsafe_code)] of ${name} sits on ${allowance.item}`
      );
      assert.ok(allowance.onWindowsAlone(source, main), `${allowance.item} is compiled on Windows alone`);
    }
  }
  for (const allowance of allowances) {
    assert.ok(
      sources.some(([name]) => name === allowance.file),
      `${allowance.file} is a file of the crate`
    );
  }
  // An unsafe block says why it is sound, in a comment of its own: the comment lines that stand
  // directly above the block's line, with nothing between them and it.
  for (const [name, source] of sources) {
    const lines = source.split("\n");
    lines.forEach((line, index) => {
      if (!/\bunsafe\s*\{/.test(line)) return;
      let first = index;
      while (first > 0 && lines[first - 1].trim().startsWith("//")) first -= 1;
      const above = lines.slice(first, index).join("\n");
      assert.ok(/\/\/ SAFETY: /.test(above), `${name}:${index + 1} says why its unsafe block is sound`);
    });
  }
}

/** The features a crate takes of the one `windows` crate, as its manifest lists them. */
function windowsFeatures(crate) {
  const manifest = readFileSync(path.join(repoRoot, "native", crate, "Cargo.toml"), "utf8");
  const list = manifest.match(/^windows = \{ version = "0\.61", features = \[([^\]]*)\] \}/m);
  assert.ok(list, `${crate} takes windows 0.61 with a list of features`);
  return [...list[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

test("the native shell switches the web view's own keys off, and uses unsafe where its list says (decision 12)", () => {
  const shellFile = (name) => readFileSync(path.join(repoRoot, "native/tauri-shell/src", name), "utf8");
  const main = shellFile("main.rs");
  const keys = shellFile("shell_browser_keys.rs");
  // The setting itself, false, and never turned back on.
  // (assert.ok, not assert.match: a failure names the rule, not the whole file.)
  assert.ok(
    /\.SetAreBrowserAcceleratorKeysEnabled\(false\)/.test(keys),
    "shell_browser_keys.rs sets the browser keys off"
  );
  // The module is compiled on Windows alone, where WebView2 is.
  assert.ok(/#\[cfg\(windows\)\]\s*\nmod shell_browser_keys;/.test(main), "main.rs has the module on Windows");
  // Applied to the main window in the builder's setup, before anything else there.
  const setup = main.slice(main.indexOf(".setup(|app| {"));
  assert.ok(main.includes(".setup(|app| {"), "main.rs has a .setup(|app| { … }) block");
  const firstStatements = setup.slice(0, setup.indexOf("restore_or_route_initial_window"));
  assert.ok(
    /#\[cfg\(windows\)\]\s*\n\s*switch_off_browser_keys\(app\.handle\(\), &window\);/.test(firstStatements),
    "setup switches the browser keys off before it routes the window"
  );
  // `unsafe` is lifted for the functions of `SHELL_UNSAFE`, and nowhere else in the shell.
  const shellSources = crateSources("tauri-shell");
  const everySource = shellSources.map(([, source]) => source).join("\n");
  assert.ok(!/SetAreBrowserAcceleratorKeysEnabled\(true\)/.test(everySource), "the shell never sets them on");
  assertUnsafeOnlyWhereListed(shellSources, SHELL_UNSAFE, main);
  // The shell's crate takes the display calls and the picture layer's from the one windows crate,
  // by these features and no others.
  assert.deepEqual(
    windowsFeatures("tauri-shell"),
    [
      "Win32_Devices_Display",
      "Win32_Foundation",
      "Win32_Graphics_Direct3D",
      "Win32_Graphics_Direct3D11",
      "Win32_Graphics_DirectComposition",
      "Win32_Graphics_Dxgi",
      "Win32_Security",
      "Win32_System_Threading",
    ],
    "the shell's windows crate has the display configuration's features and the picture layer's"
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
  // The pictures helper's table is the same (its list is PICTURES_UNSAFE).
  const helper = readFileSync(path.join(repoRoot, "native/pictures-link/Cargo.toml"), "utf8");
  assert.deepEqual(lintTable(helper, "lints.rust"), ['unsafe_code = "deny"']);
  assert.deepEqual(lintTable(helper, "lints.clippy"), lintTable(workspace, "workspace.lints.clippy"));
});

test("the pictures helper draws with Direct3D, receives with NDI, and uses unsafe where its list says (D30, D33)", () => {
  const sources = crateSources("pictures-link");
  const main = sources.find(([name]) => name === "src/main.rs")?.[1] ?? "";
  assertUnsafeOnlyWhereListed(sources, PICTURES_UNSAFE, main);
  // A system without Direct3D has a renderer of its own, which draws nothing and uses no unsafe;
  // a system without NDI a library of its own, which loads nothing.
  assert.ok(
    /#\[cfg\(not\(windows\)\)\]\s*\n#\[path = "renderer_none\.rs"\]\s*\nmod renderer;/.test(main),
    "main.rs has the renderer of a system without Direct3D"
  );
  assert.ok(
    /#\[cfg\(not\(windows\)\)\]\s*\n#\[path = "ndi_library_none\.rs"\]\s*\nmod ndi_library;/.test(main),
    "main.rs has the library of a system without NDI"
  );
  // The Direct3D and library-loading calls come from the one windows crate, by these features and
  // no others.
  assert.deepEqual(
    windowsFeatures("pictures-link"),
    [
      "Win32_Foundation",
      "Win32_Graphics_Direct3D",
      "Win32_Graphics_Direct3D_Fxc",
      "Win32_Graphics_Direct3D11",
      "Win32_Graphics_Dxgi",
      "Win32_Graphics_Dxgi_Common",
      "Win32_System_LibraryLoader",
    ],
    "the helper's windows crate has the renderer's features and the library loader's"
  );
  // A function pointer's type is not counted as unsafe code; a named unsafe function still is.
  const pointer = 'struct F { f: unsafe extern "C" fn(*mut u8) -> bool }';
  const named = 'unsafe extern "C" fn f() {}';
  assert.equal((pointer.match(UNSAFE_ITEM) ?? []).length, 0);
  assert.equal((named.match(UNSAFE_ITEM) ?? []).length, 1);
});

// The crates with a lint table of their own: `unsafe_code` at deny, lifted for a named list.
const CRATES_WITH_UNSAFE_LISTS = ["tauri-shell", "pictures-link"];

test("every crate of the workspace takes its lints, so unsafe is forbidden but in the two named lists", () => {
  // A crate without `[lints] workspace = true` takes no lint table at all, and would allow
  // `unsafe` unseen. The shell and the pictures helper have a table of their own (deny, with
  // SHELL_UNSAFE and PICTURES_UNSAFE, above).
  const workspace = readFileSync(path.join(repoRoot, "native/Cargo.toml"), "utf8");
  const members = workspace.match(/^members = \[([^\]]*)\]/m);
  assert.ok(members, "native/Cargo.toml lists its members");
  const crates = [...members[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(crates.includes("pictures-link"), "the pictures helper is a member");
  for (const crate of crates) {
    const manifest = readFileSync(path.join(repoRoot, "native", crate, "Cargo.toml"), "utf8")
      .split("\n")
      .map((line) => line.replace(/#.*/, "").trimEnd())
      .join("\n");
    if (CRATES_WITH_UNSAFE_LISTS.includes(crate)) {
      assert.ok(/^\[lints\.rust\]\s*\nunsafe_code = "deny"/m.test(manifest), `${crate} denies unsafe`);
      assert.ok(!/^\[lints\]/m.test(manifest), `${crate} has the one lint table`);
      continue;
    }
    assert.ok(/^\[lints\]\s*\nworkspace = true/m.test(manifest), `${crate} takes the workspace's lints`);
    assert.ok(!/unsafe_code/.test(manifest), `${crate} does not lift unsafe_code`);
  }
});

test("the shell's windows and webview2-com are the ones Tauri's wry uses (the COM code compiles only on Windows)", () => {
  // `set_browser_accelerator_keys_off` takes wry's ICoreWebView2Controller and returns
  // windows::core::Result, and no CI job compiles cfg(windows) code: a second version of
  // either crate in the lock file would break the Windows build unseen. Cargo.lock names a
  // dependency with its version only when two versions of it are locked.
  const lock = readFileSync(path.join(repoRoot, "native/Cargo.lock"), "utf8");
  const packages = lock.split(/\n(?=\[\[package\]\])/);
  const named = (name) => packages.filter((block) => block.includes(`\nname = "${name}"\n`));
  for (const crateName of ["windows", "webview2-com"]) {
    assert.equal(named(crateName).length, 1, `one ${crateName} in Cargo.lock`);
  }
  const dependencies = (name) => {
    const [block] = named(name);
    assert.ok(block, `${name} is in Cargo.lock`);
    const list = block.match(/dependencies = \[\n([\s\S]*?)\n\]/);
    return list ? list[1].split("\n").map((line) => line.trim().replace(/^"|",?$/g, "")) : [];
  };
  for (const user of ["sse-exed-tauri-shell", "wry"]) {
    const deps = dependencies(user);
    assert.ok(deps.includes("windows"), `${user} depends on the one windows`);
    assert.ok(deps.includes("webview2-com"), `${user} depends on the one webview2-com`);
  }
  // Dependabot leaves them alone; they move by hand, with a Tauri update.
  const dependabot = readFileSync(path.join(repoRoot, ".github/dependabot.yml"), "utf8");
  assert.match(dependabot, /- dependency-name: "windows"/);
  assert.match(dependabot, /- dependency-name: "webview2-com"/);
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
