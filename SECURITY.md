# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly using [GitHub's private vulnerability reporting](https://github.com/Fikarn/sse-exed-studio-control/security/advisories/new).

**Please do not open a public issue for security vulnerabilities.**

You can expect an initial response within 72 hours. Once confirmed, a fix will be prioritized and released as soon as possible.

## Scope

This application is designed for **local-only use** on a single trusted studio workstation. There is no public network exposure and no authentication layer. Security concerns most relevant to this project include:

- Path traversal or unsafe file handling in engine persistence and backup/restore paths
- Unsafe DMX side effects triggered by malformed engine input (lighting safety)
- Unsafe OSC side effects triggered by malformed engine input (audio safety)
- Denial of service affecting the DMX/lighting or audio control paths
- Unsafe behavior in the local control-surface bridge that binds `127.0.0.1`
- Supply-chain or release-signing issues affecting the native installer, update repository, or packaged Qt/Rust binaries
- Unsafe handling of the one-way legacy `db.json` importer during first-launch migration
