# Captures

Committed Playwright screenshots of the app's pages (`visual-review.spec.ts`) and of the Storybook stories (`storybook.spec.ts`), at 2560×1440 on Windows, the one system Studio Control runs on.

A page's capture is its workspace: the header and the footer are masked there, and captured once, as strips (`header-*`, `footer-*`).

## Layout

```
__visual__/<spec-filename>-snapshots/<name>-win32.png
```

The `-win32` suffix is Node's `process.platform`, added by `snapshotPathTemplate` in [`playwright.config.ts`](../../playwright.config.ts).

## Where they are compared

On the studio workstation, by `npm run frontend:playwright:test` (part of `npm run check`).

CI compares none of them: its runner is Linux, where `ignoreSnapshots` is on. Every other check in those specs runs there as everywhere.

## Refreshing

Only for a change that is meant to move them:

1. `npm run build --workspace frontend/app && npm run frontend:storybook:build`
2. `cd frontend/app && npx playwright test visual-review.spec.ts storybook.spec.ts --update-snapshots=changed`
3. Look at every changed picture before `git add`.

A capture whose case goes is deleted with it.
