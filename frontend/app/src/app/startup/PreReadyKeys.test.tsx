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
  it("carries the state and no key, and names the page that opens", () => {
    const { rerender } = render(<StartupSurface lifecycle="waiting-for-ready-event" />);
    const display = () => screen.getByTestId("startup-surface-state-display");
    expect(display().textContent).toContain("STARTING UP…");
    expect(display().textContent).toContain("The Console opens once Studio Control is ready.");
    expect(keysOn("startup-surface-state-display")).toEqual([]);

    rerender(<StartupSurface lifecycle="waiting-for-ready-event" opensSetup />);
    expect(display().textContent).toContain("Setup opens once Studio Control is ready.");
    expect(keysOn("startup-surface-state-display")).toEqual([]);
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
  // keys stand right under it.
  it("offers the key under Retry startup; a reset that works says nothing", async () => {
    renderSetupRecovery();
    expect(keysOn("setup-recovery-surface-state-display")).toEqual(["Retry startup"]);
    expect(keysOn("setup-recovery-keys")).toEqual(["Reset the window layout", "Back to Console"]);

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
