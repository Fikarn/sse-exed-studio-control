import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createShellStore } from "@sse/engine-client";
import { createFixtureTransport } from "@sse/engine-client/fixture";
import { getFixtureScenario } from "@sse/test-fixtures";

import { SetupRecoverySurface } from "./SetupRecoverySurface";

// Found, to check (2026-09-28): the recovery screen's `Restore latest` and
// `Restore path` replaced the saved data at one press. They ask first now, and
// the question names the backup and what it replaces.

async function renderRecovery() {
  const store = createShellStore(createFixtureTransport(getFixtureScenario("setup-ready")));
  await store.initialize();
  const state = store.getSnapshot();
  render(
    <SetupRecoverySurface
      appSnapshot={state.appSnapshot}
      failure={null}
      healthSnapshot={state.healthSnapshot}
      liveTransportRequested={false}
      onRequestRestart={() => {}}
      store={store}
      supportSnapshot={state.supportSnapshot}
    />
  );
  return store;
}

describe("the recovery screen's restore keys ask first", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("Restore latest opens the question; Cancel restores nothing, Restore restores", async () => {
    const store = await renderRecovery();
    const restore = vi
      .spyOn(store, "restoreSupportBackup")
      .mockResolvedValue({ requiresRestart: true, sourcePath: "C:/app-data/backups/db.sqlite3" });

    fireEvent.click(screen.getByRole("button", { name: "Restore latest" }));
    const dialog = screen.getByRole("dialog", { name: "Restore this backup?" });
    expect(dialog.textContent).toContain("It replaces");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Restore this backup?" })).toBeNull();
    });
    expect(restore).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Restore latest" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Restore this backup?" })).getByRole("button", { name: "Restore" })
    );
    await waitFor(() => {
      expect(restore).toHaveBeenCalledTimes(1);
    });
    await store.dispose();
  });

  it("Restore path asks first too", async () => {
    const store = await renderRecovery();
    const restore = vi.spyOn(store, "restoreSupportBackup");

    fireEvent.click(screen.getByRole("button", { name: "Restore path" }));
    expect(screen.getByRole("dialog", { name: "Restore this backup?" })).toBeTruthy();
    expect(restore).not.toHaveBeenCalled();
    await store.dispose();
  });
});
