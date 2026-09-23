# Polish pass at 2560×1440 (2026-09-07)

Status: the operator ruled on 2026-09-07 that `2560×1440` is the only resolution that matters; `1920×1080` and `1280×800` are no longer relevant. This pass looks only at the studio monitor (27", 108.8 ppi, 60–80 cm) and asks what can still be improved on the four A boards. Mocks only; no source, token or test edits; nothing committed.

Renders and numbers (outside git): `../gold-standard-evidence-2026-09/concepts/` — `A-cockpit__2560x1440__<theme>.png` and the ten `A-cockpit--<state>__…` boards, `A-lighting__…`, `A-planning__…`, `A-setup__…`, `census.md`, `contrast.md`. The `?vw=` modes stay in the mocks as a fallback and are not measured any more.

## 1. What changed, and why

Every addition below is fixture data the engine already reports; nothing is invented.

**Header (all four boards).** The wordmark is two lines: `Studio Control` over an `SSE Executive Education` eyebrow (12 px, text-2). The product now names its owner without a second logo; the header stays 56 px.

**Console.**

- Strips get a floor: a 2.5 % white lift on the bay in Studio and Graphite, a 45 % white lift in Bone, and a stronger lift on the selected strip. Before, the strip was only a keyline on the bay and the mixer read as one flat sheet; now each strip is a plate on the recessed bay, which is the material rule everywhere else on the board.
- The three tiers (Inputs, Playback, Outputs) are separated by a 1 px hairline with 12 px on either side, so the eye finds the tier boundary without reading the headers.
- The master meter in the cluster is 24 px tall (was 18): it is the one meter the operator watches from the chair.
- The plate gains a **Channel** section: Stereo link, Sends (post-fader), Compressor (off · −18 dB · 2:1), Gate (off · −48 dB) — from `buildAudioDynamics` and `buildAudioSendModes`. The operator could not see these flags anywhere before.
- The plate's tab row (Sends · EQ · Dynamics · Routing) is removed. At 2560 the plate is tall enough for every section at once, so a row of tabs promised switching that never happened. Sections carry their own titles.
- Under lock (not verified, offline, disconnected, disabled) the Channel head reads `last synced 18:24` instead of `as the desk reports it`, because the desk is not reporting.

**Lighting.** A **Fixtures** list in the cluster (Key 76 % · 3200 K, Fill 58 % · 4300 K, Back off, Warm wash 64 % · 3000 K) with the selection keyline mirrored on the plot. The plot was the only way to pick a fixture; a list is faster from the chair and reads the levels without hovering.

**Planning.** Done cards print `✓ done · 20m` with a green bar at 60 %; the state meta reads `0 slipped · 1 blocked · lighting · 5 done · 2 timers running · 1 unscheduled`; the cluster gains **Tracked today** (booth_2 1h 36m, evening_service 1h 30m, audio 42m, ops 4m, today 3h 52m) and the plate an **Activity** trail (18:24 Timer started, 18:10 Created); the footer prints `Done 5` and `Tracked today 3h 52m`. The board now says what happened today, not only what is scheduled.

**Setup.** The Publish step prints the commissioning record as it was done (Import profile — Companion profile exported; Probe hardware — 3 of 3 passed; Map bindings — 4 pages · 48 controls; Verify live echo — every control echoed) and the **Support archives** row (native-backup-2026-04-22T07-12-00 · 22 Apr 2026 · 09:12 · native). Publish is the last step; it should show what it commits.

## 2. What was measured

| Board (2560×1440, three themes)                   | Boards | Floor | Sizes                 | Targets < 24 / take-time < 28 | Contrast fails |
| ------------------------------------------------- | ------ | ----- | --------------------- | ----------------------------- | -------------- |
| A-cockpit, ten states                             | 20     | 12    | 8                     | 0 / 0                         | 0              |
| A-lighting, four states                           | 12     | 12    | ≤ 8                   | 0 / 0                         | 0              |
| A-planning, four states                           | 12     | 12    | ≤ 8                   | 0 / 0                         | 0              |
| A-setup, three states                             | 9      | 12    | ≤ 8                   | 0 / 0                         | 0              |
| Whole evidence set (incl. B, C, D, sheet, flat A) | 69     | 12    | ≤ 9 (sheet by design) | 0 / 0                         | 0              |

Console type census at 2560: 12:182 · 13:79 · 14:45 · 15:31 · 16:28 · 20:15 · 24:2 · 44:1 (383 nodes, JetBrains Mono 237 / Inter 146). Radii ⊆ {4, 8, 12, pill}; no negative shadow offsets; blur > 8 only on lit keys and lamps; 0 idle animations.

**One regression, caught and fixed.** The first Bone strip floor was a 3.5 % black tint on the `#e5e4df` bay, which put text-2 at 4.44:1 and amber-text at 4.28:1 on fourteen to sixteen nodes per board (tags, lamp words, send labels, tick labels). On a light bay a lifted strip must be lighter, as a plate is; a 45 % white lift restores 5.4:1 and 5.2:1. Rule for the tokens: `strip-floor` is a white lift in every theme, never a shade.

## 3. Rules that carry into the tokens and the plan

- `strip-floor` / `strip-floor-sel`: `white/2.5 %` and `white/4.5 %` in Studio and Graphite; `white/45 %` and `white/70 %` in Bone. Added to `tokens-a-2026-09.css` when the plan is approved (D-list unchanged; this is a material value, not a decision).
- Tier hairline: `line` at 1 px, 12 px margin + 11 px padding.
- Plate: no tab row; sections stack in this order — control rows, curves, readouts, flags, then the danger slot.
- Locked wording on section heads: `last synced <time>` when the source is not reporting.

## 4. Not done

No source, token or test files were touched. The decisions in `docs/plans/visual-overhaul-a-2026-09.md` (D1–D14, with D4 rewritten for one surface and D9 withdrawn) still await the operator's approval; nothing is committed.
