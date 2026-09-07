# The system behind A (2026-09-07)

Status: the last design deliverable of the handoff before the plan. It names what every A mock is built from so it can be built as tokens and components: the skeleton, the type scale, the colour roles, the material and elevation, the motion policy, the component canon, the state vocabulary, the copy rules and the measures. Every rule below is one the mocks already obey and the probe already measures; the reasons are the operator's.

Sources: the mocks in `docs/redesign/assets/concepts/` (`A-cockpit.html` with ten states, `A-lighting.html`, `A-planning.html`, `A-setup.html`, and `A-system-sheet.html`, the specimen board), the token proposal `docs/redesign/system/tokens-a-2026-09.css` + `.json`, the evidence in `../gold-standard-evidence-2026-09/concepts/` (69 boards, `census.md`, `contrast.md`), and the earlier write-ups: `console-concepts-2026-09.md`, `console-a-states-2026-09.md`, `workspaces-a-2026-09.md`, `viewports-a-2026-09.md`. The plan that builds it is `docs/plans/visual-overhaul-a-2026-09.md`.

## 1. What the system is for

From the operator's chair, in one fixation and without reading a sentence: is it safe to act, what is live right now, what is unconfirmed, and where am I. Take-time controls never move. Nothing scrolls. The four workspaces read as one instrument, and the instrument reads as a sibling of the desk and the deck. The system is the smallest set of rules that makes every board satisfy those four sentences, measured.

## 2. The skeleton: the cluster rule

Every workspace is one grid: **header · cluster · bay · plate · footer**. There is no workspace top bar; the cluster's first element is the state.

| Region        | What it is                                                                                                 | Studio | Live min | Utility      |
| ------------- | ---------------------------------------------------------------------------------------------------------- | -----: | -------: | ------------ |
| Header        | the shell: crest, product, four tabs, three subsystem lamps, latches (Solo, Scene unsaved), the clock      |     56 |       52 | 48           |
| Cluster       | plate, left: the **state display**, the take-time keys, the lists, the standing actions (bottom)           |    424 |      360 | 232 key rail |
| State display | a black display, fixed height: lamp + word, the engine's sentence, the way-out key; nothing below it moves |    180 |      168 | 140          |
| Bay           | the recessed floor the workspace's picture sits on: strips, the plot, the timeline, the step screen        |   rest |     rest | rest         |
| Plate         | plate, right: the selection (strip, fixture, task) or Support; a drawer only in the fallback layouts       |    416 |      360 | drawer 360   |
| Footer        | telemetry as `Label value` items and the shortcut hints                                                    |     40 |       36 | 32           |

The operator ruled on 2026-09-07 that `2560×1440` is the only surface that matters. The live-minimum and utility columns stay for the record (the mocks still lay out for them as a fallback) but are not deliverables or gates; density never comes from the type, the sizes stay.

## 3. Type

Inter for everything read as language, JetBrains Mono (tabular) for values, state words and key caps. Nine steps; any one board uses at most eight of them (measured).

| Step       | Size | Where                                                                           |
| ---------- | ---: | ------------------------------------------------------------------------------- |
| tick       |   12 | scale ticks, eyebrows, secondary meta, kbd hints — the floor; never read to act |
| label      |   13 | labels and rows read to act, hints, sub-lines                                   |
| body       |   14 | body, command keys, table rows, the engine's sentences                          |
| name       |   15 | list names: snapshots, projects, steps                                          |
| value      |   16 | strip names, printed values, section titles, the clock                          |
| word       |   20 | take-time words: caps on big keys, the strip dB, Setup's lead                   |
| state      |   24 | the state word, plate titles                                                    |
| hero small |   32 | Setup's step title (and the hero in the fallback layouts)                       |
| hero       |   44 | the one number read from a metre away: main level, grand master, the focused dB |

Why 12 is the floor: on this monitor (108.8 px per inch) at 70 cm a 12 px Inter capital subtends 10 arcmin, the lower edge of reliable recognition for a familiar short label; 20 px subtends 16.7 arcmin, ISO 9241-303's minimum for reading, which is why every word read during a take is 20 px or larger. Uppercase is reserved for state words, key caps and eyebrows (5–17 % of nodes per board, against 35 % today). Weight 700 appears nowhere; no text shadows; letter-spacing 0.04 em on caps and state words, 0.06 em on eyebrows, none elsewhere.

## 4. Colour roles

The chassis is colourless in every theme. Hue names the family, form names the meaning, and colour never stands alone: a lamp always has a word within 8 px, a keyline always encloses a value or a word.

| Hue     | Fill on a key (it is on)                                                                                                       | Lamp + word / keyline (look here)                                                                                                       | Text                                           |
| ------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Amber   | **engaged**: active mix target, solo, dim, mono, peak hold, lighting on, the current view                                      | attention: `NOT VERIFIED`, `ASSUMED`, `STALE`, `UNSAVED`, `DEGRADED`, armed, a latch, doubt on a value                                  | the count, the latch, the armed word           |
| Green   | **live**: a held talkback, a running timer                                                                                     | ok: `VERIFIED`, `REACHABLE`, `READY`, `ON TIME`, passed, done                                                                           | the confirmed count                            |
| Red     | (no fill at rest) — `CUT ALL`, `Restart the bridge…`, Publish with override are red-keylined commands, at most one per surface | error and hazard: `OFFLINE`, `DISCONNECTED`, `ACTION FAILED`, `UNREACHABLE`, `TALKBACK REFUSED`, 48 V on (lamp + word on the key), clip | the lock note when the rig or the desk is gone |
| Blue    | —                                                                                                                              | information: `PREVIEW`, editing offline                                                                                                 | —                                              |
| Neutral | the primary command key (white in the dark themes, ink in Bone)                                                                | **selected**: a neutral keyline on the strip, fixture, task or step                                                                     | text and muted text                            |

Three rules that fell out of measurement: a black display keeps the dark theme's inks in every theme (the `.well` scope in the tokens), Bone's amber, green and red _text_ variants are darkened to clear 4.5:1 on the light chassis while the _fills_ keep the same hue with a dark ink, and the meter ramp is signal, not status, so it keeps the physical green-yellow-orange-red.

The deck: amber means engaged on screen and on the deck's `→ MAIN`, `DIM`, `GAIN` keys, green means live on `TALK`; the deck's amber accent on the _selected_ strip is the one disagreement and is the engine-side follow-up F1.

## 5. Material and elevation

One light from above; five levels; displays are backlit in every theme.

|  Level | Name    | Recipe (tokens)                                                                              | Lives there                                                                    |
| -----: | ------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
|     −1 | Bay     | `--bay` floor, `inset 0 2px 10px well-shade`                                                 | the strips, the plot, the timeline, the step screen                            |
|      0 | Chassis | `--bg`, flat                                                                                 | the floor between regions                                                      |
|     +1 | Plate   | `linear-gradient(panel-top, panel)`, `inset 0 1px 0 sheen`                                   | cluster, plate, header, footer                                                 |
|      — | Well    | `--well` (black), `inset 0 2px 6px well-shade, inset 0 -1px 0 white/5 %`, display inks       | the state display, readouts, sliders, grooves, meters, fields, screens         |
|     +2 | Key     | `linear-gradient(key-top, key)`, `inset 0 1px 0 sheen, 0 1px 2px shade`, 1 px hairline       | every pressable thing                                                          |
| +2 lit | Lit key | the role fill's gradient, `inset 0 1px 0 white/40 %`, a 14 px (amber) or 18 px (green) bloom | engaged, live                                                                  |
|     +3 | Drawer  | plate recipe + `0 12px 32px black/60 %`                                                      | dialogs, the palette, toasts (to be drawn); the drawer in the fallback layouts |

Blooms are the only glows: lit lamps (10 px), lit keys, the meter peak (6 px) and the meter's emissive under-layer (a blurred copy of the ramp). The state display carries a radial tint of its own tone at ≤ 16 %. Gradients are material (plates, keys, caps at ≤ 6 % luminance difference) or signal (the ramp, the colour-temperature track); never decoration. The census enforces: no outer shadow with a negative offset; blur over 8 px only on a lit element or the drawer; four radii (4 · 8 · 12 · pill).

Per theme, the material is the same physics with a different chassis: Studio a matte black control room, Graphite brushed cool steel, Bone a light workshop under daylight — and in all three the displays stay black and backlit, which is what makes the three read as one instrument.

## 6. Motion

| Purpose                            | Duration           | Easing                           |
| ---------------------------------- | ------------------ | -------------------------------- |
| A lamp or a lit fill switches      | 0 ms (≤ 60 budget) | none — a light does not ramp     |
| A key press                        | 100 ms             | `cubic-bezier(0.2, 0.8, 0.2, 1)` |
| A state word or keyline changes    | 160 ms             | out                              |
| Drawer, dialog, toast enter · exit | 200 · 120 ms       | out · in (8 px rise + fade)      |
| Bank or tab change                 | 160 ms             | in-out                           |
| Meters, countdown bars             | frame rate         | the engine's ballistics          |

Nothing on an idle surface animates (measured: 0 running animations on every board). Hover changes an edge, never a position. `prefers-reduced-motion` removes enter, exit and move and the meters' display smoothing; lamps and lit fills are instantaneous already.

## 7. The component canon

Workspaces compose these and never re-implement them; the design system owns them. Test ids are extended, never renamed.

- **Shell**: `Header` (crest, product, `Tab` ×4, `LampChip` ×3 mirroring the worst state each workspace shows, `Latch` chips, the clock), `Footer` (`Label value` items, hint kbds, one action slot).
- **Cluster**: `StateDisplay` (tone, word, sentence, code, meta, action keys; fixed height (180 px); the armed row), `Latch` row, `Section` (title + count + header keys), `Actions` row.
- **Keys** (one primitive, modes as props): `command`, `primary`, `danger` (red keyline, ≤ 1 per surface), `toggle` (rest / engaged amber), `momentary` (live green for the hold), `arm` (armed: amber keyline, `ARMED · press again · 3.9 s`, countdown bar, the state display's armed row), `hazard` (48 V: red lamp + word), `locked` (dashed, 55 %, `aria-disabled`, reason in the display and the tier header), `segmented` (a well with lit keys; the deck's short caps at 1280), `cap` (mono uppercase) vs `label` (sentence case).
- **Lamps**: `Lamp` (8 px, lit with bloom / unlit), `LampChip` (header), `LampWord` (in rows and tags).
- **Wells**: `Readout` (value, doubt variant with a dashed amber keyline), `Slider` (horizontal, unity notch, cap), `Groove` (vertical fader: a 44 px target column, an 18 px slot, the cap, the unity notch), `Meter` (mono / stereo, ramp + emissive glow, −18 reference, peak, clip lamp; empty in `no-meter`, dimmed in `stale`), `Field` (label + value), `Screen` (the plot, the timeline, the step, the EQ).
- **Strip** (Console): head (name / short name, sub), readout, preamp rows (48 V hazard key + gain key, or tag + other sends, or tag + dim / mono lamps), M / S keys, fader block; `sel` and `doubt` variants.
- **Bay pictures**: `StagePlot` (SVG at rendered size, fixtures, beams tinted by CCT, camera and subject marks), `Timeline` (lanes, cards at start with duration bars, second row on overlap, edge cards hang left, thinner hour labels below 90 px/h, now marker, unscheduled tray), `StepScreen` (content height; one column at 1280).
- **Plate**: `PlateHead` (title, sub, one key), `Section` + `Fields` + `Readouts` + `ControlRow` (slider + value), `Danger` slot at the bottom; every section is visible at once (the plate is tall enough at 2560), so there is no tab row.
- **Setup**: `StepKey` (number, name, description, lamp word: done / current / pending), `ProbeRow` (lamp, name, result sentence, status word), Support sections.
- **Planning**: `TimerRow` (green lamp, name, elapsed, Stop), `ProjectKey` (status lamp, name, meta, status word), `Card`.

## 8. State vocabulary

| Workspace | Word(s), tone                                                                                                                                   | Sentence                                           | Way out                                                                    | Also                                                                      |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Console   | `VERIFIED` ok · `NOT VERIFIED`, `ASSUMED`, `STALE`, `DISABLED` attention · `OFFLINE`, `DISCONNECTED`, `ACTION FAILED`, `TALKBACK REFUSED` error | the engine's (`audioFormatting.ts`)                | Run audio probe · Sync from TotalMix · Open Setup · Dismiss                | locked outlines; doubt marks; empty meters; the shell lamp; the armed row |
| Lighting  | `REACHABLE` ok · `UNSAVED` attention · `UNREACHABLE` error · `PREVIEW` info                                                                     | the program's bridge sentence; the scene sentences | Run bridge probe · Save · press twice · Discard changes… · Save to the rig | rig controls locked; `Scene unsaved` latch in the header                  |
| Planning  | `ON TIME` ok · `SLIPPED` attention                                                                                                              | the day, counts                                    | —                                                                          | derived from counts; see decisions                                        |
| Setup     | `READY` ok · `DEGRADED`, `SETUP REQUIRED` attention                                                                                             | the commissioning summary                          | Run all probes · Start with Import profile                                 | the three shell lamps mirror the probes; Publish with override…           |

Every word is the engine's or the fixture's; the sentence is printed verbatim; a raw code prints small under it and is never the first thing read.

## 9. Copy

Sentence case for commands (verb + object), the deck's words on key caps (mono, uppercase), the engine's words for states. Name the hardware: TotalMix, the UFX III, the bridge, the deck, Companion, the rig. Never engine, backend, transport, IPC in operator copy; "snapshot" only for the Console's scene primitive; "Engine log" stays as the feature's name until the engine copy pass renames it. Numbers carry sign and unit (`-3.8 dB`, `+2.1 dB`, `32 dB`, `3200 K`, `76 %`, `18:24`, `85 min` / `85m` at 1280, `1h 18m`, `U1`, `192.168.1.80`). Every state sentence says what happened and what to do; the way out is a key in the same display.

## 10. Measures (the gates the plan turns into tests)

Per board, per theme, at 2560×1440: no page scroll; type floor 12 px and ≤ 8 sizes, families ⊆ {Inter, JetBrains Mono}; pixel-sampled contrast ≥ 4.5:1 for text (≥ 3:1 large), locked controls at 55 % exempt; every enabled target ≥ 24 px, take-time ≥ 28 px (32 in the studio); radii ⊆ {4, 8, 12, pill}; shadows with no negative offset, blur > 8 px only on lit elements or the drawer; gradients only on plates, keys, caps, meters and the CCT track; 0 running animations at idle; chrome heights within ±2 px of §2; state display at the same place on every workspace; copy scan at 0 forbidden words. Current: 69 boards, 0 contrast fails, 0 small targets, 0 idle animations.

## 11. Decisions carried forward (for the plan's decision table)

The cluster rule replaces the workspace top bar · the state display is fixed-height and first · material v2 with blooms on lit states · a 12 px floor and a nine-step scale · selection is neutral, amber is engaged, blue is the fourth hue · 48 V on is a red lamp and word, not a red fill · locked is a dashed outline at 55 % with the reason in reach · scene recall is one press, saving over a scene is two · Planning's `ON TIME` is derived until the engine owns it · Setup's step screen is content-height · utility mode is a key rail with a drawer · the deck's short names appear on 84 px strips · theme names stay Studio, Graphite, Bone.
