import { describe, expect, it } from "vitest";

import { formatFailureCode, getFailureTitle } from "./startupHelpers";

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
});
