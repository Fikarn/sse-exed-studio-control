import { lazy, type ComponentType } from "react";

import type { WorkspaceId } from "@sse/engine-client";

// 2026-09 production readiness, Slice 14 (finding F26). Each workspace is its
// own chunk, so the startup surface draws before any workspace's code has been
// fetched or evaluated. The shell asks for the active workspace's chunk once it
// has drawn, and for the other three when it is ready and idle, so a chunk is
// in hand before the operator can ask for its workspace.
//
// The three modules the shell itself reads from a workspace's folder
// (`audio/audioFormatting`, `lighting/lightingDrift`,
// `lighting/useUnsavedScenePrompt`) stay with the shell. That is why the chunks
// are cut by these `import()` calls and not by a `manualChunks` rule on the
// folder: a folder rule would put those three in the workspace's chunk and the
// shell would fetch the whole workspace at startup to reach them.

interface LoadedSurface<Props> {
  default: ComponentType<Props>;
}

/** `lazy()` reads a thenable, and one that answers at once never suspends: a
 *  workspace whose chunk is already in hand mounts in the commit that asks for
 *  it, exactly as it did when it was part of the shell's bundle. */
function settled<Value>(value: Value): Promise<Value> {
  const thenable = { then: (onFulfilled: (settledValue: Value) => void) => onFulfilled(value) };
  return thenable as unknown as Promise<Value>;
}

function workspaceChunk<Props>(load: () => Promise<ComponentType<Props>>) {
  let loaded: LoadedSurface<Props> | null = null;
  let pending: Promise<LoadedSurface<Props>> | null = null;

  function createSurface() {
    return lazy(() => (loaded ? settled(loaded) : fetchChunk()));
  }

  function fetchChunk(): Promise<LoadedSurface<Props>> {
    pending ??= load().then(
      (component) => {
        loaded = { default: component };
        return loaded;
      },
      (error: unknown) => {
        // `lazy()` keeps a failure for good. A fresh one lets "Reload this
        // area" on the workspace boundary fetch the chunk again.
        pending = null;
        surface = createSurface();
        throw error;
      }
    );
    return pending;
  }

  let surface = createSurface();

  return {
    get Surface() {
      return surface;
    },
    /** Fetch the chunk ahead of need. A failure is left for the render that
     *  needs the chunk: the workspace boundary reports it there. */
    preload(): Promise<void> {
      return fetchChunk().then(
        () => undefined,
        () => undefined
      );
    },
  };
}

export const workspaceChunks = {
  setup: workspaceChunk(() => import("./setup/SetupSupportPilot").then((module) => module.SetupSupportPilot)),
  lighting: workspaceChunk(() =>
    import("./lighting/LightingWorkspace").then((module) => module.LightingWorkspaceSurface)
  ),
  audio: workspaceChunk(() => import("./audio/AudioWorkspace").then((module) => module.AudioWorkspace)),
  planning: workspaceChunk(() =>
    import("./planning/PlanningWorkspace").then((module) => module.PlanningWorkspaceSurface)
  ),
};

export const WORKSPACE_IDS: readonly WorkspaceId[] = ["setup", "lighting", "audio", "planning"];

export function preloadWorkspace(workspaceId: WorkspaceId): Promise<void> {
  return workspaceChunks[workspaceId].preload();
}

/** Run `task` when the page is idle; returns the cancel. */
export function whenIdle(task: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(task, { timeout: 2000 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(task, 200);
  return () => window.clearTimeout(handle);
}
