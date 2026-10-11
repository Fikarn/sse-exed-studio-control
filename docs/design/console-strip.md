# The Console's strip: board 1, the meter first

Written 2026-10-11. This note goes with `docs/design/boards/console-strip.html`. The owner took every recommendation of section 6 on 2026-10-11 (D50), and the strip is built (#339).

The owner asked, after the Overview's release:

- "For me the operator, the level meter is the focus point, and the gain slider is secondary. Right now, the gain slider and especially the fader knob is taking up most of the space."
- "I would also like to add the actual preamp gain knob to the channel strips themselves."
- The third pass: "the numbers above the meter are too large and draw too much attention. Also, I think we can use other colors for the meters themselves. Right now it is visually confusing that they are shared across the program. Please look at other software metering, and draw inspiration from that."

**To see it:** open `http://127.0.0.1:4190/console-strip.html` from the browser pane's `design-boards` entry. It is the Audio page as the studio showed it at 22:56 that evening, TotalMix answering and SM7B 3 selected, with the strip drawn again. The rest of the page is as built. The meters move with a simulated room. The corner panel:

- `As built`: the strip as it is today, for comparison.
- `Its states`: one strip in each state.
- The meters' colours: `Aqua` (recommended), `Violet`, `Mono`, and `As built`, the status colours (section 4).
- `Quiet cap`: the other fader cap (section 6).
- `Notes`: numbered notes on SM7B 3's strip.

Drag a knob or a fader. SM7B 1 and SM7B 2 sit at 0 dB of gain, below the meter's floor: turn their knobs up and their meters come up.

## 1. What the strip is today

Measured on the studio's screen on 2026-10-11 and in the code (`AudioMixerLane.tsx`, `AudioTieredMixer.module.css`, the design system's `Slider.module.css` and `Meter.module.css`):

- **The fader is the strip's largest light.** Each strip has a 44 × 22 cap in the light cap colour, on a groove the strip's full height, 1038 px. Ten of them are the brightest shapes in the bay.
- **The meter is a thin dark well beside it.** It is 24 px wide, with 18 px of signal, and it has no scale of its own. The scale printed beside each tier is the fader's (+6 to −60 dB of gain), not the meter's dBFS; only a faint tick marks −18 dBFS. So a level cannot be read in dBFS on the strip at all.
- **An input's meter shows the input, not the send.** The hardware link reports a hardware input's meter as `meterPoint: input` (`v1.md`, `rme_totalmix_osc.rs`): the level the preamp delivers, before the fader. It is the meter the gain is set by. The studio's inputs send nothing into Main (their faders are at −∞), yet their meters move.
- **The gain is a 14 px figure.** It stands in the tools row (`45 dB`). It is set only by the plate's knob, for the selected strip, or by typing it in the strip's `⋯`. The deck cannot set it: "the preamp gain is set on screen" (`OPERATIONS.md`).
- **The strip's big number is the send.** The 28 px readout under the name is the send into the mix target, not the level.

## 2. The new strip

Top to bottom, in the same 150 px and the same height. The rows stay fixed, the same on every strip and in the tier's scale column.

| Row   | Height | What it holds                                                                                                                          |
| ----- | -----: | -------------------------------------------------------------------------------------------------------------------------------------- |
| Name  |     28 | as today                                                                                                                               |
| M S   |     48 | as today, take-time keys                                                                                                               |
| 48 V  |     28 | **48 V on its own line**, as wide as M and S together; empty on a strip with no preamp                                                 |
| Knob  |     60 | **the gain knob**, 56 px on the strip's axis, its value on its face (`45` over `dB`); the strip's `⋯` at its right, on its centre line |
| Peak  |     24 | the held peak, small and quiet: 14 px in a little well exactly the meter's width, right over it                                        |
| Meter |   rest | **the meter**, 64 px wide (24 today), the hero; the fader beside it in a 28 px column                                                  |
| Send  |     24 | the fader's value at 16 px, under the fader                                                                                            |

**The cluster at the top** (the owner, 2026-10-11, the second pass: "Mute and Solo at the top as they are, then the 48V below on its own line. Then the gain knob below that and centered", with Apple's software as the model: clean, functional, attention to detail):

- **One axis.** The name, M and S, 48 V and the knob are symmetric about the strip's centre line. M and S together and 48 V share the strip's two edges, so the edges run straight down from the name to the knob.
- **Space says what belongs together.**
  - 8 px from the name to M and S.
  - 16 px from M and S to the preamp.
  - 8 px from 48 V to the knob's ring: the two are the preamp's.
  - 14 px from the knob to the peak's well, which stands 4 px over its meter.
  - In the build these are the grid's tracks, not margins.
- **The knob says how much and where, and nothing else.**
  - Its ring is the track. The light arc from 0 to the value says how much, and a short notch across the ring says where.
  - Then a clear 4 px gap, and the face: a key's face with its edge.
  - The face carries the value alone, the number over its unit.
  - 0 dB is the lower left, 75 dB the lower right. Every stroke has round caps.
- **Text on baselines.** The send's number and its unit share a baseline. The scale column's `dBFS` heads the peaks' row, centred as they are.
- **Armed, 48 V says the whole question.** On its own line it has the room: `48 V OFF?` across the key, with the countdown under it.
- **The strip's `⋯`** keeps its place hidden and shows on hover and while the strip is selected, as today, so nothing moves.

The meter:

- It runs −60 to 0 dBFS, linear in dB, as the hardware link's feed defines it.
- Its colours are its own, used for nothing else in the program (section 4).
- **Two layers**, as iZotope Insight and Ableton Live draw them:
  - the level, the hardware link's moving body (`level*Dbfs`), is the solid bar;
  - the peak (`peak*Dbfs`) is a fainter segment above it, so the headroom shows;
  - the held peak (`peakHold*Dbfs`) is a thin line in the meters' own light.
- The hot colour is never dimmed: a peak that reaches −3 dBFS shows it at full strength, as the level would.
- A stereo strip has two bars.
- The scale's marks stand as small ticks at the meter's edges, never across the signal. −18 dBFS, the working level, has ticks that reach out on both sides.
- The tier's scale column prints the meter's scale now, in dBFS, once per tier as today, −18 in bold.

The peak (third pass: small and quiet, a display, not the strip's headline):

- The hardware link's held peak, whole dB: held 1.5 s, then falling 20 dB a second, as the line does.
- 14 px in the second ink, in a little well exactly the meter's width, right over it, as Logic and Live keep theirs.
- The unit stands once, at the head of the column: the scale column's `dBFS` on the same row.
- It takes the meters' hot colour from −3 dBFS (`peakWarning`).
- While a clip is held it reads `CLIP` in the hot colour, with the hot colour's keyline round the well, until the clip is cleared from the latch slot or the menu, as today. The latch slot stays coral: the meter shows the signal, the slot the state.
- `−∞` in the quiet ink below the floor.

The fader:

- The send into the mix target, as today, and secondary now.
- A 28 px column, the take-time target, with an 8 px groove in it.
- A 28 × 12 cap with its index line: a third of today's 44 × 22, still matte and light, so its place reads from 3 m.
- The unity notch across the column, with a small `0` beside it, so the notch is never read against the meter's scale. The other ticks have no numbers.
- Its value is under it (`+0.0 dB`), or `—` while the strip sends nothing into the mix target.
- It still takes a drag, the arrows and typed entry. Unity still snaps.

The knob:

- 56 px, on every input that has a preamp (`audioChannelSupportsGain`).
- A vertical drag: 150 px for the whole 0 to 75 dB. The arrows step 1 dB, Page Up and Page Down 5. A double-click or Enter types the value.
- Like the plate's knob, it shows the new value while you drag and sends it to TotalMix when you let go, so a drag never streams gain changes to the preamp.
- A press on it selects the strip, so the plate follows.
- Locked, it is dashed at 55 % with the reason on hover. In doubt, its face carries the dashed yellow keyline.

The rest stays: the selection's Beige keyline, the hidden strip's `hidden` word and locks (D45), and the menu's items. `48 V` still arms and asks for a second press. The plate keeps the whole strip, its 72 px knob included.

## 3. Why

- **The signal's order.** The preamp at the top, then the input's level, then the send. The knob stands right above the number and the meter it moves, which is how the gain is set: turn until the peaks sit where they should.
- **TotalMix's own strip.** TotalMix prints the peak above the meter and the gain under the fader. The operator already reads a strip that way.
- **The 3 m rule.** DESIGN.md §1: at 3 m a page reads as three or four masses.
  - Today two of them are the faders' caps and the empty grooves.
  - On the board they are the meters, the selection and the keys.
  - The caps stay light and matte, so a fader's place still reads from 3 m, but small.
- **Restraint.**
  - The scale is printed once per tier, as now.
  - One new family of colours, the meters' own, used for nothing else (section 4). The doubt keyline, the selection and the keys are DESIGN.md's.
  - Seven type sizes on the page, as today.

## 4. The meters' colours

**The trouble.** The meters wore the status colours:

- green, which says READY and live;
- yellow, which says attention and doubt;
- coral, which says error and hazard.

Speech peaks sit in the working range, −18 to −3 dBFS, and that range was drawn yellow: in the attention colour, in normal operation. A quiet input read green, like READY. The owner, 2026-10-11: "it is visually confusing that they are shared across the program."

**What other software does** (read on 2026-10-11):

- **Green, yellow and red is the default almost everywhere.**
  - Pro Tools: green for nominal levels, yellow from −6 dBFS, red at full scale.
  - Logic: amber and yellow for safe levels, red for hot ones.
  - Audacity: the same.
- **Software drawn for dark interfaces moves the levels to cool colours.**
  - FabFilter Pro-L 2 draws its levels in grey or light blue and dark blue, the gain reduction in red. Its peak readings turn orange and red only for overs.
  - Cubase's meter colours are stops anyone can set, and its users on dark interfaces ask for turquoise.
  - Blue alone would lose the warning, so the board keeps one distinct colour at the top. That is the board's reasoning, not a source's.
- **Two layers and a small number.**
  - iZotope Insight and Ableton Live 12 draw the average level as a solid bar, the peak as a fainter segment above it, and the held peak as a thin bright line.
  - Logic and Live keep a small peak number over the meter.

**The palette, Aqua (recommended).** The thresholds stay the hardware link's.

| Where                        | Colour         | Hex                  |
| ---------------------------- | -------------- | -------------------- |
| below −18 dBFS               | aqua           | `#2AA7B6`            |
| −18 to −3, the working range | light aqua     | `#86E2E9`            |
| from −3                      | hot pink       | `#FF4FA3`            |
| the held peak's line         | ice white      | `#ECFDFF`            |
| the peak segment             | the same, 36 % | the hot zone at full |

- **Cool, so it never reads as a state.** It is far from SSE Green, a muted sage, and from the cues' Blue.
- **Brighter means louder.** The working range is the lighter aqua, so peaks in it read at once.
- **Hot pink is a hue nothing else in the program uses.** Coral stays the hazard's, in the latch slot.

The board's alternatives:

- **Violet**, `#6F63E6` and `#B8ADFF` with the same hot pink: striking, and heavier.
- **Mono**, cool greys `#7D8A91` and `#D3DDE1` with the same hot pink: the calmest, but a grey bar can read as disabled.
- **As built**, the status colours, for comparison.

**Where they apply:** every meter in the program. That is the strips, the outputs' rows in the cluster, the plate's meter, and the Overview's meter bridge in THE SOUND.

Sources:

- [Pro Tools' meters (Avid help)](https://apps.avid.com/proToolsFirstHelp/version12.0/enu/Pro%20Tools%20First%20Help/EQ3.41.13.html)
- [Logic Pro's meters (Apple help)](https://help.apple.com/logicpro/mac/10.1/en.lproj/lgcp8e96d97b.html)
- [FabFilter Pro-L 2's metering](https://fabfilter.com/help/pro-l/using/metering)
- [Cubase's meter colours (Steinberg help)](https://steinberg.help/nuendo/v11/en/cubase_nuendo/topics/mixconsole/mixconsole_meter_colors_setting_up_t.html)
- [turquoise meters on a dark interface (Steinberg forum)](https://forums.steinberg.net/t/feature-request/598297)
- [iZotope Insight 2's levels](https://s3.amazonaws.com/izotopedownloads/docs/insight200/en/levels/index.html)
- [Live's meters (Ableton forum)](https://forum.ableton.com/viewtopic.php?p=1757991)

## 5. Its states

The board's `Its states` view shows one strip in each:

- at rest;
- speaking;
- hot, from −3 dBFS;
- clip held;
- muted: the meter still moves, since it is the input's;
- `48 V` asking for the second press;
- locked: the Console not verified, so the keys, the knob and the fader are dashed and the meter waits;
- not confirmed: the dashed yellow keyline on the knob's face, the fader's cap and the send;
- a line input with no preamp, its preamp row empty;
- a stereo playback strip.

## 6. Questions for the owner

1. **The fader's cap.**
   - **Recommended:** light and small, 28 × 12, as on the board. A fader's place stays readable from 3 m (DESIGN.md §5).
   - **Otherwise:** quiet, a key's face with a light index line (`Quiet cap` on the board). It is calmer still, but harder to read from across the room.
2. **The plate's knob.**
   - **Recommended:** keep it. The plate is the whole strip, and its 72 px knob is the comfortable one. Both knobs ride one value.
   - **Otherwise:** take it out of the plate, which keeps 48 V, Hi-Z, polarity and AutoSet.
3. **The peak number.**
   - **Recommended:** the hardware link's held peak, as on the board: it falls back by itself, as the tick does, and adds no control.
   - **Otherwise:** a peak that stays until pressed, as TotalMix's own display. It adds a control and a state to every strip.
4. **The meters' colours.**
   - **Recommended:** Aqua, as on the board.
   - **Otherwise:** Violet or Mono, switched in the board's corner.

## 7. What it would mean to build

One pull request, about one session with the captures. It changes no device I/O: the knob sends `audio.channel.update {gain}`, which the plate's knob sends today. So no review is needed (AGENTS.md).

- **`AudioMixerLane.tsx`.**
  - The rows reordered: `48 V` on its own line at the strip's width, then the knob (`AudioKnob`, 56 px, value inside, the pointer drawn as a notch across its ring) on the strip's axis with the `⋯` at its right.
  - The send's `Readout` moves under the fader at 16 px.
  - The peak in a small well above the meter, 14 px. The overlay's loop updates its text only when the whole dB changes; the page never renders 30 times a second.
- **`AudioTieredMixer`.**
  - `--console-strip-rows` becomes `28px 8px 48px 16px 28px 6px 60px 12px 24px 4px minmax(0, 1fr) 8px 24px`, the spaces as tracks of their own and each part placed on its row.
  - The scale column prints the meter's marks (0, −6, −12, −18, −24, −40, −60 dBFS) instead of the fader's (`audioFaderScale.ts` keeps the groove's ticks).
- **The design system.**
  - `Groove` gains a compact size: a 28 px column, an 8 px well, a 28 × 12 cap.
  - `Meter` gains the wide strip form with its edge ticks.
  - Their boards in Storybook follow.
- **`AudioMeterCanvasOverlay.tsx`.** It paints the wider bars, the edge ticks and the −18 reference, and the two layers: the peak's fainter segment over the level, the hot zone at full strength. The clip shows in the peak's well.
- **The meters' colours.**
  - The tokens `--signal-meter-low`, `-mid` and `-over` and `--signal-peak` take the new values, defined once in the tokens' source, so `--signal-ramp-v` and `-h` and every meter follow: the strips, the outputs, the plate, the Overview's bridge.
  - The token tests already hold that no colour is defined twice.
  - DESIGN.md §4: "The meters have colours of their own, used for nothing else: aqua to −18 dBFS, light aqua to −3, hot pink above; the held peak an ice-white line."
  - The Overview's captures follow, beside the Audio page's.
- **Found on the way, fixed in the same pull request.** The plate's METER section says `post-fader` for every strip (`AudioPlateMeter.tsx`, a fixed word, and its tooltip). An input's meter is the input's level before the fader, so the word should follow the hardware link's `meterPoint`: `input`, `playback`, or `post-fader` for an output. The board's plate already says `input`.
- **DESIGN.md.**
  - §5: a strip's fader cap is 28 × 12, with the meter as the strip's hero.
  - §7: `Groove`'s compact size and `Meter`'s wide form.
- **OPERATIONS.md.** The strip's paragraph and `Gain` ("the strip's knob and the plate's ride it").
- **The page tests.**
  - The strip's rows and the places of its take-time keys.
  - The meters' gating.
  - The Audio captures, written again and looked at.
