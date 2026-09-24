import { useState } from "react";

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createShellStore,
  useShellSnapshot,
  type BackgroundFailure,
  type EngineTransport,
  type JsonValue,
} from "@sse/engine-client";

import { BackgroundFailureBand, describeBackgroundFailures } from "../shared/BackgroundFailureBand";
import { readLogExcerpt } from "./RecoverySurface";
import { reportUiFailure } from "./reportUiFailure";
import { ShellErrorBoundary } from "./ShellErrorBoundary";
import { WorkspaceErrorBoundary } from "./WorkspaceErrorBoundary";

// 2026-09 production readiness, Slice 9 (finding F10): a render error used to
// leave a blank webview. The root boundary turns it into a page that works
// with no store at all; the workspace boundary keeps it inside the area that
// failed; and either way the failure is recorded once.

function Faulty({ fault }: { fault: { message: string | null } }): null {
  if (fault.message !== null) {
    throw new Error(fault.message);
  }
  return null;
}

beforeEach(() => {
  // React prints every error a boundary catches; the tests below cause them.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ShellErrorBoundary", () => {
  it("renders its children untouched while nothing has failed", () => {
    const { container } = render(
      <ShellErrorBoundary>
        <main data-testid="shell">shell</main>
      </ShellErrorBoundary>
    );
    expect(container.firstElementChild).toBe(screen.getByTestId("shell"));
    expect(screen.queryByTestId("shell-boundary")).toBeNull();
  });

  it("shows a page that reloads and exports with no store at all", async () => {
    const onError = vi.fn();
    const onReload = vi.fn();
    render(
      <ShellErrorBoundary onError={onError} onReload={onReload}>
        <Faulty fault={{ message: "The shell frame failed." }} />
      </ShellErrorBoundary>
    );

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("THIS SCREEN STOPPED")).toBeTruthy();
    expect(screen.getByText("The shell frame failed.")).toBeTruthy();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);

    fireEvent.click(screen.getByTestId("shell-boundary-reload"));
    expect(onReload).toHaveBeenCalledTimes(1);

    // Outside the Tauri runtime the export answers with the fixture file name.
    fireEvent.click(screen.getByTestId("shell-boundary-export"));
    await waitFor(() =>
      expect(screen.getByTestId("shell-boundary-export-result").textContent).toContain("diagnostics-fixture.json")
    );
  });

  it("still exports when the state it was asked to attach cannot be read", async () => {
    render(
      <ShellErrorBoundary
        collectDiagnostics={() => {
          throw new Error("store is gone");
        }}
      >
        <Faulty fault={{ message: "A provider failed." }} />
      </ShellErrorBoundary>
    );
    fireEvent.click(screen.getByTestId("shell-boundary-export"));
    await waitFor(() =>
      expect(screen.getByTestId("shell-boundary-export-result").textContent).toContain("Diagnostics exported")
    );
  });

  // Slice 9 (F32): a development store leaves a reply that failed its guard in
  // the state, and the store's hook throws it while rendering — so the page
  // names the request and the field instead of a workspace failing to map it.
  it("shows a malformed reply by name in a development build", async () => {
    const transport: EngineTransport = {
      request: async (method) => {
        const typed: Record<string, JsonValue> = {
          "audio.snapshot": null,
          "lighting.dmxMonitor.snapshot": null,
          "lighting.fixtureCatalog.snapshot": null,
          "lighting.snapshot": { fixtures: [], groups: "none", scenes: [] },
        };
        return method in typed ? (typed[method] ?? null) : { protocol: "1" };
      },
      subscribe: () => () => {},
    };
    const store = createShellStore(transport, { development: true });
    function Shell() {
      const state = useShellSnapshot(store);
      return <p>{state.lifecycle}</p>;
    }
    render(
      <ShellErrorBoundary>
        <Shell />
      </ShellErrorBoundary>
    );
    await act(async () => {
      await store.initialize();
    });
    expect(screen.getByText("lighting.snapshot: groups is not a list")).toBeTruthy();
    await store.dispose();
  });
});

describe("WorkspaceErrorBoundary", () => {
  function Host({ fault, onError }: { fault: { message: string | null }; onError?: (error: Error) => void }) {
    const [reloads, setReloads] = useState(0);
    return (
      <div data-testid="stack">
        <WorkspaceErrorBoundary
          key={`lighting:${reloads}`}
          area="Lighting"
          onError={onError}
          onReset={() => setReloads((count) => count + 1)}
        >
          <Faulty fault={fault} />
          <section data-testid="surface">rig</section>
        </WorkspaceErrorBoundary>
        <footer data-testid="outside">shell chrome</footer>
      </div>
    );
  }

  it("adds no element of its own", () => {
    render(<Host fault={{ message: null }} />);
    expect(screen.getByTestId("stack").firstElementChild).toBe(screen.getByTestId("surface"));
  });

  it("keeps a render error inside the area and brings the area back on reload", () => {
    const fault: { message: string | null } = { message: "The stage plot failed." };
    const onError = vi.fn();
    render(<Host fault={fault} onError={onError} />);

    expect(screen.getByText("LIGHTING STOPPED")).toBeTruthy();
    expect(screen.getByText("The stage plot failed.")).toBeTruthy();
    expect(screen.queryByTestId("surface")).toBeNull();
    // What sits outside the boundary is untouched.
    expect(screen.getByTestId("outside").textContent).toBe("shell chrome");
    expect(onError).toHaveBeenCalledTimes(1);

    // While the fault stands, reloading the area shows the same state again.
    fireEvent.click(screen.getByTestId("workspace-boundary-reload"));
    expect(screen.getByText("LIGHTING STOPPED")).toBeTruthy();

    fault.message = null;
    fireEvent.click(screen.getByTestId("workspace-boundary-reload"));
    expect(screen.queryByTestId("workspace-boundary")).toBeNull();
    expect(screen.getByTestId("surface").textContent).toBe("rig");
  });
});

describe("reportUiFailure", () => {
  it("records an error once, whoever sees it first", () => {
    const recorded: Array<[unknown, string | undefined]> = [];
    const sink = {
      reportBackgroundFailure: (error: unknown, context?: string) => void recorded.push([error, context]),
    };
    const onWindowError = (event: ErrorEvent) => reportUiFailure(sink, event.error ?? event.message, "window error");
    window.addEventListener("error", onWindowError);

    const fault = { message: "A strip failed." };
    render(
      <WorkspaceErrorBoundary
        area="Audio"
        onError={(error) => reportUiFailure(sink, error, "Audio stopped drawing")}
        onReset={() => {}}
      >
        <Faulty fault={fault} />
      </WorkspaceErrorBoundary>
    );
    // The same error object, reported to the window as well.
    const [first] = recorded;
    window.dispatchEvent(new ErrorEvent("error", { error: first?.[0] }));
    window.removeEventListener("error", onWindowError);

    expect(recorded).toHaveLength(1);
    expect(first?.[1]).toBe("Audio stopped drawing");
    expect((first?.[0] as Error).message).toBe("A strip failed.");

    // A different error is a different failure; a string carries no identity.
    reportUiFailure(sink, new Error("another"), "window error");
    reportUiFailure(sink, "plain text", "window error");
    reportUiFailure(sink, "plain text", "window error");
    expect(recorded).toHaveLength(4);
    // No store at all is fine, and a sink that throws is contained.
    expect(() => reportUiFailure(null, new Error("no store"), "screen error")).not.toThrow();
    expect(() =>
      reportUiFailure(
        {
          reportBackgroundFailure: () => {
            throw new Error("sink failed");
          },
        },
        new Error("x"),
        "screen error"
      )
    ).not.toThrow();
  });
});

describe("BackgroundFailureBand", () => {
  const failure = (at: string, message = "lighting.snapshot refused"): BackgroundFailure => ({
    at,
    context: "refresh after lighting.changed",
    message,
  });

  it("is absent while nothing has failed", () => {
    const { container } = render(<BackgroundFailureBand failures={[]} />);
    expect(container.firstElementChild).toBeNull();
  });

  it("says how many and since when, names no cause, and comes back after Dismiss only for a new failure", () => {
    const first = failure("2026-09-17T10:02:00.000Z");
    const { rerender } = render(<BackgroundFailureBand failures={[first]} />);
    const band = screen.getByTestId("background-failure-band");
    expect(band.textContent).toContain("Studio Control hit a problem in the background");
    expect(band.textContent).toContain("1 problem since");
    expect(band.textContent).not.toContain("lighting.snapshot");

    fireEvent.click(screen.getByTestId("background-failure-dismiss"));
    expect(screen.queryByTestId("background-failure-band")).toBeNull();
    rerender(<BackgroundFailureBand failures={[first]} />);
    expect(screen.queryByTestId("background-failure-band")).toBeNull();

    rerender(<BackgroundFailureBand failures={[first, failure("2026-09-17T10:05:00.000Z")]} />);
    expect(screen.getByTestId("background-failure-band").textContent).toContain("2 problems since");
  });

  it("counts from the oldest failure it still holds", () => {
    expect(describeBackgroundFailures([])).toContain("0 problems.");
    expect(describeBackgroundFailures([failure("not a date")])).toContain("1 problem");
  });
});

// Slice 8's hook: the hardware link sends the log excerpt as one string; the
// surface used to read a list, so on the workstation the section never showed.
describe("readLogExcerpt", () => {
  it("reads the string the hardware link sends, and a list from an older build", () => {
    expect(readLogExcerpt("[WARN] one\r\n[INFO] two\n\n")).toEqual(["[WARN] one", "[INFO] two"]);
    expect(readLogExcerpt(["[WARN] one", 3, "", "[INFO] two"])).toEqual(["[WARN] one", "[INFO] two"]);
    expect(readLogExcerpt(undefined)).toEqual([]);
    expect(readLogExcerpt({ lines: [] })).toEqual([]);
  });
});
