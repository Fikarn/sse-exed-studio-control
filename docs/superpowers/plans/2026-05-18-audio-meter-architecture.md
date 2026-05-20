# Audio Page UI — Performance & Architecture Review

> **Status:** Investigation + independent audit pass complete. No code touched. Per user confirmation:
>
> - **Scope of this deliverable:** review only — implementation is a separate session.
> - **Backend scope when we implement:** Rust + protocol changes confirmed in-scope.
> - **Visual direction when we implement:** LED-segment look confirmed.
>
> **Audit pass corrections applied:** RME Fireface UFX III (not Behringer); PPM taxonomy split into Type I/IIa/IIb with distinct ballistics; `AudioSignalCanvas` is CSS-variable-driven (not HTML5 canvas); `meterTone()` is actually called in `AudioStereoMeter` (not `AudioMixerLane`); default preset renamed to "Digital Peak (DAW-style)" with self-consistent attack/release; added single global RAF scheduler, `dtMs`-driven decay, `devicePixelRatio` handling, `IntersectionObserver` pause, ARIA `role="meter"` mirrors; Phase 1 split into 1a (ship-today hotfix) + 1b (protocol/store rebuild); snapshot-bank pulse decoupling moved into Phase 1b explicitly.
>
> This document is a complete performance review of the current audio page UI with a re-imagined meter architecture grounded in professional DAW and broadcast practice (BBC/EBU/DIN PPM per IEC 60268-10/18, ITU-R BS.1770 / EBU R128, Bob Katz K-system).

---

## How to use this document (read first if you are the implementing Claude session)

You are picking this up in a fresh session. The conversation that produced it is not in your context. This section gives you everything you need to start.

### Who, what, where

- **Repo:** `/Users/EdvinLandvik/Projects/EdvinProjectManagerCodex` (you will most likely be in a worktree under `.claude/worktrees/`).
- **User profile:** non-engineer product owner. "Take the lead" means make the call on small choices, but invasive operations (force-pushes, release-evidence cycles, system installs) require explicit per-invocation go-ahead. (See `feedback_explicit_goahead_for_invasive_ops.md` in memory.)
- **Stack:** Tauri 2.x + Rust engine + React 18 + TypeScript + custom `ShellStore` (`useSyncExternalStore`). CSS Modules. Vitest + Playwright. No Tailwind, no Redux/Zustand.
- **The product:** an operator-facing control surface for an RME Fireface UFX III audio interface (driven via OSC through RME TotalMix FX), plus a lighting workspace. The audio page is what this plan is about.
- **Read these before doing anything:**
  1. [AGENTS.md](AGENTS.md) — the agent/workflow source of truth (CLAUDE.md defers to it).
  2. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — layer ownership, refactor rules.
  3. [docs/redesign/audio.md](docs/redesign/audio.md) — the audio-page mental model (RME TotalMix submix view; "select an output, then adjust sources").
  4. [native/protocol/v1.md](native/protocol/v1.md) — the JSON-over-stdio protocol you will be extending.
  5. The user's memory file at `/Users/EdvinLandvik/.claude/projects/-Users-EdvinLandvik-Projects-EdvinProjectManagerCodex/memory/MEMORY.md` and its referenced child files — these are auto-loaded into your context.

### Critical workflow rules (do not skip — these are load-bearing)

- **Auto-revert generated artifacts after every build.** `tauri/gen/schemas` and `tokens.css` regenerate on build; always revert before staging. See `feedback_auto_revert_generated_artifacts.md`.
- **GitHub Actions CI is intentionally unpaid.** Treat red CI as baseline noise; the verification surface is the local lanes below. See `project_local_only_ci.md`.
- **Local validation lanes** (run these before reporting a task done):
  - `npm run dev:check` — typecheck + lint + unit tests
  - `npm run native:acceptance` — Rust engine tests (118 engine + 6 shell baseline, lighting subset 27, audio subset to be added by this work)
  - `npm run tauri:smoke:win` — Windows-Claude target-host validation (separate Windows session)
- **Windows-Claude validates branches on a separate target-host session.** Do not block on Windows verification yourself; coordinate with the user. See `windows_target_host_validation.md`.
- **WIP commit over stash for safety snapshots.** Before any destructive op, use a named `wip/...` branch with a real commit, not `git stash -u`. See `feedback_wip_commit_over_stash.md`.
- **Never `--no-verify` a commit.** If a pre-commit hook fails, fix the underlying issue. If a hook fires unexpectedly and you cannot diagnose, ask the user.
- **Visual review** runs on BetterDisplay 2560×1440: `npm run tauri:visual:review -- --fixtures=audio-ready-overview,audio-state-assumed,audio-selected-channel,audio-1920-fallback --sizes=2560x1440,1920x1080 --port=4174`

### Order of execution

1. **Read this entire document end-to-end first.** It is ~600 lines but every section matters; the appendices contain skeleton code you will need.
2. Skim the source files cited in Part 5 to ground yourself in the actual current state.
3. **Default to Phase 1a only** unless the user has explicitly asked for more — Phase 1a is the ship-today hotfix and is the safest single PR.
4. Each phase below has its own "Acceptance criteria" + "Commands to run" + "Pitfalls" sub-block. Do not declare a phase done unless every criterion passes.
5. When in doubt, ask the user — short clarifying questions beat assumptions.

### What this document is _not_

- It is not a literal implementation; it is a directed plan. You are still expected to think, read the code, and make judgment calls.
- It is not a green light to do all four phases in one PR. Each phase ships independently; phases ≥ 2 require an explicit user go-ahead.
- It is not a substitute for visual review. Even when tests pass, the human eye is the final judge of "premium feel."

---

## Context

The audio workspace ([frontend/app/src/app/audio/](frontend/app/src/app/audio/)) is the operator's mixing surface for a Tauri desktop control app that drives an RME Fireface UFX III interface over OSC (via RME TotalMix FX). It already ships with structured snapshot updates, professional-feeling fader curves, and Rust-side ballistics. But the meter pipeline contains correctness bugs, perceptible lag, and architectural choices that won't scale to the "ultra premium" bar the user is calling out.

The user has explicitly asked us to **think freely** and "re-imagine the meter architecture" against professional DAW and broadcast standards. Findings below are concrete and reference real code; the redesign that follows is opinionated and grounded in the established standards (BBC PPM, IEC 60268-18, ITU-R BS.1770 / EBU R128, Bob Katz K-system) plus what shipping DAWs actually do.

The review covers the full audio page, but with the depth focused on the meters as requested.

---

## Part 1 — Audit (what's actually there today)

### A. Current architecture in one diagram

```
Rust thread (main.rs:59)        Frontend (createShellStore.ts:295)
─────────────────────           ────────────────────────────────
every 83 ms ──► emit             on "audio.changed"
"audio.changed" (no payload)  ──►  → request("audio.snapshot")
                                    → coerce<AudioSnapshot>
                                    → setState({ ...state, audioSnapshot })
                                    → notify all subscribers
                                    → buildAudioViewModel (re-derives EVERYTHING)
                                    → re-render mixer + inspector
                                    → AudioStereoMeter sets CSS vars
                                    → browser animates clip-path 120 ms
```

### B. Critical findings, severity-ordered

#### B1. **Every metering tick refetches the entire AudioSnapshot** _(highest impact)_

[frontend/packages/engine-client/src/store/createShellStore.ts:346-348](frontend/packages/engine-client/src/store/createShellStore.ts:346)

```ts
if (event.event === "audio.changed" && payload?.reason === "metering-tick") {
  void refreshAudioSnapshot(event.event);
}
```

`refreshAudioSnapshot` issues an `audio.snapshot` request that returns **every** channel's gain/fader/EQ/dynamics/sends/mix levels plus every mix target and the snapshot bank — when only L/R levels, peak holds, and clip flags actually changed. It then calls `setState({ ...state, audioSnapshot })` which replaces the snapshot reference, invalidating every memo keyed on it. Result: at the 12 Hz tick rate, the entire audio view model is rebuilt and the entire mixer tree reconciles ~12 times per second, even though only the meters have new data.

This is the single biggest performance leak on the page and the reason commit `a85e4d6` had to add language about "preventing command palette churn during metering ticks" — the symptom was leaking through to _other_ surfaces.

#### B2. **12 Hz tick rate is below the floor for transient-accurate metering**

[native/rust-engine/src/main.rs:61](native/rust-engine/src/main.rs:61) — `thread::sleep(Duration::from_millis(83))`

83 ms per tick → ~12 Hz. Reference points:

- BBC PPM has a 10 ms integration time; a transient that's audible at 10 ms can be entirely between two 83 ms ticks.
- Pro Tools sample-peak meters update at the host's frame rate (typically 30+ Hz).
- A premium meter for live mixing typically aims for **display refresh rate** (60 Hz on standard monitors, 120 Hz on better ones), with frontend interpolation between samples if the source rate is lower.

Even if we keep server-side at 30 Hz (33 ms) we should drive the visual at 60 Hz via RAF.

#### B3. **Double smoothing flattens the signal**

- Rust side ([audio_backend.rs:632-656](native/rust-engine/src/audio_backend.rs:632)) applies a 6-tap weighted average over 480 ms (VU-like body).
- CSS side ([AudioWorkspace.module.css:1652-1685](frontend/app/src/app/audio/AudioWorkspace.module.css:1652)) applies a 120 ms cubic-bezier transition on `clip-path`.

Stacking a 480 ms windowed average under a 120 ms easing makes the meter feel slow and look like it's "gliding" rather than reacting. Premium meters use _hard rise, soft fall_: the bar should snap up on a peak and fall slowly. CSS transitions do the opposite of this when prop changes arrive faster than the transition completes — you see the interpolation, not the signal.

#### B4. **Meter gradient color stops are visually misaligned with the dB thresholds defined in JS** _(correctness bug)_

[frontend/app/src/app/audio/AudioWorkspace.module.css:1659-1664](frontend/app/src/app/audio/AudioWorkspace.module.css:1659)

```css
background: linear-gradient(
  180deg,
  var(--audio-meter-hot) 0 10%,
  /* orange, top 10% of bar */ var(--audio-meter-warn) 10% 20%,
  /* yellow, next 10% */ var(--audio-meter-low-hot) 20% 100% /* green, bottom 80% */
);
```

vs the dB thresholds in [audioFormatting.ts:16-17](frontend/app/src/app/audio/audioFormatting.ts:16):

```ts
const METER_AMBER_DBFS = -12;
const METER_RED_DBFS = -1;
```

The fill is a `0..1 linear → 0..100% bar` mapping ([audioFormatting.ts:55-58](frontend/app/src/app/audio/audioFormatting.ts:55)). So:

| Bar position | dBFS | Expected zone (per JS thresholds) | Actual gradient color |
| ------------ | ---- | --------------------------------- | --------------------- |
| 100% (top)   | 0    | RED (≥ -1)                        | orange                |
| 90%          | -6   | RED (≥ -1)                        | orange                |
| 80%          | -12  | AMBER (≥ -12)                     | green                 |
| 20%          | -48  | GREEN                             | yellow                |
| 10%          | -54  | GREEN                             | orange                |

The gradient paints **warm colors at the bottom of the bar where signals are quietest** and green across most of the useful headroom range. This is visually backwards from a professional meter and contradicts the `meterTone()` classification used for the border tint.

#### B5. **Scale labels are evenly spaced but the dB-to-pixel curve is linear** _(correctness bug)_

[AudioStereoMeter.tsx:71-79](frontend/app/src/app/audio/components/AudioStereoMeter.tsx:71)

```tsx
<div className={styles.meterScale} aria-hidden="true">
  <span>0</span>
  <span>-6</span>
  <span>-12</span>
  <span>-24</span>
  <span>-∞</span>
</div>
```

Rendered with flex `space-between`, these land at 100%, 75%, 50%, 25%, 0%. With the bar's linear -60..0 mapping the labels _actually_ refer to:

| Label shown | True position | Bar position | True dB |
| ----------- | ------------- | ------------ | ------- |
| 0           | 100% (top)    | 100%         | 0 ✅    |
| -6          | 75%           | 90%          | -15     |
| -12         | 50%           | 80%          | -30     |
| -24         | 25%           | 60%          | -45     |
| -∞          | 0% (bottom)   | 0%           | -∞ ✅   |

The only labels in the right place are the endpoints. Anyone reading levels off this scale gets the wrong answer by 15 dB.

#### B6. **Clip color only appears when the latch fires, not at the threshold**

The "over" red (`--audio-meter-over`) is only swapped into the gradient when `data-clip` is true (latched). A signal at -0.5 dBFS that _should_ be in the red zone visually shows as orange. A peak that doesn't trip the 0.985 threshold gets no visual escalation at all.

#### B7. **Numeric peak readout is missing on most meters**

[AudioStereoMeter.tsx:55-60](frontend/app/src/app/audio/components/AudioStereoMeter.tsx:55) — `showPeakReadout` defaults to `false`. The default `meterReadout` ([line 81](frontend/app/src/app/audio/components/AudioStereoMeter.tsx:81)) shows `Math.max(left, right)` instantaneous, not the held peak. Premium meters always show the held peak numerically; this app shows it on output meters only.

#### B8. **Missing feature set vs. premium tier**

None of the following exist:

- True-peak / inter-sample peak detection (oversampled)
- Phase correlation (-1..+1) for stereo busses
- LUFS-M / LUFS-S / LUFS-I loudness metering (EBU R128) — needed for any modern broadcast workflow
- K-system reference scale (K-12 / K-14 / K-20)
- PPM ballistics (BBC / EBU / DIN type)
- User-resettable infinite peak hold
- Headroom marker / target level marker
- Per-meter "groove" or persistence to spot momentary peaks after they pass

#### B9. **DOM count is fine, but the _reconciliation_ path is the bottleneck**

~11 DOM nodes × ~60 stereo meters = ~660 nodes. That's well within budget. The problem isn't DOM, it's that React reconciles all of those nodes every tick because the snapshot reference changes. Even with React.memo, the prop diff happens, and the meter children check `data-tone` and re-evaluate `meterTone()` calls.

#### B10. **No render isolation on the meter component**

[AudioStereoMeter.tsx:62,66](frontend/app/src/app/audio/components/AudioStereoMeter.tsx:62) — `meterTone()` is called inline on every render. `AudioStereoMeter` itself is not memoized, neither is its parent `AudioMixerLane`, nor `AudioTieredMixer`. Every snapshot tick recomputes them all. (Note: the throttled-commit pattern in `AudioMixerLane.tsx:75-78` is unrelated and correct — that's about user-input rate limiting, not meter rendering.)

### C. Non-meter performance observations on the audio page

#### C1. AudioInspector is 1,346 lines and lacks slicing

[AudioInspector.tsx](frontend/app/src/app/audio/components/AudioInspector.tsx) packs EQ, dynamics, sends, and routing into one component. On meter ticks (when audioSnapshot changes), if the inspector is open, the EQ curve, dynamics graph, send list, and routing matrix all re-evaluate. Worth splitting into selector-driven subcomponents that pull only the slice they need.

#### C2. Throttled fader commits _are_ working well

[audioContinuousControls.ts](frontend/app/src/app/audio/audioContinuousControls.ts) — 75 ms throttle on commits. Keep this.

#### C3. CSS is one 4,749-line stylesheet

[AudioWorkspace.module.css](frontend/app/src/app/audio/AudioWorkspace.module.css) — a single CSS module for the entire workspace. Splitting it into per-component module files would help in two ways: (a) targeted CSS reloads in dev, (b) clearer ownership when redesigning the meter slice.

#### C4. AudioSignalCanvas is misnamed — it's not actually a canvas

[AudioSignalCanvas.tsx](frontend/app/src/app/audio/components/AudioSignalCanvas.tsx) — despite the name, this is a CSS-variable-driven React component (a `<section>` rendering an active-mix meter via CSS custom properties), not an HTML5 `<canvas>`. It's an experimental visualization for the active mix output. In Phase 2 it should be folded into the new `MeterSurface` (or deleted if redundant) rather than maintained as a parallel rendering thread. The codebase has **no** existing canvas-2D meter code to seed from.

#### C5. Snapshot bank `recalledSnapshotId` pulse uses the meter tick path

Commit a85e4d6 noted the recalled-snapshot pulse animation was coupled to metering. That coupling should be severed — a snapshot recall is a discrete event, not a 12 Hz signal.

---

## Part 2 — Reference: how professionals actually do this

| System                                                                                                          | Update rate                                       | Render tech                                                                                 | Ballistics                                                                           | Notes                                                             |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Pro Tools                                                                                                       | 30+ Hz (host frame)                               | Native (CoreGraphics / Direct2D), per-track                                                 | Sample peak (default); 17 meter types incl. PPM, RMS, K-12/14/20, VU, gain reduction | Each meter is an independent native widget                        |
| Logic Pro                                                                                                       | ~30 Hz                                            | Metal-accelerated layer                                                                     | Peak with configurable decay                                                         | Hard rise, configurable fall                                      |
| Ableton Live                                                                                                    | ~30-60 Hz                                         | OpenGL-accelerated canvas                                                                   | Sample peak with peak hold                                                           | Single canvas per mixer pane                                      |
| RME TotalMix FX 2.0                                                                                             | display refresh                                   | Hardware-accelerated graphics engine (replaced bitmap engine)                               | Per-channel peak + signal/clip LEDs                                                  | Native LED-segment look                                           |
| PPM Type I (DIN, Nordic)                                                                                        | continuous (analog ref)                           | physical needle                                                                             | 5 ms integration, **20 dB in 1.7 s** fall (≈11.8 dB/s)                               | Faster integration; common in Germany / Scandinavia               |
| PPM Type IIa (BBC)                                                                                              | continuous (analog ref)                           | physical needle                                                                             | 10 ms integration, **24 dB in 2.8 s** fall (≈8.6 dB/s)                               | UK broadcast benchmark                                            |
| PPM Type IIb (EBU)                                                                                              | continuous (analog ref)                           | physical needle                                                                             | 10 ms integration, **24 dB in 2.8 s** fall (≈8.6 dB/s)                               | Continental EU broadcast; same ballistics as IIa, different scale |
| EBU R128 (loudness)                                                                                             | M=400 ms window, S=3 s window                     | Numeric or scale -18 LU..+9 LU                                                              | Target -23 LUFS, max -1 dBTP true peak                                               | Required for European broadcast delivery                          |
| (No PPM standard defines peak hold; that's a separate convention added on top by modern DAWs and digital PPMs.) |                                                   |                                                                                             |                                                                                      |                                                                   |
| JUCE devs (forum consensus)                                                                                     | Timer-driven repaint, skip if needle hasn't moved | `setBufferedToImage(true)` on static parts; OpenGL is "overkill" for VU but useful at scale | Calculate in audio thread, copy atomically, repaint from UI timer                    | Avoid full-screen repaints; only invalidate the changing rect     |

**Convergent best practices the current implementation violates:**

1. **Decouple data rate from frame rate.** Source can be 30 Hz; visual must be 60 Hz (RAF), with client-side decay applied per frame.
2. **Hard rise, soft fall.** Attack should be instant; only the release is smoothed. CSS transitions smooth both directions equally — wrong.
3. **Send only meter data on meter ticks.** Pro DAWs share a tiny audio-thread-to-UI message containing per-channel level + peak + clip — not the entire mixer state.
4. **Logarithmic visual mapping.** More pixels per dB at the top (where you mix), fewer at the bottom (where you only care about presence/absence). Linear -60..0 wastes 80% of the bar on rarely-used territory.
5. **LED-segment look conveys precision.** Continuous bars are harder to read at a glance; segments give you a discrete reference at known dB points.
6. **Standards mode toggle.** A premium app exposes meter type as a setting (Sample Peak / PPM / VU / K-12 / K-14 / K-20 / LUFS-M / LUFS-S) — users expect to choose their reference.

---

## Part 3 — Re-imagined meter architecture

### Design principles

1. **Separate the meter data path from the snapshot data path.** A meter tick must never reach a fader, EQ band, send level, snapshot bank, or routing matrix.
2. **The frontend owns the ballistics.** The backend sends raw sample-peak (and eventually RMS / true-peak). The frontend applies attack/release per render frame at display refresh rate. This is what every native DAW does.
3. **One canvas per "meter strip" surface, but one RAF for all surfaces.** Don't ship 60 independent React components animating CSS. Don't ship 4 independent RAF loops either. One global meter scheduler owns the single RAF; each surface registers a draw callback that fires inside that one tick.
4. **Decay is `dtMs`-driven, not frame-count-driven.** Ballistics functions take a `dtMs` derived from `performance.now()` deltas (clamped to ≤100 ms) so a GC pause or backgrounded tab doesn't produce a visible "catch-up jump" on resume.
5. **Hidden meters cost nothing.** When `document.hidden` is true, or a surface is offscreen per `IntersectionObserver`, the scheduler skips its draw callback. State (peak hold position, clip latch) is preserved.
6. **Retina-correct canvas.** Backing-store sized by `devicePixelRatio` × CSS pixel rect, resized via `ResizeObserver`. Validated in CI against both WKWebView (macOS) and WebView2 (Windows) — they differ on `imageSmoothingEnabled` defaults and subpixel text.
7. **LED-segment visual** with logarithmic dB mapping, color bands at IEC/EBU-standard levels.
8. **Standards-based ballistics presets**, defaulting to "Digital Peak (DAW-style)" — instant attack, ~20 dB/s release, 1.5 s peak hold — matching modern DAW expectations. User-selectable PPM / VU / K-system / LUFS modes.
9. **Accessibility is structural, not a footnote.** A canvas has no semantics. Each meter has an offscreen DOM mirror with `role="meter"`, `aria-valuenow`, and `aria-valuetext` ("-3.2 dBFS, peak -1.1, no clip") updated at 2 Hz so screen-reader users can read levels.
10. **Reduce motion respected** — `prefers-reduced-motion` disables release smoothing; segments update only when the value crosses a segment boundary.

### Data path (proposed)

```
Audio source (sim or real)
   │
   ▼  Rust meter task (RT-priority, 30 Hz minimum, ideally 60 Hz)
   ┌──────────────────────────────────────────┐
   │ AudioMeterDelta {                        │
   │   channels: [{ id, l, r, clip }, ...]    │   ← compact, ~16 bytes/channel
   │   mixTargets: [{ id, l, r, clip }, ...]  │
   │   timestampMs                            │
   │ }                                        │
   └──────────────────────────────────────────┘
                       │ emit as "audio.meters" event (NEW)
                       ▼
   Frontend transport ──► meterStore (NEW, separate from ShellStore.audioSnapshot)
                       │
                       ▼ subscribed by ONE component: MeterSurface
   MeterSurface (RAF loop)
     • reads latest sample from meterStore
     • applies per-meter ballistics in JS:
         - attack: hard step
         - release: dB/sec linear decay (PPM 8.6 dB/s default; user-configurable)
         - peakHold: hold for N ms, then decay
         - clip latch: 1.5 s
     • draws all meters in one canvas pass
   audio.changed (non-meter) events still go through the existing path
   and update audioSnapshot for the rest of the UI.
```

Key win: `audioSnapshot` no longer changes on every tick → memos, selectors, and the inspector stay stable. The audio workspace tree re-renders only when something user-visible (other than meters) actually changes.

### Render path (proposed)

**Global scheduler (singleton):**

```
meterScheduler (one file: meters/scheduler.ts)
  • owns the single requestAnimationFrame loop
  • holds Map<surfaceId, draw(dtMs)>
  • registers surfaces via `register(id, draw)` / `unregister(id)`
  • each frame: compute dtMs = clamp(now - prev, 0, 100); for each surface: draw(dtMs)
  • pauses when document.hidden; also skips individual surfaces flagged hidden by IntersectionObserver
```

**Per surface (mixer pane, inspector strip, output bar, master strip):**

```
<MeterSurface
  channels={[ ... ]}     // [{ id, layout: {x,y,w,h}, stereo, kind: 'channel' | 'master' }, ...]
  ballistics={ ... }     // active preset
  ariaLabelFor={(id) => string}  // for the offscreen DOM mirror
/>
  ├─ <div role="group" aria-label="Meters" style={visuallyHidden}>
  │    {channels.map(c => (
  │      <div role="meter"
  │           aria-valuemin={-60} aria-valuemax={0}
  │           aria-valuenow={currentDb}
  │           aria-valuetext="-3.2 dBFS, peak -1.1, no clip" />
  │    ))}
  │  </div>
  └─ <canvas ref=...>     // sized by ResizeObserver × devicePixelRatio
     register(surfaceId, draw):
       - background: gradient + segment grid cached as one ImageBitmap, blit once per resize
       - per channel:
           - apply ballistics(dtMs, sample) → currentLevel, currentPeak
           - clear region
           - draw lit segments up to currentLevel
           - draw peak-hold dot at currentPeak position
           - draw clip pip if latched
           - draw numeric peak readout (canvas text, cached per 0.1 dB integer)
       - throttle aria-valuetext writes to 2 Hz
```

Why this works:

- One canvas + one RAF instead of ~120 React-controlled DOM elements (60 stereo × 2) animating CSS in parallel.
- Single RAF tick computes ballistics + repaints all meters in O(channels × segments).
- 60 channels × 30 segments = 1,800 fills per frame; trivial for canvas 2D at 60 Hz on either WKWebView or WebView2.
- React only re-mounts the surface when the channel _set_ changes, not their values; values arrive via the meterStore and the RAF callback reads them.
- Hidden meters (collapsed inspector, off-screen pane) cost 0 work because `IntersectionObserver` flags them and the scheduler skips them.
- OffscreenCanvas + worker remains an upgrade path if profiling demands it (unlikely at this scale).

**Accessibility (always-on, not a fallback):** every meter has an offscreen `role="meter"` mirror in the DOM with `aria-valuetext` updated at 2 Hz. Screen-reader users always have access to the values — this is structural, not opt-in. The reduced-motion path simply quantizes the visual to segment boundaries (no smooth release); state and ARIA continue to work normally.

### Visual design (proposed)

**LED-segment meter, logarithmic dB scale:**

- Range: -60 dBFS to 0 dBFS (configurable to -90/-120 for noise-floor work)
- Segment count: 30 segments per channel (1 segment ≈ 2 dB visual average, but log-mapped)
- Log spacing: ~12 segments cover -60..-18 dBFS, ~12 cover -18..-6 dBFS, ~6 cover -6..0 dBFS — gives most precision where the mix lives
- Color bands at standardized thresholds:
  - **green** (-60 to -18 dBFS): nominal / headroom
  - **bright green** (-18 to -12): operating range / target
  - **amber** (-12 to -6): caution
  - **orange** (-6 to -3): hot
  - **red** (-3 to -1): peak warning
  - **bright red** (-1 to 0 + over): OVER, sustained for clip latch
- **Peak hold**: thin bright dot at held position; default 1500 ms hold + 8.6 dB/s decay (BBC PPM standard); option for "infinite hold until reset" (click meter to reset)
- **Headroom marker**: thin reference line at -18 dBFS (broadcast operating level) and -12 dBFS (digital reference)
- **Clip latch pip**: 8x8 red dot above the meter, latches on first peak ≥ -0.1 dBFS, cleared by click or by `recallAudioSnapshot`
- **Numeric readout**: held peak in dBFS, always visible below meter, 1-decimal precision (e.g. "-3.2")

**Optional secondary meters on master / mix targets:**

- **Phase correlation** (stereo only): horizontal -1..+1 strip with center reference; computed client-side from L/R samples or backend correlation coefficient
- **LUFS-M readout**: numeric only by default, with optional vertical scale; computed in worker thread
- **True peak**: thin overlay on the main meter showing oversampled peak; computed client-side via 4× oversampling on the master only (per ITU-R BS.1770)

### Ballistics presets (proposed)

| Preset                       | Attack                            | Release                    | Peak hold | Use case                                                      | Default?                    |
| ---------------------------- | --------------------------------- | -------------------------- | --------- | ------------------------------------------------------------- | --------------------------- |
| **Digital Peak (DAW-style)** | instant (sample peak)             | ~20 dB/s                   | 1.5 s     | Modern DAW default — fast response for live tracking & mixing | ✅                          |
| **PPM Type I (DIN)**         | 5 ms integration                  | 11.8 dB/s (20 dB / 1.7 s)  | none      | Nordic/German broadcast                                       | toggle                      |
| **PPM Type IIa (BBC)**       | 10 ms integration                 | 8.6 dB/s (24 dB / 2.8 s)   | none      | UK broadcast benchmark                                        | toggle                      |
| **PPM Type IIb (EBU)**       | 10 ms integration                 | 8.6 dB/s (24 dB / 2.8 s)   | none      | Continental EU broadcast                                      | toggle                      |
| **VU**                       | 300 ms attack                     | 300 ms release (symmetric) | none      | Mix-bus loudness feel; classic analog meter                   | toggle                      |
| **K-12 / K-14 / K-20**       | Sample peak above K reference     | ~20 dB/s                   | 1.5 s     | Mastering reference (Bob Katz)                                | toggle                      |
| **LUFS-M**                   | 400 ms rectangular sliding window | (window slides)            | n/a       | EBU R128 momentary loudness; numeric primary                  | always-on numeric on master |

Notes:

- "Digital Peak (DAW-style)" is the rebranded default — Pro Tools 11+ sample-peak character. The release rate is faster than any PPM (~20 dB/s vs 8.6-11.8) which is what live mixing operators expect.
- No PPM standard defines a peak hold — that's a modern DAW convention. PPM presets leave hold off by default; user can opt in.
- User picks via a small "Meter Type" control in the toolbar.

---

## Part 4 — Phased implementation plan

The plan is structured so each phase ships independently and improves the user experience even if later phases are deferred.

### Phase 1a — Ship-today hotfix (visual correctness only)

**Goal:** Fix the two visual bugs that actively mislead users, plus a memo. Zero protocol churn. Ships as a small PR.

**Tasks:**

1. **Fix the gradient color stops** in [AudioWorkspace.module.css:1659](frontend/app/src/app/audio/AudioWorkspace.module.css:1659) so they align with the JS thresholds. Green at the bottom 80% (-60..-12 dBFS), amber 80–95% (-12..-3), red top 5% (-3..0). Also update the clipped variant at lines 1669-1677 (which currently swaps in `--audio-meter-over` for the top 3% — make it consistent with the new "red top 5%" baseline so the latch is a visible _intensification_, not a re-coloring).
2. **Fix the scale label positions** in [AudioStereoMeter.tsx:71-79](frontend/app/src/app/audio/components/AudioStereoMeter.tsx:71) — absolute-position each label at its true dB-to-percent position instead of flex `space-between`. With the current linear -60..0 mapping: `0` at top, `-6` at 90%, `-12` at 80%, `-24` at 60%, `-∞` at bottom. Add a 4th label `-48` at 20% so the lower half isn't visually empty.
3. **Wrap `AudioStereoMeter` in `React.memo`** with a numeric-prop equality check. Use a tight comparator (compare `left`, `right`, `peakLeft`, `peakRight`, `clip`, and the boolean toggles).

**Acceptance criteria:**

- [ ] `npm run dev:check` passes.
- [ ] React DevTools Profiler shows `AudioStereoMeter` re-renders only when its numeric props change (not on unrelated re-renders).
- [ ] Visual review (commands below) produces a baseline diff with the _intended_ color and label changes — green zone at bottom, amber band at -12, red band at top, scale labels at correct dB positions. Human-confirm the diff is right, then update baselines.
- [ ] No new console warnings during a 30-second mixer session with simulated metering active.

**Commands to run:**

```bash
# Verify type/lint/unit
npm run dev:check

# Native engine sanity (audio fixtures shouldn't change in 1a)
npm run native:acceptance

# Visual review (regenerate baselines after human review)
npm run tauri:visual:review -- --fixtures=audio-ready-overview,audio-state-assumed,audio-selected-channel,audio-1920-fallback --sizes=2560x1440,1920x1080 --port=4174

# Profile (manual): open the app, navigate to audio workspace, start React DevTools Profiler, observe for 10 s, confirm only meter components re-render
npm run tauri:dev
```

**Pitfalls:**

- The clipped-variant gradient at CSS lines 1669-1677 is a _separate_ gradient — easy to miss; update both.
- `space-between` vs absolute positioning: don't just change the CSS, ensure the labels' `aria-hidden` stays true and the layout doesn't break the meter's grid height.
- Auto-revert generated artifacts (`tauri/gen/schemas`, `tokens.css`) before staging — `npm run tauri:dev` regenerates them.

### Phase 1b — Stop the bleeding (protocol + store split)

**Goal:** Cut the per-tick cost by ~90% by decoupling meter ticks from the full snapshot. This is the largest behavioral change in the plan; it earns its own PR and its own review.

**Tasks:**

1. **Introduce a slim `audio.meters` event** in the protocol ([native/protocol/v1.md](native/protocol/v1.md)). Payload shape:
   ```jsonc
   {
     "type": "event",
     "event": "audio.meters",
     "payload": {
       "timestampMs": 1735905621123, // performance counter from Rust
       "channels": [
         { "id": "mic-1", "l": 0.42, "r": 0.4, "clip": false },
         // ... only meter-relevant fields
       ],
       "mixTargets": [{ "id": "main-out", "l": 0.31, "r": 0.31, "clip": false }],
     },
   }
   ```
   Have Rust emit this from the metering tick. Keep `audio.changed` for non-meter events (gain/EQ/dynamics/sends/snapshot recall etc.).
2. **Update both transports** ([tauriTransport.ts](frontend/packages/engine-client/src/transports/tauriTransport.ts), [fixtureTransport.ts](frontend/packages/engine-client/src/transports/fixtureTransport.ts)) to carry the new event for tests & Storybook.
3. **Add a `meterStore` on the frontend** (a small `useSyncExternalStore` slice independent of `audioSnapshot`). See skeleton in **Appendix A.1**.
4. **Stop calling `refreshAudioSnapshot` on meter ticks.** Remove the special case at [createShellStore.ts:346-348](frontend/packages/engine-client/src/store/createShellStore.ts:346). `AudioStereoMeter` now subscribes to `meterStore` directly via per-channel selectors.
5. **Decouple the snapshot bank pulse** (see C5) — `recalledSnapshotId` pulse should be driven by a discrete UI flag with its own `setTimeout` clear, not by the meter event stream. The current implementation accidentally re-fires on every `audioSnapshot` reference change; once we stop those changes, the pulse will stop too unless explicitly rewired. Look at the `recalledSnapshotId` usage in [AudioWorkspace.tsx](frontend/app/src/app/audio/AudioWorkspace.tsx) and [AudioSnapshotDeck.tsx](frontend/app/src/app/audio/components/AudioSnapshotDeck.tsx) — there's a `useEffect` watching it; make sure it triggers on the discrete `lastRecalledSnapshotId` change only.
6. **Bump cadence to 30 Hz** ([main.rs:61](native/rust-engine/src/main.rs:61), `33` ms).

**Acceptance criteria:**

- [ ] `npm run dev:check` passes.
- [ ] `npm run native:acceptance` passes; baseline test count + 2 new tests (one for the `audio.meters` event emission cadence, one for payload shape).
- [ ] React DevTools Profiler shows `AudioMixerLane`, `AudioTieredMixer`, `AudioInspector` re-render only on user input or non-meter events; never on meter ticks.
- [ ] Manual: click Recall on a snapshot — pulse animation fires correctly (regardless of whether metering is active).
- [ ] Visual review fixtures render identical pixels to Phase 1a output (the entire 1b change is invisible).
- [ ] Perf check: open Chrome DevTools Performance recorder, capture 10 s of the audio workspace at rest with simulated metering, verify main-thread CPU is < 5% and there are no long tasks > 50 ms.

**Commands to run:**

```bash
npm run dev:check
npm run native:acceptance
npm run tauri:visual:review -- --fixtures=audio-ready-overview,audio-state-assumed,audio-selected-channel,audio-1920-fallback --sizes=2560x1440,1920x1080 --port=4174
# Manual perf trace (no script available — use Chrome DevTools manually)
npm run tauri:dev
```

**Pitfalls:**

- `fixtureTransport.ts` is what Storybook and operator-shell.spec.ts use; do not skip it or e2e tests will break.
- The protocol version in [native/protocol/v1.md](native/protocol/v1.md) might need bumping — confirm with the user before touching the version field. Check `validate_protocol_version` in [bootstrap.rs](native/rust-engine/src/bootstrap.rs) and the frontend `requestedProtocolVersion`.
- The `audio.snapshot` request is still needed for non-meter `audio.changed` events — do not delete the snapshot request path, only the meter-tick → snapshot coupling.
- Snapshot bank pulse: write a fast manual regression check before and after — Recall a snapshot in the running app, watch for the pulse — to prove no regression.

### Phase 2 — Render replacement (canvas + ballistics + a11y)

**Goal:** Move to canvas, take ownership of ballistics on the frontend, hit 60 Hz visual, ship structural a11y.

**Tasks:**

1. New file [frontend/app/src/app/audio/meters/scheduler.ts](frontend/app/src/app/audio/meters/scheduler.ts) — the single global RAF scheduler. See **Appendix A.2**.
2. New file [frontend/app/src/app/audio/meters/ballistics.ts](frontend/app/src/app/audio/meters/ballistics.ts) — pure functions for ballistics application (attack, release, peak hold, clip latch). Each preset is one function taking `(prevState, sample, dtMs) → nextState`. Unit-tested. See **Appendix A.3**.
3. New file [frontend/app/src/app/audio/meters/MeterSurface.tsx](frontend/app/src/app/audio/meters/MeterSurface.tsx) — registers a draw callback with the scheduler; sets up `ResizeObserver` for `devicePixelRatio`-correct backing-store sizing; sets up `IntersectionObserver` to flag offscreen; renders the offscreen `role="meter"` ARIA mirror DOM with `aria-valuetext` throttled to 2 Hz. See **Appendix A.4**.
4. New file [frontend/app/src/app/audio/meters/types.ts](frontend/app/src/app/audio/meters/types.ts) — `MeterSample`, `MeterStyle`, `BallisticsPreset`, `MeterState`, `SurfaceChannel` types. See **Appendix A.5**.
5. Replace per-channel `<AudioStereoMeter>` usage inside the mixer with one `<MeterSurface>` rendering all of the pane's channels (still keep `AudioStereoMeter` export as a thin wrapper that delegates internally, so Storybook / fixtures continue to compile).
6. Fold [AudioSignalCanvas.tsx](frontend/app/src/app/audio/components/AudioSignalCanvas.tsx) into the master `MeterSurface` (or delete if redundant) — it's the experimental active-mix visualizer and shouldn't outlive Phase 2.
7. Backend can stop applying ballistics ([audio_backend.rs:632-682](native/rust-engine/src/audio_backend.rs:632)) — it only needs to emit raw sample peak. Keep the simulation generator (it's solid).
8. Visual regression: cross-platform baseline update — capture both WKWebView (macOS) and WebView2 (Windows) baselines as part of this phase, since canvas text and gradients can differ subtly.

**Acceptance criteria:**

- [ ] `npm run dev:check` passes.
- [ ] New `ballistics.spec.ts` covers: peak attack is instant, release follows the preset slope within ±0.1 dB at every 100 ms sample, peak hold survives the hold duration then decays, clip latch holds for its configured duration. All presets covered.
- [ ] `npm run native:acceptance` passes; Rust ballistics tests removed (or kept as legacy if useful for the simulation generator).
- [ ] Visual review (macOS): pixel-diff shows the new LED-segment look; baselines updated after human approval.
- [ ] Visual review (Windows-Claude): same; baselines may differ slightly due to WebView2 — capture both sets.
- [ ] ARIA: focus a meter via keyboard, VoiceOver or NVDA reads "Channel 1, meter, -12 dBFS, peak -3.1, no clip" or equivalent.
- [ ] Manual: drag a fader during heavy metering — DevTools Performance flame chart shows no dropped frames over a 5-second window.
- [ ] Manual: switch to another workspace and back — meters stop rendering when hidden, resume cleanly without a "catch-up" jump.
- [ ] Manual: in DevTools, set CPU throttle to 4×, observe meters still render at 30+ fps (premium-grade headroom).

**Commands to run:**

```bash
npm run dev:check
npm run native:acceptance
npm run tauri:visual:review -- --fixtures=audio-ready-overview,audio-state-assumed,audio-selected-channel,audio-1920-fallback --sizes=2560x1440,1920x1080 --port=4174
npm run tauri:smoke:win   # coordinate with user for the Windows session
npm run tauri:dev
```

**Pitfalls:**

- `devicePixelRatio` × `ResizeObserver` is easy to get wrong — without it, canvas is blurry on Retina. Reference the existing `AudioSignalCanvas` shape (even though it's not a real canvas, its responsive sizing pattern is reusable).
- `MeterSurface` lifecycle: register with scheduler in `useEffect`, unregister in cleanup. A leaked subscription = invisible 60 Hz CPU burn.
- Tests: do not test ballistics by mocking time with `jest.useFakeTimers()` — instead, pass deterministic `dtMs` values directly to the pure ballistics functions (that's the whole point of the design).
- Storybook: every story that references the old `<AudioStereoMeter>` shape must keep working. The wrapper pattern keeps the same prop signature; verify Storybook compiles after the refactor.
- `audioSnapshot` still exists and still has `meterLeft`/`meterRight` fields from the generated types (`ts-rs`). Don't remove those fields from the type — the snapshot path may still need them for non-meter contexts (e.g. the inspector showing the most recent peak when nothing is moving). Just stop _driving_ them with meter events.

### Phase 3 — Premium polish

**Goal:** All the small touches that say "professional tool" — correct scale, peak hold reset, headroom markers, readouts everywhere.

**Tasks:**

1. Logarithmic dB → segment mapping (more pixels per dB at the top). Helper added to [audioFormatting.ts](frontend/app/src/app/audio/audioFormatting.ts) alongside the linear one.
2. Per-meter held-peak numeric readout, always visible (~10 px tall, below the bar; "−3.2" format).
3. Click-to-reset peak hold (visible affordance on hover: cursor changes, brief outline).
4. Headroom reference line at -18 dBFS; secondary line at -12 dBFS.
5. Clip pip with explicit reset (latches indefinitely until user clears).
6. Updated color palette per the standardized bands above (slight tweaks to the existing tokens). Update [AudioWorkspace.module.css](frontend/app/src/app/audio/AudioWorkspace.module.css) tokens.
7. Update visual review fixtures (8 screenshots × new look).

**Acceptance criteria:**

- [ ] `npm run dev:check` passes.
- [ ] Log-spacing helper has unit tests proving: 0 dBFS maps to 100%, -∞ to 0%, -12 dBFS to ~70%, -60 dBFS to ~15% (or whatever the chosen curve produces — assert against fixed expected values).
- [ ] Click-to-reset peak hold works on every meter; tested manually and by an e2e Playwright spec.
- [ ] Visual review baselines updated; human-confirmed.
- [ ] Reduced-motion check: `prefers-reduced-motion: reduce` disables release smoothing — segments snap to value rather than easing.

**Commands to run:**

```bash
npm run dev:check
npm run tauri:visual:review -- --fixtures=audio-ready-overview,audio-state-assumed,audio-selected-channel,audio-1920-fallback --sizes=2560x1440,1920x1080 --port=4174
npm run tauri:dev
```

**Pitfalls:**

- Log-mapping the segments visually changes which segments are "lit" for the same dB value. Update the fixture-based unit tests that check meter percentages.
- Click target for peak-hold reset must be at least 24×24 px or the click is hard on a mixer with 40+ tracks. Click hit-test the _whole_ meter region, not just the peak dot.

### Phase 4 — Standards & advanced features

**Goal:** Optional, opt-in pro features. Likely shipped as a separate initiative; included here for completeness.

**Tasks:**

1. Meter type selector in toolbar (Digital Peak / PPM I / PPM IIa / PPM IIb / VU / K-12 / K-14 / K-20).
2. LUFS-M / LUFS-S numeric readouts on master mix target (worker-side calc).
3. Phase correlation strip on stereo master (-1..+1, vectorscope dot optional).
4. True-peak overlay on master (4× oversampled in a worker per ITU-R BS.1770).
5. Per-user preference persistence (meter type stored in ShellStore settings; round-tripped through Rust shell-settings).

**Acceptance criteria:**

- [ ] Each preset has unit tests that match the reference standard's specified attack/release within ±0.1 dB.
- [ ] LUFS pipeline cross-checked against an EBU R128 test signal (one of the EBU-supplied compliance files; URL in research below).
- [ ] Meter type preference persists across app restart.
- [ ] Correlation strip shows ~+1 for in-phase identical signals, ~0 for uncorrelated, ~-1 for inverted.

**Commands to run:** same as Phase 3.

**Pitfalls:**

- LUFS in a worker means another transferable buffer path — confirm the simulation generator can feed it samples (not just pre-computed peaks). May require a second event channel.
- True-peak oversampling: 4× is the minimum per BS.1770; some implementations use 8×. 4× is sufficient for indication; mark the readout "TP" so users know it's the oversampled value.
- Don't ship this without ship-side telemetry on which presets users actually pick; if everyone stays on Digital Peak, the engineering cost isn't justified.

---

## Part 5 — Critical files

### To modify

- [frontend/app/src/app/audio/components/AudioStereoMeter.tsx](frontend/app/src/app/audio/components/AudioStereoMeter.tsx) — becomes a thin DOM-fallback wrapper, or deleted in favor of `MeterSurface`
- [frontend/app/src/app/audio/components/AudioMixerLane.tsx:75-78](frontend/app/src/app/audio/components/AudioMixerLane.tsx:75) — meter renders are routed through `MeterSurface`
- [frontend/app/src/app/audio/audioFormatting.ts:15-58](frontend/app/src/app/audio/audioFormatting.ts:15) — add logarithmic dB-to-pixel curve helper alongside the existing linear one
- [frontend/app/src/app/audio/AudioWorkspace.module.css:1652-1705](frontend/app/src/app/audio/AudioWorkspace.module.css:1652) — fix gradient stops in Phase 1; meter styles deleted in Phase 2 when canvas takes over
- [frontend/packages/engine-client/src/store/createShellStore.ts:295-351](frontend/packages/engine-client/src/store/createShellStore.ts:295) — drop the meter-tick → full snapshot refetch; add the new `meterStore`
- [native/rust-engine/src/main.rs:59-72](native/rust-engine/src/main.rs:59) — emit slim meter delta event at 30 Hz (replace existing full-snapshot trigger)
- [native/rust-engine/src/audio_backend.rs:609-700](native/rust-engine/src/audio_backend.rs:609) — emit raw peak instead of ballistic-smoothed body; keep simulation
- [native/protocol/v1.md](native/protocol/v1.md) — add `audio.meters` event spec

### To add

- [frontend/app/src/app/audio/meters/scheduler.ts](frontend/app/src/app/audio/meters/scheduler.ts) — global RAF singleton
- [frontend/app/src/app/audio/meters/MeterSurface.tsx](frontend/app/src/app/audio/meters/MeterSurface.tsx)
- [frontend/app/src/app/audio/meters/ballistics.ts](frontend/app/src/app/audio/meters/ballistics.ts)
- [frontend/app/src/app/audio/meters/types.ts](frontend/app/src/app/audio/meters/types.ts)
- [frontend/packages/engine-client/src/store/createMeterStore.ts](frontend/packages/engine-client/src/store/createMeterStore.ts)
- [frontend/app/tests/meter-ballistics.spec.ts](frontend/app/tests/meter-ballistics.spec.ts)

### Existing utilities to reuse

- The throttled-commit pattern in [audioContinuousControls.ts](frontend/app/src/app/audio/audioContinuousControls.ts) — same pattern can throttle non-meter audio events if needed.
- The fixture transport [tauriTransport.ts / fixtureTransport.ts](frontend/packages/engine-client/src/transports/) — extend to carry the new `audio.meters` event for tests/Storybook.
- The Rust simulation generator [audio_backend.rs:702-792](native/rust-engine/src/audio_backend.rs:702) — keep as-is; it produces good test signal.

---

## Part 6 — Verification

### Per phase

Each phase has a verification block in Part 4. The general lanes:

1. **Local dev:** `npm run dev:check` and `npm run native:acceptance` (per the project's standard lanes).
2. **Visual review:** `npm run tauri:visual:review -- --fixtures=audio-ready-overview,audio-state-assumed,audio-selected-channel,audio-1920-fallback --sizes=2560x1440,1920x1080`. Phase 1 should produce identical pixels; Phase 2+ requires baseline updates.
3. **Windows-Claude target-host:** standard branch validation per project workflow.
4. **Perf budget:** before/after measurements with DevTools Performance recording during a 10 s sweep:
   - Main-thread CPU during steady metering: target < 5%
   - Frame rate during fader drag with meters active: target locked 60 Hz
   - Long-task count: target 0 over a 10 s window

### Specific to the meters

- **Ballistics unit tests** in `ballistics.spec.ts` — given a known sample stream, the held peak and decay curve must match the reference standard within ±0.1 dB.
- **Visual diff harness** — a Storybook story that renders the same input signal through every ballistics preset, side by side, for human verification.
- **A11y check** — VoiceOver / NVDA reads "Channel 1 peak -3 dB" when focused; reduced-motion disables decay animation.

---

## Notes / things deliberately _not_ in scope (because the user said "audio page", not "audio engine")

- No change to OSC transport itself, just the meter event subtype.
- No real audio capture (cpal / system audio) — the simulation is sufficient for UI work; a real capture path is its own initiative.
- No change to the snapshot bank, recall flow, inspector layout, or fader curve — those are working. The only meter-adjacent change to other surfaces is the `recalledSnapshotId` pulse decoupling in Phase 1b (covered explicitly).
- No change to the OperatorShell routing or the workspace switcher.
- **Inspector slicing intentionally deferred.** C1 flags `AudioInspector` as 1,346 lines re-evaluating on every tick. Once Phase 1b lands, that re-evaluation stops on meter ticks — so the _symptom_ is gone. The underlying structure is still worth splitting for maintainability, but that's a separate initiative tracked in its own follow-up; including it here would expand scope without addressing the meter problem the user asked about.

---

## Appendix A — File skeletons for Phase 2

These are starting points, not finished code. Reading them gives you the exact shapes the rest of the plan assumes. Refine and expand during implementation — but if you stray from these shapes, audit whether the references in the phase descriptions still line up.

### A.1 — `createMeterStore.ts`

```ts
// frontend/packages/engine-client/src/store/createMeterStore.ts
import { useSyncExternalStore } from "react";

export type MeterSample = {
  l: number; // 0..1 sample-peak
  r: number;
  clip: boolean;
  timestampMs: number;
};

export type MeterStoreState = {
  channels: Map<string, MeterSample>;
  mixTargets: Map<string, MeterSample>;
  lastTickMs: number;
};

export interface MeterStore {
  getState(): MeterStoreState;
  subscribe(listener: () => void): () => void;
  applyTick(payload: AudioMetersEventPayload): void;
}

export function createMeterStore(): MeterStore {
  let state: MeterStoreState = {
    channels: new Map(),
    mixTargets: new Map(),
    lastTickMs: 0,
  };
  const listeners = new Set<() => void>();

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    applyTick: (payload) => {
      // Mutate maps in place for perf; the Map *reference* changes only on channel-set changes.
      // Listeners notified unconditionally on every tick.
      for (const c of payload.channels) {
        state.channels.set(c.id, { l: c.l, r: c.r, clip: c.clip, timestampMs: payload.timestampMs });
      }
      for (const m of payload.mixTargets) {
        state.mixTargets.set(m.id, { l: m.l, r: m.r, clip: m.clip, timestampMs: payload.timestampMs });
      }
      state = { ...state, lastTickMs: payload.timestampMs };
      for (const l of listeners) l();
    },
  };
}

// Per-channel selector hook for components that need just one sample
export function useMeterSample(store: MeterStore, channelId: string): MeterSample | undefined {
  return useSyncExternalStore(store.subscribe, () => store.getState().channels.get(channelId));
}
```

### A.2 — `meters/scheduler.ts`

```ts
// frontend/app/src/app/audio/meters/scheduler.ts
type DrawFn = (dtMs: number) => void;

const DT_MAX_MS = 100; // clamp dt so a backgrounded tab doesn't produce a jump on resume

class MeterScheduler {
  private surfaces = new Map<string, { draw: DrawFn; hidden: boolean }>();
  private rafId: number | null = null;
  private lastTickMs = 0;

  register(id: string, draw: DrawFn): void {
    this.surfaces.set(id, { draw, hidden: false });
    this.ensureRunning();
  }

  unregister(id: string): void {
    this.surfaces.delete(id);
    if (this.surfaces.size === 0) this.stop();
  }

  setHidden(id: string, hidden: boolean): void {
    const entry = this.surfaces.get(id);
    if (entry) entry.hidden = hidden;
  }

  private ensureRunning(): void {
    if (this.rafId !== null) return;
    this.lastTickMs = performance.now();
    const tick = (now: number) => {
      this.rafId = requestAnimationFrame(tick);
      if (document.hidden) {
        this.lastTickMs = now;
        return;
      }
      const dtMs = Math.min(DT_MAX_MS, Math.max(0, now - this.lastTickMs));
      this.lastTickMs = now;
      for (const entry of this.surfaces.values()) {
        if (!entry.hidden) entry.draw(dtMs);
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }
}

export const meterScheduler = new MeterScheduler();
```

### A.3 — `meters/ballistics.ts`

```ts
// frontend/app/src/app/audio/meters/ballistics.ts
import type { MeterSample } from "@sse/engine-client";

export type BallisticsPreset =
  | { kind: "digital-peak"; releaseDbPerSec: number; peakHoldMs: number }
  | { kind: "ppm-i" } // DIN: 5 ms integration, 11.8 dB/s release
  | { kind: "ppm-iia" } // BBC: 10 ms integration, 8.6 dB/s release
  | { kind: "ppm-iib" } // EBU: same as IIa, different reference scale
  | { kind: "vu"; attackMs: number; releaseMs: number }
  | { kind: "k-system"; reference: 12 | 14 | 20 };

export type MeterState = {
  level: number; // current displayed level, 0..1
  peakHold: number; // 0..1 held peak
  peakHoldExpiresMs: number;
  clipLatchExpiresMs: number;
};

export const DEFAULT_PRESET: BallisticsPreset = {
  kind: "digital-peak",
  releaseDbPerSec: 20,
  peakHoldMs: 1500,
};

export const INITIAL_METER_STATE: MeterState = {
  level: 0,
  peakHold: 0,
  peakHoldExpiresMs: 0,
  clipLatchExpiresMs: 0,
};

export function applyBallistics(
  prev: MeterState,
  sample: MeterSample,
  dtMs: number,
  preset: BallisticsPreset,
  nowMs: number
): MeterState {
  const inputLevel = Math.max(sample.l, sample.r);
  let level = prev.level;

  // Attack: depends on preset
  switch (preset.kind) {
    case "digital-peak":
    case "ppm-i":
    case "ppm-iia":
    case "ppm-iib":
    case "k-system":
      // Hard rise to peak; release is the only smoothed direction
      if (inputLevel > prev.level) {
        level = inputLevel;
      }
      break;
    case "vu":
      // Symmetric: both attack and release smoothed
      // Implement as one-pole filter; tau_attack and tau_release per preset
      // [omitted for brevity — implement in actual file]
      level = inputLevel; // placeholder
      break;
  }

  // Release (decay)
  if (level > inputLevel) {
    const releaseRate = releaseDbPerSecond(preset);
    const dropDb = releaseRate * (dtMs / 1000);
    // Convert level -> dBFS, subtract dropDb, convert back -> level
    const currentDb = level <= 0 ? -Infinity : 20 * Math.log10(level);
    const nextDb = currentDb - dropDb;
    const nextLevel = nextDb <= -120 ? 0 : Math.pow(10, nextDb / 20);
    level = Math.max(nextLevel, inputLevel);
  }

  // Peak hold
  let peakHold = prev.peakHold;
  let peakHoldExpiresMs = prev.peakHoldExpiresMs;
  if (preset.kind === "digital-peak" || preset.kind === "k-system") {
    if (level > peakHold || nowMs > peakHoldExpiresMs) {
      peakHold = Math.max(level, inputLevel);
      peakHoldExpiresMs = nowMs + (preset.kind === "digital-peak" ? preset.peakHoldMs : 1500);
    } else {
      // After hold expires, peak hold decays at the same rate as level
      const releaseRate = releaseDbPerSecond(preset);
      const dropDb = releaseRate * (dtMs / 1000);
      const currentDb = peakHold <= 0 ? -Infinity : 20 * Math.log10(peakHold);
      const nextDb = currentDb - dropDb;
      peakHold = nextDb <= -120 ? 0 : Math.pow(10, nextDb / 20);
      peakHold = Math.max(peakHold, level);
    }
  }

  // Clip latch
  let clipLatchExpiresMs = prev.clipLatchExpiresMs;
  if (sample.clip || inputLevel >= 0.999) {
    clipLatchExpiresMs = nowMs + 1500;
  }

  return { level, peakHold, peakHoldExpiresMs, clipLatchExpiresMs };
}

function releaseDbPerSecond(preset: BallisticsPreset): number {
  switch (preset.kind) {
    case "digital-peak":
      return preset.releaseDbPerSec;
    case "ppm-i":
      return 11.8;
    case "ppm-iia":
      return 8.6;
    case "ppm-iib":
      return 8.6;
    case "vu":
      return 0; // VU uses smoothed attack/release, not slope
    case "k-system":
      return 20;
  }
}
```

### A.4 — `meters/MeterSurface.tsx`

```tsx
// frontend/app/src/app/audio/meters/MeterSurface.tsx
import { useEffect, useRef } from "react";
import { meterScheduler } from "./scheduler";
import {
  applyBallistics,
  DEFAULT_PRESET,
  INITIAL_METER_STATE,
  type BallisticsPreset,
  type MeterState,
} from "./ballistics";
import type { MeterStore } from "@sse/engine-client";
import { dbfsToMeterPercent, normalizedToDbfs } from "../audioFormatting";

export type SurfaceChannel = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number; // CSS pixels
  stereo: boolean;
  label: string;
};

export function MeterSurface({
  surfaceId,
  channels,
  store,
  preset = DEFAULT_PRESET,
}: {
  surfaceId: string;
  channels: SurfaceChannel[];
  store: MeterStore;
  preset?: BallisticsPreset;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<Map<string, MeterState>>(new Map());
  const ariaMirrorRef = useRef<HTMLDivElement>(null);
  const ariaLastWriteRef = useRef(0);

  // Setup ResizeObserver for DPR-correct backing store
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      const ctx = canvas.getContext("2d");
      ctx?.scale(dpr, dpr);
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // Setup IntersectionObserver to pause when offscreen
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const io = new IntersectionObserver(([entry]) => {
      meterScheduler.setHidden(surfaceId, !entry.isIntersecting);
    });
    io.observe(canvas);
    return () => io.disconnect();
  }, [surfaceId]);

  // Register draw callback
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = (dtMs: number) => {
      const now = performance.now();
      const meters = store.getState().channels;
      for (const ch of channels) {
        const sample = meters.get(ch.id);
        if (!sample) continue;
        const prev = stateRef.current.get(ch.id) ?? INITIAL_METER_STATE;
        const next = applyBallistics(prev, sample, dtMs, preset, now);
        stateRef.current.set(ch.id, next);
        drawChannel(ctx, ch, next);
      }
      // Throttle ARIA writes to 2 Hz
      if (now - ariaLastWriteRef.current > 500) {
        ariaLastWriteRef.current = now;
        writeAriaMirror(ariaMirrorRef.current, channels, stateRef.current);
      }
    };

    meterScheduler.register(surfaceId, draw);
    return () => meterScheduler.unregister(surfaceId);
  }, [surfaceId, channels, preset, store]);

  return (
    <>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} />
      <div
        ref={ariaMirrorRef}
        role="group"
        aria-label="Audio meters"
        style={{
          position: "absolute",
          clip: "rect(0 0 0 0)",
          clipPath: "inset(50%)",
          height: 1,
          width: 1,
          overflow: "hidden",
        }}
      />
    </>
  );
}

function drawChannel(ctx: CanvasRenderingContext2D, ch: SurfaceChannel, state: MeterState) {
  // ... LED-segment draw routine: clear region, draw 30 segments up to state.level,
  //     draw peak-hold dot at state.peakHold, draw clip pip if state.clipLatchExpiresMs > now,
  //     draw numeric readout below
  // (Implement in the actual file.)
}

function writeAriaMirror(el: HTMLDivElement | null, channels: SurfaceChannel[], states: Map<string, MeterState>) {
  if (!el) return;
  // Render one <div role="meter" ...> per channel with aria-valuetext.
  // (Implement in the actual file.)
}
```

### A.5 — `meters/types.ts`

```ts
// frontend/app/src/app/audio/meters/types.ts
export type { MeterSample, MeterStoreState, MeterStore } from "@sse/engine-client";
export type { BallisticsPreset, MeterState } from "./ballistics";
export type { SurfaceChannel } from "./MeterSurface";

export type MeterStyle = "segment" | "bar";
```

---

## Appendix B — Manual verification: how to see the meters move

For any phase, the fastest way to eyeball your work is the dev app with simulated metering:

```bash
# Terminal 1 — start the Tauri dev app
npm run tauri:dev

# Then in the running app:
# 1. Navigate to the Audio workspace (icon in the header).
# 2. The simulated meter feed runs at startup; you should see ~18 channels animating.
# 3. Channels with role "front-preamp" simulate speech (syllable bursts).
# 4. Channels with role "playback-pair" simulate music (steady motion with width).
# 5. "audio-playback-3-4" (FX) simulates loud stings — good for testing peak hold + clip latch.
```

Things to look for at each phase:

- **Phase 1a:** Top of the meter should be RED for signals at ≥-3 dBFS. Scale labels (0, -6, -12, -24, -∞) should sit at their true positions, not evenly spaced. Re-render Profiler shows only `AudioStereoMeter` updating.
- **Phase 1b:** With the audio workspace active, profiler shows zero re-renders of mixer lanes / inspector during the simulated meter feed. Click Recall on a snapshot — the pulse animation still fires.
- **Phase 2:** Meters render as discrete LED segments. Switch workspaces, come back — meters resume smoothly without a jump. Throttle CPU 4× in DevTools — meters still render at 30+ fps.
- **Phase 3:** Click a meter — peak-hold dot resets. Reference lines at -18 and -12 dBFS visible. Held peak shown as numeric "−3.2" below every meter.
- **Phase 4:** Toolbar shows meter-type selector; cycling through presets visibly changes ballistics. Master meter has correlation strip.

---

## Appendix C — Risks and mitigations

| Risk                                                                                                          | Likelihood         | Impact                            | Mitigation                                                                                                         |
| ------------------------------------------------------------------------------------------------------------- | ------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Phase 1b breaks Storybook fixtures because new event shape isn't in `fixtureTransport.ts`                     | High if you forget | Storybook + e2e tests red         | Touch `fixtureTransport.ts` in the same PR; run `dev:check` early.                                                 |
| Canvas pixel-diff differs between WKWebView and WebView2                                                      | Certain            | Visual review CI confusion        | Capture both baselines in Phase 2; expect minor cross-platform diffs and accept them.                              |
| Generated artifacts (`tauri/gen/schemas`, `tokens.css`) get staged accidentally                               | Routine            | Noisy commits / churn             | Always `git restore` those paths before staging. See `feedback_auto_revert_generated_artifacts.md`.                |
| Phase 1b protocol version bump cascades to Windows-Claude validation timing                                   | Medium             | Coordination friction             | Confirm with user before bumping protocol version; do not bump unless required by validate_protocol_version logic. |
| LUFS worker (Phase 4) needs raw samples, not pre-computed peaks → adds a second event channel                 | Certain at Phase 4 | Scope creep                       | Defer Phase 4 explicitly; treat the meter event as peak-only for Phase 1-3.                                        |
| Peak-hold reset click target conflicts with fader hit-test                                                    | Medium             | Annoying UX                       | Hit-test the meter rect explicitly; do not piggyback on the fader's input handler.                                 |
| Backend stops applying ballistics in Phase 2 but UI tests for old shape still pass against the simulated data | Low                | False sense of regression freedom | Add a Vitest snapshot of one frame of ballistics output for every preset; will fail loudly if the math drifts.     |
| Bumping cadence from 12 Hz to 30 Hz reveals stale assumptions elsewhere (e.g. dependent animation timing)     | Medium             | One-off polish bugs               | Search the codebase for hard-coded `83` / `12` / `metering-tick` references during Phase 1b.                       |

---

## Appendix D — Open questions to confirm with the user before / during implementation

These are deliberately not assumed; ask before doing.

1. **Phase 1b protocol version bump.** Should this require a `requestedProtocolVersion` bump and the negotiation logic in `bootstrap.rs`? If yes, what's the new version number and do we accept the cross-process restart cost?
2. **Meter type default.** "Digital Peak (DAW-style)" is recommended as the default. Confirm before shipping the Phase 4 selector. (Phases 1-3 only ship this one preset.)
3. **Click-to-reset peak hold gesture.** Single click vs. double click vs. right-click context menu? Single click is the cleanest but conflicts with selecting a channel. Recommend: click on the _meter bar area only_ resets peak; click on the channel strip elsewhere selects. Confirm.
4. **Headroom reference line color.** Currently the design tokens don't have a "reference line" color. Recommend a low-saturation cyan matching `--audio-accent`. Confirm.
5. **Per-platform visual review baselines.** Are we comfortable with separate macOS and Windows baselines? They will differ slightly forever.
6. **Inspector slicing follow-up.** Should I open a tracking issue / docs note even though it's out of scope here? Recommend yes (a one-liner in [docs/HANDOFF.md](docs/HANDOFF.md)).

When in doubt: ask. Cost of a clarifying question is cheap; cost of a wrong assumption in this codebase is high.

---

## Appendix E — Implementation kickoff prompt (copy/paste into a fresh Claude Code session)

```
I'm handing off an implementation task. Please read docs/superpowers/plans/2026-05-18-audio-meter-architecture.md in this repo first — the entire file, especially the "How to use this document" section at the top.

The plan is a four-phase rebuild of the audio page meters to fix performance and visual-correctness bugs and to bring the architecture up to a professional-DAW standard (canvas-based LED-segment meters, frontend ballistics, standards-mode toggle). The "Read this first" section spells out the user profile, tooling stack, and workflow rules (auto-revert generated artifacts, local-only CI, Windows-Claude validation flow, etc.) — honor them.

Scope for this session: Phase 1a ONLY (the ship-today hotfix). Do not start Phase 1b or anything beyond without my explicit go-ahead. Phase 1a's three tasks are listed verbatim in the plan; complete every acceptance-criterion checkbox before declaring it done.

Workflow:
1. Read the plan end-to-end. Skim the source files cited in Part 5 to ground yourself.
2. Implement Phase 1a's three tasks.
3. Run the Phase 1a "Commands to run" block.
4. Show me the visual review diff and wait for human approval before updating baselines.
5. Stop. Summarize what changed, paste the test/lint output, and wait for my next instruction.

If anything in the plan is unclear or seems wrong, ask before deviating. If you discover a state in the repo that contradicts the plan (a file moved, line numbers shifted), tell me and we'll re-anchor — don't silently improvise.
```
