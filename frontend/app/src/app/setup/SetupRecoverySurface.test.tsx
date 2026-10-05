import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createShellStore, type JsonObject, type StartupFailure } from "@sse/engine-client";
import { createFixtureTransport } from "@sse/engine-client/fixture";
import { getFixtureScenario } from "@sse/test-fixtures";

import { formatBackupTimestamp } from "../shellData";
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

    fireEvent.click(screen.getByRole("button", { name: "Restore latest…" }));
    const dialog = screen.getByRole("dialog", { name: "Restore this backup?" });
    expect(dialog.textContent).toContain("It replaces");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Restore this backup?" })).toBeNull();
    });
    expect(restore).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Restore latest…" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Restore latest…" }));
    const dialog = screen.getByRole("dialog", { name: "Restore this backup?" });
    expect(dialog.textContent).toContain("The database backup of");
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore" }));
    await waitFor(() => {
      expect(restore).toHaveBeenCalledWith(DATABASE.path);
    });
    await store.dispose();
  });

  // The visual overhaul's polish (2026-10-05): a refused restore is the locked
  // form (dashed, 55 %, its reason within reach), not the busy moment's
  // `disabled`, which it was drawn as.
  it("Restore latest waits while the list holds no database backup", async () => {
    const store = await renderRecovery({ backups: [ARCHIVE], failure: STORAGE_CORRUPT });

    expect(screen.getByText("No database backup yet")).toBeTruthy();
    const latest = screen.getByRole("button", { name: "Restore latest…" }) as HTMLButtonElement;
    expect(latest.getAttribute("aria-disabled")).toBe("true");
    expect(latest.disabled).toBe(false);
    expect(latest.getAttribute("title")).toBe("No database backup yet.");
    await store.dispose();
  });

  it("Restore path asks first too", async () => {
    const store = await renderRecovery();
    const restore = vi.spyOn(store, "restoreSupportBackup");

    fireEvent.click(screen.getByRole("button", { name: "Restore path…" }));
    expect(screen.getByRole("dialog", { name: "Restore this backup?" })).toBeTruthy();
    expect(restore).not.toHaveBeenCalled();
    await store.dispose();
  });

  // The visual overhaul (2026-10-05): while the saved data does not open only
  // a database backup restores, so an archive in the field locks Restore path
  // with the reason on screen, rather than being refused after the question.
  it("Restore path is locked for an archive while the saved data does not open", async () => {
    const store = await renderRecovery({ failure: STORAGE_CORRUPT });

    fireEvent.click(screen.getByTestId("setup-recovery-backup-0"));
    expect(screen.getByTestId("setup-recovery-backup-0").getAttribute("aria-pressed")).toBe("true");
    const restorePath = () => screen.getByRole("button", { name: "Restore path…" });
    expect(restorePath().getAttribute("aria-disabled")).toBe("true");
    expect(restorePath().getAttribute("title")).toContain("choose a database backup");
    expect(screen.getByTestId("setup-recovery-archive-refused").textContent).toContain("choose a database backup");

    fireEvent.click(screen.getByTestId("setup-recovery-backup-1"));
    expect(restorePath().getAttribute("aria-disabled")).toBeNull();
    expect((restorePath() as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByTestId("setup-recovery-archive-refused")).toBeNull();
    await store.dispose();
  });
});

// The visual overhaul's polish (2026-10-05): one list of the places in the
// bay, each folder's key on its row (the bay's keys and the plate's File paths
// named the same folders twice), and backup rows that lead with the local time.
describe("the recovery screen's places and backups", () => {
  afterEach(() => {
    cleanup();
  });

  it("lists each place once, in order, with its folder's key on its row", async () => {
    // The six places the hardware link attaches to a start that failed, in
    // its own order (main.rs); the list puts the folders a hand opens first.
    const APP_DATA = "C:\\Users\\Studio\\AppData\\Roaming\\ExEd Studio Control Native";
    const store = await renderRecovery({
      failure: {
        ...STORAGE_CORRUPT,
        paths: {
          appDataDir: APP_DATA,
          logsDir: `${APP_DATA}\\logs`,
          logFilePath: `${APP_DATA}\\logs\\studio-control.log`,
          dbPath: `${APP_DATA}\\studio-control.sqlite3`,
          backupDir: BACKUPS,
          exportsDir: `${APP_DATA}\\exports`,
        },
      },
    });

    const rows = within(screen.getByTestId("setup-recovery-paths")).getAllByRole("listitem");
    expect(rows.map((row) => row.firstElementChild?.textContent)).toEqual([
      "Backups folder",
      "App data",
      "Logs",
      "Log file",
      "Database path",
      "Exports",
    ]);
    const backupsKey = within(rows[0]!).getByTestId("setup-recovery-open-backups");
    expect(backupsKey.textContent).toBe("Open");
    expect(backupsKey.getAttribute("aria-label")).toBe("Open backups folder");
    expect(within(rows[1]!).getByTestId("setup-recovery-open-app-data")).toBeTruthy();
    expect(within(rows[2]!).getByTestId("setup-recovery-open-logs")).toBeTruthy();
    expect(within(rows[3]!).queryByRole("button")).toBeNull();
    expect(within(rows[4]!).queryByRole("button")).toBeNull();
    expect(within(rows[5]!).getByTestId("setup-recovery-open-diagnostics")).toBeTruthy();
    expect(screen.queryByText("File paths")).toBeNull();
    await store.dispose();
  });

  it("leads a backup's row with its local time and kind, the size and file name after", async () => {
    const store = await renderRecovery({ failure: STORAGE_CORRUPT });

    const row = screen.getByTestId("setup-recovery-backup-1");
    expect(row.firstElementChild?.textContent).toBe(`${formatBackupTimestamp(DATABASE.modifiedAt)} · database backup`);
    expect(row.lastElementChild?.textContent).toBe(`80.0 KB · ${DATABASE.name}`);
    await store.dispose();
  });
});
