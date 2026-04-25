## Summary

<!-- What changed? Keep this operator-focused and concrete. -->

## Why

<!-- Why was this change needed? What problem, risk, or workflow does it address? -->

## Risks

<!-- What could regress? Note any hardware, operator, migration, or packaging risk. -->

## Validation

- [ ] `npm run doctor`
- [ ] `npm run dev:check`
- [ ] `npm run format:check`
- [ ] `npm run native:check` and `npm run native:test` when engine logic changed
- [ ] `npm run frontend:foundation` when selected Tauri frontend logic or layout changed
- [ ] `npm run tauri:foundation` when selected Tauri shell integration changed
- [ ] `npm run native:foundation` when selected shipping-runtime startup or shell integration changed
- [ ] `npm run native:acceptance` when native persistence, recovery, or release-critical behavior changed
- [ ] `npm run doctor:release` and `npm run release:verify` when preparing a tagged release
- [ ] Target-host release evidence recorded when packaging/release behavior changed
- [ ] Manual validation completed for affected hardware / live workflows

GitHub Actions are intentionally not the acceptance gate for this repo. Record local and target-host evidence here.

## Product Areas

- [ ] Planning / dashboard
- [ ] Lighting
- [ ] Audio
- [ ] Setup / commissioning
- [ ] Stream Deck / Companion
- [ ] Native shell / packaging / updater

## Screenshots or Recording

<!-- Include before/after screenshots or a short clip for UI and operator workflow changes. -->

## Documentation

- [ ] README or docs updated when behavior or setup changed
- [ ] `CHANGELOG.md` updated for user-facing changes
