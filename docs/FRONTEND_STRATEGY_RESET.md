# Frontend Strategy Reset

Date: 2026-04-21

## Executive summary

The current redesign effort is failing for structural reasons, not because the team lacks visual ideas.

The repo already has a serious UX audit and detailed redesign specs, but the implementation surface is still dominated by a large QML shell, a very large C++ adapter, and workspace panels that are too big and too stateful to iterate on efficiently. Continuing to redesign inside this frontend architecture will keep producing expensive, brittle UI work.

Recommended direction:

1. Stop investing in a long-term QML redesign.
2. Move the frontend to a native webview stack built around HTML/CSS/TypeScript.
3. Keep the Rust engine as the authoritative backend.
4. Prefer `Tauri 2 + React 19 + TypeScript + Vite + CSS custom properties/container queries` over both `Qt/QML` continuation and a return to `Electron`.

This is the cleanest path to a faster design/development loop, stronger frontend hiring ergonomics, better design-system tooling, and a more modern visual ceiling, while preserving the engine and local-first product posture.

## What the codebase says now

The implementation cost of the current shell is already too high:

- QML footprint: about `21,977` LOC under `native/qt-shell/qml/`
- [Main.qml](../native/qt-shell/qml/Main.qml) alone: `3,307` LOC
- Large workspace monoliths still exist:
  - [PlanningProjectDetailDialog.qml](../native/qt-shell/qml/PlanningProjectDetailDialog.qml)
  - [SetupControlSurfacePanel.qml](../native/qt-shell/qml/SetupControlSurfacePanel.qml)
  - [LightingSidebarPanel.qml](../native/qt-shell/qml/LightingSidebarPanel.qml)
  - [LightingSpatialPlotPanel.qml](../native/qt-shell/qml/LightingSpatialPlotPanel.qml)
  - [PlanningBoardPanel.qml](../native/qt-shell/qml/PlanningBoardPanel.qml)
- The C++ bridge is large and expensive to evolve:
  - [EngineProcess.h](../native/qt-shell/src/EngineProcess.h) exposes `136` `Q_PROPERTY`s
  - the same file exposes `82` `Q_INVOKABLE`s

The shell composition is also still centralized in [Main.qml](../native/qt-shell/qml/Main.qml), where the dashboard header and all workspaces are wired through one `StackLayout`, with modal exceptions layered on top.

That means each redesign slice is paying for:

- view design
- layout implementation
- state plumbing
- keyboard routing
- parity harness coupling
- adapter surface growth
- QML-specific performance/debugging work

This is exactly the kind of frontend architecture that makes every visual change feel heavier than it should.

## Why the current redesign is not landing

The repo already contains strong design thinking:

- [docs/UX_AUDIT.md](./UX_AUDIT.md)
- [docs/redesign/dashboard-header.md](./redesign/dashboard-header.md)
- [docs/redesign/lighting.md](./redesign/lighting.md)
- [docs/redesign/planning.md](./redesign/planning.md)
- [docs/redesign/setup.md](./redesign/setup.md)

The problem is not "insufficient mockup quality". The problem is that the redesign is being forced through a shell architecture that is still:

- too monolithic
- too adapter-heavy
- too coupled to implementation details
- too documentation-driven relative to production feedback loops

In practice, the team is redesigning a runtime that is not cheap to redesign.

## Product and UX reset

The app should stop behaving like a dark dashboard product and start behaving like a professional workstation console.

### Information architecture

Recommended shell model:

- `Lighting` and `Audio` are the primary live-operation workspaces.
- `Setup / Commissioning / Support` remains a clearly separate service mode.
- `Planning` is demoted from peer workspace status and becomes a secondary tool:
  - a docked sidecar
  - or an expandable drawer
  - or a dedicated overlay/workbench mode

This aligns better with [docs/DEVELOPMENT.md](./DEVELOPMENT.md), which explicitly prioritizes studio reliability, lighting, audio, and data safety above planning.

### Shell structure

Recommended persistent shell:

1. `Monitor rail` at the top
   - engine health
   - DMX status
   - OSC/audio status
   - save/sync state
   - time/session state
2. `Workspace command rail`
   - workspace switch
   - high-value actions only
   - mode toggles
3. `Primary canvas`
   - almost all vertical space goes here
4. `Context rail`
   - selection details, alerts, recall tools, secondary actions

What should be removed from live-operation surfaces:

- hero copy
- explanatory marketing text
- duplicated stats
- chrome that restates the obvious
- generic card grids where a console layout is more appropriate

### Workspace posture

Recommended workspace postures:

- Lighting: spatial stage/fixture view plus cue-first control model
- Audio: fixed desk surface inspired by the actual TotalMix-style operator workflow
- Planning: schedule/timer/run-sheet helper, not a co-equal fullscreen primary surface
- Setup: explicit modal/service flow with strong success/error states

### Interaction principles

- No normal scroll at `2560x1440`
- Compression and reflow beat stack-and-scroll
- Keyboard affordances must be first-class
- Every degraded hardware state must be impossible to miss
- Motion is purposeful, sparse, and suppressible
- Alerts are semantic, not just color changes

## Recommended technical direction

## Decision

Move to:

- `Tauri 2`
- `React 19`
- `TypeScript`
- `Vite`
- native `CSS` with custom properties, cascade layers, and container queries

Keep:

- the Rust engine
- local-first product posture
- engine-owned device logic and persistence
- explicit IPC boundary

Do not move to:

- Electron
- Qt WebEngine as the long-term architecture
- another large QML rewrite

## Why Tauri 2 is the best fit

### It matches the current backend shape

Tauri supports sidecar binaries directly, which fits the current "native shell + Rust engine child process" model well. Its IPC model is built around asynchronous message passing, commands, and events, which is conceptually close to the current protocol model.

Relevant sources:

- Tauri sidecars: [Embedding External Binaries](https://tauri.app/develop/sidecar/)
- Tauri IPC: [Inter-Process Communication](https://v2.tauri.app/concept/inter-process-communication/)
- Tauri brownfield migration model: [Brownfield Pattern](https://v2.tauri.app/concept/inter-process-communication/brownfield/)

### It gives a better security model than a naive webview shell

Tauri 2 exposes explicit window/webview capabilities and permission boundaries. That is valuable for a mission-critical local app, especially if any future support or diagnostics window has more privilege than the main operator UI.

Relevant source:

- [Capabilities](https://v2.tauri.app/security/capabilities/)

### It keeps the runtime native without reintroducing Electron

The product docs are explicit that the Electron/Next.js runtime is retired. Tauri preserves a native desktop runtime while letting the UI be built with modern web tooling.

### It supports packaging and updates, but this is not free

Tauri has installer/update support, including a plugin-based updater model, but adopting it means revisiting the current QtIFW-based release posture.

Relevant source:

- [Updater](https://v2.tauri.app/plugin/updater/)

This is one of the largest non-UI migration costs and should be treated as such.

## Why not continue with QML

QML is not incapable of good visuals. This repo already proves that some surfaces can look solid. The problem is maintainability and iteration economics in this specific codebase.

Continuing on QML would still require:

- breaking up the existing shell monoliths
- redesigning the C++ adapter surface
- building a stronger component test/story system
- improving layout ergonomics and animation tooling
- continuing to recruit for a narrower frontend stack

That is a large rewrite anyway, but with weaker long-term frontend leverage than a web stack.

## Why not use Qt WebEngine long-term

Qt WebEngine is technically viable, but it is the wrong simplification target.

Qt's own docs make clear that Qt WebEngine embeds Chromium-based web rendering and introduces its own separate process model. If adopted here, the team would still carry:

- Qt/C++ shell complexity
- Chromium/webview complexity
- a JS/HTML/CSS frontend
- the existing Rust engine

That is not a simplification. It is another stack layer.

Relevant source:

- [Qt WebEngine Overview](https://doc.qt.io/qt-6/qtwebengine-overview.html)

Use Qt WebEngine only if you want a short-lived prototype inside the current app. Do not choose it as the final architecture.

## Why not return to Electron

Electron would deliver web ergonomics, but it would also reintroduce a heavier runtime that this repo intentionally retired.

Electron's own docs emphasize that performance is largely the application's responsibility, and that blocking the main or renderer processes is easy to get wrong.

Relevant source:

- [Electron Performance](https://www.electronjs.org/docs/latest/tutorial/performance)

For this product, Tauri is the better "HTML/CSS frontend + native shell" answer.

## Proposed frontend architecture

### Runtime topology

Phase 1 target:

- `Tauri shell`
- existing Rust engine kept as a sidecar child process
- existing line-delimited JSON protocol preserved at first
- web frontend talks to a thin Rust/Tauri bridge

Phase 2 target:

- keep sidecar if process isolation remains desirable
- or merge shell bridge responsibilities into a shared Rust workspace if operationally simpler

Initial recommendation: keep the engine as a sidecar first. Do not combine architectural migration with process-boundary removal.

### Protocol and typing

The current protocol is documented in prose at [native/protocol/v1.md](../native/protocol/v1.md). That is not good enough for a modern web frontend.

Target state:

- machine-readable protocol schema
- generated TypeScript types
- one frontend bridge package that owns:
  - commands
  - event subscriptions
  - snapshot hydration
  - reconnect semantics

The frontend should not hand-roll protocol shapes in UI code.

### State model

Recommended state split:

- Rust engine: authoritative product state
- frontend domain store: cached read models from engine snapshots/events
- frontend local state: ephemeral UI-only state

Do not rebuild business logic in the frontend.

Recommended approach:

- domain snapshots in a typed store
- local component state for small ephemeral interactions
- explicit state machines only for high-risk flows:
  - startup
  - reconnect/recovery
  - commissioning
  - destructive confirmation flows

### UI composition

Recommended frontend boundaries:

- `app-shell`
- `workspace-lighting`
- `workspace-audio`
- `workspace-planning`
- `workspace-setup`
- `design-system`
- `engine-client`

Within workspaces, design around visible operator tasks and state cases, not around large file-based panels.

## Recommended web UI stack details

### Framework

Use `React 19`.

Reason:

- strongest ecosystem for hiring, review, and tooling
- mature Storybook/testing support
- good Tauri integration
- React Compiler reduces manual memoization pressure

Relevant source:

- [React Compiler](https://react.dev/learn/react-compiler)

### Build tool

Use `Vite`.

Reason:

- fast HMR
- simple production pipeline
- clean fit for a component-heavy desktop UI

Relevant source:

- [Vite Getting Started](https://vite.dev/guide/)

### Styling

Use platform-native CSS, not runtime CSS-in-JS.

Recommended primitives:

- CSS custom properties for tokens
- `@property` where typed animatable tokens are worth it
- CSS container queries for component-local adaptation
- CSS grid for workstation layouts
- a small motion layer, not a large animation framework

Relevant sources:

- [Using CSS custom properties](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascading_variables/Using_custom_properties)
- [CSS container queries](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Containment/Container_queries)

### Motion

Use transitions only where they improve continuity or status comprehension.

Recommended:

- small route/workspace transitions
- selection and cue/recall feedback
- no decorative constant movement on live surfaces
- hard support for reduced motion

Relevant sources:

- [View transitions for SPAs](https://web.dev/learn/css/view-transitions-spas?hl=en)
- [prefers-reduced-motion](https://developer.mozilla.org/docs/Web/CSS/%40media/prefers-reduced-motion)

### Accessibility and operator resilience

The web platform gives a better accessibility surface than the current QML shell, but only if used deliberately.

Required:

- announce state changes with ARIA live regions where appropriate
- honor `prefers-reduced-motion`
- honor `prefers-contrast`
- adapt affordances if pointer accuracy changes
- keep hardware alerts semantic and screen-reader visible

Relevant sources:

- [ARIA live regions](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions)
- [prefers-contrast](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-contrast)
- [pointer](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/pointer)

## Design-system recommendations

The design system should become a real product artifact, not just a theme file plus reusable controls.

Target system:

- source-of-truth design tokens in JSON
- generated CSS variables and TypeScript token typings
- icon system with one visual language
- semantic motion tokens
- layout primitives
- operator-state components:
  - health pill
  - alert banner
  - cue card
  - mixer strip
  - fixture chip
  - status rail

The repo should move from "ConsoleTheme + Console components" to a tokenized, documented, testable design system.

## Testing and visual verification

The current parity discipline is strong and should be preserved, but the mechanism should change.

Recommended stack:

- Storybook for isolated component/workspace states
- Playwright for app-level screenshot and behavior testing
- optional Chromatic/Storybook cloud visual review for component regressions

Relevant sources:

- [Playwright visual comparisons](https://playwright.dev/docs/next/test-snapshots)
- [Storybook visual tests](https://storybook.js.org/docs/writing-tests/visual-testing/)

Important note:

Playwright explicitly warns that screenshot baselines vary by OS/platform/environment. That fits this product's existing per-lane parity model well. Keep per-lane baselines; do not demand cross-platform pixel identity.

## Migration plan

### Phase 0: decision and scope lock

- Formally decide that the long-term frontend is web-based.
- Freeze large new QML redesign work.
- Keep QML changes limited to shipping fixes only.
- Update the locked decisions in [AGENTS.md](../AGENTS.md) and [docs/HANDOFF.md](./HANDOFF.md) if leadership accepts this reset.

### Phase 1: technical spike

Goal: prove the stack before large product redesign work.

Deliverables:

- Tauri app boots locally
- Rust engine bundled as sidecar
- frontend receives health/app snapshots
- one read-only workspace implemented
- fullscreen `2560x1440` layout proof
- Playwright screenshot baseline on macOS and Windows

Recommended first slice: read-only lighting shell, because it best tests density, spatial layout, and workstation feel.

### Phase 2: shell and design system

- build monitor rail
- build workspace rail
- build shared layout primitives
- build alert/status system
- build token pipeline
- stand up Storybook

### Phase 3: primary workspaces

Ship in this order:

1. Lighting
2. Audio
3. Setup / Commissioning / Support
4. Planning

That order matches product criticality.

### Phase 4: cutover and retirement

- keep the old Qt shell available behind an internal fallback during transition
- run parallel acceptance on both shells for a bounded period
- retire Qt shell once operator-critical paths are signed off
- use [FRONTEND_CUTOVER_PLAN.md](./FRONTEND_CUTOVER_PLAN.md) as the cutover gate before changing the shipping runtime

## Risks and non-negotiables

### Risks

- packaging/update migration from QtIFW is real work
- the protocol needs to become typed
- web UI success depends on design-system discipline, not just stack choice
- planning posture will require product decisions, not only frontend work

### Non-negotiables

- engine remains authoritative
- no device policy in the frontend
- offline/local-first remains intact
- no normal scroll at `2560x1440`
- mission-critical alerts are first-class
- visual testing remains required

## Bottom line

If the goal is "future UI work should be efficient, modern, and capable of a truly polished senior-team result", then the current QML redesign path should be stopped.

My recommendation is to:

- reset the frontend strategy
- move to `Tauri 2 + React 19 + TypeScript + Vite + CSS`
- keep the Rust engine
- keep the native/offline workstation product shape
- treat design system, typed protocol generation, and visual testing as part of the architecture, not as polish work

That gives you a frontend stack with a much higher ceiling for both execution speed and final quality.
