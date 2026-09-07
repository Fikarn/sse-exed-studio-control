# Audio Console — Concept A in every engine state, and the material pass (2026-09-06)

Status: the operator chose **A, Cockpit** (`console-concepts-2026-09.md`) and asked for its blocked states and for the board to feel more premium and less flat. Both are in one mock now: `docs/redesign/assets/concepts/A-cockpit.html` renders every state the engine can report via `?state=` (`ready`, `not-verified`, `assumed`, `stale`, `offline`, `disconnected`, `disabled`, `action-failed`, `talkback-refused`, `armed`) in three themes, and its material was reworked. The flat version the choice was made on is kept as `A-cockpit-v1-flat.html` for comparison. No source, token or test was edited; nothing is committed.

Renders and numbers (outside git): `../gold-standard-evidence-2026-09/concepts/` — `A-cockpit__2560x1440__<theme>.png` (ready), `A-cockpit--<state>__2560x1440__<theme>.png`, `A-state-displays-1to1.png` (the ten state displays cut at 1:1), `crop4-*.png`, `census.md`, `contrast.md`. The probe now renders every state a mock declares in `<html data-states="…">`.

## 1. The material pass: what "premium" means here, and what it costs

The flat version made every surface the same black and separated things with hairlines only. The reworked material keeps every rule that was measured (a 12 px floor, four radii, colour only as state, zero idle motion, contrast on rendered pixels) and adds depth and light where they carry meaning:

- **One light, from above.** Plates (the cluster and the inspector) are brushed panels with a top sheen; the mixer is a recessed bay one step darker; every display (the state display, the dB readouts, the fader grooves, the meters, the EQ) is a black backlit well with an inset shade, in all three themes. Every shadow has its dark side below (0 negative offsets, measured).
- **Machined keys.** A key has a 5 % vertical gradient, a 1 px sheen and a 2 px shade; an engaged key is a lit amber slab with a 14 px bloom; a live key would bloom green; the primary command key is white.
- **Emissive signal.** Each meter's ramp is doubled by a blurred copy underneath, so the bar lights the well floor around it; the peak line blooms; lit lamps bloom. Blooms exist only on lit states (10 elements on the idle board, all lamps or engaged keys).
- **The state display.** The console's badge is a black display at the top of the cluster with a faint radial tint in the state's colour — green when verified, amber when attention, red when blocked — and the lamp, the word, the engine's sentence and the way out printed on it. Its height is fixed at 180 px, so no state can move the talkback key below it.

What it costs, measured on the idle Studio board, before → after: box-shadows 0 → 141 (every key, well, cap and lamp; none with a negative offset), gradients 24 → 121 (24 meter ramps, 24 meter glows, the rest keys, caps and plates at ≤ 6 % luminance difference), blooms over 8 px blur 0 → 10, distinct colours unchanged. Text nodes, sizes, floor, uppercase share, targets and contrast are identical to the flat version. The trade is deliberate: depth spent on the level model (bay / plate / well / key / lit) rather than on ornament, and the census now polices direction and blur instead of forbidding shadows outright.

What the still image cannot show is what makes a console exciting in the room: meters that move, a talkback key that lights green for exactly the hold, an amber key that blooms the instant a solo engages. The motion policy (no idle animation, lamps and fills switch in under 60 ms, no hover motion) is part of the system pass.

## 2. The state model, in A's terms

Every state the engine can report has one form, in one place, and the same form on every board:

| Element                 | Ready                                                                                                                                            | Attention (not verified, assumed, stale, disabled)                                                                        | Error (offline, disconnected, failed, talkback refused)                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| State display (cluster) | green lamp + `VERIFIED` + console line + count                                                                                                   | amber lamp + word + the engine's sentence + the way-out key                                                               | red lamp + word + the engine's sentence (+ the code, small) + the way-out key |
| Shell lamp (header)     | `Audio ok`                                                                                                                                       | `Audio · not verified` / `assumed` / `stale` / `read-only`                                                                | `Audio · offline` / `disconnected` / `failed` / `talkback refused`            |
| Footer                  | `Console confirmed · 42 values`                                                                                                                  | `Console not verified` / `assumed · 3 unconfirmed` / …                                                                    | `Console offline` / `disconnected` · `Metering none`                          |
| Locked controls         | —                                                                                                                                                | not verified, disabled: every console write is a dashed outline at 55 %, caps are ghosts, the tier headers say why        | offline, disconnected: the same, in red                                       |
| Doubt on a value        | —                                                                                                                                                | assumed: dashed amber keyline on the dB well and the cap, `unconfirmed` in the strip's sub line, the count in the display | —                                                                             |
| Meters                  | live                                                                                                                                             | stale: the last frame at 40 %, no glow                                                                                    | offline, disconnected: empty wells, readouts print `—`                        |
| Armed                   | the armed key: amber keyline, `ARMED · press again · 3.9 s`, a countdown bar on the key; an `ARMED` row in the state display; nothing else moves |                                                                                                                           |                                                                               |

Rules the boards follow: the sentence is the engine's, verbatim (`audioFormatting.ts`, the fixtures); a raw code is printed small under it and is never the first thing read; the way out is a key inside the display, and the same command stays in the cluster's standing action row; controls that the engine refuses change _form_ (outline) as well as opacity, so a locked console cannot be mistaken for a live one at a glance; the shell lamp mirrors the worst state the workspace shows, so `ACTION FAILED` is red in the header too.

## 3. The ten boards

1. **ready** — `VERIFIED`, 42 values confirmed, last sync 18:24, RME live metering. Everything live.
2. **not-verified** — amber `NOT VERIFIED`: "Console controls stay locked until the audio probe passes." Way out: **Run audio probe**. Every write locked (faders, M, S, 48 V, gain, talkback, dim, mono, mix target, main level, recall, sends); names, snapshot slots, Capture and Sync stay live. Meters live.
3. **assumed** — amber `ASSUMED`: "Showing the last state the console confirmed. Press Sync to pull the current state from TotalMix before trusting faders or recall." 3 unconfirmed · 39 confirmed. Way out: **Sync from TotalMix**. Host, Guest 2 and FX 3/4 carry the doubt mark on their dB well, cap and sub line; the inspector's Main Out send too. Nothing locked.
4. **stale** — amber `STALE`: "No meter data has arrived from TotalMix for a few seconds." Meters show the last frame, dimmed. Key: **Run audio probe**.
5. **offline** — red `OFFLINE`: "Audio may still pass, but the app cannot see or change the console right now." Code line: `Console did not answer OSC ping · AUDIO_SYNC_FAILED`. Everything locked, meters empty, `Metering none`. Way out: **Run audio probe**.
6. **disconnected** — red `DISCONNECTED`: "TotalMix reports the UFX III is disconnected. Check the interface's USB link and power." Locked, meters empty.
7. **disabled** — amber `DISABLED`: "OSC control is switched off in Setup. The Console is read-only until it is switched back on." Locked (`read-only · OSC control is off in Setup`), meters live. Key: **Open Setup**.
8. **action-failed** — red `ACTION FAILED`: "Snapshot slot 3 did not match the current console layout." Code line: `Recall of Interview block · AUDIO_SNAPSHOT_RECALL_FAILED`. Keys: **Sync from TotalMix**, **Dismiss**. Nothing locked; the header lamp is red.
9. **talkback-refused** — red `TALKBACK REFUSED`: "TotalMix has no talkback channel assigned. Assign one in TotalMix, then hold T again." The talkback key carries a red keyline and says `refused · no talkback channel in TotalMix`.
10. **armed** — `VERIFIED` plus an `ARMED` row: "Recall Interview block · press again to apply · Esc cancels · 3.9 s" with the countdown bar; snapshot key 3 is down, amber-keylined, with the same words and its own countdown bar. The deck would mirror it.

## 4. Measured

All boards 2560×1440, 1:1, pixel-sampled contrast (locked controls at 55 % are exempt, as WCAG exempts disabled controls, which is why the locked boards measure ~311 nodes instead of ~378). Ready, not-verified, assumed, offline and armed were rendered in all three themes; the others in Studio.

| Board                    | Text nodes | Sizes / floor | Contrast fails (S / G / B) | Targets < 24 · take-time < 28 | Shadows · negative offsets · blooms > 8 px | Gradients | Idle motion |
| ------------------------ | ---------: | ------------- | -------------------------- | ----------------------------- | ------------------------------------------ | --------: | ----------: |
| ready, flat (the choice) |        376 | 8 / 12 px     | 0 / 0 / 0                  | 0 · 0                         | 0 · 0 · 0                                  |        24 |           0 |
| **ready, material v2**   |        376 | 8 / 12 px     | 0 / 0 / 0                  | 0 · 0                         | 141 · 0 · 10                               |       121 |           0 |
| not-verified             |  380 (311) | 8 / 12 px     | 0 / 0 / 0                  | 0 · 0                         | 83 · 0 · 8                                 |        63 |           0 |
| assumed                  |        377 | 8 / 12 px     | 0 / 0 / 0                  | 0 · 0                         | 142 · 0 · 10                               |       122 |           0 |
| stale                    |        377 | 8 / 12 px     | 0                          | 0 · 0                         | 142 · 0 · 10                               |        98 |           0 |
| offline                  |  380 (311) | 8 / 12 px     | 0 / 0 / 0                  | 0 · 0                         | 59 · 0 · 8                                 |        15 |           0 |
| disconnected             |  380 (311) | 8 / 12 px     | 0                          | 0 · 0                         | 59 · 0 · 8                                 |        15 |           0 |
| disabled                 |  380 (311) | 8 / 12 px     | 0                          | 0 · 0                         | 83 · 0 · 8                                 |        63 |           0 |
| action-failed            |        378 | 8 / 12 px     | 0                          | 0 · 0                         | 143 · 0 · 10                               |       123 |           0 |
| talkback-refused         |        375 | 8 / 12 px     | 0                          | 0 · 0                         | 141 · 0 · 10                               |       121 |           0 |
| armed                    |        378 | 8 / 12 px     | 0 / 0 / 0                  | 0 · 0                         | 143 · 0 · 10                               |       120 |           0 |

The first pass of the light theme failed on exactly one thing, worth recording as a rule: a black display keeps the dark theme's inks in every theme. The state display, the dB wells and the armed key had been printing the light theme's dark amber and dark green on black (2.9–3.2:1); scoping the display inks to `.well` fixed all of them at once.

## 5. Decisions to take with this

- **Per-value doubt marks need the engine.** The `assumed` board marks three values because that is the target design; today the engine reports only the global confidence and a count (brief §4), so until the planned per-channel field lands (plan boundary F2) every value would carry the mark, or none. The design should ship with the field.
- **Locked = outline, not just opacity.** The review found 70 % opacity read as live; here a locked key also loses its fill, gains a dashed border, and the tier header says why. Keep both halves.
- **The OFFLINE sentence.** The engine's fallback sentence is fine; its code line still says "OSC ping". That is the copy work the review's H12 already lists, on the engine side.
- **The deck.** Unchanged from the concepts document: amber means engaged on screen; the deck's amber "selected strip" accent should become neutral, engine-side.

## 6. Next

Lighting, Planning and Setup on the same cluster rule (the left column carries the workspace's state display and its take-time controls), then `1920×1080` (4 / 4 / 3 banked strips beside a narrower cluster) and `1280×800` (the cluster as a key rail, the inspector as a drawer), then the three themes as a token set, the system sheet (type, colour roles, elevation, motion, components, copy) and a revised sliced plan. Still no source edits until the plan is approved.
