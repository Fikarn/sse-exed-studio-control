# Studio Control — program design brief (the gold standard), 2026-09

Status: proposed 2026-09-04 on branch `ui-gold-standard-2026-09` (cut from `audit-remediation-2026-09` @ 7f273fe), **revised to v1.1 on 2026-09-05** after the operator asked for the UI to be pushed further and supplied an "Industrial Skeuomorphism" design system as input. v1.1 adds a physical material model (§4), sharpens the state and interaction rules it enables (§6–§9), names the primitives it needs (§12) and adds its measures (§15). §16 records what was taken from that system and what was refused, and why. Written before the current program was reviewed, so that the review measures the program against this brief and not the other way round. Companion documents: the ranked review `gold-standard-review-2026-09.md` (same folder) and the sliced plan `docs/plans/gold-standard-2026-09.md`.

This brief is the standard for every operator-visible surface of SSE ExEd Studio Control: the shell, the four workspaces (Setup / Support, Lighting, Audio Console, Planning), the pre-ready surfaces (startup, recovery, protocol mismatch) and every overlay (dialogs, palette, toasts, tooltips, shortcut guide). Where the current implementation, the existing tokens, the current components or the earlier redesign documents agree with it, they stay because they meet the standard. Where they do not, they change.

## 0. What is fixed and what this brief decides

Fixed (the backbone, not up for redesign):

- The four workspaces and the major features each offers; the shell that holds them.
- The engine-authoritative boundary: the front-end never invents state. Gating, confidence, refusals, readiness and every value shown come from engine snapshots.
- The hardware profile (`docs/HARDWARE_PROFILE.md`): `2560x1440` logical on the fixed studio monitor as the primary surface, `1920x1080` as the live minimum, `1280x800` as utility mode, no page scroll, layout by logical CSS pixels, Windows workstation, three themes (Studio, Graphite, Bone).
- The Playwright test-id contract (`data-testid="audio-…"` / `lighting-…` / `planning-…` / `setup-…`): extended, never renamed.

Decided here (open until now, closed by this brief): layout and composition, information hierarchy, visual language and material, type scale, colour and theme logic, iconography, component design, interaction grammar, motion, the empty / loading / error / degraded states, dialogs and confirmations, copy voice, and density per viewport.

## 1. The operator and the desk

Facts (from `docs/HARDWARE_PROFILE.md`, `docs/OPERATIONS.md`, `AGENTS.md`, the lighting and audio direction records):

- One person at one fixed workstation in the SSE Executive Education studio. The app stays open full-time on a dedicated 27-inch `2560x1440` second monitor, roughly 60–80 cm from the operator's eyes, next to the primary monitor that runs TotalMix, Companion and the recording software.
- Their hands are on three things besides the mouse: the RME Fireface UFX III (whose real state lives in TotalMix), the Stream Deck+ (keys, dials, touch strip, driven by Companion from the same engine), and occasionally the lights themselves via the Apollo bridge over sACN.
- Two operator personas share every surface, with no mode switch between them: the standard recording operator (about 95 % of session time: recall a scene, ride a fader, mute, dim, hold talkback, nudge one fixture) and the senior setup operator (patch fixtures, edit and save scenes, commission the deck, run probes, back up).
- Time pressure is real and specific: a take is running, a guest is in the room, and the operator has one glance and one hand free. The cost of a wrong glance is a wrong mute, a wrong scene, a phantom-power hit or a missed clip. The cost of a slow glance is a missed cue.
- The screen is a witness, not the source of truth. TotalMix does not echo writes; the engine reads the desk back and marks every value Confirmed, Adjusted, External or unconfirmed (`ASSUMED`). The bridge can drop; the desk can go `DISCONNECTED`; metering can go `STALE` or `OFFLINE`. Those are normal operating states, not exceptions.
- The operator's other instruments are physical: keys that go down and light up, dials with detents, a fader with a 100 mm throw, LEDs on the deck. The screen sits between two physical control surfaces and should read like one of them.

Design consequences:

1. Everything that matters during a take must be readable from arm's length in one fixation, without reading a sentence. That drives the type floor, the state vocabulary and the "colour plus word" rule.
2. The operator learns the desk with their hands. Primary controls live in fixed places that never move with state, viewport or theme. Content may reflow; controls do not.
3. Doubt is shown where the value is. A value the desk has not confirmed carries its doubt mark inside its own bounds, and the badge that names the doubt sits in the same slot on every workspace.
4. Consequence decides the confirmation. A hold for momentary, a press for a reversible toggle, arm-then-apply for hardware-affecting one-shots, a dialog only for the session-ending and the irreversible.
5. The four workspaces are one instrument. Same skeleton, same chrome heights, same slots, same primitives, same words for the same states. A divergence is allowed only where the hardware metaphor demands it (mixer strips, the stage plot), and even there the tokens are shared.
6. The screen obeys the physics of the desk beside it. Keys go down when pressed and stay down while engaged; lamps light instantly; wells are recessed; panels are mounted; one light falls on all of it. Nothing on it is ornament.

## 2. Principles, each with its test

| #   | Principle                                                        | The test a reviewer applies                                                                                                                                                                                                                                         |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | **The hardware is the truth; the screen is its honest witness.** | Every displayed value traces to an engine snapshot field. Every unconfirmed value is marked within its own bounds. No UI-only state pretends to be hardware state.                                                                                                  |
| P2  | **Fixed places.**                                                | Across the three viewports and three themes, every primary control keeps its region and order (it may lose its label or shrink; it never relocates). State banners push content down; they never cover controls except inside a modal.                              |
| P3  | **One glance, one truth.**                                       | Any state that blocks an action or that the operator must react to during a take is a colour plus a word (or icon), never colour alone; the word is at least 11 px; the state slot is at the same place on every workspace.                                         |
| P4  | **Dense, with floors.**                                          | No text below 10 px anywhere; nothing the operator reads to act below 11 px; body 13 px. No pointer target below 24 x 24 px; take-time controls at least 28 px on their short side.                                                                                 |
| P5  | **One instrument.**                                              | A computed-style census of any workspace finds at most 8 font sizes, 3 font families, 4 corner radii, and the shared chrome heights within ±2 px of this brief. The same state uses the same word, hue and form on every surface.                                   |
| P6  | **Confirmation is proportional to consequence.**                 | Every action is classified (momentary / toggle / one-shot / destructive / session) and uses exactly the mechanism that class prescribes in §8. No dialog for a reversible action; no single press for an irreversible one.                                          |
| P7  | **Calm by default, loud when it matters.**                       | With no signal and no state change, zero elements animate. Glow is reserved for lit lamps and engaged, live, armed and error states. Hover never moves an element; only a press does, and only by one pixel, down.                                                  |
| P8  | **Copy speaks to the person at the desk.**                       | Sentence case, present tense, names the hardware by name, and every error says what happened and what to do next. Never "engine", "backend", "transport", "snapshot", "IPC" in operator copy.                                                                       |
| P9  | **One light, five levels, no ornament.** (new in v1.1)           | Every shadow on screen has its dark side to the bottom-right and belongs to one of the five elevation levels in §4. No screw heads, vents, tape, scanlines or textures beyond the chassis grain; a detail that does not encode level, state or value does not ship. |

## 3. Skeleton: the anatomy every workspace shares

The shell is one grid, top to bottom: **shell header**, **workspace top bar**, **body**, **footer**. Overlays (dialog, palette, toasts, tooltips, shortcut guide) float above the body and never reflow it.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ shell header: crest · product · [Setup / Support][Lighting][Audio][Planning] │  64
│               … lamp strip (Lighting · Audio · Surface · latched) · clock    │
├──────────────────────────────────────────────────────────────────────────────┤
│ workspace top bar: Title · context · [STATE] · … · search · primary · ⋯      │  48
├───────────┬──────────────────────────────────────────────┬───────────────────┤
│ rail      │ canvas                                       │ inspector         │
│ 320       │ (plot / mixer / board / runner)              │ 480               │  1288
│           │                                              │                   │
├───────────┴──────────────────────────────────────────────┴───────────────────┤
│ footer: LABEL value · LABEL value · … · shortcut hints · actions             │  40
└──────────────────────────────────────────────────────────────────────────────┘
```

Heights and widths are per viewport (§13). What is invariant:

- **Shell header** (64 / 56 / 52 px). Left: crest, product name, the four workspace tabs in this order. Right: the lamp strip (one lamp per subsystem plus latched chips, in a recessed groove), then the clock. The header is present on every ready and pre-ready surface, including Setup / Support. Setup is a workspace, not a different application; the operator must always see where they are and be one click from the console.
- **Workspace top bar** (48 / 44 / 40 px). Left to right, in fixed slots: workspace title in the display face; a context element (current scene / current snapshot / active project / current step); the **state badge**; then the search field; then the primary action group; then the overflow menu. The state badge's slot is the same x-region on every workspace. Every workspace has this bar, including Setup (title "Setup" or "Support", context = step or section, state = commissioning readiness).
- **Body**: a left rail (optional), the canvas, and a right inspector (optional). The rail and the inspector are stacks of mounted panels; the canvas is a screen (a well) or a bay of panels (the mixer tiers). The inspector is the one place details live. Selecting anything anywhere populates it; it never pops a second panel. On the utility viewport the rail and inspector become drawers over the canvas.
- **Footer** (40 / 36 / 32 px): one recessed strip. Telemetry items as `LABEL value` pairs with a lamp where the item has a state; shortcut hints on the right; at most one action (a key) at the far right. The same footer primitive on every workspace, same height, same type. No workspace gets a taller or thinner footer.

Empty, loading and degraded states render **inside** the region they belong to, at that region's geometry (a loading inspector is an inspector-shaped skeleton; an empty rail is a rail-shaped empty state). They never replace the skeleton.

## 4. Material and physics (v1.1)

The screen is a control surface mounted next to two real ones. It follows one physical model, in every theme, at every viewport.

**One light.** Light falls from the top-left. Every raised thing has a faint sheen on its top and left edges and a shade to its bottom-right; every recessed thing has its shade on the top-left inside edge. A shadow whose dark side points anywhere else is a defect.

**Five levels.** Every element belongs to exactly one:

| Level | Name         | What lives there                                                                                                                                       | Form                                                                                                                                                                                 |
| ----- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| −1    | **Well**     | Inputs, search, meters, fader grooves, slider tracks, screens (the stage plot, the timeline, the EQ graph), the footer strip, the header's lamp groove | Recessed: `inset 2px 2px 4px shade, inset -1px -1px 1px sheen`; darker than the chassis in dark themes, darker-warm in Bone                                                          |
| 0     | **Chassis**  | The workspace floor, the header and top-bar bodies, gutters                                                                                            | Flat matte; a static grain at ≤ 4 % opacity is the only texture allowed; machined edges (1 px shade line over 1 px sheen line) separate the header, top bar and footer from the body |
| +1    | **Panel**    | Rail and inspector cards, mixer tiers, dialogs' bodies, tiles, bands                                                                                   | Mounted: `inset 1px 1px 0 sheen, 0 0 0 1px shade-edge, 2px 2px 6px shade`; blur ≤ 8 px                                                                                               |
| +2    | **Key**      | Every pressable control: buttons, toggles, tabs, segmented switches, fader caps, slider thumbs, knobs, chips in the lamp groove                        | At rest: `inset 1px 1px 0 sheen, inset -1px -1px 0 shade-edge, 1px 1px 3px shade`. Down: `inset 2px 2px 4px shade, inset -1px -1px 1px sheen` and `translateY(1px)`                  |
| +3    | **Floating** | Dialogs, palette, menus, drawers, tooltips, toasts                                                                                                     | `0 12px 32px shade-deep, 0 0 0 1px shade-edge, inset 1px 1px 0 sheen`; the only level allowed a large blur                                                                           |

**Keys go down and stay down.** A press moves a key down one pixel and inverts its shadow for exactly the press (100 ms). An engaged key (Dim, Mono, Solo, the active mix target, the DMX strip, the current tab) stays down and lights up; a live key (Talkback while held) stays down and lights green for exactly the hold; a hazard key (48 V on) stays down and lights red. A disabled key has no travel: it is flat (no shadow) at 45 % and says why on hover. Hover changes nothing but the edge (`shade-edge` to `shade`) — a key does not rise to meet the pointer.

**Lamps light instantly.** A state lamp is an 8 px LED in a well: lit = solid role colour with a 6 px bloom at 60 %; unlit = the well's own dark with an inset shade. A lamp switches in ≤ 60 ms with no fade; a light does not ramp. Lamps never breathe or pulse.

**Wells hold data.** Anything that displays or accepts a value is recessed: the value is printed in mono on the well's floor. Meters are wells with the signal ramp inside; fader grooves are wells with the key riding in them; the stage plot and the timeline are screens (wells) with the content drawn on the floor; inputs are wells that light their accent edge on focus.

**Panels are mounted, not floated.** A panel never lifts on hover and never casts a large shadow. Its edge is a hairline sheen at the top-left and a hairline shade at the bottom-right, the way a machined plate reads under one lamp.

**Radius**: `4 px` keys, chips, inputs, cells; `8 px` panels, tiles, wells; `12 px` floating surfaces; `pill` for badges and lamps only. Four values, nothing else.

**Spacing**: a 4 px grid. Inside keys 8 / 12; inside panels 12 / 16; between regions the viewport gutter (16 / 12 / 8). Vertical rhythm inside inspectors: 12 px between rows, 16 px between sections.

**Materials per theme** (§6 has the colours): Studio is a matte powder-coated dark chassis with cream sheen; Graphite is brushed dark steel with a cool sheen; Bone is a light warm workshop chassis under diffuse daylight, where the sheen is white and the shade is warm grey. Same physics, three materials.

**Not allowed**: gradients on idle surfaces (a gradient is allowed only where it _is_ the information: meter ramps, CCT swatches, fixture beams, scene thumbnails); glow outside lit lamps and engaged / live / armed / error states; backdrop blur outside floating surfaces and the two glass chips over the stage plot; textures beyond the chassis grain; decorative hardware (screw heads, vents, tape, pins, scanlines); hover elevation; bounce.

## 5. Type scale

Three families, eight sizes, three weights.

| Family                                         | Use                                                                                                                                                                   | Never used for                                                      |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Inter** (variable)                           | Everything read as language: labels, command buttons, prose, list rows, dialog bodies, nav.                                                                           | Values that are compared or that change (those are mono); key caps. |
| **JetBrains Mono** (variable, `tnum` + `zero`) | Values: dB, DMX addresses, times, counts, IPs, ports, shortcuts, state words in badges, footer telemetry, **key caps** (the stamped label on a hardware key), inputs. | Prose, command-button labels, headings.                             |
| **Fraunces** (variable, `opsz`)                | Display only: product name, workspace title, dialog title, at 20 px and above.                                                                                        | Anything under 20 px.                                               |

| Step     | Size / line | Weight    | Role                                                                                                                                                       |
| -------- | ----------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tick     | 10 / 12     | 500       | Axis ticks, meter scales, legend keys. Mono. Never on a control, never a state word.                                                                       |
| caption  | 11 / 14     | 500 / 600 | Secondary labels, kbd hints, chip text, footer telemetry, badge words, **key caps** (600, uppercase, +0.06em: stamped). The floor for anything actionable. |
| dense    | 12 / 16     | 400 / 500 | Table and list rows, strip names, tile meta.                                                                                                               |
| body     | 13 / 18     | 400 / 500 | Default. Command-button labels, inspector rows, dialog body, toasts.                                                                                       |
| emphasis | 14 / 18     | 500 / 600 | Inspector values, section rows the operator scans first.                                                                                                   |
| title    | 16 / 20     | 600       | Section titles, nav labels, inspector heading.                                                                                                             |
| display  | 20 / 24     | 500       | Workspace title, dialog title (Fraunces).                                                                                                                  |
| hero     | 28 / 30     | 500       | Master level, the clock, the arm countdown numeral (mono).                                                                                                 |

Rules: letter-spacing is `0` everywhere except uppercase micro-labels and key caps (`+0.06em`, the stamped look); no `0.12em` tracking. Uppercase is reserved for state words, micro-labels and key caps; command buttons and headings are sentence case. Weight 700 appears nowhere. No text shadows. The UI-scale setting (90 / 100 / 110 / 125) multiplies this scale uniformly; it never changes which step a role uses. The scale is the same on every workspace; the Console does not get its own.

**Keys versus buttons.** A _key_ mirrors a hardware control and shows a state: `DIM`, `MONO`, `TALK`, `M`, `S`, `48 V`, `→ MAIN`, `SOLO CLR`, the mix-target keys. Its cap is stamped: mono, uppercase, caption step, the same words the Stream Deck prints, so the two surfaces read as one. A _button_ issues a command: "Save scene", "Run audio probe", "Recall", "Capture snapshot". Its label is a sentence-case verb in Inter.

## 6. Colour and theme logic

**The chassis is colourless.** Chrome, panels, wells and keys at rest are greys of the theme's material. Colour appears only as state (lamps, lit keys, keylines, badge words, bands), as signal (meter ramps), and as identity tags (tier hues, CCT swatches, priorities) — never as decoration. Hue carries the family; **form carries the meaning**. The same hue may serve two roles only when the forms cannot be confused.

| Role                                                                                                                        | Studio              | Graphite        | Bone                 | Forms allowed                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------- | --------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accent (selection, focus, "you are here", ready)                                                                            | sage `#99BA92`      | teal `#6FD6CE`  | deep green `#36603A` | 2 px keyline + 10 % tint for selection; 2 px ring for focus; lit lamp + word for ready; the active nav tab. Never a fill on a key.                                                                                                                    |
| Engaged (a mode or latch the operator switched on: active mix target, dim, mono, solo, current scene / snapshot, DMX strip) | amber `#D8A95A`     | amber `#E0B463` | amber ink `#6F4A0A`  | **Lit fill on a key that is down** (dark ink on amber in the dark themes, light ink on amber ink in Bone); lit lamp; solid "current" tag.                                                                                                             |
| Attention (the system flags it: not verified, stale, assumed, unsaved, armed, solo latched)                                 | amber (same)        | amber           | amber ink            | Lamp, keyline, dashed keyline (assumed value), badge word, band. **Never a fill.**                                                                                                                                                                    |
| Error / hazard (failed, offline, disconnected, refused, clip, 48 V on, Cut all, Close)                                      | red `#D56A65`       | red `#E5736E`   | red ink `#9C2F26`    | Lamp + word; band with the way out; clip cap; the lit fill of a hazard key that is down (48 V, one per channel that has it on — that is hardware state, not decoration). Red _commands_ (Cut all, Delete, Close) are at most one per surface at rest. |
| Live (a momentary hold is active: talkback, identify burst)                                                                 | green `#36CE71`     | green `#4DE08A` | green ink `#1F7A3E`  | Lit fill on the held key for exactly the hold; nothing else.                                                                                                                                                                                          |
| Info / offline edit (preview mode, informational)                                                                           | blue `#69A9D1`      | blue `#7FC0E8`  | blue ink `#215586`   | Lamp + word; band across the surface being previewed.                                                                                                                                                                                                 |
| Disabled                                                                                                                    | 45 % of text colour | same            | same                 | Flat (no travel, no shadow) + `not-allowed` cursor + the gate's reason within reach (tooltip or the band).                                                                                                                                            |

Identity hues (audio tiers, output targets, planning priorities, CCT, fixture kinds) are tags, keylines and swatches; they are never solid fills behind text and never used for a state. Meters keep the physical ramp (green → amber → orange → red) because the operator reads it as signal, not status.

Themes re-map the material (chassis, panel, well, sheen, shade), text and the accent; they never change what a hue means. Every theme passes: text ≥ 4.5:1 against its actual rendered background, UI component edges, lamps and keylines ≥ 3:1 against their surface, focus ring ≥ 3:1 against both the control and the surface. Bone is not "dark inverted": its lit keys carry light ink on amber ink, its sheen is white and its shade is warm.

Only the semantic tokens are allowed in component CSS (`--color-role-*`, the material set `--surface-{well,chassis,panel,float}`, `--sheen`, `--shade*`, the elevation shadows, the text ramp). Raw palette entries and `rgba()` literals in a component stylesheet are a defect the token test catches.

## 7. State vocabulary

The words below are the only state words. Each has one hue, one form and one slot; the specific word beats the generic (say `STALE`, not `ATTENTION`).

| State                            | Word(s)                                                        | Hue / form                                            | Where it renders                                                                                                 |
| -------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Ready                            | `READY` (badge), `Ready` (prose)                               | accent · lit lamp + word                              | Top-bar state badge; shell lamp strip.                                                                           |
| Attention, not blocked           | `STALE`, `UNSAVED`, `SIMULATED`, `PENDING`, `DEGRADED`         | attention · lit lamp + word                           | Top-bar badge; lamp strip; footer item lamp.                                                                     |
| Attention, blocked               | `NOT VERIFIED`, `DISABLED`, `ASSUMED`                          | attention · badge + **band** with one action          | Badge in the top bar, band directly under it pushing the body down, keys flat with the reason.                   |
| Error                            | `OFFLINE`, `DISCONNECTED`, `UNREACHABLE`, `FAILED`, `MISMATCH` | error · badge + band with the way out                 | Same slots as blocked attention.                                                                                 |
| Assumed value                    | none (per value)                                               | attention · dashed 1 px keyline around the value      | On the value itself (fader cap, knob ring, tile), in addition to the `ASSUMED` badge.                            |
| Armed                            | `ARMED` + countdown                                            | attention · 2 px keyline + ring on a key that is down | On the armed key only; mirrored on the deck; cleared by the second press, Esc, or timeout.                       |
| Live (momentary)                 | `LIVE` / the key cap                                           | live · lit fill on a key that is down                 | On the held key (Talkback).                                                                                      |
| Engaged                          | the key cap                                                    | engaged · lit fill on a key that is down              | On the key (`DIM`, `MONO`, `→ MAIN`, DMX strip, the current tab); `CURRENT` tag on the current scene / snapshot. |
| Latched, cross-workspace         | `Solo · 2`, `Scene · unsaved`                                  | attention · chip (a key in the lamp groove)           | Shell lamp strip, clicking jumps to the owner.                                                                   |
| Selected                         | none                                                           | accent · keyline + tint                               | On the selected item; inspector shows it.                                                                        |
| Loading                          | `Loading <thing>…`                                             | neutral · skeleton                                    | In place, same geometry as the loaded region.                                                                    |
| Empty                            | title + one next step                                          | neutral · dashed well                                 | In place, one primary action.                                                                                    |
| Preview / offline edit           | `PREVIEW`                                                      | info · badge + band                                   | Top bar of the workspace being previewed.                                                                        |
| Disabled                         | —                                                              | flat key at 45 % + reason                             | On the key; reason in tooltip or the band above.                                                                 |
| Off (a lamp with nothing to say) | —                                                              | unlit lamp (dark well)                                | Wherever a lamp exists; an unlit lamp is a statement, a missing lamp is not.                                     |

Two invariants: colour never stands alone (a lamp always has a word within 8 px or a label it belongs to), and a workspace's worst state is always visible in two places, the top-bar badge and the shell lamp strip, so the operator sees it from any workspace.

## 8. Interaction grammar

**Selection.** Click selects; Shift-click extends a range; Ctrl-click toggles membership; drag on the plot marquees; Esc clears. Selection is a 2 px accent keyline plus 10 % tint on the item, the inspector shows it, and the selection chip strip lists it when more than one is selected. Selection is never shown by changing the item's text colour alone.

**Pointer states.** Hover: the key's edge darkens (`shade-edge` → `shade`); no translation, no lift, no scale. Press: the key goes down (1 px, inverted shadow) for the press. Focus (keyboard): 2 px accent ring, 2 px offset, on every focusable element including sliders and canvas items. Disabled: §7.

**Toggles (keys).** One press flips; the key goes down and lights from the optimistic draft, then the engine snapshot confirms (a value the desk kept different flips back and shows the `Adjusted` toast). A key never opens a dialog.

**Continuous controls** (faders, knobs, sliders, scrub labels). Drag with the pointer; wheel steps; arrow keys step (Shift × 5); double-click resets to the documented default; typing on a focused value opens the number entry. The cap or thumb is a key riding in a well; the value is printed in mono on the well's floor or next to it at the emphasis step, always with unit and sign. Throttled commits while dragging, final commit on release.

**Arm-then-apply** (48 V, snapshot recall, snapshot overwrite, scene overwrite, palette recall, bulk fixture changes). First press arms the key: it goes down, shows `ARMED`, an attention keyline and a 4.5 s countdown ring; a second press on the **same** key at least 350 ms later applies; Esc, timeout or pressing anything else disarms and the key comes back up. Only one thing is armed at a time. The deck mirrors the arm.

**Momentary.** Talkback and identify bursts are holds: pointer down / key down engages, release ends; a hold is re-sent on a timer and the engine auto-releases, so nothing can latch. The held key is down and lit for exactly the hold.

**Dialogs.** Only for: closing the app, restarting the engine bridge, discarding an unsaved scene, publishing with failing probes, loading sample planning data, restoring a backup, deleting a fixture / scene / project / snapshot. A dialog has a title that is a question, one sentence of consequence, a primary button that names the verb ("Close Studio Control", "Discard changes", "Delete fixture"), and Cancel. Enter confirms only non-destructive dialogs; Esc always cancels; focus starts on Cancel for destructive ones. One modal at a time; the palette closes the shortcut guide and vice versa.

**Feedback.** Every command shows something within 100 ms (the key going down, the optimistic draft) and the truth on the next snapshot. A toast is for results the operator could not see happen in place (sync report, recall report, backup written, export done, an `Adjusted` value) and for failures with a next step. Never a toast for something visible where the operator is looking. Toasts stack bottom-right above the footer, at most three, newest at the bottom; success auto-dismisses at 4 s; errors stay until dismissed.

**Shortcuts.** `Ctrl+1…4` workspaces, `Ctrl+K` palette, `?` guide, `Esc` back out. Single-key mnemonics inside a workspace only for actions that are safe to fire by accident or that mirror a physical hold (`T` talkback hold, `[` `]` bank, `S` solo on the selected strip). Anything that changes hardware state from a single key must be a hold or already gated by arming. Labels use Windows glyphs (`Ctrl`, `Alt`, `Shift`) from `shortcutGlyphs.ts`. Every shortcut is in the guide and in the palette.

## 9. Motion policy

| Purpose                                     | Duration   | Easing                                                |
| ------------------------------------------- | ---------- | ----------------------------------------------------- |
| Lamp on / off, lit fill on / off            | ≤ 60 ms    | none (a light does not ramp)                          |
| Key down / up, hover edge, focus ring       | 100 ms     | mechanical: `cubic-bezier(0.2, 0.8, 0.2, 1)`          |
| State change on a badge or keyline          | 160 ms     | out                                                   |
| Enter (dialog, palette, drawer, toast)      | 200 ms     | out (8 px rise + fade; a drawer slides from its edge) |
| Exit                                        | 120 ms     | in (fade only)                                        |
| Move / reflow (bank change, tab change)     | 160 ms     | in-out                                                |
| Live signal (meters, fades, countdown ring) | frame rate | linear, ballistics from the engine                    |

No overshoot anywhere: a key that bounces lies about its mechanism. No ambient loops on idle surfaces: no breathing lamps, no pulsing chips, no hover pulses. The only continuous motion is live signal and the armed countdown. `prefers-reduced-motion` removes every enter / exit / move animation and every decorative smoothing, including the meter display smoothing (the peak-hold and fall ballistics stay because they are the signal, not decoration); key travel and lamps are instantaneous already and stay.

## 10. Copy voice

- Sentence case for everything except state words, micro-labels and key caps. "Run audio probe", not "RUN AUDIO PROBE"; `DIM` on the key, "Dim the main monitors" in the tooltip.
- Present tense, second person implied. "TotalMix reports the UFX III is disconnected. Check the USB link and power."
- Name the hardware by name: TotalMix, the UFX III, the bridge, the deck, Companion, the rig. Never "engine", "backend", "transport", "IPC", "snapshot" (the audio scene primitive is called a snapshot in TotalMix, so that word is allowed only for that primitive), "fixture transport", "OSC" outside Setup.
- Every error has three parts: what happened, what it means for the operator, what to do (with the control that does it in the same band or toast).
- Buttons are verbs with objects ("Save scene", "Recall", "Run probe", "Export backup"); never "OK", "Yes", "Submit", "Confirm". Key caps are the deck's words (`TALK`, `DIM`, `→ MAIN`, `SOLO CLR`).
- Numbers: dB with sign and one decimal (`-18.0 dB`, `+3.5 dB`), DMX as integers, times 24-hour `HH:MM`, durations `12m` / `1h 04m`, relative time only for "last …" facts and never more precise than a minute. Units are always printed.
- Empty states say what the thing is for and offer the one next step. Loading states name what is loading.

## 11. Iconography

One set: Lucide, stroke 1.75 at 16 px and 1.5 at 20 px, currentColor. Icons are paired with a label except in the utility viewport's icon-only toolbars, where every icon has a tooltip with the label and shortcut. No workspace-local SVG icons; anything not in Lucide is added to the design-system icon module once. Status is never conveyed by an icon alone. An icon on a key is stamped like the cap: it sits in the cap's ink colour and moves down with the key.

## 12. Component canon

The design system owns these primitives; workspaces compose them and never re-implement them locally:

- **AppShellFrame** (header + body grid + footer slot), **NavItem**, **LampStrip** + **Lamp** (the LED in a well, lit / unlit, with its word), **WorkspaceTopBar** (new: title / context / state badge / search / actions / overflow slots), **HealthBar** (one variant, one recessed row).
- **Key** (new: the pressable hardware control with rest / down / engaged / live / hazard / armed / disabled physics and a stamped cap; `ToggleKey`, `MomentaryKey`, `ArmKey` are its modes; `data-testid="audio-arm-countdown"` stays on the arm ring), **Button** (command: primary, secondary, ghost, danger; sizes 32 / 28; sentence case Inter; keys and buttons share the level +2 physics), **IconButton**, **SegmentedControl** (a well with one raised key), **Tabs** (keys in a row, the engaged one down).
- **StatusBadge** (mono word + lamp, pill), **StatusBand** (badge + sentence + one action; the only banner), **StatusChip** (latched, a key in the lamp groove).
- **Panel** (level +1) with **InspectorPanel** + **InspectorSection**, **Rail** + **RailHead**, **DenseTable / DenseList**, **MetricCard**; **Well** (level −1) as the base of **Input**, **Search**, **Screen** (the plot and timeline host), **MeterWell**.
- **Fader** and **Knob** (promoted from Audio, since Lighting's intensity and CCT controls share the grammar: a key riding in a well), **ScrubSlider**, **MultiValueSlider**, **ScrubLabel**, **NumberEntryDialog**.
- **Dialog**, **ConfirmDialog**, **CommandPalette**, **ContextMenu**, **Tooltip**, **Toast** (level +3), **EmptyState**, **LoadingState** (skeleton at the host's geometry), **DegradedState**.

Removed from the canon: any second badge / pill / band with its own tone map, the `caption` footer variant, uppercase mono command buttons, per-workspace theme switches (the theme is a system setting reached from the palette and Setup), hover elevation on cards and buttons.

## 13. Density rules per viewport

|                | `2560x1440` studio                    | `1920x1080` live minimum                             | `1280x800` utility                                        |
| -------------- | ------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------- |
| Layout mode    | `studioFull`                          | `studioFull` (compact density keyed at width < 2200) | `narrowUtility`                                           |
| Shell header   | 64                                    | 56                                                   | 52                                                        |
| Top bar        | 48                                    | 44                                                   | 40                                                        |
| Footer         | 40                                    | 36                                                   | 32                                                        |
| Gutters        | 16                                    | 12                                                   | 8                                                         |
| Rail           | 320                                   | 280                                                  | 64 px key rail (take-time keys only) + drawer             |
| Inspector      | 480                                   | 380                                                  | drawer                                                    |
| Toolbar labels | on                                    | on, kbd hints off                                    | icons only + tooltips                                     |
| Product name   | on                                    | on                                                   | off (crest only)                                          |
| Lamp strip     | lamp + label + detail + target        | lamp + label + detail                                | lamp + label                                              |
| Audio Console  | 4 / 6 / 3 strips, 480 inspector       | 4 / 4 / 3 strips banked, 380 inspector               | 4 / 4 / 3, inspector as drawer, meters still live         |
| Lighting       | rail + plot + inspector               | same, plot ≥ 560 x 440                               | plot + drawers, plot ≥ 520 x 400                          |
| Planning       | board or timeline + inspector         | same                                                 | board or timeline, inspector as drawer                    |
| Setup          | runner column max 1200 + support rail | runner max 1100                                      | runner full width, support in its own section             |
| Type scale     | ×1                                    | ×1                                                   | ×1 (density comes from chrome, never from shrinking text) |

The vertical budget therefore leaves the body 1288 / 944 / 676 px. Nothing scrolls the page. Internal scrolling is allowed only in lists that are unbounded by nature (planning boards, scene lists, palette results, DMX monitor) and every such list shows an edge fade so the operator knows there is more.

## 14. How the shared skeleton maps onto each workspace

- **Setup / Support** renders inside the shell frame with the nav visible. Top bar: "Setup" · step name · commissioning state badge · `Runner | Support` segmented control · actions. The runner steps are the rail (each step a lamp: done lit accent, current lit amber, pending unlit); the step body is the canvas; probe results and the deck echo (a grid of keys mirroring the deck, lighting as the operator presses the real ones) are the inspector. Support mode swaps the canvas for backup / restore / diagnostics with the same chrome.
- **Lighting**: top bar "Lighting" · current scene · `READY / UNREACHABLE / PREVIEW` · search · Add fixture · Patch · overflow. Rail: master (a key and a fader), scenes, groups. Canvas: the stage plot as a screen. Inspector: the selection (fixture / group / scene / patch / palettes as tabs).
- **Audio Console**: top bar "Audio" · current snapshot · `READY / NOT VERIFIED / ASSUMED / …` · search · Sync · Probe · Snapshot · overflow. Rail: monitor section (`TALK` momentary key, `DIM` and `MONO` keys, master meter well and level), snapshots, console-link panel. Canvas: the three tiers as panels in a bay, each strip a fader well with its `M` / `S` keys. Inspector: the selected strip. Warning bands sit under the top bar.
- **Planning**: top bar "Planning" · active project · `READY` · search · New project · `Board | Timeline` · overflow. Rail: projects. Canvas: board or timeline as a screen. Inspector: the selected task / project.

The features do not change; their placement follows the skeleton so that a hand that knows one workspace knows the others.

## 15. Measures

These are the assertions the review script and the future gates evaluate, per fixture, per viewport, per theme:

| Measure       | Threshold                                                                                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page scroll   | `documentElement.scrollWidth/Height` ≤ viewport + 1                                                                                                                          |
| Type floor    | min computed font-size ≥ 10 px; interactive text ≥ 11 px; ≤ 8 distinct sizes per workspace; families ⊆ {Inter, JetBrains Mono, Fraunces}                                     |
| Contrast      | text ≥ 4.5:1 (≥ 3:1 for ≥ 24 px or ≥ 19 px bold) vs the rendered background, pixel-sampled; lamps, keylines, key edges, focus ring ≥ 3:1                                     |
| Targets       | every enabled pointer target ≥ 24 px short side; take-time keys (mute, solo, dim, mono, talkback, recall, scene tiles, nav) ≥ 28 px                                          |
| Radii         | ≤ 4 distinct values, ⊆ {4, 8, 12, pill}                                                                                                                                      |
| Chrome        | header / top bar / footer heights within ±2 px of §13; state badge in the same x-band (±24 px) on all four workspaces                                                        |
| Overflow      | no clipped text (scrollWidth > clientWidth on an `overflow: hidden` text element); no element extends past the viewport                                                      |
| Idle motion   | zero running animations 1 s after load with no live signal                                                                                                                   |
| Light (v1.1)  | every outer box-shadow has x ≥ 0 and y ≥ 0 offsets (dark side bottom-right) and blur ≤ 8 px outside level +3; every inset shadow's dark offset is positive (top-left inside) |
| Levels (v1.1) | every element with a box-shadow matches one of the five elevation token values exactly; no level-0 element carries a shadow                                                  |
| Press (v1.1)  | `:active` on a key translates by exactly 1 px in y and inverts to the down shadow; `:hover` translates 0 px                                                                  |
| Lamps (v1.1)  | every lit lamp has a word within 8 px; lamp on/off transition ≤ 60 ms; no lamp animates at idle                                                                              |
| Tokens        | no colour, radius, shadow or font literal in a component stylesheet                                                                                                          |
| Copy          | no operator-facing string contains the forbidden words in §10; every error band has an action                                                                                |
| Themes        | all of the above in Studio, Graphite and Bone                                                                                                                                |

A change ships when it moves these numbers toward the thresholds and never away from them; the review's findings are the gap between the current numbers and this table.

## 16. What v1.1 took from the industrial system, and what it refused

Taken, because it serves the person at the desk:

- **One light source and structural shadows.** The current program paints 129 shadows on the idle Console with no shared direction or meaning; the elevation model gives every shadow a job and a direction.
- **Named elevation levels** (well / chassis / panel / key / floating) as tokens, instead of an unnamed ramp of surface tints.
- **Key physics**: press = down and inverted shadow; engaged = stays down and lit. This is how the deck and the desk behave, and it doubles every state's colour with a form, which P3 demands.
- **Lamps as LEDs** with a word beside them, lit or unlit, never breathing.
- **Wells for data**: inputs, meters, grooves and screens recessed; values printed in mono on the floor.
- **Stamped key caps** in mono uppercase, matching the deck's own labels.
- **Material honesty across the three themes** (powder-coated dark, brushed steel, light workshop chassis) and a static chassis grain at ≤ 4 %.
- **One loud colour used sparingly**: red is the emergency stop of the palette; at rest at most one red control per surface.

Refused, because it costs the operator or contradicts the backbone:

- A light-only palette: the studio monitor runs a dark theme by default and three themes are fixed.
- 8–24 px neumorphic blur on everything: it flattens edge contrast, fails the 3:1 component rule, and turns a 2560 px console into fog.
- Screw heads, vent slots, masking tape, push pins, hanging holes, scanlines, carbon fibre, blueprint grids, grayscale-to-colour images: ornament that encodes nothing.
- Hover lift on cards and buttons, bounce easing, breathing LEDs: motion that lies about mechanism or animates an idle surface.
- Hero typography, 60-character measures, 48 px mobile targets, mobile-first breakpoints: a fixed 2560 monitor with a mouse and a deck, not a web page.
- A single safety-orange accent for "interactive": the operator needs engaged, attention and hazard to read differently at a glance; the three-hue vocabulary stays.
- Text shadows and embossed headings: they blur exactly the text the operator reads at a glance.
