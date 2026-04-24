## Summary

<!-- What changed? Keep this operator-focused and concrete. -->

## Why

<!-- Why was this change needed? What problem, risk, or workflow does it address? -->

## Risks

<!-- What could regress? Note any hardware, operator, migration, or packaging risk. -->

## Validation

- [ ] `npm run format:check`
- [ ] `npm run native:check` and `npm run native:test` when engine logic changed
- [ ] `npm run frontend:foundation` when selected Tauri frontend logic or layout changed
- [ ] `npm run tauri:foundation` when selected Tauri shell integration changed
- [ ] `npm run native:foundation` when selected shipping-runtime startup or shell integration changed
- [ ] `npm run native:qt:foundation` only when retained Qt fallback behavior changed during Checkpoint D
- [ ] `npm run native:acceptance` when native persistence, recovery, or release-critical behavior changed
- [ ] `npm run release:check` when preparing a tagged release
- [ ] Manual validation completed for affected hardware / live workflows

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
