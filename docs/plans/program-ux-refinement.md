# SSE ExEd Studio Control — Program-Wide UI/UX Refinement Plan

> **Goal:** bring the whole operator console — Lighting, Planning, Setup, Startup/Recovery, the shared chrome, and the design system — up to the polish, coherence, and theme/keyboard/density discipline of the freshly-polished **Audio Console**, so the product feels and behaves like one ultra-premium, gold industry-standard tool end to end.
>
> **This is a self-contained handoff** written to be executed by a **fresh Claude Code session with no memory of the audit conversation.** Everything needed is here or in the two referenced docs. Do not assume prior context.

---

## How to use this plan (cold-start)

**Read first, in order:**

1. **[`../../program-ux-audit-2026-06-05.md`](../../program-ux-audit-2026-06-05.md)** — the evidence base. 77 verified findings with per-finding evidence, computed contrast, file paths, and presentation-only proposals; per-surface scorecards; a cross-surface coherence section. **This plan references findings by ID** (e.g. `THEME-02`, `DENSITY-03`, `PLA-04`, `LIG-02`, `LGS-02`); the evidence + proposal for each ID is in that doc. Do not duplicate it.
2. **[`../../AGENTS.md`](../../AGENTS.md)** — authoritative architecture boundary, hardware target, design-system rules, validation lanes, Visual Review Discipline, and the **Rescope protocol** (§ "Constraints" below restates it).
3. **This plan** — the execution sequence + progress tracker.

**Finding-ID note:** the audit has **two** Lighting sections. To avoid an ID collision, the second (stage/inspector) section's findings are prefixed **`LGS-`** (Lighting Stage); the first (workspace shell) section keeps **`LIG-`**. Cross-surface "coherence-lens" findings use `CHROME-/THEME-/DENSITY-/CONTROLS-/TOKENS-/COPY-`. Per-surface findings use the surface prefix `LIG/LGS/PLA/SET/STA/GLO/DES/AUD`.

**Progress tracking (precise, drift-resistant):**

- Work **one Slice per PR**, in dependency order (§ "Execution order"). Each Slice is independently reviewable.
- When you **start** a Slice, set its row in the **Slice status** table to `◐ in progress` and put the same on the Slice's `**Status:**` line.
- When you **finish**, set both to `☑ done — #<PR>`.
- If a Slice's **premise proves wrong on inspection** (the audit's adversarial pass corrected several candidates, but code drifts), **do not silently substitute work**. Follow the **Rescope protocol**: renumber/rename the Slice heading, record a dated entry in the **Rescope log** (bottom), and call it out in the commit. The `scripts/check-slice-rescope.mjs` guard (wired into `lint-staged` for `docs/plans/**/*.md`) blocks a commit that edits a `## Slice N` heading unless this file contains a rescope entry.
- **Verify each Slice's premise against live code before implementing** (grep the cited tokens/selectors/files). The "Premise check" line in each Slice tells you the fastest way.

**Current repository state (2026-06-06):**

- Branch **`claude/audio-console-100`** carries Slice 0 (PR **#125**, validated, pushed): `4ff4191` (Audio AUD-01/02/03 + `ok`-tone + `AudioEmptyInspector`) + the audit/plan docs. `main` is unchanged until #125 merges. **Audio visual baselines were verified unchanged** — the EQ low-cut shade fix is sub-threshold (Playwright `maxDiffPixels:100`), so no regeneration was needed (see the Rescope log). Slice 1 branches off `main` once #125 lands.

---

## Slice status

Legend: `☐` not started · `◐` in progress · `☑` done · `⤳` rescoped (see log).

| Slice | Title                                                  | Phase         | Status                   | PR   |
| ----: | :----------------------------------------------------- | :------------ | :----------------------- | :--- |
|     0 | Finalize in-flight Audio fixes                         | A Foundation  | ☑ done — #125            | #125 |
|     1 | Token foundation (define)                              | A Foundation  | ☑ done — #126            | #126 |
|     2 | Overlay plumbing (z-index / scale / focus)             | A Foundation  | ☑ done — #128            | #128 |
|     3 | Global `[data-theme]` foundation                       | B Theming     | ◐ 3a#129 3b#130 · 3c WIP | —    |
|     4 | Shell frame for Setup / Startup / Recovery             | C Chrome      | ☐                        | —    |
|     5 | One shared footer / health-bar primitive               | C Chrome      | ☐                        | —    |
|     6 | Unified feedback + amber tone + copy cleanup           | C Chrome      | ☐                        | —    |
|     7 | Tabular-nums + focus rings + severity (adopt)          | D Disciplines | ☐                        | —    |
|     8 | One control contract                                   | D Disciplines | ☐                        | —    |
|     9 | Lighting deep polish                                   | E Surfaces    | ☐                        | —    |
|    10 | Planning deep polish                                   | E Surfaces    | ☐                        | —    |
|    11 | Setup deep polish                                      | E Surfaces    | ☐                        | —    |
|    12 | Startup / Recovery deep polish                         | E Surfaces    | ☐                        | —    |
|    13 | Audio adopts shared scale/motion → literal 100         | F Closure     | ☐                        | —    |
|    14 | Per-surface Graphite/Bone tuning + per-theme baselines | F Closure     | ☐                        | —    |
|    15 | Round-2 runtime audit                                  | G Round 2     | ☐                        | —    |

**Execution order / dependencies:** `0 → 1 → 2 → 3 → {4,5,6} → {7,8} → {9,10,11,12} → 13 → 14 → 15`. Hard deps: **S1 unblocks everything**; S2 needs S1's `--z-*`/scale tokens; S3 needs S1; S4–S8 need S1 (+S3 for theming); S9–S12 adopt S1/S3/S7/S8; S13 needs S1/S3/S5; S14 needs S3 + all surface slices. **Fast coherence win = S1 + S3 + S6.**

---

## Gold standard (rubric, condensed)

Audio is the benchmark (92→100). A surface is "gold" when: (1) no undefined CSS classes / dead controls / `system-ui` fallbacks; (2) every real text/indicator clears **WCAG AA in all three themes** (Studio + Graphite dark, Bone light) and severity is **color-encoded** (error→danger red, attention→amber, ok→neutral); (3) every continuous control is keyboard-operable, dangerous latched state has a persistent indicator + clear accelerator; (4) typed numeric entry, hover/drag affordances, one control contract, visible focus rings; (5) **no scroll at 2560×1440 and 1920×1080**, dense, full-bleed, container-query responsive; (6) no hardcoded hex/px/font/duration literals, tabular-nums telemetry, shared primitives, motion tokens; (7) one chrome / canvas tint / button vocabulary / feedback channel across surfaces; (8) designed empty/loading/error states, precise typo-free copy. Full rubric: the audit's Executive Summary.

## Non-negotiable constraints

- **Architecture boundary:** presentation-only. No state/persistence/device policy into React; **no new engine/protocol/OSC data.** If the ideal fix needs engine data, ship the front-end-only partial and note the limit.
- **No-scroll** at **2560×1440** and **1920×1080**. Verify both on any height-affecting change.
- **Three themes:** Studio + Graphite (dark), **Bone** (light). Every color change holds in all three; Bone fails AA most often.
- **Token discipline:** extend additively in `frontend/packages/tokens/src/`; regenerate with `npm run frontend:tokens:build`; never hand-edit generated outputs; never one-off-style around the tokens.
- **Settled decisions:** retired **multi-hue broadcast palette stays retired** — single warm amber accent + clip-only danger red is the law (no talkback-green / group-ochres / blue). Intentional **dead code** (`AudioRail.tsx`, `AudioToolbar.tsx`, `AudioPreampControl.tsx`, `AudioTargetPicker.tsx`) is neither styled nor mounted.
- **Preserve every `data-testid`;** update affected tests; never weaken an assertion to hide a regression.
- **Rescope protocol** (binding — this team was burned by silent rescopes in Phase 3 Slices 4 & 6): when a premise proves wrong, renumber/rename the Slice, log it (bottom), and call it out in the commit. Do not substitute different work under the same Slice name.

### Validation lanes (from `AGENTS.md` / `package.json`)

| When                 | Run                                                                                                                                                                                                                                                                                  |
| :------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| After any change     | `npm run frontend:typecheck` · `npm run lint`                                                                                                                                                                                                                                        |
| Logic/components     | `npm run frontend:test` (Vitest, run-mode — exits on its own; **bare `vitest` watch hangs**)                                                                                                                                                                                         |
| Token source changed | `npm run frontend:tokens:build`, then re-typecheck (commit the regenerated `tokens.css`)                                                                                                                                                                                             |
| **Operator-visible** | `npm run frontend:playwright:test` (builds app + storybook, runs Playwright + visual baselines). Regenerate intended baseline changes with Playwright `--update-snapshots` in `frontend/app`; **darwin** regenerates locally, **linux** bootstraps from the first CI run's artifact. |
| Layout/presentation  | `npm run tauri:visual:review` + inspect on the **Scaled Studio Preview** (2560×1440)                                                                                                                                                                                                 |
| Full gate before PR  | `npm run dev:check`                                                                                                                                                                                                                                                                  |

One PR ≈ one Slice; for operator-visible Slices, the regenerated visual baseline diff is the review artifact.

---

## Four root causes (the spine)

1. **Theming is trapped in Audio.** Verified: `frontend/packages/tokens/src/generated/tokens.css` has **zero `[data-theme]` blocks**; Audio themes via its own `data-audio-theme` attribute on `.audioShell`. Dark chrome frames a near-white Bone mixer.
2. **The token foundation is incomplete even in the one dark theme.** Verified undefined-but-used (0 global defs): `--color-studio-300/400`, `--color-accent-amber`, `--color-text-primary`, `--radius-xl`, `--font-size-xs` (11 files), `--operator-font-size-title-xl`, `--size-controlHeight` (a casing bug — `--size-control-height` _is_ defined), `--color-surface-raised`, `--color-success-*`, `--color-status-warning`. Severity flattens, hierarchy collapses, headlines freeze out of UI-scale.
3. **Audio's premium disciplines were never promoted to the shared layer.** Full-bleed/full-height density, container-query densification, tabular-nums telemetry, focus rings, `role=slider` keyboard, typed numeric entry — all stop at the Audio edge.
4. **The chrome/feedback contract is fragmented.** Setup/Startup/Recovery bypass `AppShellFrame` (the `.setupCanvas { width: min(1400px,100%) }` centered column, used 3×); footer built three ways; portaled palette/toast/dialog escape UI-scale and collide on z-index; no amber attention tone; raw enums leak as copy; a degraded banner contradicts itself.

---

## Slices

> Each Slice: **Goal · Findings · Key files · Approach · Validation · Premise check · Status.** Open the audit for each finding's evidence + proposal.

## Slice 0 — Finalize in-flight Audio fixes

- **Goal:** land the validated Audio work on `claude/audio-console-100` and clean the branch.
- **Findings:** `AUD-01`, `AUD-02`, `AUD-03` (+ the `ok`-tone + `AudioEmptyInspector` work, already implemented).
- **Approach:** review the diff; regenerate the **darwin** `audio-populated-*` baselines (the EQ low-cut shade is the one visible change — now a neutral `--fg-3` wash, not a stray accent outline); inspect on Studio Preview; push; open + merge the PR; let CI bootstrap the linux baselines.
- **Validation:** `npm run frontend:playwright:test` (+ `--update-snapshots` for the audio baseline) · `npm run dev:check`.
- **Premise check:** rebase on latest `main`; re-run typecheck/lint/`frontend:test`.
- **Status:** ☑ done — #125. AUD-01/02/03 + `ok`-tone + `AudioEmptyInspector` landed (`4ff4191`); validated green (typecheck, Vitest 27+81, all 9 audio Playwright visual specs, full `dev:check`). **Audio visual baselines verified unchanged** — the EQ low-cut shade fix is sub-threshold (under Playwright's `maxDiffPixels:100`), in-frame in `audio-populated` (channel FX 3/4 selected, EQUALIZER graph); `--update-snapshots` rewrote nothing, so there is no baseline change to commit. See the Rescope log.

## Slice 1 — Token foundation: define the missing namespaces, scale, z-index, motion

- **Goal:** complete + share the token layer so severity color, hierarchy, headline scale, layering, and motion resolve everywhere. **Highest-leverage Slice.**
- **Findings:** `THEME-02`, `TOKENS-02`, `TOKENS-03`, `TOKENS-05`, `CHROME-06`, `DES-01`, `DES-03`, `DES-06`, `DES-08`, `DES-09`, `SET-08`, `STA-07`, `PLA-08`, `DENSITY-09`/`PLA-09`, `LGS-01` (`#ff6b35` ring), plus defining `--z-*` (for S2), the shared **type-scale** + **motion easings** (for S7/S8/S13).
- **Key files:** `frontend/packages/tokens/src/tokens/core.json` (the **wired** source — built by `style-dictionary.config.mjs`), generated `…/generated/tokens.css` (via build); `frontend/app/src/app/OperatorLayoutProvider.module.css:29-31` (the `--operator-font-size-title-{sm,md,lg}` defs — add `title-xl` here); DS primitive CSS (consumers).
- **Approach (verified specifics):**
  - **Alias the undefined namespaces** onto real tokens: `--color-studio-*`, `--color-accent-amber`, `--color-text-primary`, `--color-surface-raised`, `--radius-xl`, `--font-size-xs`, `--color-success-*`, `--color-status-warning`.
  - **`--size-controlHeight`** is a **casing bug** — define the camelCase alias (or fix the ~5 consumers to `--size-control-height`, which exists).
  - **`--operator-font-size-title-xl`**: add `calc(34px * var(--operator-ui-scale-factor))` beside its siblings at `OperatorLayoutProvider.module.css:29-31`; this retires the 4 divergent literal fallbacks at `OperatorShell.module.css:418` (34px) / `:622` (36px) and `PlanningWorkspace.module.css:26` (30px) / `:169` (32px) and restores UI-scaling.
  - Add a **shared type-scale** (covers the micro-telemetry sizes; lets S13 retire Audio's 107 px literals), a **`--z-*` scale** (`--z-overlay/-dialog/-palette/-toast`), and the missing **easings** (promote Audio's two curves to `--motion-easing-*`).
  - Fix the `Surface` primitive collapse (`DES-09`) and the empty `tokenValues` stub / dual pipeline (`DES-03`). Regenerate; never hand-edit generated CSS.
- **Validation:** `frontend:tokens:build` → typecheck → lint → `frontend:test` → `frontend:playwright:test`. Baselines **change** where undefined→defined restores rendering (severity color on `StatusBadge`/`StatusBand`/`MetricCard`, square→round corners, headline sizes) — review each as intended.
- **Premise check:** re-run the undefined-token grep (`rg "^\s*--color-studio" frontend/packages/tokens/src/generated/tokens.css` etc.) — confirm still 0 defs before aliasing.
- **Status:** ☑ done — #126 (squashed to `main` as `1abb5ad`; incl. the DES-03 closeout). Premise re-confirmed on merged `main` (all namespaces 0 defs; `--size-control-height` exists). Aliases added to `core.json` as **`{references}` + `outputReferences: true`** so they emit `var(--base)` (theme-ready for S3). ok-severity (`--color-accent-green`) → brand `primary-500` (operator decision). title-xl added to the operator scale. **Two scope refinements vs the plan (see Rescope log):** (1) the camelCase refs `--size-controlHeight` (6×) + `--color-surface-borderStrong` (5×) can't be emitted by style-dictionary, so they were fixed in-consumer — S1 is not purely additive token work; (2) DES-03 was **closed out in-slice** after all — orphan pipeline deleted (`source/tokens.json` + `build-tokens.mjs` + `token-docs.md`), `tokenValues` repopulated via the DTCG `$value` format fix (222 tokens), `AGENTS.md` source-of-truth line corrected; the wired `tokens.css` stays byte-identical. (The follow-up chip is therefore moot.)

## Slice 2 — Overlay plumbing: z-index, UI-scale, focus

- **Goal:** portaled chrome layers correctly, scales with the operator, traps focus.
- **Findings:** `DES-05`, `GLO-02`/`CHROME-03`, `GLO-03`, `DES-04`, `GLO-10`.
- **Key files:** `frontend/app/src/app/shared/{paletteContext,toastContext,ShortcutOverlay,ShellDialog}.tsx`, `…/shared/toastStack.module.css`, `…/shared/ShortcutOverlay.module.css`, `OperatorLayoutProvider.tsx`, DS `{CommandPalette,Toast,Dialog}` + `Surface`.
- **Approach (verified z-index):** today `Dialog.module.css` = `100`, `toastStack.module.css` = `1000`, `ShortcutOverlay` = `1200`, `CommandPalette` = `1200` (collision); **`ShellDialog` has no `.module.css` and no z-index — it is hand-built on DS `Surface`/`Button` with no focus-trap.** Re-layer all portaled surfaces on the new `--z-*` scale (modal dialog **above** toasts); mount portals inside / propagate the `--operator-*` scale scope; add `:focus-visible` to the palette; give `ShellDialog` the DS `Dialog`'s focus-trap/Escape/restore (or replace it with `Dialog`).
- **Validation:** typecheck/lint/test; manual keyboard + stacking check (dialog over toast); `tauri:visual:review`.
- **Premise check:** re-grep the four z-index values; confirm `ShellDialog` still imports `{ Button, Surface }` (no `Dialog`).
- **Status:** ☑ done — #128. Premise confirmed (Dialog 100 < toast 1000; palette == shortcut 1200; ColorPicker == toast 1000; ShellDialog hand-built on `Surface`, no focus-trap). Shipped (all non-visual at rest → **zero** baseline change, full Playwright green): (1) all 9 portaled `z-index` re-layered onto the S1 `--z-*` ladder (dialog 1100 **above** toast 1000; constrained-warning/review-badge dropped to overlay 100); (2) `ShellDialog` augmented with focus-trap + Escape + focus-restore (kept its `Surface` rendering per the operator decision — augment, not replace); (3) palette `:focus-visible` restored on the search input. **Deferred (see Rescope log):** the GLO-02/CHROME-03 **UI-scale-escape** fix — moving the `--operator-font-size-*` family to `:root` so portals inherit the operator scale regressed the **setup/protocol** surfaces (they render **outside `.root`** — exactly the CHROME-01/GLO-01 frame-bypass), suddenly inheriting operator tokens instead of their fallbacks. That interaction is entangled with **Slice 4** (which moves Setup/Startup inside the shared frame/scope), so the scale-escape is deferred to land after S4.

## Slice 3 — Global `[data-theme]` foundation

- **Goal:** Studio/Graphite/Bone become **app-wide**, not Audio-local; chrome + every surface follow one theme. **Closes Audio's Chrome theme-seam.**
- **Findings:** `THEME-01`, `CHROME-04`, `GLO-04`, `DES-02`, `LIG-01`, `LGS-03`, `PLA-02`, `STA-02`, `CHROME-07`/`GLO-08` (collapse the two parallel `--color-*` namespaces), `THEME-06` (baseline infra). (`LIG-01`/`LGS-03`/`PLA-02`/`STA-02` = each surface's "can't follow the theme" finding — they get the theme here; per-surface tuning lands in S14.)
- **Key files:** `frontend/packages/tokens/src/` (global `[data-theme]` blocks — currently **zero**), `OperatorShell.tsx` + `OperatorLayoutProvider.tsx` (lift the theme attribute + selection to the shell), `frontend/app/src/app/audio/AudioWorkspace.tsx` (re-point its `data-audio-theme` switcher to the global system).
- **Approach:** define global `[data-theme="graphite"]/["bone"]` token overrides (reuse Audio's verified oklch values); set the theme attribute at the shell root; migrate Audio's switcher to drive it; collapse the two chrome namespaces to one. Stand up **per-theme visual baselines** (fixes the byte-identical empty storybook frames). **Large — sub-slice if needed** (3a tokens+attribute+switcher; 3b chrome adopts; 3c Audio re-points → seam closes).
- **Validation:** new per-theme Playwright baselines per surface; AA contrast recompute in all three; `tauri:visual:review` per theme.
- **Premise check:** `rg "data-theme" frontend/packages/tokens/src/generated/tokens.css` (expect 0); confirm switcher still Audio-scoped (`data-audio-theme`).
- **Status:** ◐ sub-sliced — **3a ☑ #129**, **3b ☑ #130**, **3c WIP** (last sub-slice). **3c** (close the theme seam): `AudioWorkspace` now reads `theme`/`setTheme` from `useOperatorLayout()` (the global) instead of an audio-local state + `app.audio.theme` storage; `data-audio-theme={theme}` and the AudioTopBar switcher (`onSelectTheme={setTheme}`) drive the **global** `data-theme`, so flipping the theme anywhere re-themes the mixer in lockstep with the chrome — the dark-chrome/light-mixer seam is closed. `AudioTheme` ≡ `OperatorTheme` (same union). Non-visual at the studio default (audio still renders studio); the global theme now carries audio along. **3b** (CHROME-07/GLO-08 — collapse the two parallel text ramps): operator chose the **warm `brand-text-*` ramp canonical**; `text.strong/muted/subtle` now alias `brand.text.primary/secondary/muted` in `core.json` (so chrome + body share one identity), and the redundant `text-*` overrides were dropped from `themes.css` (they cascade from the canonical ramp). Body text on Planning/Setup/OperatorShell shifts cool→warm (accepted); AA holds/improves. **3a recap:** a derive→adversarial-AA-verify **workflow** (14 agents) produced Graphite (cool-neutral dark, green→teal accent) + Bone (light, green→AA-safe-dark-green, severity darkened) values for the core semantic palette — every foreground clears WCAG AA in both themes (2 auto-corrected). Applied as a hand-authored `frontend/packages/tokens/src/themes.css` (`:root[data-theme="graphite"|"bone"]` blocks; the Slice 1 `var(--base)` aliases cascade, so only base tokens are overridden); `data-theme` lifted to `<html>` via `OperatorLayoutProvider` (`?theme=`/localStorage, exposes `theme`/`setTheme`); 6 per-theme baselines added (setup/planning/lighting × graphite/bone). Studio unregressed by 3a (theme is opt-in). **Scope:** core families only — decorative stage/studio/glass + multi-hue brand + `--color-cct-*` keep Studio values (Bone-tuned in S14). **3c** (re-point Audio's `data-audio-theme` switcher to the global `data-theme` → closes the seam) follows as its own PR. a derive→adversarial-AA-verify **workflow** (14 agents) produced Graphite (cool-neutral dark, green→teal accent) + Bone (light, green→AA-safe-dark-green, severity darkened) values for the core semantic palette — every foreground clears WCAG AA in both themes (2 auto-corrected). Applied as a hand-authored `frontend/packages/tokens/src/themes.css` (`:root[data-theme="graphite"|"bone"]` blocks; the Slice 1 `var(--base)` aliases cascade, so only base tokens are overridden); `data-theme` lifted to `<html>` via `OperatorLayoutProvider` (`?theme=`/localStorage, exposes `theme`/`setTheme`); 6 per-theme baselines added (setup/planning/lighting × graphite/bone). Studio unregressed (theme is opt-in). **Scope:** core families only — decorative stage/studio/glass + multi-hue brand + `--color-cct-*` keep Studio values (Bone-tuned in S14). **3b** (collapse the two `--color-*` namespaces, CHROME-07/GLO-08) + **3c** (re-point Audio's `data-audio-theme` switcher to the global `data-theme` → closes the seam) follow as their own PRs.

## Slice 4 — Shell frame for Setup / Startup / Recovery

- **Goal:** the pre-ready + setup surfaces render **inside the shared frame** at full-bleed density — no centered gutter, no dead band.
- **Findings:** `CHROME-01`, `GLO-01`, `SET-02`, `SET-03`, `DENSITY-06`, `DENSITY-01`, `STA-04`, `STA-11`, `GLO-07` (wire or remove the dead `AppShellFrame` mainHeader/context-rail that `OperatorShell` computes but never renders), `GLO-09` (persistent latched-state chrome indicator).
- **Key files:** `OperatorShell.tsx:325/365/397` (the three `.setupShell`/`.setupCanvas` returns before `<AppShellFrame>`), `OperatorShell.module.css:253/267-268` (`.setupShell`, `.setupCanvas { width: min(1400px,100%) }`), `frontend/app/src/app/setup/*`, `…/startup/*`, DS `AppShellFrame`.
- **Approach:** route the three pre-ready states through `AppShellFrame` (or a shared wrapper); replace the centered `min(1400px)` column with the full-bleed grid; fill/design the dead band; surface the computed eyebrow/title/subtitle.
- **Validation:** Playwright baselines for `setup-ready`, `protocol-mismatch`, startup/recovery at all tiers + studio-preview.
- **Premise check:** confirm `OperatorShell.tsx` still early-returns `.setupShell` before `<AppShellFrame>`.
- **Status:** ☐

## Slice 5 — One shared footer / health-bar primitive

- **Goal:** a single footer/health-bar primitive that **matches Audio's quality**, adopted by Audio, Lighting, Planning, Setup. **Closes Audio's Chrome footer residue → Chrome 100.**
- **Findings:** `CHROME-02`.
- **Key files:** DS `HealthBar.tsx`, `frontend/app/src/app/audio/components/AudioHealthBar.*` (the gold reference — level the shared primitive **up** to it), Lighting/Planning/Setup footer hosts.
- **Approach:** extend the DS `HealthBar` to Audio's capability (telemetry slots, `Clock`/`Last sync`, density); migrate all four surfaces; **preserve Audio's footer testids** (`audio-footer-telemetry`, …).
- **Validation:** baselines for all four surfaces.
- **Premise check:** diff DS `HealthBar` vs `AudioHealthBar` features before extending.
- **Status:** ☐

## Slice 6 — Unified feedback + amber tone + copy cleanup

- **Goal:** one feedback presentation, an amber **attention** tier, operator-grade copy everywhere. High coherence-per-effort.
- **Findings:** `COPY-01`…`COPY-09`, `GLO-06`, `CHROME-08`, `SET-01`, `SET-04`, `SET-05`, `STA-05`, `STA-08`, `STA-09`, `STA-10`, `GLO-05`.
- **Key files:** `shared/toastContext.tsx` + DS `Toast` (add `attention` tone), per-surface feedback hosts, `OperatorShell.tsx` (enum→label formatter — reuse the existing `getFailureTitle`), `setup/*` (degraded-banner title from `asStatusTone`; backtick typo), `startup/*` (loading copy, severity badges).
- **Approach:** add a 4th `attention` (amber) tone to `ToastTone`/`FeedbackTone` + the three CSS tone maps; route leaked enums (`connected`/`idle`/`PROTOCOL_MISMATCH`/…) through a human-label formatter; derive the Setup degraded title from health tone; converge the three empty-state idioms on one designed, theme-correct pattern; delete the literal markdown backticks; align title/sentence case. **(Note: Audio's `ok` feedback tone is currently never emitted — keep its neutral treatment from Slice 0; its `info`-amber correctly carries attention, so do not neuter it.)**
- **Validation:** typecheck/lint/test; baselines where banners render; proofread copy.
- **Premise check:** confirm the leaked enums + the hardcoded `Degraded startup posture` title are still present.
- **Status:** ☐

## Slice 7 — Tabular-nums + focus rings + severity color (adopt)

- **Goal:** promote three Audio disciplines to every surface.
- **Findings:** `TOKENS-01`, `CONTROLS-04`/`PLA-04`/`SET-09`/`GLO-03`, `THEME-03`/`DES-06`/`PLA-05`/`PLA-12`/`STA-08`, `STA-03`/`SET-10`/`THEME-04` (disabled ≥3:1).
- **Key files:** a shared tabular-nums utility + focus mixin (DS or `global.css`), Lighting/Planning telemetry CSS, `StatusBadge`/`StatusBand`, Planning chips, Setup/Startup disabled buttons.
- **Approach:** ship one tabular-nums class + one `:focus-visible` mixin; adopt on every mono-telemetry + focusable element missing them (restore Planning's `outline:none` inputs); re-enable severity color now that S1 defined the tokens; replace disabled `opacity:0.55` with a token-backed full-alpha color clearing 3:1.
- **Validation:** baselines; contrast recompute on disabled + severity states in all themes.
- **Premise check:** `rg "tabular-nums" frontend/app/src/app/{lighting,planning}` (expect ~0) vs audio.
- **Status:** ☐

## Slice 8 — One control contract

- **Goal:** the same gesture means the same thing everywhere; every value control is keyboard-operable + type-able.
- **Findings:** `CONTROLS-01` (Cmd/Ctrl=fine, double-click=typed-entry — align shared `ScrubSlider` to Audio; fix Lighting's inverted modifiers), `CONTROLS-02`, `CONTROLS-03`/`PLA-*` (Planning keyboard reschedule; focusable board cards — front-end partial if it needs engine data), `CONTROLS-05`, `CONTROLS-06`, `CONTROLS-07`/`LIG-09`/`LGS-04`, `SET-07` (`aria-selected`), `DES-07`.
- **Key files:** DS `{ScrubSlider,ScrubLabel,SegmentedControl}.tsx`, Lighting inspector/toolbar controls, Planning task/board interaction.
- **Approach:** make shared scrub constants match Audio's contract; add typed-entry to Lighting controls; add keyboard operability to Planning's primary action; replace hand-built tab rows + native spinners with DS primitives.
- **Validation:** interaction tests; baselines; keyboard walk-through.
- **Premise check:** confirm the inverted modifier direction in Lighting's scrub vs Audio before flipping.
- **Status:** ☐

## Slice 9 — Lighting deep polish

- **Goal:** Lighting (63) reaches the bar.
- **Findings:** `DENSITY-04`/`LIG-02` (frame the stage to populated bounds — kill the floor void), `DENSITY-07`/`LIG-07` (rail empty band), `LGS-02` (retired multi-hue blue still load-bearing — **respect the palette law**; replace with sanctioned amber/neutral; verify on canvas + DMX monitor + compact strip), `LGS-05` (1.07:1 invisible grid → readable), `LGS-06`/`LGS-09` (position field chip; inspector no-scroll at 1920), `LIG-03` (legend degrade not destroy), `LIG-04`/`LIG-05`/`LGS-07`/`LGS-10` (glass/motion/px literals → tokens; orphan aria `LGS-08`; inline brand-green), `LIG-06` (dead `data-toolbar-primary` attrs), `DENSITY-05` (container queries).
- **Key files:** `frontend/app/src/app/lighting/**`.
- **Validation:** lighting baselines all tiers + studio-preview + all three themes.
- **Premise check:** `LGS-02` — confirm the retired blue is genuinely load-bearing and not already migrated; tread carefully re: the palette law.
- **Status:** ☐

## Slice 10 — Planning deep polish

- **Goal:** Planning (45) reaches the bar.
- **Findings:** `PLA-01`/`CHROME-05` (green canvas tint → coherent neutral, vs the near-neutral Audio/Lighting canvas), `DENSITY-03`/`PLA-03` (lane-height cap → fill), `PLA-06` (DS primitives), `PLA-07` (~90 px/duration literals → tokens), `DENSITY-09`/`PLA-09` (the `280px` magic column → token), `DENSITY-02`/`PLA-10` (container queries; no-scroll 1920), `PLA-11` (row hierarchy), `CONTROLS-03` (keyboard reschedule — see S8).
- **Key files:** `frontend/app/src/app/planning/PlanningWorkspace.tsx` (`defaultLaneHeight = 84` at `:339`, applied via `Math.min(defaultLaneHeight, …)` at `:346`), `PlanningWorkspace.module.css` (`grid-auto-rows: var(--planning-lane-height, 84px)` at `:807`; `280px minmax(0,1fr)` at `:765/:848/:1129`; a sibling grid already uses `minmax(72px,1fr)` at `:1109`). Expect to split the single 1-module CSS file.
- **Approach:** raise/remove the 84px cap (`minmax(84px,1fr)`-style fill, design the leftover band); tokenize the `280px` column + literals; add container queries; neutralize the canvas tint.
- **Validation:** planning baselines all tiers + themes.
- **Premise check:** confirm `defaultLaneHeight = 84` + the three `280px` grids still present.
- **Status:** ☐

## Slice 11 — Setup deep polish

- **Goal:** Setup (36) reaches the bar.
- **Findings:** `SET-06` (9 green rgba literals → tokens), `SET-11` (modal clip → scroll-within at 1080), `SET-12` (unify the two recovery surfaces' styling). (Frame → S4; copy → S6; tokens → S1; focus → S7; contrast → S7; control → S8.)
- **Key files:** `frontend/app/src/app/setup/*`, the `setupIncident*`/`setupShell`/`setupCanvas` rules in `OperatorShell.module.css`.
- **Validation:** setup + recovery baselines all tiers + themes.
- **Premise check:** confirm the 9 green literals still bypass tokens.
- **Status:** ☐

## Slice 12 — Startup / Recovery deep polish

- **Goal:** Startup/Recovery (34) reaches the bar.
- **Findings:** `STA-01` (replace the byte-identical empty storybook baselines with real ones — pairs with S3 infra), `STA-12` (loading-label emphasis/size token), `DENSITY-08`/`GLO-11` (drop the fixed 64px health-bar offset on surfaces with no health bar). (Theme → S3; contrast → S7; frame/dead-band → S4; copy → S6; token → S1.)
- **Key files:** `frontend/app/src/app/startup/*`, `setup/SetupRecoverySurface.tsx`, the storybook shell stories + visual specs.
- **Validation:** startup/recovery/protocol-mismatch baselines; assert the new baselines are non-empty.
- **Status:** ☐

## Slice 13 — Audio adopts shared scale/motion → literal 100

- **Goal:** retire Audio's last local literals now the shared layer exists.
- **Findings:** Audio Tokens residue (107 raw-px font literals → shared type-scale from S1; the two local easings → shared `--motion-easing-*`), `TOKENS-04`.
- **Key files:** `frontend/app/src/app/audio/**/*.module.css`.
- **Approach:** replace the 107 `font-size: Npx` literals with shared type-scale tokens (values identical → **zero visual change**); re-point `--easing`/`--easing-out` to the shared tokens.
- **Validation:** audio baselines must be **byte-identical** — any diff means a token value drifted from the literal it replaced.
- **Status:** ☐

## Slice 14 — Per-surface Graphite/Bone tuning + per-theme baselines

- **Goal:** every surface is deliberate in all three themes; regressions are caught.
- **Findings:** `THEME-05` (remaining dark-only literals everywhere), per-surface `[data-theme]` overrides, committed **per-theme baselines** for ≥1 fixture per surface.
- **Validation:** per-theme baselines for every surface; AA in all three; studio-preview crispness.
- **Status:** ☐

## Slice 15 — Round-2 runtime audit (needs the live shell)

- **Goal:** cover what a static pass can't see (the audit's completeness-critic list).
- **Scope:** hover/active/focus-visible/drag states; open command palette (empty=Recent / typed / no-match), `?` overlay, context menus (danger + viewport-edge flip), the three toast tones stacked; focus order + traps across stacked overlays; **reduced-motion for the rAF/canvas loops** (meters, signal canvas, arm countdown, stage-plot pan/zoom, fixture pulse — the CSS kill-switch does **not** stop JS animation); per-workspace **empty/degraded** fixtures; the dialog/overlay population (`PlanningProjectDetailOverlay`, `CreateFixtureDialog`, `DMXMonitorDialog`, `AudioNumberDialog`, `ColorPicker`, …); 1280×800 density + studio-preview fractional-scale crispness; iconography stroke-width/size across lucide + the two bespoke icon families.
- **Approach:** drive the live Tauri dev shell (or Playwright with explicit interaction); screenshot each state; commit a handful as new baselines. **This Slice spawns its own fix slices — run it like a second audit.**
- **Status:** ☐

---

## Coverage map (every finding → a Slice)

Auditable completeness. `LIG-*` = audit "Lighting — workspace shell" section; `LGS-*` = audit "Lighting — stage-plot" section. Refuted (not fixed): `LIG-08`, `STA-06`.

| Slice | Findings                                                                                                                                                                              |
| ----: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
|     0 | AUD-01, AUD-02, AUD-03                                                                                                                                                                |
|     1 | THEME-02, TOKENS-02, TOKENS-03, TOKENS-05, CHROME-06, DES-01, DES-03, DES-06, DES-08, DES-09, SET-08, STA-07, PLA-08, DENSITY-09/PLA-09, LGS-01 (+ define --z-\*, type-scale, motion) |
|     2 | DES-05, GLO-02, CHROME-03, GLO-03, DES-04, GLO-10                                                                                                                                     |
|     3 | THEME-01, CHROME-04, GLO-04, DES-02, LIG-01, LGS-03, PLA-02, STA-02, CHROME-07, GLO-08, THEME-06                                                                                      |
|     4 | CHROME-01, GLO-01, SET-02, SET-03, DENSITY-06, DENSITY-01, STA-04, STA-11, GLO-07, GLO-09                                                                                             |
|     5 | CHROME-02                                                                                                                                                                             |
|     6 | COPY-01, COPY-02, COPY-03, COPY-04, COPY-05, COPY-06, COPY-07, COPY-08, COPY-09, GLO-06, CHROME-08, SET-01, SET-04, SET-05, STA-05, STA-08, STA-09, STA-10, GLO-05                    |
|     7 | TOKENS-01, CONTROLS-04, PLA-04, SET-09, GLO-03, THEME-03, DES-06, PLA-05, PLA-12, STA-08, STA-03, SET-10, THEME-04                                                                    |
|     8 | CONTROLS-01, CONTROLS-02, CONTROLS-03, CONTROLS-05, CONTROLS-06, CONTROLS-07, LIG-09, LGS-04, SET-07, DES-07                                                                          |
|     9 | DENSITY-04, DENSITY-05, DENSITY-07, LIG-02, LIG-03, LIG-04, LIG-05, LIG-06, LIG-07, LIG-10, LGS-02, LGS-05, LGS-06, LGS-07, LGS-08, LGS-09, LGS-10                                    |
|    10 | PLA-01, CHROME-05, PLA-03, PLA-06, PLA-07, PLA-10, PLA-11, DENSITY-02, DENSITY-03                                                                                                     |
|    11 | SET-06, SET-11, SET-12                                                                                                                                                                |
|    12 | STA-01, STA-12, DENSITY-08, GLO-11                                                                                                                                                    |
|    13 | Audio Tokens residue (107 px + 2 easings), TOKENS-04                                                                                                                                  |
|    14 | THEME-05, per-surface [data-theme], per-theme baselines                                                                                                                               |
|    15 | Round-2 runtime gaps (new)                                                                                                                                                            |

> Cross-checked: all 9 `LIG` + 10 `LGS` + 12 `PLA` + 12 `SET` + 11 `STA` + 11 `GLO` + 9 `DES` + 3 `AUD` per-surface findings (minus refuted `LIG-08`, `STA-06`) and all 8 `CHROME` + 6 `THEME` + 9 `DENSITY` + 7 `CONTROLS` + 5 `TOKENS` + 9 `COPY` coherence findings are assigned. Many coherence IDs intentionally co-list with the per-surface IDs they generalize.

---

## Definition of done (program level)

- Every audit finding is **closed or consciously deferred** (deferral recorded in the Rescope log).
- Audio → Lighting → Planning → Setup → Startup is **seamless**: one theme, canvas language, chrome, control contract, feedback channel, density posture.
- **No-scroll holds at 2560×1440 and 1920×1080** on every surface; every surface is **AA-clean in all three themes** with committed per-theme baselines.
- Audio is a **literal 100** (shared-layer residue closed by S3/S5/S13).
- `npm run dev:check` green; operator-visible changes carry visual-review evidence; the round-2 runtime audit (S15) has run.

---

## Rescope log

When a Slice's premise proves wrong on inspection, renumber/rename the Slice heading and add a dated entry here describing what changed and why (the `scripts/check-slice-rescope.mjs` guard requires this file to carry such an entry once a `## Slice N` heading is edited). Keep entries short and append-only.

**Rescope:** 2026-06-06 — Genesis. Plan authored from `program-ux-audit-2026-06-05.md` and relocated into `docs/plans/` to adopt the team's sliced-plan convention + rescope guard (it began as a root-level draft). No Slice premises were changed; the audit's second-Lighting-section findings were renumbered `LIG-*` → `LGS-*` to remove an ID collision, and several claims were tightened after verifying against live code (title-xl undefined while siblings defined; `--size-controlHeight` casing bug; real z-index values; `defaultLaneHeight = 84`).

**Rescope:** 2026-06-06 — Slice 0 baseline refinement (not a work rescope; slice heading unchanged). The plan assumed AUD-01's EQ low-cut shade change would require regenerating the darwin `audio-populated-*` baselines. Verified against live code + the built fixture: the shade is in-frame (channel FX 3/4 selected, EQUALIZER graph in the inspector), but the stray-accent-outline → neutral-`--fg-3`-wash change falls under Playwright's `maxDiffPixels:100` tolerance — all 9 audio visual specs pass unchanged and `--update-snapshots` (Playwright 1.60, default `changed` mode) rewrote nothing. Slice 0's code is unchanged and correct; only the "regenerate baselines" sub-step proved to be a no-op. Recorded for an honest trail; future operator-visible slices should still expect real baseline diffs.

**Rescope:** 2026-06-06 — Slice 1 scope refinements (slice goal + heading unchanged). Two specifics surfaced during implementation: (1) **Not purely additive.** The plan framed S1 as token aliasing, but the camelCase refs `--size-controlHeight` (6 consumers) and `--color-surface-borderStrong` (5 consumers) **cannot** be emitted by style-dictionary (it kebab-cases every token name), so the only fix is correcting those consumers to `--size-control-height` / `--color-surface-border-strong`. S1 therefore also edits 6 component CSS modules. (2) **DES-03 partially deferred.** The orphan dual-pipeline files (`src/source/tokens.json` + `scripts/build-tokens.mjs`) are dead but their deletion is entangled with stale "source of truth" wording in `AGENTS.md`; and `tokenValues` cannot simply be repopulated (the SD-v5 custom format emits `{}`, and `validate-generated.mjs` requires `tokens.ts` to exist, so the stub must stay). Both are low-priority build hygiene independent of the additive token foundation, so DES-03's cleanup is deferred to a focused follow-up to keep S1's large baseline-diff review clean. The aliases themselves (the heart of DES-01/DES-03/DES-06/DES-09) landed in S1. Also: the plan's S1 "Key files" still lists the orphan `src/source/tokens.json`; the wired source is `src/tokens/core.json` (used here) — the DES-03 follow-up will reconcile the doc.

**Rescope:** 2026-06-06 — DES-03 closeout (the deferred follow-up from the entry above; slice headings unchanged). The orphan dual pipeline is now deleted — `frontend/packages/tokens/src/source/tokens.json` (divergent purple/IBM-Plex palette), its unwired reader `scripts/build-tokens.mjs`, and that reader's stale output `src/generated/token-docs.md` (a hand-written scaffold, never actually produced by the wired build). `npm run frontend:tokens:build` (style-dictionary on `core.json`) still emits a **byte-identical** `tokens.css`, confirming the orphan never fed the shipped output. The S1 "Key files" line + `AGENTS.md`'s "Token source of truth" bullet were corrected to name only `src/tokens/**`. **Correcting the prior entry's assumption:** `tokenValues` _was_ repopulated — the empty `{}` was not an SD-v5 limitation but a bug in the custom `sse/typescript-tokens` format, which read `token.value` while SD v5 runs this DTCG source with the value on `token.$value`; reading `$value` under `usesDtcg` now emits all 222 resolved tokens. `validate-generated.mjs` still only checks `generated/tokens.ts` exists, and it does (now populated). Build hygiene only; no consumer or runtime change.

**Rescope:** 2026-06-06 — Slice 2 defers the UI-scale-escape half of GLO-02/CHROME-03 (slice heading unchanged). The z-index re-layering (DES-05), `ShellDialog` focus-trap (DES-04), and palette `:focus-visible` (GLO-10) shipped clean (zero baseline change). The remaining GLO-02/CHROME-03 fix — making portaled overlays inherit the operator UI-scale — was attempted by moving the `--operator-font-size-*` family from `.root` to `:global(:root)` + mirroring the factor onto `document.documentElement`. It **regressed the `setup-ready` / `protocol-mismatch` surfaces** (text reflowed at 12 viewports, 10k–47k px): those two render **outside `.root`** (the very CHROME-01/GLO-01 frame-bypass), so promoting the tokens to `:root` made them resolve operator tokens they previously fell back on. The fix is therefore **entangled with Slice 4** (which routes Setup/Startup/Recovery through the shared frame and into the scale scope). Reverted both provider edits here; the scale-escape will land **after S4**, when setup/protocol live inside `.root` and the move is inert for them. Net Slice 2 = the three verified-clean overlay fixes.
