import { cleanup, render, screen, within } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { createShellStore, type JsonObject, type ShellStore } from "@sse/engine-client";
import { createFixtureTransport } from "@sse/engine-client/fixture";
import { getFixtureScenario } from "@sse/test-fixtures";

import { OperatorLayoutProvider } from "../OperatorLayoutProvider";
import { SetupRecoverySurface } from "./SetupRecoverySurface";
import { SetupSupportPilot } from "./SetupSupportPilot";

// 2026-09-22, after the production readiness program. The hardware link names
// the Stream Deck bridge `ready` or `unavailable` (app.snapshot
// runtime.controlSurface) and each health check in its subsystem's own words —
// `ready`, `not-verified`, `attention`, `unconfigured`, `disabled`,
// `unavailable`. Setup's Import and Publish steps and the recovery screen's
// diagnostics knew only the browser double's `ok` / `attention`, so on the
// workstation a serving bridge and a verified desk read as needing attention.
// `db2df4d` fixed the header's lamps the same way; these are the places it did
// not reach.

const SERVING = {
  available: true,
  status: "ready",
  summary: "The deck's bridge is ready at http://127.0.0.1:38201.",
};
const REFUSED = {
  available: false,
  status: "unavailable",
  summary:
    "The deck's bridge could not open its port: address in use. Close what holds it, then restart the hardware link.",
};

function withBridge(appSnapshot: JsonObject | null, controlSurface: JsonObject): JsonObject | null {
  if (!appSnapshot) return appSnapshot;
  const runtime = (appSnapshot.runtime ?? {}) as JsonObject;
  return { ...appSnapshot, runtime: { ...runtime, controlSurface } };
}

function PilotOnStore({
  store,
  controlSurface,
  runnerStage,
}: {
  store: ShellStore;
  controlSurface: JsonObject;
  runnerStage: "import" | "publish";
}) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  // The runner opens on the stage the hardware link has saved; the step tabs
  // live in the shell's cluster, which a component test does not draw.
  const commissioningSnapshot = state.commissioningSnapshot
    ? { ...state.commissioningSnapshot, runnerStage }
    : state.commissioningSnapshot;
  return (
    <OperatorLayoutProvider>
      <SetupSupportPilot
        appSnapshot={withBridge(state.appSnapshot, controlSurface)}
        camerasSnapshot={state.camerasSnapshot}
        commissioningSnapshot={commissioningSnapshot}
        controlSurfaceSnapshot={state.controlSurfaceSnapshot}
        healthSnapshot={state.healthSnapshot}
        lightOutputsArmed={state.lightingSnapshot ? state.lightingSnapshot.outputArmed !== false : null}
        liveTransportRequested={false}
        onRequestRestart={() => {}}
        store={store}
        supportSnapshot={state.supportSnapshot}
      />
    </OperatorLayoutProvider>
  );
}

async function renderRunner(controlSurface: JsonObject, runnerStage: "import" | "publish" = "import") {
  const store = createShellStore(createFixtureTransport(getFixtureScenario("setup-required")));
  await store.initialize();
  render(<PilotOnStore store={store} controlSurface={controlSurface} runnerStage={runnerStage} />);
}

/** How a Setup record row stands, found by the row's label. The visual
 *  overhaul's polish (2026-10-05): the row carries no lamp beside its label
 *  any more; its tone colours the value's words when it is not ok. */
function rowTone(label: string) {
  return screen.getByText(label).closest("[data-tone]")?.getAttribute("data-tone");
}

afterEach(() => {
  cleanup();
});

describe("Setup reads the Stream Deck bridge in the hardware link's words", () => {
  it("Import: a serving bridge stands ok, a bridge that could not bind stands in fault", async () => {
    await renderRunner(SERVING);
    expect(rowTone("Companion link")).toBe("ok");
    cleanup();

    await renderRunner(REFUSED);
    expect(rowTone("Companion link")).toBe("error");
  });

  it("Publish: a serving bridge stands ok", async () => {
    await renderRunner(SERVING, "publish");
    await screen.findByRole("heading", { name: "Publish" });
    expect(rowTone("Deck's bridge")).toBe("ok");
  });
});

describe("the recovery screen reads the health checks in the hardware link's words", () => {
  it("names the deck, the bridge and the desk by what they reported", async () => {
    const store = createShellStore(createFixtureTransport(getFixtureScenario("setup-ready")));
    render(
      <OperatorLayoutProvider>
        <SetupRecoverySurface
          appSnapshot={null}
          failure={{
            code: "ENGINE_EXITED",
            stage: "runtime",
            message: "The hardware link stopped unexpectedly (exit status 1).",
          }}
          healthSnapshot={{
            status: "ok",
            checks: {
              controlSurface: { ok: true, status: "ready", summary: SERVING.summary },
              lighting: { ok: false, status: "not-verified", summary: "Lighting bridge not verified yet." },
              audio: { ok: true, status: "ready", summary: "TotalMix verified." },
            },
          }}
          liveTransportRequested={false}
          onRequestRestart={() => {}}
          store={store}
          supportSnapshot={null}
        />
      </OperatorLayoutProvider>
    );
    // The visual overhaul (2026-10-05): each check is a row, its name and its
    // word with a lamp (the word set in capitals).
    const wordOf = (label: string) => {
      const row = screen.getByText(label).parentElement;
      if (!row) throw new Error(`no diagnostics row for ${label}`);
      return within(row).getByText(/^(ready|needs attention|failed|pending|not read)$/).textContent;
    };
    expect(wordOf("The deck")).toBe("ready");
    expect(wordOf("The desk")).toBe("ready");
    expect(wordOf("The bridge")).toBe("needs attention");
  });
});
