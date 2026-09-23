# Session prompt — implement Visual overhaul A (written 2026-09-07 for the implementing session)

> **Historical (2026-09-07).** The prompt that started the implementing session. All thirteen slices have landed; see [visual-overhaul-a-2026-09.md](visual-overhaul-a-2026-09.md). Kept as the record of the constraints the implementation was held to.

Paste everything below the line into the new session. The operator may edit the bracketed lines first.

---

Implement the approved visual overhaul of SSE ExEd Studio Control, Slice 0 onward, on branch `ui-gold-standard-2026-09` in `C:\Users\Stora Studion\Desktop\Studio Control Rev 1\sse-exed-studio-control\`. You are the front-end engineer for this plan; the design is finished and approved, and your job is to land it slice by slice, measured, with the design system and tokens as the only vehicle.

**Read first, in this order, before touching anything**

1. `AGENTS.md` — the workflow, the architecture boundary, the command map, the visual-review discipline and the rescope protocol. It wins over `CLAUDE.md`.
2. `docs/plans/visual-overhaul-a-2026-09.md` — the plan. The operator approved decisions D1–D14 on 2026-09-07 (D4: `2560×1440` is the only surface; D9 withdrawn). The five non-negotiables at the top are binding. Each slice has Scope, Gates before / after, Tests added / changed, Baselines, CHANGELOG and the commit line.
3. `docs/redesign/system-a-2026-09.md` — the system: the cluster rule, type, colour roles, material v2, copy, motion, and §10, the gates.
4. `docs/redesign/system/tokens-a-2026-09.css` and `.json` — the token proposal that Slice 1 moves into `frontend/packages/tokens/src/tokens/core.json`.
5. The mocks, which are the spec: `docs/redesign/assets/concepts/A-cockpit.html` (`?state=ready|armed|assumed|stale|not-verified|offline|disconnected|disabled|action-failed|talkback-refused&theme=studio|graphite|bone`), `A-lighting.html` (`?state=ready|unreachable|unsaved|preview`), `A-planning.html`, `A-setup.html` (`?state=ready|degraded|setup-required`), `A-system-sheet.html` (the specimen). Open them in the Browser pane at 2560×1440 and press `1` for 1:1. Ignore `?vw=`; the smaller layouts are a fallback, not a deliverable.
6. `docs/redesign/polish-a-2026-09.md`, `console-a-states-2026-09.md`, `workspaces-a-2026-09.md`, `console-concepts-2026-09.md` — the reasoning behind the mocks, with the numbers.
7. `docs/redesign/claude-design-product-brief-2026-09.md` — the facts about the product; the only source of requirements.
8. The evidence and the probes, outside git: `C:\Users\Stora Studion\Desktop\Studio Control Rev 1\gold-standard-evidence-2026-09\concepts\` (69 boards, `census.md`, `contrast.md`) and `…\gold-standard-evidence-2026-09\probe\` (`concepts.mjs`, `concept_contrast.py`, `contrast.py`, `cropfails.py`). Slice 0 turns these into repository gates. They load Playwright 1.60 with `createRequire` from the app's `package.json`; the Python sampler needs Pillow, which is installed on this PC.
9. Your memory directory for this project (`frontend-ux-session-primer`, `studio-workstation-setup`, `console-concepts-2026-09`) — the map of the front-end, the fixture URLs and the workstation quirks.

**Facts about the machine and the repo**

- This PC is the real studio workstation. Node 24.20.0 via nvm-windows; if `node` disappears from PATH the junction `C:\nvm4w\nodejs` must be recreated to `C:\Users\Stora Studion\AppData\Local\nvm\v24.20.0` (see the workstation memory note). Never run `nvm use`.
- The fixture dev server for the Browser pane is `frontend-fixture-dev` in `C:\Users\Stora Studion\Desktop\Studio Control Rev 1\.claude\launch.json` (port 4180). Any fixture opens at `/?fixture=<id>&transport=fixture&theme=studio|graphite|bone`; the 27 fixtures are in `frontend/packages/test-fixtures/src/fixtures.json`.
- Verification lanes, fast to full: `npm run frontend:typecheck` → `npm run frontend:test` → `npm run build --workspace frontend/app` **before** any Playwright run (the specs serve `dist`; a stale dist silently tests old code) → `cd frontend/app && npx playwright test <specs>` → `npm run frontend:storybook:build` then `npx playwright test visual-review.spec.ts storybook.spec.ts` → `npm run dev:check`. Never run `tauri:setup-support:qualify` while Playwright runs; both bind 4173.
- The branch already holds the previous design commit (`544182d`). The A deliverables are **uncommitted**: `docs/plans/visual-overhaul-a-2026-09.md`, this prompt, `docs/redesign/{console-concepts,console-a-states,workspaces-a,viewports-a,system-a,polish-a}-2026-09.md`, `docs/redesign/system/`, `docs/redesign/assets/concepts/`, and the modified `docs/redesign/visual-overhaul-handoff-2026-09.md`.

**Working agreements (binding)**

- Commit policy: [stop at the end of every slice, show me the evidence, and commit only when I say "commit"]. One commit per slice with a What / Why / Tests / Verified body, the commit line from the plan; baseline refreshes as their own `A S<N> (baselines): …` commit after every changed PNG has been inspected.
- Step 0, before Slice 0: commit the uncommitted design deliverables listed above as one docs commit, `Gold standard A: concepts, states, workspaces, system, tokens proposal, polish, plan, session prompt`. [I ask for that commit now.]
- The front-end never displays a state the engine does not report. Where a mock shows more than the snapshot carries (plan §Boundary, F1–F4), show the engine's own words and counts until the contract carries the field.
- Measure every visual claim with the gates, never by eye alone: pixel-sampled contrast ≥ 4.5:1 for text and ≥ 3:1 for lamps, keylines and key edges, in all three themes; type floor 12 px and ≤ 8 sizes per board; targets ≥ 24 px, take-time ≥ 28 px; radii ⊆ {4, 8, 12, pill}; no negative shadow offsets, blur > 8 px only on lit elements; zero idle animations; chrome heights within 2 px of D4. A slice does not close with a number moving the wrong way.
- Existing behaviour tests move with a changed contract; none is deleted. Record every moved assertion as old → new → reason in the slice's status line. Test ids (`data-testid="audio-…"`, `lighting-…`, `planning-…`, `setup-…`, `[data-toolbar-primary]`) are extended, never renamed. The existing 1920 / 1280 guards stay as fallback guards.
- Copy is written for the person at the desk: never "engine", "backend", "transport", "IPC", "snapshot" (outside the audio scene primitive), never a raw `AUDIO_*` code as the first line. Use the engine's state words (`VERIFIED`, `NOT VERIFIED`, `ASSUMED`, `STALE`, `OFFLINE`, `DISCONNECTED`, `DISABLED`, `ACTION FAILED`, `TALKBACK REFUSED`, `SIMULATED`; lighting `REACHABLE` / `UNREACHABLE` / `UNSAVED` / `PREVIEW`; setup `READY` / `DEGRADED` / `SETUP REQUIRED`).
- Any departure from a slice's written scope gets a bold `*Rescoped:*` note in its status line before the commit, per `AGENTS.md`. Ask me before a rescope that changes what the operator sees.
- Run one agent at a time; parallel agents hit the rate limit on this account. Do the work in the main session where you can.
- Do not push. Do not touch the engine, the protocol, the deck assets or Companion (F1–F4 are follow-ups for me).

**Order of work**

Step 0 (the docs commit) → S0 measurement lanes (seed the ratchets at the current program's numbers and report them) → S1 tokens and themes → S2 shell skeleton → S3 primitives → S4 Console → S5 Lighting → S6 Planning → S7 Setup / Support and the pre-ready surfaces → S8 copy pass → S9 calm surfaces, light and motion → S10 Graphite and Bone everywhere → S11 close-out (aliases removed, Appendix A gate map verified, Appendix B checklist ready for me to walk in the studio).

**At the end of every slice, report in this shape**

1. What landed, in the operator's words, with one 2560×1440 screenshot of the touched fixture next to the matching mock state.
2. The numbers that moved, before → after, from `ui-contract` and the census.
3. Tests added, and every test moved as old → new → reason.
4. What is not done and why.
5. The plan's `Status:` line updated, the CHANGELOG bullet written, baselines inspected.

Then stop and wait for me. Begin with Step 0, then Slice 0.
