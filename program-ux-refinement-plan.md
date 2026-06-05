# SSE ExEd Studio Control — Program-Wide UI/UX Refinement Plan

> **Goal:** bring the whole operator console — Lighting, Planning, Setup, Startup/Recovery, the shared chrome, and the design system — up to the polish, coherence, and theme/keyboard/density discipline of the freshly-polished **Audio Console**, so the product feels and behaves like one ultra-premium, gold industry-standard tool end to end.

> **This document is a self-contained handoff.** It is written to be executed by a **fresh Claude Code session that has no memory of the audit conversation**. Everything you need to start is below. Do not assume prior context.

---

## 0. Start here (cold-start orientation)

**Read these three files first, in order:**

1. **`program-ux-audit-2026-06-05.md`** (repo root) — the evidence base. 77 verified findings with per-finding evidence, computed contrast, file paths, and presentation-only proposals, plus per-surface scorecards and a cross-surface coherence section. **This plan references findings by ID (e.g. `THEME-02`, `DENSITY-03`, `PLA-04`); the proposal + evidence for each ID lives in that audit doc.** Do not duplicate it — open it when you pick up a slice.
2. **`AGENTS.md`** (repo root) — the authoritative architecture boundary, hardware target, design-system rules, validation lanes, Visual Review Discipline, and the **Rescope protocol** (see §2 below — it is binding).
3. **This plan** — the execution sequence.

**Current repository state (as of 2026-06-05):**

- An **in-flight branch `claude/audio-console-100`** holds the substantive Audio fixes that close Audio's own residual findings: `AUD-01`, `AUD-02`, `AUD-03` (the undefined-inspector-class rendering bugs), the feedback `data-tone="ok"` neutral treatment, and a shared `AudioEmptyInspector` component (replaces 5 bare `h3/p` empty states). These are **validated** (eslint clean, app typecheck clean, Vitest 27/27) but **uncommitted**, and the darwin audio visual baselines have **not** yet been regenerated. **Slice 0 finalizes this.**
- The audit + this plan are untracked files in the same working tree.
- If you are in a clean checkout that lacks the above, recover it from the branch / regenerate from the audit; do not silently restart.

**Verify you are oriented** before touching anything: `git branch --show-current` and `git status`; skim the audit's Executive Summary + Surface Scorecards; confirm you can run `npm run frontend:typecheck` and `npm run lint`.

---

## 1. The gold standard (what "done" feels like)

The **Audio Console is the benchmark (92→100/100).** Every surface is measured against this rubric (full version in the audit). A surface is "gold" when:

1. **Correctness** — no undefined CSS classes, dead/mis-wired controls, or fallbacks resolving to `system-ui`.
2. **Color / contrast** — every real text/indicator clears WCAG AA in **all three themes** (Studio + Graphite dark, Bone light); severity is **color-encoded** (error→danger red, attention→amber, ok→neutral), not flattened.
3. **Ergonomics** — every continuous control has keyboard access; dangerous latched state has a persistent indicator + clear accelerator; context is co-located.
4. **Controls** — typed numeric entry (double-click/Enter→dialog), hover + drag affordances, one consistent control contract, visible focus rings.
5. **Layout / density** — **no scroll at 2560×1440 and 1920×1080**; dense, full-bleed, balanced; container-query responsive.
6. **DS coherence** — no hardcoded hex/px/font/duration literals; tabular-nums telemetry; shared primitives over one-offs; motion tokens.
7. **Cross-surface coherence** — header, tabs, monitor bar, rails, footer, empty/loading/error states, toasts, dialogs, palette behave identically everywhere; one canvas tint; one button vocabulary.
8. **States / copy** — designed empty/loading/degraded/error states; precise, typo-free, contradiction-free microcopy.

---

## 2. Non-negotiable constraints (read before every slice)

These are binding. A proposal that violates them is invalid — re-scope it, do not ship it.

- **Architecture boundary (AGENTS.md):** presentation-only. **No** state/persistence/device policy into React; **no** new engine/protocol/OSC data. If a fix needs engine data, it is out of scope — implement the front-end-only partial and note the limit.
- **No-scroll** at **2560×1440** (primary) and **1920×1080** (fallback). Any height-adding change risks regression — verify both tiers.
- **Three themes:** Studio + Graphite (dark), **Bone** (light). Every color change must hold in all three; Bone fails AA most often.
- **Token discipline:** extend tokens **additively** in the source (`frontend/packages/tokens/src/`), regenerate with `npm run frontend:tokens:build`; never hand-edit generated outputs; never bypass with one-off styling.
- **Settled design decisions:** the **retired multi-hue broadcast palette stays retired** — single warm amber accent + clip-only danger red is the law (do **not** reintroduce talkback-green / group-ochres / blue). Intentional **dead code** (`AudioRail.tsx`, `AudioToolbar.tsx`, `AudioPreampControl.tsx`, `AudioTargetPicker.tsx`) is neither styled nor mounted.
- **Preserve every `data-testid`;** update affected tests; never weaken an assertion to hide a regression.
- **Rescope protocol (binding — this team has been burned by silent rescopes):** if a slice's premise turns out wrong on inspection, do **not** silently substitute different work under the same slice number. Instead, in the same PR or a follow-up: (1) edit **this plan** to record the rescope reason, (2) re-number/rename the slice to match what landed, (3) open a follow-up item for the original goal (or drop it with rationale), (4) call out the rescope in the commit message. Verify each slice's premise against the live code before implementing — the audit's adversarial pass already corrected several candidates, but code drifts.

### Validation lanes (from `AGENTS.md` / `package.json`)

| When                        | Run                                                                                                                                                                                                                                                                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| After any change            | `npm run frontend:typecheck` · `npm run lint`                                                                                                                                                                                                                                                                                                |
| Logic/components            | `npm run frontend:test` (Vitest, run-mode — exits on its own)                                                                                                                                                                                                                                                                                |
| Token source changed        | `npm run frontend:tokens:build` then re-typecheck                                                                                                                                                                                                                                                                                            |
| **Operator-visible change** | `npm run frontend:playwright:test` (builds app + storybook, runs Playwright + visual baselines). Update intended baseline changes with the Playwright `--update-snapshots` flag in the `frontend/app` workspace. **darwin** baselines regenerate locally; **linux** baselines bootstrap from the first CI run's artifact (per repo history). |
| Layout/presentation         | `npm run tauri:visual:review` + inspect on the **Scaled Studio Preview** (2560×1440) or the fixed studio monitor                                                                                                                                                                                                                             |
| Full local gate before PR   | `npm run dev:check`                                                                                                                                                                                                                                                                                                                          |

**Per-slice rule:** run the smallest lane that covers the risk; for any operator-visible slice, regenerate + review the visual baselines and treat the diff as the review artifact. One slice ≈ one PR ≈ one session.

---

## 3. The four root causes (the spine of the plan)

Nearly every one of the 77 findings rolls up to one of four systemic gaps. **Fixing them at the shared layer is what makes the program cohere — patching each surface locally would just re-create the divergence.**

1. **Theming is trapped in Audio.** The Studio/Graphite/Bone system lives in `AudioWorkspace`'s private `--bg/--fg/--accent` namespace; global `tokens.css` is a single dark `:root` with **zero `[data-theme]` blocks**. Dark chrome frames a near-white Bone mixer; the "three themes" promise breaks at the Audio boundary.
2. **The token foundation is incomplete even in the one dark theme.** DS primitives read an **undefined** `--color-studio-*`/`--color-accent-*` namespace; Planning references undefined `--color-text-primary`/`--radius-xl`/`--font-size-xs`; `--operator-font-size-title-xl` is undefined with four literal fallbacks. Severity flattens, hierarchy collapses, the biggest headlines freeze out of UI-scale.
3. **Audio's premium disciplines were never promoted to the shared layer.** Full-bleed/full-height density, container-query densification, tabular-nums telemetry, bespoke focus rings, `role=slider` keyboard operability, and typed numeric entry all stop at the Audio edge.
4. **The chrome/feedback contract is fragmented.** Setup/Startup/Recovery bypass `AppShellFrame`; the footer is built three ways; portaled palette/toast/dialog escape UI-scale and collide on z-index; no amber attention tone; raw enums leak as copy; a degraded banner contradicts itself.

**Strategy:** build the shared foundation first (Phases A–B), unify the chrome and disciplines (Phases C–D), then adopt + deep-polish each surface (Phase E), and finally close Audio's shared-layer residue and tune every theme (Phase F). Round-2 runtime work is Phase G.

---

## 4. Execution sequence (dependency-ordered)

```
Phase A — Foundation            S0  finalize in-flight Audio fixes
                                S1  token namespace + scale + z-index + motion (define)
                                S2  overlay plumbing: z-index re-layer, UI-scale, focus-trap
Phase B — Global theming        S3  global [data-theme] foundation  (closes Audio theme-seam)
Phase C — Chrome unification    S4  shell frame for Setup/Startup/Recovery
                                S5  one shared footer/health-bar primitive (closes Audio footer)
                                S6  unified feedback channel + amber tone + copy/enum cleanup
Phase D — Shared disciplines    S7  tabular-nums + focus rings + severity color (adopt)
                                S8  one control contract (scrub/typed-entry/keyboard/segmented)
Phase E — Per-surface polish    S9  Lighting    S10 Planning    S11 Setup    S12 Startup/Recovery
Phase F — Closure + themes      S13 Audio adopts shared scale/motion → literal 100
                                S14 per-surface Graphite/Bone tuning + per-theme baselines
Phase G — Round 2 (runtime)     S15 interaction states, dialogs, reduced-motion, empty/degraded
```

**Hard dependencies:** S1 unblocks everything. S2 needs S1's `--z-*`/scale tokens. S3 needs S1 (tokens must exist before they can be themed). S4–S8 need S1 (+S3 for theming). S9–S12 adopt S1/S3/S7/S8. S13 needs S1/S3/S5. S14 needs S3 + all surface slices. Within a phase, slices are mostly independent and can reorder.

**The fast coherence win:** S1 + S3 + S6 alone close most of the visible "this is a different product" feeling. They are the priority.

---

## 5. The slices

> Each slice: **Goal · Root cause · Findings (see audit) · Key files · Approach · Validation · Done · Premise-check.** Open the audit doc for each finding's evidence + proposal. Verify the premise against live code first (Rescope protocol).

### Phase A — Foundation

#### S0 — Finalize the in-flight Audio fixes

- **Goal:** land the work already done on `claude/audio-console-100` so Audio's own residual bugs are closed and the branch is clean.
- **Findings:** `AUD-01`, `AUD-02`, `AUD-03` + the feedback-tone + empty-state work (already implemented, validated, uncommitted).
- **Approach:** review the diff; run `npm run frontend:typecheck` + `lint` + `frontend:test`; regenerate the **darwin** audio visual baselines (`audio-populated-*`) — the only operator-visible change is the EQ low-cut shade (now a neutral `--fg-3` wash instead of a stray accent outline); inspect on the Studio Preview; commit, push, open + merge the PR; let CI bootstrap the linux baselines.
- **Validation:** `npm run frontend:playwright:test` (+ `--update-snapshots` for the intended audio baseline change) · `npm run dev:check`.
- **Done:** branch merged to `main`; audio baselines regenerated; Audio Correctness + Copy residue closed.
- **Premise-check:** confirm the five changed components still typecheck/lint after rebase on latest `main`.

#### S1 — Token foundation: define the missing namespaces, scale, z-index, motion

- **Goal:** make the token layer **complete and shared** so severity color, hierarchy, headline scale, layering, and motion resolve everywhere — the single highest-leverage slice.
- **Root cause:** #2 (+ enables #1, #3).
- **Findings:** `THEME-02`, `TOKENS-02`, `TOKENS-03`, `TOKENS-05`, `CHROME-06`, `DES-01`, `DES-03`, `DES-06`, `DES-08`, `DES-09`, `SET-08`, `STA-07`, `PLA-08`, `DENSITY-09`/`PLA-09` (the duplicated `280px` magic number → token), `LIG-stage-01` (`#ff6b35` ring fallback), and the `--z-*`/type-scale/motion definitions that later slices consume (`DES-05` define-half, `TOKENS-01`/`TOKENS-04`/`AUD` residual prerequisites).
- **Key files:** `frontend/packages/tokens/src/source/tokens.json`, `frontend/packages/tokens/src/tokens/core.json`, generated `frontend/packages/tokens/src/generated/tokens.css` (via build), `frontend/packages/design-system/src/components/*.module.css` (consumers).
- **Approach:** **additively alias** the undefined namespaces onto existing real tokens — `--color-studio-*`, `--color-accent-*`, `--color-text-primary`, `--color-surface-raised`, `--size-controlHeight`, `--radius-xl`, `--font-size-xs`, success/warning/status roles. Define `--operator-font-size-title-xl: calc(34px * <ui-scale-factor>)` once on `.root`. Add a **shared type-scale** covering the micro-telemetry sizes (so S13 can retire Audio's 107 px literals and Planning/Lighting can tokenize). Add a **`--z-*` scale** (`--z-overlay/-dialog/-palette/-toast`). Enrich **motion** with the missing easings (promote Audio's two curves into shared `--motion-easing-*`). Fix the `Surface` primitive collapse (`DES-09`) and the empty `tokenValues` stub / dual pipeline (`DES-03`). Regenerate; do not hand-edit generated CSS.
- **Validation:** `frontend:tokens:build` → `frontend:typecheck` → `lint` → `frontend:test` → `frontend:playwright:test`. Visual baselines **will change** where undefined→defined restores rendering (severity color returns on `StatusBadge`/`StatusBand`/`MetricCard`, square corners round, headlines size) — review each diff as intended.
- **Done:** zero undefined token references app-wide (grep for the named vars returns only definitions + intended uses); DS primitives render with real severity color in the dark theme; `--z-*`/type-scale/motion tokens exist.
- **Premise-check:** confirm each "undefined" token is still undefined in live `tokens.css` before aliasing; some may have been added since the audit.

#### S2 — Overlay plumbing: z-index, UI-scale, focus

- **Goal:** the portaled chrome (palette, `?` overlay, toasts, dialog) layers correctly, scales with the operator, and traps focus.
- **Root cause:** #4.
- **Findings:** `DES-05` (re-layer onto `--z-*`; modal dialog currently renders **below** toasts), `GLO-02`/`CHROME-03` (palette/overlay/toast escape `--operator-*` UI-scale), `GLO-03` (palette has no focus ring), `DES-04`/`CHROME-03` (`ShellDialog` lacks focus-trap/Escape/restore; duplicate element id), `GLO-10` (palette ↔ shortcut overlay divergence).
- **Key files:** `frontend/app/src/app/shared/{paletteContext,toastContext,ShortcutOverlay,ShellDialog}.tsx` + `.module.css`, `frontend/app/src/app/OperatorLayoutProvider.tsx`, `frontend/packages/design-system/src/components/{CommandPalette,Toast,Dialog}.tsx`.
- **Approach:** re-layer all portaled surfaces on `--z-*`; mount portals inside (or propagate) the `--operator-*` scale scope; add `:focus-visible` to the palette; give `ShellDialog` the DS `Dialog`'s focus-trap/Escape/restore (or replace it with `Dialog`).
- **Validation:** typecheck/lint/test; manual keyboard + stacking check (open dialog over a toast); `tauri:visual:review`.
- **Done:** dialogs always above toasts; overlays honor 90/100/110/125 scale; palette + dialog keyboard-trap and restore focus.
- **Premise-check:** confirm the current z-index values (`ShellDialog` 30 < toast 1000; palette == shortcut) still hold.

### Phase B — Global theming

#### S3 — Global `[data-theme]` foundation

- **Goal:** Studio/Graphite/Bone become an **app-wide** theme, not an Audio-local one — chrome and every surface follow one operator theme selection. **This closes Audio's Chrome theme-seam (its theme half → 100).**
- **Root cause:** #1.
- **Findings:** `THEME-01`, `CHROME-04`, `GLO-04`, `DES-02`, `LIG-stage-03`, `PLA-02`, `STA-02`, `CHROME-07`/`GLO-08` (unify the two parallel `--color-*` namespaces), `THEME-06` (baseline infra).
- **Key files:** `frontend/packages/tokens/src/` (per-theme `[data-theme]` blocks at global scope), `frontend/app/src/app/OperatorShell.tsx` + `OperatorLayoutProvider.tsx` (lift the theme attribute + selection to the shell), `frontend/app/src/app/audio/AudioWorkspace.tsx` (re-point its local `data-audio-theme` to the global system).
- **Approach:** define global `[data-theme="graphite"]/["bone"]` token overrides (reuse Audio's verified oklch values as the reference); set the theme attribute at the shell root; migrate Audio's local switcher to drive the global attribute; collapse the two parallel chrome namespaces to one. **Large — sub-slice if needed:** 3a global tokens + attribute + switcher; 3b chrome adopts; 3c Audio re-points (seam closes). Stand up **per-theme visual baselines** here (fixes the byte-identical empty storybook frames, `THEME-06`/`STA-01`).
- **Validation:** new per-theme Playwright baselines per surface; AA contrast recompute in all three themes; `tauri:visual:review` in each theme.
- **Done:** flipping the operator theme re-themes chrome + every surface; no dark-chrome-on-light-body seam; one chrome color namespace.
- **Premise-check:** confirm `tokens.css` still has zero global `[data-theme]` blocks and the switcher is still Audio-scoped.

### Phase C — Chrome unification

#### S4 — Shell frame for Setup / Startup / Recovery

- **Goal:** the pre-ready + setup surfaces render **inside the shared frame** (crest, tabs, monitor bar) with full-bleed density — kill the centered-gutter column and the dead band.
- **Root cause:** #4 (+ #3 density).
- **Findings:** `CHROME-01`, `GLO-01`, `SET-02`, `SET-03`, `DENSITY-06`, `DENSITY-01`, `STA-04`, `STA-11`, `GLO-07` (wire or remove the dead `AppShellFrame` mainHeader/context rail that `OperatorShell` computes but never renders), `GLO-09` (persistent at-a-glance latched-state indicator in chrome).
- **Key files:** `frontend/app/src/app/OperatorShell.tsx` (the `.setupShell`/`.setupCanvas` branch that returns before `<AppShellFrame>`), `frontend/app/src/app/setup/*`, `frontend/app/src/app/startup/*`, `frontend/packages/design-system/src/components/AppShellFrame.tsx`.
- **Approach:** route Setup/Startup/Recovery through `AppShellFrame` (or a shared frame wrapper); replace the centered `min(1400px)` column with the full-bleed grid; fill or design the ~600px dead band; surface the computed eyebrow/title/subtitle.
- **Validation:** Playwright baselines for `setup-ready`, `protocol-mismatch`, startup/recovery at all tiers + studio-preview.
- **Done:** Setup/Startup feel like the same product as the workspaces; no centered gutter; no-scroll holds.
- **Premise-check:** confirm the `OperatorShell` early-return branch still bypasses `AppShellFrame`.

#### S5 — One shared footer / health-bar primitive

- **Goal:** a single footer/health-bar primitive that **matches Audio's bespoke quality**, adopted by Audio, Lighting, Planning, Setup. **Closes Audio's Chrome footer residue (Chrome → 100).**
- **Root cause:** #4.
- **Findings:** `CHROME-02`.
- **Key files:** `frontend/packages/design-system/src/components/HealthBar.tsx`, `frontend/app/src/app/audio/components/AudioHealthBar.*` (the gold reference — level the shared primitive **up** to this; do not downgrade Audio), Lighting/Planning/Setup footer hosts.
- **Approach:** extract the shared primitive from Audio's `AudioHealthBar` capabilities (telemetry slots, `Clock`/`Last sync`, density); migrate all four surfaces; **preserve Audio's footer testids** (`audio-footer-telemetry`, etc.).
- **Validation:** baselines for all four surfaces.
- **Done:** one footer implementation; Audio loses no telemetry; Planning/Setup gain a real health bar.
- **Premise-check:** confirm DS `HealthBar` still lacks the Audio telemetry features before extending it.

#### S6 — Unified feedback channel + amber tone + copy cleanup

- **Goal:** one feedback presentation, an amber **attention** tier, and operator-grade copy everywhere. Mostly S-effort, very high coherence-per-effort.
- **Root cause:** #4 (+ #8 copy).
- **Findings:** `COPY-01`, `COPY-02`, `COPY-03`, `COPY-04`, `COPY-05`, `COPY-06`, `COPY-07`, `COPY-08`, `COPY-09`, `GLO-06`, `CHROME-08`, `SET-01`, `SET-04`, `SET-05`, `STA-05`, `STA-08`, `STA-09`, `STA-10`, `GLO-05`.
- **Key files:** `frontend/app/src/app/shared/toastContext.tsx` + `Toast` (add `attention` tone), the per-surface feedback hosts, `OperatorShell.tsx` (enum→label formatter — reuse `getFailureTitle`), `frontend/app/src/app/setup/*` (degraded banner title from health tone; backtick typo), `frontend/app/src/app/startup/*` (loading copy, severity badges).
- **Approach:** add a 4th `attention` (amber) tone to `ToastTone`/`FeedbackTone` + the three CSS tone maps; route the leaked enums (`connected`/`idle`/`PROTOCOL_MISMATCH`/...) through a human-label formatter; derive the Setup degraded title from `asStatusTone`; converge the three empty-state idioms on one (the shared `AudioEmptyInspector`-style designed empty state, theme-correct); delete the literal markdown backticks; align title/sentence case.
- **Validation:** typecheck/lint/test; baselines where banners render; copy proofread.
- **Done:** one `info` looks the same everywhere; amber attention exists; no enum/typo/contradiction reaches the operator.
- **Premise-check:** confirm the leaked enums + the hardcoded `Degraded startup posture` title are still present.

### Phase D — Shared disciplines

#### S7 — Tabular-nums + focus rings + severity color (adopt)

- **Goal:** promote three Audio disciplines to every surface.
- **Root cause:** #3 (+ #2 severity).
- **Findings:** `TOKENS-01` (tabular-nums utility → Lighting/Planning telemetry), `CONTROLS-04`/`PLA-04`/`SET-09`/`GLO-03` (focus-ring mixin → Planning/Setup; restore Planning's `outline:none` inputs), `THEME-03`/`DES-06`/`PLA-05`/`PLA-12`/`STA-08` (severity color-encoding on shared status primitives + per-surface chips), `STA-03`/`SET-10`/`THEME-04` (disabled-state contrast ≥3:1 — drop the `opacity:0.55` multiplier).
- **Key files:** a shared `tabular-nums` utility + focus mixin (DS or `global.css`), Lighting/Planning telemetry CSS, `StatusBadge`/`StatusBand`, Planning metric chips, Setup/Startup disabled buttons.
- **Approach:** ship one tabular-nums class and one `:focus-visible` mixin; adopt on every mono-telemetry + focusable element that lacks them; restore severity color now that S1 defined the tokens; replace disabled opacity with a token-backed full-alpha color clearing 3:1.
- **Validation:** baselines; contrast recompute on disabled + severity states in all themes.
- **Done:** digit columns stop jittering; every focusable shows a ring; Slipped≠On-time; no sub-3:1 disabled text.
- **Premise-check:** confirm Audio's tabular-nums count vs Lighting/Planning's zero still holds.

#### S8 — One control contract

- **Goal:** the same gesture means the same thing on every surface; every value control is keyboard-operable and type-able.
- **Root cause:** #3.
- **Findings:** `CONTROLS-01` (Cmd/Ctrl=fine, double-click=free-for-typed-entry — align the shared `ScrubSlider` to Audio; fix Lighting's inverted modifiers), `CONTROLS-02` (typed numeric entry on Lighting level/position), `CONTROLS-03`/`PLA-*` (Planning keyboard reschedule/reorder; focusable board cards — front-end-only partial if it needs engine data), `CONTROLS-05` (reuse DS `SegmentedControl`), `CONTROLS-06` (keyboard nudge on `ScrubLabel`), `CONTROLS-07`/`LIG-core-09`/`LIG-stage-04` (kill native spinners; custom `<select>` chevrons), `SET-07` (`aria-selected` on the step tablist), `DES-07` (align the four status-primitive vocabularies).
- **Key files:** `frontend/packages/design-system/src/components/{ScrubSlider,ScrubLabel,SegmentedControl}.tsx`, Lighting inspector/toolbar controls, Planning task/board interaction.
- **Approach:** make the shared scrub constants match Audio's contract; add the typed-entry dialog path to Lighting controls; add keyboard operability to Planning's primary action; replace hand-built tab rows + native spinners with DS primitives.
- **Validation:** interaction tests; baselines; keyboard walk-through.
- **Done:** muscle memory transfers Audio↔Lighting↔Planning; no mouse-only primary action.
- **Premise-check:** verify the inverted modifier direction in Lighting's scrub vs Audio before flipping.

### Phase E — Per-surface deep polish

> Each surface adopts the shared layer (S1/S3/S5/S7/S8) and then fixes its remaining surface-specific findings. Lighting 63 · Planning 45 · Setup 36 · Startup 34 → toward Audio's bar.

#### S9 — Lighting deep polish

- **Findings:** `DENSITY-04`/`LIG-stage` (stage frames to populated bounds — kill the floor void), `DENSITY-07`/`LIG-core` (rail empty band), `LIG-stage-02` (retired blue still load-bearing — **respect the retired-palette law**; replace with the sanctioned amber/neutral, verify on canvas + DMX monitor + compact strip), `LIG-stage-05` (invisible 1.07:1 grid → readable), `LIG-stage-06`/`LIG-stage-09` (position field chip + inspector no-scroll at 1920), `LIG-core-03` (legend degrade not destroy), `LIG-core-04/05/07/10`/`LIG-stage-07/08/10` (glass/motion/px literals → tokens; orphan aria; inline brand-green), `LIG-core-06` (dead `data-toolbar-primary` attrs), `DENSITY-05` (container queries).
- **Key files:** `frontend/app/src/app/lighting/**`.
- **Validation:** lighting baselines all tiers + studio-preview + all three themes.
- **Premise-check:** `LIG-stage-02` (retired blue) — confirm it is genuinely load-bearing and not already migrated; tread carefully re: the palette law.

#### S10 — Planning deep polish

- **Findings:** `PLA-01` (green canvas tint → coherent neutral), `DENSITY-03`/`PLA-03` (84px lane-cap → `minmax(84px,1fr)` fill; design the leftover band), `PLA-06` (hand-built toggles/filters/chips/empty → DS primitives), `PLA-07` (~90 px/duration literals → tokens), `DENSITY-09`/`PLA-09` (the `280px` magic column → token), `DENSITY-02`/`PLA-10` (container queries; wrap-prone toolbar; no-scroll 1920), `PLA-11` (row hierarchy/gridlines), `CONTROLS-03` (keyboard reschedule — see S8).
- **Key files:** `frontend/app/src/app/planning/**` (only one `.module.css` today — expect to split it).
- **Validation:** planning baselines all tiers + themes.
- **Premise-check:** confirm the `Math.min(84, …)` lane compressor + the duplicated `280px` are still present.

#### S11 — Setup deep polish

- **Findings:** `SET-06` (9 green rgba literals → tokens), `SET-11` (modal clip → scroll-within at 1080), `SET-12` (unify the two recovery surfaces' styling system). (Frame → S4; copy → S6; tokens → S1; focus → S7; contrast → S7; control → S8.)
- **Key files:** `frontend/app/src/app/setup/**`, the `setupIncident*`/`setupShell`/`setupCanvas` rules in `OperatorShell.module.css`.
- **Validation:** setup + recovery baselines all tiers + themes.

#### S12 — Startup / Recovery deep polish

- **Findings:** `STA-01` (replace the byte-identical empty storybook baselines with real ones — pairs with S3's per-theme infra), `STA-12` (loading label emphasis/size token), `DENSITY-08`/`GLO-11` (drop the fixed 64px health-bar offset on surfaces with no health bar). (Theme → S3; contrast → S7; frame/dead-band → S4; copy → S6; token → S1.)
- **Key files:** `frontend/app/src/app/startup/**`, `frontend/app/src/app/setup/SetupRecoverySurface.tsx`, the storybook shell stories + visual specs.
- **Validation:** startup/recovery/protocol-mismatch baselines; confirm the new baselines are non-empty and assert real content.

### Phase F — Closure + theme tuning

#### S13 — Audio adopts the shared scale/motion → literal 100

- **Goal:** retire Audio's last local literals now that the shared layer exists; Audio reaches a literal 100.
- **Findings:** Audio Tokens residue (107 raw-px font literals → shared type-scale from S1; the two local easings → shared `--motion-easing-*` from S1), `TOKENS-04` (Audio motion).
- **Key files:** `frontend/app/src/app/audio/**/*.module.css`.
- **Approach:** replace the 107 `font-size: Npx` literals with the shared type-scale tokens (values identical → **zero visual change**, verify against baselines); re-point `--easing`/`--easing-out` to the shared tokens.
- **Validation:** audio baselines must be **byte-identical** (this is a pure-hygiene migration) — any diff means a token value drifted from the literal it replaced.
- **Done:** zero raw px font-size literals + zero local easing literals in audio CSS; baselines unchanged.

#### S14 — Per-surface Graphite/Bone tuning + per-theme baselines

- **Goal:** every surface looks deliberate in all three themes; regressions are caught.
- **Findings:** `THEME-05` (kill remaining dark-only literals everywhere), per-surface `[data-theme]` overrides, and committed **per-theme visual baselines** for at least one fixture per surface (closes `THEME-06`/the round-2 theme-parity gap).
- **Validation:** per-theme baselines for every surface; AA contrast pass in all three; studio-preview crispness check.
- **Done:** flip to Bone or Graphite on any surface → AA-clean, intentional, baselined.

### Phase G — Round 2 (runtime — needs the live shell)

#### S15 — Runtime interaction & states audit

- **Goal:** cover what a static pass can't see (the completeness critic's list).
- **Scope:** hover/active/focus-visible/drag states; open command palette (empty=Recent / typed / no-match), `?` overlay (default/filtered/empty), context menus (incl. danger + viewport-edge flip), the three toast tones stacked; keyboard focus order + traps across stacked overlays; **reduced-motion for the rAF/canvas loops** (meters, signal canvas, arm countdown, stage-plot pan/zoom, fixture pulse — the CSS kill-switch does **not** stop JS animation); per-workspace **empty/degraded** fixtures (zero-fixture Lighting, zero-project Planning, zero-snapshot Audio, OSC-down Audio, bridge-banner Lighting); the dialog/overlay population (`PlanningProjectDetailOverlay`, `CreateFixtureDialog`, `DMXMonitorDialog`, `AudioNumberDialog`, the `ColorPicker`, …); 1280×800 density + studio-preview fractional-scale crispness; iconography stroke-width/size consistency across lucide + the two bespoke icon families.
- **Approach:** drive the live Tauri dev shell (or Playwright with explicit interaction); screenshot each state; commit a handful as new baselines. This phase will spawn its own fix slices — treat it as a second audit, run it like the first.

---

## 6. Coverage map (every finding → a slice)

> Auditable completeness. `LIG-core-*` = the audit's first Lighting section (workspace shell); `LIG-stage-*` = the second (stage/inspector). Update this table as slices land or rescope.

| Slice   | Findings covered                                                                                                                                                                          |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S0**  | AUD-01, AUD-02, AUD-03 (+ tone/empty-state already done)                                                                                                                                  |
| **S1**  | THEME-02, TOKENS-02, TOKENS-03, TOKENS-05, CHROME-06, DES-01, DES-03, DES-06, DES-08, DES-09, SET-08, STA-07, PLA-08, DENSITY-09/PLA-09, LIG-stage-01, + define `--z-*`/type-scale/motion |
| **S2**  | DES-05, GLO-02, CHROME-03, GLO-03, DES-04, GLO-10                                                                                                                                         |
| **S3**  | THEME-01, CHROME-04, GLO-04, DES-02, LIG-stage-03, PLA-02, STA-02, CHROME-07, GLO-08, THEME-06                                                                                            |
| **S4**  | CHROME-01, GLO-01, SET-02, SET-03, DENSITY-06, DENSITY-01, STA-04, STA-11, GLO-07, GLO-09                                                                                                 |
| **S5**  | CHROME-02                                                                                                                                                                                 |
| **S6**  | COPY-01..09, GLO-06, CHROME-08, SET-01, SET-04, SET-05, STA-05, STA-08, STA-09, STA-10, GLO-05                                                                                            |
| **S7**  | TOKENS-01, CONTROLS-04, PLA-04, SET-09, THEME-03, DES-06(adopt), PLA-05, PLA-12, STA-08(severity), STA-03, SET-10, THEME-04, PLA-11                                                       |
| **S8**  | CONTROLS-01, CONTROLS-02, CONTROLS-03, CONTROLS-05, CONTROLS-06, CONTROLS-07, LIG-core-09, LIG-stage-04, SET-07, DES-07                                                                   |
| **S9**  | DENSITY-04, DENSITY-07, DENSITY-05, LIG-core-02/03/04/05/06/07/10, LIG-stage-02/05/06/07/08/09/10                                                                                         |
| **S10** | PLA-01, PLA-03, PLA-06, PLA-07, PLA-10, PLA-11, DENSITY-02, DENSITY-03                                                                                                                    |
| **S11** | SET-06, SET-11, SET-12                                                                                                                                                                    |
| **S12** | STA-01, STA-12, DENSITY-08, GLO-11                                                                                                                                                        |
| **S13** | Audio Tokens residue (107 px + 2 easings), TOKENS-04                                                                                                                                      |
| **S14** | THEME-05, per-surface `[data-theme]`, per-theme baselines                                                                                                                                 |
| **S15** | Round-2 runtime coverage gaps (new)                                                                                                                                                       |

---

## 7. Definition of done (program level)

The refinement is complete when:

- Every finding in the audit is **closed or consciously deferred** (with rationale recorded in this plan).
- Switching Audio → Lighting → Planning → Setup → Startup is **seamless**: one theme, one canvas language, one chrome, one control contract, one feedback channel, one density posture.
- **No-scroll holds at 2560×1440 and 1920×1080** on every surface; every surface is **AA-clean in all three themes**, with committed per-theme baselines.
- Audio is a **literal 100** (its shared-layer residue closed by S3/S5/S13).
- `npm run dev:check` is green; operator-visible changes carry visual-review evidence; the round-2 runtime audit (S15) has run.

---

_Source of evidence: `program-ux-audit-2026-06-05.md`. Authoritative process + constraints: `AGENTS.md`. Keep this plan a living document — update the coverage map and slice status as work lands, and follow the Rescope protocol whenever a premise proves wrong on inspection._
