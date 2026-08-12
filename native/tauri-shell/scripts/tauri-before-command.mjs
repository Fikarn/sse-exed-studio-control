// Shim: `tauri dev`/`tauri build` run beforeDevCommand/beforeBuildCommand with
// cwd = this tauri.conf.json's directory, so the conf's relative
// `node scripts/tauri-before-command.mjs` resolves here. The real script lives
// at the repo root's scripts/.
import "../../../scripts/tauri-before-command.mjs";
