import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppShellFrame } from "@sse/design-system";
import { createShellStore, type ShellStore } from "@sse/engine-client";
import { createFixtureTransport } from "@sse/engine-client/fixture";
import { getFixtureScenario } from "@sse/test-fixtures";

import { OperatorLayoutProvider } from "../OperatorLayoutProvider";
import { SetupSupportPilot } from "./SetupSupportPilot";

// Found, to check (2026-09-29): while the setup is not published, the state
// display's key read `Start with Import profile` on every step, and its press
// moved the saved setup back to step 1. It names the step the saved setup
// stands at now, and goes there.

function PilotInShell({ store }: { store: ShellStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return (
    <OperatorLayoutProvider>
      <AppShellFrame activeWorkspace="setup" cluster="slot" footer="slot" monitorItems={[]} workspaces={[]}>
        <SetupSupportPilot
          appSnapshot={state.appSnapshot}
          camerasSnapshot={state.camerasSnapshot}
          commissioningSnapshot={state.commissioningSnapshot}
          controlSurfaceSnapshot={state.controlSurfaceSnapshot}
          healthSnapshot={state.healthSnapshot}
          lightOutputsArmed={state.lightingSnapshot ? state.lightingSnapshot.outputArmed !== false : null}
          liveTransportRequested={false}
          onRequestRestart={() => {}}
          store={store}
          supportSnapshot={state.supportSnapshot}
        />
      </AppShellFrame>
    </OperatorLayoutProvider>
  );
}

async function renderSetupRequired(runnerStage: "import" | "map") {
  const store = createShellStore(createFixtureTransport(getFixtureScenario("setup-required")));
  await store.initialize();
  if (runnerStage === "map") {
    await store.updateCommissioning({ runnerStage: "map" });
  }
  render(<PilotInShell store={store} />);
  await screen.findByRole("heading", { name: runnerStage === "map" ? "Map bindings" : "Import the Companion profile" });
  return store;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the key out of SETUP REQUIRED goes to the step the setup stands at", () => {
  it("reads Start with Import profile before the first step is done", async () => {
    const store = await renderSetupRequired("import");
    expect(screen.getByTestId("setup-state-start").textContent).toBe("Start with Import profile");
    await store.dispose();
  });

  it("reads Continue with Map bindings on step 3, and its press keeps the setup there", async () => {
    const store = await renderSetupRequired("map");
    const key = screen.getByTestId("setup-state-start");
    expect(key.textContent).toBe("Continue with Map bindings");

    // From the Support screen, where the key is the way back to the runner.
    fireEvent.click(screen.getByTestId("setup-mode-support"));
    const update = vi.spyOn(store, "updateCommissioning");
    fireEvent.click(screen.getByTestId("setup-state-start"));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({ runnerStage: "map" });
    });
    expect(update).not.toHaveBeenCalledWith({ runnerStage: "import" });
    await screen.findByRole("heading", { name: "Map bindings" });
    expect(store.getSnapshot().commissioningSnapshot?.runnerStage).toBe("map");
    await store.dispose();
  });
});
