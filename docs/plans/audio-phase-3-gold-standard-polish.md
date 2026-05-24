# Audio Page — Phase 3: Gold-Standard Polish

> **Provenance note.** This is the operative plan that drove Phase 3 commits 32a5815…765b7a7 (PRs #88–#95). It was originally drafted in a Claude session at `~/.claude/plans/keep-the-focus-on-serene-sunset.md` and checked into the repo on 2026-05-24 as part of the Phase 3 audit follow-up (item A4 in [audio-ui-phase-3-followup-fixes.md](./audio-ui-phase-3-followup-fixes.md)). The audit found that two slices (4 and 6) silently rescoped away from this plan — see the follow-up ledger for the deltas.

## Context

A live visual review of the Audio page in the dev shell surfaced ~30 findings that pull the page back from the gold-standard premium feel the rest of the design language is reaching for. The findings cluster into six themes:

1. **Visible defects** — `CLOCK CLOCK`, `OutHost selected`, the `OSC NOT VERIFIED` title repeating inside its own banner body, and `Active mix-28` reading like a typo.
2. **Semantic overload of yellow** — bright lemon yellow currently carries SOLO, 48 V, OSC alert, peak-hold readouts, snapshot active, TALENT, "Lighting/Audio pending" — at least seven semantically different meanings on one page.
3. **Duplicated controls and readouts** — DIM/MONO/TALK rendered in three places, the ⌘K/SHORTCUTS/BANK cheatsheet rendered twice, LAST SYNC shown twice, and three different labels (`Monitor level`, `Bus level`, `Send to Main Out`) for related concepts.
4. **Inconsistent density and meter parity** — Inputs strips are rich, Playback strips are hollow, Outputs cards are dense; Inputs meters render brighter than Playback / Outputs even though the Outputs meters are the most operationally critical.
5. **Empty placeholder feel in the inspector** — EQ and Dynamics tabs render empty grids at rest, without axis labels or ghosted curves.
6. **Two stacked yellow banners** at the top of the workspace simultaneously, exceeding the broadcast-console maximum of one full-width alert.

The team has been working in numbered Audio slices and just closed Phase 2 (eight prior slices). This plan continues that rhythm as **Phase 3 — gold-standard polish**, sequenced bugs → tokens → unification → density → hardware vocabulary → graphs → toolbar weight.

### Locked-in direction (from the user)

1. **Staged into slices**, one PR per slice, each visually reviewable in isolation.
2. **Two-tier yellow split** — `warn` (bright lemon, demands action) vs `engaged` (warm amber, persistent engaged state). Reuses the existing `color.warning.500` (#D8A95A) amber that is already in the token set but underused.
3. **Lean into the hardware-inspired richness** — keep the skeuomorphic preamp module and _extend_ its bezel/digital-readout/LED-glow vocabulary to other surfaces (Outputs Bus readout, Rail Monitor readout, inspector EQ/Dynamics displays). Do not flatten the preamp.

---

## Slice 0 — Visible-defect cleanup (no design change)

**Goal:** kill the four bugs the eye latches onto first, so the visual baseline for the design slices is clean.

**In-scope edits:**

- [audioViewModel.ts:496](frontend/app/src/app/audio/audioViewModel.ts:496) — remove the hardcoded `"clock n/a · sr n/a"` string. Expose `clock: null` (or a structured `{ clock, sampleRate }`) when telemetry is missing. The `Clock` label belongs to the renderer, not the value.
- [AudioHealthBar.tsx](frontend/app/src/app/audio/components/AudioHealthBar.tsx) — render `Clock —` (or hide the row entirely) when `clock == null` instead of producing `Clock CLOCK N/A · SR N/A`.
- [AudioToolbar.tsx](frontend/app/src/app/audio/components/AudioToolbar.tsx) and/or [AudioTargetPicker.tsx](frontend/app/src/app/audio/components/AudioTargetPicker.tsx) — add the missing inter-element gap between the breadcrumb's selected output name (`Main Out`) and the `Host selected ⌄` picker. CSS `gap` on the flex parent or an explicit divider span.
- [audioFormatting.ts:194-201](frontend/app/src/app/audio/audioFormatting.ts) — drop the leading `OSC NOT VERIFIED` from `warningBody`. The chip already renders the title via `<strong>{viewModel.status.warningTitle}</strong>` in [AudioSignalCanvas.tsx:110-111](frontend/app/src/app/audio/components/AudioSignalCanvas.tsx:110); the body shouldn't repeat it.
- [AudioRail.tsx:106](frontend/app/src/app/audio/components/AudioRail.tsx:106) — restructure the `Active mix · live` / `Active mix · test meters` rendering so any appended data-driven suffix (the `-28` we saw) becomes a separate `<small>` chip with proper spacing, not a hyphen concatenation.

**Out of scope:** any token edits, any layout/structure change, any redesign.

**Reusable utilities:** existing `formatAudioTimestamp`, existing `data-testid` hooks.

**Verification:** `audio-populated` and `audio-selected-channel` fixtures captured at `2560×1440` via `npm run tauri:visual:review`. Diff the four affected regions (footer, breadcrumb, warning band, rail active-mix chip) against the prior baseline.

**Risks:** the breadcrumb gap CSS must not regress Lighting / Setup / Planning toolbars. Confirm `AudioToolbar.module.css` is the only consumer of the affected class before merging.

---

## Slice 1 — Token vocabulary split (additive)

**Goal:** introduce the two-tier `warn` vs `engaged` semantic vocabulary additively so Slice 2 has stable token names to rebind to. Zero consumer changes in this slice.

**In-scope edits:**

- [core.json](frontend/packages/tokens/src/tokens/core.json) — add a new `color.audio.engaged` namespace mapped to the existing `color.warning.500` (#D8A95A) warm amber and its alpha derivatives: `engaged.fill`, `engaged.soft`, `engaged.border`, `engaged.glow`, `engaged.dot`. Mirror the shape of the existing `brand.yellow{Soft,Glow,Border}` family.
- [core.json](frontend/packages/tokens/src/tokens/core.json) — add `color.audio.warn` namespace as a _named role_ aliased to `brand.yellow` (#E8D561) family. This makes the warn-vs-engaged split explicit in the token graph even though `warn` initially resolves to the existing yellow.
- [core.json](frontend/packages/tokens/src/tokens/core.json) — add `color.audio.peakHold.calm` aliased to `color.text.subtle` so peak-hold readouts in the safe zone can stop being yellow.
- [core.json](frontend/packages/tokens/src/tokens/core.json) — add `shadow.glowAmber` and `shadow.glowAmberStrong` mirroring the existing `shadow.insetHi*` shape but keyed to the engaged amber, so engaged states can render a distinguishable bloom against the warn yellow's brighter glow. (Note: there's no existing `shadow.glowYellow` template; introduce both glow shapes here.)
- Regenerate `tokens.css` / `tokens.ts` / `token-docs.md` via `npm run frontend:tokens:build`. Commit the generated artifacts per the protocol-check convention in [package.json](package.json).

**Out of scope:** no consumer rebinding. No deletion of `brand.yellow*` (still consumed by Lighting and Planning).

**Reusable utilities:** existing Style Dictionary generator; existing `color.warning.500` amber.

**Verification:** `npm run frontend:tokens:build`, `npm run protocol:check`, `npm run frontend:typecheck`. No visual diff expected because no consumer changes yet. Include the generated `token-docs.md` diff in the PR.

**Risks:** Style Dictionary key collision — confirm `audio.warn` doesn't shadow the existing `audio.warningBand` namespace. Cross-page impact: zero (additive only).

---

## Slice 2 — Rebind consumers to warn vs engaged

**Goal:** every yellow on the page now reads from the correct semantic group, and peak-hold readouts in the safe zone go neutral. Pure CSS rebind via attribute selectors — no component logic changes.

**In-scope rebinding map:**

| Surface                                                                                                                                                                                                           | New token             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| SOLO chip on [AudioMixerLane.tsx](frontend/app/src/app/audio/components/AudioMixerLane.tsx)                                                                                                                       | `audio.warn.*`        |
| SOLO warning band in [AudioSignalCanvas.tsx](frontend/app/src/app/audio/components/AudioSignalCanvas.tsx)                                                                                                         | `audio.warn.*`        |
| OSC alert chip + warning band                                                                                                                                                                                     | `audio.warn.*`        |
| Channel clip dot                                                                                                                                                                                                  | `audio.warn.*`        |
| Peak-hold readout _only when value crosses warn threshold_ ([AudioStereoMeter.tsx](frontend/app/src/app/audio/components/AudioStereoMeter.tsx))                                                                   | `audio.warn.*`        |
| 48 V button on [AudioInspectorChannelHardwareCard.tsx](frontend/app/src/app/audio/components/inspector/AudioInspectorChannelHardwareCard.tsx)                                                                     | `audio.engaged.*`     |
| TALENT badge in channel header                                                                                                                                                                                    | `audio.engaged.*`     |
| `data-active=true` on EQ-in / COMP-in / Dim / Talkback in [AudioMixerLane.tsx](frontend/app/src/app/audio/components/AudioMixerLane.tsx) and [AudioRail.tsx](frontend/app/src/app/audio/components/AudioRail.tsx) | `audio.engaged.*`     |
| Active snapshot indicator on [AudioSnapshotDeck.tsx](frontend/app/src/app/audio/components/AudioSnapshotDeck.tsx)                                                                                                 | `audio.engaged.*`     |
| `Lighting/Audio/Surface pending` pills via [shellData.ts](frontend/app/src/app/shellData.ts) — harmonize so all three "pending" states render `engaged` amber, not yellow vs blue                                 | `audio.engaged.*`     |
| Peak-hold readout _when value is below warn threshold_                                                                                                                                                            | `audio.peakHold.calm` |

**Out of scope:** the hardware-bezel extension (Slice 5), inspector empty-state polish (Slice 6), toolbar weight (Slice 7).

**Reusable utilities:** `data-active` / `data-control` CSS hooks already on the lane and rail buttons — bind via CSS attribute selectors, no TS edits required.

**Verification:** `audio-populated` and `audio-selected-channel` at `2560×1440`, `1920×1080`, plus _also_ `lighting-populated`, `planning-populated`, and `setup-ready` fixtures because the subsystem-pill harmonization is shared chrome. Side-by-side composite: SOLO chip (bright), 48 V chip (amber), header pending pills (all amber after), peak-hold below threshold (neutral). Add a capture region around the subsystem pill row in the header.

**Risks:**

- **Shared chrome leak.** The subsystem pills live in `OperatorShell` / `shellData`. Harmonizing `controlSurface` (currently `info` / blue when pending) to `engaged` amber needs human review on the Lighting / Planning / Setup pages — verify "pending" reads correctly in those contexts and no Lighting-specific component used `brand.yellow` deliberately as an "armed" cue that now also needs migration.
- Token consumers in non-Audio pages still resolve `brand.yellow` directly — they are unaffected because the rebind here is consumer-side, not token-side.

---

## Slice 3 — Unify duplicated controls and readouts

**Goal:** one home for each duplicated control surface, one source for each duplicated readout.

**Single-ownership decisions:**

- **DIM / MONO / TALK.** Keep on [AudioRail.tsx:205-245](frontend/app/src/app/audio/components/AudioRail.tsx:205) (the rail is the global monitor surface — these are room-control actions, not per-output settings). Remove the duplicate `MUTE / DIM / MONO / TALK` row from the Output cards inside [AudioMixerLane.tsx](frontend/app/src/app/audio/components/AudioMixerLane.tsx) Output variant; the Output card keeps `Mute` only (which is per-output and not a duplicate). The per-target `mixTargetFlags` _status badges_ at [AudioRail.tsx:173-177](frontend/app/src/app/audio/components/AudioRail.tsx:173) stay (they are state indicators, not controls — different purpose).
- **LAST SYNC.** Keep in `AudioHealthBar.tsx` footer (`viewModel.footerTelemetry.lastSync`). Remove from the rail Snapshot card's fact grid. The rail keeps Sources / Dest / Active-sends; footer keeps temporal facts.
- **⌘K / SHORTCUTS / BANK PREV / BANK NEXT cheatsheet.** Keep in `AudioHealthBar.tsx`. Remove the duplicate near the inspector Dynamics card if present (grep `BANK PREV` in `AudioInspector*` and `AudioSnapshotDeck`-adjacent files).
- **Level-vocabulary unification.** Keep the three distinct labels (`Monitor level` / `Bus level` / `Send to Main Out` are genuinely three different values — `MONITOR LEVEL` is the rail's main-monitor fader, `BUS LEVEL` is the output bus's own level, `SEND TO …` is the per-channel send level into a bus). Add a one-line doc comment in [audioFormatting.ts](frontend/app/src/app/audio/audioFormatting.ts) documenting which label belongs to which surface so the vocabulary doesn't drift. No code rename.

**Out of scope:** the hardware-card preamp visual hierarchy (Slice 5).

**Reusable utilities:** `viewModel.footerTelemetry.lastSync` is already centralised — confirm the rail snapshot card was reading the same key before removing its renderer.

**Verification:** `audio-populated` at `2560×1440` (full strip) and `audio-selected-channel` at `1920×1080`. Confirm the rail still owns DIM/MONO/TALK, the Output card now reads `Mute` only, footer owns LAST SYNC and cheatsheet, no duplicate cheatsheet in the right rail.

**Risks:** any Playwright test asserting on DIM/MONO/TALK presence inside an Output lane needs updating. Grep `data-control="dim"` and `data-control="talk"` under `frontend/app/src` before merge.

---

## Slice 4 — Meter parity + Playback strip density

**Goal:** Outputs meters become the _loudest_ visual element on the page (they are the most critical levels to trust); Playback strips stop reading as half-built.

**In-scope:**

- [AudioStereoMeter.module.css](frontend/app/src/app/audio/components/AudioStereoMeter.module.css) — promote `data-meter-kind="mixTarget"` styling: wider column, higher LED brightness ceiling, an inner bezel border (preview of the Slice 5 hardware vocabulary). Demote `data-meter-kind="channel"` slightly so the Outputs meters win the page. Confirm the brightness delta survives at `2560×1440` and `1920×1080`.
- [AudioMixerLane.tsx](frontend/app/src/app/audio/components/AudioMixerLane.tsx) Playback variant (the `role === "playback-pair"` branch) — add three compact rows under the fader to fill the empty horizontal space: (a) role/tag chip (`BED · STEREO` etc., resolved from `audio.group.*` tokens), (b) `Send → Main Out` mini gain trim readout (display-only is fine for this slice), (c) the existing `M` toggle. Vertical fader stays left, dB readout stays right, the middle fills with the new triplet.
- Move the Outputs `Mute` button so it sits inside the Bus panel rather than at the bottom row, freeing the bottom row for the demoted state strip.

**Out of scope:** the hardware-bezel extension to Outputs (Slice 5), inspector EQ/Dynamics polish (Slice 6).

**Reusable utilities:** existing `AudioStereoMeter.tsx` `data-meter-kind` attribute; existing `AudioFader.tsx`; existing `formatAudioDb`; existing `audio.group.*` color tokens.

**New component:** introduce `AudioLaneTagStrip` (small CSS-only component in `audio/components/`) consumed by the Playback variant to render the role/tag chip + send hint with consistent vertical rhythm.

**Verification:** `audio-populated` at `1920×1080` and `2560×1440` — Inputs vs Playback vs Outputs side-by-side. Capture the meter brightness delta explicitly with a composite. Re-confirm clip-state rendering on `audio-selected-channel` (a fixture variant where one channel has `clip=true`) still reads correctly given the brightness shift.

**Risks:** meter brightness changes can alter perceived clip behaviour. Verify the clip-state still reads as warn-bright against the new mixTarget baseline.

---

## Slice 5 — Extend "hardware" vocabulary off the preamp

**Goal:** the page reads as one hardware-inspired language. The preamp module stops being a one-off.

**Layering pattern** (reused in Slice 6):

1. **Bezel layer** — outer recessed border, `inset` shadow via `shadow.insetHiStrong`, dark fill via `bg.canvas`.
2. **Backlight layer** — radial-gradient bleed using the new `shadow.glowAmber`, low alpha.
3. **Digit/curve layer** — monospaced tabular numerals (using `font.family.mono`) or SVG path.
4. **Highlight layer** — top inner `1px` highlight using `shadow.insetHi` so the bezel reads as physical.

**In-scope:**

- Introduce [AudioHardwareReadout.tsx](frontend/app/src/app/audio/components/AudioHardwareReadout.tsx) — small CSS-only wrapper emitting the four layers in order, accepting `children` (the digits or SVG) and a `variant` prop (`readout` for compact dB readouts, `display` for graph canvases).
- [AudioMixerLane.tsx](frontend/app/src/app/audio/components/AudioMixerLane.tsx) Outputs `outputBusPanel` (lines ~314-336) — wrap the "Bus level +X.X dB" readout in `AudioHardwareReadout variant="readout"`. CSS hook in `AudioMixerLane.module.css`.
- [AudioInspectorChannelHardwareCard.tsx](frontend/app/src/app/audio/components/inspector/AudioInspectorChannelHardwareCard.tsx) — re-skin the small preamp knob so its bezel matches the strip preamp at smaller scale (same chrome ring, same LED dot behaviour, scaled). Reuse existing `preampPanelNarrow` and `preampPanelCompact` assets from `frontend/app/src/app/audio/assets/preamp/`.
- [AudioRail.tsx:183-203](frontend/app/src/app/audio/components/AudioRail.tsx:183) Monitor-level row — wrap the dB strong in `AudioHardwareReadout variant="readout"` so the rail aligns with the Outputs Bus readout vocabulary.

**Out of scope:** EQ/Dynamics graphs themselves (Slice 6) — they consume this pattern but the pattern lands here. Inspector send sliders defer to a future Phase 4 slice.

**Reusable utilities:** existing preamp PNG assets; existing `shadow.insetHi*` tokens; new `shadow.glowAmber*` from Slice 1; existing `font.family.mono`.

**Verification:** `audio-populated` at `2560×1440` (Outputs row + rail header captured together — proves Bus readout and Monitor readout share a single hardware vocabulary). `audio-selected-channel` to verify the small preamp on the inspector card.

**Risks:** the raster `preamp-panel-*.png` assets get more usage — spot-check FPS on the Tauri dev shell at `2560×1440` after merge to confirm no GPU paint regression.

---

## Slice 6 — EQ & Dynamics at-rest polish (FabFilter pattern)

**Goal:** the two right-rail graphs read as instruments at rest, not as missing data.

**In-scope:**

- [AudioInspectorEqTab.tsx](frontend/app/src/app/audio/components/inspector/AudioInspectorEqTab.tsx) — add: bypassed-but-rendered curve at ~30% opacity when `selectedChannel.eq.enabled === false`; ghosted band handles at default frequencies on first selection (LC 80 Hz, B1 250 Hz, B2 1 kHz, B3 4 kHz) with a `data-ghost=true` styling hook. The frequency-axis layer stays at-rest visible.
- [AudioInspectorEqTab.module.css](frontend/app/src/app/audio/components/inspector/AudioInspectorEqTab.module.css) — wrap the EQ graph in `AudioHardwareReadout variant="display"` (bezel + amber backlight + monospace value badge).
- [AudioInspectorDynamicsTab.tsx](frontend/app/src/app/audio/components/inspector/AudioInspectorDynamicsTab.tsx) — same wrapper. Add adjacent monospace readout cluster showing Ratio / Threshold / Knee (display-only is fine; data already lives on `selectedChannel.dynamics.compressor`). Always-visible axis labels (`-60 dB` / `0 dB` on both sides). The diagonal 1:1 line is correct for bypassed but it now sits inside a hardware bezel.
- [AudioInspectorChannelMeterCard.tsx](frontend/app/src/app/audio/components/inspector/AudioInspectorChannelMeterCard.tsx) — demote the `TEST STAGE` label to `eyebrow`-class typography so it stops competing with the LEVEL readout.

**Out of scope:** functional EQ / Dynamics behavior changes. Presentation only.

**Reusable utilities:** existing `EQ_FREQUENCY_MARKERS`, `EQ_GAIN_MARKERS`, `dynamicsCurvePath`, `dynamicsThresholdPercent` (all in `audioInspectorHelpers`); `AudioHardwareReadout` from Slice 5.

**Verification:** `audio-selected-channel` at `2560×1440` and `1920×1080`. Capture EQ tab and Dynamics tab in _both_ bypassed and active states. The bypassed-state captures are the new evidence that matters most — they should now read as "armed but inactive," not "empty."

**Risks:** the bypassed curve at 30% must not be mistaken for live signal. Verify against the warning band rule that ambiguous trust states must read as warnings — confirm the bypass indicator (button glow off, "PEQ BYPASSED" eyebrow) is unambiguous.

---

## Slice 7 — Toolbar weight and banner cap

**Goal:** never stack two yellow banners. Tabular-numeral status string.

**In-scope:**

- [AudioSignalCanvas.tsx](frontend/app/src/app/audio/components/AudioSignalCanvas.tsx) warning band logic — promote SOLO to the full-width banner because it is operationally critical ("the mix you're hearing isn't the mix you're seeing"). Demote "OSC not verified — never attempted" to an inline indicator dot next to the `Sync` button in [AudioToolbar.tsx](frontend/app/src/app/audio/components/AudioToolbar.tsx). Keep "OSC failed after sync attempt" as a full banner — that _is_ operationally critical. Threshold: a new `viewModel.status.bannerEligible` boolean computed in [audioViewModel.ts](frontend/app/src/app/audio/audioViewModel.ts) keying off whether OSC sync has ever been attempted.
- Right-side packed status string at [AudioSignalCanvas.tsx:172-191](frontend/app/src/app/audio/components/AudioSignalCanvas.tsx:172) — adopt `font.family.mono` with tabular numerals for all numerals (`4 in`, `6 pb`, `3 out`, `ref -18`, `peak -3`) via a new `.statusNumeral` class. Uniform `·` middle-dot separators. Eyebrow caps remain Inter.

**Out of scope:** changing what the status string contains.

**Reusable utilities:** existing `font.family.mono` token; existing dot separator pattern in the rail.

**Verification:** `audio-populated` at `2560×1440` and `1920×1080` — toolbar row only. Take a "SOLO active + OSC not verified (never attempted)" composite to prove the banner-stack ceiling is enforced (one full banner, one inline dot). Take a second composite with "OSC sync failed after attempt" + SOLO active to confirm the legitimately critical state still stacks (and revisit the rule if it's intolerable in practice).

**Risks:** the `bannerEligible` flag is computed from `audioSnapshot.verified` + `lastConsoleSyncAt` — verify the existing fixtures still exercise the inline-indicator path (the "never attempted" state).

---

## Cross-cutting notes

### Slice ordering rationale

- **Bugs first** (Slice 0). Typos make every later visual review noisy.
- **Tokens before consumers** (Slices 1 → 2). Additive token introduction lets Slice 2 do a pure CSS attribute-selector rebind without touching component logic.
- **Unification before redesign** (Slice 3). Collapse duplicates before polishing them, so Slice 5+ only polishes one of each.
- **Density before flourish** (Slice 4 before 5). The meter-parity decision constrains the vertical space available to the Bus readout bezel in Slice 5.
- **Hardware vocabulary before graphs** (Slice 5 before 6). The graphs _consume_ `AudioHardwareReadout`; building it first keeps Slice 6 small.
- **Toolbar last** (Slice 7). The banner cap depends on the new `warn` vs `engaged` semantics already being live across the page.

### Token migration approach

**Additive-then-deprecate.** Slice 1 adds new namespaces (`audio.warn.*`, `audio.engaged.*`, `audio.peakHold.calm`, `shadow.glowAmber*`) without touching `brand.yellow*`. Slice 2 migrates Audio-page consumers. The legacy `brand.yellow*` keys stay through Phase 3 because Lighting and Planning still consume them. A future Phase 4 slice can decide whether to deprecate `brand.yellow` once those pages get their own polish pass.

### Cross-page risk gates

After Slice 2, re-run `npm run tauri:visual:review` with the `lighting-populated`, `planning-populated`, and `setup-ready` fixtures, and human-inspect:

- Lighting subsystem pills (same shared chrome as Audio's pending row).
- Planning's progress-pending indicators.
- Setup's verification badges.

The subsystem-pill harmonization in Slice 2 changes `controlSurface`'s default tone — verify that's semantically correct on those pages and re-screenshot.

### "Richer hardware" extension order

1. Outputs `Bus level` readout (Slice 5) — most operational, biggest visual win.
2. Rail `Monitor level` readout (Slice 5) — pairs visually with Outputs.
3. Inspector hardware-card small preamp (Slice 5) — closes the loop with the strip preamp.
4. EQ + Dynamics graph wrappers (Slice 6).
5. Inspector send sliders — _deferred_ to Phase 4 to keep Phase 3 reviewable.

### Files I confirmed by reading before finalizing

- [core.json](frontend/packages/tokens/src/tokens/core.json) — `color.warning.500` (#D8A95A) already in the set, perfect amber for the new `engaged` role; `shadow.insetHi*` exists but no `glowYellow` / `glowAmber` template, so Slice 1 introduces both glow shapes from scratch.
- [audioViewModel.ts:496](frontend/app/src/app/audio/audioViewModel.ts:496) — confirmed `clock: "clock n/a · sr n/a"` hardcoded.
- [AudioRail.tsx:170-290](frontend/app/src/app/audio/components/AudioRail.tsx:170) — confirmed that `mixTargetFlags` (status badges, lines 173-177) and `monitorButtonGrid` (controls, lines 205-245) serve different purposes; the real DIM/MONO/TALK duplication is between the rail control grid and the Output-lane buttons.
- [AudioSignalCanvas.tsx:99-204](frontend/app/src/app/audio/components/AudioSignalCanvas.tsx:99) — confirmed the OSC warning band (`warningBand`, lines 101-128) and the SOLO warning band (`canvasWarningStack` → `canvasWarningBand[data-kind="solo"]`, lines 201+) are _separate_ components. Slice 7 needs to address both.

---

## End-to-end verification

After each slice:

1. **Build the dev shell:** `npm run tauri:dev` (cold compile ~25 s after dependency build).
2. **Manually inspect** the live shell at the operator-scale equivalent (`Scaled Studio Preview` mode) and at native `2560×1440` if possible.
3. **Run the slice's visual review:** `npm run tauri:visual:review` with the fixtures named in each slice's _Verification_ section. Diff against the prior slice's baseline.
4. **Run guard rails:** `npm run dev:check` (format / lint / scripts / file-health / rust:fmt:check / rust:clippy / protocol:check / frontend:typecheck / native:check / native:test).
5. **For Slice 2 only**, additionally re-run visual review with the Lighting / Planning / Setup fixtures.
6. **Close each slice** with the same evidence pattern used in the Phase 2 close-outs: a brief markdown PR description that names the addressed findings (by the labels in this plan's _Context_ section), links the visual-review composites, and notes any out-of-scope follow-ups discovered mid-slice.

When all eight slices land, the audio page should read as one coherent hardware-inspired premium instrument with no visible defects, no semantic color overload, no duplicated readouts, parity across meters, populated empty states, and a single banner at any moment.
