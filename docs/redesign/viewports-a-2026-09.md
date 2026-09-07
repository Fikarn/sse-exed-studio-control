# The three viewports in Concept A's language (2026-09-06)

> **Superseded on 2026-09-07.** The operator ruled that `2560×1440` is the only resolution that matters; `1920×1080` and `1280×800` are no longer deliverables or gates. The `?vw=` modes stay in the mocks as a fallback and this write-up stays as the record; nothing below is required.

Status: step 4 of the handoff continues. Every A mock now lays itself out for the three hardware sizes via `?vw=2560x1440|1920x1080|1280x800` (`docs/redesign/assets/concepts/A-cockpit.html`, `A-lighting.html`, `A-planning.html`, `A-setup.html`; the Console also takes `&drawer=1` in utility mode). The probe renders the ready board of each at the live minimum in three themes and in utility mode in the default theme. No source, token or test was edited; nothing is committed.

Renders and numbers (outside git): `../gold-standard-evidence-2026-09/concepts/` — `<mock>__1920x1080__<theme>.png`, `<mock>__1280x800__studio.png`, `A-cockpit--drawer__1280x800__studio.png`, plus `census.md` and `contrast.md`, which now cover 66 boards.

## 1. The rule: density comes from the chrome, never from shrinking what is read to act

The type scale does not change with the viewport. What changes is the chrome budget, how many things are on screen at once, and which words are used:

| Region            | 2560×1440 (studio)                        | 1920×1080 (live minimum)                         | 1280×800 (utility)                                                                                                                                                                    |
| ----------------- | ----------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Header · footer   | 56 · 40                                   | 52 · 36                                          | 48 · 32; tab hints and the long tab label go ("Setup")                                                                                                                                |
| Cluster           | 424                                       | 360                                              | 232: a key rail with the state display, the take-time keys and the standing actions; lists collapse (snapshots become eight numbered keys; groups, projects and step descriptions go) |
| State display     | 180                                       | 168                                              | 140, word at 20 px, sentence at 13 px                                                                                                                                                 |
| Plate             | 416                                       | 360                                              | a drawer over the bay (`drawer=1`), 360 wide, the only floating surface                                                                                                               |
| Hero readout      | 44 px                                     | 32 px                                            | 32 px, label above the number                                                                                                                                                         |
| Console strips    | 4 / 6 / 3 at 120 px                       | 4 / 4 / 3 at 98 px, two playback pairs banked    | 4 / 4 / 3 at 84 px, the deck's own short names (`HOST`, `PGM`, `HP 1`), no fader scale, meters still live                                                                             |
| Mix target keys   | Main Out · Phones 1 · Phones 2            | same                                             | the deck's words: `→ MAIN` · `→ PH 1` · `→ PH 2`                                                                                                                                      |
| Lighting plot     | 1,688 × 1,125 (141 px per metre)          | 1,176 × 784 (98 px/m)                            | 1,002 × 668 (84 px/m); groups leave the rail                                                                                                                                          |
| Planning timeline | 115 px per hour, 268 px cards on two rows | 78 px/h, 210 px cards, every other hour labelled | 69 px/h, 180 px cards, durations as `85m`, no priority while a timer runs                                                                                                             |
| Setup step screen | two columns                               | two columns, shorter lead                        | one column; the records list as a two-column grid; Support becomes a mode of the bay                                                                                                  |
| Footer items      | four items + four hints                   | same                                             | two hints                                                                                                                                                                             |

Banking: below the studio width the playback tier shows Program 1/2, FX 3/4, N-1 5/6 and Music 7/8; the tier header says "4 of 6 pairs · ] shows Playback 9/10 and 11/12" and the footer's bank item reads `1–4 · 1–4 of 6 · 1–3`, so the operator knows two pairs are behind the bank keys without a scrollbar.

The utility drawer: at 1280 the plate is hidden and opens over the bay's right edge when a strip is selected for detail; it shows the selected strip's sends and meter readouts, and the EQ stays on its own tab. It is the only surface in the system that floats, and the only one with a large shadow.

## 2. What each viewport keeps and gives up

- **1920×1080 keeps everything**: the same anatomy, every control, every word, all three themes measured. It gives up two banked playback pairs, the fader tick labels stay, and the plate's EQ graph shrinks to 150 px.
- **1280×800 keeps the take-time controls and the state**: the state display with its sentence and way out, talkback, dim, mono, the mix target, the main level and master meter, eight snapshot keys, sync and probe; the eleven strips with live meters, dB readouts, M / S and 48 V. It gives up the fader tick labels, strip subtitles, the inspector column, groups (Lighting), projects (Planning) and step descriptions (Setup). It is what the profile says it is: setup, inspection and recovery, not full show control. Setup's Publish keys and probe results are fully visible at 1280 with the step screen at content height — the review's C4.

## 3. Measured (studio theme; Graphite and Bone identical at 1920)

| Board                     | Text nodes | Sizes / floor | Contrast fails | Targets < 24 · take-time < 28 | Shadows · negative offsets · blooms | Gradients |
| ------------------------- | ---------: | ------------- | -------------- | ----------------------------- | ----------------------------------- | --------: |
| Console 1920              |        331 | 8 / 12 px     | 0 / 0 / 0      | 0 · 0                         | 127 · 0 · 10                        |       107 |
| Console 1280              |        131 | 7 / 12 px     | 0              | 0 · 0                         | 93 · 0 · 9                          |        97 |
| Console 1280, drawer open |        156 | 7 / 12 px     | 0              | 0 · 0                         | 103 · 0 · 10                        |       106 |
| Lighting 1920             |        141 | 8 / 12 px     | 0 / 0 / 0      | 0 · 0                         | 50 · 0 · 9                          |        31 |
| Lighting 1280             |         75 | 6 / 12 px     | 0              | 0 · 0                         | 35 · 0 · 7                          |        20 |
| Planning 1920             |        157 | 7 / 12 px     | 0 / 0 / 0      | 0 · 0                         | 43 · 0 · 12                         |        27 |
| Planning 1280             |        100 | 6 / 12 px     | 0              | 0 · 0                         | 29 · 0 · 10                         |        14 |
| Setup 1920                |        145 | 7 / 12 px     | 0 / 0 / 0      | 0 · 0                         | 57 · 0 · 28                         |        27 |
| Setup 1280                |         91 | 7 / 12 px     | 0              | 0 · 0                         | 41 · 0 · 12                         |        17 |

(Shadow and bloom counts are from `census.md`; the two rounds of fixes recorded there were collisions, not legibility: hour labels touching below 90 px per hour, a running timer's elapsed time overlapping the card's priority, and keys wrapping their labels in the narrower cluster.)

## 4. Decisions to take with this

- **Utility mode is a rail, not a miniature.** At 1280 the cluster keeps the state display and the take-time keys at full size and drops the lists; the alternative — everything smaller — would put the state word under 20 px and the keys under 28 px, which the brief's outcomes forbid.
- **The deck's short names appear on screen at 84 px strips.** `HOST`, `PGM`, `HP 1` are the fixture's `shortName` fields, the same strings the deck's touch strip prints, so the two surfaces agree exactly when space is short. They are uppercase because the deck's are.
- **Every other hour is labelled below 90 px per hour.** Hour lines stay; only the labels thin out.
- **The 1280 drawer covers the outputs while open.** The alternative (a 1280 layout with a permanent narrow plate) would put every strip under 80 px; opening the drawer on demand keeps the eleven strips at 84 px.

## 5. Next

The three themes as one token set, the system sheet, and the revised sliced plan.
