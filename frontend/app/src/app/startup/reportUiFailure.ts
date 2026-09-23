import type { ShellStore } from "@sse/engine-client";

// 2026-09 production readiness, Slice 9 (finding F10): a render error can
// reach the background-failure ring twice — from the boundary that caught it
// and from the window's "error" listener, which hears the same error object
// whenever React reports it there. Each error object is recorded once,
// whoever sees it first.
const recorded = new WeakSet<object>();

type FailureSink = Pick<ShellStore, "reportBackgroundFailure">;

export function reportUiFailure(store: FailureSink | null | undefined, error: unknown, context: string) {
  if (typeof error === "object" && error !== null) {
    if (recorded.has(error)) {
      return;
    }
    recorded.add(error);
  }
  try {
    store?.reportBackgroundFailure(error, context);
  } catch {
    // Recording a failure must never become one.
  }
}
