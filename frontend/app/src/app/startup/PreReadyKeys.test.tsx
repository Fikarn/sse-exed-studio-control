import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createShellStore, type StartupFailure } from "@sse/engine-client";
import { createFixtureTransport } from "@sse/engine-client/fixture";
import { getFixtureScenario } from "@sse/test-fixtures";

import { SetupRecoverySurface } from "../setup/SetupRecoverySurface";
import { resetWindowLayout } from "../shellCommands";
import { StartupSurface } from "./StartupSurface";

// New pages program, Slice 3 (D6, decision 2; the inventory's §7 note 8). The
// keys on the state display of the screens shown before Studio Control is
// ready. "Shortcuts", the only key on the two startup screens, went with the
// shortcut guide, so they have none. The two recovery screens keep Retry
// startup and gain Reset the window layout beside it — the one window command
// that is not only in Setup / Support, for a window that came back on the
// wrong screen. The native shell says nothing when the window moves; a refusal
// shows on the screen, with the shell's sentence.

// The window command is the native shell's; here it is a stand-in that answers
// as the shell would, so a test can make it refuse.
vi.mock("../shellCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shellCommands")>()),
  resetWindowLayout: vi.fn(async () => {}),
}));

const FAILURE: StartupFailure = {
  code: "ENGINE_EXITED",
  stage: "runtime",
  message: "The hardware link stopped unexpectedly (exit status 1).",
};

// The one sentence the shell refuses a reset with, whatever went wrong
// (`window_command_refusal` in native/tauri-shell/src/shell_window_layout.rs, held by its
// `window_command_refusals_are_the_operators_sentences` test): the detail goes
// to shell.log, and the missing-monitor sentence is Studio fullscreen's alone.
const REFUSAL = "The window layout was not reset.";

const keysOn = (displayTestId: string) =>
  within(screen.getByTestId(displayTestId))
    .queryAllByRole("button")
    .map((key) => key.textContent);

afterEach(() => {
  cleanup();
  vi.mocked(resetWindowLayout).mockClear();
});

describe("the startup screen has no key", () => {
  // The visual overhaul (2026-10-05): the line said "Setup opens" on every
  // start, since the store begins on Setup. The app opens on the Overview
  // since 2026-10-09 (D47, D1 amended).
  it("carries the state and no key, and says the Overview opens", () => {
    render(<StartupSurface lifecycle="waiting-for-ready-event" />);
    const display = screen.getByTestId("startup-surface-state-display");
    expect(display.textContent).toContain("STARTING UP…");
    expect(display.textContent).toContain("The Overview opens once Studio Control is ready.");
    expect(keysOn("startup-surface-state-display")).toEqual([]);
  });

  // A stage is the wait for its step: a step reads done once the next stage began.
  it("reads a step done only once the stage after it has begun", () => {
    render(<StartupSurface lifecycle="waiting-for-ready-event" />);
    expect(screen.getByTestId("startup-steps-section").textContent).toContain("1 of 4 done");
  });

  // The visual overhaul's polish (2026-10-05): the frame of the recovery
  // screen (DESIGN §2). The steps stand in the bay, each with its word beside
  // its lamp; the hardware's three checks stand on the plate, pending until
  // the hardware link reports them, and the plate has no key either.
  it("puts the steps in the bay and the three checks, pending, on the plate", () => {
    render(<StartupSurface lifecycle="waiting-for-ready-event" />);
    const bay = screen.getByTestId("startup-surface-bay");
    expect(within(bay).getByTestId("startup-steps-section")).toBeTruthy();
    expect(within(bay).getAllByText("Done")).toHaveLength(1);
    expect(within(bay).getAllByText("Pending")).toHaveLength(3);

    const plate = screen.getByTestId("startup-surface-plate");
    expect(within(plate).getAllByText("pending")).toHaveLength(3);
    expect(within(plate).queryAllByRole("button")).toEqual([]);
  });

  it("reads the checks once the hardware link has reported them", () => {
    render(
      <StartupSurface
        lifecycle="waiting-for-app-snapshot"
        healthSnapshot={{
          checks: {
            controlSurface: { status: "ready", summary: "The deck's bridge is ready." },
            lighting: { status: "not-verified" },
          },
        }}
      />
    );
    const plate = screen.getByTestId("startup-surface-plate");
    expect(within(plate).getByText("ready")).toBeTruthy();
    expect(within(plate).getByText("The deck's bridge is ready.")).toBeTruthy();
    expect(within(plate).getByText("needs attention")).toBeTruthy();
    expect(within(plate).getByText("pending")).toBeTruthy();
  });
});

describe("the recovery screen: Reset the window layout beside Retry startup", () => {
  function renderSetupRecovery() {
    // The store only answers the backup keys, which these tests do not press.
    const store = createShellStore(createFixtureTransport(getFixtureScenario("bootstrap-failed")));
    render(
      <SetupRecoverySurface
        appSnapshot={null}
        failure={FAILURE}
        healthSnapshot={null}
        liveTransportRequested={false}
        onRequestRestart={() => {}}
        store={store}
        supportSnapshot={null}
      />
    );
  }

  // The shell (overhaul 3): the state display stands in the 440 px cluster,
  // where three keys do not fit; its one way out stays on it, and the window's
  // key stands right under it. The visual overhaul (2026-10-05, the owner's
  // answer): Back to Console went, since it could never leave this screen.
  it("offers the key under Retry startup; a reset that works says nothing", async () => {
    renderSetupRecovery();
    expect(keysOn("setup-recovery-surface-state-display")).toEqual(["Retry startup"]);
    expect(keysOn("setup-recovery-keys")).toEqual(["Reset the window layout"]);

    fireEvent.click(screen.getByTestId("setup-recovery-window-reset"));
    await waitFor(() => expect(resetWindowLayout).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect((screen.getByTestId("setup-recovery-window-reset") as HTMLButtonElement).disabled).toBe(false)
    );
    expect(screen.queryByTestId("setup-recovery-feedback")).toBeNull();
  });

  it("shows a refusal in the screen's message line with the shell's sentence", async () => {
    vi.mocked(resetWindowLayout).mockRejectedValueOnce(new Error(REFUSAL));
    renderSetupRecovery();

    fireEvent.click(screen.getByTestId("setup-recovery-window-reset"));
    const line = await screen.findByTestId("setup-recovery-feedback");
    expect(line.textContent).toContain(REFUSAL);
    expect(line.getAttribute("data-tone")).toBe("error");
    expect(line.getAttribute("role")).toBe("status");
  });
});
