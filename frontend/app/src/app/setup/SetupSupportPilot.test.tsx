import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createFixtureTransport, createShellStore, type JsonObject } from "@sse/engine-client";
import { getFixtureScenario } from "@sse/test-fixtures";

import { OperatorLayoutProvider } from "../OperatorLayoutProvider";
import { SetupSupportPilot } from "./SetupSupportPilot";

// 2026-09 production readiness, Slice 7 (F20): the Support plate's "Verify
// latest" key asks the hardware link to check the latest backup without
// changing anything, and the answer — the kind, the version, what it holds —
// lands in the pilot's inline feedback; a refusal lands there too, with the
// engine's sentence.

async function renderPilot(supportSnapshotOverride?: (snapshot: JsonObject | null) => JsonObject | null) {
  const store = createShellStore(createFixtureTransport(getFixtureScenario("setup-ready")));
  await store.initialize();
  const state = store.getSnapshot();
  const supportSnapshot = supportSnapshotOverride
    ? supportSnapshotOverride(state.supportSnapshot)
    : state.supportSnapshot;
  render(
    <OperatorLayoutProvider>
      <SetupSupportPilot
        appSnapshot={state.appSnapshot}
        commissioningSnapshot={state.commissioningSnapshot}
        controlSurfaceSnapshot={state.controlSurfaceSnapshot}
        healthSnapshot={state.healthSnapshot}
        liveTransportRequested={false}
        onRequestRestart={() => {}}
        onShowShortcuts={() => {}}
        store={store}
        supportSnapshot={supportSnapshot}
      />
    </OperatorLayoutProvider>
  );
  return store;
}

describe("SetupSupportPilot backup verification", () => {
  beforeAll(() => {
    // jsdom has neither ResizeObserver nor matchMedia; the layout provider
    // and the plate only need ones that never fire.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    vi.stubGlobal("matchMedia", (query: string) => ({
      addEventListener() {},
      addListener() {},
      dispatchEvent() {
        return false;
      },
      matches: false,
      media: query,
      onchange: null,
      removeEventListener() {},
      removeListener() {},
    }));
  });

  afterEach(() => {
    cleanup();
  });

  it("verify shows inline result", async () => {
    const store = await renderPilot();
    expect(store.getSnapshot().lifecycle).toBe("ready");

    fireEvent.click(screen.getByTestId("support-verify-latest"));

    await waitFor(() => {
      expect(screen.getByTestId("setup-feedback").textContent).toContain("Backup checked:");
    });
    const banner = screen.getByTestId("setup-feedback");
    expect(banner.getAttribute("data-tone")).toBe("ok");
    expect(banner.textContent).toContain("Backup archive, format 4");
    await store.dispose();
  });

  it("verify shows the refusal for a file outside the backups folder", async () => {
    const store = await renderPilot((snapshot) => ({
      ...(snapshot ?? {}),
      backups: [
        {
          kind: "archive",
          modifiedAt: 1_776_841_920_000,
          name: "native-backup-elsewhere.json",
          path: "/Users/operator/Desktop/native-backup-elsewhere.json",
          sizeBytes: 4096,
        },
      ],
    }));

    fireEvent.click(screen.getByTestId("support-verify-latest"));

    await waitFor(() => {
      expect(screen.getByTestId("setup-feedback").textContent).toContain("Only files inside the backups folder");
    });
    expect(screen.getByTestId("setup-feedback").getAttribute("data-tone")).toBe("error");
    await store.dispose();
  });
});
