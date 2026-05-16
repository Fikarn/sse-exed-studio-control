# Audio UX Functionality Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` or `superpowers:subagent-driven-development`. Keep the visible progress tracker updated after every goal. Do not start a goal until the prior goal's acceptance checks pass.

**Goal:** Bring the Audio workspace UX and interaction model to functional parity with `/Users/EdvinLandvik/Desktop/2/desk-v10.html`, using engine-backed state/actions for prototype behaviors.

**Architecture:** React remains a view/controller over engine-owned `audio.snapshot` state. New persistent audio behavior belongs in `native/rust-engine` and `native/protocol`; React may hold only short-lived drag drafts. Existing visual parity must be preserved.

**Tech Stack:** Tauri 2, React 19.2, TypeScript, Vite, Rust engine, protocol codegen, Playwright, Studio Preview visual review.

---

## Summary

Fix all 22 UX/functionality findings from the prototype comparison. The largest correction is replacing the single `actionsAllowed` blanket gate with capability-specific gates so verified-state trust warnings do not make the mixer unusable. Engine-backed support must be added for snapshot capture contents, clip clearing, Master/Submix view state, EQ, dynamics, and send-mode controls before those controls become live.

## Progress Protocol

Create the visible tracker before implementation and keep exactly one item in progress:

| ID  | Goal                                                                                                                 | Status  |
| --- | -------------------------------------------------------------------------------------------------------------------- | ------- |
| G0  | Save this plan to `docs/superpowers/plans/2026-05-15-audio-ux-functionality-parity.md`                               | Pending |
| G1  | Add engine/protocol capability model and remove blanket UI action gating                                             | Pending |
| G2  | Make not-verified mixer controls usable with truthful sync/error behavior                                            | Pending |
| G3  | Add engine-backed Master/Submix view state and shortcut behavior                                                     | Pending |
| G4  | Add group filtering, selection clearing, target-picker, and output-selection workflow parity                         | Pending |
| G5  | Add solo chip removal and engine-backed clip clear behavior                                                          | Pending |
| G6  | Add engine-backed snapshot capture, save, rename, delete, recall contents, and previews                              | Pending |
| G7  | Add engine-backed EQ editing                                                                                         | Pending |
| G8  | Add engine-backed dynamics editing                                                                                   | Pending |
| G9  | Add engine-backed send mode controls and send sliders for all destinations                                           | Pending |
| G10 | Align input hardware controls with prototype: 48V, polarity, Hi-Z/Inst, AutoSet; remove Pad from UFX III mic preamps | Pending |
| G11 | Complete command palette, shortcut overlay, and context-menu parity                                                  | Pending |
| G12 | Validate tests, typecheck, lint, protocol generation, and Tauri Studio Preview                                       | Pending |

Every checkpoint report must use:

`Progress: G# complete. Closed findings: F#. Still open: F#.`

## Finding Coverage

| Finding | Required Closure                                                                               | Goal  |
| ------- | ---------------------------------------------------------------------------------------------- | ----- |
| F1-F4   | `OSC NOT VERIFIED` must not disable editable mixer state; Sync must be actionable and truthful | G1-G2 |
| F5      | Prototype allows interactive controls under warnings                                           | G1-G2 |
| F6      | Master/Submix toggle and `V` view shortcut parity                                              | G3    |
| F7      | Group chips filter strips                                                                      | G4    |
| F8      | Solo banner chips remove individual solos                                                      | G5    |
| F9-F10  | Clip clear works per strip and all-clear                                                       | G5    |
| F11-F13 | Snapshot capture/save/preview functionality                                                    | G6    |
| F14     | Interactive EQ                                                                                 | G7    |
| F15     | Interactive dynamics                                                                           | G8    |
| F16     | Send sliders and send mode toggles                                                             | G9    |
| F17     | Correct input hardware controls                                                                | G10   |
| F18-F19 | Output selection preserves source inspector; blank tier space clears source                    | G4    |
| F20     | Context menu working Reset, Rename, Phase                                                      | G11   |
| F21-F22 | Command palette and shortcut overlay parity                                                    | G11   |

## Key Changes

- Extend protocol and generated types with:
  - `audio.viewMode.update` or `viewMode` on `audio.settings.update`: `"submix" | "master"`.
  - `audio.clip.clear`: `{ channelId?: string }`.
  - Store EQ, dynamics, and send-mode state on engine-owned channel snapshots.
  - Store snapshot scene contents: channel faders, per-output mix levels, mute/solo, preamp hardware state, mix-target levels, EQ, dynamics, and send modes.
  - Add engine-client methods for audio snapshot create/update/delete, clip clear, EQ update, dynamics update, and send-mode update.
- Replace frontend `actionsAllowed` with explicit capabilities:
  - `canEditMixerState`: true when OSC is enabled, even if not verified.
  - `canSync`: true when OSC is enabled; engine may reject with actionable failure.
  - `canRecallConsoleSnapshot`: true only when engine says recall is safe.
  - `canEditProcessing`, `canClearClips`, `canCaptureSnapshot`, `canUseMasterView`: driven by engine snapshot capabilities.
- Keep React drafts short-lived: drag previews, hover previews, open menus, tab state, and command palette query only.

## Implementation Changes

- Engine/protocol:
  - Update `native/protocol/v1.contract.json`, Rust audio types, parsers, snapshot builders, audio persistence helpers, simulated backend, and generated TypeScript protocol outputs.
  - Add Rust tests for all new audio actions, including not-verified mixer edits, rejected sync, clip clear, snapshot content capture/recall, EQ, dynamics, sends, and Master/Submix state.
- Frontend:
  - Update Audio view model to expose capabilities and prototype interaction state without re-deriving policy in components.
  - Wire faders, preamps, mute/solo, dim/mono/talk, send sliders, and reset controls to the new capability model.
  - Enable group-chip filtering, blank-space deselect, output target selection without destroying source inspection, solo-chip removal, clip clear, snapshot capture/save/rename/delete, EQ editing, dynamics editing, send-mode toggles, context menu actions, palette actions, and shortcut overlay entries.
  - Preserve existing visual parity and no-scroll operation at `2560x1440` and `1920x1080`.

## Test Plan

Run focused tests after each relevant goal, then the full gate at the end.

- Rust:
  - `cargo test -p studio-control-engine audio`
  - Add coverage for protocol parse errors, persistence round-trips, and unsupported capability rejection.
- Frontend:
  - `npx playwright test tests/operator-shell.spec.ts -g "audio"`
  - Add scenarios for:
    - faders move in `audio-not-verified`,
    - Sync is enabled and reports engine rejection when probe is missing,
    - `V` toggles Master/Submix,
    - group chips filter and clear,
    - solo chip removes only that solo,
    - clip clear works per-channel and all-channel,
    - snapshot capture/save/rename/delete/recall changes engine-backed state,
    - EQ points/bands edit and persist,
    - dynamics knobs/bypass edit and persist,
    - send mode toggles persist,
    - output selection preserves source inspector,
    - blank tier-space clears source selection,
    - command palette and shortcut overlay include prototype actions.
- Final validation:
  - `npm run protocol:generate`
  - `npm run frontend:typecheck`
  - `npm run lint`
  - `npm run tauri:visual:review -- --fixtures=audio-populated,audio-state-assumed,audio-not-verified,audio-offline,audio-action-failed,audio-1920-fallback --sizes=2560x1440,1920x1080 --port=4174`
  - Use the open Tauri Studio Preview or fixed studio monitor for final human comparison; browser-only evidence is not sufficient.

## Assumptions

- Save path is `docs/superpowers/plans/2026-05-15-audio-ux-functionality-parity.md`.
- The existing visual parity plan remains unchanged.
- Prototype authority is `/Users/EdvinLandvik/Desktop/2/desk-v10.html`.
- Scope is Audio working space only; shared shell/header/branding bar remains unchanged.
- Engine-backed means state, persistence, and command policy live in Rust/protocol, not React.
- Real hardware behavior remains truthful: if a feature cannot affect hardware yet, the engine exposes it as native/simulated control state with clear capability status rather than pretending it mutated hardware.
