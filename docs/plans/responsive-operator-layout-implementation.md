# Responsive Operator Layout Implementation Brief

Date: 2026-05-03

This brief started as a fresh-session handoff for implementing responsive and resizeable operator layouts in SSE ExEd Studio Control, with primary focus on the Lighting page. The implementation landed in [PR #71](https://github.com/Fikarn/sse-exed-studio-control/pull/71) on `2026-05-03` and this file now also records the plan-to-implementation outcome.

## Completion Record

Status: complete and merged.

Merge commit: `4af7e8b8427cff78837054326478e1a67398154c`

Key outcomes:

- `OperatorLayoutProvider` measures the app body with logical CSS pixels and exposes layout mode, scale, size, and diagnostic `devicePixelRatio` without using physical pixels for layout decisions.
- The supported layout modes are `studioFull`, `desktopCompact`, `narrowUtility`, and `constrained`.
- Lighting preserves the rail/stage/inspector model at studio size, keeps a compact three-pane layout at desktop-compact size, and uses a right inspector drawer in narrow utility mode.
- Lighting toolbar controls are priority grouped. Status/title, search, patch, add/select, preview/live state, and overflow stay primary; secondary actions move into overflow as the viewport narrows.
- Stage zoom is separate from UI scale. The stage supports `Fit Room`, `Fill Desk`, `100%`, and bookmarks.
- UI scale supports `90%`, `100%`, `110%`, and `125%` through CSS token classes rather than a whole-app transform.
- Tauri shell owns window-layout preference persistence and recovery. Engine protocol, fixture/device state, hardware policy, product persistence, and DB logic were not moved into React.
- The current-hardware human review path is Scaled Studio Preview through the exact command-palette item `Studio Preview: Enter 2560x1440 Review`. BetterDisplay is optional fallback tooling only.

Validation recorded for PR #71:

- Human visual review approved in Scaled Studio Preview on current hardware.
- `npm run frontend:foundation` passed, including Storybook and 39 Playwright tests.
- `npm run native:check` passed.
- `npm run tauri:visual:review` passed with 30 screenshots, 0 failures, and 4 shell window preference recovery tests passed.
- Advisory GitHub checks passed before merge.

## Fresh Codex Prompt

```text
We are in /Users/EdvinLandvik/Projects/EdvinProjectManagerCodex.

Please implement the responsive/resizable operator layout plan for SSE ExEd Studio Control, with primary focus on the Lighting page. First read AGENTS.md and follow repo instructions. Inspect the current implementation before editing.

Product constraints:
- App is Tauri 2 + React 19.2 + TypeScript + Vite frontend, Rust engine separate.
- Do not move device state, persistence policy, hardware policy, or DB logic into React.
- Primary premium target remains fullscreen 2560x1440 on the fixed studio monitor.
- Normal live-operation floor is 1920x1080 logical pixels.
- 1280x800 should be supported as a utility/minimum mode, not as the full simultaneous show-control surface.
- Use logical viewport/CSS pixels for layout decisions, not physical monitor resolution.
- No document-level scrolling during normal operation. Panel-level scrolling inside rail/inspector/drawer is acceptable in compact modes.

Research direction to apply:
Modern premium tools do not rely on one arbitrary pixel-perfect layout. They use named workspaces, saved/recalled layouts, compact modes, panel resize/collapse/drawer behavior, explicit UI scaling, and separate content/canvas zoom.

Relevant references:
- VS Code custom layout: https://code.visualstudio.com/docs/configure/custom-layout
- JetBrains compact mode: https://www.jetbrains.com/help/rider/New_UI.html
- Blender workspaces and resolution scale: https://docs.blender.org/manual/en/4.3/interface/window_system/workspaces.html and https://docs.blender.org/manual/en/4.3/editors/preferences/interface.html
- AutoCAD workspaces: https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-DidYouKnow/files/GUID-1D87D5C3-21BC-499E-A560-79592348D47E.htm
- TouchDesigner layouts: https://docs.derivative.ca/Layout
- Resolume layouts/multiple screens: https://resolume.com/support/en/7.9/layouts
- QLab workspace/inspector/sidebar: https://qlab.app/docs/v5/fundamentals/workspace/
- Windows DPI/DIPs: https://learn.microsoft.com/en-us/windows/win32/learnwin32/dpi-and-device-independent-pixels
- macOS points/backing pixels: https://developer.apple.com/library/archive/documentation/GraphicsAnimation/Conceptual/HighResolutionOSX/Explained/Explained.html

Implementation plan:

1. Add a frontend OperatorLayoutProvider under frontend/app/src/app/.
   - Measure available app body using ResizeObserver.
   - Expose layoutMode, uiScale, isStudioSurface, isCompact, isNarrow, body width/height, and devicePixelRatio only for diagnostics.
   - Modes:
     - studioFull: >=1920x1080 logical pixels.
     - desktopCompact: >=1440x900 and below studio.
     - narrowUtility: >=1280x800 and below compact.
     - constrained: below minimum, dev/test warning only.
   - Keep layout mode based on CSS/logical viewport size, not physical pixels.

2. Add shell-owned window preference persistence in native/tauri-shell/src/main.rs.
   - Persist launchMode, last logical size, position, fullscreen state, monitor identity when available, and scale factor in a Tauri config JSON file.
   - First run still routes to preferred 2560x1440 or 1920x1080 studio monitor fullscreen.
   - If saved monitor is unavailable, fall back to centered 1600x960 windowed mode.
   - Add actions: Enter Studio Fullscreen, Use Windowed Layout, Reset Window Layout.
   - Keep this shell/UI state separate from engine protocol and product/device state.

3. Refactor Lighting layout.
   - Current files to inspect include:
     - frontend/app/src/app/lighting/LightingWorkspace.tsx
     - frontend/app/src/app/lighting/LightingWorkspace.module.css
     - frontend/app/src/app/lighting/useResizableColumns.ts
     - frontend/app/src/app/lighting/LightingToolbar.tsx
     - frontend/app/src/app/lighting/LightingToolbar.module.css
     - frontend/app/src/app/lighting/LightingInspectorTabs.tsx
     - frontend/app/src/app/lighting/StagePlot.tsx
     - frontend/app/src/app/lighting/StagePlotControls.tsx
   - studioFull: preserve the current rail/stage/inspector model.
   - desktopCompact: keep three panes but reduce chrome, clamp saved rail/inspector widths, and avoid toolbar clipping.
   - narrowUtility: use rail + stage as base layout; move inspector into a right drawer opened by fixture/scene selection or an Inspector button.
   - Persist column widths per layout mode rather than one global rail/inspector width.

4. Refactor LightingToolbar into priority groups.
   - Always visible: status/title, search, patch, add/select, preview/live state, overflow.
   - Compact overflow: highlight, solo, finder, lower-frequency scene/maintenance controls.
   - Narrow overflow: most secondary controls behind ...; primary controls icon-first with tooltips.
   - Use existing design-system primitives and lucide icons where available.

5. Separate stage zoom from UI scale.
   - Stage plot gets Fit Room, Fill Desk, 100%, and bookmark recall.
   - studioFull keeps current operator-familiar fill behavior unless changed by user.
   - desktopCompact and narrowUtility default to Fit Room to preserve spatial accuracy.
   - UI scale supports 90%, 100%, 110%, 125%; implement through token/classes, not a whole-app CSS transform.

6. Extend validation.
   - Extend scripts/tauri-visual-review.mjs responsive coverage to:
     1280x800, 1440x900, 1600x960, 1728x1117, 1920x1080, 2560x1440.
   - Add assertions:
     - no document-level scroll at supported sizes;
     - toolbar primary controls visible and unclipped;
     - overflow menu exposes hidden secondary actions;
     - inspector drawer opens/closes and exposes selected fixture controls;
     - stage plot remains usable and does not collapse below minimum bounds;
     - layout mode changes with viewport CSS size, not physical pixels or devicePixelRatio;
     - saved fullscreen/windowed layout recovers safely when saved monitor is missing.

Preferred execution order:
1. Add layout measurement provider and mode constants with tests.
2. Add shell window preference read/write and reset fallback.
3. Refactor Lighting toolbar priority/overflow.
4. Refactor Lighting workspace CSS/TSX modes.
5. Add inspector drawer and mode-keyed column persistence.
6. Add stage plot fit/fill controls.
7. Extend visual review and Playwright coverage.
8. Update docs with supported logical-size envelope and review workflow.

Validation commands to run when done:
- npm run frontend:typecheck
- npm run frontend:foundation
- npm run tauri:visual:review

For operator-visible layout changes, also inspect visual review evidence and use Scaled Studio Preview or the fixed studio monitor for human review. BetterDisplay is optional fallback tooling only.

Please implement end to end, keep changes scoped, avoid unrelated refactors, and report changed files plus validation results.
```

## Implementation Summary

The implementation created a professional workspace system rather than a fully freeform docking framework. Keep the studio fullscreen experience optimized for 2560x1440, but make the app predictable and usable when resized or opened on different monitors.

Use named layout modes:

- `studioFull`: full live operator layout for `>=1920x1080` logical pixels.
- `desktopCompact`: compact three-pane layout for `>=1440x900`.
- `narrowUtility`: minimum utility layout for `>=1280x800`.
- `constrained`: below minimum, only for diagnostics.

Use logical viewport/CSS pixels for all thresholds. Physical monitor resolution is not reliable because Windows display scaling, macOS Retina backing scale, and Tauri logical sizes all separate physical pixels from UI layout units.

## Research Anchors

The plan intentionally follows patterns used by professional tools:

- Named and saved layouts: VS Code, Blender, AutoCAD, TouchDesigner, Resolume, QLab, ETC Eos, grandMA3.
- Compact modes and explicit UI scale: JetBrains IDEs, Blender, Maya, Figma, Slack, Photoshop.
- Separate content zoom from app UI scale: Figma canvas zoom, Slack app zoom, professional stage/canvas tools.
- Monitor-aware restore with fallback: Resolve, Resolume, QLab, DAWs, lighting consoles.

## Acceptance Criteria

- The current 2560x1440 Lighting experience remains premium and dense.
- 1920x1080 remains a complete live-operation layout.
- 1440x900 remains usable without clipped primary controls.
- 1280x800 remains usable as a utility mode with drawer/overflow behavior.
- No supported mode requires document-level scrolling.
- The toolbar never hides primary actions without an accessible overflow path.
- The inspector is usable in compact modes.
- Stage plot fit/fill behavior is explicit and does not confuse UI scale with content zoom.
- Saved window state recovers when the saved monitor is missing.
- No engine protocol, device policy, DB, or hardware state changes are introduced.
