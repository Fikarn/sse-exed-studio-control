# Greenfield Frontend Recommendation

Date: 2026-04-22

## The question

If I were designing the frontend for `SSE ExEd Studio Control` from scratch today, without inheriting the current frontend architecture, what stack would I choose, how would I structure it, and why?

This document answers that as a greenfield decision, not as an incremental migration plan.

## Short answer

I would build it as:

- `Tauri 2`
- `Rust` shell/backend bridge
- separate `Rust` engine process
- `React 19.2`
- `TypeScript`
- `Vite`
- native `HTML/CSS`
- `SVG` for precise spatial/operator graphics
- `Canvas`/`OffscreenCanvas` + `Web Workers` for high-frequency meters and overlays
- `Storybook` for design-system/workspace development
- `Playwright` for end-to-end and visual regression testing

I would not choose:

- `Electron`
- `Qt/QML`
- `Qt WebEngine`
- `Flutter`
- `Compose Multiplatform`
- `Avalonia`

The strongest rival on pure product-quality grounds would be a split native shell (`SwiftUI/AppKit` on macOS plus `WinUI 3` on Windows), but I would still reject it because it is much less efficient to build and much less aligned with a shared, visual, Codex-assisted workflow. The closest single-codebase native runner-up remains `Slint + Rust`.

## The product constraints that matter

These repo constraints drive the decision more than generic framework preference:

- fixed workstation deployment
- primary target `2560x1440`
- minimum `1920x1080`
- no normal scroll during operation
- local-first and single trusted machine
- lighting and audio are primary live-use surfaces
- planning is secondary
- clear operator recovery and hardware-degraded states matter
- the existing Rust engine boundary is already correct

Relevant repo docs:

- [README.md](../README.md)
- [docs/HARDWARE_PROFILE.md](./HARDWARE_PROFILE.md)
- [docs/ARCHITECTURE.md](./ARCHITECTURE.md)
- [docs/OPERATIONS.md](./OPERATIONS.md)

## What “best” means here

For this project, the best long-term solution is the one that maximizes these properties together:

1. excellent UI iteration speed
2. very high visual ceiling
3. strong accessibility and keyboard support
4. safe native/system integration
5. a realistic hiring and maintenance story
6. robust testing and visual regression infrastructure
7. clear separation between UI and hardware/domain logic
8. strong support for AI-assisted, screenshot-first, iterative frontend work

If a stack is theoretically fast but weak on design-system tooling and frontend iteration, it is not the best stack for this product.

## Candidate stacks

### 1. Tauri 2 + web frontend

Why it is a serious candidate:

- Tauri is designed for desktop apps built from Rust plus HTML rendered in a webview.
- It supports message-passing IPC, custom commands/events, and sidecar binaries.
- It provides capabilities/permissions to constrain frontend access.
- It supports updater and native desktop menu/tray integrations.

Relevant sources:

- [Tauri Architecture](https://v2.tauri.app/concept/architecture/)
- [Tauri Process Model](https://v2.tauri.app/concept/process-model/)
- [Tauri IPC](https://v2.tauri.app/concept/inter-process-communication/)
- [Tauri Sidecars](https://tauri.app/develop/sidecar/)
- [Tauri Capabilities](https://v2.tauri.app/security/capabilities/)
- [Tauri Updater](https://v2.tauri.app/plugin/updater/)
- [Tauri Window Menu](https://v2.tauri.app/learn/window-menu/)

Important nuance:

- On Windows, Tauri uses WebView2 and its docs state that you are guaranteed a relatively recent Chromium build.
- On macOS, it uses the system `WKWebView`, which updates with the OS. Unsupported macOS versions stop receiving WebKit updates.

Relevant source:

- [Tauri Webview Versions](https://v2.tauri.app/reference/webview-versions/)

Verdict:

- best overall choice

### 2. Slint + Rust

Why it is attractive:

- native UI toolkit with first-class Rust integration
- compiled UI
- good desktop support
- low footprint
- strong architectural affinity with a Rust engine

Relevant sources:

- [Slint Overview](https://docs.slint.dev/)
- [Slint Desktop Support](https://docs.slint.dev/latest/docs/slint/guide/platforms/desktop/)
- [Slint Rust Integration](https://docs.slint.dev/latest/docs/rust/slint)
- [Slint Language Integrations](https://docs.slint.dev/latest/docs/slint/language-integrations/)

Why I would still not choose it here:

- smaller ecosystem for high-end desktop product design workflows
- weaker story than the web stack for design-system documentation and UI regression tooling
- smaller hiring pool for frontend/product-design-oriented engineers
- weaker direct leverage from HTML/CSS design handoff

Verdict:

- best native runner-up
- not my final recommendation

### 3. Flutter desktop

Why it is attractive:

- good cross-platform desktop support
- strong animation/rendering model
- solid testing story
- accessibility support

Relevant sources:

- [Flutter Desktop Support](https://docs.flutter.dev/platform-integration/desktop)
- [Flutter Accessibility](https://docs.flutter.dev/ui/accessibility)
- [Flutter Testing](https://docs.flutter.dev/testing/overview)

Why I would not choose it:

- Dart is the wrong adjacent language for a Rust-heavy desktop control product
- weaker fit for HTML/CSS-native design iteration
- harder handoff from web/product design talent
- extra stack divergence with little benefit over Tauri + web

Verdict:

- strong product stack in general
- wrong stack for this repo and team shape

### 4. Compose Multiplatform

Why it is attractive:

- desktop support
- hot reload
- accessibility support
- UI testing APIs

Relevant sources:

- [Compose Hot Reload](https://www.jetbrains.com/help/kotlin-multiplatform-dev/compose-hot-reload.html)
- [Compose Accessibility](https://www.jetbrains.com/help/kotlin-multiplatform-dev/compose-accessibility.html)
- [Compose UI Testing](https://www.jetbrains.com/help/kotlin-multiplatform-dev/compose-test.html)
- [Compose Desktop Accessibility](https://www.jetbrains.com/help/kotlin-multiplatform-dev/compose-desktop-accessibility.html)

Why I would not choose it:

- Kotlin is the wrong ecosystem center for this product
- weaker frontend hiring pool than web
- desktop accessibility caveats matter, especially on Windows/Linux
- no advantage large enough to justify moving away from web tooling

Verdict:

- credible, but not the best fit

### 5. Avalonia

Why it is attractive:

- cross-platform desktop framework
- consistent rendering
- full accessibility support on desktop
- headless testing platform

Relevant sources:

- [Avalonia Overview](https://docs.avaloniaui.net/docs/get-started/)
- [Avalonia Cross-Platform Architecture](https://docs.avaloniaui.net/docs/guides/building-cross-platform-applications/)
- [Avalonia Accessibility](https://docs.avaloniaui.net/docs/app-development/accessibility)
- [Avalonia Headless Testing](https://docs.avaloniaui.net/docs/concepts/headless/)

Why I would not choose it:

- .NET/XAML stack mismatch with a Rust engine
- smaller relevant talent pool than web
- less leverage from modern web UI tooling and design workflows

Verdict:

- respectable option
- not the right long-term center of gravity

### 6. Qt/QML

Why it is attractive:

- mature desktop toolkit
- direct native shell capabilities
- deterministic native distribution story

Why I would not choose it:

- the current repo is already demonstrating its long-term cost profile
- smaller product-frontend ecosystem than web
- slower iteration for the kind of visual/design-system work this product needs

Verdict:

- reject

### 7. Electron

Why it is attractive:

- maximal web compatibility
- huge ecosystem

Relevant source:

- [Electron Performance](https://www.electronjs.org/docs/latest/tutorial/performance)

Why I would not choose it:

- heavier runtime than necessary
- the repo deliberately retired Electron already
- Tauri gives the same web leverage with a better fit for this product

Verdict:

- reject

### Additional credible candidates from the expanded research

These are real options, but they still do not beat `Tauri + React + TypeScript + HTML/CSS` for this product.

#### Native split shell: SwiftUI/AppKit on macOS + WinUI 3 on Windows

Why it is interesting:

- best native platform fit
- excellent OS-level tooling
- first-party accessibility and preview/testing surfaces

Relevant sources:

- [SwiftUI](https://developer.apple.com/documentation/SwiftUI)
- [Previews in Xcode](https://developer.apple.com/documentation/swiftui/previews-in-xcode)
- [AppKit integration](https://developer.apple.com/documentation/swiftui/appkit-integration?language=_5)
- [WinUI 3](https://learn.microsoft.com/en-us/windows/apps/winui/)
- [Windows accessibility testing](https://learn.microsoft.com/en-us/windows/apps/design/accessibility/accessibility-testing)

Why I would still not choose it:

- it means owning two serious frontend codebases
- it is the opposite of efficient cross-platform UI iteration
- it is much less aligned with a Codex-assisted, screenshot-driven, shared-component workflow

Verdict:

- strongest "pure product quality" rival
- rejected because the user explicitly wants efficient modern frontend work and a strong visual AI-assisted loop

#### Dioxus

Why it is interesting:

- Rust-first UI framework
- desktop support
- architectural affinity with a Rust-heavy codebase

Relevant source:

- [Dioxus desktop](https://dioxuslabs.com/learn/0.7/guides/platforms/desktop/)

Why I would still not choose it:

- its own desktop docs note that while desktop uses the system webview, browser APIs are not as available as on the web, which makes browser-native graphics work less straightforward
- smaller ecosystem than mainstream web frontend stacks
- weaker long-term design-system, testing, and hiring story than React + web

Verdict:

- interesting Rust-native alternative
- not the best product/frontend choice

#### Wails

Why it is interesting:

- web frontend inside a native shell
- live development with Vite
- TypeScript model generation

Relevant source:

- [Wails introduction](https://wails.io/docs/introduction/)

Why I would still not choose it:

- it is centered on `Go`, not `Rust`
- this repo already has the right backend language and process posture in `Rust`
- moving from Rust-engine affinity to a Go-centered shell is unnecessary stack drift

Verdict:

- credible in general
- wrong center of gravity for this repo

#### Wry + plain TypeScript/Lit

Why it is interesting:

- `Wry` is the underlying Rust webview layer
- it keeps the shell Rust-native
- `Lit` is standards-based and lightweight

Relevant sources:

- [Wry](https://docs.rs/wry/)
- [Lit](https://lit.dev/)
- [Lit testing](https://lit.dev/docs/tools/testing/)

Why I would still not choose it:

- owning raw `Wry` shell plumbing is work Tauri already solves
- `Lit` is attractive for low-framework UI, but React still wins for app-scale state, hiring, and agent-oriented tooling
- Storybook’s newest AI-facing work is strongest around React, not around a framework-minimal stack

Verdict:

- strong engineering option
- worse total trade-off than `Tauri + React`

#### Lit / web components

Why it is interesting:

- standards-based
- strong style encapsulation through shadow DOM
- framework-light

Relevant sources:

- [Lit styles](https://lit.dev/docs/components/styles/)
- [MDN web components](https://developer.mozilla.org/en-US/docs/Web/Web_Components)

Why I would still not choose it:

- shadow-DOM-heavy component models are not the best fit for a fast-moving application-scale design system with complex app state
- the frontend hiring pool is smaller than React
- it is a good component-primitive story, but not the strongest full product engineering story

Verdict:

- credible for libraries and selective primitives
- not my primary app framework choice

#### React Native for Windows + macOS

Why it is interesting:

- native controls
- React model
- strong platform access

Relevant sources:

- [React Native for Windows](https://microsoft.github.io/react-native-windows/)
- [React Native macOS](https://microsoft.github.io/react-native-macos/docs/intro)

Why I would still not choose it:

- Windows and macOS are separate platform efforts rather than one clean desktop target
- the macOS platform is maintained out-of-tree by Microsoft
- it is a more fragmented desktop story than `Tauri + web`
- weaker leverage from the browser-native CSS/layout/typography model that makes high-end UI iteration fast

Verdict:

- technically viable
- not the cleanest cross-platform desktop strategy

## Final decision

### Chosen stack

If I were starting from scratch, I would choose:

- `Tauri 2`
- `React 19.2`
- `TypeScript`
- `Vite`
- native `CSS`
- separate `Rust` engine process
- DTCG-style design tokens
- `Storybook 10.3`
- `Playwright`

### Why this wins

This stack gives the best combined answer to:

- professional modern visuals
- speed of iteration
- maintainable design-system growth
- strong accessibility primitives
- native packaging and system integration
- a realistic long-term team composition
- a much better fit for AI-assisted frontend workflows

In plain terms:

- `Tauri` is the best native shell for a Rust-backed web UI.
- `React` is not the smallest or trendiest option, but it is the strongest long-term product engineering choice.
- `HTML/CSS` is still the best medium for world-class interaction design, typography, density control, and polished visual systems.
- `Storybook + Playwright + screenshots` give both humans and agents an inspectable, visual development loop.

## Why React, specifically

I would choose `React 19.2`, not because it is theoretically the cleanest framework, but because it is the strongest long-term organizational choice.

Relevant sources:

- [React Versions](https://react.dev/versions)
- [React Compiler](https://react.dev/learn/react-compiler)

Why React wins for this product:

- huge pool of experienced frontend engineers
- best overall tooling gravity
- strong component/test ecosystem
- React Compiler reduces some historical memoization/performance ceremony
- works well with Storybook and Playwright

### Why React over the other credible web options

If the frontend becomes `Tauri + web`, the real greenfield choice is not just "web or native". It is also:

- `React`
- `Vue`
- `Svelte`
- `Solid`

All four can produce good desktop UIs. I would still choose `React` here.

#### Why not Vue

`Vue` is credible and its official docs continue to push a strong `Vite`-based toolchain.

Relevant source:

- [Vue tooling](https://vuejs.org/guide/scaling-up/tooling.html)

Why I would still not choose it:

- smaller hiring pool than React in the kind of product/frontend market this app will need
- less default gravity around the broader desktop-product tooling ecosystem
- fewer senior-review and maintainability advantages than React once the app grows large

Verdict:

- good option
- not the strongest long-term team choice

#### Why not Svelte

`Svelte` is elegant and compiles away much of its runtime cost.

Relevant source:

- [Svelte](https://svelte.dev/)

Why I would still not choose it:

- smaller senior talent pool than React
- less organizational standardization across design-system and enterprise-style frontend workflows
- more risk that future hiring becomes framework-constrained instead of product-constrained

Verdict:

- attractive for a smaller or more opinionated team
- not my long-term choice for this product

#### Why not Solid

`Solid` is technically impressive and its fine-grained reactivity model is attractive for responsive UIs.

Relevant source:

- [Solid getting started](https://docs.solidjs.com/solid-start/getting-started)

Why I would still not choose it:

- smaller ecosystem and talent pool
- weaker long-term maintenance story for a mission-critical desktop control product
- less upside than it appears once the app is already using `Rust` for the hard realtime and device-facing work

Verdict:

- interesting technically
- not the best organizational bet

The common pattern is simple:

- `Vue`, `Svelte`, and `Solid` are all defensible
- `React` is still the strongest choice when hiring, review quality, library coverage, and long-term ownership matter more than framework elegance alone

Why not Next.js:

- this is not a server-rendered web product
- no SEO requirement
- no SSR requirement
- routing is app-state-driven, not URL-driven

Why not Svelte/Solid:

- if I were optimizing for small-team elegance only, I would consider them
- for a long-lived mission-critical product, React’s tooling, hiring, and review advantages win

## How Codex changes the ideal frontend stack

If you expect `Codex` or other coding agents to help build the frontend, the best stack is not merely the one with the nicest runtime model. It is the one that exposes:

- reusable components
- deterministic states
- screenshots and traces
- fast local preview loops
- files and contracts that are easy for both humans and agents to inspect

This pushes the recommendation even harder toward:

- `React`
- `Storybook`
- `Playwright`
- typed tokens
- deterministic fixture data

and away from:

- opaque native UI DSLs
- giant view monoliths
- styling systems that are hard to preview in isolation
- workflows that require manually booting the full app to see every state

Relevant sources:

- [Storybook 10.3](https://storybook.js.org/blog/storybook-10-3/)
- [Storybook](https://storybook.js.org/)
- [Playwright Trace Viewer](https://playwright.dev/docs/trace-viewer-intro)
- [Vite Why](https://vite.dev/guide/why.html)

The strongest signal here came from Storybook’s own direction. Its April 6, 2026 release explicitly frames Storybook 10.3 as "component-driven development for humans and agents" and says Storybook MCP for React gives AI agents direct access to real components, stories, docs, and tests.

That matters because it points toward a frontend architecture where AI agents operate on real UI artifacts instead of guessing.

## Codex-friendly frontend workflow

If this frontend is rebuilt, I would design the workflow around visual iteration from day one.

### 1. Component-first, story-first development

Every meaningful UI primitive and every important workspace state gets a Storybook story.

Relevant sources:

- [Storybook](https://storybook.js.org/)
- [Component-driven development tutorial](https://storybook.js.org/tutorials/intro-to-storybook/react/en/simple-component)

This gives you:

- isolated states
- shareable previews
- reproducible edge cases
- a clear review surface for both humans and agents

### 2. Stories as the contract for AI-assisted frontend work

For Codex-assisted work, a story is better than a vague prompt. It gives the agent:

- the real component
- the target state
- the accepted props/data shape
- an immediately inspectable output

With Storybook 10.3, this direction is becoming more explicit: the official Storybook team is building agent-facing workflows around real components and stories, not around free-form code generation.

### 3. Screenshot-first review loop

The loop should be:

1. define or update the story/state
2. render it locally with Vite-fast feedback
3. capture screenshots
4. compare them automatically
5. inspect failures visually
6. patch and repeat

Relevant sources:

- [Vite Why](https://vite.dev/guide/why.html)
- [Storybook Visual Tests](https://storybook.js.org/docs/writing-tests/visual-testing/)
- [Playwright Visual Comparisons](https://playwright.dev/docs/next/test-snapshots)

Vite matters here because its dev server startup is nearly instant and its HMR updates the changed module without a full reload. That is exactly the kind of loop you want for iterative UI work.

### 4. Traces for behavioral debugging

When a UI test fails, the agent should not be debugging blindly from logs. It should have a trace artifact.

Relevant source:

- [Playwright Trace Viewer](https://playwright.dev/docs/trace-viewer-intro)

Playwright’s trace viewer is valuable because it lets you go step by step and visually inspect what happened during a failing flow.

### 5. Keep Playwright component testing secondary, not primary

Playwright component testing is promising, but the official docs still label it experimental.

Relevant source:

- [Playwright components](https://playwright.dev/docs/test-components)

So I would not make it the architectural center of the workflow. I would make:

- `Storybook` the primary component/workspace lab
- `Playwright` the primary flow and screenshot harness

### 6. Build a dedicated UI lab, not just the shipping app

Greenfield, I would create a first-class `frontend-lab` layer made of:

- design tokens
- primitive components
- workspace mock states
- full-screen shell scenarios
- degraded-state scenarios
- keyboard and focus scenarios

This lab should be runnable without the engine.

Then each approved surface moves through three stages:

1. `prototype state`
2. `story/workspace state`
3. `engine-wired production state`

That makes Codex effective because the agent can iterate visually against stable fixtures before touching engine integration.

### 7. Preserve the repo’s current parity discipline, but in web-native form

This repo already has the right instinct: deterministic states, visual baselines, and explicit acceptance loops.

What I would carry forward is:

- deterministic workspace fixtures
- pixel baselines per lane
- live verification for critical operator flows
- real screenshots before acceptance

What changes is the mechanism:

- Storybook stories instead of ad hoc shell states for component/slice work
- Playwright screenshots and traces instead of QML-only parity harnesses
- a frontend-lab preview path that agents can inspect rapidly

### 8. Make screenshots and reference images first-class inputs

Modern OpenAI tooling explicitly supports image inputs and visual analysis, and image generation/editing APIs support iterative visual work across multiple turns.

Relevant source:

- [OpenAI images and vision](https://developers.openai.com/api/docs/guides/images-vision)

That does not mean "design with AI slop." It means the workflow should assume that screenshots, mockups, and reference images are normal development inputs.

For this project, that implies:

- every major state should be capturable as an image
- the design system should render cleanly in isolation
- visual targets should be explicit enough that an agent can compare "what is" vs "what should be"

## Why HTML/CSS is the right UI medium

The web platform is the strongest long-term UI medium for this product because it provides:

- best typography control
- strongest layout primitives
- best accessibility substrate
- mature animation and state styling
- best design-system tooling

The CSS features I would explicitly build around:

- custom properties for tokens
- typed custom properties via `@property` where it materially helps
- cascade layers
- container queries for component-local responsiveness
- subgrid for aligned dense layouts
- `prefers-reduced-motion`
- `prefers-contrast`
- standard pointer/hover media queries
- progressive use of view transitions
- progressive use of newer features like `@scope`, not baseline dependence on them

Relevant sources:

- [CSS custom properties](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascading_variables/Using_custom_properties)
- [Registering custom properties](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Properties_and_values_API/Registering_properties)
- [@layer](https://developer.mozilla.org/en-US/docs/Web/CSS/%40layer)
- [CSS container queries](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Containment/Container_queries)
- [Subgrid](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Grid_layout/Subgrid)
- [prefers-reduced-motion](https://developer.mozilla.org/docs/Web/CSS/%40media/prefers-reduced-motion)
- [prefers-contrast](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-contrast)
- [pointer media feature](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/pointer)
- [View transitions for SPAs](https://web.dev/learn/css/view-transitions-spas?hl=en)

Important nuance:

- because Tauri rides system webviews, I would choose the stable CSS baseline conservatively
- `container queries`, `subgrid`, custom properties, and cascade layers are strong baseline bets
- newer features like `@scope` are useful, but I would treat them as progressive enhancement rather than architectural dependency

## How I would structure the application

## Runtime architecture

I would keep a multi-process design:

1. `Tauri shell process`
   - owns windowing, updater, menus, tray, file access, sidecar lifecycle
2. `Rust engine process`
   - owns persistence, hardware I/O, safety rules, diagnostics, recovery logic
3. `Web frontend`
   - runs inside the Tauri webview
   - renders the operator UI
   - never owns business policy

Why not collapse engine + shell into one process?

- the hardware/device side is the risky part
- process isolation is valuable for resilience
- the current architectural instinct is correct

Relevant source:

- [Tauri Process Model](https://v2.tauri.app/concept/process-model/)

## Data flow

I would use this pattern:

1. Engine emits typed snapshots and events
2. Tauri Rust backend mediates engine lifecycle and IPC
3. Frontend consumes typed commands/events through one bridge package
4. Frontend stores only:
   - cached read models
   - transient UI state

The frontend should not recreate business logic. It should consume the engine contract.

## Protocol

The current repo has a prose IPC document. From scratch, I would make the protocol formally typed.

Target:

- machine-readable schema for commands/events/snapshots
- generated TypeScript types
- generated Rust request/response types where useful
- protocol versioning checked centrally

The bridge layer should be the only code that knows transport details.

## Frontend project structure

I would structure the frontend like this:

- `app-shell`
- `engine-client`
- `design-system`
- `workspace-lighting`
- `workspace-audio`
- `workspace-setup`
- `workspace-planning`
- `shared-graphics`
- `test-fixtures`

### State model

I would use three state layers:

1. `engine state`
   - authoritative
   - external to React
2. `workspace/app store`
   - typed cached snapshots
   - subscriptions
   - selection and derived view state
3. `component-local state`
   - dialogs
   - hover/focus
   - temporary inputs

For risky operational flows, I would use explicit state machines:

- startup
- recovery
- commissioning
- destructive confirms
- reconnect flows

## Rendering model

Not every surface should use the same rendering primitive.

### DOM/CSS

Use DOM/CSS for:

- shell chrome
- forms
- buttons
- text-heavy operator controls
- lists, chips, badges, tables
- dialog and setup flows

Reason:

- accessibility
- maintainability
- excellent layout and typography control

### SVG

Use SVG for:

- stage plot
- fixture placement
- cue curves and structured overlays
- hit-tested spatial controls where precision matters

Reason:

- crisp scaling
- inspectable structure
- good event handling
- easier than canvas for semantic vector UI

### Canvas / OffscreenCanvas / Workers

Use canvas-based rendering for:

- high-frequency audio meters
- DMX monitor strips
- large animated overlays
- dense real-time waveform-like visuals

Relevant sources:

- [Canvas API](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API)
- [OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas)
- [Using Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers)

Reason:

- keep frequent redraw work away from ordinary DOM layout
- preserve responsiveness under live updates

I would not use WebGPU as a baseline dependency for v1. It is unnecessary risk for this product.

## UX design I would build

## Product posture

I would not treat this as a generic dark dashboard.

I would design it as a professional control console:

- dense
- calm
- highly legible
- explicit about degraded states
- fast under pressure

### Shell model

The shell would have four persistent regions:

1. `Monitor rail`
   - engine status
   - DMX
   - OSC/audio
   - storage/save/sync
   - time/session state
2. `Workspace rail`
   - Lighting
   - Audio
   - Planning
   - Setup / Support
3. `Primary canvas`
   - almost all screen real estate
4. `Context rail`
   - inspector
   - recall controls
   - hardware notices
   - selection details

### Workspace priorities

I would design the workspaces like this:

- `Lighting`: the hero workspace
  - spatial-first
  - cue rail
  - persistent inspector
  - live DMX visibility
- `Audio`: fixed desk-first
  - destination mix selection
  - strips always visible
  - safety controls explicit
  - meter confidence and sync state impossible to miss
- `Planning`: secondary operational helper
  - dockable or workbench-mode
  - timeline/schedule-first, not kanban-first
- `Setup`: service mode
  - import/probe/map/verify/publish
  - explicit full-mode separation from live console

### Core interaction rules

- no standard scroll at `2560x1440`
- keyboard is first-class
- every primary action has visible state feedback
- recovery states are large, explicit, and semantic
- density is adjustable, but constrained to tested presets
- motion is meaningful and sparse

## Design system I would create

I would build a real design system from the start.

### Tokens

Source of truth:

- JSON token files aligned to the DTCG format
- token metadata kept explicit: type, description, deprecation status, alias relationships

Relevant source:

- [Design Tokens Format Module 2025.10](https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/)
- [Style Dictionary](https://styledictionary.com/)

Generated outputs:

- CSS variables
- TypeScript token typings
- generated token docs
- optional platform exports if a future native split shell ever appears
- documentation pages

Build layer:

- I would use `Style Dictionary` as the token export layer because it is explicitly forward-compatible with the Design Tokens Community Group spec and is built to emit platform-specific outputs.

### Token categories

At minimum:

- color
- typography
- spacing
- radii
- stroke widths
- shadows
- motion durations
- easing curves
- z-layers
- focus styles
- alert/status semantics
- surface elevation

### CSS architecture

I would define CSS architecture explicitly instead of letting it emerge ad hoc.

Recommended layer order:

- `reset`
- `tokens`
- `primitives`
- `components`
- `utilities`
- `overrides`

Why:

- cascade behavior becomes intentional
- component portability improves
- override fights drop sharply as the codebase grows

### Component set

I would keep the component set intentionally small and operational:

- button
- segmented control
- field/input
- select/combobox
- badge
- health pill
- alert banner
- dialog/sheet
- inspector section
- cue row
- meter strip
- fixture chip
- workspace rail item
- keyboard hint

The workspaces should not invent one-off visual systems.

## Accessibility baseline

The app must be operable with keyboard alone and must communicate dynamic state changes clearly.

Relevant sources:

- [ARIA live regions](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/ARIA_Live_Regions)
- [prefers-reduced-motion](https://developer.mozilla.org/docs/Web/CSS/%40media/prefers-reduced-motion)
- [prefers-contrast](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-contrast)
- [What’s new in WCAG 2.2](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/)
- [Dialog (Modal) Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)

Required baseline:

- semantic keyboard navigation
- visible focus at all times
- live announcements for hardware state changes where appropriate
- reduced motion mode
- higher-contrast mode adjustments
- color is never the only carrier of meaning
- focus is not obscured
- target sizes meet WCAG 2.2 expectations
- drag actions always have non-drag alternatives

Guiding rule:

- prefer semantic HTML first
- use ARIA patterns where necessary
- do not build custom widgets casually; WAI’s guidance that "No ARIA is better than Bad ARIA" is the right default posture

## Testing and verification

I would make UI verification part of the architecture, not a later add-on.

### Storybook

Use Storybook as the primary workshop for:

- component development
- workspace states
- visual review
- documented operator states
- AI-assisted frontend work against real components and stories

Relevant sources:

- [Storybook Visual Tests](https://storybook.js.org/docs/writing-tests/visual-testing/)
- [Storybook 10](https://storybook.js.org/releases/10.0)
- [Storybook 10.3](https://storybook.js.org/blog/storybook-10-3/)

Additional note:

- Storybook is not just useful for humans anymore. The official 10.3 release explicitly positions it as a component-driven workflow for humans and agents, which aligns unusually well with the way you want to use Codex.

### Playwright

Use Playwright for:

- end-to-end tests
- packaged-app UI smoke tests
- visual regression baselines
- cross-browser/webview validation where useful
- traces and debugging artifacts for failed flows

Relevant sources:

- [Playwright Installation](https://playwright.dev/docs/next/intro)
- [Playwright Configuration](https://playwright.dev/docs/test-configuration)
- [Playwright Visual Comparisons](https://playwright.dev/docs/next/test-snapshots)
- [Playwright Projects](https://playwright.dev/docs/test-projects)
- [Playwright Trace Viewer](https://playwright.dev/docs/trace-viewer-intro)

Important note from Playwright:

- screenshot consistency depends on environment

That fits this product well. I would keep per-lane baselines, not cross-platform pixel identity.

I would not make Playwright component testing the architectural center because the official docs still describe it as experimental. Storybook remains the better primary visual lab.

## The trade-offs I accept

This recommendation is not free.

### Trade-off 1: system webview differences

Tauri uses the OS webview. That means:

- Windows is effectively recent Chromium via WebView2
- macOS rides system WebKit

This is acceptable for a controlled workstation product, but only if the supported OS floor is kept current.

### Trade-off 2: desktop packaging work still exists

Tauri reduces runtime weight, but it does not remove release engineering work. Packaging, signing, updater behavior, and sidecar distribution still need serious engineering.

### Trade-off 3: frontend discipline still matters

A web stack does not automatically produce a great operator console. The win comes from:

- a strong design system
- a strong protocol layer
- disciplined workspace composition
- clear operational UX priorities

## Why this is the best long-term solution

From scratch, the best long-term frontend for this project is not the “most native” stack. It is the stack that gives the highest quality control surface with the least long-term design and implementation friction.

That stack is:

- native shell via `Tauri`
- domain authority in `Rust`
- UI in `React + TypeScript + HTML/CSS`
- graphics split between `DOM`, `SVG`, and `Canvas`
- strong design-system and visual-test infrastructure from day one

If the goal is:

- modern
- polished
- efficient to build
- maintainable by a strong senior team
- compatible with the existing Rust engine posture
- friendly to a visual, iterative Codex-assisted development process

then this is the stack I would choose.

The only rival I take seriously on product quality alone is a split native shell:

- `SwiftUI/AppKit` on macOS
- `WinUI 3` on Windows

But that loses on the exact things the user said matter:

- efficient frontend work
- one shared UI architecture
- AI-assisted visual iteration

## Final recommendation

If the project were greenfield, I would formally choose:

1. `Tauri 2`
2. `Rust engine process`
3. `React 19.2 + TypeScript`
4. `Vite`
5. native `CSS`, not utility-first-first CSS as the architectural center
6. `SVG` for structured spatial graphics
7. `Canvas`/`OffscreenCanvas` for high-frequency visuals
8. `Storybook 10.3`
9. `Playwright`
10. DTCG-style design tokens as the design-system source of truth

That is the best long-term frontend architecture I can recommend for this product.
