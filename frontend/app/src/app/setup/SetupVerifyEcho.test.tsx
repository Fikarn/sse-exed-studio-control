import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMemo, useSyncExternalStore } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { AppShellFrame } from "@sse/design-system";
import { createShellStore, type ShellStore } from "@sse/engine-client";
import { createFixtureTransport } from "@sse/engine-client/fixture";
import { getFixtureScenario } from "@sse/test-fixtures";

import { OperatorLayoutProvider } from "../OperatorLayoutProvider";
import { SetupSupportPilot } from "./SetupSupportPilot";

// Setup's Verify step with the deck's four pages (D5). A press of the deck
// arrives as the bridge's last event, with the route it came on; the cell of
// the key that was pressed pulses. A cell can pulse only where it is drawn, so
// a key of another page turns Setup to that page. The pages are the hardware
// link's page model, which the double draws; the presses are given here, since
// the double has no deck.

interface Press {
  route: string;
  action: string;
  value: string | null;
  at: number;
}

function PilotWithDeck({ store, press }: { store: ShellStore; press: Press | null }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const pages = state.controlSurfaceSnapshot;
  const deck = useMemo(() => (pages ? { ...pages, lastEvent: press } : null), [pages, press]);
  return (
    <OperatorLayoutProvider>
      <AppShellFrame activeWorkspace="setup" cluster="slot" footer="slot" monitorItems={[]} workspaces={[]}>
        <SetupSupportPilot
          appSnapshot={state.appSnapshot}
          camerasSnapshot={state.camerasSnapshot}
          commissioningSnapshot={state.commissioningSnapshot}
          controlSurfaceSnapshot={deck}
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

async function renderVerify() {
  const store = createShellStore(createFixtureTransport(getFixtureScenario("setup-required")));
  await store.initialize();
  await store.updateCommissioning({ runnerStage: "verify" });
  const view = render(<PilotWithDeck store={store} press={null} />);
  await screen.findByRole("heading", { name: "Verify live echo" });
  let at = 0;
  const press = (route: string, action: string, value: string | null = null) => {
    at += 1;
    view.rerender(<PilotWithDeck store={store} press={{ route, action, value, at }} />);
  };
  return { store, press };
}

const tab = (name: string) => screen.getByRole("button", { name });
const step = () => screen.getByTestId("setup-screen-verify");
/** The cells that pulse: their words, as the key prints them. */
const pulsing = () =>
  [...step().querySelectorAll<HTMLElement>('[data-echo="true"]')].map(
    (cell) => cell.querySelector("span")?.textContent ?? cell.textContent
  );

afterEach(() => {
  cleanup();
});

describe("Setup's Verify step and the deck's four pages", () => {
  it("draws a tab for each page of the deck, LIGHTS first", async () => {
    const { store } = await renderVerify();
    const tabs = [...step().querySelectorAll<HTMLElement>("[data-active]")];
    expect(tabs.map((entry) => entry.textContent)).toEqual(["LIGHTS", "AUDIO", "CAMERAS", "PROMPTER"]);
    expect(tab("LIGHTS").getAttribute("data-active")).toBe("true");
    expect(pulsing()).toEqual([]);
    await store.dispose();
  });

  it("turns to the page of the key that was pressed, and its cell pulses", async () => {
    const { store, press } = await renderVerify();
    // The first press seen was made before the step was opened: it is no echo.
    press("/api/deck/light-action", "allOn");
    expect(pulsing()).toEqual([]);

    press("/api/deck/camera-action", "select", "2");
    await waitFor(() => expect(tab("CAMERAS").getAttribute("data-active")).toBe("true"));
    expect(pulsing()).toEqual(["CAM 2"]);
    expect(within(step()).getByRole("button", { name: "CAM 2 button" }).getAttribute("data-selected")).toBe("true");
    expect(within(step()).getByText("Select CAM 2: the dials, the plate and the big picture follow.")).toBeTruthy();
    // The pulse is short.
    await waitFor(() => expect(pulsing()).toEqual([]));
    expect(tab("CAMERAS").getAttribute("data-active")).toBe("true");

    press("/api/deck/prompter-action", "playPause");
    await waitFor(() => expect(tab("PROMPTER").getAttribute("data-active")).toBe("true"));
    expect(pulsing()).toEqual(["PLAY"]);
    expect(within(step()).getByText("Play or pause the prompter.")).toBeTruthy();

    press("/api/deck/audio-action", "dialTurn", "2:up");
    await waitFor(() => expect(tab("AUDIO").getAttribute("data-active")).toBe("true"));
    expect(pulsing()).toEqual(["Level Up"]);
    expect(within(step()).getByText("Ride the level on strip 2.")).toBeTruthy();
    await store.dispose();
  });

  it("leaves the page and the chosen control alone when the key is on the page it shows", async () => {
    const { store, press } = await renderVerify();
    const user = userEvent.setup();
    press("/api/deck/light-action", "allOn");
    await user.click(tab("AUDIO"));
    await user.click(within(step()).getByRole("button", { name: "DIM button" }));

    press("/api/deck/audio-action", "stripTap", "3");
    await waitFor(() => expect(pulsing()).toEqual(["Strip 3"]));
    expect(tab("AUDIO").getAttribute("data-active")).toBe("true");
    expect(within(step()).getByRole("button", { name: "DIM button" }).getAttribute("data-selected")).toBe("true");
    await store.dispose();
  });

  it("takes a press for the key of its own route: the two BANK keys are two pages'", async () => {
    const { store, press } = await renderVerify();
    const user = userEvent.setup();
    press("/api/deck/light-action", "allOn");
    await user.click(tab("AUDIO"));

    // The CAMERAS page's BANK, while Setup shows AUDIO, which has a BANK of its own.
    press("/api/deck/camera-action", "bank");
    await waitFor(() => expect(tab("CAMERAS").getAttribute("data-active")).toBe("true"));
    expect(pulsing()).toEqual(["BANK"]);
    expect(within(step()).getByText("Put the dials on exposure, colour or focus, in turn.")).toBeTruthy();

    press("/api/deck/audio-action", "cycleBank");
    await waitFor(() => expect(tab("AUDIO").getAttribute("data-active")).toBe("true"));
    expect(pulsing()).toEqual(["BANK"]);
    expect(within(step()).getByText("Cycle the dial bank: inputs, playback, outputs.")).toBeTruthy();
    await store.dispose();
  });
});
