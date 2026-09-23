import { describe, expect, it } from "vitest";

import { formatFailureCode, formatFailureStage, getFailureTitle } from "./startupHelpers";

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

    expect(getFailureTitle(failure)).toBe("Saved data needs attention");
    expect(formatFailureCode(failure)).toBe("Saved data check failed");
  });

  it("formats STORAGE_MIGRATION_FAILED", () => {
    const failure = {
      code: "STORAGE_MIGRATION_FAILED",
      message: "The saved data file could not be upgraded. Restore a backup from Setup / Support.",
      stage: "bootstrap",
    };

    expect(getFailureTitle(failure)).toBe("Saved data needs attention");
    expect(formatFailureCode(failure)).toBe("Saved data upgrade failed");
  });

  it("keeps the generic title and humanized code for other failures", () => {
    const failure = { code: "BOOTSTRAP_FAILED", message: "Could not create the logs directory.", stage: "bootstrap" };

    expect(getFailureTitle(failure)).toBe("Startup failed");
    expect(formatFailureCode(failure)).toBe("Bootstrap failed");
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

    expect(getFailureTitle(failure)).toBe("The hardware link stopped");
    expect(formatFailureCode(failure)).toBe("Hardware link stopped");
    expect(formatFailureStage(failure.stage)).toBe("running");
  });

  it("formats ENGINE_ALREADY_RUNNING", () => {
    const failure = {
      code: "ENGINE_ALREADY_RUNNING",
      message: "Studio Control is already open on this workstation.",
      stage: "bootstrap",
    };

    expect(getFailureTitle(failure)).toBe("Studio Control is already open");
    expect(formatFailureCode(failure)).toBe("Already open");
  });
});
