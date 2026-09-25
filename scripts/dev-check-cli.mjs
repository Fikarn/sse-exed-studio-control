// `npm run dev:check` (scripts/dev-check.mjs). The command line lives in a
// file of its own, so it always runs: a "am I the main module?" check in
// dev-check.mjs was false when the checkout was reached through a junction,
// and the gate then passed without running anything (review of 2026-09-25).

import process from "node:process";

import { main } from "./dev-check.mjs";

process.exitCode = await main(process.argv.slice(2));
