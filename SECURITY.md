# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly using [GitHub's private vulnerability reporting](https://github.com/Fikarn/sse-exed-studio-control/security/advisories/new).

**Please do not open a public issue for security vulnerabilities.**

You can expect an initial response within 72 hours. Once confirmed, a fix will be prioritized and released as soon as possible.

## Scope

This application is designed for **local-only use** on a single trusted studio workstation. It has no public network exposure and no user accounts. Security concerns most relevant to this project include:

- Path traversal or unsafe file handling in engine persistence and backup/restore paths
- Unsafe DMX side effects triggered by malformed engine input (lighting safety)
- Unsafe OSC side effects triggered by malformed engine input (audio safety)
- Denial of service affecting the DMX/lighting or audio control paths
- Unsafe behavior in the local control-surface bridge that binds `127.0.0.1`
- Supply-chain or release-signing issues affecting the native installer, update repository, or packaged Tauri/Rust binaries

## What protects the workstation

These are the controls in place since the 2026-09 production readiness program (`docs/plans/production-readiness-2026-09.md`, findings F01–F32); each is held by a named test or lane there.

- **The Stream Deck bridge authenticates every request** (Slice 2). The engine's local HTTP bridge (`127.0.0.1`, port `38201` by default) creates a 64-hex-character token once per install (`control-surface.token` in the app-data directory, owner-only on Unix) and refuses any request without `Authorization: Bearer <token>` (`401`, compared in constant time), any request with an `Origin` header — a browser page (`403`) — and any request whose `Host` is not the bridge's own loopback address (`400`), before the body is read. The exported Companion profile carries the token on every action and LCD poll; the token is never shown on screen and is not in a diagnostics export, so the profile file is the one place outside the app-data directory that holds it. `SSE_CONTROL_SURFACE_TOKEN` overrides the file for test lanes only.
- **The bridge takes only what it can afford** (Slice 2): headers over 8 KiB (`431`) and bodies over 16 KiB (`413`) are refused, a body without a length or with chunked encoding is refused (`411`), a request that does not finish within one second is dropped (`408`), and a fixed pool of four workers answers `503` instead of starting a thread per connection once its queue of sixty-four is full. The queue is sized for the deck's worst moment, the exported profile's once-a-second LCD poll meeting the key that sends the most requests; it was sixteen until 2026-09-22, which refused part of every poll. Refusals are logged at most once per status per minute, and each line counts the refusals it stands for. The request reader and the query decoder have property tests over generated input (Slice 13).
- **The TotalMix OSC ports listen on loopback and read only TotalMix** (Slice 6). The four metering receive ports bind `127.0.0.1` when the TotalMix address in Setup is `127.0.0.1` or `localhost` (every interface only when TotalMix runs on another machine), and only datagrams from that address are read; anything else is dropped and logged once a minute per source. The OSC ingest has property tests too (Slice 13).
- **The shell opens and writes only inside its own folders** (Slice 4): the packaged app runs under a Content Security Policy with no inline or remote scripts, the folder keys can open only the app-data, logs, backups, exports and update folders (`PATH_OUTSIDE_APP_DATA` otherwise), a diagnostics export always lands in `<app-data>/exports`, and a restore reads only from the backups folder (Slice 7).
- **Nothing meant for development ships** (Slice 1): the method that loads a parity database over the operator's data is compiled only into engines built with the `dev-fixtures` feature, the engine no longer imports a `db.json` from its working directory, and the front-end dev server binds `127.0.0.1`.
- **The saved data is checked and backed up** (Slices 3, 7): an integrity check at every start, verified database backups before a schema upgrade, daily and at every graceful close, and every commit waits for the disk.
- **Dependencies are checked on every push** (Slice 12): the `supply-chain` CI job runs `npm audit` for every lockfile against `scripts/npm-audit-allowlist.json` (entries expire within 90 days) and `cargo deny check` against `native/deny.toml` (advisories, licences, bans and sources; its one ignored advisory carries a review date). A `v*` tag runs `release-evidence.yml`, which builds the packaged bundle on clean runners with a SHA256 manifest and CycloneDX SBOMs of what it carries.

Not in place, by decision: the installers and bundles are **unsigned** — signing is wired into the release evidence workflow and dormant until certificate secrets exist (`docs/RELEASE.md`, Optional Signing), and the deployment remains a controlled install on the one studio workstation.
