import { describe, expect, it } from "vitest";

import { deriveRecoveryState } from "./recoveryMachine";

// 2026-09 production readiness, Slice 8 (finding F14): the hardware link's
// health status now moves — `attention` when a port could not be bound,
// `warning` when the last database backup failed or is old, `error` when the
// saved data is unusable — so the mapping this module always had is
// reachable, and pinned here.
describe("deriveRecoveryState", () => {
  it("attention → degraded", () => {
    expect(deriveRecoveryState({ status: "attention" })).toBe("degraded");
  });

  it("warning → degraded", () => {
    expect(deriveRecoveryState({ status: "warning" })).toBe("degraded");
  });

  it("error → recovery", () => {
    expect(deriveRecoveryState({ status: "error" })).toBe("recovery");
  });

  it("ok → healthy", () => {
    expect(deriveRecoveryState({ status: "ok", summary: "Health 'ok'." })).toBe("healthy");
  });

  it("a missing or unknown status is healthy", () => {
    expect(deriveRecoveryState(null)).toBe("healthy");
    expect(deriveRecoveryState({})).toBe("healthy");
    expect(deriveRecoveryState({ status: 7 })).toBe("healthy");
    expect(deriveRecoveryState({ status: "starting" })).toBe("healthy");
  });
});
