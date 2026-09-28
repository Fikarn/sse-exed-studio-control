import {
  createTauriGlassLink,
  glassLinkOver,
  type GlassLink,
  type JsonObject,
  type JsonValue,
} from "@sse/engine-client";

declare global {
  interface Window {
    /**
     * The page tests' hold on the prompter's window in a browser: a request
     * to the engine's test double behind the page, as the operator's window
     * would send it (put a script on, play, change the look). The window's
     * own page sends none of them.
     */
    __SSE_TEST_GLASS__?: {
      request: (method: string, params?: JsonObject) => Promise<JsonValue>;
    };
  }
}

/**
 * The prompter's window's link. In the app's window it talks to the hardware
 * link through the shell, whatever the address says. In a browser it runs on
 * the engine's test double, loaded then and only then.
 */
export async function createGlassLink(): Promise<GlassLink> {
  if ("__TAURI_INTERNALS__" in window) {
    return createTauriGlassLink();
  }
  const url = new URL(window.location.href);
  const fixtureId = window.__SSE_FIXTURE_ID__ ?? url.searchParams.get("fixture") ?? "teleprompter-ready";
  const { createFixtureDouble } = await import("../app/fixtureDouble");
  const double = createFixtureDouble(fixtureId);
  window.__SSE_TEST_GLASS__ = {
    request: (method, params) => double.request(method as Parameters<typeof double.request>[0], params),
  };
  return glassLinkOver(double);
}
