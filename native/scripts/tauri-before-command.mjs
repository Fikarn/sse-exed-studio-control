// Shim: in CI (`npm run tauri:build` → `cd native/tauri-shell && tauri build`)
// the Tauri CLI resolves beforeDevCommand/beforeBuildCommand from the Cargo
// WORKSPACE root (`native/`), so `node scripts/tauri-before-command.mjs` lands
// here. A sibling shim exists at `native/tauri-shell/scripts/` for contexts
// that resolve from the tauri.conf.json directory instead. Both are live;
// deleting either breaks one invocation path (this one broke tauri-foundation
// on 2026-08-12 when removed as "dead" — it is not). The real script lives at
// the repo root's scripts/.
import "../../scripts/tauri-before-command.mjs";
