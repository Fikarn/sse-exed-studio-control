# The visual system

Every page is built to these rules, and the page tests measure them (section 10). Read this before changing anything the operator sees.

## 1. What the system is for

From the operator's chair, in one glance and without reading a sentence: is it safe to act, what is live right now, what is unconfirmed, and where am I. Controls used during a take never move. Nothing scrolls. The pages read as one instrument, and the instrument reads as a sibling of the desk and the deck.

## 2. The skeleton

Every page is one grid: **header · cluster · bay · plate · footer**. There is no page top bar; the cluster's first element is the state. The one surface is 2560×1440, fullscreen.

| Region        | What it is                                                                                                   | Size (px) |
| ------------- | ------------------------------------------------------------------------------------------------------------ | --------: |
| Header        | crest, product, the tabs, one lamp per subsystem, latches, the clock                                         |   56 high |
| Cluster       | left plate: the **state display**, the take-time keys, the lists, the standing actions (bottom)              |  424 wide |
| State display | a black display, fixed height: lamp and word, the engine's sentence, the way-out key; nothing below it moves |  180 high |
| Bay           | the recessed floor the page's picture sits on: strips, the plot, the glass, the step screen                  |  the rest |
| Plate         | right plate: the selection (strip, fixture, script, camera) or Support                                       |  416 wide |
| Footer        | telemetry as `Label value` items and one action key                                                          |   40 high |

The tabs are Setup / Support · Lighting · Audio · Cameras · Teleprompter. The header's lamps follow the tab order with the deck last: Lighting · Audio · Cameras · Prompter · Surface. Density never comes from the type; the sizes stay.

## 3. Type

Inter for everything read as language, JetBrains Mono (tabular) for values, state words and key caps. Nine steps; any one page uses at most eight of them.

| Step       | Size | Where                                                               |
| ---------- | ---: | ------------------------------------------------------------------- |
| tick       |   12 | scale ticks, eyebrows, secondary meta: the floor; never read to act |
| label      |   13 | labels and rows read to act, hints, sub-lines                       |
| body       |   14 | body, command keys, table rows, the engine's sentences              |
| name       |   15 | list names                                                          |
| value      |   16 | strip names, printed values, section titles, the clock              |
| word       |   20 | take-time words: caps on big keys, the strip dB, Setup's lead       |
| state      |   24 | the state word, plate titles                                        |
| hero small |   32 | Setup's step title                                                  |
| hero       |   44 | the one number read from a metre away                               |

Why 12 is the floor: on this monitor (108.8 px per inch) at 70 cm a 12 px capital is at the lower edge of reliable recognition for a short familiar label, and 20 px is the minimum for reading, which is why every word read during a take is 20 px or larger. Uppercase is reserved for state words, key caps and eyebrows. Weight 700 appears nowhere. No text shadows. Letter-spacing is 0.04 em on caps and state words, 0.06 em on eyebrows, none elsewhere.

A picture is the exception: the prompter's glass and a camera's picture are marked `data-picture`, and what is inside them is the presenter's or the camera's, not the page's. The measures skip it.

## 4. Colour roles

The chassis is colourless. Hue names the family, form names the meaning, and colour never stands alone: a lamp always has a word within 8 px, and a keyline always encloses a value or a word.

| Hue     | Fill on a key (it is on)                                                                                       | Lamp and word, or keyline (look here)                                                                                             |
| ------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Amber   | **engaged**: active mix target, solo, dim, mono, peak hold, lighting on, the current view                      | attention: `NOT VERIFIED`, `ASSUMED`, `STALE`, `UNSAVED`, `DEGRADED`, `NOT UPDATED`, `RELEASED`, armed, a latch, doubt on a value |
| Green   | **live**: a running timer, the prompter playing                                                                | ok: `VERIFIED`, `REACHABLE`, `READY`, `ON SCREEN`, `HELD`, passed, done                                                           |
| Red     | no fill at rest; `CUT ALL` and `Restart the hardware link…` are red-keylined commands, at most one per surface | error and hazard: `OFFLINE`, `DISCONNECTED`, `ACTION FAILED`, `UNREACHABLE`, `NOT CONNECTED`, 48 V on, recording (`REC`), clip    |
| Blue    | none                                                                                                           | information: `PREVIEW`, editing offline, a cue in a script                                                                        |
| Neutral | the primary command key (white)                                                                                | **selected**: a neutral keyline on the strip, fixture, script, camera or step                                                     |

Hazards are a red lamp and a word on a dark key, never a red fill: 48 V on, and `REC` while the main camera records. Doubt is amber: a value the engine has not confirmed, or a last known value from a device that stopped answering.

Black displays keep their inks everywhere. The meter ramp is signal, not status, so it keeps the physical green, yellow, orange and red.

There is one theme, Studio: a matte black control room.

## 5. Material and elevation

One light from above; five levels; displays are backlit.

|  Level | Name    | Recipe (tokens)                                                  | Lives there                                                            |
| -----: | ------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
|     −1 | Bay     | `--bay` floor, `inset 0 2px 10px well-shade`                     | the strips, the plot, the step screen                                  |
|      0 | Chassis | `--bg`, flat                                                     | the floor between regions                                              |
|     +1 | Plate   | `linear-gradient(panel-top, panel)`, `inset 0 1px 0 sheen`       | cluster, plate, header, footer                                         |
|    n/a | Well    | `--well` (black), inset shade, display inks                      | the state display, readouts, sliders, grooves, meters, fields, screens |
|     +2 | Key     | `linear-gradient(key-top, key)`, sheen, 1 px hairline            | every pressable thing                                                  |
| +2 lit | Lit key | the role fill's gradient, a 14 px (amber) or 18 px (green) bloom | engaged, live                                                          |
|     +3 | Drawer  | plate recipe and `0 12px 32px black/60 %`                        | dialogs, drawers, toasts                                               |

Blooms are the only glows: lit lamps, lit keys, the meter peak and the meter's emissive under-layer. Gradients are material (plates, keys, caps) or signal (the meter ramp, the colour-temperature track), never decoration. No outer shadow has a negative offset. Blur over 8 px appears only on a lit element or the drawer. There are four radii: 4 · 8 · 12 · pill.

## 6. Motion

| Purpose                                       | Duration     | Easing                           |
| --------------------------------------------- | ------------ | -------------------------------- |
| A lamp or a lit fill switches                 | 0 ms         | none: a light does not ramp      |
| A key press                                   | 100 ms       | `cubic-bezier(0.2, 0.8, 0.2, 1)` |
| A state word or keyline changes               | 160 ms       | out                              |
| Drawer, dialog, toast enter · exit            | 200 · 120 ms | out · in (8 px rise and fade)    |
| Bank or tab change                            | 160 ms       | in-out                           |
| Meters, countdown bars, the prompter's scroll | frame rate   | the engine's                     |

Nothing on an idle surface animates. Hover changes an edge, never a position. `prefers-reduced-motion` removes enter, exit and move and the meters' display smoothing.

## 7. The components

Pages compose these and never re-implement them; `frontend/packages/design-system` owns them. Test ids are extended, never renamed.

- **Shell**: `Header` (crest, product, tabs, one `LampChip` per subsystem showing its worst state, `Latch` chips, the clock) and `Footer`.
- **Cluster**: `StateDisplay` (tone, word, sentence, code, meta, action keys; 180 px high; the armed row), `Latch` row, `Section`, `Actions` row.
- **Keys** (one primitive, modes as props): `command`, `primary`, `danger` (red keyline, at most one per surface), `toggle`, `momentary`, `arm` (armed: amber keyline, `ARMED · press again`, a countdown bar, the state display's armed row), `hazard` (red lamp and word), `locked` (dashed, 55 %, `aria-disabled`, the reason within reach), `segmented`, `cap` (mono uppercase) and `label` (sentence case).
- **Lamps**: `Lamp`, `LampChip` (header), `LampWord` (rows and tags).
- **Wells**: `Readout` (with a doubt variant: a dashed amber keyline), `Slider`, `Groove` (the vertical fader), `Meter`, `Field`, `Screen`.
- **Strip** (Console): head, readout, preamp rows, M / S keys, fader block; selected and doubt variants.
- **Plate**: `PlateHead`, `Section`, `Fields`, `Readouts`, `ControlRow`, and a `Danger` slot at the bottom. Every section is visible at once, so there is no tab row.
- **Setup**: `StepKey`, `ProbeRow`, the Support sections.

## 8. State words

Every state word is the engine's. Its sentence is printed as the engine gives it. A raw code prints small under the sentence and is never the first thing read. Every state sentence says what happened and what to do, and the way out is a key in the same display.

| Page         | Words                                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------- |
| Console      | `VERIFIED` · `NOT VERIFIED`, `ASSUMED`, `STALE`, `DISABLED` · `OFFLINE`, `DISCONNECTED`, `ACTION FAILED` |
| Lighting     | `REACHABLE` · `UNSAVED` · `UNREACHABLE` · `PREVIEW`                                                      |
| Setup        | `READY` · `DEGRADED`, `SETUP REQUIRED`                                                                   |
| Teleprompter | `ON SCREEN`, `READY` · `NOT UPDATED`, `DUPLICATED`, `LOW RESOLUTION`, `NOT SHOWING` · `NOT CONNECTED`    |
| Cameras      | `HELD` · `RELEASED`, `NOT SET UP` · `UNREACHABLE`                                                        |

## 9. Copy

- Sentence case for commands (verb and object). The deck's words on key caps (mono, uppercase). The engine's words for states.
- Name the hardware: TotalMix, the UFX III, the bridge, the deck, Companion, the rig, the Prompter XL, CAM 1.
- Never "engine", "backend", "transport" or "IPC" on screen. The screen calls the engine "the hardware link". "Snapshot" is only the Console's own word for a saved mix.
- Numbers carry sign and unit: `-3.8 dB`, `32 dB`, `3200 K`, `76 %`, `18:24`.
- No surface shows a key, a key glyph or a key hint, and every action has a control on screen. The keyboard does only what it does in any program: Tab, Enter or Space on the focused control, typing, the arrows on a focused slider or list, and Esc on a dialog, a popup or an armed key.

## 10. Measures

Per page, at 2560×1440, the page tests hold:

- no page scroll;
- type floor 12 px, at most 8 sizes, and only Inter and JetBrains Mono;
- pixel-sampled contrast of at least 4.5:1 for text (3:1 for large text); locked controls at 55 % are exempt, and so is text a scrolled field hides;
- every enabled target at least 24 px, and take-time targets at least 28 px;
- radii only 4, 8, 12 and pill;
- no shadow with a negative offset, and blur over 8 px only on lit elements or the drawer;
- gradients only on plates, keys, caps, meters and the colour-temperature track;
- no running animation at idle;
- chrome sizes within 2 px of section 2, and the state display at the same place on every page;
- no forbidden word on screen (section 9).
