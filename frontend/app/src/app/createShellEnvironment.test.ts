import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { createShellEnvironment } from "./createShellEnvironment";

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
  });

  it("is what the shell runs on in a browser", async () => {
    window.history.replaceState(null, "", "/?fixture=audio-populated&transport=fixture");
    const environment = await createShellEnvironment();
    expect(environment.liveTransportRequested).toBe(false);
    expect(environment.fixtureId).toBe("audio-populated");
    await environment.store.initialize();
    expect(environment.store.getSnapshot().lifecycle).toBe("ready");
    expect(environment.store.getSnapshot().activeWorkspace).toBe("audio");
    await environment.store.dispose();
  });

  it("cannot be chosen by the address in the app's window", async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    window.history.replaceState(null, "", "/?fixture=audio-populated&transport=fixture");
    const environment = await createShellEnvironment();
    expect(environment.liveTransportRequested).toBe(true);
    expect(environment.crashWorkspace).toBeNull();
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
    // `glassStoryScript.ts` is the stories' and the tests' text for the glass;
    // no page imports it.
    expect(importers.sort()).toEqual(["app/fixtureDouble.ts", "app/teleprompter/glass/glassStoryScript.ts"]);
    expect(staticImportsOfTheLoader).toEqual([]);
    expect(readFileSync(path.join(SRC, "app", "createShellEnvironment.ts"), "utf8")).toContain(
      'await import("./fixtureDouble")'
    );
    for (const file of productionModules(SRC)) {
      expect(readFileSync(file, "utf8"), relative(file)).not.toMatch(/from\s+"[^"]*glassStoryScript"/);
    }
  });
});
