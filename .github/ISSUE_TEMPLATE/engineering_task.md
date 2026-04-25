---
name: Engineering task
about: Plan and execute scoped engineering work
labels: maintenance
---

**Plan anchor**

Link the checked-in plan, runbook, ADR, or issue that defines the work. If none exists, explain why this task is the source of truth.

**Problem**

What needs to change, and why now?

**Scope**

- [ ] Frontend / selected Tauri shell
- [ ] Rust engine / persistence
- [ ] Protocol contract
- [ ] Packaging / release / updater
- [ ] Documentation / workflow / repo hygiene
- [ ] Hardware-facing behavior

**Non-scope**

List anything that must not change in this task.

**Risk**

- Operator risk:
- Persistence or migration risk:
- Hardware/device risk:
- Release/installer risk:

**Validation plan**

- [ ] `npm run doctor`
- [ ] `npm run dev:check`
- [ ] `npm run frontend:foundation` if frontend behavior/layout changed
- [ ] `npm run tauri:foundation` if selected shell integration changed
- [ ] `npm run native:foundation` if startup/runtime behavior changed
- [ ] `npm run release:verify` if release/package metadata changed
- [ ] Target-host evidence required
- [ ] Manual hardware/operator verification required

**Target-host evidence**

If required, state the host, command, expected evidence folder, and issue where the summary will be attached.

**Acceptance criteria**

- [ ] Current truth docs updated
- [ ] Validation evidence recorded
- [ ] Worktree clean after generated artifacts are handled
