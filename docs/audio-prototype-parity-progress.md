# Audio Prototype Parity Progress

Plan: `docs/superpowers/plans/2026-05-16-audio-prototype-parity-final.md`

Historical prototype: `desk-v10.html` from the parity session. Durable checked-in reference: `docs/redesign/assets/audio/Audio-Lighting-Aligned-Desk.html`.

## Session Baseline

- Branch: `codex/audio-control-surface-review-fixes` (normal checkout; not `main`/`master`)
- `git status --short`:
  ```text
   M docs/redesign/assets/audio/Audio-Lighting-Aligned-Desk.html
   M docs/redesign/audio.md
   M frontend/app/src/app/audio/AudioWorkspace.module.css
   M frontend/app/src/app/audio/AudioWorkspace.tsx
   M frontend/app/src/app/shared/ShortcutOverlay.tsx
   M frontend/app/src/app/shellData.ts
   M frontend/app/src/app/tauriShellTestBridge.ts
   M frontend/app/tests/operator-shell.spec.ts
   M frontend/packages/engine-client/src/generated/protocol.ts
   M frontend/packages/engine-client/src/generated/snapshots/AudioChannelSnapshot.ts
   M frontend/packages/engine-client/src/generated/snapshots/AudioSceneSnapshot.ts
   M frontend/packages/engine-client/src/generated/snapshots/AudioSnapshot.ts
   M frontend/packages/engine-client/src/index.ts
   M frontend/packages/engine-client/src/store/createShellStore.ts
   M frontend/packages/engine-client/src/transports/fixtureTransport.ts
   M frontend/packages/engine-client/src/types.ts
   M frontend/packages/test-fixtures/src/index.ts
   M native/protocol/generated/v1.schema.json
   M native/protocol/v1.contract.json
   M native/protocol/v1.md
   M native/rust-engine/src/app.rs
   M native/rust-engine/src/audio/channels.rs
   M native/rust-engine/src/audio/helpers.rs
   M native/rust-engine/src/audio/mix_targets.rs
   M native/rust-engine/src/audio/mod.rs
   M native/rust-engine/src/audio/parse.rs
   M native/rust-engine/src/audio/settings.rs
   M native/rust-engine/src/audio/snapshot.rs
   M native/rust-engine/src/audio/snapshots.rs
   M native/rust-engine/src/audio/tests.rs
   M native/rust-engine/src/audio/types.rs
   M native/rust-engine/src/audio_backend.rs
   M native/rust-engine/src/support.rs
  ?? docs/audio-prototype-parity-progress.md
  ?? docs/superpowers/
  ?? frontend/app/src/app/audio/assets/
  ?? frontend/app/src/app/audio/audioContinuousControls.ts
  ?? frontend/app/src/app/audio/audioFormatting.ts
  ?? frontend/app/src/app/audio/audioViewModel.ts
  ?? frontend/app/src/app/audio/components/
  ?? frontend/packages/engine-client/src/generated/snapshots/AudioCapabilitySnapshot.ts
  ?? frontend/packages/engine-client/src/generated/snapshots/AudioDynamicsProcessorSnapshot.ts
  ?? frontend/packages/engine-client/src/generated/snapshots/AudioDynamicsSnapshot.ts
  ?? frontend/packages/engine-client/src/generated/snapshots/AudioEqBandSnapshot.ts
  ?? frontend/packages/engine-client/src/generated/snapshots/AudioEqSnapshot.ts
  ?? frontend/packages/engine-client/src/generated/snapshots/AudioSceneContentsSnapshot.ts
  ?? frontend/packages/engine-client/src/generated/snapshots/AudioScenePreviewSnapshot.ts
  ?? frontend/packages/engine-client/src/generated/snapshots/AudioSendModeSnapshot.ts
  ?? frontend/packages/engine-client/src/generated/snapshots/StoredAudioChannelState.ts
  ?? frontend/packages/engine-client/src/generated/snapshots/StoredAudioMixTargetState.ts
  ?? native/rust-engine/src/audio/clips.rs
  ?? test-results/
  ```
- Prototype line count recorded during the parity session: `16228 desk-v10.html`
- Browser policy: raw local-file Browser access was blocked in the prior audit; use a read-only localhost preview for prototype inspection if needed.

## Progress Ledger

Allowed statuses: `todo`, `in_progress`, `verified`, `blocked:<exact reason>`.

| ID  | Scope                                              | Status   | Files touched                                                                                                                                                                                                                                                                                                                                                                                                                                     | Verification command + result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Remaining gap/blocker                                     |
| --- | -------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| T0  | Record baseline and confirm prototype source       | verified | `docs/audio-prototype-parity-progress.md`                                                                                                                                                                                                                                                                                                                                                                                                         | `git branch --show-current`, `git status --short`, session-local `wc -l desk-v10.html` -> exit 0; recorded branch/status/prototype line count/browser policy                                                                                                                                                                                                                                                                                                                                                                                                                                                       | none                                                      |
| T1  | Layout contract and 1920/2560 geometry             | verified | `docs/audio-prototype-parity-progress.md`, `frontend/app/tests/operator-shell.spec.ts`, `frontend/app/src/app/audio/components/AudioSnapshotDeck.tsx`, `frontend/app/src/app/audio/AudioWorkspace.module.css`                                                                                                                                                                                                                                     | red: `npm run playwright:test --workspace frontend/app -- --grep "audio workspace\|1920\|audio"` -> exit 1, missing `audio-snapshot-deck`; after build: exit 1, 1920 output tier bottom `1146` exceeded tiered mixer bottom `891.515625`; final `npm run build --workspace frontend/app` -> exit 0 and `npm run playwright:test --workspace frontend/app -- --grep "audio workspace\|1920\|audio"` -> exit 0, 17 passed                                                                                                                                                                                            | none                                                      |
| T2  | Protocol documentation drift                       | verified | `docs/audio-prototype-parity-progress.md`, `native/protocol/v1.md`                                                                                                                                                                                                                                                                                                                                                                                | `npm run protocol:check` -> exit 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | none                                                      |
| T3  | Signature visuals and snapshot thumbnails/previews | verified | `docs/audio-prototype-parity-progress.md`, `frontend/app/tests/operator-shell.spec.ts`, `frontend/app/src/app/audio/components/AudioRail.tsx`, `frontend/app/src/app/audio/components/AudioSignalCanvas.tsx`, `frontend/app/src/app/audio/components/AudioTieredMixer.tsx`, `frontend/app/src/app/audio/components/AudioSnapshotDeck.tsx`, `frontend/app/src/app/audio/AudioWorkspace.module.css`                                                 | red: `npm run playwright:test --workspace frontend/app -- --grep "audio"` -> exit 1; missing `audio-master-halo`, and saved snapshot thumb lacked contents marker; after implementation `npm run build --workspace frontend/app` -> exit 0; focused `npm run playwright:test --workspace frontend/app -- --grep "renders the audio workspace\|snapshot capture"` -> exit 0, 2 passed; final `npm run playwright:test --workspace frontend/app -- --grep "audio"` -> exit 0, 16 passed                                                                                                                              | none                                                      |
| T4  | Inspector processing depth                         | verified | `docs/audio-prototype-parity-progress.md`, `frontend/app/tests/operator-shell.spec.ts`, `frontend/app/src/app/audio/components/AudioInspector.tsx`, `frontend/app/src/app/audio/AudioWorkspace.module.css`                                                                                                                                                                                                                                        | red: `npm run playwright:test --workspace frontend/app -- --grep "audio EQ\|audio dynamics\|audio"` -> exit 1, missing EQ frequency controls and dynamics attack controls; `npm run build --workspace frontend/app` -> exit 0 with existing Vite chunk-size warning; focused `npm run playwright:test --workspace frontend/app -- --grep "audio EQ\|audio dynamics"` -> exit 0, 2 passed; final `npm run playwright:test --workspace frontend/app -- --grep "audio EQ\|audio dynamics\|audio"` -> exit 0, 16 passed                                                                                                | blocked:gate range/hold require protocol/product decision |
| T5  | Command palette and interaction parity             | verified | `docs/audio-prototype-parity-progress.md`, `frontend/packages/design-system/src/components/CommandPalette.tsx`, `frontend/app/src/app/audio/AudioWorkspace.tsx`, `frontend/app/src/app/audio/audioViewModel.ts`, `frontend/app/src/app/audio/components/AudioSignalCanvas.tsx`, `frontend/app/src/app/audio/components/AudioTieredMixer.tsx`, `frontend/app/src/app/audio/AudioWorkspace.module.css`, `frontend/app/tests/operator-shell.spec.ts` | red: `npm run playwright:test --workspace frontend/app -- --grep "audio command\|audio group\|audio workspace\|audio"` -> exit 1, global group filter removed playback, arrow keys still changed mix targets, typed command search showed `Results`; `npm run build --workspace frontend/app` -> exit 0 with existing Vite chunk-size warning; focused `npm run playwright:test --workspace frontend/app -- --grep "audio group\|audio command"` -> exit 0, 2 passed; final `npm run playwright:test --workspace frontend/app -- --grep "audio command\|audio group\|audio workspace\|audio"` -> exit 0, 16 passed | none                                                      |
| T6  | Fixture coverage                                   | verified | `docs/audio-prototype-parity-progress.md`, `frontend/packages/test-fixtures/src/index.ts`, `frontend/packages/engine-client/src/transports/fixtureTransport.ts`, `frontend/app/tests/operator-shell.spec.ts`                                                                                                                                                                                                                                      | red: `npm run playwright:test --workspace frontend/app -- --grep "audio-no-send\|snapshot\|audio"` -> exit 1, missing `audio-no-send` fixture data; `npm run build --workspace frontend/app` -> exit 0 with existing Vite chunk-size warning; final `npm run playwright:test --workspace frontend/app -- --grep "audio-no-send\|snapshot\|audio"` -> exit 0, 22 passed                                                                                                                                                                                                                                             | none                                                      |
| T7  | Final verification and visual review               | verified | `docs/audio-prototype-parity-progress.md`                                                                                                                                                                                                                                                                                                                                                                                                         | `npm run build --workspace frontend/app` -> exit 0 with existing Vite chunk-size warning; `npm run protocol:check` -> exit 0; `npm run playwright:test --workspace frontend/app -- --grep audio` -> exit 0, 17 passed; `npm run tauri:visual:review` -> exit 0, 4 visual tests passed, 30 screenshots, summary `artifacts/visual/tauri-cutover/fixture-viewport-summary.json`                                                                                                                                                                                                                                      | none                                                      |

## Notes

- Do not use any audio prototype except the parity-session `desk-v10.html`; use `docs/redesign/assets/audio/Audio-Lighting-Aligned-Desk.html` as the durable checked-in reference.
- Do not implement `Shift +` snapshot capture or topbar-search behavior as required parity without explicit user approval.
- Do not add gate `range` or `hold` protocol fields in this pass.
