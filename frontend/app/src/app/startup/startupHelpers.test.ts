import { describe, expect, it } from "vitest";

import { formatFailureCode, formatFailureMeta, formatFailureStage, getFailureTitle } from "./startupHelpers";

// 2026-09 production readiness, Slice 3 (finding F02): the two saved-data
// codes the engine raises at start-up read as what they are — the operator's
// data needs attention, not "startup failed" — and the engine's sentence,
// printed verbatim by the recovery display, carries the way out ("Restore a
// backup from Setup / Support").
describe("startupHelpers failure copy", () => {
  it("formats STORAGE_CORRUPT", () => {
    const failure = {
      code: "STORAGE_CORRUPT",
      message: "The saved data file failed its integrity check. Restore a backup from Setup / Support.",
      stage: "bootstrap",
    };

    expect(getFailureTitle(failure)).toBe("Saved data damaged");
    expect(formatFailureCode(failure)).toBe("Saved data check failed");
  });

  it("formats STORAGE_MIGRATION_FAILED", () => {
    const failure = {
      code: "STORAGE_MIGRATION_FAILED",
      message: "The saved data file could not be upgraded. Restore a backup from Setup / Support.",
      stage: "bootstrap",
    };

    expect(getFailureTitle(failure)).toBe("Saved data damaged");
    expect(formatFailureCode(failure)).toBe("Saved data upgrade failed");
  });

  // The visual overhaul's polish (2026-10-05): BOOTSTRAP_FAILED read
  // "Bootstrap failed", a word the screen does not use.
  it("keeps the generic title and names a bootstrap failure in the screen's words", () => {
    const failure = { code: "BOOTSTRAP_FAILED", message: "Could not create the logs directory.", stage: "bootstrap" };

    expect(getFailureTitle(failure)).toBe("Startup failed");
    expect(formatFailureCode(failure)).toBe("Startup failed");
    expect(formatFailureStage(failure.stage)).toBe("startup");
    expect(formatFailureCode({ code: "SOME_NEW_CODE", message: "", stage: "bootstrap" })).toBe("Some new code");
    expect(getFailureTitle(null)).toBe("Startup failed");
    expect(formatFailureCode(null)).toBe("Startup failed");
  });

  // 2026-09 production readiness, Slice 5 (findings F09, F19): the link that
  // stopped during a session and the second copy of the app that was refused
  // read as what they are, in the operator's words.
  it("formats ENGINE_EXITED", () => {
    const failure = {
      code: "ENGINE_EXITED",
      message: "The hardware link stopped unexpectedly (exit status 1).",
      stage: "runtime",
    };

    expect(getFailureTitle(failure)).toBe("Link stopped");
    expect(formatFailureCode(failure)).toBe("Hardware link stopped");
    expect(formatFailureStage(failure.stage)).toBe("running");
  });

  it("formats ENGINE_ALREADY_RUNNING", () => {
    const failure = {
      code: "ENGINE_ALREADY_RUNNING",
      message: "Studio Control is already open on this workstation.",
      stage: "bootstrap",
    };

    expect(getFailureTitle(failure)).toBe("Already open");
    expect(formatFailureCode(failure)).toBe("Already open");
  });
});

// The visual overhaul's polish (2026-10-05): the recovery display's meta line
// says the one fact its word does not, and fits the 30 characters beside
// Retry startup (the owner's rule for the state display, 2026-10-05). It read
// `<code> · at <stage>`, which repeated the word and ran past the room.
describe("the recovery display's meta line", () => {
  const meta = (code: string, stage: string) => formatFailureMeta({ code, message: "", stage });

  it("names the step where it is not the start itself", () => {
    expect(meta("PROTOCOL_MISMATCH", "protocol-negotiation")).toBe("At the version check");
    expect(meta("ENGINE_EXITED", "runtime")).toBe("While running");
  });

  it("names what failed where the word does not say it", () => {
    expect(meta("STORAGE_CORRUPT", "bootstrap")).toBe("Saved data check failed");
    expect(meta("STORAGE_MIGRATION_FAILED", "bootstrap")).toBe("Saved data upgrade failed");
    expect(meta("ENGINE_READY_TIMEOUT", "ready-event")).toBe("Startup timed out");
  });

  it("says nothing the word and Retry startup already say", () => {
    expect(meta("BOOTSTRAP_FAILED", "bootstrap")).toBeUndefined();
    expect(meta("ENGINE_STARTUP_FAILED", "frontend-bootstrap")).toBeUndefined();
    expect(meta("ENGINE_ALREADY_RUNNING", "bootstrap")).toBeUndefined();
    expect(formatFailureMeta(null)).toBeUndefined();
  });

  it("fits the room beside the way-out key", () => {
    for (const [code, stage] of [
      ["PROTOCOL_MISMATCH", "protocol-negotiation"],
      ["ENGINE_EXITED", "runtime"],
      ["STORAGE_CORRUPT", "bootstrap"],
      ["STORAGE_MIGRATION_FAILED", "bootstrap"],
      ["ENGINE_READY_TIMEOUT", "ready-event"],
    ] as const) {
      expect((meta(code, stage) ?? "").length, code).toBeLessThanOrEqual(30);
    }
  });
});
