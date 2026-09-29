import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createShellStore, type JsonObject, type StartupFailure } from "@sse/engine-client";
import { createFixtureTransport } from "@sse/engine-client/fixture";
import { getFixtureScenario } from "@sse/test-fixtures";

import { SetupRecoverySurface } from "./SetupRecoverySurface";

// Found, to check (2026-09-28): the recovery screen's `Restore latest` and
// `Restore path` replaced the saved data at one press. They ask first now, and
// the question names the backup and what it replaces.

const BACKUPS = "C:\\Users\\Studio\\AppData\\Roaming\\ExEd Studio Control Native\\backups";
// The list as the hardware link sends it, newest first: an archive exported
// after the newest database backup.
const ARCHIVE = {
  kind: "archive",
  modifiedAt: Date.parse("2026-09-29T08:00:00Z"),
  name: "native-backup-2026-09-29T08-00-00.000Z.json",
  path: `${BACKUPS}\\native-backup-2026-09-29T08-00-00.000Z.json`,
  sizeBytes: 4096,
};
const DATABASE = {
  kind: "database",
  modifiedAt: Date.parse("2026-09-29T03:00:00Z"),
  name: "db-2026-09-29T03-00-00-000Z-daily.sqlite3",
  path: `${BACKUPS}\\db-2026-09-29T03-00-00-000Z-daily.sqlite3`,
  sizeBytes: 81920,
};

async function renderRecovery({
  backups = [ARCHIVE, DATABASE],
  failure = null,
}: { backups?: object[]; failure?: StartupFailure | null } = {}) {
  const store = createShellStore(createFixtureTransport(getFixtureScenario("setup-ready")));
  await store.initialize();
  const state = store.getSnapshot();
  render(
    <SetupRecoverySurface
      appSnapshot={state.appSnapshot}
      failure={failure}
      healthSnapshot={state.healthSnapshot}
      liveTransportRequested={false}
      onRequestRestart={() => {}}
      store={store}
      supportSnapshot={{ ...state.supportSnapshot, backups } as JsonObject}
    />
  );
  return store;
}

const STORAGE_CORRUPT: StartupFailure = {
  code: "STORAGE_CORRUPT",
  message: "The saved data could not be opened.",
  stage: "storage",
};

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

  // Found, to check (2026-09-29): it took the newest backup of either kind, and
  // an archive is refused while the saved data does not open.
  it("Restore latest takes the newest database backup, never a newer archive", async () => {
    const store = await renderRecovery({ failure: STORAGE_CORRUPT });
    const restore = vi
      .spyOn(store, "restoreSupportBackup")
      .mockResolvedValue({ requiresRestart: true, sourcePath: DATABASE.path });

    expect(screen.getByText("Latest database backup")).toBeTruthy();
    expect(screen.getByText(/only a database backup can be restored/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restore latest" }));
    const dialog = screen.getByRole("dialog", { name: "Restore this backup?" });
    expect(dialog.textContent).toContain("The database backup of");
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore" }));
    await waitFor(() => {
      expect(restore).toHaveBeenCalledWith(DATABASE.path);
    });
    await store.dispose();
  });

  it("Restore latest waits while the list holds no database backup", async () => {
    const store = await renderRecovery({ backups: [ARCHIVE], failure: STORAGE_CORRUPT });

    expect(screen.getByText("No database backup yet")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Restore latest" }) as HTMLButtonElement).disabled).toBe(true);
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
