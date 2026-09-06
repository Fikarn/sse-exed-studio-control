# Visual overhaul — session handoff (2026-09-05)

Read this first in the new session. It says what the operator wants, what already exists and how far it can be trusted, where the tooling is, and what the first deliverable is. Everything it points to is in the repo on branch `ui-gold-standard-2026-09` or in the evidence folder next to the repo.

## Mandate (operator, 2026-09-05)

- Design the UI of SSE ExEd Studio Control from scratch, with fresh eyes, as a senior product designer would: from the operator's requirements and the coded truths, with **no visual rulebook**. Layout, hierarchy, type, colour, material, motion, iconography, component design, copy tone and the look of the three themes are all open and must each be defended in terms of the operator.
- Fixed: the four workspaces and their features, the shell that holds them, the engine-authoritative boundary (the front-end never invents state), the hardware profile (`2560x1440` primary, `1920x1080` live minimum, `1280x800` utility, no page scroll, Windows, mouse + keyboard + Stream Deck), the existence of three themes, and the Playwright test-id contract (extend, never rename).
- Order of work: divergent concepts → the operator picks → converge → the system behind it → every workspace, state, viewport and theme → a sliced plan → implementation. No source edit before the operator approves a direction and a plan.

## The source of requirements

`docs/redesign/claude-design-product-brief-2026-09.md` — facts only: the operator and the room, hard constraints, the four workspaces' features, every state the engine can report and its way out, the action classes (momentary, toggle, continuous, arm-then-apply, dialog, gating), the words and numbers the screen prints, the Stream Deck page, what fails the operator today, the outcomes "perfect" must achieve, and the deliverables in order. Treat it as the brief; verify anything doubtful against `docs/HARDWARE_PROFILE.md`, `docs/OPERATIONS.md`, `AGENTS.md` and the code.

## What exists, and how much to trust it

- **The review of the current program** — `docs/redesign/gold-standard-review-2026-09.md`. Measured findings C1–C4, H1–H12, M1–M11, L1–L6 with evidence paths. These are facts about what fails the operator today and stand whatever direction wins. Its §4 lists what already works and should survive.
- **A prior candidate direction, not the standard** — `docs/redesign/gold-standard-brief-2026-09.md` (v1.1: a physical material model, one light, five elevation levels, keys that press and stay lit, lamps, wells), its mocks `docs/redesign/assets/gold-standard/Skeleton-Four-Workspaces.html` and `State-Vocabulary.html` (open in a browser; `?board=audio&state=Assumed&theme=bone`, press `1` for 1:1), the design-system library `docs/redesign/design-system/` generated from them, and the plan `docs/plans/gold-standard-2026-09.md`. Reuse from it whatever earns its place: the measurable rules in its §15, the state vocabulary's _words_ (which are the engine's), the skeleton's slot idea. Do not inherit its material or its look by default; it competes as one concept among the new ones.
- **The plan's discipline is reusable as is**: one commit per slice, gates before and after, tests moved not deleted, baselines inspected before refresh, a CHANGELOG bullet per operator-visible change, `dev:check` before each commit, the rescope protocol from `AGENTS.md`.
- **Claude Design** was tried and set aside for this pass. The bridge is authorized (`/design-login` done); a design-system project "SSE Studio Control" (`3dcbd8f5-6f5a-49de-8791-66e1a3f272ba`) holds the v1.1 library. Not needed for the new session.

## Tooling that already works

- Fixture dev server: `.claude/launch.json` configuration `frontend-fixture-dev` on port 4180 (start it with the preview tool). Any fixture: `http://127.0.0.1:4180/?fixture=<id>&transport=fixture&theme=graphite|bone`. The 27 fixture ids are in `frontend/packages/test-fixtures/src/fixtures.json`.
- Evidence folder (outside git): `C:\Users\Stora Studion\Desktop\Studio Control Rev 1\gold-standard-evidence-2026-09\` — `captures/` (all 27 fixtures × 3 viewports × 3 themes at 1:1), `states/` (dialogs, palette, focus, hover, arming, drawers, menus), `crops/`, `mocks/` and `mocks-v1.1/` (renders of the prior candidate with its contrast report), `metrics/` (DOM census, pixel-sampled contrast, chrome census, interactive results), `probe/` (the scripts).
- Probes in `probe/` (run with `node` / `python` from that folder; Playwright 1.60 and Pillow are installed): `capture.mjs` (fixtures → PNG + census JSON), `aggregate.mjs` (census → report), `contrast.py` (pixel-sampled WCAG contrast from the PNG + census; interior sampling for filled controls, disabled exempt), `census.mjs` (chrome geometry + calm metrics), `states.mjs` (interactive states), `mock.mjs` + `mockprobe.mjs` (render and measure HTML mocks at 1:1), `crop.py`, `cardshot.mjs`, `splice.py`, `build_design_system.py`. Judge 2560 renders only from Playwright PNGs; the in-app browser pane is too small.
- Lanes for later implementation: `npm run frontend:typecheck`, `npm run frontend:test`, `npm run build --workspace frontend/app` **before** any Playwright run, `cd frontend/app && npx playwright test <spec>`, visual baselines via `visual-review.spec.ts` and `storybook.spec.ts` (win32 only refreshable here), `npm run dev:check` before a commit. Never run `tauri:setup-support:qualify` concurrently with Playwright.

## Working agreements

- Measure every visual claim: pixel-sampled contrast (text ≥ 4.5:1, components ≥ 3:1), type census, target sizes, light and motion census. A mock is not done until it passes in all three themes.
- Real labels and states only, from the fixtures and the brief; never a state the engine cannot report.
- Docs and mocks may be written freely; source, tokens and tests wait for approval. Commit only when the operator asks; one commit per slice when implementing.
- Avoid running many agents in parallel (rate limits were hit before).
- Copy is written for the person at the desk: TotalMix, the desk, the bridge, the deck; never engine, backend, transport, snapshot (except the audio scene primitive), IPC.

## First deliverable

1. Read this file, the product brief, the review's §3 and §4, and the memory notes `frontend-ux-session-primer` and `gold-standard-ui-session-2026-09`.
2. Look at the current program at 1:1: the `2560x1440` Studio captures of `audio-populated`, `lighting-populated`, `planning-populated`, `setup-ready`, and the prior candidate's renders in `mocks-v1.1/`.
3. Produce three to five genuinely different concepts for the Audio Console at `2560x1440`, one self-contained HTML mock each under `docs/redesign/assets/concepts/`, rendered at 1:1 with the probe and measured; concepts that differ in composition, hierarchy and material logic, not skins. For each: two sentences (what it gives the operator at a glance; what it costs), the measured numbers, and a recommendation. The prior candidate may be one of them only if it is re-argued.
4. Stop for the operator's choice. Then: the blocked states, Lighting, Planning, Setup, `1920x1080` and `1280x800`, the three themes, the system behind it, and a revised sliced plan.
