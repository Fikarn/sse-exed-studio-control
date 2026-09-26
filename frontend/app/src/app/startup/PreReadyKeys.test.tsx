import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createFixtureTransport, createShellStore, type StartupFailure } from "@sse/engine-client";
import { getFixtureScenario } from "@sse/test-fixtures";

import { SetupRecoverySurface } from "../setup/SetupRecoverySurface";
import { resetWindowLayout } from "../shellCommands";
import { RecoverySurface } from "./RecoverySurface";
import { SetupStartupSurface } from "./SetupStartupSurface";
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
// (`window_command_refusal` in native/tauri-shell/src/main.rs, held by its
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

describe("the startup screens have no key", () => {
  it("Startup: the display carries the state and no key", () => {
    render(<StartupSurface lifecycle="waiting-for-ready-event" />);
    expect(screen.getByTestId("startup-surface-state-display").textContent).toContain("STARTING UP…");
    expect(keysOn("startup-surface-state-display")).toEqual([]);
  });

  it("Setup's startup: the display carries the state and no key", () => {
    render(<SetupStartupSurface appSnapshot={null} lifecycle="waiting-for-ready-event" />);
    expect(screen.getByTestId("setup-startup-surface-state-display").textContent).toContain("STARTING UP…");
    expect(keysOn("setup-startup-surface-state-display")).toEqual([]);
  });
});

describe("the recovery screen: Reset the window layout beside Retry startup", () => {
  it("offers the key after Retry startup; a reset that works says nothing", async () => {
    const onRequestRestart = vi.fn();
    render(<RecoverySurface failure={FAILURE} healthSnapshot={null} onRequestRestart={onRequestRestart} />);
    expect(keysOn("recovery-surface-state-display")).toEqual(["Retry startup", "Reset the window layout"]);

    fireEvent.click(screen.getByTestId("recovery-window-reset"));
    await waitFor(() => expect(resetWindowLayout).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect((screen.getByTestId("recovery-window-reset") as HTMLButtonElement).disabled).toBe(false)
    );
    expect(screen.queryByTestId("recovery-window-refusal")).toBeNull();
    expect(onRequestRestart).not.toHaveBeenCalled();
  });

  it("shows a refusal as a band of its own with the shell's sentence and the next step", async () => {
    vi.mocked(resetWindowLayout).mockRejectedValueOnce(new Error(REFUSAL));
    render(<RecoverySurface failure={FAILURE} healthSnapshot={null} onRequestRestart={() => {}} />);

    fireEvent.click(screen.getByTestId("recovery-window-reset"));
    const band = await screen.findByTestId("recovery-window-refusal");
    expect(band.textContent).toContain(REFUSAL);
    expect(within(band).getByRole("status").textContent).toContain(REFUSAL);
    // What did not happen is said once (review finding 23: the band's detail
    // said "the layout was not reset" above the same sentence), and the way on
    // names where the key is in a window as well as at the studio surface
    // (review finding 22).
    expect(band.textContent?.match(/not reset/gi)).toHaveLength(1);
    expect(band.textContent).toContain(
      "Next: retry startup, then open Setup / Support and press Support: Reset the window layout is under Workstation."
    );

    // A reset that works clears the band.
    fireEvent.click(screen.getByTestId("recovery-window-reset"));
    await waitFor(() => expect(screen.queryByTestId("recovery-window-refusal")).toBeNull());
    expect(resetWindowLayout).toHaveBeenCalledTimes(2);
  });
});

describe("Setup's recovery screen: Reset the window layout beside Retry startup", () => {
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

  it("offers the key after Retry startup; a reset that works says nothing", async () => {
    renderSetupRecovery();
    expect(keysOn("setup-recovery-surface-state-display")).toEqual([
      "Retry startup",
      "Reset the window layout",
      "Back to Console",
    ]);

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
