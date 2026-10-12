import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createShellStore, type ShellState } from "@sse/engine-client";
import { createFixtureTransport } from "@sse/engine-client/fixture";
import { getFixtureScenario } from "@sse/test-fixtures";

import { useTauriShellTestBridge } from "./tauriShellTestBridge";

// The status file the shell lanes read (`shell_test_bridge_write_status`)
// carries the whole shell state, serialised. That work is a lane's alone: in
// the app, where the shell answers `shell_test_bridge_config` with nothing,
// no status is built and nothing is written, however often the store changes
// (the audit of 2026-10-12: the state was serialised at every store change
// for a file nothing read).

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn<(command: string, args?: unknown) => Promise<unknown>>() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const STATUS_PATH = "C:/lane/shell-status.json";

function answerInvokes(config: { statusPath: string | null; commandPath: string | null } | null) {
  invoke.mockImplementation((command: string) => {
    switch (command) {
      case "shell_test_bridge_config":
        return Promise.resolve(config);
      case "engine_summary":
        return Promise.resolve({ generation: 1, pid: 4242, running: true });
      default:
        return Promise.resolve(null);
    }
  });
}

const writes = () => invoke.mock.calls.filter(([command]) => command === "shell_test_bridge_write_status");

const settle = () => act(async () => {});

describe("the shell test bridge's status", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    invoke.mockReset();
    vi.useRealTimers();
  });

  it("is not built in the app, however often the store changes", async () => {
    answerInvokes(null);
    const store = createShellStore(createFixtureTransport(getFixtureScenario("audio-populated")));
    const first = store.getSnapshot();
    const hook = renderHook(
      ({ shellState }: { shellState: ShellState }) => useTauriShellTestBridge(shellState, store),
      {
        initialProps: { shellState: first },
      }
    );
    await settle();
    expect(invoke).toHaveBeenCalledWith("shell_test_bridge_config");

    hook.rerender({ shellState: { ...first, activeWorkspace: "lighting" } });
    hook.rerender({ shellState: { ...first, activeWorkspace: "cameras" } });
    await settle();
    expect(writes()).toEqual([]);
  });

  it("is written under a lane's status path, at every change of the shell state", async () => {
    answerInvokes({ statusPath: STATUS_PATH, commandPath: null });
    const store = createShellStore(createFixtureTransport(getFixtureScenario("audio-populated")));
    const first = store.getSnapshot();
    const hook = renderHook(
      ({ shellState }: { shellState: ShellState }) => useTauriShellTestBridge(shellState, store),
      {
        initialProps: { shellState: first },
      }
    );
    await settle();
    await settle();
    expect(writes().length).toBeGreaterThan(0);
    const [, args] = writes().at(-1) as [
      string,
      { status: { shellState: { activeWorkspace: string }; testBridge: { statusPath: string } } },
    ];
    expect(args.status.shellState.activeWorkspace).toBe(first.activeWorkspace);
    expect(args.status.testBridge.statusPath).toBe(STATUS_PATH);

    const before = writes().length;
    hook.rerender({ shellState: { ...first, activeWorkspace: "lighting" } });
    await settle();
    const after = writes();
    expect(after.length).toBe(before + 1);
    const [, changed] = after.at(-1) as [string, { status: { shellState: { activeWorkspace: string } } }];
    expect(changed.status.shellState.activeWorkspace).toBe("lighting");
  });
});
