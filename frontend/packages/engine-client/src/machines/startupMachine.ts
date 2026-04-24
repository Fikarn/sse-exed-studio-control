import type { StartupLifecycleState } from "../generated/protocol";

export type StartupEvent =
  | { type: "spawned" }
  | { type: "process-launched" }
  | { type: "ready-event-received" }
  | { type: "health-loaded" }
  | { type: "app-loaded" }
  | { type: "failed" };

export function transitionStartupState(
  current: StartupLifecycleState,
  event: StartupEvent,
): StartupLifecycleState {
  if (event.type === "failed") {
    return "failed";
  }

  switch (current) {
    case "idle":
      return event.type === "spawned" ? "launching-process" : current;
    case "launching-process":
      return event.type === "process-launched" ? "waiting-for-ready-event" : current;
    case "waiting-for-ready-event":
      return event.type === "ready-event-received" ? "waiting-for-health-snapshot" : current;
    case "waiting-for-health-snapshot":
      return event.type === "health-loaded" ? "waiting-for-app-snapshot" : current;
    case "waiting-for-app-snapshot":
      return event.type === "app-loaded" ? "ready" : current;
    default:
      return current;
  }
}
