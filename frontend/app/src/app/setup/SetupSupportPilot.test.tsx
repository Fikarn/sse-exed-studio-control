import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createFixtureTransport, createShellStore, type JsonObject, type ShellStore } from "@sse/engine-client";
import { getFixtureScenario } from "@sse/test-fixtures";

import { OperatorLayoutProvider } from "../OperatorLayoutProvider";
import { SetupSupportPilot } from "./SetupSupportPilot";

// 2026-09 production readiness, Slice 7 (F20): the Support plate's "Verify
// latest" key asks the hardware link to check the latest backup without
// changing anything, and the answer — the kind, the version, what it holds —
// lands in the pilot's inline feedback; a refusal lands there too, with the
// engine's sentence.

// The pilot as the shell mounts it: fed from the store, so what a request
// changes comes back to the plate.
function PilotOnStore({
  store,
  supportSnapshotOverride,
}: {
  store: ShellStore;
  supportSnapshotOverride?: (snapshot: JsonObject | null) => JsonObject | null;
}) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const supportSnapshot = supportSnapshotOverride
    ? supportSnapshotOverride(state.supportSnapshot)
    : state.supportSnapshot;
  return (
    <OperatorLayoutProvider>
      <SetupSupportPilot
        appSnapshot={state.appSnapshot}
        commissioningSnapshot={state.commissioningSnapshot}
        controlSurfaceSnapshot={state.controlSurfaceSnapshot}
        healthSnapshot={state.healthSnapshot}
        lightOutputsArmed={state.lightingSnapshot ? state.lightingSnapshot.outputArmed !== false : null}
        liveTransportRequested={false}
        onRequestRestart={() => {}}
        onShowShortcuts={() => {}}
        store={store}
        supportSnapshot={supportSnapshot}
      />
    </OperatorLayoutProvider>
  );
}

async function renderPilot(supportSnapshotOverride?: (snapshot: JsonObject | null) => JsonObject | null) {
  const store = createShellStore(createFixtureTransport(getFixtureScenario("setup-ready")));
  await store.initialize();
  render(<PilotOnStore store={store} supportSnapshotOverride={supportSnapshotOverride} />);
  return store;
}

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

describe("SetupSupportPilot backup verification", () => {
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

  // New pages program, Slice 2 (D3): a backup written before Planning left
  // restores without its Planning data, and the hardware link's reply says so
  // in `detail`. The banner prints it after the shell's own sentence; a reply
  // without it (nothing was left out) adds nothing.
  it("restore prints what the hardware link left out, and nothing more without it", async () => {
    const store = await renderPilot();
    const note = "Planning data in this backup was not restored; Planning is no longer part of Studio Control.";
    const restore = vi
      .spyOn(store, "restoreSupportBackup")
      .mockResolvedValueOnce({
        detail: note,
        restored: true,
        sourceFormat: "native-support-backup",
        sourcePath: "C:/app-data/backups/native-backup-2026-04.json",
      })
      .mockResolvedValueOnce({
        restored: true,
        sourceFormat: "native-support-backup",
        sourcePath: "C:/app-data/backups/native-backup-2026-09.json",
      });

    fireEvent.click(screen.getByTestId("support-restore-latest"));
    await waitFor(() => {
      expect(screen.getByTestId("setup-feedback").textContent).toContain(
        `Restored native-support-backup from C:/app-data/backups/native-backup-2026-04.json. ${note}`
      );
    });
    expect(screen.getByTestId("setup-feedback").getAttribute("data-tone")).toBe("ok");

    fireEvent.click(screen.getByTestId("support-restore-latest"));
    await waitFor(() => {
      expect(screen.getByTestId("setup-feedback").textContent).toContain("native-backup-2026-09.json.");
    });
    expect(screen.getByTestId("setup-feedback").textContent).not.toContain("Planning");
    expect(restore).toHaveBeenCalledTimes(2);
    await store.dispose();
  });
});

// 2026-09 production readiness, Slice 11 (F30, F31): the Armed / Held switch
// asks the hardware link, shows what it answered, and never promises a dark
// room; Recent actions lists the newest rows with who did them.
describe("SetupSupportPilot light outputs and recent actions", () => {
  afterEach(() => {
    cleanup();
  });

  it("arm switch calls setArmed", async () => {
    const store = await renderPilot();
    const setArmed = vi.spyOn(store, "setLightingOutputArmed");
    const armed = screen.getByTestId("support-outputs-armed");
    const held = screen.getByTestId("support-outputs-held");
    expect(armed.getAttribute("aria-pressed")).toBe("true");
    expect(held.getAttribute("aria-pressed")).toBe("false");

    // The key that is already lit asks nothing.
    fireEvent.click(armed);
    expect(setArmed).not.toHaveBeenCalled();

    fireEvent.click(held);
    await waitFor(() => {
      expect(screen.getByTestId("support-outputs-held").getAttribute("aria-pressed")).toBe("true");
    });
    expect(setArmed).toHaveBeenCalledTimes(1);
    expect(setArmed).toHaveBeenCalledWith(false);
    expect(store.getSnapshot().lightingSnapshot?.outputArmed).toBe(false);
    const banner = screen.getByTestId("setup-feedback");
    expect(banner.textContent).toContain("nothing is sent to the rig");
    expect(banner.textContent?.toLowerCase()).not.toContain("dark");
    expect(banner.textContent?.toLowerCase()).not.toContain("blackout");
    expect(screen.getByTestId("support-workstation").textContent).toContain("nothing is sent to the rig");

    // The switch is a row of its own, and the list moves with it.
    await waitFor(() => {
      const rows = screen.getAllByTestId("support-recent-action");
      expect(rows[0].textContent).toContain("Light outputs held");
      expect(rows[0].textContent).toContain("Screen");
    });

    fireEvent.click(screen.getByTestId("support-outputs-armed"));
    await waitFor(() => {
      expect(screen.getByTestId("support-outputs-armed").getAttribute("aria-pressed")).toBe("true");
    });
    expect(setArmed).toHaveBeenLastCalledWith(true);
    await store.dispose();
  });

  it("recent actions shows the newest eight with the operator's word for each source", async () => {
    const store = await renderPilot();
    const list = screen.getByTestId("support-recent-actions");
    const rows = within(list).getAllByTestId("support-recent-action");
    expect(rows).toHaveLength(8);
    expect(rows[0].textContent).toContain("Light outputs armed");
    expect(rows.map((row) => row.getAttribute("data-source"))).toEqual([
      "ui",
      "deck",
      "deck",
      "console",
      "watchdog",
      "ui",
      "ui",
      "ui",
    ]);
    for (const word of ["Screen", "Stream Deck", "Console", "Watchdog"]) {
      expect(list.textContent).toContain(word);
    }
    // The ninth row — the start-up hold — is in the snapshot, not on the plate.
    expect(list.textContent).not.toContain("safe start");
    await store.dispose();
  });

  it("recent actions says so when there is nothing yet, and skips rows it cannot read", async () => {
    const store = await renderPilot((snapshot) => ({ ...(snapshot ?? {}), recentEvents: [{ id: "x" }, null, 7] }));
    expect(screen.getByTestId("support-recent-actions-empty").textContent).toContain("Nothing yet");
    expect(screen.queryAllByTestId("support-recent-action")).toHaveLength(0);
    await store.dispose();
  });
});
