# Audio Console — four concepts, measured (2026-09-06)

Status: first deliverable of the from-scratch visual overhaul (`visual-overhaul-handoff-2026-09.md`, step 3). Four new concepts for the Audio Console at `2560×1440` plus the prior candidate re-argued and re-measured with the same probe. Every board renders in three themes, at 1:1, from real fixture values (`audio-populated`, dB through the RME fader curve). No source, token or test was edited. **Nothing converges until the operator has chosen.**

Where things are:

- Mocks (self-contained HTML, one per concept): `docs/redesign/assets/concepts/A-cockpit.html`, `B-ledger.html`, `C-signal-flow.html`, `D-strip-and-stage.html`. Open in Chromium; the board scales to fit, `1` toggles 1:1, `s` / `g` / `b` switch themes (or `?theme=graphite|bone`).
- Renders, census, contrast and crops (outside git): `../gold-standard-evidence-2026-09/concepts/` — `<concept>__2560x1440__<theme>.png` + `.json`, `census.md`, `contrast.md`, `crop-*.png` (1:1 cuts of the take-time zones), `fails-*.png` (the pixels behind every contrast failure of the first pass).
- Probes (same folder, `probe/`): `concepts.mjs` (renders each mock and the v1.1 skeleton board, then records text nodes, targets, radii, shadows with their offsets and blur, gradients, backdrop blur, running animations, transitions, chrome regions), `concept_contrast.py` (pixel-sampled WCAG contrast, reusing `contrast.py` unchanged), `cropfails.py` (a contact sheet of the pixels behind each failing text node).

## 1. What was held constant, so the comparison is about composition, hierarchy and material

- The facts: the 13 strips and their values, the mix target (Main Out), FX 3/4 selected and soloed, the five named snapshots with Show open current, 42 confirmed values, last sync 18:24, RME live metering, clock 09:11, the shell (four tabs, three subsystem lamps, the solo latch).
- One type pairing on all four: Inter for language, JetBrains Mono for values, so type is not the differentiator. (The prior candidate adds Fraunces.)
- One meaning per hue on all four, matching the deck: **amber fill = engaged** (active mix target, solo, dim, mono, peak hold), **green = live / ok** (a held talkback, the VERIFIED lamp), **red = hazard** (48 V on, clip, disconnected). What differs per concept is _selection_: a white keyline (A), a periwinkle keyline (B), a teal keyline (C), a blue keyline (D). None of them uses amber for "selected", which the deck does today — see §6.
- One type floor, defended once (§2), and one measurement pass (§4).

## 2. The type floor for this monitor, and why

The studio monitor is 27 inches at `2560×1440`: 108.8 px per inch, 0.233 mm per pixel, at 60–80 cm. Inter's capital height is about 0.73 em. So a capital letter subtends, at 70 cm:

| Font size | Capital height | Angle at 70 cm | Use in the concepts                                                       |
| --------: | -------------: | -------------: | ------------------------------------------------------------------------- |
|    9.5 px |         1.6 mm |     7.9 arcmin | The current Console's most common size (236 of 396 text nodes). Not used. |
|     12 px |         2.0 mm |    10.0 arcmin | **Floor.** Scale ticks, eyebrows, secondary meta — never read to act.     |
|  13–14 px |     2.2–2.4 mm |    10.9–11.7 ′ | Labels and rows the operator reads to act; command buttons.               |
|     16 px |         2.7 mm |    13.4 arcmin | Strip names, printed values, the state badge's word.                      |
|  20–24 px |     3.4–4.1 mm |    16.7–20.1 ′ | Take-time words and readouts: the state word, strip dB, key caps.         |
|  32–44 px |     5.4–7.5 mm |    26.7–36.9 ′ | The one number read from a metre away: the main level, the focused dB.    |

ISO 9241-303 puts comfortable continuous reading at 20–22 arcmin and its minimum at 16; recognising a familiar short label is reliable far below that, but not at 8. So 12 px is the floor for things glanced past, 13–14 px for things read to act, 16 px and up for things read at a glance, 20 px and up for anything read during a take. Every concept keeps to at most eight sizes drawn from 12 / 13 / 14 / 15 / 16 / 20 / 24 / 32 / 44.

## 3. The concepts

### A — Cockpit (safety first)

Composition: a fixed 424 px instrument cluster on the left (state word, solo latch, TALKBACK, DIM, MONO, mix target, main level, master meter, eight snapshot keys, Sync / probe / clear clips); 13 full-height strips in the centre, each with name, dB, 48 V + gain (or the channel's other sends, or the output's dim / mono lamps), M / S, then the fader; a 416 px inspector on the right. No workspace top bar: the cluster's first element is the state. Material: a backlit instrument panel — matte black chassis, no shadows, groups made by hairlines and spacing; printed labels dim, live values bright, engaged keys lit amber, a held key lit green, and every display (meter, groove, readout) a black backlit well in all three themes, including the light one.

**Gives:** the top-left of the screen answers every take-time question in one fixation — a 24 px VERIFIED word with the confirmed count, TALKBACK / DIM / MONO, the mix target, a 44 px main level, the master meter and the eight snapshots — in a column no state change can move, while each of the 13 strips keeps its name, dB, 48 V, M and S in one top row that is read along a single line across the desk. **Costs:** it drops the workspace top bar, so Lighting, Planning and Setup must adopt the same "the left cluster carries the state" convention or the shell stops being one instrument; and the 1,038 px fader travel (about 32 px per dB near unity) makes a big move a long drag — wheel, arrows and typed entry carry those — while at `1920×1080` the strips must bank 4 / 4 / 3 beside a 424 px cluster.

### B — Ledger (truth per value)

Composition: the console as a table under a 48 px top bar. A pinned monitor row ("Monitor · you are hearing Main Out": mix target, TALKBACK, DIM, MONO, main level, master meter), then one 76 px row per channel grouped by tier with the same columns everywhere — # · channel · 48 V · gain · fader (horizontal, unity notch, a shared axis in the header) · dB · meter (horizontal, the −18 dBFS reference line running down the whole column) · M · S · **Desk says**. A 640 px right column holds the snapshot list and the inspector. Material: flat tonal planes, hairline rules, panels one step lighter than the chassis, keys one step lighter again, no shadows, no gradients except the meter ramp.

**Gives:** one row per channel with identical columns turns "what does the desk say?" into a column the eye runs down (Confirmed / Adjusted / External / unconfirmed as printed words beside each value), gives every meter one shared −18 dBFS reference, and it is the most keyboard-first and the most robust at 1920 and 1280 of the five. **Costs:** it abandons the vertical-fader picture the operator has on the TotalMix monitor beside it, so it reads as a spreadsheet rather than a desk; the take-time controls shrink to one 104 px monitor row above the table, and the 512 px row faders are the shortest of the five.

### C — Signal flow (the mix target is the spine)

Composition: left to right the way the signal goes. A 1,376 px **Sources** zone (4 preamps + 6 playback pairs, each fader being that channel's send into the selected mix) → a 640 px raised **hub** in the middle (the three-way mix-target switch, a sentence saying what you are hearing, the big stereo meter, the main level fader with a 44 px readout, TALKBACK, DIM, MONO, desk telemetry, the solo latch) → a 464 px **Outputs** zone. The selected strip's detail is a 344 px band under the flow; the eight snapshots sit in a 64 px top bar. Material: layered — zones are recessed floors, strips are soft cards, the hub is the one raised surface and casts the only shadow on the screen.

**Gives:** the confusion that causes wrong mutes and wrong solos ("which mix am I hearing and setting?") becomes the spine of the layout — sources send into the hub, the hub is the mix you are hearing with its own meter, level and monitor keys, and the outputs stand apart — and recall is one press away from anywhere. **Costs:** the inspector band takes fader travel down to 577 px; the source strips are the narrowest of the four (124 px) and Main Out appears twice (as the hub and as an output strip); and the material spends its one shadow and its one raised surface on the hub, a privilege the other workspaces would have to justify too.

### D — Strip and stage (the deck's idiom, one strip large)

Composition: under a 48 px top bar, a 256 px **band** rendered as a backlit LCD: the monitor cluster on the left (TALKBACK, DIM, MONO, SOLO · 1, mix target, main level, master meter) and thirteen 138 px segments, each printing name, dB at 24 px, a drawn fader with the unity notch and position marker, a meter, M / S keys and the 48 V / stereo / target / mono tag — exactly what the Stream Deck's touch strip prints. Below it the **stage**: the focused strip at hardware scale (an 850 px fader, a stereo meter, a 44 px readout, MUTE / SOLO keys, its other sends), its EQ in the middle, and snapshots, meter readouts and desk telemetry on the right. Material: the band is a black display in every theme; the stage is soft panels with generous type.

**Gives:** the whole console at a glance in the deck's own language at a geometry no state can reflow, and the strip you are riding shown once, large, with the biggest fader and the clearest readout of the five — the screen and the deck read as siblings. **Costs:** every strip has two faders (a drawn one you cannot ride in the band and the big one on the stage), so riding two channels alternately means focusing each first; mutes across channels use the band's 44 × 32 px keys, the smallest take-time targets of the four; and the stage's panels carry unused area whenever the focused strip is a playback pair.

### v1.1 — Desk (the prior candidate, re-argued)

Composition: the skeleton — 64 px header, 48 px top bar with the state badge, a 320 px rail (monitor section, snapshot list, console link), 13 full-height strips, a 480 px inspector, a 40 px footer. Material: physical — one top-left light, five elevation levels, keys that go down and stay lit, lamps in wells, stamped mono key caps.

**Gives:** the closest to a mixing desk of the five, with a material that makes engaged, live, armed and hazard states read by form (a key that is down and lit) as well as by colour, and a skeleton the other three workspaces already have boards for. **Costs:** the material needs 112 box-shadows and 7 radii on an idle screen (measured), its floor is 10 px with 217 of 295 text nodes at 10 or 11 px, its state word is a 14 px badge — the least prominent of the five — and its monitor section is the smallest take-time cluster; keeping it means policing shadow direction and elevation on every component for the life of the product.

## 4. Measured, 2560×1440, 1:1, three themes

Studio-theme numbers; Graphite and Bone are identical except where noted. Contrast is pixel-sampled from the PNG (text ≥ 4.5:1, ≥ 3:1 when large, disabled exempt), the same sampler as the review. "Take-time" = controls marked `data-take` (talkback, dim, mono, mix target, main level, faders, M, S, 48 V, snapshot recall). The current program's numbers are the review's (`gold-standard-review-2026-09.md` §2), Audio workspace.

| Measure                                 | A Cockpit           | B Ledger                   | C Signal flow           | D Strip and stage              | v1.1 Desk (prior)                     | Current program          |
| --------------------------------------- | ------------------- | -------------------------- | ----------------------- | ------------------------------ | ------------------------------------- | ------------------------ |
| Text nodes                              | 376                 | 310                        | 360                     | 255                            | 295                                   | 396                      |
| Distinct sizes / floor                  | 8 / **12 px**       | 6 / **12 px**              | 8 / **12 px**           | 8 / **12 px**                  | 8 / 10 px (128 nodes at 10, 89 at 11) | 14 / 9.5 px (236 at 9.5) |
| Uppercase share                         | 5 %                 | 15 %                       | 11 %                    | 17 %                           | 17 %                                  | 35 %                     |
| Contrast fails Studio / Graphite / Bone | **0 / 0 / 0**       | **0 / 0 / 0**              | **0 / 0 / 0**           | **0 / 0 / 0**                  | 0 / 0 / 0                             | 7 / 7 / 79–83            |
| Pointer targets (smallest short side)   | 96 (26 px)          | 96 (28 px)                 | 98 (28 px)              | 81 (28 px)                     | 14 counted¹ (28 px)                   | 25 targets under 24 px   |
| Take-time controls (smallest)           | 56 (**32 px**)      | 55 (28 px)                 | 56 (28 px)              | 42 (28 px)                     | —¹                                    | 18–23 px                 |
| Corner radii                            | 4                   | 4                          | 4                       | 4                              | 7                                     | 12                       |
| Box-shadows at rest                     | **0**               | 2²                         | 1 (the hub)             | 1²                             | 112                                   | 129                      |
| Gradients                               | 24, all meter ramps | 15, all meter ramps        | 24, all meter ramps     | 17, all meter ramps            | 15                                    | 110                      |
| Backdrop blur · idle animations         | 0 · 0               | 0 · 0                      | 0 · 0                   | 0 · 0                          | 0 · 0                                 | 0 · 0                    |
| Chrome (header · top bar · footer)      | 56 · none · 40      | 56 · 48 · 40 (monitor 104) | 56 · 64 · 40 (band 344) | 56 · 48 · 40 (band 256)        | 64 · 48 · 40                          | 84 · 56 · 22             |
| Fader travel                            | 1,038 px            | 512 px (horizontal)        | 577 px (hub 671)        | ≈ 850 px focused; 132 px drawn | full-height strips                    | ≈ 500 px                 |
| Distinct text colours (Studio)          | 7                   | 7                          | 8                       | 9                              | 11                                    | —                        |

¹ The v1.1 skeleton draws its keys as `div.btn` / `.toggle` / `.chip`, not as buttons; only those were counted, and its take-time keys are not tagged. ² Inset keylines on the selected row and the current snapshot, counted as box-shadows by the probe.

The first measurement pass found 1–16 failing text nodes per board; all were fixed and re-measured, and every failure had one of four causes, recorded here because they will recur in implementation: a fader cap or unity notch overlapping the "0" tick (fixed by making the fader's pointer target the full column the cap rides in, 40–60 px wide, so the cap never leaves it); the sampler landing on the glyph itself for single-character tick labels at line-height 1 (fixed by 3 px of padding and line-height 1.2 — an honest fix, since it also stops ticks touching neighbours); D's band overflowing its height and compressing the meter scale under the meter (fixed by height and `flex: none`); and Bone-theme inks used inside D's black display (fixed by scoping display inks to the band). The probe also learned to read SVG text `fill` instead of `color`.

## 5. Recommendation

**Choose A, Cockpit.** From the operator's chair it is the only one of the five in which the four one-fixation questions — safe to act, what is live, what is unconfirmed, where am I — are answered by one glance at one fixed place, in a word big enough (24 px, 20 arcmin) to be read while a guest is talking; the take-time keys are the largest of the five (nothing under 32 px); the strips keep TotalMix's vertical picture; and its material is the cheapest to keep honest (zero shadows, four radii, colour only as state), which is what "the four workspaces read as one instrument" will cost the least. Its one structural cost, no workspace top bar, is a rule the other three workspaces can follow (Lighting's cluster: master, scenes, bridge state; Planning's: today, the timer, the project; Setup's: the five steps and the commissioning state), and the fader travel is a tuning, not a stance.

Runner-up: **D, Strip and stage.** It is the strongest answer to "the screen reads as a sibling of the deck" and has the best single-strip ride, but it makes every second channel a two-step (focus, then ride), which is exactly the take-time cost the brief ranks highest.

Not recommended as the base: **B** (best at unconfirmed values, worst at looking like the desk beside it; its "Desk says" column is worth carrying into whichever wins as the per-value doubt mark); **C** (the clearest statement of the mix-target model, but it pays for it in fader height and a duplicated Main Out; its one sentence — "Main Out is on the monitors; the faders set sends into it" — is already in A's cluster); **v1.1** (a good skeleton, but its material is the most expensive to police and its state word the least prominent — the reasons the operator asked for a fresh start).

If A is chosen, the next pass converges — not before: A's blocked states (NOT VERIFIED, ASSUMED with per-value marks on the dB wells in B's vocabulary, OFFLINE, an armed recall on the snapshot key itself), then Lighting, Planning and Setup on the cluster rule, then `1920×1080` (4 / 4 / 3 banked strips, the cluster narrowed to keys) and `1280×800` (the cluster as a key rail, the inspector a drawer), then the three themes as a token set, the system sheet, and a revised sliced plan.

## 6. Two things to decide with the direction

- **Selection versus the deck.** All four concepts (and v1.1) reserve amber for _engaged_ and give _selected_ a neutral or cool keyline; the deck today marks the selected strip with an amber accent, so the two surfaces would disagree about what amber means on one state. The clean fix is engine-side: the deck's selected-strip accent becomes neutral (white) and amber stays engaged — the brief's §7 asks that this be raised, not assumed. A's white selection keyline is the closest to what the deck could print.
- **48 V at rest.** The concepts show 48 V on as a red lamp and word on a dark key, not a red-filled key: with all four preamps on 48 V for every session, four red slabs would make red mean nothing when a clip or a disconnect needs it. Arming a change (press twice) still gets the full hazard treatment on the key.

## 7. What the boards deliberately do not show

The ready state only (everything confirmed, RME live metering, no clip latched), so nothing on them claims a state the engine cannot report. Hover, press, focus and motion are not in the mocks (zero transitions by construction); the motion policy is part of the system pass. The `1920×1080` and `1280×800` compositions, the other three workspaces and the blocked states follow the choice, as the handoff orders them.
