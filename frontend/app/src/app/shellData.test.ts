import { describe, expect, it } from "vitest";

import { buildMonitorItems, deriveLightingWorkspaceTone } from "./shellData";

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
