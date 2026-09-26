# Visual baselines

Committed Playwright `toHaveScreenshot` captures of the operator shell
(`visual-review.spec.ts`) and of every Storybook story (`storybook.spec.ts`).
Studio Control runs on Windows at 2560×1440 and nowhere else (decision D22,
new pages program, Slice SW), so these are the win32 captures at 2560×1440 and
nothing else.

## Layout

```
__visual__/<spec-filename>-snapshots/<arg>-win32.png
```

The `-win32` suffix is Node's `process.platform`, added by `snapshotPathTemplate`
in [`playwright.config.ts`](../../playwright.config.ts). There are 59:

- `visual-review.spec.ts-snapshots/` — 19: Setup, the recovery screen
  (`protocol-mismatch`), Lighting and the Console at 2560×1440, the same four
  in Graphite and Bone, and seven designed states (Lighting empty and
  unreachable, Setup degraded, the Console's four warning bands).
- `storybook.spec.ts-snapshots/` — 40: one per story; the shell stories paint
  full 2560×1440 frames.

## Where they are compared

On the Windows workstation, by the local Playwright lane, before every push:
`npm run frontend:playwright:test` (it builds the app and Storybook first).

CI compares none of them. Its `frontend-e2e` job runs on a Linux runner, where
`ignoreSnapshots` is on (`playwright.config.ts`), `storybook.spec.ts` is
skipped, and the UI contract takes no screenshot and samples no contrast
(`helpers/ui-contract/measure.mjs`). Every other check in those specs runs
there as everywhere.

## Refreshing captures

Only for a change that is meant to move them, and only for the captures it
explains:

1. Build first: `npm run build --workspace frontend/app && npm run frontend:storybook:build`.
2. Run the lane; copy the `*-diff.png` files out of `frontend/app/test-results/`
   before the update run replaces them.
3. `cd frontend/app && npm exec playwright test visual-review.spec.ts storybook.spec.ts -- --update-snapshots=changed`
4. Inspect every changed PNG before `git add`, and commit the captures on their
   own.

A capture whose case goes is deleted with it. Never run Playwright and a
qualification lane at the same time.
