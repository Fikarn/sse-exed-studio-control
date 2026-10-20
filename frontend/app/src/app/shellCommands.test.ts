import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openSessionFolder, pickFolder } from "./shellCommands";

// The Session page's two folder calls (D52): in the app they ask the shell,
// which opens Windows' folder dialog or Explorer; in a browser, where no shell
// runs, the page tests' hook (`window.__SSE_TEST_SHELL__`) answers the dialog
// and keeps what Explorer was asked for.

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn<(command: string, args?: unknown) => Promise<unknown>>() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

afterEach(() => {
  delete window.__SSE_TEST_SHELL__;
  invoke.mockReset();
});

describe("the folder calls in a browser", () => {
  it("answer the folder the page tests' hook gives, or nothing", async () => {
    expect(await pickFolder("D:\\Sessions", "parent")).toBeNull();

    const asked: unknown[] = [];
    window.__SSE_TEST_SHELL__ = {
      pickFolder: (start, purpose) => {
        asked.push([start, purpose]);
        return "D:\\All\\Series (2026-04-01)";
      },
    };
    expect(await pickFolder("D:\\", "existing")).toBe("D:\\All\\Series (2026-04-01)");
    expect(asked).toEqual([["D:\\", "existing"]]);

    window.__SSE_TEST_SHELL__ = { pickFolder: async () => null };
    expect(await pickFolder(null, "root")).toBeNull();
    window.__SSE_TEST_SHELL__ = {};
    expect(await pickFolder(null, "parent")).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("keep what Open the folder asked for, in order", async () => {
    // With no hook nothing is kept, and nothing fails.
    await openSessionFolder("session");

    window.__SSE_TEST_SHELL__ = {};
    await openSessionFolder("session");
    await openSessionFolder("root");
    expect(window.__SSE_TEST_SHELL__.opened).toEqual(["session", "root"]);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("the folder calls in the app", () => {
  beforeEach(() => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it("ask the shell for Windows' folder dialog, which answers the folder, nothing or why not", async () => {
    // The hook is the browser's: in the app the shell answers.
    window.__SSE_TEST_SHELL__ = { pickFolder: () => "D:\\Elsewhere" };

    invoke.mockResolvedValueOnce("D:\\Sessions\\Series");
    expect(await pickFolder("D:\\Sessions", "parent")).toBe("D:\\Sessions\\Series");
    expect(invoke).toHaveBeenLastCalledWith("shell_pick_folder", { start: "D:\\Sessions", purpose: "parent" });

    invoke.mockResolvedValueOnce(null);
    expect(await pickFolder(null, "root")).toBeNull();
    expect(invoke).toHaveBeenLastCalledWith("shell_pick_folder", { start: null, purpose: "root" });

    invoke.mockRejectedValueOnce("FOLDER_DIALOG_FAILED: Windows' folder dialog did not open.");
    await expect(pickFolder("D:\\", "existing")).rejects.toThrow(
      "FOLDER_DIALOG_FAILED: Windows' folder dialog did not open."
    );
  });

  it("ask the shell to open the session's folder, which says why it did not", async () => {
    window.__SSE_TEST_SHELL__ = {};

    invoke.mockResolvedValueOnce(null);
    await openSessionFolder("session");
    expect(invoke).toHaveBeenLastCalledWith("shell_open_session_folder", { which: "session" });

    invoke.mockRejectedValueOnce("NO_SESSION_FOLDER: D:\\Sessions is not there: the next Begin makes it.");
    await expect(openSessionFolder("root")).rejects.toThrow(
      "NO_SESSION_FOLDER: D:\\Sessions is not there: the next Begin makes it."
    );
    expect(invoke).toHaveBeenLastCalledWith("shell_open_session_folder", { which: "root" });
    expect(window.__SSE_TEST_SHELL__.opened).toBeUndefined();
  });
});
