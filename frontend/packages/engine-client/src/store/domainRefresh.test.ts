import { describe, expect, it } from "vitest";

import { EVENT_NAMES, REQUEST_METHODS } from "../generated/protocol";
import {
  ALL_DOMAINS,
  CHANGEABLE_DOMAINS,
  DOMAIN_REQUESTS,
  EVENT_DOMAIN_REFRESH,
  domainsForEvent,
  domainsForMethod,
  type DomainKey,
} from "./domainRefresh";

// 2026-09 production readiness, Slice 9 (finding F11): the rules the refresh
// maps must keep whatever is added to them later.
describe("domainRefresh", () => {
  const everyMapping: Array<[string, readonly DomainKey[]]> = [
    ...EVENT_NAMES.map((event): [string, readonly DomainKey[]] => [event, EVENT_DOMAIN_REFRESH[event]]),
    ...REQUEST_METHODS.map((method): [string, readonly DomainKey[]] => [method, domainsForMethod(method)]),
    ...(["setup", "lighting", "audio", "planning"] as const).map((workspace): [string, readonly DomainKey[]] => [
      `opening ${workspace}`,
      domainsForMethod("settings.update", { workspace }),
    ]),
    ["an event nobody mapped", domainsForEvent("rig.changed").domains],
    ["a method nobody mapped", domainsForMethod("rig.update")],
  ];

  // The hardware link builds the DMX monitor from the lighting snapshot. The
  // workspace qualification lane failed on exactly this: commissioning
  // refreshed lighting without its monitor, and the monitor stayed empty.
  it("never fetches the lighting snapshot and its DMX monitor apart", () => {
    for (const [name, domains] of everyMapping) {
      expect(domains.includes("lightingDmxMonitor"), name).toBe(domains.includes("lighting"));
    }
  });

  it("leaves the fixture catalog to the bootstrap and refresh(), and the deck's page model to opening Setup", () => {
    for (const [name, domains] of everyMapping) {
      expect(domains, name).not.toContain("lightingFixtureCatalog");
      expect(domains.includes("controlSurface"), name).toBe(name === "opening setup");
    }
    expect([...CHANGEABLE_DOMAINS].sort()).toEqual(
      ALL_DOMAINS.filter((domain) => domain !== "lightingFixtureCatalog" && domain !== "controlSurface").sort()
    );
  });

  it("names a snapshot request the protocol has for every domain", () => {
    for (const domain of ALL_DOMAINS) {
      expect(REQUEST_METHODS).toContain(DOMAIN_REQUESTS[domain]);
    }
    expect(ALL_DOMAINS).toHaveLength(10);
  });

  it("maps a request by its own name before its prefix", () => {
    expect(domainsForMethod("settings.update")).toEqual(["app"]);
    // The commissioning snapshot carries the planning store's counts — the
    // setup-support qualification lane failed on a project count left at 2.
    expect(domainsForMethod("planning.task.create")).toEqual(["planning", "commissioning"]);
    expect(domainsForMethod("lighting.scene.recall")).toEqual(["lighting", "lightingDmxMonitor"]);
    expect(domainsForMethod("support.backup.export")).toEqual(["support"]);
    expect(domainsForMethod("support.backup.restore")).toEqual(CHANGEABLE_DOMAINS);
    expect(domainsForMethod("commissioning.seedPlanningDemo")).toContain("planning");
    expect(domainsForMethod("commissioning.check.run")).not.toContain("planning");
    expect(domainsForMethod("exports.companion.export")).toEqual([]);
    // Not a prefix match on a name that merely starts the same.
    expect(domainsForMethod("settings.updateAll")).toEqual(CHANGEABLE_DOMAINS);
  });

  it("adds the workspace's own snapshots to a workspace switch, and nothing to any other settings update", () => {
    expect(domainsForMethod("settings.update", { setup: { activeSection: "support" } })).toEqual(["app"]);
    expect(domainsForMethod("settings.update", { workspace: "audio" })).toEqual(["app", "audio"]);
    expect(domainsForMethod("settings.update", { workspace: "lighting" })).toEqual([
      "app",
      "lighting",
      "lightingDmxMonitor",
    ]);
    expect(domainsForMethod("settings.update", { workspace: "setup" })).toEqual([
      "app",
      "health",
      "commissioning",
      "support",
      "controlSurface",
    ]);
    expect(domainsForMethod("settings.update", { workspace: "somewhere new" })).toEqual(["app"]);
  });

  it("says whether it knew the event", () => {
    expect(domainsForEvent("planning.changed")).toEqual({ domains: ["planning", "commissioning"], known: true });
    expect(domainsForEvent("rig.changed")).toEqual({ domains: CHANGEABLE_DOMAINS, known: false });
  });
});
