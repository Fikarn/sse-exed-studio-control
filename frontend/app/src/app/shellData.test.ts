import { describe, expect, it } from "vitest";

import { buildMonitorItems, deriveLightingWorkspaceTone, withRestoreDetail } from "./shellData";

// New pages program, Slice 2 (D3): a restore's `detail` (the hardware link's
// note that a backup's Planning data was not restored) follows the shell's
// sentence; anything that is not a sentence adds nothing.
describe("a restore's detail", () => {
  it("follows the shell's sentence when the reply carries one", () => {
    expect(withRestoreDetail("Restored.", { detail: "Planning data in this backup was not restored." })).toBe(
      "Restored. Planning data in this backup was not restored."
    );
  });

  it("adds nothing without a sentence", () => {
    expect(withRestoreDetail("Restored.", null)).toBe("Restored.");
    expect(withRestoreDetail("Restored.", { restored: true })).toBe("Restored.");
    expect(withRestoreDetail("Restored.", { detail: "  " })).toBe("Restored.");
    expect(withRestoreDetail("Restored.", { detail: 4 })).toBe("Restored.");
  });
});

// 2026-09 production readiness, Slice 11 (F31): the header's Lighting lamp
// says `held` while the light outputs are held — on every workspace, because
// the header is on every workspace.

function lightingLamp(healthStatus: string | undefined, lighting: ReturnType<typeof deriveLightingWorkspaceTone>) {
  const health = healthStatus ? { checks: { lighting: { status: healthStatus } } } : null;
  const lamp = buildMonitorItems(health, undefined, { lighting }).find((item) => item.id === "lighting");
  if (!lamp) {
    throw new Error("the Lighting lamp is missing");
  }
  return { detail: lamp.detail, status: lamp.status };
}

describe("the Lighting lamp and held light outputs", () => {
  it("only an explicit false is a hold", () => {
    expect(deriveLightingWorkspaceTone(null, false)).toBeNull();
    expect(deriveLightingWorkspaceTone({ reachable: true }, false)).toBeNull();
    expect(deriveLightingWorkspaceTone({ outputArmed: true, reachable: true }, false)).toBeNull();
    expect(deriveLightingWorkspaceTone({ outputArmed: false, reachable: true }, false)).toEqual({
      tone: "attention",
      winsTies: true,
      word: "held",
    });
  });

  it("no bridge outranks a hold, and a hold outranks an unsaved scene", () => {
    expect(deriveLightingWorkspaceTone({ outputArmed: false, reachable: false }, true)?.word).toBe("no bridge");
    expect(deriveLightingWorkspaceTone({ outputArmed: false, reachable: true }, true)?.word).toBe("held");
    expect(deriveLightingWorkspaceTone({ outputArmed: true, reachable: true }, true)?.word).toBe("unsaved");
  });

  it("says held over a healthy bridge, in the attention tone", () => {
    const held = deriveLightingWorkspaceTone({ outputArmed: false, reachable: true }, false);
    expect(lightingLamp("ok", held)).toEqual({ detail: "held", status: "attention" });
  });

  it("says held when the health check is at attention too — the tie an unsaved scene loses", () => {
    const held = deriveLightingWorkspaceTone({ outputArmed: false, reachable: true }, false);
    expect(lightingLamp("attention", held)).toEqual({ detail: "held", status: "attention" });
    expect(lightingLamp(undefined, held)).toEqual({ detail: "held", status: "attention" });

    const unsaved = deriveLightingWorkspaceTone({ outputArmed: true, reachable: true }, true);
    expect(lightingLamp("attention", unsaved).detail).not.toBe("unsaved");
  });

  it("leaves an error to the health check", () => {
    const held = deriveLightingWorkspaceTone({ outputArmed: false, reachable: true }, false);
    const lamp = lightingLamp("error", held);
    expect(lamp.status).toBe("error");
    expect(lamp.detail).not.toBe("held");
  });
});

// 2026-09-21: the header lamps must read the hardware link's own health words.
// The fixture double said `ok` / `attention` until 2026-09-22; the engine says `ready`,
// `not-verified`, `attention` (audio and lighting, which also say
// `unconfigured` / `disabled`) and `ready` / `unavailable` (the Stream Deck
// bridge, `native/rust-engine/src/control_surface_http.rs`). Only the fixture's
// words were mapped, so on the workstation a verified Audio, a probed Lighting
// and a serving Deck all showed a yellow "pending". These cases are written in
// the engine's words, from `audio/snapshot.rs`, `lighting/snapshot.rs` and
// `control_surface_http.rs`, not from what the header happens to produce.
describe("the header lamps read the hardware link's own words", () => {
  function lamps(checks: Record<string, { status: string }>) {
    const items = buildMonitorItems({ checks }, undefined, undefined);
    const byId = (id: string) => {
      const item = items.find((entry) => entry.id === id);
      if (!item) throw new Error(`the ${id} lamp is missing`);
      return { detail: item.detail, status: item.status };
    };
    return { audio: byId("audio"), lighting: byId("lighting"), deck: byId("surface") };
  }

  it("a subsystem the hardware link calls ready is ready and green, never pending", () => {
    const healthy = lamps({
      audio: { status: "ready" },
      lighting: { status: "ready" },
      controlSurface: { status: "ready" },
    });
    expect(healthy.audio).toEqual({ detail: "ready", status: "ok" });
    expect(healthy.lighting).toEqual({ detail: "ready", status: "ok" });
    expect(healthy.deck).toEqual({ detail: "ready", status: "ok" });
  });

  it("a probe that has not run says so, in the attention tone", () => {
    const unprobed = lamps({ audio: { status: "not-verified" }, lighting: { status: "not-verified" } });
    expect(unprobed.audio).toEqual({ detail: "not verified", status: "attention" });
    expect(unprobed.lighting).toEqual({ detail: "not verified", status: "attention" });
  });

  it("lighting that is not set up or is switched off says which", () => {
    expect(lamps({ lighting: { status: "unconfigured" } }).lighting).toEqual({
      detail: "not set up",
      status: "attention",
    });
    expect(lamps({ lighting: { status: "disabled" } }).lighting).toEqual({
      detail: "disabled",
      status: "attention",
    });
  });

  it("a Stream Deck bridge that could not start is an error", () => {
    expect(lamps({ controlSurface: { status: "unavailable" } }).deck).toEqual({
      detail: "unavailable",
      status: "error",
    });
  });

  it("a failed probe is still attention, and a missing check is still pending", () => {
    expect(lamps({ audio: { status: "attention" } }).audio).toEqual({ detail: "attention", status: "attention" });
    expect(lamps({}).audio).toEqual({ detail: "pending", status: "attention" });
    expect(lamps({}).deck).toEqual({ detail: "pending", status: "attention" });
  });

  it("the older words `ok` / `attention` keep what they showed", () => {
    const fixture = lamps({
      audio: { status: "ok" },
      lighting: { status: "attention" },
      controlSurface: { status: "ok" },
    });
    expect(fixture.audio).toEqual({ detail: "ready", status: "ok" });
    expect(fixture.lighting).toEqual({ detail: "attention", status: "attention" });
    expect(fixture.deck).toEqual({ detail: "ready", status: "ok" });
  });
});
