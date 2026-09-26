# Hardware Profile

This repository is built around a specific studio installation. The product and codebase should be evaluated against that installation first, not against generic SaaS or general-purpose control software assumptions.

## Operator Environment

**The operator's ruling, absolute since 2026-09-26: Studio Control always runs at `2560x1440`, fullscreen on an external display, on a Windows machine. No other resolution and no other operating system is considered.** The new pages program's Slice SW removed what existed only for another size or system — the fallback layouts, the Studio Preview for laptop panels, the windowed layout and the macOS packaging (the ledger `docs/plans/new-pages-2026-09.md`, D22).

- Dedicated second monitor, Windows display scaling at 100 % (display 3 on the studio workstation). The window always opens fullscreen: on the display it was last on when that display is there, else on the `2560x1440` display, else on the display the window is on.
- Resolution: `2560x1440` logical pixels on the fixed studio monitor, the only one. Operator ruling 2026-09-07 (visual overhaul A, plan D4), absolute since 2026-09-26: the chrome budget is header `56`, footer `40`, cluster `424`, plate `416`, gutters `16` (`chrome.studio.*` tokens), the Audio Console shows 4 input, 6 playback and 3 output strips beside the `416` px plate, and every design gate runs at `2560x1440` only.
- One layout. The UI scale (90, 100, 110 or 125 % in Setup / Support › Workstation) is the operator's preference, not another layout.
- No page scroll during normal operation
- Dense, fixed-height operator surfaces preferred over document-style layouts

## Live Visual Verification

When the user has the selected Tauri shell open for inspection, that exact running shell is the definitive visual verification surface for operator-visible feedback. In local development this is typically launched with `npm run tauri:dev`, process `sse-exed-tauri-shell`, window `SSE ExEd Studio Control`.

If the user points out visual issues, interpret those comments against the live shell they are looking at unless they explicitly name a different artifact. Do not substitute redesign documents, browser-only views, historical screenshots, or retired shell paths as the source of truth. Automated screenshots and `npm run tauri:visual:review` remain required evidence, but live operator inspection refers to the open selected Tauri shell.

## Audio

### Interface

- RME Fireface UFX III

### Primary Working Model

- Front preamps `9-12` are the primary live inputs
- Rear line inputs `1-8` are secondary utility / line sources
- Software playback channels are part of the operator surface
- Output mixes matter:
  - Main XLR monitors
  - Phones 1
  - Phones 2
- Production metering is sourced from RME TotalMix OSC peak-level packets. The fixed workstation uses three TotalMix OSC remote slots: hardware inputs on the base ports, software playback on `+1`, and hardware outputs on `+2`, all with `Send Peak Level` enabled.

### Design Implication

The audio page should behave like a fixed TotalMix-inspired control surface, not a generic channel CRUD tool.

## Lighting

### Bridge

- Litepanels Apollo Bridge

### Fixtures

- Litepanels Astra Bi-Color Soft
- Aputure Infinimat 2x4
- Aputure Infinibar PB12

### Design Implication

Lighting workflows should prioritize live readability, spatial awareness, and fast recovery over generic fixture-management patterns.

## Control Surface

- Stream Deck+
- Bitfocus Companion running locally on the same workstation

### Design Implication

Commissioning and setup flows should be import-first and workstation-specific, with clear operator documentation for the actual deck layout in use.

## Product Boundaries

The current intended shape is:

- local-first
- single trusted workstation
- no cloud dependency
- fixed hardware profile
- desktop application only; no browser-served path remains (retired in `v2.1.0`)

Out of scope unless explicitly re-scoped:

- generic multi-tenant collaboration
- arbitrary audio interface support
- arbitrary lighting-protocol abstraction beyond the current rig
- mobile-first layouts
- any screen size but `2560x1440` and any operating system but Windows (the operator's ruling of 2026-09-26)
