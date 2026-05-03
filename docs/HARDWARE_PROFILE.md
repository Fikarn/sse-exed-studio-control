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
