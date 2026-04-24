# Operations

This document describes runtime behavior and operator recovery for the native `SSE ExEd Studio Control` desktop runtime.

## Expected Runtime Behavior

### Startup

- The selected native shell starts first. In the current published operator-rollout build (`v2.2.1`), the selected shipping shell is Tauri; Qt starts only when explicitly selected as the fallback runtime.
- The shell validates runtime paths and bundled assets, then launches the bundled Rust engine.
- The shell waits for `engine.ready`, `health.snapshot`, `app.snapshot`, and the relevant domain snapshots before routing into commissioning or the dashboard.

### Shutdown

- Closing the main window asks for confirmation before the app fully quits.
- The engine remains the owner of persisted state, recovery details, and device-facing safety behavior.
- Logs and support diagnostics stay available from the native recovery and support surfaces.

### Close / quit / update

- Closing the native shell is a full workstation-control shutdown, not a browser-tab close.
- Native updates are delivered through offline installers and maintenance-tool update repositories, not through background Electron-style auto-update polling.
- Apply updates deliberately during a safe workstation window and preserve the app-data directory unless you are intentionally resetting the machine.

### Restart / recovery

- Restart routing is driven from the engine snapshot.
- Machines with completed commissioning route back to `dashboard`.
- Clean-start or reset machines route back to `commissioning`.
- Corrupt storage, runtime-path failures, and protocol mismatches surface recovery details through the native health and support snapshots.

## Operator Recovery

### Lights stop responding

1. Open the Lighting workspace.
2. Review the native health and lighting summaries.
3. Re-run the lighting commissioning probe if needed.
4. If the bridge is still unavailable, restart the app and confirm the same issue reproduces before changing hardware state.

### Audio stops responding

1. Open the Audio workspace.
2. Review the native health and audio summaries.
3. Re-run the audio commissioning probe if needed.
4. If the console is still unavailable, restart the app and confirm the failure is not limited to one session.

### Control-surface bridge stops responding

1. Open Setup or Support and verify the control-surface base URL is present in native diagnostics.
2. If the bridge is unavailable, restart the app before changing deck mappings or network assumptions.
3. If the problem persists, collect diagnostics and confirm the host can still bind `127.0.0.1` on the configured control-surface port.
4. Reinstall the latest known-good native build only after preserving the app-data directory and the latest support backup.

### Planning data looks wrong or missing

1. Export a native support backup immediately if the app is still responsive.
2. Use native restore with the latest known-good support backup or a legacy `db.json` export.
3. Confirm the recovery surface reports the rollback backup path created before restore.

### The app fails before the dashboard

1. Open the recovery surface.
2. Export diagnostics and note the engine log path.
3. If storage is corrupt, restore from the latest support backup.
4. If startup still fails, reinstall the latest known-good native build without deleting the app-data directory.

## Data Safety

- Primary store: native SQLite database
- Backup/export path: native support backup archives written under the app-data backup directory
- Restore path: native support restore from a support archive or legacy `db.json`
- Rollback safety: restore creates a pre-restore backup before applying changes

## Health Signals

### Engine snapshots

- `health.snapshot`
- `app.snapshot`
- `commissioning.snapshot`
- `lighting.snapshot`
- `audio.snapshot`
- `support.snapshot`

### Shell indicators

- startup target and current workspace
- commissioning readiness and hardware profile
- lighting readiness, last scene recall, and fixture inventory summary
- audio readiness, last sync or recall state, and channel inventory summary
- support backup count, restore guidance, and recovery details

## Recommended Checks Before A Live Session

1. Launch the packaged native app and confirm it reaches the expected target surface.
2. Confirm lighting, audio, and support summaries show the expected ready state.
3. Trigger a test light scene recall if lighting is in scope.
4. Trigger an audio sync or snapshot recall if audio is in scope.
5. Export a manual support backup before the session starts.

## Bridge Qualification

Release validation must prove the local control-surface bridge can bind, listen, and serve real HTTP requests on `127.0.0.1`.

- `npm run native:bridge:mac:verify`
- `npm run native:bridge:win:verify`

Those lanes start the packaged engine on a dedicated localhost port, then verify `/api/deck/context`, `/api/deck/lcd`, `/api/deck/action`, `/api/deck/light-action`, and `/api/deck/audio-action` against the live bridge. Treat a bind failure as a release blocker, not as an acceptable warning.

For the current handoff state, use [docs/HANDOFF.md](./HANDOFF.md). The historical parity appendix is preserved at [docs/archive/NATIVE_PARITY_HANDOFF.md](./archive/NATIVE_PARITY_HANDOFF.md) for reference only.
