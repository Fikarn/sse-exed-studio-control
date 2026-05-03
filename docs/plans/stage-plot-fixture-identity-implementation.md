# Stage Plot Fixture Identity Implementation Plan

Status: implemented on `2026-05-03` in branch `codex/stage-plot-fixture-identity-polish`.

Implementation notes:

- Scope stayed limited to existing fixture catalog entries and additive visual snapshot metadata.
- Device policy, DMX footprint, patch validation, scene serialization, and persistence stayed engine-owned.
- React renders fixture family symbols, output footprints, render modes, and short-lived motion/value/scene previews from snapshots and catalog metadata only.
- The polish follow-up added seamless drag, free one-degree rotation display, live intensity/CCT slider rendering, selected scene rail highlighting, and active-scene plot preview alignment.
- Validation recorded in `docs/HANDOFF.md` under "Stage plot fixture identity and motion polish".

## Summary

Implement a focused Lighting stage-plot upgrade that makes fixture markers visibly distinct by fixture family and renders output footprints from engine-owned fixture catalogue metadata.

This plan is intentionally scoped to the selected Tauri/React lighting surface plus the Rust engine-owned fixture catalogue snapshot. Do not add new fixture definitions, GDTF import, 3D rendering, hardware discovery, Sidus/vendor auto-configuration, firmware workflows, or React-owned device policy.

The implementation must preserve the existing stage-plot interactions: drag, marquee selection, multi-select rings, Highlight/Solo rings, identify pulses, patch overlay, preview live ghosting, view bookmarks, and keyboard focus behavior.

## Research Anchors

- GDTF Model Collect: models can provide dimensions, model files, and 2D SVG symbols for top/front/side views.
  <https://www.gdtf.eu/gdtf/file-spec/model-collect/>
- GDTF Geometry Collect: beam geometry includes beam angle, field angle, beam type, luminous flux, color temperature, and CRI-style physical data.
  <https://www.gdtf.eu/gdtf/file-spec/geometry-collect/>
- Vectorworks Spotlight: lighting instruments are data-rich objects, not only symbols; workflows include label legends, beam/field checks, photometers, and photometric grids.
  <https://app-help.vectorworks.net/2017/eng/VW2017_Guide/LightingDesign1/Lighting_Design.htm>
- ETC Eos Magic Sheets: object color and opacity can be linked to target color and target intensity.
  <https://www.etcconnect.com/WebDocs/Controls/EosFamilyOnlineHelp/en/Content/19_Magic_Sheets/Magic_Sheet_Editor/Magic_Sheet_Object_Inspector.htm>
- Aputure INFINIBAR PB12 product data: PB12 is a 4 ft pixel bar with 96 physical pixels, 120 degree half-peak beam angle, and published 5600K photometrics.
  <https://aputure.com/en-US/products/infinibar-pb12>

## Primary Files

- `native/rust-engine/src/lighting/fixture_catalog/mod.rs`
- `native/protocol/v1.contract.json`
- `native/protocol/v1.md`
- `frontend/app/src/app/lighting/components/StagePlot.tsx`
- `frontend/app/src/app/lighting/components/FixtureMarker.tsx`
- `frontend/app/src/app/lighting/components/LightPool.tsx`
- `frontend/app/src/app/lighting/components/StagePlotControls.tsx`
- `frontend/app/src/app/lighting/components/StagePlotControls.module.css`
- `frontend/app/src/app/lighting/components/StagePlot.module.css`
- `frontend/app/src/app/lighting/fixtureCatalog.ts`
- `frontend/app/src/app/lighting/fixtureMounting.ts`
- `frontend/app/src/app/lighting/lightingHelpers.ts`
- `frontend/packages/engine-client/src/transports/fixtureTransport.ts`

## Implementation Steps

### 1. Inspect Before Editing

Read these files before changing code:

- `README.md`
- `docs/DEVELOPER_QUICKSTART.md`
- `docs/HANDOFF.md`
- `docs/DEVELOPMENT.md`
- all primary files listed above

Confirm the existing state:

- `LightingFixtureVisualSnapshot` currently includes `shape`, dimensions, beam angle min/max, field angle, and `pixelLayout`.
- `StagePlot.tsx` currently renders generic `LightPool` circles and a generic beam length line.
- `FixtureMarker.tsx` currently renders five generic marker bodies in `shapeForMounting`.
- The design system already exports `SegmentedControl`; do not create a new segmented-control primitive.

### 2. Extend Engine-Owned Visual Metadata

Add fields to `LightingFixtureVisualSnapshot`:

- `symbolKind: String`
- `symbolVariant: String`
- `emitterLayout: Option<LightingFixtureEmitterLayoutSnapshot>`
- `output: LightingFixtureOutputSnapshot`
- `visualConfidence: String`

Add snapshot structs:

```rust
pub struct LightingFixtureEmitterLayoutSnapshot {
    pub emitter_kind: String,
    pub rows: i64,
    pub columns: i64,
    pub segments: i64,
    pub physical_pixels: Option<i64>,
    pub direction: String,
}

pub struct LightingFixtureOutputSnapshot {
    pub beam_type: String,
    pub beam_angle: Option<f64>,
    pub field_angle: Option<f64>,
    pub photometric_samples: Vec<LightingFixturePhotometricSampleSnapshot>,
}

pub struct LightingFixturePhotometricSampleSnapshot {
    pub cct: i64,
    pub distance_meters: f64,
    pub lux: f64,
    pub modifier: String,
    pub source: String,
}
```

Use serde rename attributes to expose camelCase fields in TypeScript:

- `emitterKind`
- `physicalPixels`
- `beamType`
- `beamAngle`
- `fieldAngle`
- `photometricSamples`
- `distanceMeters`

Allowed `symbolKind` values:

- `panel`
- `soft-mat`
- `linear-bar`
- `fresnel`
- `control-node`

Allowed `beamType` values:

- `wash`
- `spot`
- `fresnel`
- `rectangle`
- `glow`
- `none`

Allowed `visualConfidence` values:

- `verified`
- `catalogue-derived`
- `fallback`

### 3. Populate Existing Catalogue Entries Only

Do not add new fixture definitions.

Populate visual metadata from existing facts and cited source data only:

- Existing `shape="control-node"`:
  - `symbolKind="control-node"`
  - `symbolVariant="apollo-bridge"` for Apollo Bridge, otherwise `"control-node"`
  - `beamType="none"`
  - no photometric samples
  - no output footprint in React

- Existing `shape="bar"`:
  - `symbolKind="linear-bar"`
  - `symbolVariant="infinibar-pb12"` for PB12, otherwise `"linear-bar"`
  - `beamType="rectangle"`
  - `emitterLayout` from existing `pixelLayout`
  - PB12 must include `physicalPixels=96`
  - PB12 photometric samples:
    - `cct=5600`, `distanceMeters=0.5`, `lux=1600`, `modifier="none"`, `source="Aputure INFINIBAR PB12 product page"`
    - `cct=5600`, `distanceMeters=1.0`, `lux=593`, `modifier="none"`, `source="Aputure INFINIBAR PB12 product page"`

- Existing `shape="mat"`:
  - `symbolKind="soft-mat"`
  - `symbolVariant="infinimat"` for current INFINIMAT entry, otherwise `"soft-mat"`
  - `beamType="wash"`
  - `emitterLayout` from existing `pixelLayout`

- Existing `shape="panel"`:
  - `symbolKind="panel"`
  - `symbolVariant` should be a stable catalogue-family value such as `"astra"`, `"astra-ip"`, `"gemini"`, or `"panel"` based on existing definition id/family.
  - `beamType="wash"`
  - use existing beam/field values. Do not invent missing photometric samples.

- Existing `shape="fresnel"`:
  - `symbolKind="fresnel"`
  - `symbolVariant` should be a stable catalogue-family value such as `"light-storm"`, `"storm"`, `"studio-x"`, or `"fresnel"` based on existing definition id/family.
  - `beamType="fresnel"` unless the existing definition is clearly fixed daylight/spot; if unsure, use `"fresnel"` and `visualConfidence="catalogue-derived"`.

Keep all values deterministic and testable.

### 4. Update Protocol Artifacts

Update `native/protocol/v1.contract.json` and `native/protocol/v1.md` to document the additive catalogue visual fields.

Run:

```bash
npm run protocol:generate
```

Include generated artifacts. Do not hand-edit generated outputs.

### 5. Add Frontend Fixture Visual Helpers

Create `frontend/app/src/app/lighting/fixtureVisuals.ts`.

Responsibilities:

- Resolve a fixture's catalogue definition and visual metadata.
- Return a normalized visual model for SVG renderers.
- Clamp marker body dimensions so fixtures remain readable:
  - minimum marker body width/height: 14 SVG cm units
  - maximum marker body width: 52 SVG cm units
  - maximum marker body height: 32 SVG cm units
  - preserve aspect ratio where possible
- Provide fallbacks when catalogue metadata is absent:
  - `deriveMounting` compatibility remains valid.
  - Fallback symbol should match current generic behavior.
- Provide output rendering inputs:
  - `beamType`
  - `beamAngle`
  - `fieldAngle`
  - `hasPhotometricSamples`
  - `photometricLabel`
  - `emitterLayout`

React must only render this metadata; it must not encode DMX footprint, validation, or fixture policy.

### 6. Replace Marker Body Rendering

Create `frontend/app/src/app/lighting/components/FixtureSymbol.tsx`.

Move marker body rendering out of `FixtureMarker.tsx`.

Render visually distinct SVG bodies:

- `panel`
  - rectangular body with yoke/bracket hint
  - visible emitter face
  - optional small beam/field badge when selected/hovered

- `soft-mat`
  - larger soft rectangular fabric surface
  - module seams from `emitterLayout`
  - softer outline than hard panel

- `linear-bar`
  - long chamfered rail
  - end caps
  - connector notch or direction marker
  - segment ticks from `emitterLayout.segments`
  - stronger tick rendering in `pixel` mode

- `fresnel`
  - circular lens plus short barrel/body
  - yoke arms
  - orientation line showing aim direction

- `control-node`
  - square/compact bridge/router glyph
  - RF/data ring or antenna line
  - no intensity bar fill if `on=false`, but keep selectable marker behavior

Update `FixtureMarker.tsx`:

- Accept normalized fixture visual data instead of raw `mounting` and `pixelLayout`, or accept both if that produces a smaller patch.
- Preserve existing selection ring, highlight ring, identify animation, keyboard focus ring, drag ghost, intensity bar, labels, context menu, aria behavior, and drag math.
- Keep `FixtureMarker` responsible for interaction state, not symbol internals.

### 7. Replace Generic LightPool Rendering

Create `frontend/app/src/app/lighting/components/FixtureOutputFootprint.tsx`.

Replace `LightPool` usage in `StagePlot.tsx`. Keep `LightPool.tsx` only if it remains used elsewhere; otherwise delete it.

Render by `beamType`:

- `wash`: soft ellipse/radial field using CCT and intensity
- `fresnel`: cone/wedge or soft-edged ellipse plus centerline
- `spot`: harder cone/wedge and tighter field ring
- `rectangle`: rectangular/linear soft output, used for bars and rectangular sources
- `glow`: self-emissive marker emphasis, no floor pool
- `none`: no footprint

Inputs must include:

- fixture id
- center x/y
- rotation
- rig height
- beam angle
- field angle
- intensity
- cct
- on/off
- normalized visual metadata
- stage plot render mode

In `rig` mode, keep footprints subtle so markers remain the primary read. In `coverage`, `photometric`, and `pixel` modes, increase the relevant output/pixel emphasis.

### 8. Add Stage Plot Render Modes

Define:

```ts
export type StagePlotRenderMode = "rig" | "coverage" | "photometric" | "pixel";
```

Store local state in `LightingWorkspace.tsx`:

- default: `"rig"`
- no persistence in this pass

Pass mode into `StagePlot` and `StagePlotControls`.

Update `StagePlotControls.tsx`:

- Use existing `SegmentedControl` from `@sse/design-system`.
- Add options:
  - Rig
  - Coverage
  - Photometric
  - Pixel
- Do not replace existing zoom mode buttons or bookmark buttons.
- Ensure control group remains compact at narrow review widths.

Mode behavior:

- `rig`: fixture-symbol identity plus subtle output, default operator view.
- `coverage`: stronger beam/field/output footprint rendering.
- `photometric`: show photometric labels only when sample-backed; otherwise show normalized estimate labels with a clear "est." marker.
- `pixel`: emphasize emitter segments, pixel direction, and pixel-capable fixture symbols.

### 9. Add Fixture Symbol Key Overlay

Create `frontend/app/src/app/lighting/components/FixtureSymbolKey.tsx`.

Mount inside `StagePlot`.

Behavior:

- Group current fixtures by `definitionId`.
- One compact row per definition currently present.
- Each row shows:
  - miniature symbol preview
  - count
  - fixture display name
  - selected mode footprint, e.g. `8 ch`
  - beam/field summary when known
  - confidence label
- Hide or collapse automatically in narrow layouts; no scroll.
- Do not show research-needed definitions unless an existing fixture instance uses one.

### 10. Update Fixture Transport

Update `frontend/packages/engine-client/src/transports/fixtureTransport.ts` so fixture-driven tests and visual review have the new catalogue visual metadata.

Fixture transport metadata must match engine defaults closely enough that frontend tests see all symbol families:

- panel
- soft-mat
- linear-bar
- fresnel
- control-node

## Tests

### Rust Tests

Add or extend tests under `native/rust-engine/src/lighting/`.

Required assertions:

- Every catalogue definition has `symbolKind`, `symbolVariant`, `output`, and `visualConfidence`.
- `symbolKind`, `beamType`, and `visualConfidence` are from the allowed sets.
- Control-node definitions use `beamType="none"` and have no photometric samples.
- `emitterLayout` values are positive when present.
- Existing `pixelLayout` and new `emitterLayout` are consistent when both exist.
- PB12 has `physicalPixels=96`.
- PB12 includes the exact 5600K photometric samples listed in this plan.

### Frontend Tests

Add focused tests in the existing frontend/fixture test structure.

Required assertions:

- Stage plot renders each symbol family without throwing.
- Control-node marker renders without an output footprint.
- PB12 renders linear-bar identity and segment emphasis in `pixel` mode.
- Stage plot render mode control changes modes.
- Fixture symbol key groups duplicate fixture models by definition id.
- Existing fixture drag/select behavior remains reachable.

### Validation Commands

Run these before final handoff:

```bash
npm run protocol:generate
npm run native:test
npm run frontend:typecheck
npm run frontend:playwright:test
npm run tauri:visual:review
```

If any command cannot run, state exactly why and list the next command a human should run.

## Visual Acceptance Criteria

Inspect the visual review output at minimum for:

- `1920x1080`
- `2560x1440`

Acceptance criteria:

- all fixture families are distinguishable without hovering
- no marker labels overlap into incoherent text stacks
- the symbol key does not cover critical plot controls
- no normal-operation page scroll
- control-node instances read as transport/control devices, not lamps
- `rig` mode remains calm enough for normal operation
- `coverage`, `photometric`, and `pixel` modes have visibly different emphasis

## Guardrails

- Engine owns fixture definitions, DMX mapping, validation, output metadata, and persistence compatibility.
- React may render catalogue metadata and send explicit commands only.
- Do not persist the full catalogue or new visual state into `app.lighting.editor.state`.
- Do not change fixture create/update IPC behavior except for additive snapshot shape.
- Do not add or broaden fixture definitions.
- Do not implement GDTF import.
- Do not implement Sidus Bluetooth discovery, firmware update, or vendor auto-configuration.
- Do not remove or regress existing stage plot interactions.
- Do not introduce normal-operation scroll on the operator surface.
- Do not bypass the design system for controls when an existing primitive is available.

## Final Handoff Requirements

The implementing session must report:

- files changed
- validation commands and results
- generated artifact status
- visual review evidence path
- blockers or unverified assumptions, if any
