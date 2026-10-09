import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createShellStore } from "@sse/engine-client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createShellEnvironment } from "./createShellEnvironment";

// The store the environment makes is the real one; the spy only reads the
// options it is made with (the landing page, D47).
vi.mock("@sse/engine-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sse/engine-client")>();
  return { ...actual, createShellStore: vi.fn(actual.createShellStore) };
});
const storeOptions = () => vi.mocked(createShellStore).mock.lastCall?.[1];

// 2026-09-28: the engine's test double is loaded on request, in a browser. It
// was part of the app's main bundle, and `?transport=fixture` could put the
// app's window on test data.

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function productionModules(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) productionModules(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.(test|stories)\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const relative = (file: string) => path.relative(SRC, file).split(path.sep).join("/");

describe("the engine's test double", () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    window.history.replaceState(null, "", "/");
    window.sessionStorage.clear();
  });

  it("is what the shell runs on in a browser", async () => {
    window.history.replaceState(null, "", "/?fixture=audio-populated&transport=fixture");
    const environment = await createShellEnvironment();
    expect(environment.liveTransportRequested).toBe(false);
    expect(environment.fixtureId).toBe("audio-populated");
    await environment.store.initialize();
    expect(environment.store.getSnapshot().lifecycle).toBe("ready");
    expect(environment.store.getSnapshot().activeWorkspace).toBe("audio");
    expect(storeOptions()?.landing).toBeUndefined();
    await environment.store.dispose();
  });

  // D47: the app opens on the Overview at every start; a page test asks for
  // it, as `?crash=` asks for a fault, and every other open keeps the page
  // its fixture saved.
  it("lands on the Overview when the address asks for it", async () => {
    window.history.replaceState(null, "", "/?fixture=audio-populated&transport=fixture&landing=1");
    const environment = await createShellEnvironment();
    expect(storeOptions()?.landing).toBe("overview");
    await environment.store.initialize();
    expect(environment.store.getSnapshot().lifecycle).toBe("ready");
    expect(environment.store.getSnapshot().activeWorkspace).toBe("overview");
    await environment.store.dispose();
  });

  // The review of the landing: the root error screen's Reload loads the
  // window again over the hardware link that runs on. That is no start of the
  // app, so the page and the deck stay where they were.
  it("lands once in a window's life: a reload of the window keeps the page", async () => {
    window.history.replaceState(null, "", "/?fixture=audio-populated&transport=fixture&landing=1");
    const first = await createShellEnvironment();
    await first.store.initialize();
    expect(first.store.getSnapshot().activeWorkspace).toBe("overview");
    await first.store.dispose();

    const reloaded = await createShellEnvironment();
    expect(storeOptions()?.landing).toBeUndefined();
    await reloaded.store.initialize();
    expect(reloaded.store.getSnapshot().activeWorkspace).toBe("audio");
    await reloaded.store.dispose();
  });

  it("cannot be chosen by the address in the app's window", async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    window.history.replaceState(null, "", "/?fixture=audio-populated&transport=fixture");
    const environment = await createShellEnvironment();
    expect(environment.liveTransportRequested).toBe(true);
    expect(environment.crashWorkspace).toBeNull();
    // The app's window lands on the Overview whatever the address says.
    expect(storeOptions()?.landing).toBe("overview");
  });

  it("is imported by one module, which is loaded on request", () => {
    const importers: string[] = [];
    const staticImportsOfTheLoader: string[] = [];
    for (const file of productionModules(SRC)) {
      const text = readFileSync(file, "utf8");
      if (/from\s+"@sse\/engine-client\/fixture"|from\s+"@sse\/test-fixtures"/.test(text)) {
        importers.push(relative(file));
      }
      if (/from\s+"[^"]*\/fixtureDouble"/.test(text)) {
        staticImportsOfTheLoader.push(relative(file));
      }
    }
    // `glassStoryScript.ts` is the stories' and the tests' text for the glass,
    // and `camerasTestData.ts` the cameras the Cameras page's tests read; no
    // page imports either.
    expect(importers.sort()).toEqual([
      "app/cameras/camerasTestData.ts",
      "app/fixtureDouble.ts",
      "app/teleprompter/glass/glassStoryScript.ts",
    ]);
    expect(staticImportsOfTheLoader).toEqual([]);
    expect(readFileSync(path.join(SRC, "app", "createShellEnvironment.ts"), "utf8")).toContain(
      'await import("./fixtureDouble")'
    );
    for (const file of productionModules(SRC)) {
      expect(readFileSync(file, "utf8"), relative(file)).not.toMatch(/from\s+"[^"]*glassStoryScript"/);
      expect(readFileSync(file, "utf8"), relative(file)).not.toMatch(/from\s+"[^"]*camerasTestData"/);
    }
  });
});
