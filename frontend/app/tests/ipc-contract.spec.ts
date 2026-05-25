import { expect, test } from "@playwright/test";
import { EVENT_NAMES, REQUEST_METHODS } from "@sse/engine-client";
import { readFileSync } from "node:fs";

// plan PR 5 / workstream D7 (variant a).
//
// Asserts the IPC contract in `native/protocol/v1.contract.json` is in
// sync with the generated TypeScript constants in
// `frontend/packages/engine-client/src/generated/protocol.ts`. These
// constants are produced by `npm run protocol:generate`; the `protocol:check`
// lane verifies the generated FILE is up-to-date relative to the contract
// JSON, but it does not separately verify that the EXPORTED arrays match
// the contract's method / event lists — that's this spec's job.
//
// Variant (b) (drive the real engine subprocess through every method via
// the `scripts/native-runtime-harness.mjs` pattern) is deferred to a
// follow-up: it overlaps with the assertions already made by
// `native:acceptance` + the workspace qualification, and adding it here
// would duplicate the spawn/harness plumbing those lanes already maintain.

interface Contract {
  version: string;
  methods: readonly string[];
  events: readonly string[];
}

const contractPath = new URL("../../../native/protocol/v1.contract.json", import.meta.url);
const contract = JSON.parse(readFileSync(contractPath, "utf-8")) as Contract;

test("contract methods are mirrored by REQUEST_METHODS exactly", () => {
  const contractMethods = [...contract.methods].sort();
  const generatedMethods = [...REQUEST_METHODS].sort();

  // Compare full arrays. The custom diff message points at the exact drift.
  expect(generatedMethods).toEqual(contractMethods);

  // Sanity: assert the count matches the contract so a typo doesn't slip
  // by via duplicate entries on one side.
  expect(generatedMethods.length).toBe(contract.methods.length);
  expect(new Set(generatedMethods).size).toBe(generatedMethods.length);
  expect(new Set(contractMethods).size).toBe(contractMethods.length);
});

test("contract events are mirrored by EVENT_NAMES exactly", () => {
  const contractEvents = [...contract.events].sort();
  const generatedEvents = [...EVENT_NAMES].sort();

  expect(generatedEvents).toEqual(contractEvents);
  expect(generatedEvents.length).toBe(contract.events.length);
  expect(new Set(generatedEvents).size).toBe(generatedEvents.length);
  expect(new Set(contractEvents).size).toBe(contractEvents.length);
});

test("protocol version constant tracks the contract version", async () => {
  const { PROTOCOL_VERSION } = await import("@sse/engine-client");
  expect(PROTOCOL_VERSION).toBe(contract.version);
});
