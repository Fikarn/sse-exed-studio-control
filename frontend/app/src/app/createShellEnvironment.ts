import { createFixtureTransport, createShellStore, createTauriTransport } from "@sse/engine-client";
import { getFixtureScenario } from "@sse/test-fixtures";

declare global {
  interface Window {
    __SSE_FIXTURE_ID__?: string;
  }
}

export function createShellEnvironment() {
  const url = new URL(window.location.href);
  const fixtureId = window.__SSE_FIXTURE_ID__ ?? url.searchParams.get("fixture") ?? "setup-required";
  const transportMode = url.searchParams.get("transport");
  const fixtureTransportRequested = transportMode === "fixture";
  const liveTransportRequested = transportMode === "live";
  const tauriAvailable = "__TAURI_INTERNALS__" in window;
  const useLiveTransport = !fixtureTransportRequested && (liveTransportRequested || tauriAvailable);

  const transport = useLiveTransport ? createTauriTransport() : createFixtureTransport(getFixtureScenario(fixtureId));

  return {
    fixtureId,
    liveTransportRequested: useLiveTransport,
    store: createShellStore(transport),
  };
}
