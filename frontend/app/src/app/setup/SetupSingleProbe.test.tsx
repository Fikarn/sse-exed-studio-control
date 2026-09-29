import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { AppShellFrame } from "@sse/design-system";
import { createShellStore, type ShellStore } from "@sse/engine-client";
import { createFixtureTransport } from "@sse/engine-client/fixture";
import { getFixtureScenario } from "@sse/test-fixtures";

import { OperatorLayoutProvider } from "../OperatorLayoutProvider";
import { SetupSupportPilot } from "./SetupSupportPilot";

// The review of #261: a probe's own `Run probe` key said it passed whatever
// the probe found. The deck's probe can fail since 2026-09-29 (it asks
// whether the deck has been heard), and the bridge's and the desk's could
// before. The line says what the probe returned.

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

async function renderProbeStep() {
  const store = createShellStore(createFixtureTransport(getFixtureScenario("setup-required")));
  await store.initialize();
  await store.updateCommissioning({ runnerStage: "probe" });
  render(<PilotInShell store={store} />);
  await screen.findByRole("heading", { name: "Probe hardware" });
  return store;
}

/** The `Run probe` key beside a probe's record row. */
function runProbeKey(checkId: string) {
  const record = screen.getByTestId(`setup-probe-record-${checkId}`).parentElement;
  if (!record) throw new Error(`no record for ${checkId}`);
  return within(record).getByRole("button", { name: "Run probe" });
}

afterEach(() => {
  cleanup();
});

describe("a probe's own key says what the probe returned", () => {
  it("says the desk probe did not pass, with its sentence, when it failed", async () => {
    const store = await renderProbeStep();
    // The double fails the desk probe on send port 1.
    fireEvent.change(screen.getByLabelText("TotalMix send port"), { target: { value: "1" } });
    fireEvent.click(runProbeKey("audio"));

    await waitFor(() => {
      expect(screen.getByTestId("setup-feedback").textContent).toContain(
        "The desk probe did not pass: No TotalMix answer on 127.0.0.1:1."
      );
    });
    expect(screen.getByTestId("setup-feedback").getAttribute("data-tone")).toBe("error");
    await store.dispose();
  });

  it("says the deck probe passed when it passed", async () => {
    const store = await renderProbeStep();
    fireEvent.click(runProbeKey("control-surface"));

    await waitFor(() => {
      expect(screen.getByTestId("setup-feedback").textContent).toContain("The deck probe passed.");
    });
    expect(screen.getByTestId("setup-feedback").getAttribute("data-tone")).toBe("ok");
    await store.dispose();
  });
});
