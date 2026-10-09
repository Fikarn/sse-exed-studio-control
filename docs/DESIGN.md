# The visual system

Every page is built to these rules, and the page tests measure them (section 10). Read this before changing anything the operator sees.

The system is the SSE brand (Brand Guidelines Vol.01, 2026) read for a dark control surface: Swedish Grace's clarity, symmetry and restraint, the brand's palette and its three faces. The direction is called Atrium: one quiet surface drawn like a building, exact hairlines, generous margins, and colour only where something is on, live, in doubt or in danger.

## 1. What the system is for

From the operator's chair, in one glance and without reading a sentence: is it safe to act, what is live right now, what is unconfirmed, and where am I. Controls used during a take never move. Nothing scrolls. The pages read as one instrument, and the instrument reads as a sibling of the desk and the deck. At 3 m a page reads as three or four masses: the state, the picture, the selection.

## 2. The skeleton

Every page is one grid: **header · cluster · bay · plate · footer**, 88 · 440 | 1680 | 440 · 40 (the header 80 until 2026-10-08, when the walk asked for more room). There is no page top bar; the cluster's first element is the state. The one surface is 2560×1440, fullscreen.

| Region        | What it is                                                                                                                                                     | Size (px) |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------: |
| Header        | the raised bar (D48): the logotype, the pages' platter, the system's platter (the lamps without a page, latches, Setup / Support), the REC tally, the clock    |   88 high |
| Cluster       | left column: the **state display**, the **latch slot**, the take-time keys, the lists                                                                          |  440 wide |
| State display | a black display, fixed height: lamp and word, the page's ⋯ at its top right, the hardware link's sentence (two lines), the way-out key; nothing below it moves |  180 high |
| Latch slot    | under the state display on every page: a latched state (solo, a clip, a highlight) and the key that clears it; at rest "Nothing latched"                       |   56 high |
| Bay           | the page's picture: strips, the plot, the glass, the step screen; the shell draws no margin in it, the page keeps its own                                      | 1680 wide |
| Plate         | right column, the shell's own on every page: the selection (strip, fixture, script, camera) or Support, headed by its title plate                              |  440 wide |
| Footer        | the raised bar: telemetry as `Label value` items, one action key, and the product's name as the colophon                                                       |   40 high |

The header is the skylight (D48, 2026-10-09): one raised bar, a step lighter than the page (`--material-bar`) and closed by a line (`--material-bar-line`), with no gradient. It reads left to right: the SSE logotype alone at the frame's 32 px margin, 40 px high with half its height clear on every side, then a rule; the pages on one platter (radius 12, `--material-platter`, the light edge, 4 px in from its edge, a hairline between two segments that are not the open one), Overview · Lighting · Audio · Cameras · Teleprompter, the names bold in the second ink, each page's tab carrying its page's lamp and state word (16 px), the Overview's none (it shows every page) and the open page's none, because its state display says it, though it keeps the word's room (drawn unseen after its name), so no tab moves when the page changes; the open page is the one Dark Green segment (radius 8), its name in Beige Light, and the only tint in the header; the room left over; the system's own things on a second platter: the deck's lamp, `Surface`, a `Backup` chip only while the automatic backup failed or is overdue, the latches (`SOLO`, `SCENE DRIFT`), each left off the page that shows it itself and all of them off the Overview, which shows every page's (on Lighting, which has a Solo of its own, the Console's reads `AUDIO SOLO`), and `Setup / Support` last, so it stays put while a latch comes, goes or changes its word; the `REC` tally on a platter of its own that never moves, quiet at rest, a coral edge on a faint coral tint while CAM 1 records, a dashed yellow edge while what it says is last known; and the clock at the right margin. The product's name stands nowhere in the header: beside the logotype it would read as a lockup, which the brand does not allow. It ends the footer instead, as its colophon: SSE Adelia at 14 px, tracked `0.14em`, in the quiet ink. The screens before ready use the same frame: their state display in the cluster, what they show in the bay, the hardware's diagnostics on the plate, and no footer; no tab is the current one, and a lamp never read is hollow and says `pending`, or `not read` after a start that failed. Density never comes from the type; the sizes stay.

Every take-time key has one fixed home. A latch goes into the latch slot, never above or between keys, so nothing a hand reaches for during a take is ever pushed.

**The Overview** (D47, board 3: `docs/design/boards/overview-3.html`) is the landing page and keeps the frame. Its state display stands where every page's does, in a status card with the latch slot under it (16, 104, 408 × 252), and four rooms stand in the shell's columns, each 16 px inside its column and 16 px from the next: THE TAKE under the status card in the cluster, THE PICTURE over THE SCRIPT in the bay, THE SOUND the whole plate. The shell parts its columns with hairlines; on the Overview the rooms part them, so it draws none there. Outside the rooms there is only the studio list, under THE TAKE.

## 3. Type

Three faces, the brand's own:

- **PT Sans** (Regular and Bold) for everything read to act: labels, values, keys, rows, tables. Its figures are tabular at both weights, so values never jitter; no monospace face is needed.
- **SSE Adelia** (Bold, capitals only) for display words: state words, section heads, the product's name, big key caps. Adelia draws lowercase as capitals ("dB" would become "DB") and its figures are proportional, so it **never** carries a value, a unit, a number that changes, or a name that keeps its case (a strip's, a fixture's, a scene's, a script's). It is SSE's licensed face: the repository never holds its file; the pages use the copy installed on the studio PC and fall back to PT Serif elsewhere.
- **PT Serif** italic for the hardware link's own voice: the sentence in the state display, and a room's job on the Overview (`act`, `watch`, `read`, `listen`).

PT Sans and PT Serif are ParaType's, under the SIL Open Font License, committed with their licence (`frontend/packages/tokens/src/fonts/`). The prompter's glass is the presenter's picture, not the page: it keeps Inter (`--font-family-glass`).

Seven sizes. A page uses at most eight; the seven leave one spare.

| Step    | Size | Where                                                                                                                     |
| ------- | ---: | ------------------------------------------------------------------------------------------------------------------------- |
| tick    |   13 | scale numerals, graph axes, labels on the plot: never read to act                                                         |
| label   |   14 | secondary facts, units, table cells, the footer, a tooltip, a lamp's word                                                 |
| body    |   16 | keys, labels, list rows, menu items, tabs, plate facts                                                                    |
| head    |   18 | a section head (Adelia)                                                                                                   |
| word    |   20 | names, plate values, the clock, big key caps and region titles (Adelia), the hardware link's sentence: read during a take |
| readout |   28 | a strip's readout, the plate's title, a long state word                                                                   |
| display |   40 | the state word (Adelia), the one number read from a metre away                                                            |

Why 12 is still the floor: on this monitor (108.8 px per inch) at 70 cm a 12 px capital is at the lower edge of reliable recognition for a short familiar label, and 20 px is the minimum for reading, which is why every word read during a take is 20 px or larger. The smallest step is 13.

Two weights, 400 and 700. Units are half the size of their number, in the quiet ink, after a small gap. Minus signs are real (−). Adelia is tracked `0.03em` at 20 px and below and set tight above; PT Sans in capitals `0.04em`; the footer's colophon `0.14em` (D48) and a room's name on the Overview `0.08em`, cut like an inscription (D47); nothing else is tracked. Names never wrap: one line, with an ellipsis and the whole name in its tooltip if ever needed. Never justified text, never a text shadow.

A picture is the exception: the prompter's glass and a camera's picture are marked `data-picture`, and what is inside them is the presenter's or the camera's, not the page's. The measures skip it.

## 4. Colour roles

The surface is the brand's Dark Green pulled almost to black: a trace of hue, not a green screen. The inks are Beige Light, never white. Every colour is defined once, in the palette (`--sse-*`), and every other colour token names it.

| Name        | Hex     | Role                                                                                                                                                               |
| ----------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SSE Green   | #99BA92 | **live and ok**: a lit fill (black text) for something running or on; the lamp and word `READY`, `VERIFIED`, `ON`                                                  |
| Yellow      | #F2DE6F | **engaged and attention**: a lit fill (black text) for the mix target, solo, dim; the lamp and word `NOT VERIFIED`, `ASSUMED`, `UNSAVED`; a latch's keyline; doubt |
| Coral       | #FF7D55 | **error and hazard**: `OFFLINE`, `UNREACHABLE`, 48 V on, `REC`, a clip; the word and edge of a destructive command                                                 |
| Burgundy    | #671919 | **armed**: the one armed form, a Burgundy fill with Beige text, "press again" and a countdown bar                                                                  |
| Blue        | #3A87E5 | **information**: `PREVIEW`, a cue in a script                                                                                                                      |
| Beige       | #EDEBD1 | **selection**: one 2 px keyline on the strip, fixture, script, camera or step, and on a setting's current choice (a frame rate, the view); the tooltip             |
| Beige Light | #F6F5E8 | the main ink; the primary command key's fill (black text)                                                                                                          |
| Dark Green  | #004932 | the plate's title plate, the one brand moment on a working page; the open page's segment in the header (D48); the deck's page keys                                 |

Hue names the family, form names the meaning, and colour never stands alone: a lit fill means on, a lamp and its word mean look here, a keyline encloses a value or a word. A lamp always has its word beside it.

Hazards are a coral lamp and a word on a dark key, never a coral fill: 48 V on, and `REC` while the main camera records. Doubt is a dashed yellow keyline on the value itself: a value the hardware link has not confirmed, or a last known value from a device that stopped answering. A locked control is a dashed edge at 55 %, and says why on hover; a locked key keeps its state: engaged, its word and dashed edge in yellow; live, in green.

Text pairs that hold 4.5:1 (tested from the token values): the inks on every surface and well; black on Green, Yellow, Coral and Beige Light; Beige on Burgundy; Beige Light and the second ink on Dark Green; the main and the second ink on a platter and on a room's key face. Never coral or the quiet ink on Dark Green, and never the quiet ink on a platter, a room's key face or a list (it is under 4.5:1 there): it stands on a wall, a lintel, a floor or a well.

The meter ramp and the colour-temperature track are signal, not status: green to −18 dBFS, yellow to −3, coral above; warm to cool.

The operator's colour tags on scenes, groups and palettes are identity, not status: eight quiet tints, `--tag-0` to `--tag-7` (Clay, Ochre, Sand, Olive, Slate, Mist, Plum, Heather), clear of every role colour; Ochre and Mist are the palette's reserve Brown and Sky. A saved tag keeps its slot, and a colour-temperature palette carries none: its temperature colours it.

The Overview's rooms (D47) are identity too: each takes the dark member of a brand pair, pulled down to the page's depth: stone (Beige) for THE TAKE, green (Dark Green) for THE PICTURE, slate (Sky and Blue) for THE SCRIPT and umber (Brown and Yellow) for THE SOUND (`--room-<tone>-wall`, `-lintel`, `-floor`, `-tray`, `-key`, `-line`, `-line2`). They are dark enough that a lamp, a lit key or a meter always stands out; inside a room the keys, the lists and the hairlines take the room's tones. A room in trouble takes the state display's keyline, coral or yellow, round the whole room.

There is one theme, Studio.

## 5. Material

Flat and matte, three planes, the raised layer of the header and the footer, the Overview's rooms, and one floating layer:

| Plane          | Token              | Lives there                                                                                                                                                                                                                                                              |
| -------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Surface        | `--material-bg`    | header, cluster, bay, plate, footer: the one surface                                                                                                                                                                                                                     |
| Key face       | `--material-key`   | every pressable thing, one step up, with a 1 px `--material-line2` edge                                                                                                                                                                                                  |
| Well           | `--material-well`  | the state display, readouts, sliders' and meters' wells, fields, the plot: one step down, 1 px `--material-line` edge                                                                                                                                                    |
| Raised layer   | `--material-bar`   | the header and the footer (D48): a step up from the surface, closed by a 1 px `--material-bar-line`; on it the platters (`--material-platter`, radius 12) carry the tabs, the chips and the REC tally, with a 1 px light edge along their top (`--elevation-edge-light`) |
| Room           | `--room-<tone>-*`  | the Overview's four rooms (D47): a raised panel at 12 in its tone with the light edge, its name band a step darker, its floor a step darker again; a tray for keys that belong together, a step darker with a soft inner edge (`--elevation-recess`)                     |
| Floating layer | `--material-raise` | menus, popovers, dialogs, drawers, toasts: a 1 px `--material-line2` edge, a 1 px black outline and one soft shadow                                                                                                                                                      |

A box appears only around something you press and around a black well. Sections are drawn by type and a rule, lists are rows divided by hairlines, never cards outside the Overview's rooms. Lines are exactly 1 px, except selection (2 px) and the heavy rule under a section head (2 px), the head's row standing 4 px above it with or without keys. One radius, 4 px, everywhere (a lamp is a circle), but on the raised layer and on the Overview: a platter, a room, the status card, a tray and a list are 12 px, what sits in them 8 px (a key, a well, a picture), and what sits in that 4 px, so the shapes nest.

On the Overview (D47) board 3's forms are the page's: the room; the tray; the one grouped list for the take's facts, the studio and the cues (a rounded face in the key's tone, rows on hairlines that start after the row's margin, the value bold at the right); and the status card, the state display and the latch slot as one card, its latch row tinted yellow while something is latched, an error drawn as the coral keyline round the whole card. The pictures, the glass, the speed tape and the meters stand in black: the content is the hero.

No gradient except signal (the meter ramp, the colour-temperature track), no glow, no inner highlight but the one-pixel light edge of a platter and of the Overview's raised parts, no shadow except on the floating layer and a tray's soft inner edge. The tooltip is the one light surface (Beige with black text), so it reads as a note. Fader and slider caps are matte and light, so a position reads from 3 m.

## 6. Motion

| Purpose                                       | Duration     | Easing                           |
| --------------------------------------------- | ------------ | -------------------------------- |
| A lamp or a lit fill switches                 | 0 ms         | none: a light does not ramp      |
| A key press                                   | 100 ms       | `cubic-bezier(0.2, 0.8, 0.2, 1)` |
| A state word or keyline changes               | 160 ms       | out                              |
| A floating layer enters · leaves              | 200 · 120 ms | out · in (8 px rise and fade)    |
| Bank or tab change                            | 160 ms       | in-out                           |
| The Overview's speed tape, one tick a detent  | 160 ms       | `cubic-bezier(0.2, 0.8, 0.2, 1)` |
| Meters, countdown bars, the prompter's scroll | frame rate   | the hardware link's              |
| The cameras' pictures                         | frame rate   | the source's                     |

Nothing on an idle surface animates. Hover changes an edge or a colour, never a position or a size. `prefers-reduced-motion` removes enter, exit and move and the meters' display smoothing.

## 7. The components

Pages compose these and never re-implement them; `frontend/packages/design-system` owns them. Test ids are extended, never renamed. The Storybook boards "Design System/A primitives" show every one of them and are measured like a page (the header's `Tab`, `Lamp`, `Tally` and `Crest` on the board "Shell"); the board "Menus and overlays, open" holds the floating layers open.

- **Shell**: the header, the skylight (the logotype, the pages' platter of `Tab`s with their pages' lamps, the system's platter with a `LampChip` for the deck and for each latch and the Setup / Support `Tab`, the `Tally` for `REC` on its own platter, the clock) and the `Footer`, which ends with the product's name inside the shell; one plate slot that every page fills (`ShellRegion`).
- **Cluster**: `StateDisplay` (tone, word, sentence, code, meta, action keys, the page's ⋯ as `menu` at its top right; 180 px high; the armed row; an error draws a 2 px coral keyline round it), `LatchSlot` holding `Latch`es, on every page, `Section`, the take-time keys.
- **Keys** (one primitive, modes as props): `command`, `primary` (Beige Light fill), `danger` (coral word and edge), `toggle` and `momentary` (lit when engaged or live), `arm` (armed: the Burgundy form, "press again", a countdown bar, the key keeps its place), `hazard` (a coral lamp and word), `locked` (dashed, 55 %, `aria-disabled`, the reason on hover; it keeps its state, an engaged one in yellow, a live one in green), `selected` (the Beige keyline), `segmented`; heights 28, 36, 48 and 64 (take-time); `cap` (an Adelia word) and `label` (a PT Sans sentence-case label).
- **Lamps**: `Lamp`, `LampChip` (header), `LampWord` (rows and tags), `StatusBadge` (a keyline word).
- **Wells**: `Readout` (doubt: the dashed yellow keyline), `Slider` (with the colour-temperature track, and a ▲ under the track for a value kept elsewhere, a scene's saved level, yellow while the value has left it), `Groove` (the vertical fader), `Meter` (with a 2 px peak tick), `Field`, `Screen`.
- **Plate**: `PlateHead` (the Dark Green title plate: the selection's name in PT Sans Bold, keeping its case), `Section` (an Adelia head over the heavy rule, a quiet sub-word, its actions at the right), `Fields`, `Readouts`, `ControlRow`, and a `Danger` slot at the bottom. Every section is visible at once, so there is no tab row.
- **Empty**: `EmptyLine`, an empty list or section: one quiet line in PT Sans body, the explanation as its tooltip, an optional hollow lamp (as the latch slot's "Nothing latched") and at most one key. Pages draw no empty state of their own.
- **Floating layer**: `Dialog`, `ConfirmDialog`, `Drawer`, `Toast`, `Menu` (opened by `MenuButton`, the ⋯, or at the pointer by `ContextMenu`), `Popover`, `ColorPicker`, `Tooltip` (section 9).
- **The Overview** (D47, on the board "Overview"): `Room` (tone, name, job, what it holds now, a `Door` to its page, a floor where it needs one, the alert keyline), `Door`, `Tray`, `GroupedList` with `GroupedListRow`, `StatusCard` (the `StateDisplay` and the `LatchSlot` as one card), and `SpeedTape`, a display of the prompter's pace that slides one tick a detent of the deck's SPEED dial and says when the deck turned it. Inside a room the keys and wells take the room's tones with no edit of their own.
- **Setup**: its step keys (an `ArmKey` with the step's number, name and word; on a published setup it reads `press twice` and arms in its own height) and its probe rows (the name, a `LampWord`, the answer under it) are the page's own, built from these, and so are the deck's map and the Support sections.

## 8. State words

Every state word is the hardware link's, in capitals with its lamp. Its sentence is printed as the link gives it. A raw code prints small under the sentence and is never the first thing read. Every state sentence says what happened and what to do, and the way out is a key in the same display.

The sentence keeps two lines, so every state sentence is written to fit them, about 70 characters, whether the hardware link or the page writes it; the way-out key beside it names the action, so the sentence need not. The meta fits beside the way-out key, about 30 characters. Should a name ever make either longer (a snapshot load's failure names its slot first), the display says the whole of it on hover. The page tests hold that none is cut on any fixture.

| Page         | Words                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Console      | `VERIFIED` · `NOT VERIFIED`, `ASSUMED`, `STALE`, `DISABLED` · `OFFLINE`, `DISCONNECTED`, `ACTION FAILED`; a snapshot: `ACTIVE`, `CHANGED`   |
| Lighting     | `REACHABLE` · `HELD`, `NOT ANSWERING`, `UNSAVED` · `UNREACHABLE` · `PREVIEW`; a scene: `ON RIG`, `UNSAVED`, `PREVIEW` (the deck's `RECALL`) |
| Setup        | `READY` · `DEGRADED`, `SETUP REQUIRED`                                                                                                      |
| Teleprompter | `ON SCREEN`, `READY` · `NOT UPDATED`, `DUPLICATED`, `LOW RESOLUTION`, `NOT SHOWING` · `NOT CONNECTED`                                       |
| Cameras      | `HELD` · `RELEASED`, `NOT SET UP`, `PICTURE MISSING`, `NO PICTURES` · `UNREACHABLE`                                                         |
| Before ready | `STARTING UP…`, `OPENING…` · `STARTUP FAILED`, `PROTOCOL MISMATCH`, `SAVED DATA DAMAGED`, `LINK STOPPED`, `ALREADY OPEN`, `<AREA> STOPPED`  |
| Overview     | `READY` (every link answers) · the worst page's own word, its sentence with the page named first (`Console: …`, `Cameras: …`)               |

The Overview adds no state of its own (D47): its display mirrors the worst of the header's lamps, an error before attention and a tie in the take's order (CAM 1's take, the prompter, the Console, the rig, the deck, the backup), with that page's way out: `Sync from TotalMix` sent from there when that is the Console's own, otherwise `Open <page>`. The room of the page it names takes its keyline.

## 9. Copy and controls

- Sentence case for commands (verb and object). The deck's words on big key caps, in Adelia capitals. The hardware link's words for states.
- Name the hardware: TotalMix, the UFX III, the bridge, the deck, Companion, the rig, the Prompter XL, CAM 1.
- Never "engine", "backend", "transport" or "IPC" on screen. The screen calls the engine "the hardware link". "Snapshot" is only the Console's own word for a saved mix.
- Numbers carry sign and unit: `−3.8 dB`, `32 dB`, `3200 K`, `76 %`, `18:24`.
- **Every action is reachable from a visible control: a key, or the ⋯ menu on its object.** Right-click on an object opens the same menu as its ⋯; nothing is right-click only. Controls used during a take stay keys, never menu items. A menu's head names its object; its items show their current value in words at the right; a disabled item says why; a destructive item sits last, in coral, and arms in place.
- **Hints are tooltips**, except where a press cannot be undone or arms something: "press again", a countdown, 48 V, `LOAD?` and a lock's reason stay on screen. No tooltip covers a take-time control.
- The Overview's speed tape is a display: it takes no wheel, no key and no press; the deck's dial and the − 5 and + 5 keys set the pace. The Overview's ⋯ holds the standing commands of the pages it shows: `Sync from TotalMix`, `Read all cameras again`, `Clear clips` and `Setup / Support`.
- No surface shows a key, a key glyph or a key hint. The keyboard does only what it does in any program: Tab, Enter or Space on the focused control, typing, the arrows on a focused slider or list, and Esc on a dialog, a menu or an armed key.

### Menus, popovers and tooltips

- **The menu** (`Menu`). A head row naming its object in PT Sans Bold (a name keeps its case), with a quiet sub-line. Rows 36 px high in PT Sans 16. An item's current value stands at the right in the quiet ink; a toggle says its value in words (`on`, `off`). Choices stand in a group under a quiet label, the chosen one marked. Dividers are one hairline. A disabled item is in the quiet ink with its reason at the right, and the arrows pass over it. The destructive item is last, after a divider, in coral, and ends in "…": its first press turns it into the armed form in place (Burgundy, "Press again to …", the countdown bar) while the menu stays open, the second press does it, and moving to another item, the window running out or Esc disarms it. A restore is never the destructive item: it replaces the saved data and asks in its own dialog, which says what it replaces, and a menu's `Restore…` opens that dialog. No icons, no submenus, no key hints.
- **The ⋯** (`MenuButton`). A square key at its object's right; the menu hangs under it, towards the object, and the focus comes back to the ⋯ when it closes. A right-click on the object opens the same menu at the pointer. A menu opened from the keyboard puts the focus on its first item.
- **Where a layer goes.** Beside what opened it: it flips to the other side when its side has no room, and slides along its side to stay 8 px inside the screen. At the pointer a menu opens down and to the right, and to the left at the screen's right edge.
- **The popover** (`Popover`). Values edited beside their key, the key staying visible. A title in PT Sans Bold over a hairline. It is never a dialog: nothing behind it is blocked, a press outside or Esc closes it, and the focus goes back to its key. A list of values in it is a `listbox`.
- **The tooltip** (`Tooltip`). Beige with black text, PT Sans 14. It opens when the pointer rests for half a second (at once when it comes from another tooltip, and at once on keyboard focus), stays while the pointer moves onto it, and closes on Esc, a press or when the pointer leaves. It never covers a control used during a take (`take`, marked `data-take`): it takes another side, and when every side would cover one it does not open. Its sentence is always its control's description, so nothing is lost when it does not open.
- **Esc, in order.** The shell's own dialog takes it first. Then the layer that holds the focus: a menu with an armed item disarms it and stays open, and the next Esc closes the menu; a popover, a dialog or a drawer closes. A layer that takes an Esc keeps it, and an armed key on the page is disarmed only by an Esc no layer took: one Esc, one layer. A tooltip that shows closes on every Esc and lets it go on.
- **Layers.** Every floating layer is drawn in a portal on the body, above the meters' canvas: toasts, then dialogs, then menus and popovers (`--z-palette`, above a dialog's scrim, so a ⋯ in a drawer works), then the tooltip.
- **Over the cameras' pictures.** The pictures are drawn by a native layer over the page, which leaves a hole where a floating layer stands: a `menu`, a `listbox`, a `tooltip` that shows, or anything marked `data-level="float"` (`floatingLayers`), each counted once, at most eight. A hole is square: a rounded corner or the shadow over a picture is covered by the picture. A `dialog` anywhere hides every picture, and so do more than eight floating layers over them, so a picture never covers what the operator should see. The menu, the popover and the tooltip are never dialogs.

## 10. Measures

Per page, at 2560×1440, the page tests hold:

- no page scroll;
- type floor 12 px, at most 8 sizes, only PT Sans, PT Serif and SSE Adelia, only weights 400 and 700, and every face asked for loaded (SSE Adelia judged where it is installed);
- pixel-sampled contrast of at least 4.5:1 for text (3:1 for large text); locked controls at 55 % are exempt, and so is text a scrolled field hides;
- every enabled target at least 24 px, and take-time targets at least 28 px;
- radii only 0, 4, 8, 12 and pill;
- no shadow with a negative offset, and blur over 8 px only on a lit element or the floating layer;
- gradients only on signal and material;
- no running animation at idle;
- chrome sizes within 2 px of section 2, and the state display at the same place on every page;
- no forbidden word on screen (section 9).

From the token values, unit tests hold the contrast pairs of section 4, that no colour is defined twice, that every custom property a stylesheet reads is declared, and that the deprecated tokens only lose readers (`frontend/packages/tokens/src/contrast.test.ts` and `frontend/packages/design-system/src/__tests__/css-tokens.test.ts`).
