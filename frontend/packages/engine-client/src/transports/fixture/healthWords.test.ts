import { describe, expect, it } from "vitest";

import { fixtureIds, getFixtureScenario } from "@sse/test-fixtures";

import type { JsonObject } from "../../generated/protocol";
import type { FixtureScenario } from "../../types";
import { createFixtureTransport } from "../fixtureTransport";

// The double reports each subsystem in the hardware link's own words
// (`native/rust-engine/src/health.rs`, which reads `lighting/snapshot.rs`,
// `audio/snapshot.rs` and the Stream Deck bridge's own state in
// `control_surface.rs`). Until 2026-09-22 it said `ok` or `attention` for all
// three, which is why the screen only knew those two: a serving bridge and a
// verified desk read as needing attention on the workstation.

const RIG_WORDS = ["unconfigured", "disabled", "ready", "attention", "not-verified"];
const CONSOLE_WORDS = ["ready", "attention", "not-verified"];
const BRIDGE_WORDS = ["ready", "unavailable"];

type Transport = ReturnType<typeof createFixtureTransport>;

async function healthChecks(transport: Transport) {
  const health = (await transport.request("health.snapshot", {})) as JsonObject;
  const checks = health.checks as Record<string, JsonObject>;
  return {
    lighting: checks.lighting?.status,
    audio: checks.audio?.status,
    controlSurface: checks.controlSurface?.status,
    ok: {
      lighting: checks.lighting?.ok,
      audio: checks.audio?.ok,
      controlSurface: checks.controlSurface?.ok,
    },
  };
}

async function rigState(transport: Transport) {
  return ((await transport.request("lighting.snapshot", {})) as JsonObject).status;
}

async function bridgeState(transport: Transport) {
  const app = (await transport.request("app.snapshot", {})) as JsonObject;
  return ((app.runtime as JsonObject).controlSurface as JsonObject).status;
}

/** A scenario built from `setup-ready` with the rig, the console or the bridge changed. */
function scenarioWith(change: (scenario: JsonObject) => void): FixtureScenario {
  const scenario = JSON.parse(JSON.stringify(getFixtureScenario("setup-ready"))) as JsonObject;
  change(scenario);
  return scenario as unknown as FixtureScenario;
}

function probe(scenario: JsonObject, id: string, status: string) {
  const commissioning = (scenario.commissioningSnapshot ?? {}) as JsonObject;
  const checks = ((commissioning.checks ?? []) as JsonObject[]).map((check) =>
    check.id === id ? { ...check, status } : check
  );
  commissioning.checks = checks;
  scenario.commissioningSnapshot = commissioning;
}

/** `setup-ready` with the rig as written, the lighting probe as given and, if
 *  given, the bridge address a lighting probe stored. */
const withRig = (lighting: JsonObject, probeStatus: string, probedBridgeIp?: string) =>
  createFixtureTransport(
    scenarioWith((scenario) => {
      scenario.lightingSnapshot = lighting;
      probe(scenario, "lighting", probeStatus);
      if (probedBridgeIp !== undefined) {
        (scenario.commissioningSnapshot as JsonObject).lighting = { bridgeIp: probedBridgeIp, universe: 1 };
      }
    })
  );

async function rigSwitch(transport: Transport) {
  return ((await transport.request("lighting.snapshot", {})) as JsonObject).enabled;
}

describe("the fixture double's health words", () => {
  it("answers every scenario in the hardware link's vocabulary", async () => {
    for (const id of fixtureIds) {
      const transport = createFixtureTransport(getFixtureScenario(id));
      const checks = await healthChecks(transport);
      expect(RIG_WORDS, `${id} lighting`).toContain(checks.lighting);
      expect(CONSOLE_WORDS, `${id} audio`).toContain(checks.audio);
      expect(BRIDGE_WORDS, `${id} controlSurface`).toContain(checks.controlSurface);
      expect(checks.ok, `${id} ok`).toEqual({
        lighting: checks.lighting === "ready",
        audio: checks.audio === "ready",
        controlSurface: checks.controlSurface === "ready",
      });
      expect(BRIDGE_WORDS, `${id} runtime.controlSurface`).toContain(await bridgeState(transport));
    }
  });

  it("says of the rig what the hardware link says", async () => {
    const health = async (lighting: JsonObject, probeStatus: string, probedBridgeIp?: string) =>
      (await healthChecks(withRig(lighting, probeStatus, probedBridgeIp))).lighting;

    // No bridge address, nothing switched on, and no probe run: not set up.
    expect(await health({}, "idle")).toBe("unconfigured");
    // An address, but lighting switched off.
    expect(await health({ bridgeIp: "10.1.0.1", enabled: false }, "idle")).toBe("disabled");
    // An address, on by default, and the probe never run — the rig's own
    // address, or the one a lighting probe stored where the rig's own copy is
    // empty (the default rig's is).
    expect(await health({ bridgeIp: "10.1.0.1" }, "idle")).toBe("not-verified");
    expect(await health({ bridgeIp: "" }, "idle", "10.1.0.1")).toBe("not-verified");
    // The probe's outcome, whatever the scenario itself said of the rig.
    expect(await health({ bridgeIp: "10.1.0.1", status: "attention" }, "passed")).toBe("ready");
    expect(await health({ bridgeIp: "10.1.0.1", status: "ready" }, "failed")).toBe("attention");
    // The probe stores the address it was given before it runs, so a probe
    // that has run, passed or failed, means an address even where the scenario
    // leaves it out.
    expect(await health({}, "passed")).toBe("ready");
    expect(await health({}, "failed")).toBe("attention");
    // Until a probe runs, the scenario's own status stands in for it.
    expect(await health({ bridgeIp: "10.1.0.1", status: "ready" }, "idle")).toBe("ready");
    expect(await health({ bridgeIp: "10.1.0.1", status: "attention" }, "idle")).toBe("attention");
    // The scenarios written before 2026-09-22 say `ok` for a probe that passed,
    // `error` for one that failed and `attention` for one not run or not confirmed.
    expect(await health({}, "ok")).toBe("ready");
    expect(await health({}, "error")).toBe("attention");
    expect(await health({ bridgeIp: "10.1.0.1" }, "attention")).toBe("not-verified");
  });

  it("reads the published scenarios as the hardware link would", async () => {
    // `setup-ready`'s probes all say the older `ok`; `setup-degraded`'s console
    // probe does too.
    expect(await healthChecks(createFixtureTransport(getFixtureScenario("setup-ready")))).toEqual({
      lighting: "ready",
      audio: "ready",
      controlSurface: "ready",
      ok: { lighting: true, audio: true, controlSurface: true },
    });
    expect((await healthChecks(createFixtureTransport(getFixtureScenario("setup-degraded")))).audio).toBe("ready");
  });

  it("serves the health words each scenario itself carries", async () => {
    // The double works every word out afresh; the words a scenario carries are
    // the ones it serves, so nobody reading a scenario is told something else.
    for (const id of fixtureIds) {
      const scenario = getFixtureScenario(id) as unknown as JsonObject;
      const transport = createFixtureTransport(getFixtureScenario(id));
      const served = await healthChecks(transport);
      const authored = ((scenario.healthSnapshot as JsonObject | undefined)?.checks ?? {}) as Record<
        string,
        JsonObject
      >;
      for (const key of ["lighting", "audio", "controlSurface"] as const) {
        if (authored[key]?.status !== undefined) {
          expect(served[key], `${id} ${key}`).toBe(authored[key].status);
        }
      }
      const runtime = (scenario.appSnapshot as JsonObject | undefined)?.runtime as JsonObject | undefined;
      const bridge = runtime?.controlSurface as JsonObject | undefined;
      if (bridge?.status !== undefined) {
        expect(await bridgeState(transport), `${id} runtime.controlSurface`).toBe(bridge.status);
      }
    }
  });

  it("says the same of the rig in the lighting state and in the health check", async () => {
    for (const id of fixtureIds) {
      const transport = createFixtureTransport(getFixtureScenario(id));
      const rig = await rigState(transport);
      if (rig === "loading") continue;
      expect(rig, id).toBe((await healthChecks(transport)).lighting);
      // And the rig's switch agrees with its word.
      expect(await rigSwitch(transport), `${id} enabled`).toBe(rig !== "unconfigured" && rig !== "disabled");
    }
  });

  it("keeps the fixtures' own loading word out of the health check", async () => {
    const transport = createFixtureTransport(getFixtureScenario("lighting-loading"));
    expect(await rigState(transport)).toBe("loading");
    expect((await healthChecks(transport)).lighting).toBe("not-verified");
  });

  it("follows a lighting probe run after start", async () => {
    // Before 2026-09-22 the rig's word was written once, from the scenario, and
    // a probe run in the session never reached it.
    const unset = createFixtureTransport(getFixtureScenario("setup-required"));
    expect((await healthChecks(unset)).lighting).toBe("unconfigured");
    await unset.request("commissioning.check.run", { target: "lighting", bridgeIp: "10.0.0.5" });
    const reached = await healthChecks(unset);
    expect(reached.lighting).toBe("ready");
    expect(reached.ok.lighting).toBe(true);
    expect(await rigState(unset)).toBe("ready");
    expect(await rigSwitch(unset)).toBe(true);

    // A probe that failed stored its address too: the rig is on, and needs attention.
    const refusedAtStart = createFixtureTransport(getFixtureScenario("setup-required"));
    await refusedAtStart.request("commissioning.check.run", { target: "lighting", bridgeIp: "0.0.0.0" });
    expect((await healthChecks(refusedAtStart)).lighting).toBe("attention");
    expect(await rigState(refusedAtStart)).toBe("attention");
    expect(await rigSwitch(refusedAtStart)).toBe(true);

    const rig = createFixtureTransport(getFixtureScenario("lighting-populated"));
    expect((await healthChecks(rig)).lighting).toBe("ready");
    await rig.request("commissioning.check.run", { target: "lighting", bridgeIp: "0.0.0.0" });
    const refused = await healthChecks(rig);
    expect(refused.lighting).toBe("attention");
    expect(refused.ok.lighting).toBe(false);
    expect(await rigState(rig)).toBe("attention");
    expect(await rigSwitch(rig)).toBe(true);
  });

  it("says of the console what the probe found", async () => {
    const withProbe = (status: string) =>
      createFixtureTransport(
        scenarioWith((scenario) => {
          probe(scenario, "audio", status);
        })
      );
    expect((await healthChecks(withProbe("passed"))).audio).toBe("ready");
    expect((await healthChecks(withProbe("failed"))).audio).toBe("attention");
    expect((await healthChecks(withProbe("idle"))).audio).toBe("not-verified");

    // A probe run after start.
    const desk = createFixtureTransport(getFixtureScenario("setup-required"));
    expect((await healthChecks(desk)).audio).toBe("not-verified");
    await desk.request("commissioning.check.run", { target: "audio", sendPort: 1 });
    expect((await healthChecks(desk)).audio).toBe("attention");
    await desk.request("commissioning.check.run", { target: "audio", sendPort: 7001 });
    const answered = await healthChecks(desk);
    expect(answered.audio).toBe("ready");
    expect(answered.ok.audio).toBe(true);

    // The hardware link's console check reads the probe alone, OSC on or off.
    expect((await healthChecks(createFixtureTransport(getFixtureScenario("audio-osc-disabled")))).audio).toBe("ready");
  });

  it("answers in the same words while the console has not loaded", async () => {
    const checks = await healthChecks(createFixtureTransport(getFixtureScenario("audio-loading")));
    expect(checks).toEqual({
      lighting: "ready",
      audio: "ready",
      controlSurface: "ready",
      ok: { lighting: true, audio: true, controlSurface: true },
    });
  });

  it("says of the Stream Deck whether its bridge is serving, not whether the deck was verified", async () => {
    const serving = createFixtureTransport(
      scenarioWith((scenario) => {
        probe(scenario, "control-surface", "failed");
      })
    );
    const servingChecks = await healthChecks(serving);
    expect(servingChecks.controlSurface).toBe("ready");
    expect(servingChecks.ok.controlSurface).toBe(true);
    expect(await bridgeState(serving)).toBe("ready");

    const refused = createFixtureTransport(
      scenarioWith((scenario) => {
        const runtime = ((scenario.appSnapshot as JsonObject).runtime ?? {}) as JsonObject;
        runtime.controlSurface = { available: false, summary: "The bridge could not bind its port." };
        (scenario.appSnapshot as JsonObject).runtime = runtime;
      })
    );
    const refusedChecks = await healthChecks(refused);
    expect(refusedChecks.controlSurface).toBe("unavailable");
    expect(refusedChecks.ok.controlSurface).toBe(false);
    expect(await bridgeState(refused)).toBe("unavailable");
  });
});
