// Shim: some Tauri CLI invocations resolve beforeDevCommand/beforeBuildCommand
// from this tauri.conf.json's directory, so the conf's relative
// `node scripts/tauri-before-command.mjs` lands here. Others (CI's
// tauri-foundation build) resolve from the Cargo workspace root and use the
// sibling shim at `native/scripts/`. Both are live — keep both. The real
// script lives at the repo root's scripts/.
import "../../../scripts/tauri-before-command.mjs";
