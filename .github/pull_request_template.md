## Summary

<!-- What changed? Keep this operator-focused and concrete. -->

## Why

<!-- Why was this change needed? What problem, risk, or workflow does it address? -->

## Risks

<!-- What could regress? Note any hardware, operator, migration, or packaging risk. -->

## Validation

> Required CI runs the ten `dev-checks` jobs (format/lint/typecheck/cargo plus `frontend-e2e`, `frontend-test`, `tauri-foundation`, `qualification` and the rest) once per pushed commit; the PR reads the checks on its head commit. **Target-host evidence below remains the release acceptance gate** — CI does not replace release-host verification.

- [ ] `npm run doctor`
- [ ] `npm run dev:check`
- [ ] `npm run format:check`
- [ ] `npm run native:check` and `npm run native:test` when engine logic changed
- [ ] `npm run frontend:foundation` when selected Tauri frontend logic or layout changed
- [ ] `npm run tauri:foundation` when selected Tauri shell integration changed
- [ ] `npm run native:foundation` when selected shipping-runtime startup or shell integration changed
- [ ] `npm run native:acceptance` when native persistence, recovery, or release-critical behavior changed
- [ ] `npm run native:test:hardware` when device-bound (`#[ignore]`) Rust tests should be exercised on a connected workstation
- [ ] `npm run doctor:release` and `npm run release:verify` when preparing a tagged release
- [ ] Target-host release evidence recorded when packaging/release behavior changed
- [ ] Manual validation completed for affected hardware / live workflows

GitHub Actions are merge hygiene, not release acceptance evidence. Record local and target-host evidence here.

## Visual review

> CI compares no screenshots: the captures are the win32 ones at `2560x1440`, and `npm run frontend:playwright:test` compares them, with the UI contract, on the studio workstation before each push. A change that moves a board refreshes its captures there and every changed PNG is inspected before `git add` (`docs/DEVELOPMENT.md §2b`).

- [ ] `npm run frontend:playwright:test` passed on the studio workstation before the push (operator-visible surface changed → changed captures refreshed and inspected; otherwise → tick "no operator-visible surface changed")
- [ ] No operator-visible surface changed
- [ ] Studio-monitor manual inspection completed on the fixed `2560x1440` second monitor — required for operator-visible changes per `AGENTS.md §Visual Review Discipline`
- [ ] Hardware code paths touched? If yes, link the workstation pass record for `npm run native:test:hardware` here:

## Product Areas

- [ ] Lighting
- [ ] Audio
- [ ] Setup / commissioning
- [ ] Stream Deck / Companion
- [ ] Native shell / packaging / updater

## Rescope check

> Sliced-plan rescope discipline (`AGENTS.md §Rescope protocol`). If the PR title implies one slice but the diff lands a substitute, edit the plan doc, re-title the slice, and log a Follow-up entry **before** merging.

- [ ] Does the diff match the PR title? (If not, plan doc + Follow-up updated in this PR.)

## Screenshots or Recording

<!-- Include before/after screenshots or a short clip for UI and operator workflow changes. -->

## Documentation

- [ ] README or docs updated when behavior or setup changed
- [ ] `CHANGELOG.md` updated for user-facing changes
