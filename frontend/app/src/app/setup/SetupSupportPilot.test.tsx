import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { useSyncExternalStore } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createFixtureTransport, createShellStore, type JsonObject, type ShellStore } from "@sse/engine-client";
import { getFixtureScenario } from "@sse/test-fixtures";

import { OperatorLayoutProvider } from "../OperatorLayoutProvider";
import { enterStudioFullscreen, resetWindowLayout, switchToWindowedLayout } from "../shellCommands";
import { SetupSupportPilot } from "./SetupSupportPilot";
import styles from "./SetupSupportPilot.module.css";

// The window commands are the native shell's; here they are stand-ins that
// answer as the shell would (WINDOW_REFUSALS below), so a test can make one
// refuse.
vi.mock("../shellCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shellCommands")>()),
  enterStudioFullscreen: vi.fn(async () => {}),
  resetWindowLayout: vi.fn(async () => {}),
  switchToWindowedLayout: vi.fn(async () => {}),
}));

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

// The sentences the native shell refuses a window command with:
// `window_command_refusal` in native/tauri-shell/src/main.rs, held by its
// `window_command_refusals_are_the_operators_sentences` test. The detail (the
// webview's own error, a file path) goes to shell.log, never to the screen; the
// missing monitor is said as it is, and only by Studio fullscreen.
const WINDOW_REFUSALS = [
  {
    key: "studio-fullscreen",
    command: enterStudioFullscreen,
    sentence: "No monitor is available for studio fullscreen.",
  },
  { key: "studio-fullscreen", command: enterStudioFullscreen, sentence: "Studio fullscreen did not start." },
  { key: "windowed", command: switchToWindowedLayout, sentence: "The windowed layout did not start." },
  { key: "reset", command: resetWindowLayout, sentence: "The window layout was not reset." },
] as const;

// The words the Rust test keeps out of every refusal: none reaches the screen.
const SHELL_DETAIL_WORDS = ["Tauri", "fallback", "Failed", "error", "engine", "\\"];

async function expectRefusalsInMessageLine(testIdPrefix: string) {
  for (const { key, command, sentence } of WINDOW_REFUSALS) {
    const testId = `${testIdPrefix}-${key}`;
    vi.mocked(command).mockRejectedValueOnce(new Error(sentence));
    await waitFor(() => expect((screen.getByTestId(testId) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId(testId));
    await waitFor(() => {
      expect(screen.getByTestId("setup-feedback").textContent).toContain(sentence);
    });
    const line = screen.getByTestId("setup-feedback");
    expect(line.getAttribute("data-tone")).toBe("error");
    for (const word of SHELL_DETAIL_WORDS) expect(line.textContent).not.toContain(word);
  }
}

// New pages program, Slice 3 (D6, decision 2): the three window commands the
// command palette held are keys in Workstation, in a row after UI scale. The
// native shell moves the window and says nothing when it does; a refusal comes
// back with the shell's sentence and lands in the pilot's message line, as
// every other Setup / Support failure does.
describe("SetupSupportPilot window keys", () => {
  const windowKeys = [
    { testId: "support-window-studio-fullscreen", label: "Studio fullscreen", command: enterStudioFullscreen },
    { testId: "support-window-windowed", label: "Windowed", command: switchToWindowedLayout },
    { testId: "support-window-reset", label: "Reset the window layout", command: resetWindowLayout },
  ];

  afterEach(() => {
    cleanup();
    for (const { command } of windowKeys) vi.mocked(command).mockClear();
  });

  it("Workstation shows the three window keys after UI scale; a key that works says nothing", async () => {
    const store = await renderPilot();
    const group = screen.getByRole("group", { name: "Window" });
    expect(screen.getByTestId("support-workstation").contains(group)).toBe(true);
    expect(
      within(group)
        .getAllByRole("button")
        .map((key) => key.textContent)
    ).toEqual(windowKeys.map(({ label }) => label));
    const scale = screen.getByTestId("support-scale-switch");
    expect(scale.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    for (const { testId, command } of windowKeys) {
      await waitFor(() => expect((screen.getByTestId(testId) as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(screen.getByTestId(testId));
      await waitFor(() => expect(command).toHaveBeenCalledTimes(1));
    }
    await waitFor(() => expect((screen.getByTestId("support-window-reset") as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByTestId("setup-feedback")).toBeNull();
    await store.dispose();
  });

  it("a refusal shows in the message line with the native shell's sentence", async () => {
    const store = await renderPilot();
    await expectRefusalsInMessageLine("support-window");
    await store.dispose();
  });
});

// Review finding 22: below the studio surface (a layout root under 2200 px)
// the plate is not drawn. That is the window "Windowed" itself makes (1600 ×
// 960), the fallback window and display 2 (2048 × 1152 at 125 %), so the keys
// that bring the studio surface back went with it. The bay's Support screen
// draws Workstation's window row under it then, wired as the plate's is. In
// jsdom the layout root measures 0 px, so its chrome is compact, as in a
// window; the stylesheet decides which copy is drawn, and jsdom applies none,
// so the last case reads the two rules themselves.
describe("SetupSupportPilot window keys in the bay, while the plate is not drawn", () => {
  const bayKeys = [
    { testId: "support-bay-window-studio-fullscreen", label: "Studio fullscreen", command: enterStudioFullscreen },
    { testId: "support-bay-window-windowed", label: "Windowed", command: switchToWindowedLayout },
    { testId: "support-bay-window-reset", label: "Reset the window layout", command: resetWindowLayout },
  ];

  afterEach(() => {
    cleanup();
    for (const { command } of bayKeys) vi.mocked(command).mockClear();
  });

  async function renderSupportMode() {
    const store = await renderPilot();
    await act(async () => {
      await store.setSetupSection("support");
    });
    await screen.findByRole("heading", { name: "Backup and recovery" });
    return store;
  }

  it("Support mode draws Workstation's window row under the Support screen; a key that works says nothing", async () => {
    const store = await renderSupportMode();
    const bay = screen.getByTestId("support-bay-workstation");
    expect(bay.closest("[data-operator-layout-root]")?.getAttribute("data-chrome")).toBe("compact");
    // In the bay, after the Support screen, not on the plate.
    expect(bay.closest("main")).not.toBeNull();
    expect(screen.getByTestId("support-plate").contains(bay)).toBe(false);
    const supportScreen = screen.getByTestId("setup-screen-support");
    expect(supportScreen.compareDocumentPosition(bay) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bay.textContent).toContain("Workstation");
    expect(bay.textContent).toContain("kept for the next launch");
    const group = within(bay).getByRole("group", { name: "Window" });
    expect(
      within(group)
        .getAllByRole("button")
        .map((key) => key.textContent)
    ).toEqual(bayKeys.map(({ label }) => label));

    for (const { testId, command } of bayKeys) {
      await waitFor(() => expect((screen.getByTestId(testId) as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(screen.getByTestId(testId));
      await waitFor(() => expect(command).toHaveBeenCalledTimes(1));
    }
    await waitFor(() =>
      expect((screen.getByTestId("support-bay-window-reset") as HTMLButtonElement).disabled).toBe(false)
    );
    expect(screen.queryByTestId("setup-feedback")).toBeNull();
    // The runner has no copy: the bay draws it only on the Support screen.
    await act(async () => {
      await store.setSetupSection("commissioning");
    });
    await waitFor(() => expect(screen.queryByTestId("support-bay-workstation")).toBeNull());
    await store.dispose();
  });

  it("a refusal from the bay's keys lands in the same message line with the native shell's sentence", async () => {
    const store = await renderSupportMode();
    await expectRefusalsInMessageLine("support-bay-window");
    await store.dispose();
  });

  it("the bay's copy is drawn only where the plate is not: one Window row on screen at any width", async () => {
    const css = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "SetupSupportPilot.module.css"),
      "utf8"
    );
    const COMPACT = ':global([data-operator-layout-root][data-chrome="compact"])';
    const rule = (selector: string) => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`^\\s*${escaped}\\s*\\{([^}]*)\\}`, "m").exec(css)?.[1] ?? null;
    };
    // At the studio surface the plate is drawn and the bay's copy is not;
    // under the compact chrome the plate is not drawn and the bay's copy is.
    expect(rule(".plateColumn")).toMatch(/display:\s*flex/);
    expect(rule(".compactWorkstation")).toMatch(/display:\s*none/);
    expect(rule(`${COMPACT} .plateColumn`)).toMatch(/display:\s*none/);
    expect(rule(`${COMPACT} .compactWorkstation`)).toMatch(/display:\s*block/);
    // No other rule draws or hides the copy.
    expect(css.match(/\.compactWorkstation\b/g)).toHaveLength(2);

    // And the two copies wear those classes.
    const store = await renderSupportMode();
    expect(screen.getByTestId("support-bay-workstation").classList.contains(styles.compactWorkstation)).toBe(true);
    expect(screen.getByTestId("support-plate").closest("aside")?.classList.contains(styles.plateColumn)).toBe(true);
    await store.dispose();
  });
});
