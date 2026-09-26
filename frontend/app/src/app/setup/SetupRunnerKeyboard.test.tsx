import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSyncExternalStore } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { AppShellFrame } from "@sse/design-system";
import { createFixtureTransport, createShellStore, type ShellStore } from "@sse/engine-client";
import { getFixtureScenario } from "@sse/test-fixtures";

import { OperatorLayoutProvider } from "../OperatorLayoutProvider";
import { SetupSupportPilot } from "./SetupSupportPilot";

// New pages program, Slice 3 (D6; the inventory's §7 note 4). Setup bound keys
// of its own on the window: Shift+S flipped Runner and Support even while a
// field was being typed in (a capital S never reached the field), Tab stepped
// the runner instead of moving focus, Enter ran the step's main key whatever
// had focus, and J, K and 1–4 chose deck controls and pages on the Map step.
// All of it is gone: the keyboard does what it does everywhere else — Tab
// moves focus, Enter or Space presses the focused key, typing goes into the
// field. "Skip ahead?" is a standard confirm now (decision 11): it takes focus
// when it opens and Esc closes it without skipping.

// The pilot inside the shell's frame, so its cluster (the Runner / Support
// switch and the step keys) and its footer are drawn as on the workstation.
function PilotInShell({ store }: { store: ShellStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return (
    <OperatorLayoutProvider>
      <AppShellFrame activeWorkspace="setup" cluster="slot" footer="slot" monitorItems={[]} workspaces={[]}>
        <SetupSupportPilot
          appSnapshot={state.appSnapshot}
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

/** Setup before commissioning, on the Import step or, when asked, on Map. */
async function renderRunner(runnerStage: "import" | "map" = "import") {
  const store = createShellStore(createFixtureTransport(getFixtureScenario("setup-required")));
  await store.initialize();
  if (runnerStage === "map") {
    await store.updateCommissioning({ runnerStage: "map" });
  }
  render(<PilotInShell store={store} />);
  await screen.findByRole("heading", { name: runnerStage === "map" ? "Map bindings" : "Import the Companion profile" });
  return store;
}

/** Nothing focused: a key goes to the page, not to a control. */
function blurAll() {
  (document.activeElement as HTMLElement | null)?.blur();
  expect(document.activeElement).toBe(document.body);
}

beforeAll(() => {
  // jsdom has neither ResizeObserver nor matchMedia; the layout provider
  // only needs ones that never fire.
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

describe("the Runner binds no key of its own (new pages S3, D6)", () => {
  it("Shift+S typed into a field types a capital S and does not switch to Support", async () => {
    const store = await renderRunner();
    const setSection = vi.spyOn(store, "setSetupSection");
    const user = userEvent.setup();
    const field = screen.getByLabelText("Server base URL") as HTMLInputElement;

    await user.clear(field);
    await user.keyboard("{Shift>}S{/Shift}");

    expect(field.isConnected).toBe(true);
    expect(field.value).toBe("S");
    expect(screen.getByRole("heading", { name: "Import the Companion profile" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Backup and recovery" })).toBeNull();
    expect(screen.getByTestId("setup-mode-runner").getAttribute("aria-pressed")).toBe("true");
    expect(setSection).not.toHaveBeenCalled();
    await store.dispose();
  });

  it("Tab and Shift+Tab move focus between the keys and leave the step where it is", async () => {
    const store = await renderRunner();
    const updateCommissioning = vi.spyOn(store, "updateCommissioning");
    const user = userEvent.setup();
    const primary = screen.getByTestId("setup-step-primary");
    primary.focus();

    await user.tab();
    expect(document.activeElement).toBe(screen.getByTestId("setup-download-companion"));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(primary);

    expect(screen.getByRole("heading", { name: "Import the Companion profile" })).toBeTruthy();
    expect(screen.getByTestId("setup-step-import").getAttribute("data-standing")).toBe("current");
    expect(updateCommissioning).not.toHaveBeenCalled();
    await store.dispose();
  });

  it("Enter with no key focused runs nothing; Enter on the step's main key presses it", async () => {
    const store = await renderRunner();
    const exportProfile = vi.spyOn(store, "exportCompanionConfig");
    const user = userEvent.setup();

    blurAll();
    await user.keyboard("{Enter}");
    expect(exportProfile).not.toHaveBeenCalled();
    expect(screen.queryByTestId("setup-feedback")).toBeNull();
    expect(screen.getByRole("heading", { name: "Import the Companion profile" })).toBeTruthy();

    // D6 keeps Enter on the focused control: "Download profile" writes the
    // export and opens Probe hardware, as a click does.
    screen.getByTestId("setup-step-primary").focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("heading", { name: "Probe hardware" });
    expect(exportProfile).toHaveBeenCalledTimes(1);
    await store.dispose();
  });

  it("on the Map step, J, K and the number keys choose nothing; the page tabs name the page only", async () => {
    const store = await renderRunner("map");
    const user = userEvent.setup();
    const lights = screen.getByRole("button", { name: /^LIGHTS/ });
    const audio = screen.getByRole("button", { name: /^AUDIO/ });
    const firstLight = () => screen.getByRole("button", { name: "Light 1 button" });
    expect(lights.getAttribute("data-active")).toBe("true");
    expect(firstLight().getAttribute("data-selected")).toBe("true");

    blurAll();
    for (const key of ["2", "k", "j", "1"]) {
      await user.keyboard(key);
      expect(lights.getAttribute("data-active"), `after ${key}`).toBe("true");
      expect(audio.getAttribute("data-active"), `after ${key}`).toBe("false");
      expect(firstLight().getAttribute("data-selected"), `after ${key}`).toBe("true");
    }

    // The tabs print the page's name and nothing else (they printed its
    // number key, "LIGHTS 1"), and a press on one chooses it.
    expect(lights.textContent).toBe("LIGHTS");
    expect(audio.textContent).toBe("AUDIO");
    await user.click(audio);
    expect(audio.getAttribute("data-active")).toBe("true");
    expect(screen.getByRole("button", { name: "Channel 1 button" }).getAttribute("data-selected")).toBe("true");
    await store.dispose();
  });
});

describe('"Skip ahead?" is a standard confirm (new pages S3, decision 11)', () => {
  it("takes focus when it opens; Esc closes it without skipping and gives focus back", async () => {
    const store = await renderRunner();
    const updateCommissioning = vi.spyOn(store, "updateCommissioning");
    const user = userEvent.setup();
    const publishStep = screen.getByRole("tab", { name: "Step 5 Publish" });

    await user.click(publishStep);
    const dialog = await screen.findByRole("dialog", { name: "Skip ahead?" });
    expect(dialog.textContent).toContain(
      "Preceding steps haven't been confirmed. Skipping may leave the commissioning incomplete."
    );
    // Focus is in the dialog: on its first key in a browser, on the dialog
    // itself here (jsdom lays nothing out, so the design system's Dialog finds
    // no key it can see and focuses its own frame).
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Skip ahead?" })).toBeNull());
    expect(screen.getByRole("heading", { name: "Import the Companion profile" })).toBeTruthy();
    expect(updateCommissioning).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(publishStep);
    await store.dispose();
  });

  it("Cancel closes it without skipping; Skip ahead opens the step", async () => {
    const store = await renderRunner();
    const updateCommissioning = vi.spyOn(store, "updateCommissioning");
    const user = userEvent.setup();
    const publishStep = screen.getByRole("tab", { name: "Step 5 Publish" });

    await user.click(publishStep);
    await user.click(
      within(await screen.findByRole("dialog", { name: "Skip ahead?" })).getByRole("button", { name: "Cancel" })
    );
    expect(screen.queryByRole("dialog", { name: "Skip ahead?" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Import the Companion profile" })).toBeTruthy();
    expect(updateCommissioning).not.toHaveBeenCalled();

    await user.click(publishStep);
    await user.click(
      within(await screen.findByRole("dialog", { name: "Skip ahead?" })).getByRole("button", { name: "Skip ahead" })
    );
    await screen.findByRole("heading", { name: "Publish" });
    expect(screen.queryByRole("dialog", { name: "Skip ahead?" })).toBeNull();
    expect(updateCommissioning).toHaveBeenCalledWith({ runnerStage: "publish" });
    await store.dispose();
  });
});
