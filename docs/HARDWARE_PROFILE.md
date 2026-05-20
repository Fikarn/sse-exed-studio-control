# Hardware Profile

This repository is built around a specific studio installation. The product and codebase should be evaluated against that installation first, not against generic SaaS or general-purpose control software assumptions.

## Operator Environment

- Dedicated second monitor
- Primary target resolution: `2560x1440` logical pixels on the fixed studio monitor
- Minimum supported live-use resolution: `1920x1080` logical pixels
- Utility/minimum mode: `1280x800` logical pixels for setup, inspection, and recovery workflows, not full simultaneous show control
- No page scroll during normal operation
- Dense, fixed-height operator surfaces preferred over document-style layouts
- Layout decisions are based on logical viewport/CSS pixels. Physical monitor pixels and backing scale are diagnostics, not layout thresholds.

## Live Visual Verification

When the user has the selected Tauri shell open for inspection, that exact running shell is the definitive visual verification surface for operator-visible feedback. In local development this is typically launched with `npm run tauri:dev`, process `sse-exed-tauri-shell`, window `SSE ExEd Studio Control`.

If the user points out visual issues, interpret those comments against the live shell they are looking at unless they explicitly name a different artifact. Do not substitute redesign documents, browser-only views, historical screenshots, or retired shell paths as the source of truth. Automated screenshots and `npm run tauri:visual:review` remain required evidence, but live operator inspection refers to the open selected Tauri shell.

On the built-in MacBook display, use the app-owned Scaled Studio Preview as the normal human review surface for the fixed studio monitor. The preview must emulate the `2560x1440` studio canvas exactly after scaling: layout mode, proportions, density decisions, canvas metadata, and control aspect ratios should match native `2560x1440` evidence. Do not let host-window compact media queries leak into Scaled Studio Preview; operator layout breakpoints should key off the logical operator surface, not the physical preview window.

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
- desktop application first, browser support second

Out of scope unless explicitly re-scoped:

- generic multi-tenant collaboration
- arbitrary audio interface support
- arbitrary lighting-protocol abstraction beyond the current rig
- mobile-first layouts
