import { createFixtureTransport, createShellStore, createTauriTransport, type WorkspaceId } from "@sse/engine-client";
import { getFixtureScenario } from "@sse/test-fixtures";

import { disarmWorkspaceCrash } from "./startup/WorkspaceCrashProbe";

declare global {
  interface Window {
    __SSE_FIXTURE_ID__?: string;
    /** Playwright: end the fault `?crash=` armed, so reloading the area succeeds. */
    __SSE_TEST_DISARM_CRASH__?: () => void;
  }
}

const CRASH_TARGETS: readonly WorkspaceId[] = ["setup", "lighting", "audio"];

export function createShellEnvironment() {
  const url = new URL(window.location.href);
  const fixtureId = window.__SSE_FIXTURE_ID__ ?? url.searchParams.get("fixture") ?? "setup-required";
  const transportMode = url.searchParams.get("transport");
  const fixtureTransportRequested = transportMode === "fixture";
  const liveTransportRequested = transportMode === "live";
  const tauriAvailable = "__TAURI_INTERNALS__" in window;
  const useLiveTransport = !fixtureTransportRequested && (liveTransportRequested || tauriAvailable);

  const transport = useLiveTransport ? createTauriTransport() : createFixtureTransport(getFixtureScenario(fixtureId));

  // 2026-09 production readiness, Slice 9 (finding F10): `?crash=lighting`
  // makes that workspace throw while it renders, so Playwright can watch the
  // shell survive it. The fixture double only — the parameter means nothing
  // to a shell that has a hardware link, and nothing inside the Tauri runtime.
  const crashParameter = url.searchParams.get("crash");
  const crashWorkspace =
    !useLiveTransport && !tauriAvailable ? (CRASH_TARGETS.find((target) => target === crashParameter) ?? null) : null;
  if (crashWorkspace) {
    window.__SSE_TEST_DISARM_CRASH__ = disarmWorkspaceCrash;
  }

  return {
    crashWorkspace,
    fixtureId,
    liveTransportRequested: useLiveTransport,
    // A development build refuses a malformed reply loudly (Slice 9 — F32);
    // the packaged build keeps the last good snapshot and records the failure.
    store: createShellStore(transport, { development: import.meta.env.DEV }),
  };
}
