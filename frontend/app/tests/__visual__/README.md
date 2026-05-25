# Visual baselines

Committed Playwright `toHaveScreenshot` baselines for the operator shell. The
diff gate runs on every PR via the `frontend-e2e` job in
[`.github/workflows/dev-checks.yml`](../../../../.github/workflows/dev-checks.yml).

## Layout

```
__visual__/<spec-filename>-snapshots/<arg>-<platform>.png
```

`<platform>` is the value of Node's `process.platform` (`darwin`, `linux`,
`win32`). The path layout is controlled by `snapshotPathTemplate` in
[`playwright.config.ts`](../../playwright.config.ts).

## Why platform-suffixed?

Chromium's font and antialiasing pipeline differs between macOS (local dev)
and Linux (CI), so committing a single PNG would either fail locally or fail
in CI. Each platform owns the baseline files it generates.

In practice this repo's contributors land in one of two buckets:

- **macOS** — `npm run frontend:playwright:test` validates the `*-darwin.png`
  baselines.
- **Linux / CI** — the GitHub Actions runner validates the `*-linux.png`
  baselines.

## Refreshing baselines

When an intentional UI change lands, regenerate baselines and commit the new
PNGs:

```sh
cd frontend/app
npm exec playwright test visual-review.spec.ts -- --update-snapshots
```

This rewrites baselines for the current platform only. The other platform's
baselines refresh when CI (or a contributor on that OS) reruns with
`--update-snapshots` — usually as a separate commit on the same PR.

## Bootstrapping a missing platform

The first PR to introduce visual baselines (`plan PR 1`) committed macOS
baselines. The first CI run on Linux fails because no `*-linux.png` exists;
Playwright writes the new screenshots into `frontend/app/test-results/` which
the `frontend-e2e` job uploads as an artifact. Download that artifact, copy
the `*-actual.png` files into this folder renamed to drop the `-actual`
suffix, and push as a follow-up commit. The second CI run then validates
against them.
