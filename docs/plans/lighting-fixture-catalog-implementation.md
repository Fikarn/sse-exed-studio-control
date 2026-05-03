# Lighting Fixture Catalog Implementation Handoff

Status: implemented and merged through [PR #73](https://github.com/Fikarn/sse-exed-studio-control/pull/73) on `2026-05-03`. Retain this file as the completed scope record and as the boundary reference for future catalog work.

## Summary

Implement this as a staged engine-first refactor, then broaden fixture capability. Do not start by adding more dropdown options. The current system hard-codes fixture type, channel count, CCT range, DMX labels, and visual mounting in multiple places; the first implementation goal is to make those facts catalog-driven and engine-owned.

Target scope: current DMX-capable Aputure-branded fixtures and current Litepanels DMX fixtures, using a checked-in curated registry from official manuals/PDFs. Sidus parity means documented DMX/Art-Net/sACN/CRMX control parity, not proprietary Sidus Bluetooth discovery, firmware updates, or vendor auto-configuration.

## Execution Directive

Implement the full plan in order, from Phase 1 through Phase 7. Do not treat the recommended first PR as the endpoint; it is only the first milestone for reducing risk before continuing into instance shape, catalog V1, catalog UX, and catalog expansion.

Avoid scope drift by following the phases exactly:

- Complete each phase's stated behavior before moving on.
- Do not skip the compatibility bridge before changing instance shape.
- Do not implement GDTF import, Sidus Bluetooth discovery, firmware update, or vendor auto-configuration in this work.
- Do not broaden beyond current DMX-capable Aputure-branded and Litepanels fixtures unless the catalog marks an entry as `research-needed` and keeps it non-selectable.

## Phase 1 - Engine Catalog Foundation

Create a new Rust module under `native/rust-engine/src/lighting/fixture_catalog/` and wire it through `native/rust-engine/src/lighting/mod.rs`.

Define these engine-owned structs and export snapshot-facing ones with `ts-rs` where they cross protocol:

- `LightingFixtureCatalogSnapshot`
- `LightingFixtureDefinitionSnapshot`
- `LightingFixtureModeSnapshot`
- `LightingFixtureChannelSnapshot`
- `LightingFixtureControlSnapshot`
- `LightingFixtureVisualSnapshot`
- `LightingFixturePixelLayoutSnapshot`

Required definition fields:
`id`, `manufacturer`, `family`, `model`, `displayName`, `status`, `sourceUrl`, `sourceVersion`, `sourceDate`, `kind`, `defaultModeId`, `modes`, `visual`.

Required mode fields:
`id`, `displayName`, `channelCount`, `resolution`, `capabilities`, `channels`, `defaults`.

Required channel fields:
`offset`, `label`, `controlId`, `valueType`, `defaultDmx`, and optional `ranges`.

Required visual fields:
`shape`, `widthMm`, `heightMm`, `depthMm`, `beamAngleMin`, `beamAngleMax`, `fieldAngle`, `pixelLayout`.

Keep the first data source as a checked-in static Rust registry or JSON file embedded by Rust. Do not fetch vendor pages at runtime.

## Phase 2 - Protocol Surface

Add `lighting.fixtureCatalog.snapshot` to `native/protocol/v1.contract.json`, document it in `native/protocol/v1.md`, dispatch it in `native/rust-engine/src/app.rs`, and implement a fixture-transport equivalent in `frontend/packages/engine-client/src/transports/fixtureTransport.ts`.

Run `npm run protocol:generate` after adding exported snapshot structs and the method.

The new method returns the catalog only. It must not change lighting state.

## Phase 3 - Compatibility Bridge

Before changing scenes or advanced controls, replace all current hard-coded fixture facts with catalog lookups while preserving existing snapshot shape.

Update these Rust areas first:

- `native/rust-engine/src/lighting/helpers.rs`
- `native/rust-engine/src/lighting/parse.rs`
- `native/rust-engine/src/lighting/fixtures.rs`
- `native/rust-engine/src/lighting/snapshot.rs`
- `native/rust-engine/src/lighting/editor_state.rs`

Behavior:

- Existing fixture `type` values still work: `astra-bicolor`, `infinimat`, `infinibar-pb12`, plus legacy aliases `Astra`, `Infinibar`, `Apollo Bridge`.
- Store existing `fixture_type` unchanged for backward compatibility in this phase.
- Resolve every fixture to a catalog definition and default mode internally.
- `validate_dmx_start_address` uses catalog `channelCount`.
- `read_lighting_dmx_monitor_snapshot` uses catalog channel labels and default encoders.
- Unknown or legacy fixture types normalize to the current default `astra-bicolor` only when no better alias exists.

Update frontend duplicates next:

- `frontend/app/src/app/lighting/lightingPatch.ts`
- `frontend/app/src/app/lighting/lightingHelpers.ts`
- `frontend/app/src/app/lighting/fixtureMounting.ts`
- fixture-transport helper functions around `normalizeFixtureType`, `lightingFixtureChannelCount`, `lightingFixtureChannelLabels`, and DMX monitor generation.

Acceptance for this phase: no operator UI change beyond fixing the current `Apollo Bridge` mismatch.

## Phase 4 - Instance Shape

Extend fixture instances additively.

Add fields to engine editor state and snapshots:
`definitionId`, `modeId`, `universe`, `controlValues`.

Keep existing fields:
`type`, `kind`, `dmxStartAddress`, `intensity`, `cct`, `on`, `effect`, spatial fields.

Update request parsing:

- `lighting.fixture.create` accepts `definitionId`, `modeId`, `universe`, and keeps `type` as compatibility input.
- `lighting.fixture.update` accepts `definitionId`, `modeId`, `universe`, and `controlValues`.
- Structural updates remain rejected in preview mode.
- Mode changes revalidate DMX footprint and clamp/reset unsupported `controlValues`.

Update scene fixture state:

- Add optional `controlValues`.
- Existing scenes without `controlValues` synthesize values from `intensity`, `cct`, `on`.
- Scene recall applies both common fields and `controlValues`.

Update DMX monitor:

- Add `universe` to `LightingDmxChannelSnapshot`.
- Sort by `universe`, then `channel`.
- Update compact DMX UI to handle multiple universes without assuming one strip is complete.

## Phase 5 - Curated Catalog V1

Ship a deliberately small but representative catalog first, with tests, before adding every fixture.

V1 fixture definitions:

- Existing studio-compatible compatibility entries: Astra Bi-Color, INFINIMAT generic, INFINIBAR PB12.
- Aputure examples: LS 600d Pro 5ch, STORM 80c basic 7ch, STORM 80c HSIC+ 13ch, STORM 1200x simple CCT profile, INFINIBAR PB12 basic and one pixel mode, INFINIMAT 1x4 or 2x4 engine profile.
- Litepanels examples: Astra IP P01/P02, Gemini P02/P03/P07/P08, Studio X bi-color 8-bit/16-bit.

Only expose entries marked `verified` in the add-fixture UI. Add placeholders marked `research-needed` only if they are useful for tracking, not selectable.

Required source links in the catalog comments or metadata:

- Aputure Sidus/product families: https://aputure.com/en-US/pages/sidus-features, https://aputure.com/en-US/pages/compare-sidus-software
- Aputure custom DMX profile docs: https://help.aputure.com/en/sidus-link-pro/creating-custom-dmx-profiles
- LS 600d Pro DMX: https://help.aputure.com/en/ls600d-pro/controlling-device-via-dmx
- INFINIBAR DMX: https://help.aputure.com/en/infinibar/dmx-profiles-settings
- Litepanels Gemini DMX chart: https://www.litepanels.com/wp-content/uploads/2023/06/lp_gemini_dmx_function_chart.pdf
- Litepanels Gemini configuration: https://help.litepanels.com/en/gemini-configuration.html
- Litepanels Astra/Astra IP/Apollo: https://www.litepanels.com/en/products/astra/, https://www.litepanels.com/en/products/astra-ip/, https://www.litepanels.com/en/products/apollo/

## Phase 6 - Frontend Catalog UX

Replace the fixed select in `CreateFixtureDialog.tsx` with a searchable catalog picker.

Required picker behavior:

- Group by manufacturer -> family -> model.
- Show mode/profile, channel footprint, CCT/color capability, pixel capability, and verified source label.
- Default to the definition's `defaultModeId`.
- Suggest the next DMX start address from selected universe + selected mode.
- Show a hard warning when the selected mode consumes a large footprint, especially pixel modes.

Update inspector behavior:

- Keep current common controls for intensity/CCT/on/off.
- Render catalog-driven controls only for selected fixture capabilities.
- Start with generated controls: slider, stepped select/range, toggle-like discrete ranges.
- Do not hand-design every fixture's inspector in the first pass.

Update stage plot:

- Replace string-derived mounting with catalog `visual.shape`.
- Shapes: `point-source`, `panel`, `bar`, `mat`, `fresnel`, `bulb`, `control-node`.
- Pixel fixtures render segmented bars/mats/panels when `pixelLayout` exists.
- Apollo Bridge is a control node, not a patchable light unless modeled as a transport device later.

## Phase 7 - Expand Catalog

After V1 lands, add the full current catalog in batches.

Batch order:

1. Aputure Light Storm and STORM current fixtures.
2. Aputure INFINIBAR, INFINIMAT, NOVA/NOVA II/NOVA 9.
3. Aputure Electro Storm, including accessory-expanded profiles for motorized yoke/F14.
4. Aputure DMX-confirmed Mini/practicals.
5. Litepanels Astra IP and Gemini complete profile sets.
6. Litepanels Studio X and verified Astra classic profiles.

For every batch:

- Add catalog data.
- Add profile tests.
- Add one fixture-transport fixture scenario.
- Add one frontend Playwright coverage point if the batch introduces a new visual shape or control type.

## Tests

Minimum Rust tests:

- Catalog ids are unique and stable.
- Every selectable definition has `sourceUrl`, `sourceVersion`, `defaultModeId`, at least one mode, and `channelCount <= 512`.
- Each channel offset is unique within mode and inside footprint.
- DMX overlap detection is universe-aware.
- Legacy fixtures migrate/resolve without losing existing scenes.
- DMX monitor labels and values match known profile examples.
- Scene capture/recall round-trips `controlValues`.

Minimum frontend tests:

- Catalog snapshot loads in fixture transport.
- Add fixture picker selects definition/mode and updates patch footprint.
- Patch conflicts use selected mode width.
- Inspector renders common controls plus generated capability controls.
- Stage plot renders panel/bar/mat/fresnel/control-node shapes.
- Multi-universe DMX monitor remains readable.

Validation lanes:

- `npm run protocol:generate`
- `npm run native:test`
- `npm run frontend:typecheck`
- `npm run frontend:playwright:test`
- `npm run tauri:visual:review` for stage plot, inspector, picker, or DMX monitor changes.

## Implementation Boundaries

- Engine owns fixture definitions, DMX mapping, validation, persistence compatibility, and scene serialization.
- React renders catalog metadata and sends explicit commands; it does not become the source of truth for DMX policy.
- Do not persist the full catalog into `app.lighting.editor.state`; persist only fixture instance references and overrides.
- Do not implement GDTF import in this project slice. Keep that as a later phase after the curated registry is proven.
- Do not implement Sidus Bluetooth discovery, firmware update, or auto-configuration unless a later discovery task confirms supported access.

## Recommended First PR

Make the first implementation PR only the catalog foundation plus compatibility bridge:

- Add catalog module with the current three fixtures and aliases.
- Add `lighting.fixtureCatalog.snapshot`.
- Replace Rust hard-coded channel count/labels/CCT/default lookups with catalog lookups.
- Add fixture-transport catalog snapshot and replace duplicated helper behavior.
- Preserve current UI behavior.

This first PR should be boring by design. Once it is green, the larger Aputure/Litepanels catalog expansion is mostly data, tests, and generated controls instead of architecture churn.
