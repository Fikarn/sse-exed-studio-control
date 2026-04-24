import type { JsonObject } from "../generated/protocol";
import type { RecoveryState } from "../types";

export function deriveRecoveryState(healthSnapshot: JsonObject | null): RecoveryState {
  const status = typeof healthSnapshot?.status === "string" ? healthSnapshot.status : "ok";

  if (status === "error") {
    return "recovery";
  }

  if (status === "attention" || status === "warning") {
    return "degraded";
  }

  return "healthy";
}
