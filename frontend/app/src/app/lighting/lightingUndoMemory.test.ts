import { describe, expect, it } from "vitest";

import { createShellStore } from "@sse/engine-client";
import { createFixtureTransport } from "@sse/engine-client/fixture";
import { getFixtureScenario } from "@sse/test-fixtures";

import { lightingUndoMemory } from "./lightingUndoMemory";

// Found, to check (2026-09-28): Lighting's Undo forgot its steps when the page
// was left. One memory for each store keeps them, and forgets them when the
// saved data they name may have changed under them: a restore, or a restart of
// the hardware link.

async function readyStore(scenario = "setup-ready") {
  const store = createShellStore(createFixtureTransport(getFixtureScenario(scenario)));
  await store.initialize();
  expect(store.getSnapshot().lifecycle).toBe("ready");
  return store;
}

const step = (label: string) => ({ label, undo: async () => {} });

describe("Lighting's undo memory", () => {
  it("is one memory for a store, whatever visit asks for it", async () => {
    const store = await readyStore();
    const first = lightingUndoMemory(store);
    first.history.push(step("Save scene A"));
    const again = lightingUndoMemory(store);
    expect(again).toBe(first);
    expect(again.history.nextLabel()).toBe("Save scene A");

    const other = lightingUndoMemory(await readyStore());
    expect(other).not.toBe(first);
    expect(other.history.nextLabel()).toBeNull();
    await store.dispose();
  });

  it("forgets every step, and the targets they name, at a restore", async () => {
    const store = await readyStore();
    const memory = lightingUndoMemory(store);
    const target = memory.targets.of("scene", "scene-custom-1");
    memory.history.push(step("Delete scene A"));

    const backups = store.getSnapshot().supportSnapshot?.backups;
    const path = Array.isArray(backups) ? String((backups[0] as { path?: string }).path) : "";
    await store.restoreSupportBackup(path);

    expect(store.getSnapshot().restoreCount).toBe(1);
    expect(memory.history.nextLabel()).toBeNull();
    expect(target.id).toBeNull();
    expect(memory.targets.of("scene", "scene-custom-1")).not.toBe(target);
    await store.dispose();
  });

  it("forgets every step when the hardware link restarts", async () => {
    const store = await readyStore();
    const memory = lightingUndoMemory(store);
    memory.history.push(step("Add fixture Key"));

    await store.restart();

    expect(store.getSnapshot().lifecycle).toBe("ready");
    expect(memory.history.nextLabel()).toBeNull();
    await store.dispose();
  });

  // The review of #263: a restore the hardware link applied can still throw
  // in the store (the reads after it failed, the reply came late), so the
  // count moves before the request and the steps go either way.
  it("forgets every step at a restore that throws, and keeps the count through a restart", async () => {
    const store = await readyStore();
    const memory = lightingUndoMemory(store);
    memory.history.push(step("Save scene A"));

    await expect(store.restoreSupportBackup("C:\\elsewhere\\not-a-backup.json")).rejects.toThrow();
    expect(store.getSnapshot().restoreCount).toBe(1);
    expect(memory.history.nextLabel()).toBeNull();

    await store.restart();
    expect(store.getSnapshot().restoreCount).toBe(1);
    await store.dispose();
  });

  it("forgets a target whose scene left the rig, so a scene saved later under its id is another", async () => {
    const store = await readyStore("lighting-populated");
    const memory = lightingUndoMemory(store);
    const scene = store.getSnapshot().lightingSnapshot?.scenes[0];
    if (!scene) throw new Error("the rig has a scene");
    const target = memory.targets.of("scene", scene.id);

    await store.deleteLightingScene(scene.id);

    expect(target.id).toBeNull();
    expect(memory.targets.of("scene", scene.id)).not.toBe(target);
    await store.dispose();
  });

  it("does not put a failed step back into a history cleared while it ran", async () => {
    const store = await readyStore();
    const memory = lightingUndoMemory(store);
    let fail: (error: unknown) => void = () => {};
    memory.history.push({
      label: "Delete fixture Key",
      undo: () =>
        new Promise<void>((_, reject) => {
          fail = reject;
        }),
    });

    const running = memory.history.undo();
    memory.history.clear();
    fail(new Error("the hardware link stopped"));

    expect((await running).kind).toBe("error");
    expect(memory.history.nextLabel()).toBeNull();
    await store.dispose();
  });

  it("keeps its steps through everything else the store hears", async () => {
    const store = await readyStore();
    const memory = lightingUndoMemory(store);
    memory.history.push(step("Save scene A"));

    await store.setWorkspace("audio");
    await store.setWorkspace("lighting");

    expect(memory.history.nextLabel()).toBe("Save scene A");
    await store.dispose();
  });
});
